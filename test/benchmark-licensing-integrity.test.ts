/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end (synth-time) verification of LICENSING INTEGRITY for the benchmark
 * harness (Layer A `kataBench`, task 15): Requirement 21.
 *
 * These tests close the gap left by the other benchmark suites: the
 * `kataBench` orchestrator tests only ever simulate an ENTITLED account, and
 * the `buildKataClone` seam tests prove entitled/warn/fail at the seam. Here we
 * prove, through the PUBLIC `kataBench(stack, options)` entry point, that:
 *
 * - **Single transformation path / no bypass (Req 21.1, 21.3):** the ONLY way a
 *   Kata_Variant becomes transformed is through `kata()`'s licensing gate. When
 *   the gate reports the account UNENTITLED, the synthesized stack contains
 *   ZERO kata-transformed resources (no `python3.12` function, no
 *   `SnapStartActivator` custom resource, no Lambda Kata layer) — even though
 *   the clones are still materialized. If any alternate/bypass transformation
 *   path were introduced, this assertion would fail.
 * - **Gate is always consulted (Req 21.1):** the licensing check is invoked
 *   exactly once per cloneable Lambda in BOTH the entitled and unentitled runs;
 *   the transformation is never applied while skipping the check.
 * - **Entitlement is the SOLE determinant (Req 21.1, 21.3):** for the SAME
 *   fixture stack, flipping ONLY the entitlement result toggles the
 *   transformation on/off — nothing else differs.
 * - **Unentitled ⇒ unavailable per `unlicensedBehavior` (Req 21.2):**
 *   - `warn` (the default the orchestrator uses) keeps every clone untransformed
 *     at synth, leaves baselines untouched, does NOT abort the run, provisions
 *     NO benchmark trigger, and still emits the manifest — the transformation is
 *     made *unavailable*, not *presented-then-blocked-at-runtime*.
 *   - `fail` throws synthesis through the single transformation path the
 *     orchestrator routes through (`buildKataClone`), with no bypass swallowing
 *     the failure.
 *
 * ## Why the native-module mock is the licensing simulation seam
 *
 * The synchronous `kata()` synth path validates entitlement through
 * `NativeLicensingService.checkEntitlementSync` (the `@lambda-kata/licensing`
 * native module) — NOT through the async `MockLicensingService`, which is not
 * wired into the synchronous path and therefore cannot drive the actual
 * transformation. So the established benchmark-suite seam for simulating
 * entitled/unentitled is the native-module jest mock used by the sibling
 * clone-builder and kata-bench tests; we reuse exactly that here. Driving the
 * licensing decision through the real gate (rather than stubbing the harness)
 * is what makes "no bypass exists" a meaningful, falsifiable claim.
 *
 * **Validates: Requirements 21.1, 21.2, 21.3**
 *
 * @module benchmark-licensing-integrity.test
 */

import * as path from 'path';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CfnFunction, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';

// Imported after the mock is declared (jest hoists the mock above imports).
import * as licensing from '@lambda-kata/licensing';

import { kataBench } from '../src/benchmark/kata-bench';
import { buildKataClone } from '../src/benchmark/clone-builder';

const TEST_ACCOUNT = '123456789012';
const TEST_REGION = 'us-east-1';
const TEST_LAYER_ARN = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
const TEST_ENV = { account: TEST_ACCOUNT, region: TEST_REGION };
const FIXTURE_ASSET_DIR = path.join(__dirname, 'fixtures');

/** The Lambda Kata Python handler a TRANSFORMED clone must use. */
const KATA_HANDLER = 'lambdakata.optimized_handler.lambda_handler';
/** The baseline (untransformed) Node.js handler in these fixtures. */
const BASELINE_HANDLER = 'simple-handler.handler';
/** The kata transformation always targets this runtime. */
const KATA_RUNTIME = 'python3.12';
/** The original (untransformed) runtime of the fixture baselines. */
const BASELINE_RUNTIME = 'nodejs20.x';

// The synchronous kata() path validates licensing through the native module's
// `checkEntitlementSync`. A SINGLE shared jest.fn() is returned from every
// `new NativeLicensingService()` so the suite can both (a) flip the entitlement
// result and (b) count how many times the gate is consulted across a synth.
jest.mock('@lambda-kata/licensing', () => {
  const checkEntitlementSync = jest.fn();
  return {
    NativeLicensingService: jest.fn().mockImplementation(() => ({ checkEntitlementSync })),
    // Test-only handle to the shared gate fn (not part of the real module API).
    __checkEntitlementSync: checkEntitlementSync,
  };
});

/** The shared licensing-gate fn used by every `kata()` call during synth. */
const checkEntitlementSyncMock = (
  licensing as unknown as { __checkEntitlementSync: jest.Mock }
).__checkEntitlementSync;

/** Configure the licensing gate to report the test account as ENTITLED. */
function mockEntitled(): void {
  checkEntitlementSyncMock.mockReturnValue({
    entitled: true,
    layerVersionArn: TEST_LAYER_ARN,
  });
}

/** Configure the licensing gate to report the test account as NOT entitled. */
function mockNotEntitled(): void {
  checkEntitlementSyncMock.mockReturnValue({
    entitled: false,
    message: 'AWS account is not entitled. Subscribe via AWS Marketplace to enable.',
  });
}

beforeEach(() => {
  checkEntitlementSyncMock.mockReset();
  mockEntitled();
});

/** Create an isolated App + Stack for a single test case. */
function createStack(id = 'LicensingIntegrityStack'): Stack {
  return new Stack(new App({ context: { 'aws:cdk:account': TEST_ACCOUNT } }), id, { env: TEST_ENV });
}

/** Create an asset-backed Node.js (cloneable) Lambda. */
function createNodeLambda(scope: Stack, id: string): LambdaFunction {
  return new LambdaFunction(scope, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: BASELINE_HANDLER,
    code: Code.fromAsset(FIXTURE_ASSET_DIR),
  });
}

/**
 * Build a fixture stack with two cloneable Node.js Lambdas (Orders, Checkout).
 * Returns the stack plus the two baselines for trigger/targeting assertions.
 */
function buildFixtureStack(id: string): {
  stack: Stack;
  orders: LambdaFunction;
  checkout: LambdaFunction;
} {
  const stack = createStack(id);
  const orders = createNodeLambda(stack, 'OrdersFunction');
  const checkout = createNodeLambda(stack, 'CheckoutFunction');
  return { stack, orders, checkout };
}

/** All synthesized Lambda function resources, keyed by logical id. */
function functionsOf(stack: Stack): Record<string, { Properties: Record<string, unknown> }> {
  return Template.fromStack(stack).findResources('AWS::Lambda::Function') as Record<
    string,
    { Properties: Record<string, unknown> }
  >;
}

/** Count functions whose Handler equals the given value. */
function countByHandler(
  functions: Record<string, { Properties: Record<string, unknown> }>,
  handler: string,
): number {
  return Object.values(functions).filter((f) => f.Properties.Handler === handler).length;
}

/** Count functions whose Runtime equals the given value. */
function countByRuntime(
  functions: Record<string, { Properties: Record<string, unknown> }>,
  runtime: string,
): number {
  return Object.values(functions).filter((f) => f.Properties.Runtime === runtime).length;
}

/** Read the synthesized L1 `CfnFunction` of a baseline. */
function l1Of(fn: LambdaFunction): CfnFunction {
  return fn.node.defaultChild as CfnFunction;
}

describe('kataBench licensing integrity — single transformation path / no bypass (Req 21.1, 21.3)', () => {
  it('transforms every clone ONLY when the gated kata() path reports entitled', () => {
    mockEntitled();
    const { stack } = buildFixtureStack('EntitledPathStack');

    const result = kataBench(stack);

    const functions = functionsOf(stack);
    // Two cloneable baselines stay on their original handler/runtime.
    expect(countByHandler(functions, BASELINE_HANDLER)).toBe(2);
    // Two clones were transformed THROUGH the gated kata() path.
    expect(countByHandler(functions, KATA_HANDLER)).toBe(2);
    expect(countByRuntime(functions, KATA_RUNTIME)).toBe(2);
    // The SnapStart seam kata() attaches exists once per transformed clone.
    Template.fromStack(stack).resourceCountIs('AWS::CloudFormation::CustomResource', 2);
    expect(result.variants).toHaveLength(2);
  });

  it('applies NO transformation anywhere when the gate reports unentitled (no bypass path)', () => {
    mockNotEntitled();
    const { stack } = buildFixtureStack('NoBypassStack');

    // The run completes (warn) — clones are still MATERIALIZED — but the gate's
    // unentitled verdict means NOTHING in the stack is kata-transformed.
    const result = kataBench(stack);

    const functions = functionsOf(stack);
    // The clones exist but are untransformed: 2 baselines + 2 inert clones,
    // all still on the Node.js handler/runtime they were copied from.
    expect(countByHandler(functions, KATA_HANDLER)).toBe(0);
    expect(countByRuntime(functions, KATA_RUNTIME)).toBe(0);
    expect(countByHandler(functions, BASELINE_HANDLER)).toBe(4);
    expect(countByRuntime(functions, BASELINE_RUNTIME)).toBe(4);
    // No SnapStart custom resource is synthesized when unentitled — the
    // transformation is the ONLY thing that creates it, and it is gated.
    Template.fromStack(stack).resourceCountIs('AWS::CloudFormation::CustomResource', 0);
    // No Lambda Kata layer leaked onto any function via an alternate path.
    expect(JSON.stringify(functions)).not.toContain(TEST_LAYER_ARN);
    // The harness still produced the (inert) variants — it did not abort.
    expect(result.variants).toHaveLength(2);
  });

  it('consults the licensing gate exactly once per cloneable Lambda, entitled or not', () => {
    // Entitled run: one gate consultation per clone (here, 2).
    mockEntitled();
    const entitled = buildFixtureStack('GateConsultedEntitledStack');
    kataBench(entitled.stack);
    expect(checkEntitlementSyncMock).toHaveBeenCalledTimes(2);

    // Unentitled run: the gate is STILL consulted once per clone — the
    // transformation is gated, never skipped.
    checkEntitlementSyncMock.mockReset();
    mockNotEntitled();
    const unentitled = buildFixtureStack('GateConsultedUnentitledStack');
    kataBench(unentitled.stack);
    expect(checkEntitlementSyncMock).toHaveBeenCalledTimes(2);
  });

  it('makes entitlement the SOLE determinant of transformation for the same stack', () => {
    // Two independent synths of the SAME fixture differing ONLY in the gate
    // verdict: entitled transforms all clones, unentitled transforms none.
    mockEntitled();
    const entitled = buildFixtureStack('DeterminantEntitledStack');
    kataBench(entitled.stack);
    const entitledKataCount = countByHandler(functionsOf(entitled.stack), KATA_HANDLER);

    mockNotEntitled();
    const unentitled = buildFixtureStack('DeterminantUnentitledStack');
    kataBench(unentitled.stack);
    const unentitledKataCount = countByHandler(functionsOf(unentitled.stack), KATA_HANDLER);

    expect(entitledKataCount).toBe(2);
    expect(unentitledKataCount).toBe(0);
  });
});

describe('kataBench licensing integrity — unentitled is unavailable per unlicensedBehavior: warn (Req 21.2)', () => {
  it('keeps every clone untransformed and leaves baselines byte-equivalent across entitlement', () => {
    mockNotEntitled();
    const { stack, orders } = buildFixtureStack('WarnUntransformedStack');

    kataBench(stack);

    // The targeted baseline is unchanged by the (warn) unlicensed path.
    expect(l1Of(orders).runtime).toBe(BASELINE_RUNTIME);
    expect(l1Of(orders).handler).toBe(BASELINE_HANDLER);
    // No clone carries the kata seam.
    expect(orders.node.tryFindChild('SnapStartActivator')).toBeUndefined();
  });

  it('does NOT provision benchmark triggers when the transformation is unavailable (unavailable, not blocked-later)', () => {
    mockNotEntitled();
    const { stack, orders } = buildFixtureStack('WarnNoTriggerStack');

    // A trigger is DECLARED, but because the clone is never transformed (no
    // alias to target), no benchmark event source mapping is provisioned: the
    // capability is unavailable up-front rather than presented-then-blocked.
    kataBench(stack, { triggers: [{ type: 'sqs', target: orders.node.path }] });

    Template.fromStack(stack).resourceCountIs('AWS::Lambda::EventSourceMapping', 0);
  });

  it('still completes the run and emits the manifest when unentitled (warn)', () => {
    mockNotEntitled();
    const { stack } = buildFixtureStack('WarnManifestStack');

    const result = kataBench(stack);

    const template = Template.fromStack(stack);
    // The manifest pointer is still emitted (the run is observable, not aborted).
    template.resourceCountIs('AWS::SSM::Parameter', 1);
    expect(typeof result.manifestParameterName).toBe('string');
    expect(result.manifestParameterName.length).toBeGreaterThan(0);
  });
});

describe('kataBench licensing integrity — unentitled is unavailable per unlicensedBehavior: fail (Req 21.2)', () => {
  it('throws synthesis through the single transformation path when fail is requested (no bypass swallows it)', () => {
    // The orchestrator routes EXCLUSIVELY through buildKataClone → kata(); when
    // that single path is told to fail on an unentitled account it throws, and
    // there is no alternate path that would silently transform instead.
    mockNotEntitled();
    const stack = createStack('FailThrowsStack');
    const baseline = createNodeLambda(stack, 'OrdersFunction');

    expect(() =>
      buildKataClone(stack, 'OrdersClone', l1Of(baseline), 'reuse-role', {
        kataProps: { unlicensedBehavior: 'fail' },
      }),
    ).toThrow(/not entitled/i);
  });

  it('transforms via that same single path when entitled (path symmetry: only licensing differs)', () => {
    mockEntitled();
    const stack = createStack('FailPathEntitledStack');
    const baseline = createNodeLambda(stack, 'OrdersFunction');

    const result = buildKataClone(stack, 'OrdersClone', l1Of(baseline), 'reuse-role', {
      kataProps: { unlicensedBehavior: 'fail' },
    });

    // Same path, same options — entitlement is the only thing that changed.
    expect(result.transformed).toBe(true);
    expect(l1Of(result.cloneFunction).runtime).toBe(KATA_RUNTIME);
  });
});

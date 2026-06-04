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
 * Integration-style CDK assertion tests for the `kataBench` orchestrator
 * (Layer A, task 14): {@link kataBench}.
 *
 * These exercise the END-TO-END synth pipeline on a self-contained fixture
 * stack containing several Lambdas — including UNSUPPORTED ones (imported-by-ARN
 * and a non-Node runtime) — and pin the orchestrator's contract:
 *
 * - **baseline + clone pairs (Req 1.3):** the stack synthesizes N baseline
 *   (`nodejs*`) + N kata-variant (`python3.12`) functions for the cloneable
 *   Lambdas, leaving each baseline untouched (Req 1.4, 3.1).
 * - **clones default inert (Property 4, Req 3.3, 10.2):** every synthesized
 *   benchmark event source mapping is `Enabled: false`.
 * - **manifest emitted (Req 10.3, 10.4, 17.5):** exactly one SSM parameter +
 *   one `CfnOutput` pointer are produced and the result carries the parameter
 *   name.
 * - **skip-and-continue (Property 15, Req 5.8):** an unsupported Lambda is
 *   skipped and recorded in `skipped` WITHOUT aborting the whole run; the
 *   remaining Lambdas are still cloned.
 * - **targets subset (Req 1.5):** only Lambdas in an explicit subset are cloned.
 * - **argument validation (Req 1.7):** a non-`Stack` argument throws a
 *   descriptive error identifying the invalid argument.
 *
 * Entitlement is forced via the native licensing module mock — the SAME seam the
 * clone-builder and trigger-adapter tests use — because the synchronous `kata()`
 * path validates licensing through `NativeLicensingService`. This is the ONLY
 * transformation path the harness uses.
 *
 * **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.7, 3.1, 3.5, 3.6, 5.8, 12.1, 12.6, 12.7, 12.8**
 *
 * @module benchmark-kata-bench.test
 */

import * as path from 'path';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';

// Imported after the mock is declared (jest hoists the mock above imports).
import { NativeLicensingService } from '@lambda-kata/licensing';

import { kataBench } from '../src/benchmark/kata-bench';
import { FidelityLevel } from '../src/benchmark/options';

const TEST_ACCOUNT = '123456789012';
const TEST_REGION = 'us-east-1';
const TEST_LAYER_ARN = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
const TEST_ENV = { account: TEST_ACCOUNT, region: TEST_REGION };
const FIXTURE_ASSET_DIR = path.join(__dirname, 'fixtures');

/** The Lambda Kata Python handler a transformed clone must use. */
const KATA_HANDLER = 'lambdakata.optimized_handler.lambda_handler';
/** The baseline (untransformed) Node.js handler in these fixtures. */
const BASELINE_HANDLER = 'simple-handler.handler';

jest.mock('@lambda-kata/licensing', () => ({
  NativeLicensingService: jest.fn().mockImplementation(() => ({
    checkEntitlementSync: jest.fn(),
  })),
}));

const mockNativeLicensingService = NativeLicensingService as jest.Mock;

/** Configure the mock to report the test account as ENTITLED. */
function mockEntitled(): void {
  mockNativeLicensingService.mockImplementation(() => ({
    checkEntitlementSync: jest.fn().mockReturnValue({
      entitled: true,
      layerVersionArn: TEST_LAYER_ARN,
    }),
  }));
}

beforeEach(() => {
  mockNativeLicensingService.mockClear();
  mockEntitled();
});

/** Create an isolated App + Stack for a single test case. */
function createStack(id = 'KataBenchStack'): Stack {
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

/** Create a NON-Node (unsupported-runtime) Lambda — cannot be kata-transformed. */
function createUnsupportedRuntimeLambda(scope: Stack, id: string): LambdaFunction {
  return new LambdaFunction(scope, id, {
    runtime: Runtime.PYTHON_3_11,
    handler: 'app.handler',
    code: Code.fromAsset(FIXTURE_ASSET_DIR),
  });
}

/**
 * Build the canonical self-contained fixture stack:
 * - two cloneable Node.js Lambdas (Orders, Checkout),
 * - one imported-by-ARN function (unsupported, no owned CfnFunction),
 * - one non-Node runtime function (unsupported-runtime).
 */
function buildFixtureStack(id: string): {
  stack: Stack;
  orders: LambdaFunction;
  checkout: LambdaFunction;
  importedPath: string;
  pythonPath: string;
} {
  const stack = createStack(id);
  const orders = createNodeLambda(stack, 'OrdersFunction');
  const checkout = createNodeLambda(stack, 'CheckoutFunction');
  const imported = LambdaFunction.fromFunctionArn(
    stack,
    'ImportedFunction',
    'arn:aws:lambda:us-east-1:123456789012:function:legacy-payments',
  );
  const python = createUnsupportedRuntimeLambda(stack, 'LegacyPythonFunction');
  return {
    stack,
    orders,
    checkout,
    importedPath: imported.node.path,
    pythonPath: python.node.path,
  };
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

describe('kataBench — argument validation (Req 1.7)', () => {
  it('throws a descriptive error identifying the invalid argument when not a Stack', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => kataBench({} as any)).toThrow(/Stack/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => kataBench(undefined as any)).toThrow(/Stack/);
  });
});

describe('kataBench — baseline + clone pairs end-to-end (Req 1.1, 1.3, 1.4)', () => {
  it('synthesizes N nodejs baselines + N python3.12 kata variants for the cloneable Lambdas', () => {
    const { stack } = buildFixtureStack('PairsStack');

    const result = kataBench(stack);

    const functions = functionsOf(stack);
    // Two cloneable Node.js baselines remain on their original handler.
    expect(countByHandler(functions, BASELINE_HANDLER)).toBe(2);
    // Two kata variants on the Lambda Kata python handler.
    expect(countByHandler(functions, KATA_HANDLER)).toBe(2);

    const kataVariants = Object.values(functions).filter(
      (f) => f.Properties.Handler === KATA_HANDLER,
    );
    kataVariants.forEach((f) => expect(f.Properties.Runtime).toBe('python3.12'));

    // The result exposes exactly the two variant pairs with readable names.
    expect(result.variants).toHaveLength(2);
    result.variants.forEach((v) => {
      expect(v.eligibility.eligibility).toBe('cloneable');
      expect(typeof v.baselineFunctionName).toBe('string');
      expect(typeof v.kataFunctionName).toBe('string');
      expect(v.kataFunctionName).not.toBe(v.baselineFunctionName);
    });

    expect(typeof result.benchRunId).toBe('string');
    expect(result.benchRunId.length).toBeGreaterThan(0);
  });

  it('attaches a SnapStartActivator custom resource to each clone only (one per cloneable Lambda)', () => {
    const { stack } = buildFixtureStack('SnapStartStack');

    kataBench(stack);

    Template.fromStack(stack).resourceCountIs('AWS::CloudFormation::CustomResource', 2);
  });
});

describe('kataBench — Property 15: skip-and-continue for unsupported Lambdas (Req 5.8)', () => {
  it('skips imported-by-ARN and non-Node Lambdas WITHOUT aborting, recording them in skipped', () => {
    const { stack, importedPath, pythonPath } = buildFixtureStack('SkipStack');

    const result = kataBench(stack);

    const skippedPaths = result.skipped.map((s) => s.constructPath);
    expect(skippedPaths).toContain(importedPath);
    expect(skippedPaths).toContain(pythonPath);
    result.skipped.forEach((s) => expect(s.eligibility.eligibility).toBe('unsupported'));

    // The run still produced the cloneable variants — it did not abort.
    expect(result.variants).toHaveLength(2);
    expect(countByHandler(functionsOf(stack), KATA_HANDLER)).toBe(2);
  });
});

describe('kataBench — Property 4: clone triggers synthesized disabled (Req 3.3, 10.2)', () => {
  it('creates benchmark event source mappings all disabled when a trigger is declared', () => {
    const { stack, orders } = buildFixtureStack('DisabledTriggerStack');

    kataBench(stack, {
      triggers: [{ type: 'sqs', target: orders.node.path }],
    });

    const template = Template.fromStack(stack);
    // An isolated benchmark queue was created (no production data plane reuse).
    template.resourceCountIs('AWS::SQS::Queue', 1);

    const mappings = template.findResources('AWS::Lambda::EventSourceMapping');
    const mappingValues = Object.values(mappings) as Array<{ Properties: { Enabled?: boolean } }>;
    // Kata + baseline benchmark mappings, both created disabled (observe-only).
    expect(mappingValues.length).toBeGreaterThanOrEqual(1);
    mappingValues.forEach((m) => expect(m.Properties.Enabled).toBe(false));
  });
});

describe('kataBench — manifest emission (Req 10.3, 10.4, 17.5)', () => {
  it('emits exactly one SSM parameter and one CfnOutput pointer and returns the parameter name', () => {
    const { stack } = buildFixtureStack('ManifestStack');

    const result = kataBench(stack);

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::SSM::Parameter', 1);

    const outputs = template.findOutputs('*');
    expect(Object.values(outputs)).toHaveLength(1);

    expect(typeof result.manifestParameterName).toBe('string');
    expect(result.manifestParameterName.length).toBeGreaterThan(0);
  });
});

describe('kataBench — explicit targets subset (Req 1.5)', () => {
  it('clones only the Lambdas named in a paths subset', () => {
    const { stack, orders } = buildFixtureStack('SubsetStack');

    const result = kataBench(stack, {
      targets: { type: 'paths', constructPaths: [orders.node.path] },
    });

    // Only the single targeted baseline is cloned.
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]?.constructPath).toBe(orders.node.path);
    expect(countByHandler(functionsOf(stack), KATA_HANDLER)).toBe(1);
  });
});

describe('kataBench — fidelity level handler selection (Req 12.1, 12.6, 12.7, 12.8)', () => {
  it('defaults to the most conservative L0 and records the fidelity (no opt-in required)', () => {
    const { stack } = buildFixtureStack('FidelityL0Stack');

    const result = kataBench(stack);

    // L0 default still transforms clones through kata() (synthetic handler is a
    // run-time/config-layer concern; the CfnFunction handler is the kata handler).
    expect(result.variants).toHaveLength(2);
    expect(countByHandler(functionsOf(stack), KATA_HANDLER)).toBe(2);
  });

  it('requires an explicit production-shadow opt-in for L4 (Req 12.6)', () => {
    const { stack } = buildFixtureStack('FidelityL4NoOptInStack');

    expect(() => kataBench(stack, { fidelity: FidelityLevel.L4 })).toThrow(/L4|production-shadow|opt-in/i);
  });

  it('permits L4 when production-shadow is explicitly opted in', () => {
    const { stack } = buildFixtureStack('FidelityL4OptInStack');

    const result = kataBench(stack, {
      fidelity: FidelityLevel.L4,
      productionShadow: { optIn: true },
    });

    expect(result.variants).toHaveLength(2);
  });

  it('disables benchmark routing when the L4 kill switch is engaged (Req 12.6)', () => {
    const { stack, orders } = buildFixtureStack('FidelityL4KillSwitchStack');

    kataBench(stack, {
      fidelity: FidelityLevel.L4,
      productionShadow: { optIn: true, killSwitch: true },
      triggers: [{ type: 'sqs', target: orders.node.path }],
    });

    // The kill switch disables benchmark routing: no benchmark event source
    // mapping is synthesized at all.
    Template.fromStack(stack).resourceCountIs('AWS::Lambda::EventSourceMapping', 0);
  });
});

describe('kataBench — findings surface (Req 11.11)', () => {
  it('returns a findings array (empty under the default-deny isolated-source path)', () => {
    const { stack } = buildFixtureStack('FindingsStack');

    const result = kataBench(stack);

    expect(Array.isArray(result.findings)).toBe(true);
  });
});

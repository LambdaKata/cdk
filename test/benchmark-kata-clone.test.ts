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
 * CDK assertion tests for the CloneBuilder kata-application seam
 * (Layer B, task 5.2): {@link buildKataClone}.
 *
 * These prove that applying the Lambda Kata transformation to a materialized
 * clone goes EXCLUSIVELY through the unchanged public `kata()` path (Req 21.1,
 * 21.3) and that the resulting synthesis preserves the harness's core
 * correctness properties:
 *
 * - **Property 15 (clone-per-baseline):** a fixture stack with N cloneable
 *   Lambdas synthesizes N baseline (`nodejs*`) + N kata-variant (`python3.12`)
 *   functions — 2N variant functions in total (Req 1.3).
 * - **Faithful reuse post-kata (Req 4.5):** the kata clone reuses the SAME code
 *   asset location and the SAME execution role as its baseline AFTER the
 *   transformation, never re-uploading the asset or provisioning a new role.
 * - **Property 2/3 (clone-only kata + SnapStart):** after `kata()` the clone
 *   runtime is `python3.12` and a `SnapStartActivator` (with its synthesized
 *   custom resource) exists on the CLONE ONLY, never on the baseline.
 * - **Property 1 (baseline immutability):** the baseline `CfnFunction` is
 *   byte-identical before vs after the clone+kata transformation.
 * - **Licensing integrity (Req 21.1, 21.3):** the clone is transformed ONLY
 *   when the account is entitled; an unentitled account leaves the clone
 *   untransformed (warn) or fails synthesis (fail) — there is no bypass.
 *
 * Entitlement is forced via the native licensing module mock — the SAME seam
 * the core `kata-wrapper` and example-synth tests use — because the synchronous
 * `kata()` path validates licensing through `NativeLicensingService`. This is
 * the only transformation path; the harness adds no alternate one.
 *
 * **Validates: Requirements 2.1, 4.4, 4.5, 14.4, 14.5, 21.1, 21.3**
 *
 * @module benchmark-kata-clone.test
 */

import * as path from 'path';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  Architecture,
  CfnFunction,
  Code,
  Function as LambdaFunction,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';

// Imported after the mock is declared (jest hoists the mock above imports).
import { NativeLicensingService } from '@lambda-kata/licensing';

import { buildKataClone } from '../src/benchmark/clone-builder';

const TEST_ACCOUNT = '123456789012';
const TEST_REGION = 'us-east-1';
const TEST_LAYER_ARN = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
const TEST_ENV = { account: TEST_ACCOUNT, region: TEST_REGION };
const FIXTURE_ASSET_DIR = path.join(__dirname, 'fixtures');

/** The Lambda Kata Python handler a transformed clone must use. */
const KATA_HANDLER = 'lambdakata.optimized_handler.lambda_handler';
/** The baseline (untransformed) Node.js handler in these fixtures. */
const BASELINE_HANDLER = 'simple-handler.handler';

// Force the native licensing module response so the synchronous kata() path is
// the only thing deciding whether the clone is transformed.
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

/** Configure the mock to report the test account as NOT entitled. */
function mockNotEntitled(): void {
  mockNativeLicensingService.mockImplementation(() => ({
    checkEntitlementSync: jest.fn().mockReturnValue({
      entitled: false,
      message: 'AWS account is not entitled. Subscribe via AWS Marketplace to enable.',
    }),
  }));
}

beforeEach(() => {
  mockNativeLicensingService.mockClear();
  mockEntitled();
});

/** Create an isolated App + Stack for a single test case. */
function createStack(id = 'KataCloneStack'): Stack {
  return new Stack(new App({ context: { 'aws:cdk:account': TEST_ACCOUNT } }), id, { env: TEST_ENV });
}

/** Create an asset-backed Node.js Lambda (so the code is a real S3 asset). */
function createAssetLambda(
  scope: Stack,
  id: string,
  props: Partial<{
    functionName: string;
    environment: Record<string, string>;
    memorySize: number;
    architecture: Architecture;
  }> = {},
): LambdaFunction {
  return new LambdaFunction(scope, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: BASELINE_HANDLER,
    code: Code.fromAsset(FIXTURE_ASSET_DIR),
    ...(props.functionName ? { functionName: props.functionName } : {}),
    ...(props.environment ? { environment: props.environment } : {}),
    ...(props.memorySize ? { memorySize: props.memorySize } : {}),
    ...(props.architecture ? { architecture: props.architecture } : {}),
  });
}

/** Read the synthesized L1 `CfnFunction` of a baseline. */
function l1Of(fn: LambdaFunction): CfnFunction {
  return fn.node.defaultChild as CfnFunction;
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

describe('buildKataClone — Property 15: one kata clone per baseline (2N functions)', () => {
  it.each([1, 2, 3])('synthesizes N baseline + N python3.12 kata variants for N=%i', (n) => {
    const stack = createStack(`CloneCountStack${n}`);

    for (let i = 0; i < n; i += 1) {
      const baseline = createAssetLambda(stack, `Fn${i}`);
      buildKataClone(stack, `Fn${i}Clone`, l1Of(baseline), 'reuse-role');
    }

    const functions = functionsOf(stack);
    // N untransformed baselines + N transformed kata variants.
    expect(countByHandler(functions, BASELINE_HANDLER)).toBe(n);
    expect(countByHandler(functions, KATA_HANDLER)).toBe(n);

    // Every kata variant runs on python3.12 (Property 2).
    const kataVariants = Object.values(functions).filter(
      (f) => f.Properties.Handler === KATA_HANDLER,
    );
    kataVariants.forEach((f) => expect(f.Properties.Runtime).toBe('python3.12'));
  });
});

describe('buildKataClone — faithful reuse AFTER kata (Req 4.5)', () => {
  it('reuses the SAME code asset location as the baseline (no re-upload)', () => {
    const stack = createStack('SameAssetAfterKataStack');
    const baseline = createAssetLambda(stack, 'Orders');

    const result = buildKataClone(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    const functions = functionsOf(stack);
    const baselineResource = Object.values(functions).find(
      (f) => f.Properties.Handler === BASELINE_HANDLER,
    );
    const cloneResource = Object.values(functions).find(
      (f) => f.Properties.Handler === KATA_HANDLER,
    );

    expect(baselineResource).toBeDefined();
    expect(cloneResource).toBeDefined();
    // The kata transformation never touches the code asset reference.
    expect(JSON.stringify(cloneResource?.Properties.Code)).toBe(
      JSON.stringify(baselineResource?.Properties.Code),
    );
    expect(result.transformed).toBe(true);
  });

  it('reuses the SAME execution role and provisions no extra role for the clone', () => {
    const stack = createStack('SameRoleAfterKataStack');
    const baseline = createAssetLambda(stack, 'Orders');

    buildKataClone(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    const functions = functionsOf(stack);
    const baselineResource = Object.values(functions).find(
      (f) => f.Properties.Handler === BASELINE_HANDLER,
    );
    const cloneResource = Object.values(functions).find(
      (f) => f.Properties.Handler === KATA_HANDLER,
    );

    // Baseline and kata variant point at the SAME role reference.
    expect(JSON.stringify(cloneResource?.Properties.Role)).toBe(
      JSON.stringify(baselineResource?.Properties.Role),
    );
  });
});

describe('buildKataClone — Property 2/3: python3.12 + SnapStart on the clone ONLY', () => {
  it('transforms the clone to python3.12 and attaches a SnapStartActivator to it', () => {
    const stack = createStack('CloneSnapStartStack');
    const baseline = createAssetLambda(stack, 'Orders');

    const result = buildKataClone(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    // The clone carries the SnapStart seam; the alias ref is exposed for the
    // InvokePathRewriter (task 6).
    expect(result.cloneFunction.node.tryFindChild('SnapStartActivator')).toBeDefined();
    expect(result.aliasArnRef).toBeDefined();
    expect(result.versionRef).toBeDefined();
    expect(l1Of(result.cloneFunction).runtime).toBe('python3.12');
  });

  it('leaves the baseline untouched: no SnapStartActivator and original runtime', () => {
    const stack = createStack('BaselineNoSnapStartStack');
    const baseline = createAssetLambda(stack, 'Orders');

    buildKataClone(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    expect(baseline.node.tryFindChild('SnapStartActivator')).toBeUndefined();
    expect(l1Of(baseline).runtime).toBe('nodejs20.x');
    expect(l1Of(baseline).handler).toBe(BASELINE_HANDLER);
  });

  it('synthesizes exactly one SnapStart custom resource per clone', () => {
    const stack = createStack('SnapStartCustomResourceStack');
    const a = createAssetLambda(stack, 'A');
    const b = createAssetLambda(stack, 'B');
    buildKataClone(stack, 'AClone', l1Of(a), 'reuse-role');
    buildKataClone(stack, 'BClone', l1Of(b), 'reuse-role');

    Template.fromStack(stack).resourceCountIs('AWS::CloudFormation::CustomResource', 2);
  });
});

describe('buildKataClone — Property 1: baseline CfnFunction is byte-identical before/after', () => {
  it('does not mutate the baseline resource fragment when the clone is built + transformed', () => {
    // CDK forbids re-synthesizing one App after the tree is modified, so we
    // compare the baseline fragment across two independent Apps that build the
    // SAME baseline at the SAME construct path (logical ids are therefore
    // identical): one WITHOUT the clone, one WITH the clone+kata applied.
    const buildBaseline = (stack: Stack): LambdaFunction =>
      createAssetLambda(stack, 'Orders', {
        environment: { TABLE_NAME: 'orders', ENDPOINT: 'https://x' },
        memorySize: 1024,
      });

    // Stack WITHOUT the clone — the reference baseline fragment.
    const baselineOnly = createStack('BaselineImmutableRefStack');
    const refBaseline = buildBaseline(baselineOnly);
    const refLogicalId = baselineOnly.getLogicalId(l1Of(refBaseline));
    const before = Template.fromStack(baselineOnly).toJSON().Resources[refLogicalId];

    // Stack WITH the clone+kata — the baseline fragment must be unchanged.
    const withClone = createStack('BaselineImmutableRefStack');
    const baseline = buildBaseline(withClone);
    buildKataClone(withClone, 'OrdersClone', l1Of(baseline), 'reuse-role');
    const afterLogicalId = withClone.getLogicalId(l1Of(baseline));
    const after = Template.fromStack(withClone).toJSON().Resources[afterLogicalId];

    expect(afterLogicalId).toBe(refLogicalId);
    expect(after).toEqual(before);
  });
});

describe('buildKataClone — env KEYS recorded without values + roleMode threaded (Req 14.4, 14.5)', () => {
  it('records env keys (never values) and threads the role mode into the result', () => {
    const stack = createStack('EnvKeysAfterKataStack');
    const baseline = createAssetLambda(stack, 'Orders', {
      environment: { TABLE_NAME: 'super-secret-table', API_KEY: 'shhh' },
    });

    const result = buildKataClone(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    expect(new Set(result.envKeysCopied)).toEqual(new Set(['TABLE_NAME', 'API_KEY']));
    expect(result.roleMode).toBe('reuse-role');
    const serialized = JSON.stringify(result.envKeysCopied);
    expect(serialized).not.toContain('super-secret-table');
    expect(serialized).not.toContain('shhh');
  });
});

describe('buildKataClone — licensing integrity: the ONLY transformation path (Req 21.1, 21.3)', () => {
  it('transforms the clone when the account is entitled', () => {
    mockEntitled();
    const stack = createStack('EntitledStack');
    const baseline = createAssetLambda(stack, 'Orders');

    const result = buildKataClone(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    expect(result.transformed).toBe(true);
    expect(l1Of(result.cloneFunction).runtime).toBe('python3.12');
  });

  it('does NOT transform the clone when the account is not entitled (warn — no bypass)', () => {
    mockNotEntitled();
    const stack = createStack('UnentitledWarnStack');
    const baseline = createAssetLambda(stack, 'Orders');

    const result = buildKataClone(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    // The clone keeps the copied baseline runtime/handler — no alternate path
    // transformed it, and no SnapStart seam was attached.
    expect(result.transformed).toBe(false);
    expect(l1Of(result.cloneFunction).runtime).toBe('nodejs20.x');
    expect(l1Of(result.cloneFunction).handler).toBe(BASELINE_HANDLER);
    expect(result.cloneFunction.node.tryFindChild('SnapStartActivator')).toBeUndefined();
    expect(result.aliasArnRef).toBeUndefined();
  });

  it('fails synthesis when not entitled and unlicensedBehavior is "fail"', () => {
    mockNotEntitled();
    const stack = createStack('UnentitledFailStack');
    const baseline = createAssetLambda(stack, 'Orders');

    expect(() =>
      buildKataClone(stack, 'OrdersClone', l1Of(baseline), 'reuse-role', {
        kataProps: { unlicensedBehavior: 'fail' },
      }),
    ).toThrow();
  });
});

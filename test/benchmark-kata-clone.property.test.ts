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
 * Property-Based Tests for the CloneBuilder kata-application seam (task 5.2):
 * {@link buildKataClone}.
 *
 * These prove two universal invariants of the kata-application seam across a
 * generated input space, complementing the example-level CDK assertion tests:
 *
 * - **Property 15 (clone-per-baseline):** for ANY N in a small range, a stack
 *   of N cloneable Lambdas synthesizes exactly N untransformed baselines and N
 *   `python3.12` kata variants (2N variant functions).
 * - **Property 1 (baseline immutability):** for ANY such stack, EVERY baseline
 *   `CfnFunction` fragment is byte-identical before vs after the clone+kata
 *   transformation.
 *
 * **Validates: Requirements 1.3, 2.1, 4.4, 21.1**
 *
 * @module benchmark-kata-clone.property.test
 */

import * as path from 'path';
import * as fc from 'fast-check';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CfnFunction, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';

// Imported after the mock is declared (jest hoists the mock above imports).
import { NativeLicensingService } from '@lambda-kata/licensing';

import { buildKataClone } from '../src/benchmark/clone-builder';

const TEST_ACCOUNT = '123456789012';
const TEST_REGION = 'us-east-1';
const TEST_LAYER_ARN = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
const TEST_ENV = { account: TEST_ACCOUNT, region: TEST_REGION };
const FIXTURE_ASSET_DIR = path.join(__dirname, 'fixtures');

const KATA_HANDLER = 'lambdakata.optimized_handler.lambda_handler';
const BASELINE_HANDLER = 'simple-handler.handler';

// Force the native licensing module to report ENTITLED so the only
// transformation path (kata()) actually runs.
jest.mock('@lambda-kata/licensing', () => ({
  NativeLicensingService: jest.fn().mockImplementation(() => ({
    checkEntitlementSync: jest.fn().mockReturnValue({
      entitled: true,
      layerVersionArn: 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1',
    }),
  })),
}));

void NativeLicensingService;
void TEST_LAYER_ARN;

function createStack(id: string): Stack {
  return new Stack(new App({ context: { 'aws:cdk:account': TEST_ACCOUNT } }), id, { env: TEST_ENV });
}

function createAssetLambda(scope: Stack, id: string): LambdaFunction {
  return new LambdaFunction(scope, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: BASELINE_HANDLER,
    code: Code.fromAsset(FIXTURE_ASSET_DIR),
  });
}

function l1Of(fn: LambdaFunction): CfnFunction {
  return fn.node.defaultChild as CfnFunction;
}

describe('buildKataClone — Property: 2N functions for any N (Property 15)', () => {
  /**
   * **Validates: Requirements 1.3, 2.1, 4.4**
   */
  it('always synthesizes N baselines + N python3.12 kata variants', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 0, max: 1_000_000 }), (n, salt) => {
        const stack = createStack(`PropCloneCount-${n}-${salt}`);
        for (let i = 0; i < n; i += 1) {
          const baseline = createAssetLambda(stack, `Fn${i}`);
          buildKataClone(stack, `Fn${i}Clone`, l1Of(baseline), 'reuse-role');
        }

        const functions = Template.fromStack(stack).findResources('AWS::Lambda::Function') as Record<
          string,
          { Properties: Record<string, unknown> }
        >;
        const baselines = Object.values(functions).filter(
          (f) => f.Properties.Handler === BASELINE_HANDLER,
        );
        const kataVariants = Object.values(functions).filter(
          (f) => f.Properties.Handler === KATA_HANDLER,
        );

        return (
          baselines.length === n &&
          kataVariants.length === n &&
          kataVariants.every((f) => f.Properties.Runtime === 'python3.12')
        );
      }),
      { numRuns: 25 },
    );
  });
});

describe('buildKataClone — Property: baselines are byte-identical before/after (Property 1)', () => {
  /**
   * **Validates: Requirements 2.1, 21.1**
   */
  it('never mutates any baseline CfnFunction fragment across clone + kata', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 0, max: 1_000_000 }), (n, salt) => {
        const stackId = `PropBaselineImmut-${n}-${salt}`;

        // Reference App: build the N baselines at fixed construct paths WITHOUT
        // any clone. CDK forbids re-synthesizing a single App after the tree is
        // modified, so the comparison uses two independent Apps building the
        // SAME baselines at the SAME paths (logical ids are therefore equal).
        const refStack = createStack(stackId);
        const refBaselines: LambdaFunction[] = [];
        for (let i = 0; i < n; i += 1) {
          refBaselines.push(createAssetLambda(refStack, `Fn${i}`));
        }
        const refLogicalIds = refBaselines.map((b) => refStack.getLogicalId(l1Of(b)));
        const refResources = Template.fromStack(refStack).toJSON().Resources as Record<string, unknown>;
        const snapshot = refLogicalIds.map((id) => JSON.stringify(refResources[id]));

        // Clone App: same baselines at the same paths, PLUS clone + kata.
        const cloneStack = createStack(stackId);
        const baselines: LambdaFunction[] = [];
        for (let i = 0; i < n; i += 1) {
          baselines.push(createAssetLambda(cloneStack, `Fn${i}`));
        }
        baselines.forEach((b, i) => buildKataClone(cloneStack, `Fn${i}Clone`, l1Of(b), 'reuse-role'));

        const after = Template.fromStack(cloneStack).toJSON().Resources as Record<string, unknown>;
        return refLogicalIds.every((id, i) => JSON.stringify(after[id]) === snapshot[i]);
      }),
      { numRuns: 20 },
    );
  });
});

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
 * Property-Based Tests for the CloneBuilder materializer (Layer B, task 5.1).
 *
 * These prove two universal invariants of {@link materializeCloneFunction}
 * across a generated input space, complementing the example-level CDK assertion
 * tests:
 *
 * - **Env keys, never values (Req 14.4, 14.5):** for ANY environment map the
 *   baseline declares, the recorded `envKeysCopied` is exactly the set of keys
 *   and the serialized result never contains any of the (distinct) values.
 * - **Faithful reuse (Req 4.5):** for ANY baseline the clone reuses the SAME
 *   single role (no extra `AWS::IAM::Role` is synthesized) and the SAME code
 *   asset location as the baseline.
 *
 * **Validates: Requirements 4.5, 14.4, 14.5**
 *
 * @module benchmark-clone-builder.property.test
 */

import * as path from 'path';
import * as fc from 'fast-check';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { CfnFunction, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';

import { materializeCloneFunction } from '../src/benchmark/clone-builder';

const TEST_ENV = { account: '123456789012', region: 'us-east-1' };
const FIXTURE_ASSET_DIR = path.join(__dirname, 'fixtures');

/** A valid Lambda environment variable key (does not start with AWS-reserved). */
const envKeyArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,30}$/)
  .filter((k) => !k.startsWith('AWS'));

/** A non-empty, distinctive value unlikely to coincide with a key. */
const envValueArb: fc.Arbitrary<string> = fc
  .stringMatching(/^val_[A-Za-z0-9]{4,16}$/);

/** An environment map with distinct keys and distinct values. */
const envMapArb: fc.Arbitrary<Record<string, string>> = fc
  .uniqueArray(fc.tuple(envKeyArb, envValueArb), {
    minLength: 0,
    maxLength: 8,
    selector: ([k]) => k,
  })
  .map((pairs) => Object.fromEntries(pairs));

function createStack(id: string): Stack {
  return new Stack(new App(), id, { env: TEST_ENV });
}

function createAssetLambda(scope: Stack, env: Record<string, string>): LambdaFunction {
  return new LambdaFunction(scope, 'Baseline', {
    runtime: Runtime.NODEJS_20_X,
    handler: 'simple-handler.handler',
    code: Code.fromAsset(FIXTURE_ASSET_DIR),
    ...(Object.keys(env).length > 0 ? { environment: env } : {}),
  });
}

describe('materializeCloneFunction — Property: env keys recorded, values never leak (Req 14.4, 14.5)', () => {
  /**
   * **Validates: Requirements 14.4, 14.5**
   */
  it('records exactly the env keys and never any value', () => {
    fc.assert(
      fc.property(envMapArb, fc.integer({ min: 0, max: 1_000_000 }), (env, salt) => {
        const stack = createStack(`EnvPropStack${salt}`);
        const baseline = createAssetLambda(stack, env);

        const result = materializeCloneFunction(
          stack,
          'Clone',
          baseline.node.defaultChild as CfnFunction,
          'reuse-role',
        );

        const expectedKeys = new Set(Object.keys(env));
        const actualKeys = new Set(result.envKeysCopied);

        if (expectedKeys.size !== actualKeys.size) {
          return false;
        }
        for (const key of expectedKeys) {
          if (!actualKeys.has(key)) {
            return false;
          }
        }

        // No value (which is distinct from every key) appears in the record.
        const serialized = JSON.stringify(result.envKeysCopied);
        return Object.values(env).every((value) => !serialized.includes(value));
      }),
      { numRuns: 100 },
    );
  });
});

describe('materializeCloneFunction — Property: faithful single-role + same-asset reuse (Req 4.5)', () => {
  /**
   * **Validates: Requirements 4.5**
   */
  it('never provisions a second role and always reuses the baseline code asset', () => {
    fc.assert(
      fc.property(envMapArb, fc.integer({ min: 0, max: 1_000_000 }), (env, salt) => {
        const stack = createStack(`ReusePropStack${salt}`);
        const baseline = createAssetLambda(stack, env);

        materializeCloneFunction(
          stack,
          'Clone',
          baseline.node.defaultChild as CfnFunction,
          'reuse-role',
        );

        const template = Template.fromStack(stack);
        const roleCount = Object.keys(template.findResources('AWS::IAM::Role')).length;
        const functions = template.findResources('AWS::Lambda::Function');
        const codes = new Set(
          Object.values(functions).map((f) => JSON.stringify(f.Properties.Code)),
        );

        return (
          roleCount === 1 &&
          Object.keys(functions).length === 2 &&
          codes.size === 1
        );
      }),
      { numRuns: 60 },
    );
  });
});

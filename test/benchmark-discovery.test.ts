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
 * CDK assertion tests for LambdaDiscovery (Layer B, Requirement 1.2).
 *
 * These exercise {@link discoverLambdas} against a fixture stack that contains
 * several real Lambda functions (`Function` L2 constructs) plus an
 * imported-by-ARN function (`Function.fromFunctionArn`). They pin the
 * construct-tree traversal contract:
 *
 * - every owned `Function` is discovered with its `node.defaultChild`
 *   `CfnFunction`, `isImported === false`, and a stable `constructPath`;
 * - the imported-by-ARN function is surfaced with `isImported === true` and
 *   no owned `cfn`;
 * - support constructs that also extend `FunctionBase` but are NOT base
 *   functions (`Version`, `Alias`) are excluded so a single function is never
 *   double-counted.
 *
 * **Validates: Requirements 1.2**
 *
 * @module benchmark-discovery.test
 */

import { App, Stack } from 'aws-cdk-lib';
import { CfnFunction, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';

import { DiscoveredLambda, discoverLambdas } from '../src/benchmark/discovery';

const TEST_ENV = { account: '123456789012', region: 'us-east-1' };

/** Create an isolated App + Stack for a single test case. */
function createTestStack(stackId = 'DiscoveryTestStack'): Stack {
  const app = new App();
  return new Stack(app, stackId, { env: TEST_ENV });
}

/** Create a minimal, synthesizable Node.js Lambda in the given scope. */
function createTestLambda(scope: Stack, id: string): LambdaFunction {
  return new LambdaFunction(scope, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
  });
}

/** Index a discovery result by its baseline construct path for assertions. */
function byPath(discovered: ReadonlyArray<DiscoveredLambda>): Map<string, DiscoveredLambda> {
  return new Map(discovered.map((d) => [d.constructPath, d]));
}

describe('discoverLambdas — argument validation (Req 1.2)', () => {
  it('throws a descriptive error when not given a Stack', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => discoverLambdas({} as any)).toThrow(/Stack/);
  });
});

describe('discoverLambdas — owned Lambda discovery (Req 1.2)', () => {
  it('discovers every owned Function with its CfnFunction default child', () => {
    const stack = createTestStack();
    const orders = createTestLambda(stack, 'OrdersFunction');
    const checkout = createTestLambda(stack, 'CheckoutFunction');
    const worker = createTestLambda(stack, 'WorkerFunction');

    const discovered = discoverLambdas(stack);
    const owned = discovered.filter((d) => !d.isImported);

    expect(owned).toHaveLength(3);

    const indexed = byPath(discovered);
    for (const fn of [orders, checkout, worker]) {
      const entry = indexed.get(fn.node.path);
      expect(entry).toBeDefined();
      expect(entry?.isImported).toBe(false);
      expect(entry?.node).toBe(fn);
      expect(entry?.cfn).toBe(fn.node.defaultChild as CfnFunction);
      expect(entry?.cfn).toBeInstanceOf(CfnFunction);
    }
  });

  it('returns an empty array for a stack with no Lambdas', () => {
    const stack = createTestStack('EmptyStack');
    expect(discoverLambdas(stack)).toEqual([]);
  });
});

describe('discoverLambdas — imported-by-ARN detection (Req 1.2)', () => {
  it('marks an imported-by-ARN function as isImported with no owned cfn', () => {
    const stack = createTestStack('ImportedStack');
    const owned = createTestLambda(stack, 'OwnedFunction');
    const imported = LambdaFunction.fromFunctionArn(
      stack,
      'ImportedFunction',
      'arn:aws:lambda:us-east-1:123456789012:function:legacy-payments',
    );

    const discovered = discoverLambdas(stack);
    const indexed = byPath(discovered);

    const ownedEntry = indexed.get(owned.node.path);
    expect(ownedEntry?.isImported).toBe(false);
    expect(ownedEntry?.cfn).toBeInstanceOf(CfnFunction);

    const importedEntry = indexed.get(imported.node.path);
    expect(importedEntry).toBeDefined();
    expect(importedEntry?.isImported).toBe(true);
    expect(importedEntry?.cfn).toBeUndefined();
    expect(importedEntry?.node).toBe(imported);
  });

  it('discovers the full mixed set: owned + imported (Req 1.2)', () => {
    const stack = createTestStack('MixedStack');
    createTestLambda(stack, 'Alpha');
    createTestLambda(stack, 'Beta');
    LambdaFunction.fromFunctionArn(
      stack,
      'ImportedByArn',
      'arn:aws:lambda:us-east-1:123456789012:function:imported-fn',
    );

    const discovered = discoverLambdas(stack);

    expect(discovered.filter((d) => !d.isImported)).toHaveLength(2);
    expect(discovered.filter((d) => d.isImported)).toHaveLength(1);
    expect(discovered).toHaveLength(3);
  });
});

describe('discoverLambdas — no double-counting of qualified functions (Req 1.2)', () => {
  it('excludes Version/Alias support constructs that also extend FunctionBase', () => {
    const stack = createTestStack('VersionedStack');
    const fn = createTestLambda(stack, 'VersionedFunction');

    // currentVersion + an alias both create QualifiedFunctionBase constructs in
    // the tree; a single base function must still be discovered exactly once.
    fn.addAlias('live');

    const discovered = discoverLambdas(stack);
    const owned = discovered.filter((d) => !d.isImported);

    expect(owned).toHaveLength(1);
    expect(owned[0]?.constructPath).toBe(fn.node.path);
    expect(owned[0]?.cfn).toBe(fn.node.defaultChild as CfnFunction);
  });
});

describe('discoverLambdas — determinism (Req 1.2)', () => {
  it('returns the same construct paths across repeated traversals of one stack', () => {
    const stack = createTestStack('DeterministicStack');
    createTestLambda(stack, 'One');
    createTestLambda(stack, 'Two');

    const first = discoverLambdas(stack).map((d) => d.constructPath);
    const second = discoverLambdas(stack).map((d) => d.constructPath);

    expect(second).toEqual(first);
  });
});

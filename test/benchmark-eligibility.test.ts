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
 * Table-driven unit tests for the EligibilityClassifier (Layer B, Requirement 5).
 *
 * Each test exercises exactly one branch of the design decision table
 * (design.md §EligibilityClassifier) using real CDK constructs fed through
 * {@link discoverLambdas}, so the L1/L2 inputs the classifier reads are the
 * genuine synthesized shapes a user would produce:
 *
 * | Branch                              | Expected eligibility        | Reason code                 |
 * | ----------------------------------- | --------------------------- | --------------------------- |
 * | imported-by-ARN                     | unsupported                 | imported-by-arn             |
 * | container image (PackageType:Image) | unsupported                 | container-image             |
 * | role scoped to function name        | cloneable-with-warnings     | role-scoped-to-name         |
 * | role scoped to log group            | cloneable-with-warnings     | role-scoped-to-loggroup     |
 * | existing version / alias            | cloneable-with-warnings     | existing-version-or-alias   |
 * | provisioned concurrency             | cloneable-with-warnings     | provisioned-concurrency     |
 * | unsupported runtime (python/go/…)   | unsupported                 | unsupported-runtime         |
 * | unreadable runtime token            | cloneable-with-warnings     | unreadable-token            |
 * | plain Node.js zip function          | cloneable                   | (none)                      |
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 4.6, 14.6**
 *
 * @module benchmark-eligibility.test
 */

import { App, Lazy, Stack } from 'aws-cdk-lib';
import {
  Architecture,
  CfnFunction,
  Code,
  Function as LambdaFunction,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import {
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';

import { discoverLambdas, type DiscoveredLambda } from '../src/benchmark/discovery';
import {
  classify,
  type Eligibility,
  type EligibilityReason,
} from '../src/benchmark/eligibility';

const TEST_ENV = { account: '123456789012', region: 'us-east-1' };
const ALL_ELIGIBILITIES: ReadonlyArray<Eligibility> = [
  'cloneable',
  'cloneable-with-warnings',
  'unsupported',
];

/** Create an isolated App + Stack for a single test case. */
function createStack(id = 'EligibilityStack'): Stack {
  return new Stack(new App(), id, { env: TEST_ENV });
}

/** Create a minimal, synthesizable Node.js zip Lambda. */
function createNodeLambda(
  scope: Stack,
  id: string,
  props: Partial<{ functionName: string; role: Role }> = {},
): LambdaFunction {
  return new LambdaFunction(scope, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
    ...props,
  });
}

/** Discover the single owned Lambda whose construct path matches `node.path`. */
function discoverOne(scope: Stack, fn: LambdaFunction): DiscoveredLambda {
  const match = discoverLambdas(scope).find((d) => d.constructPath === fn.node.path);
  if (!match) {
    throw new Error(`fixture function ${fn.node.path} was not discovered`);
  }
  return match;
}

/** Extract the set of reason codes from a classification result. */
function codesOf(reasons: ReadonlyArray<EligibilityReason>): Set<EligibilityReason['code']> {
  return new Set(reasons.map((r) => r.code));
}

describe('classify — imported-by-ARN (Req 5.2)', () => {
  it('classifies an imported-by-ARN function as unsupported with imported-by-arn reason', () => {
    const stack = createStack('ImportedStack');
    const imported = LambdaFunction.fromFunctionArn(
      stack,
      'Imported',
      'arn:aws:lambda:us-east-1:123456789012:function:legacy-payments',
    );

    const discovered = discoverLambdas(stack).find(
      (d) => d.constructPath === imported.node.path,
    );
    expect(discovered).toBeDefined();

    const result = classify(discovered as DiscoveredLambda);

    expect(result.eligibility).toBe('unsupported');
    expect(codesOf(result.reasons)).toEqual(new Set(['imported-by-arn']));
    // Reasons are machine + human readable (Req 5.7).
    expect(result.reasons[0]?.message.length).toBeGreaterThan(0);
  });
});

describe('classify — container image package type (Req 5.3)', () => {
  it('classifies a PackageType:Image function as unsupported with container-image reason', () => {
    const stack = createStack('ImageStack');
    const fn = createNodeLambda(stack, 'ImageFn');
    // Force the synthesized L1 to look like a container-image function.
    const cfn = fn.node.defaultChild as CfnFunction;
    cfn.packageType = 'Image';

    const result = classify(discoverOne(stack, fn));

    expect(result.eligibility).toBe('unsupported');
    expect(codesOf(result.reasons).has('container-image')).toBe(true);
  });
});

describe('classify — role scoped to function name / log group (Req 5.4, 14.6)', () => {
  it('records role-scoped-to-name when an inline policy references the function ARN', () => {
    const stack = createStack('RoleNameStack');
    const role = new Role(stack, 'ScopedRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        scoped: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['lambda:InvokeFunction'],
              resources: ['arn:aws:lambda:us-east-1:123456789012:function:orders-fn'],
            }),
          ],
        }),
      },
    });
    const fn = createNodeLambda(stack, 'OrdersFn', { functionName: 'orders-fn', role });

    const result = classify(discoverOne(stack, fn));

    expect(result.eligibility).toBe('cloneable-with-warnings');
    expect(codesOf(result.reasons).has('role-scoped-to-name')).toBe(true);
  });

  it('records role-scoped-to-loggroup when an inline policy references the function log group', () => {
    const stack = createStack('RoleLogStack');
    const role = new Role(stack, 'ScopedRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        scoped: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
              resources: [
                'arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/orders-fn:*',
              ],
            }),
          ],
        }),
      },
    });
    const fn = createNodeLambda(stack, 'OrdersFn', { functionName: 'orders-fn', role });

    const result = classify(discoverOne(stack, fn));

    expect(result.eligibility).toBe('cloneable-with-warnings');
    expect(codesOf(result.reasons).has('role-scoped-to-loggroup')).toBe(true);
  });

  it('does NOT fabricate a role-scoping warning for an unscoped role', () => {
    const stack = createStack('UnscopedRoleStack');
    const role = new Role(stack, 'BroadRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        broad: new PolicyDocument({
          statements: [
            new PolicyStatement({ actions: ['s3:GetObject'], resources: ['*'] }),
          ],
        }),
      },
    });
    const fn = createNodeLambda(stack, 'BroadFn', { functionName: 'broad-fn', role });

    const result = classify(discoverOne(stack, fn));

    expect(codesOf(result.reasons).has('role-scoped-to-name')).toBe(false);
    expect(codesOf(result.reasons).has('role-scoped-to-loggroup')).toBe(false);
    expect(result.eligibility).toBe('cloneable');
  });
});

describe('classify — existing version / alias / provisioned concurrency (Req 5.5)', () => {
  it('records existing-version-or-alias when the function has an alias', () => {
    const stack = createStack('AliasStack');
    const fn = createNodeLambda(stack, 'AliasedFn');
    fn.addAlias('live');

    const result = classify(discoverOne(stack, fn));

    expect(result.eligibility).toBe('cloneable-with-warnings');
    expect(codesOf(result.reasons).has('existing-version-or-alias')).toBe(true);
  });

  it('records provisioned-concurrency when an alias declares provisioned concurrency', () => {
    const stack = createStack('PcStack');
    const fn = createNodeLambda(stack, 'PcFn');
    fn.addAlias('live', { provisionedConcurrentExecutions: 5 });

    const result = classify(discoverOne(stack, fn));

    expect(result.eligibility).toBe('cloneable-with-warnings');
    const codes = codesOf(result.reasons);
    expect(codes.has('provisioned-concurrency')).toBe(true);
    expect(codes.has('existing-version-or-alias')).toBe(true);
  });
});

describe('classify — unsupported runtime (Req 5.6)', () => {
  // The classifier reads the synthesized L1 `runtime` string, so the most
  // honest fixture overrides the L1 runtime directly. (Several non-Node
  // runtimes — e.g. provided.al2, java — reject inline code at synth, so we
  // do not build them as L2 constructs.)
  it.each(['python3.12', 'go1.x', 'java21', 'ruby3.3', 'dotnet8'])(
    'classifies %s as unsupported with unsupported-runtime reason',
    (runtimeName) => {
      const stack = createStack(`Runtime${runtimeName.replace(/[^a-zA-Z0-9]/g, '')}Stack`);
      const fn = createNodeLambda(stack, 'NonNodeFn');
      (fn.node.defaultChild as CfnFunction).runtime = runtimeName;

      const result = classify(discoverOne(stack, fn));

      expect(result.eligibility).toBe('unsupported');
      expect(codesOf(result.reasons).has('unsupported-runtime')).toBe(true);
    },
  );

  it.each(['nodejs18.x', 'nodejs20.x', 'nodejs22.x'])(
    'treats supported Node.js runtime %s as cloneable',
    (runtimeName) => {
      const stack = createStack(`Supported${runtimeName.replace(/[^a-zA-Z0-9]/g, '')}Stack`);
      const fn = createNodeLambda(stack, 'NodeFn');
      (fn.node.defaultChild as CfnFunction).runtime = runtimeName;

      const result = classify(discoverOne(stack, fn));

      expect(result.eligibility).toBe('cloneable');
      expect(result.reasons).toHaveLength(0);
    },
  );
});

describe('classify — unreadable token on required prop (Req 4.6)', () => {
  it('records unreadable-token and keeps the Lambda cloneable-with-warnings when runtime is a token', () => {
    const stack = createStack('TokenRuntimeStack');
    const fn = createNodeLambda(stack, 'TokenFn');
    const cfn = fn.node.defaultChild as CfnFunction;
    cfn.runtime = Lazy.string({ produce: () => 'nodejs20.x' });

    const result = classify(discoverOne(stack, fn));

    expect(result.eligibility).toBe('cloneable-with-warnings');
    expect(codesOf(result.reasons).has('unreadable-token')).toBe(true);
  });
});

describe('classify — plain cloneable Node.js function (otherwise rule)', () => {
  it('classifies a vanilla Node.js zip function as cloneable with no reasons', () => {
    const stack = createStack('CloneableStack');
    const fn = createNodeLambda(stack, 'PlainFn');
    fn.node.defaultChild as CfnFunction; // ensure synthesized

    const result = classify(discoverOne(stack, fn));

    expect(result.eligibility).toBe('cloneable');
    expect(result.reasons).toHaveLength(0);
  });

  it('preserves an explicit architecture without affecting eligibility', () => {
    const stack = createStack('ArmStack');
    const fn = createNodeLambda(stack, 'ArmFn');
    (fn.node.defaultChild as CfnFunction).architectures = [Architecture.ARM_64.name];

    const result = classify(discoverOne(stack, fn));

    expect(result.eligibility).toBe('cloneable');
  });
});

describe('classify — precedence and aggregation (Req 5.1, design precedence)', () => {
  it('aggregates ALL applicable reasons and picks the most severe (unsupported) classification', () => {
    const stack = createStack('PrecedenceStack');
    // A function that is BOTH a non-Node runtime (unsupported) AND has an alias
    // (warning). Override the L1 runtime so we can keep an alias on a real,
    // synthesizable Node.js L2 construct.
    const fn = createNodeLambda(stack, 'MixedFn');
    fn.addAlias('live');
    (fn.node.defaultChild as CfnFunction).runtime = 'python3.12';

    const result = classify(discoverOne(stack, fn));

    const codes = codesOf(result.reasons);
    expect(codes.has('unsupported-runtime')).toBe(true);
    expect(codes.has('existing-version-or-alias')).toBe(true);
    // Most severe wins: any unsupported condition => unsupported.
    expect(result.eligibility).toBe('unsupported');
  });
});

describe('classify — exactly-one classification invariant (Property 6, Req 5.1)', () => {
  it('always returns exactly one of the three valid classifications', () => {
    const stack = createStack('InvariantStack');
    const fns = [
      createNodeLambda(stack, 'A'),
      createNodeLambda(stack, 'B', { functionName: 'b-fn' }),
    ];
    fns[1]?.addAlias('live');

    for (const fn of fns) {
      const result = classify(discoverOne(stack, fn));
      expect(ALL_ELIGIBILITIES).toContain(result.eligibility);
      expect(ALL_ELIGIBILITIES.filter((e) => e === result.eligibility)).toHaveLength(1);
    }
  });
});

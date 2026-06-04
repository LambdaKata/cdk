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
 * Property-Based Test for the EligibilityClassifier — Property 6.
 *
 * Property 6 (Exactly-one classification): for EVERY discovered Lambda, the
 * classifier assigns exactly one {@link Eligibility} of `cloneable`,
 * `cloneable-with-warnings`, or `unsupported`, and the chosen value respects
 * the documented precedence (unsupported > cloneable-with-warnings >
 * cloneable) given the reasons that were recorded.
 *
 * The generator builds `DiscoveredLambda`-like inputs directly (the classifier
 * is a pure function over that contract), spanning the full decision-table
 * input space — imported vs owned, image vs zip, supported vs unsupported vs
 * token runtimes, scoped vs broad roles, and the presence of versions/aliases
 * /provisioned concurrency — so the invariant is proven across the space rather
 * than for the hand-picked unit examples.
 *
 * **Validates: Requirements 5.1**
 *
 * @module benchmark-eligibility.property.test
 */

import * as fc from 'fast-check';
import { App, Lazy, Stack } from 'aws-cdk-lib';
import {
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
import { classify, type Eligibility } from '../src/benchmark/eligibility';

const TEST_ENV = { account: '123456789012', region: 'us-east-1' };
const VALID_ELIGIBILITIES: ReadonlyArray<Eligibility> = [
  'cloneable',
  'cloneable-with-warnings',
  'unsupported',
];

/** Severity rank used to assert precedence (higher = more severe). */
const SEVERITY: Record<Eligibility, number> = {
  cloneable: 0,
  'cloneable-with-warnings': 1,
  unsupported: 2,
};

/** Reason codes that, when present, must force an `unsupported` classification. */
const UNSUPPORTED_CODES = new Set(['imported-by-arn', 'container-image', 'unsupported-runtime']);

/** A declarative description of a Lambda fixture to synthesize. */
interface FixtureSpec {
  readonly imported: boolean;
  readonly image: boolean;
  readonly runtime: 'supported' | 'unsupported' | 'token';
  readonly scopedRole: boolean;
  readonly alias: boolean;
  readonly provisionedConcurrency: boolean;
}

const fixtureSpecArb: fc.Arbitrary<FixtureSpec> = fc.record({
  imported: fc.boolean(),
  image: fc.boolean(),
  runtime: fc.constantFrom('supported', 'unsupported', 'token'),
  scopedRole: fc.boolean(),
  alias: fc.boolean(),
  provisionedConcurrency: fc.boolean(),
});

/** Build a discovered Lambda from a spec inside a throwaway stack. */
function buildDiscovered(spec: FixtureSpec, index: number): DiscoveredLambda {
  const stack = new Stack(new App(), `PropStack${index}`, { env: TEST_ENV });
  const id = `Fn${index}`;

  if (spec.imported) {
    const imported = LambdaFunction.fromFunctionArn(
      stack,
      id,
      `arn:aws:lambda:us-east-1:123456789012:function:imported-${index}`,
    );
    const found = discoverLambdas(stack).find((d) => d.constructPath === imported.node.path);
    if (!found) {
      throw new Error('imported fixture not discovered');
    }
    return found;
  }

  const functionName = `prop-fn-${index}`;
  const role = spec.scopedRole
    ? new Role(stack, 'ScopedRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        scoped: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['lambda:InvokeFunction'],
              resources: [`arn:aws:lambda:us-east-1:123456789012:function:${functionName}`],
            }),
          ],
        }),
      },
    })
    : undefined;

  const supportedRuntime = Runtime.NODEJS_20_X;
  const unsupportedRuntime = Runtime.PYTHON_3_12;
  const fn = new LambdaFunction(stack, id, {
    runtime: spec.runtime === 'unsupported' ? unsupportedRuntime : supportedRuntime,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => ({});'),
    functionName,
    ...(role ? { role } : {}),
  });

  const cfn = fn.node.defaultChild as CfnFunction;
  if (spec.image) {
    cfn.packageType = 'Image';
  }
  if (spec.runtime === 'token') {
    cfn.runtime = Lazy.string({ produce: () => 'nodejs20.x' });
  }
  if (spec.alias || spec.provisionedConcurrency) {
    fn.addAlias('live', spec.provisionedConcurrency ? { provisionedConcurrentExecutions: 3 } : {});
  }

  const found = discoverLambdas(stack).find((d) => d.constructPath === fn.node.path);
  if (!found) {
    throw new Error('owned fixture not discovered');
  }
  return found;
}

describe('EligibilityClassifier — Property 6 (exactly-one classification)', () => {
  /**
   * **Validates: Requirements 5.1**
   *
   * For any generated input, the result is always exactly one of the three
   * valid classifications.
   */
  it('always assigns exactly one valid Eligibility', () => {
    fc.assert(
      fc.property(fixtureSpecArb, (spec) => {
        const discovered = buildDiscovered(spec, 1);
        const result = classify(discovered);

        const matches = VALID_ELIGIBILITIES.filter((e) => e === result.eligibility);
        return matches.length === 1;
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.1**
   *
   * Precedence: any recorded unsupported-level reason forces `unsupported`;
   * otherwise any recorded warning-level reason forces
   * `cloneable-with-warnings`; otherwise `cloneable`. The chosen eligibility is
   * always the most severe implied by its reasons.
   */
  it('respects precedence (unsupported > cloneable-with-warnings > cloneable)', () => {
    fc.assert(
      fc.property(fixtureSpecArb, (spec) => {
        const discovered = buildDiscovered(spec, 2);
        const result = classify(discovered);

        const hasUnsupported = result.reasons.some((r) => UNSUPPORTED_CODES.has(r.code));
        const hasAnyReason = result.reasons.length > 0;

        const expected: Eligibility = hasUnsupported
          ? 'unsupported'
          : hasAnyReason
            ? 'cloneable-with-warnings'
            : 'cloneable';

        // The recorded reasons must justify the chosen eligibility's severity.
        return SEVERITY[result.eligibility] === SEVERITY[expected];
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.7**
   *
   * Every recorded reason is machine + human readable: a stable `code` and a
   * non-empty `message`.
   */
  it('records reasons that are both machine- and human-readable', () => {
    fc.assert(
      fc.property(fixtureSpecArb, (spec) => {
        const discovered = buildDiscovered(spec, 3);
        const result = classify(discovered);

        return result.reasons.every(
          (r) => typeof r.code === 'string' && r.code.length > 0 && r.message.trim().length > 0,
        );
      }),
      { numRuns: 200 },
    );
  });
});

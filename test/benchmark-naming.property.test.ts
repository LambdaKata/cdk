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
 * Property-Based Tests for the NamingResolver (Layer B, Requirement 6).
 *
 * These properties pin the four invariants the clone-naming subsystem must hold
 * for EVERY input, not just the hand-picked examples in the unit suite:
 *
 * - Property A — Length bound: every resolved name is ALWAYS at most 64 chars.
 * - Property B — Charset: every resolved name ALWAYS matches the AWS Lambda
 *   function-name set `[a-zA-Z0-9-_]`.
 * - Property C — Determinism: the same `(baselineName, suffix, identity)` always
 *   yields the same name, so repeated synthesis of the same stack is stable.
 * - Property D — Uniqueness: across a generated set of distinct baseline
 *   identities, a single stack-scoped resolver never produces two colliding
 *   clone names.
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
 *
 * @module benchmark-naming.property.test
 */

import * as fc from 'fast-check';

import {
  MAX_LAMBDA_FUNCTION_NAME_LENGTH,
  NamingResolver,
  resolveCloneName,
} from '../src/benchmark/naming';

/** The AWS Lambda function-name charset, anchored for a full-string match (Req 6.5). */
const LAMBDA_NAME_CHARSET = /^[a-zA-Z0-9_-]+$/;

/**
 * Baseline function names: a mix of ordinary ASCII, full-unicode (to stress
 * charset sanitisation), and very long values (to stress length-safe hashing).
 */
const baselineNameArb = (): fc.Arbitrary<string> =>
  fc.oneof(
    fc.string({ maxLength: 200 }),
    fc.fullUnicodeString({ maxLength: 80 }),
    fc.constantFrom(
      'orders',
      'CheckoutHandler',
      'a'.repeat(64),
      'a'.repeat(120),
      'My-Function_Name',
    ),
  );

/**
 * Kata suffixes: the documented `kata` default plus arbitrary strings,
 * including empty and pathologically long suffixes that on their own would blow
 * the 64-char budget.
 */
const suffixArb = (): fc.Arbitrary<string> =>
  fc.oneof(fc.constant('kata'), fc.string({ maxLength: 80 }), fc.fullUnicodeString({ maxLength: 40 }));

/** Baseline construct identities (`node.path`-like seeds for the tail hash). */
const identityArb = (): fc.Arbitrary<string> =>
  fc.oneof(
    fc.string({ minLength: 1, maxLength: 120 }),
    fc.fullUnicodeString({ minLength: 1, maxLength: 120 }),
  );

describe('NamingResolver — property invariants (Requirement 6)', () => {
  /**
   * **Validates: Requirements 6.1, 6.2, 6.5**
   *
   * Property A — Length bound: for any baseline name, suffix, and identity, the
   * resolved clone name is ALWAYS at most the 64-character AWS limit.
   */
  it('Property A: output is always <= 64 characters', () => {
    fc.assert(
      fc.property(baselineNameArb(), suffixArb(), identityArb(), (baselineName, suffix, identity) => {
        const name = resolveCloneName(baselineName, suffix, identity);
        return name.length <= MAX_LAMBDA_FUNCTION_NAME_LENGTH;
      }),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * Property B — Charset: every resolved clone name contains only characters
   * from the AWS Lambda function-name set `[a-zA-Z0-9-_]`, even when the inputs
   * contain unicode, whitespace, or other out-of-set characters.
   */
  it('Property B: charset is always valid ([a-zA-Z0-9-_])', () => {
    fc.assert(
      fc.property(baselineNameArb(), suffixArb(), identityArb(), (baselineName, suffix, identity) => {
        const name = resolveCloneName(baselineName, suffix, identity);
        return LAMBDA_NAME_CHARSET.test(name);
      }),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * Property C — Determinism: resolving the same `(baselineName, suffix,
   * identity)` triple any number of times yields the identical name, so
   * repeated synthesis of the same stack produces the same clone name.
   */
  it('Property C: deterministic for the same identity', () => {
    fc.assert(
      fc.property(baselineNameArb(), suffixArb(), identityArb(), (baselineName, suffix, identity) => {
        const first = resolveCloneName(baselineName, suffix, identity);
        const second = resolveCloneName(baselineName, suffix, identity);
        const third = resolveCloneName(baselineName, suffix, identity);
        return first === second && second === third;
      }),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * Property C (stack scope) — Determinism at the stack level: feeding the same
   * ordered sequence of baselines to two independent fresh resolvers yields the
   * identical sequence of names. This is what makes a second `cdk synth`
   * reproduce the prior names exactly.
   */
  it('Property C: stack-scoped resolution is reproducible across fresh resolvers', () => {
    const sequenceArb = fc.array(
      fc.record({ baselineName: baselineNameArb(), identity: identityArb() }),
      { minLength: 1, maxLength: 30 },
    );

    fc.assert(
      fc.property(sequenceArb, (sequence) => {
        const runOnce = (): string[] => {
          const resolver = new NamingResolver();
          return sequence.map((entry) => resolver.resolve(entry.baselineName, entry.identity));
        };

        const first = runOnce();
        const second = runOnce();
        return JSON.stringify(first) === JSON.stringify(second);
      }),
      { numRuns: 150 },
    );
  });

  /**
   * **Validates: Requirements 6.3, 6.1, 6.2, 6.5**
   *
   * Property D — Uniqueness: across a generated set of baselines with DISTINCT
   * identities (as every construct in a stack has a distinct `node.path`), a
   * single stack-scoped resolver never produces two colliding clone names — and
   * every produced name still respects the length and charset invariants.
   */
  it('Property D: clone names are unique within a stack-scoped set', () => {
    const distinctByIdentity = fc.uniqueArray(
      fc.record({ baselineName: baselineNameArb(), identity: identityArb() }),
      { selector: (entry) => entry.identity, minLength: 1, maxLength: 40 },
    );

    fc.assert(
      fc.property(distinctByIdentity, (entries) => {
        const resolver = new NamingResolver();
        const names = entries.map((entry) => resolver.resolve(entry.baselineName, entry.identity));

        const allUnique = new Set(names).size === names.length;
        const allBounded = names.every((name) => name.length <= MAX_LAMBDA_FUNCTION_NAME_LENGTH);
        const allValidCharset = names.every((name) => LAMBDA_NAME_CHARSET.test(name));

        return allUnique && allBounded && allValidCharset && resolver.size === names.length;
      }),
      { numRuns: 150 },
    );
  });
});

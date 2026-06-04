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
 * Unit tests for the NamingResolver (Layer B, Requirement 6).
 *
 * These pin the concrete, example-level behaviour that the property suite
 * proves universally: the readable short-name path, the >64-char deterministic
 * hashing path, charset sanitisation, and the stack-scoped collision-extension
 * path.
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
 *
 * @module benchmark-naming.test
 */

import { createHash } from 'crypto';

import {
  DEFAULT_CLONE_NAME_HASH_LENGTH,
  DEFAULT_CLONE_NAME_SUFFIX,
  MAX_LAMBDA_FUNCTION_NAME_LENGTH,
  NamingResolver,
  resolveCloneName,
} from '../src/benchmark/naming';

const LAMBDA_NAME_CHARSET = /^[a-zA-Z0-9_-]+$/;

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

describe('resolveCloneName — readable short-name path (Req 6.1)', () => {
  /**
   * **Validates: Requirements 6.1**
   *
   * A short baseline name simply gets the `-${suffix}` appended verbatim.
   */
  it('appends "-<suffix>" when the result fits within 64 characters', () => {
    expect(resolveCloneName('orders', 'kata', 'Stack/Orders')).toBe('orders-kata');
  });

  it('uses the documented default suffix value', () => {
    expect(DEFAULT_CLONE_NAME_SUFFIX).toBe('kata');
    expect(resolveCloneName('checkout', DEFAULT_CLONE_NAME_SUFFIX, 'Stack/Checkout')).toBe(
      'checkout-kata',
    );
  });

  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * A baseline exactly on the boundary (`name-kata` === 64 chars) stays in the
   * readable form; one character longer crosses into the hashed form.
   */
  it('keeps the readable form at exactly 64 characters', () => {
    const base = 'a'.repeat(MAX_LAMBDA_FUNCTION_NAME_LENGTH - '-kata'.length); // 59
    const name = resolveCloneName(base, 'kata', 'Stack/Boundary');
    expect(name).toBe(`${base}-kata`);
    expect(name.length).toBe(MAX_LAMBDA_FUNCTION_NAME_LENGTH);
  });
});

describe('resolveCloneName — length-safe hashing path (Req 6.2, 6.4)', () => {
  /**
   * **Validates: Requirements 6.2, 6.4**
   *
   * When `name-suffix` would exceed 64 chars, the resolver keeps a readable
   * prefix and appends a deterministic sha256-derived tail of the documented
   * default length, producing `${prefix}-${hash}-${suffix}` at exactly the
   * 64-char limit.
   */
  it('builds prefix-hash-suffix and stays within 64 characters', () => {
    const base = 'a'.repeat(120);
    const identity = 'Stack/VeryLongFunctionConstructPath';
    const name = resolveCloneName(base, 'kata', identity);

    expect(name.length).toBeLessThanOrEqual(MAX_LAMBDA_FUNCTION_NAME_LENGTH);
    expect(LAMBDA_NAME_CHARSET.test(name)).toBe(true);

    const expectedHash = sha256Hex(identity).slice(0, DEFAULT_CLONE_NAME_HASH_LENGTH);
    expect(name.endsWith(`-${expectedHash}-kata`)).toBe(true);
    expect(name.startsWith('a')).toBe(true);
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * The hash is derived purely from the identity: same identity → same name;
   * different identity → different tail (so repeated synth is stable but
   * distinct constructs diverge).
   */
  it('derives the tail hash deterministically from the identity', () => {
    const base = 'b'.repeat(100);

    const a1 = resolveCloneName(base, 'kata', 'Stack/Alpha');
    const a2 = resolveCloneName(base, 'kata', 'Stack/Alpha');
    const b1 = resolveCloneName(base, 'kata', 'Stack/Beta');

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b1);
  });
});

describe('resolveCloneName — charset sanitisation (Req 6.5)', () => {
  /**
   * **Validates: Requirements 6.5**
   *
   * Out-of-set characters in the baseline name and suffix are replaced so the
   * output only ever contains `[a-zA-Z0-9-_]`.
   */
  it('replaces characters outside the AWS Lambda name charset', () => {
    const name = resolveCloneName('my func.name$', 'ka ta', 'Stack/Weird');
    expect(LAMBDA_NAME_CHARSET.test(name)).toBe(true);
    expect(name).toBe('my_func_name_-ka_ta');
  });

  it('produces a valid name even for an all-unicode baseline', () => {
    const name = resolveCloneName('日本語関数', 'kata', 'Stack/Unicode');
    expect(LAMBDA_NAME_CHARSET.test(name)).toBe(true);
    expect(name.endsWith('-kata')).toBe(true);
  });
});

describe('NamingResolver — stack-scoped collision resolution (Req 6.3)', () => {
  /**
   * **Validates: Requirements 6.3, 6.4**
   *
   * Distinct identities that share the same baseline name must not collide: the
   * first takes the readable name, subsequent ones fall back to the hashed form
   * and extend the hash length until unique.
   */
  it('resolves collisions for identical baseline names with distinct identities', () => {
    const resolver = new NamingResolver();

    const first = resolver.resolve('worker', 'Stack/WorkerA');
    const second = resolver.resolve('worker', 'Stack/WorkerB');
    const third = resolver.resolve('worker', 'Stack/WorkerC');

    const names = [first, second, third];
    expect(new Set(names).size).toBe(3);
    expect(first).toBe('worker-kata');
    names.forEach((name) => {
      expect(name.length).toBeLessThanOrEqual(MAX_LAMBDA_FUNCTION_NAME_LENGTH);
      expect(LAMBDA_NAME_CHARSET.test(name)).toBe(true);
    });
    expect(resolver.size).toBe(3);
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * The collision path extends the hash so the long-name (already-hashed) form
   * also stays unique across distinct identities.
   */
  it('keeps long (hashed) names unique across distinct identities', () => {
    const resolver = new NamingResolver();
    const base = 'z'.repeat(120);

    const names = ['Stack/One', 'Stack/Two', 'Stack/Three', 'Stack/Four'].map((identity) =>
      resolver.resolve(base, identity),
    );

    expect(new Set(names).size).toBe(names.length);
    names.forEach((name) => {
      expect(name.length).toBeLessThanOrEqual(MAX_LAMBDA_FUNCTION_NAME_LENGTH);
      expect(LAMBDA_NAME_CHARSET.test(name)).toBe(true);
    });
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * `has`/`size` reflect the handed-out set, and even under caller misuse
   * (resolving the same `(baselineName, identity)` twice) the resolver never
   * hands out a duplicate: the second call falls through to the hashed form and
   * yields a distinct, still-bounded, still-valid name.
   */
  it('never returns a duplicate, even when the same inputs are resolved twice', () => {
    const resolver = new NamingResolver();

    const first = resolver.resolve('orders', 'Stack/Orders');
    expect(resolver.has(first)).toBe(true);
    expect(resolver.size).toBe(1);

    const second = resolver.resolve('orders', 'Stack/Orders');
    expect(second).not.toBe(first);
    expect(second.length).toBeLessThanOrEqual(MAX_LAMBDA_FUNCTION_NAME_LENGTH);
    expect(LAMBDA_NAME_CHARSET.test(second)).toBe(true);
    expect(resolver.size).toBe(2);
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * A custom suffix is honoured and sanitised by the resolver.
   */
  it('honours a custom suffix', () => {
    const resolver = new NamingResolver({ suffix: 'bench' });
    expect(resolver.resolve('orders', 'Stack/Orders')).toBe('orders-bench');
  });
});

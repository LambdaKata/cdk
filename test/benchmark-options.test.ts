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
 * Unit tests for the Benchmark Harness typed options surface and its
 * conservative-by-default resolver.
 *
 * These tests pin the documented conservative defaults so that any future
 * change to the safety posture is an explicit, reviewed decision rather than an
 * accidental regression.
 *
 * **Validates: Requirements 1.6, 11.6, 11.7, 12.1, 12.7, 13.1, 13.2, 14.1, 14.2**
 *
 * @module benchmark-options.test
 */

import {
  DEFAULT_EXTERNAL_RESOURCE_DISPOSITION,
  DEFAULT_FIDELITY_LEVEL,
  DEFAULT_NAME_SUFFIX,
  DEFAULT_OWNERSHIP_TAG_KEY,
  DEFAULT_ROLE_MODE,
  DEFAULT_SIDE_EFFECT_POLICY,
  DEFAULT_TARGET_SELECTOR,
  FidelityLevel,
  resolveKataBenchOptions,
  type KataBenchOptions,
  type ResolvedKataBenchOptions,
} from '../src/benchmark/options';

describe('Benchmark options — conservative default resolver', () => {
  /**
   * **Validates: Requirements 12.1, 12.7, 13.1, 13.2, 14.1, 14.2, 11.6, 11.7**
   *
   * The harness must be safe-by-default: most conservative fidelity (L0),
   * the most restrictive side-effect posture (unsafe), the least-surprising
   * role handling (reuse-role), and a hard block on external-resource
   * findings.
   */
  describe('resolveKataBenchOptions() with no input', () => {
    const cases: Array<[string, () => ResolvedKataBenchOptions]> = [
      ['called with undefined', () => resolveKataBenchOptions()],
      ['called with an empty object', () => resolveKataBenchOptions({})],
    ];

    it.each(cases)('returns the documented conservative defaults when %s', (_label, invoke) => {
      const resolved = invoke();

      // Fidelity L0 — most conservative measurement realism (Req 12.1, 12.7).
      expect(resolved.fidelity).toBe(FidelityLevel.L0);
      expect(resolved.fidelity).toBe(DEFAULT_FIDELITY_LEVEL);

      // Side-effect policy 'unsafe' — blocks parallel fan-out by default (Req 13.1, 13.2).
      expect(resolved.sideEffectPolicy).toBe('unsafe');
      expect(resolved.sideEffectPolicy).toBe(DEFAULT_SIDE_EFFECT_POLICY);

      // Role mode 'reuse-role' — clone uses the baseline execution role (Req 14.1, 14.2).
      expect(resolved.roleMode).toBe('reuse-role');
      expect(resolved.roleMode).toBe(DEFAULT_ROLE_MODE);

      // External-resource disposition 'block' — default-deny (Req 11.6, 11.7).
      expect(resolved.externalResourceDisposition).toBe('block');
      expect(resolved.externalResourceDisposition).toBe(DEFAULT_EXTERNAL_RESOURCE_DISPOSITION);

      // Naming + lifecycle defaults are visible and intentional.
      expect(resolved.nameSuffix).toBe('kata');
      expect(resolved.nameSuffix).toBe(DEFAULT_NAME_SUFFIX);
      expect(resolved.lifecycle.ownershipTagKey).toBe('lambda-kata:bench-run-id');
      expect(resolved.lifecycle.ownershipTagKey).toBe(DEFAULT_OWNERSHIP_TAG_KEY);

      // Selection defaults to all cloneable Lambdas (Req 1.5).
      expect(resolved.targets).toEqual(DEFAULT_TARGET_SELECTOR);
      expect(resolved.targets).toEqual({ type: 'all' });

      // Collections default to empty, never undefined, for safe iteration.
      expect(resolved.acknowledgements).toEqual([]);
      expect(resolved.triggers).toEqual([]);

      // Unset guardrail ceilings remain absent (resolved later, at run-time).
      expect(resolved.lifecycle.maxRunDuration).toBeUndefined();
      expect(resolved.lifecycle.maxConcurrency).toBeUndefined();
      expect(resolved.lifecycle.maxCostUsd).toBeUndefined();
      expect(resolved.manifest).toBeUndefined();
    });

    it('produces an equivalent result for undefined and {}', () => {
      expect(resolveKataBenchOptions()).toEqual(resolveKataBenchOptions({}));
    });
  });

  /**
   * **Validates: Requirements 1.6, 12.1, 13.1, 14.1, 11.6**
   *
   * Explicit overrides must win over the defaults; the resolver only fills
   * holes, it never overrides caller intent.
   */
  describe('resolveKataBenchOptions() with explicit overrides', () => {
    it('honours every explicitly provided field', () => {
      const options: KataBenchOptions = {
        targets: { type: 'paths', constructPaths: ['Stack/Fn'] },
        fidelity: FidelityLevel.L3,
        sideEffectPolicy: 'idempotent',
        roleMode: 'provided-role',
        externalResourceDisposition: 'allow-with-explicit-ack',
        acknowledgements: [{ findingId: 'f-1', acknowledgedBy: 'tech-lead', reason: 'sandbox bus' }],
        triggers: [],
        nameSuffix: 'bench',
        lifecycle: { maxConcurrency: 4, ownershipTagKey: 'custom:tag' },
      };

      const resolved = resolveKataBenchOptions(options);

      expect(resolved.targets).toEqual({ type: 'paths', constructPaths: ['Stack/Fn'] });
      expect(resolved.fidelity).toBe(FidelityLevel.L3);
      expect(resolved.sideEffectPolicy).toBe('idempotent');
      expect(resolved.roleMode).toBe('provided-role');
      expect(resolved.externalResourceDisposition).toBe('allow-with-explicit-ack');
      expect(resolved.acknowledgements).toEqual([
        { findingId: 'f-1', acknowledgedBy: 'tech-lead', reason: 'sandbox bus' },
      ]);
      expect(resolved.nameSuffix).toBe('bench');
      expect(resolved.lifecycle.maxConcurrency).toBe(4);
      expect(resolved.lifecycle.ownershipTagKey).toBe('custom:tag');
    });

    /**
     * **Validates: Requirements 20.5**
     *
     * A cost ceiling of exactly 0 is a legitimate, explicit choice and must
     * be preserved (not coalesced away as if it were unset).
     */
    it('preserves an explicit maxCostUsd of 0', () => {
      const resolved = resolveKataBenchOptions({ lifecycle: { maxCostUsd: 0 } });

      expect(resolved.lifecycle.maxCostUsd).toBe(0);
      // Still applies the default ownership tag key for the unset field.
      expect(resolved.lifecycle.ownershipTagKey).toBe(DEFAULT_OWNERSHIP_TAG_KEY);
    });

    it('does not mutate the caller-provided options object', () => {
      const options: KataBenchOptions = {};
      const snapshot = JSON.stringify(options);

      resolveKataBenchOptions(options);

      expect(JSON.stringify(options)).toBe(snapshot);
    });
  });
});

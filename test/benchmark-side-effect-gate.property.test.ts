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
 * Property-Based Test for the Side_Effect_Policy_Gate — Property 12.
 *
 * Property 12 (Unsafe-policy blocks parallelism): while the
 * {@link SideEffectPolicy} is `unsafe`, no fan-out or shared-read source runs
 * both variants in parallel. The companion invariants pinned here are that a
 * competing source never runs in parallel under ANY policy, request-response is
 * always parallel-capable without gating, and the production-source attachment
 * is enabled only once a correlating acknowledgement is recorded.
 *
 * The generator spans the full policy × routing-class space plus the
 * production-source flag so the invariants are proven across the input space
 * rather than for the hand-picked unit cells.
 *
 * **Validates: Requirements 13.3, 13.4, 13.5**
 *
 * @module benchmark-side-effect-gate.property.test
 */

import * as fc from 'fast-check';

import {
  evaluateSideEffectGate,
  isParallelSafePolicy,
  SideEffectPolicyGate,
} from '../src/benchmark/side-effect-gate';
import type { SideEffectPolicy } from '../src/benchmark/options';
import type { RoutingClass } from '../src/benchmark/triggers/types';

const policyArb: fc.Arbitrary<SideEffectPolicy> = fc.constantFrom<SideEffectPolicy>(
  'read-only',
  'idempotent',
  'isolated-writes',
  'unsafe',
);

const routingClassArb: fc.Arbitrary<RoutingClass> = fc.constantFrom<RoutingClass>(
  'competing',
  'fan-out',
  'shared-read',
  'request-response',
);

describe('Side_Effect_Policy_Gate — Property 12 (unsafe blocks parallelism)', () => {
  /**
   * **Validates: Requirements 13.3**
   *
   * While the policy is `unsafe`, a fan-out or shared-read source is NEVER
   * permitted to run both variants in parallel, regardless of the
   * production-source flag.
   */
  it('never allows parallel fan-out / shared-read while policy is unsafe', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<RoutingClass>('fan-out', 'shared-read'),
        fc.boolean(),
        (routingClass, attachesToProductionSource) => {
          const decision = evaluateSideEffectGate('unsafe', routingClass, attachesToProductionSource);
          return decision.parallelAllowed === false;
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 13.4**
   *
   * For fan-out / shared-read sources, parallel is allowed exactly when the
   * policy is parallel-safe (read-only / idempotent / isolated-writes).
   */
  it('allows parallel fan-out / shared-read iff the policy is parallel-safe', () => {
    fc.assert(
      fc.property(
        policyArb,
        fc.constantFrom<RoutingClass>('fan-out', 'shared-read'),
        fc.boolean(),
        (policy, routingClass, attachesToProductionSource) => {
          const decision = evaluateSideEffectGate(policy, routingClass, attachesToProductionSource);
          return decision.parallelAllowed === isParallelSafePolicy(policy);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 13.3, 13.4**
   *
   * Competing sources are never parallel; request-response is always parallel,
   * independent of policy.
   */
  it('keeps competing exclusive and request-response parallel under every policy', () => {
    fc.assert(
      fc.property(policyArb, fc.boolean(), (policy, attachesToProductionSource) => {
        const competing = evaluateSideEffectGate(policy, 'competing', attachesToProductionSource);
        const reqResp = evaluateSideEffectGate(
          policy,
          'request-response',
          attachesToProductionSource,
        );
        return competing.parallelAllowed === false && reqResp.parallelAllowed === true;
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 13.5**
   *
   * A production-source attachment is enabled only when a correlating
   * acknowledgement has been recorded; an isolated source never requires one.
   */
  it('enables a production-source attachment only after a correlating acknowledgement', () => {
    fc.assert(
      fc.property(policyArb, routingClassArb, fc.boolean(), (policy, routingClass, acknowledge) => {
        const findingId = 'finding-prod-source';
        const gate = new SideEffectPolicyGate(
          policy,
          acknowledge ? [{ findingId }] : [],
        );

        const isolated = gate.evaluate({ routingClass, attachesToProductionSource: false });
        const production = gate.evaluate({
          routingClass,
          attachesToProductionSource: true,
          acknowledgementId: findingId,
        });

        // Isolated source: never gated on acknowledgement, always attachable.
        const isolatedOk =
          isolated.acknowledgementRequired === false && isolated.attachmentEnabled === true;

        // Production source: requires ack; attachment enabled iff acknowledged.
        const productionOk =
          production.acknowledgementRequired === true &&
          production.acknowledgementSatisfied === acknowledge &&
          production.attachmentEnabled === acknowledge;

        return isolatedOk && productionOk;
      }),
      { numRuns: 300 },
    );
  });
});

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
 * Table-driven unit tests for the Side_Effect_Policy_Gate (Layer C,
 * Requirement 13).
 *
 * The gate enforces the declared {@link SideEffectPolicy} before both variants
 * may run in parallel, and requires an explicit acknowledgement before a clone
 * may attach to a production event source. These tests exercise the FULL
 * policy × routing-class matrix (4 policies × 4 routing classes) mapping to
 * allow/block (Property 12), plus the production-source acknowledgement branch
 * with and without a recorded acknowledgement.
 *
 * Parallel-allow matrix (Req 13.3, 13.4 and the routing execution-intent
 * contract Req 8.7, 8.8):
 *
 * | policy \ class    | competing | fan-out | shared-read | request-response |
 * | ----------------- | --------- | ------- | ----------- | ---------------- |
 * | read-only         | block     | allow   | allow       | allow            |
 * | idempotent        | block     | allow   | allow       | allow            |
 * | isolated-writes   | block     | allow   | allow       | allow            |
 * | unsafe            | block     | block   | block       | allow            |
 *
 * **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6**
 *
 * @module benchmark-side-effect-gate.test
 */

import {
  evaluateSideEffectGate,
  SideEffectPolicyGate,
  isParallelSafePolicy,
  PARALLEL_SAFE_POLICIES,
} from '../src/benchmark/side-effect-gate';
import type { SideEffectPolicy } from '../src/benchmark/options';
import type { RoutingClass } from '../src/benchmark/triggers/types';

const ALL_POLICIES: ReadonlyArray<SideEffectPolicy> = [
  'read-only',
  'idempotent',
  'isolated-writes',
  'unsafe',
];

const ALL_ROUTING_CLASSES: ReadonlyArray<RoutingClass> = [
  'competing',
  'fan-out',
  'shared-read',
  'request-response',
];

/**
 * The authoritative expected `parallelAllowed` for every (policy, class) cell.
 * This is the matrix the task and Property 12 require the gate to honour.
 */
const EXPECTED_PARALLEL_ALLOWED: Readonly<
  Record<SideEffectPolicy, Record<RoutingClass, boolean>>
> = {
  'read-only': { competing: false, 'fan-out': true, 'shared-read': true, 'request-response': true },
  idempotent: { competing: false, 'fan-out': true, 'shared-read': true, 'request-response': true },
  'isolated-writes': {
    competing: false,
    'fan-out': true,
    'shared-read': true,
    'request-response': true,
  },
  unsafe: { competing: false, 'fan-out': false, 'shared-read': false, 'request-response': true },
};

describe('evaluateSideEffectGate — full policy × routing-class matrix (Property 12, Req 13.3, 13.4)', () => {
  for (const policy of ALL_POLICIES) {
    for (const routingClass of ALL_ROUTING_CLASSES) {
      const expected = EXPECTED_PARALLEL_ALLOWED[policy][routingClass];
      it(`policy '${policy}' × class '${routingClass}' → parallelAllowed=${expected}`, () => {
        const decision = evaluateSideEffectGate(policy, routingClass, false);
        expect(decision.parallelAllowed).toBe(expected);
      });
    }
  }

  it('blocks parallel for every fan-out and shared-read source while policy is unsafe (Req 13.3)', () => {
    expect(evaluateSideEffectGate('unsafe', 'fan-out', false).parallelAllowed).toBe(false);
    expect(evaluateSideEffectGate('unsafe', 'shared-read', false).parallelAllowed).toBe(false);
  });

  it('never permits parallel execution for a competing source under any policy (Req 8.8)', () => {
    for (const policy of ALL_POLICIES) {
      expect(evaluateSideEffectGate(policy, 'competing', false).parallelAllowed).toBe(false);
    }
  });

  it('always permits parallel request-response under any policy without gating (Req 8.7)', () => {
    for (const policy of ALL_POLICIES) {
      expect(evaluateSideEffectGate(policy, 'request-response', false).parallelAllowed).toBe(true);
    }
  });

  it('produces a human-readable rationale for every decision', () => {
    for (const policy of ALL_POLICIES) {
      for (const routingClass of ALL_ROUTING_CLASSES) {
        const decision = evaluateSideEffectGate(policy, routingClass, false);
        expect(typeof decision.reason).toBe('string');
        expect(decision.reason.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('evaluateSideEffectGate — production-source acknowledgement requirement (Req 13.5)', () => {
  it('requires an acknowledgement whenever a clone would attach to a production source', () => {
    for (const policy of ALL_POLICIES) {
      for (const routingClass of ALL_ROUTING_CLASSES) {
        expect(evaluateSideEffectGate(policy, routingClass, true).acknowledgementRequired).toBe(
          true,
        );
      }
    }
  });

  it('does not require an acknowledgement for a non-production (isolated) source', () => {
    for (const policy of ALL_POLICIES) {
      for (const routingClass of ALL_ROUTING_CLASSES) {
        expect(evaluateSideEffectGate(policy, routingClass, false).acknowledgementRequired).toBe(
          false,
        );
      }
    }
  });

  it('keeps the parallel decision independent of the production-source flag', () => {
    for (const policy of ALL_POLICIES) {
      for (const routingClass of ALL_ROUTING_CLASSES) {
        const isolated = evaluateSideEffectGate(policy, routingClass, false).parallelAllowed;
        const production = evaluateSideEffectGate(policy, routingClass, true).parallelAllowed;
        expect(production).toBe(isolated);
      }
    }
  });
});

describe('isParallelSafePolicy / PARALLEL_SAFE_POLICIES', () => {
  it('treats read-only, idempotent, and isolated-writes as parallel-safe (Req 13.4)', () => {
    expect(isParallelSafePolicy('read-only')).toBe(true);
    expect(isParallelSafePolicy('idempotent')).toBe(true);
    expect(isParallelSafePolicy('isolated-writes')).toBe(true);
  });

  it('treats unsafe as not parallel-safe (Req 13.3)', () => {
    expect(isParallelSafePolicy('unsafe')).toBe(false);
  });

  it('lists exactly the three non-unsafe policies', () => {
    expect([...PARALLEL_SAFE_POLICIES].sort()).toEqual(
      ['idempotent', 'isolated-writes', 'read-only'].sort(),
    );
    expect(PARALLEL_SAFE_POLICIES).not.toContain('unsafe');
  });
});

describe('SideEffectPolicyGate — stateful gate (Req 13.1, 13.2, 13.5, 13.6)', () => {
  it('exposes the declared policy (Req 13.1)', () => {
    expect(new SideEffectPolicyGate('read-only').policy).toBe('read-only');
    expect(new SideEffectPolicyGate('unsafe').policy).toBe('unsafe');
  });

  it('evaluates parallel-allow consistently with the pure decision', () => {
    const gate = new SideEffectPolicyGate('idempotent');
    const resolution = gate.evaluate({ routingClass: 'fan-out', attachesToProductionSource: false });
    expect(resolution.parallelAllowed).toBe(true);
    expect(resolution.acknowledgementRequired).toBe(false);
    expect(resolution.acknowledgementSatisfied).toBe(true);
    expect(resolution.attachmentEnabled).toBe(true);
  });

  it('blocks a production-source attachment until a matching acknowledgement is recorded (Req 13.5)', () => {
    const gate = new SideEffectPolicyGate('read-only');

    const beforeAck = gate.evaluate({
      routingClass: 'fan-out',
      attachesToProductionSource: true,
      acknowledgementId: 'finding-prod-source-1',
    });
    expect(beforeAck.acknowledgementRequired).toBe(true);
    expect(beforeAck.acknowledgementSatisfied).toBe(false);
    expect(beforeAck.attachmentEnabled).toBe(false);
    // The parallel decision is still computed independently.
    expect(beforeAck.parallelAllowed).toBe(true);

    gate.recordAcknowledgement({ findingId: 'finding-prod-source-1', acknowledgedBy: 'tech-lead' });

    const afterAck = gate.evaluate({
      routingClass: 'fan-out',
      attachesToProductionSource: true,
      acknowledgementId: 'finding-prod-source-1',
    });
    expect(afterAck.acknowledgementSatisfied).toBe(true);
    expect(afterAck.attachmentEnabled).toBe(true);
  });

  it('does not satisfy the acknowledgement when the recorded id does not match the request', () => {
    const gate = new SideEffectPolicyGate('isolated-writes', [
      { findingId: 'some-other-finding' },
    ]);
    const resolution = gate.evaluate({
      routingClass: 'shared-read',
      attachesToProductionSource: true,
      acknowledgementId: 'finding-prod-source-1',
    });
    expect(resolution.acknowledgementSatisfied).toBe(false);
    expect(resolution.attachmentEnabled).toBe(false);
  });

  it('treats a production attachment with no correlating id as unacknowledged (default-deny)', () => {
    const gate = new SideEffectPolicyGate('read-only', [{ findingId: 'finding-prod-source-1' }]);
    const resolution = gate.evaluate({
      routingClass: 'fan-out',
      attachesToProductionSource: true,
    });
    expect(resolution.acknowledgementSatisfied).toBe(false);
    expect(resolution.attachmentEnabled).toBe(false);
  });

  it('records the declared policy and each acknowledgement into the run-design (Req 13.6)', () => {
    const gate = new SideEffectPolicyGate('idempotent', [{ findingId: 'ack-a', acknowledgedBy: 'a' }]);
    gate.recordAcknowledgement({ findingId: 'ack-b', acknowledgedBy: 'b' });

    const runDesign = gate.toRunDesign();
    expect(runDesign.sideEffectPolicy).toBe('idempotent');
    expect(runDesign.acknowledgements.map((a) => a.findingId)).toEqual(['ack-a', 'ack-b']);
  });

  it('de-duplicates acknowledgements by finding id, keeping insertion order (Req 13.6)', () => {
    const gate = new SideEffectPolicyGate('read-only');
    gate.recordAcknowledgement({ findingId: 'ack-a', acknowledgedBy: 'first' });
    gate.recordAcknowledgement({ findingId: 'ack-b', acknowledgedBy: 'second' });
    gate.recordAcknowledgement({ findingId: 'ack-a', acknowledgedBy: 'updated' });

    const acks = gate.acknowledgements;
    expect(acks.map((a) => a.findingId)).toEqual(['ack-a', 'ack-b']);
    expect(acks.find((a) => a.findingId === 'ack-a')?.acknowledgedBy).toBe('updated');
  });

  it('reports whether an acknowledgement has been recorded', () => {
    const gate = new SideEffectPolicyGate('unsafe');
    expect(gate.hasAcknowledgement('ack-a')).toBe(false);
    gate.recordAcknowledgement({ findingId: 'ack-a' });
    expect(gate.hasAcknowledgement('ack-a')).toBe(true);
  });

  it('blocks parallel fan-out while unsafe even on an isolated source (Req 13.3)', () => {
    const gate = new SideEffectPolicyGate('unsafe');
    const resolution = gate.evaluate({ routingClass: 'fan-out', attachesToProductionSource: false });
    expect(resolution.parallelAllowed).toBe(false);
    // No production source ⇒ no acknowledgement gate; attachment itself is allowed.
    expect(resolution.acknowledgementRequired).toBe(false);
    expect(resolution.attachmentEnabled).toBe(true);
  });
});

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
 * Layer C — Side_Effect_Policy_Gate (Req 13).
 *
 * Enforces the declared {@link SideEffectPolicy} before both variants of a
 * benchmark may run in parallel, and requires an explicit acknowledgement
 * before a Kata_Variant clone may attach to a production event source.
 *
 * Separation of concerns with {@link module:benchmark/routing}: the
 * `TriggerRouter` states *what* each {@link RoutingClass} permits in principle
 * (its {@link ExecutionIntent} — exclusive vs parallel, and whether parallel
 * requires gate approval); this gate decides *whether* a concrete run may
 * actually proceed in parallel given the declared policy, and *whether* an
 * acknowledgement is required to enable a production-source attachment. The
 * gate therefore consumes the router's intent rather than re-deriving routing
 * rules, keeping a single source of truth for the routing taxonomy.
 *
 * This module is **pure, synth-time logic**: no `aws-cdk-lib` dependency, no
 * I/O. The stateful {@link SideEffectPolicyGate} only accumulates the declared
 * policy and acknowledgements so they can be recorded into the Run_Design
 * (Req 13.6); the parallel/acknowledgement decisions themselves are computed by
 * the pure {@link evaluateSideEffectGate}.
 *
 * Decision contract (Req 13.3, 13.4 and the routing intent Req 8.7, 8.8):
 *
 * | policy \ class    | competing | fan-out | shared-read | request-response |
 * | ----------------- | --------- | ------- | ----------- | ---------------- |
 * | read-only         | block     | allow   | allow       | allow            |
 * | idempotent        | block     | allow   | allow       | allow            |
 * | isolated-writes   | block     | allow   | allow       | allow            |
 * | unsafe            | block     | block   | block       | allow            |
 *
 * (`allow`/`block` here describe `parallelAllowed`.) Competing never runs in
 * parallel (each message goes to one consumer); request-response is always
 * parallel-capable (discrete per-variant requests share no side effects);
 * fan-out and shared-read run in parallel only when the policy is parallel-safe
 * — i.e. not `unsafe` (Property 12).
 *
 * @remarks
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 *
 * @module benchmark/side-effect-gate
 */

import type { FindingAcknowledgement, SideEffectPolicy } from './options';
import type { RunDesign } from './manifest';
import type { RoutingClass } from './triggers/types';
import { executionIntentFor } from './routing';

/**
 * The {@link SideEffectPolicy} values under which duplicating a handler's
 * externally-observable effects across both variants is safe, so parallel
 * fan-out / shared-read execution may be approved (Req 13.4).
 *
 * Declared `as const` so it is a single, frozen source of truth: every policy
 * NOT in this set (currently only `unsafe`) blocks parallel execution
 * (Req 13.3).
 */
export const PARALLEL_SAFE_POLICIES = ['read-only', 'idempotent', 'isolated-writes'] as const;

/** The narrowed type of a parallel-safe {@link SideEffectPolicy}. */
export type ParallelSafePolicy = (typeof PARALLEL_SAFE_POLICIES)[number];

/**
 * Type guard: whether a {@link SideEffectPolicy} permits duplicating side
 * effects across variants, and therefore permits parallel fan-out / shared-read
 * once the routing class allows it (Req 13.4).
 *
 * @param policy - The declared side-effect policy.
 * @returns `true` for `read-only`, `idempotent`, or `isolated-writes`; `false`
 *   for `unsafe` (Req 13.3).
 */
export function isParallelSafePolicy(policy: SideEffectPolicy): policy is ParallelSafePolicy {
  return (PARALLEL_SAFE_POLICIES as ReadonlyArray<SideEffectPolicy>).includes(policy);
}

/** The decision returned by the side-effect gate for a routing request. */
export interface SideEffectGateDecision {
  /** Whether parallel execution of both variants is permitted (Req 13.3, 13.4). */
  readonly parallelAllowed: boolean;
  /**
   * Whether an explicit side-effect acknowledgement is required to enable the
   * attachment, i.e. whether the clone would attach to a production event
   * source (Req 13.5).
   */
  readonly acknowledgementRequired: boolean;
  /** Human-readable rationale for the decision. */
  readonly reason: string;
}

/**
 * Evaluate whether parallel execution is permitted for a routing request under
 * the declared side-effect policy, and whether attaching the clone requires an
 * explicit acknowledgement (Req 13.3, 13.4, 13.5).
 *
 * This is the pure decision kernel of the gate. It reuses the router's
 * {@link ExecutionIntent} for `routingClass` so the routing taxonomy is not
 * duplicated:
 *
 * - `parallelPermitted === false` (competing) → never parallel (Req 8.8).
 * - `parallelRequiresGateApproval === false` (request-response) → parallel is
 *   always allowed; discrete per-variant requests share no side effects (Req 8.7).
 * - `parallelRequiresGateApproval === true` (fan-out / shared-read) → parallel
 *   is allowed only when {@link isParallelSafePolicy} holds (Req 13.3, 13.4).
 *
 * The `acknowledgementRequired` flag is independent of the parallel decision:
 * it is driven solely by whether the clone would attach to a production event
 * source (Req 13.5). Whether that acknowledgement has actually been *recorded*
 * is resolved by {@link SideEffectPolicyGate.evaluate}.
 *
 * @param policy - The declared {@link SideEffectPolicy}.
 * @param routingClass - The trigger's {@link RoutingClass}.
 * @param attachesToProductionSource - Whether routing would attach a clone to a
 *   production (non-isolated) event source (Req 13.5).
 * @returns The gate decision.
 */
export function evaluateSideEffectGate(
  policy: SideEffectPolicy,
  routingClass: RoutingClass,
  attachesToProductionSource: boolean,
): SideEffectGateDecision {
  const parallelAllowed = resolveParallelAllowed(policy, routingClass);

  return {
    parallelAllowed,
    acknowledgementRequired: attachesToProductionSource,
    reason: buildReason(policy, routingClass, parallelAllowed, attachesToProductionSource),
  };
}

/**
 * Resolve the parallel-execution decision for a (policy, routingClass) pair by
 * combining the routing class's {@link ExecutionIntent} with the policy's
 * parallel-safety (Property 12).
 */
function resolveParallelAllowed(policy: SideEffectPolicy, routingClass: RoutingClass): boolean {
  const intent = executionIntentFor(routingClass);

  // Competing: each message is delivered to exactly one consumer; parallel
  // variants would steal each other's messages — never permitted (Req 8.8).
  if (!intent.parallelPermitted) {
    return false;
  }

  // Request-response: discrete per-variant requests never share side effects,
  // so parallel needs no policy gating (Req 8.7).
  if (!intent.parallelRequiresGateApproval) {
    return true;
  }

  // Fan-out / shared-read: parallel only when duplicate side effects are safe
  // — i.e. the policy is not `unsafe` (Req 13.3, 13.4).
  return isParallelSafePolicy(policy);
}

/**
 * Build the human-readable rationale describing why parallel execution was
 * allowed or blocked, and whether an acknowledgement is required.
 */
function buildReason(
  policy: SideEffectPolicy,
  routingClass: RoutingClass,
  parallelAllowed: boolean,
  attachesToProductionSource: boolean,
): string {
  const intent = executionIntentFor(routingClass);

  let core: string;
  if (!intent.parallelPermitted) {
    core =
      `Routing class '${routingClass}' is exclusive: each message is delivered to a single ` +
      'consumer, so both variants never run in parallel (Req 8.8).';
  } else if (!intent.parallelRequiresGateApproval) {
    core =
      `Routing class '${routingClass}' uses discrete per-variant requests with no shared ` +
      'side effects, so parallel execution is permitted without policy gating (Req 8.7).';
  } else if (parallelAllowed) {
    core =
      `Side-effect policy '${policy}' is parallel-safe, so parallel '${routingClass}' ` +
      'execution of both variants is permitted (Req 13.4).';
  } else {
    core =
      `Side-effect policy '${policy}' blocks parallel '${routingClass}' execution; ` +
      'declare read-only, idempotent, or isolated-writes to permit it (Req 13.3).';
  }

  const ack = attachesToProductionSource
    ? ' Attaching the clone to a production event source requires an explicit ' +
    'side-effect acknowledgement before enablement (Req 13.5).'
    : '';

  return `${core}${ack}`;
}

/**
 * A concrete routing request submitted to the stateful gate (Req 13.3–13.5).
 */
export interface SideEffectGateRequest {
  /** The trigger's {@link RoutingClass}. */
  readonly routingClass: RoutingClass;
  /**
   * Whether routing would attach the clone to a production (non-isolated) event
   * source, which requires an explicit acknowledgement (Req 13.5).
   */
  readonly attachesToProductionSource: boolean;
  /**
   * The id of the acknowledgement that authorises a production-source
   * attachment (typically the correlated preflight finding id). When omitted
   * for a production-source request, the attachment is treated as
   * unacknowledged (default-deny).
   */
  readonly acknowledgementId?: string;
}

/**
 * The gate's resolution for a request: the pure {@link SideEffectGateDecision}
 * augmented with the recorded-acknowledgement outcome and the resulting
 * attachment enablement (Req 13.5).
 */
export interface SideEffectGateResolution extends SideEffectGateDecision {
  /**
   * Whether the acknowledgement requirement is satisfied. Always `true` for a
   * non-production (isolated) source (no acknowledgement is required); for a
   * production source it is `true` only when a correlating acknowledgement has
   * been recorded.
   */
  readonly acknowledgementSatisfied: boolean;
  /**
   * Whether the clone attachment may actually be enabled: `true` for an
   * isolated source, and for a production source only once the acknowledgement
   * is satisfied (Req 13.5).
   */
  readonly attachmentEnabled: boolean;
}

/** The subset of the {@link RunDesign} owned by the side-effect gate (Req 13.6). */
export type SideEffectRunDesignContribution = Pick<
  RunDesign,
  'sideEffectPolicy' | 'acknowledgements'
>;

/**
 * Stateful Side_Effect_Policy_Gate for one benchmark run (Req 13).
 *
 * A single instance carries the run's declared {@link SideEffectPolicy}
 * (Req 13.1, 13.2) and accumulates the side-effect acknowledgements that unlock
 * production-source attachments (Req 13.5). It delegates the parallel /
 * acknowledgement-required decision to the pure {@link evaluateSideEffectGate}
 * and adds the stateful concern: whether a required acknowledgement has been
 * recorded, and emission of the policy + acknowledgements into the Run_Design
 * (Req 13.6).
 *
 * Acknowledgements are keyed by {@link FindingAcknowledgement.findingId};
 * recording the same id again replaces the prior entry while preserving
 * first-seen ordering, so the Run_Design is deterministic and free of
 * duplicates.
 */
export class SideEffectPolicyGate {
  /** The declared side-effect policy for the run (Req 13.1, 13.2). */
  public readonly policy: SideEffectPolicy;

  /** Acknowledgements keyed by finding id, preserving insertion order. */
  private readonly acknowledgementsById: Map<string, FindingAcknowledgement>;

  /**
   * @param policy - The declared {@link SideEffectPolicy} for the run.
   * @param acknowledgements - Acknowledgements declared up front (e.g. from
   *   {@link KataBenchOptions.acknowledgements}); later duplicates by
   *   `findingId` replace earlier ones.
   */
  public constructor(
    policy: SideEffectPolicy,
    acknowledgements?: ReadonlyArray<FindingAcknowledgement>,
  ) {
    this.policy = policy;
    this.acknowledgementsById = new Map<string, FindingAcknowledgement>();
    for (const acknowledgement of acknowledgements ?? []) {
      this.acknowledgementsById.set(acknowledgement.findingId, acknowledgement);
    }
  }

  /**
   * Record a side-effect acknowledgement that authorises a production-source
   * attachment (Req 13.5, 13.6).
   *
   * Recording an acknowledgement whose `findingId` already exists replaces the
   * prior entry in place (keeping its original ordering position), so the
   * latest attestation wins without introducing duplicates.
   *
   * @param acknowledgement - The acknowledgement to record.
   */
  public recordAcknowledgement(acknowledgement: FindingAcknowledgement): void {
    this.acknowledgementsById.set(acknowledgement.findingId, acknowledgement);
  }

  /**
   * @param findingId - The acknowledgement / finding id to look up.
   * @returns `true` if a correlating acknowledgement has been recorded.
   */
  public hasAcknowledgement(findingId: string): boolean {
    return this.acknowledgementsById.has(findingId);
  }

  /** The recorded acknowledgements, in stable first-seen order (Req 13.6). */
  public get acknowledgements(): ReadonlyArray<FindingAcknowledgement> {
    return Array.from(this.acknowledgementsById.values());
  }

  /**
   * Resolve a concrete routing request against the declared policy and the
   * recorded acknowledgements (Req 13.3, 13.4, 13.5).
   *
   * @param request - The routing request to evaluate.
   * @returns The {@link SideEffectGateResolution} for the request.
   */
  public evaluate(request: SideEffectGateRequest): SideEffectGateResolution {
    const decision = evaluateSideEffectGate(
      this.policy,
      request.routingClass,
      request.attachesToProductionSource,
    );

    // An isolated (non-production) source needs no acknowledgement and is
    // always attachable; a production source needs a correlating, recorded
    // acknowledgement before its attachment may be enabled (Req 13.5).
    const acknowledgementSatisfied = decision.acknowledgementRequired
      ? request.acknowledgementId !== undefined && this.hasAcknowledgement(request.acknowledgementId)
      : true;

    return {
      ...decision,
      acknowledgementSatisfied,
      attachmentEnabled: acknowledgementSatisfied,
    };
  }

  /**
   * Emit the declared policy and each recorded acknowledgement for inclusion in
   * the Run_Design accumulator (Req 13.6).
   *
   * The shape is a {@link SideEffectRunDesignContribution} — a typed slice of
   * the canonical {@link RunDesign} owned by {@link module:benchmark/manifest}
   * — so the gate contributes its fields without duplicating or diverging from
   * the manifest's Run_Design schema.
   *
   * @returns The side-effect policy and acknowledgements slice of the Run_Design.
   */
  public toRunDesign(): SideEffectRunDesignContribution {
    return {
      sideEffectPolicy: this.policy,
      acknowledgements: this.acknowledgements,
    };
  }
}

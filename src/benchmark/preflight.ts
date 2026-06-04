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
 * Layer C — Preflight_Auditor (Req 11).
 *
 * Synth-time safety audit that classifies every referenced resource as an
 * `Owned_Resource` or an `External_Resource` (Req 11.1) and reports four kinds
 * of finding:
 *
 * - shared external write target (Req 11.2),
 * - clone attaching to an external event source — competing-consumer risk
 *   (Req 11.3),
 * - fixed physical name collision the kata variant would also require
 *   (Req 11.4),
 * - expensive stateful resource cost finding (Req 11.5).
 *
 * Each finding carries a **resolved disposition** (`block`, `warn`, or
 * `allow-with-explicit-ack`). External write targets and external event sources
 * are configurable and default to **block** (Req 11.6, 11.7); a fixed-name
 * collision is always `block` (a deployment would fail otherwise); a cost
 * finding is advisory `warn`. The disposition is then collapsed into a single
 * `enabled` outcome (Req 11.8–11.10):
 *
 * | disposition               | acknowledged | enabled |
 * | ------------------------- | ------------ | ------- |
 * | block                     | n/a          | false   |
 * | warn                      | n/a          | false   |
 * | allow-with-explicit-ack   | false        | false   |
 * | allow-with-explicit-ack   | true         | true    |
 *
 * This is the synth-time **default-deny** core of Property 11: with default
 * options no external write path or event-source attachment is ever enabled,
 * and enabling one requires both a non-default disposition AND a recorded
 * acknowledgement.
 *
 * **Separation of concerns.** This module owns two pure kernels —
 * {@link classifyResourceOwnership} (owned vs external) and
 * {@link computeEnablement} (disposition → enablement) — plus the pure
 * {@link auditPreflight} reducer that turns a typed
 * {@link PreflightAuditRequest} into findings. It does NOT discover benchmark
 * wiring itself: the orchestrator (task 14) knows which resources the variants
 * share / attach to and supplies them as candidates, exactly as the
 * Side_Effect_Policy_Gate consumes the router's intent rather than re-deriving
 * routing. The only CDK-aware helper, {@link collectOwnedLogicalIds}, builds the
 * in-template ownership inventory the kernel needs and is the sole reason this
 * module imports `aws-cdk-lib` (a synth-time dependency, permitted outside
 * `runner/`).
 *
 * @remarks
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9,
 * 11.10, 11.11
 *
 * @module benchmark/preflight
 */

import { CfnResource, Stack } from 'aws-cdk-lib';

import type { FindingAcknowledgement, PreflightDisposition } from './options';
import { DEFAULT_EXTERNAL_RESOURCE_DISPOSITION } from './options';

/** The kinds of safety finding the auditor can emit (Req 11.2–11.5). */
export type PreflightFindingKind =
  | 'external-write-target'
  | 'external-event-source'
  | 'fixed-physical-name'
  | 'expensive-stateful-resource';

/**
 * Ownership classification of a referenced resource (Req 11.1).
 *
 * - `owned` — created within the Target_Stack's own template (a `Ref` /
 *   `Fn::GetAtt` to an in-template logical id).
 * - `external` — referenced by import, cross-stack export, literal ARN/name,
 *   parameter, dynamic reference, or `*.fromXxx` import, and NOT created by the
 *   Target_Stack.
 */
export type ResourceOwnership = 'owned' | 'external';

/**
 * A resolved CloudFormation reference as it appears in a synthesized template:
 * a literal scalar, an intrinsic object (`{ Ref }`, `{ 'Fn::GetAtt' }`,
 * `{ 'Fn::ImportValue' }`, `{ 'Fn::Sub' }`, …), an array, or absent.
 *
 * Intentionally permissive: the auditor consumes already-resolved references
 * (e.g. from `Stack.resolve(...)`) and classifies them structurally without
 * coupling to any concrete `aws-cdk-lib` resource type.
 */
export type CfnReference =
  | string
  | number
  | boolean
  | null
  | undefined
  | { readonly [key: string]: unknown }
  | ReadonlyArray<unknown>;

/**
 * A single preflight safety finding with its resolved disposition and the
 * synth-time enablement outcome that disposition implies (Req 11.8–11.11).
 */
export interface PreflightFinding {
  /**
   * Stable finding id, used to correlate a {@link FindingAcknowledgement}
   * (Req 11.10). Sourced from the candidate's `id`.
   */
  readonly id: string;
  /** The kind of finding (Req 11.2–11.5). */
  readonly kind: PreflightFindingKind;
  /** Logical id / ARN / name of the resource the finding concerns. */
  readonly resource: string;
  /** Ownership of the referenced resource at synth time (Req 11.1). */
  readonly ownership: ResourceOwnership;
  /** The resolved disposition for this finding (Req 11.6). */
  readonly disposition: PreflightDisposition;
  /**
   * Whether a correlating acknowledgement was recorded for this finding
   * (matches by {@link FindingAcknowledgement.findingId}) (Req 11.10).
   */
  readonly acknowledged: boolean;
  /**
   * Whether the affected attachment / write path is enabled. `true` only for an
   * `allow-with-explicit-ack` finding with a recorded acknowledgement; always
   * `false` for `block` and `warn` (Req 11.8, 11.9, 11.10).
   */
  readonly enabled: boolean;
  /** Human-readable detail recorded into the Run_Design (Req 11.11). */
  readonly detail: string;
}

/**
 * Fields shared by every audit candidate the orchestrator submits.
 */
export interface PreflightCandidateBase {
  /** Stable id used to correlate an acknowledgement (Req 11.10). */
  readonly id: string;
  /** The resolved CloudFormation reference used to classify ownership (Req 11.1). */
  readonly reference: CfnReference;
  /** Logical id / ARN / name surfaced in the finding (Req 11.2–11.5). */
  readonly resource: string;
}

/**
 * A write target both variants may share (Req 11.2). A finding is emitted only
 * when the target is shared by both variants AND classified `external`.
 */
export interface WriteTargetCandidate extends PreflightCandidateBase {
  /** Whether both the baseline and the clone would write to this target. */
  readonly sharedByBothVariants: boolean;
}

/**
 * An event source the clone might attach to (Req 11.3). A finding is emitted
 * when the clone would attach AND the source is classified `external`; the
 * competing-consumer risk is highlighted when the source already has consumers.
 */
export interface EventSourceCandidate extends PreflightCandidateBase {
  /** Whether the clone's (disabled-by-default) mapping targets this source. */
  readonly cloneWouldAttach: boolean;
  /** Whether the external source already has existing consumers (Req 11.3). */
  readonly hasExistingConsumers: boolean;
}

/**
 * A resource the Target_Stack assigns a fixed physical name that the kata
 * variant would also require (Req 11.4). A collision finding is emitted when
 * the kata variant requires the same fixed name; it always resolves to `block`
 * because the deployment would otherwise fail.
 */
export interface FixedPhysicalNameCandidate extends PreflightCandidateBase {
  /** The fixed physical name assigned in the template. */
  readonly physicalName: string;
  /** Whether the kata variant would also require this exact physical name. */
  readonly requiredByKataVariant: boolean;
}

/**
 * A benchmark-relevant expensive stateful resource (Req 11.5). A cost finding
 * is emitted for every such resource; it is advisory (`warn`).
 */
export interface StatefulResourceCandidate extends PreflightCandidateBase {
  /** The CloudFormation resource type, surfaced in the cost finding detail. */
  readonly resourceType: string;
}

/**
 * The typed input to {@link auditPreflight}: the in-template ownership
 * inventory plus the benchmark-relevant resource candidates the orchestrator
 * discovered, and the disposition/acknowledgement configuration.
 */
export interface PreflightAuditRequest {
  /**
   * Logical ids of every resource created in the Target_Stack's own template
   * (from {@link collectOwnedLogicalIds}); the basis for owned-vs-external
   * classification (Req 11.1).
   */
  readonly ownedLogicalIds: ReadonlySet<string>;
  /** Write targets the variants may share (Req 11.2). */
  readonly writeTargets?: ReadonlyArray<WriteTargetCandidate>;
  /** Event sources the clone might attach to (Req 11.3). */
  readonly eventSources?: ReadonlyArray<EventSourceCandidate>;
  /** Fixed-physical-name resources the kata variant would require (Req 11.4). */
  readonly fixedPhysicalNames?: ReadonlyArray<FixedPhysicalNameCandidate>;
  /** Expensive stateful resources relevant to the benchmark (Req 11.5). */
  readonly statefulResources?: ReadonlyArray<StatefulResourceCandidate>;
  /**
   * Disposition for external write-target / event-source findings; defaults to
   * {@link DEFAULT_EXTERNAL_RESOURCE_DISPOSITION} (`block`) (Req 11.6, 11.7).
   */
  readonly externalResourceDisposition?: PreflightDisposition;
  /**
   * Explicit acknowledgements keyed by finding id, which unlock an
   * `allow-with-explicit-ack` disposition (Req 11.10).
   */
  readonly acknowledgements?: ReadonlyArray<FindingAcknowledgement>;
}

/**
 * Disposition for a fixed-physical-name collision — always `block` (Req 11.4).
 *
 * A fixed physical name the kata variant would also require makes the
 * deployment fail, so the collision is non-negotiable regardless of the
 * external-resource disposition configured for the run.
 */
export const FIXED_PHYSICAL_NAME_DISPOSITION: PreflightDisposition = 'block';

/**
 * Disposition for an expensive-stateful-resource cost finding — `warn`
 * (Req 11.5).
 *
 * A cost finding is advisory: it surfaces the expensive resource for the
 * Run_Design without hard-blocking the run, since the resource is typically a
 * legitimate (shared, single-instance) dependency.
 */
export const EXPENSIVE_STATEFUL_RESOURCE_DISPOSITION: PreflightDisposition = 'warn';

/** AWS pseudo-parameter prefix; a `Ref` to one is never an owned resource. */
const PSEUDO_PARAMETER_PREFIX = 'AWS::';

/**
 * Classify a resolved CloudFormation reference as `owned` or `external`
 * (Req 11.1).
 *
 * A reference is `owned` **only** when it is a direct `Ref` or `Fn::GetAtt` to a
 * logical id present in `ownedLogicalIds` (a resource created in this template).
 * Everything else is `external`: `Fn::ImportValue` (cross-stack export), literal
 * ARN/name strings, dynamic references (`{{resolve:...}}`), parameter / pseudo-
 * parameter refs, composite intrinsics (`Fn::Sub`, `Fn::Join`, …) whose
 * ownership cannot be proven structurally, and absent references. This is the
 * conservative, default-deny basis for Property 11.
 *
 * @param reference - The resolved reference (e.g. from `Stack.resolve(...)`).
 * @param ownedLogicalIds - In-template logical ids (from
 *   {@link collectOwnedLogicalIds}).
 * @returns `owned` if the reference points at an in-template logical id, else
 *   `external`.
 */
export function classifyResourceOwnership(
  reference: CfnReference,
  ownedLogicalIds: ReadonlySet<string>,
): ResourceOwnership {
  const logicalId = extractDirectLogicalId(reference);
  if (logicalId !== undefined && ownedLogicalIds.has(logicalId)) {
    return 'owned';
  }
  return 'external';
}

/**
 * Extract the logical id a reference *directly* points at, if it is a `Ref` or
 * `Fn::GetAtt` intrinsic — otherwise `undefined`.
 *
 * Only the two intrinsics that unambiguously denote a single in-template
 * resource are considered: `{ Ref: id }` and `{ 'Fn::GetAtt': [id, attr] }` /
 * `{ 'Fn::GetAtt': 'id.attr' }`. A `Ref` to a pseudo parameter (`AWS::*`) is
 * rejected. Composite intrinsics that may *embed* a logical id (e.g. `Fn::Sub`,
 * `Fn::Join`) are deliberately NOT unwrapped: their ownership cannot be proven
 * structurally, so they fall through to `external`.
 *
 * @param reference - The resolved reference to inspect.
 * @returns The directly-referenced logical id, or `undefined`.
 */
function extractDirectLogicalId(reference: CfnReference): string | undefined {
  if (reference === null || typeof reference !== 'object' || Array.isArray(reference)) {
    return undefined;
  }

  const intrinsic = reference as { readonly [key: string]: unknown };

  const ref = intrinsic.Ref;
  if (typeof ref === 'string') {
    return ref.startsWith(PSEUDO_PARAMETER_PREFIX) ? undefined : ref;
  }

  const getAtt = intrinsic['Fn::GetAtt'];
  if (typeof getAtt === 'string') {
    // Dotted-string form: 'LogicalId.Attribute'.
    const dotIndex = getAtt.indexOf('.');
    return dotIndex > 0 ? getAtt.slice(0, dotIndex) : getAtt;
  }
  if (Array.isArray(getAtt) && getAtt.length > 0 && typeof getAtt[0] === 'string') {
    return getAtt[0];
  }

  return undefined;
}

/**
 * Resolve the disposition for a finding kind given the configured
 * external-resource disposition (Req 11.6, 11.7).
 *
 * - external write target / event source → the configured disposition
 *   (defaulting to `block` upstream in {@link auditPreflight}) (Req 11.6, 11.7);
 * - fixed-physical-name collision → always {@link FIXED_PHYSICAL_NAME_DISPOSITION}
 *   (`block`) (Req 11.4);
 * - expensive stateful resource → always
 *   {@link EXPENSIVE_STATEFUL_RESOURCE_DISPOSITION} (`warn`) (Req 11.5).
 *
 * @param kind - The finding kind.
 * @param externalResourceDisposition - The configured disposition for external
 *   findings.
 * @returns The resolved disposition for the kind.
 */
export function resolveFindingDisposition(
  kind: PreflightFindingKind,
  externalResourceDisposition: PreflightDisposition,
): PreflightDisposition {
  switch (kind) {
    case 'external-write-target':
    case 'external-event-source':
      return externalResourceDisposition;
    case 'fixed-physical-name':
      return FIXED_PHYSICAL_NAME_DISPOSITION;
    case 'expensive-stateful-resource':
      return EXPENSIVE_STATEFUL_RESOURCE_DISPOSITION;
    default:
      return assertExhaustiveKind(kind);
  }
}

/**
 * Collapse a disposition + acknowledgement state into the enablement outcome
 * (Req 11.8, 11.9, 11.10).
 *
 * - `block` → never enabled (Req 11.8);
 * - `warn` → kept disabled (Req 11.9);
 * - `allow-with-explicit-ack` → enabled only when an acknowledgement is recorded
 *   (Req 11.10); an unacknowledged `allow-with-explicit-ack` is treated exactly
 *   like `block` (default-deny).
 *
 * @param disposition - The resolved disposition.
 * @param acknowledged - Whether a correlating acknowledgement was recorded.
 * @returns `true` if the affected attachment / write path may be enabled.
 */
export function computeEnablement(
  disposition: PreflightDisposition,
  acknowledged: boolean,
): boolean {
  return disposition === 'allow-with-explicit-ack' && acknowledged;
}

/**
 * Collect the logical ids of every resource created in the Target_Stack's own
 * template — the in-template ownership inventory for owned-vs-external
 * classification (Req 11.1).
 *
 * Walks `stack.node.findAll()` once and records the resolved logical id of each
 * `CfnResource` that belongs to `stack` (resources in nested stacks live in
 * separate templates and are intentionally excluded).
 *
 * @param stack - The already-constructed Target_Stack to inventory.
 * @returns The set of in-template resource logical ids.
 *
 * @throws {Error} If `stack` is not a CDK `Stack` instance.
 */
export function collectOwnedLogicalIds(stack: Stack): ReadonlySet<string> {
  if (!Stack.isStack(stack)) {
    throw new Error(
      'collectOwnedLogicalIds requires a CDK Stack instance; received a value that is not a Stack.',
    );
  }

  const ownedLogicalIds = new Set<string>();
  for (const construct of stack.node.findAll()) {
    if (CfnResource.isCfnResource(construct) && Stack.of(construct) === stack) {
      ownedLogicalIds.add(stack.getLogicalId(construct));
    }
  }
  return ownedLogicalIds;
}

/**
 * Audit benchmark-relevant resources for preflight safety findings (Req 11.1).
 *
 * Pure reducer over the typed {@link PreflightAuditRequest}: it classifies each
 * candidate's ownership (Req 11.1), emits a finding for each triggering
 * condition (Req 11.2–11.5), resolves the finding's disposition (Req 11.6, 11.7)
 * and acknowledgement-driven enablement (Req 11.8–11.10), and returns every
 * finding for inclusion in the Run_Design (Req 11.11). Findings are emitted in
 * a deterministic order (write targets → event sources → fixed names → stateful
 * resources, each in candidate order).
 *
 * @param request - The audit request.
 * @returns The findings, each with its resolved disposition and enablement.
 *
 * @throws {Error} If `request.ownedLogicalIds` is missing.
 */
export function auditPreflight(request: PreflightAuditRequest): ReadonlyArray<PreflightFinding> {
  if (request === null || typeof request !== 'object' || !(request.ownedLogicalIds instanceof Set)) {
    throw new Error(
      'auditPreflight requires a request with an ownedLogicalIds set (from collectOwnedLogicalIds).',
    );
  }

  const ownedLogicalIds = request.ownedLogicalIds;
  const externalDisposition =
    request.externalResourceDisposition ?? DEFAULT_EXTERNAL_RESOURCE_DISPOSITION;
  const acknowledgedIds = toAcknowledgedIdSet(request.acknowledgements);

  const findings: PreflightFinding[] = [];

  for (const candidate of request.writeTargets ?? []) {
    appendIfPresent(
      findings,
      auditWriteTarget(candidate, ownedLogicalIds, externalDisposition, acknowledgedIds),
    );
  }
  for (const candidate of request.eventSources ?? []) {
    appendIfPresent(
      findings,
      auditEventSource(candidate, ownedLogicalIds, externalDisposition, acknowledgedIds),
    );
  }
  for (const candidate of request.fixedPhysicalNames ?? []) {
    appendIfPresent(
      findings,
      auditFixedPhysicalName(candidate, ownedLogicalIds, acknowledgedIds),
    );
  }
  for (const candidate of request.statefulResources ?? []) {
    findings.push(auditStatefulResource(candidate, ownedLogicalIds, acknowledgedIds));
  }

  return findings;
}

/**
 * Build the index of acknowledged finding ids (Req 11.10). Acknowledgements are
 * keyed by {@link FindingAcknowledgement.findingId}; duplicates collapse.
 */
function toAcknowledgedIdSet(
  acknowledgements: ReadonlyArray<FindingAcknowledgement> | undefined,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const acknowledgement of acknowledgements ?? []) {
    ids.add(acknowledgement.findingId);
  }
  return ids;
}

/**
 * Audit a shared write target (Req 11.2): a finding is emitted only when both
 * variants share the target AND it is classified `external`.
 */
function auditWriteTarget(
  candidate: WriteTargetCandidate,
  ownedLogicalIds: ReadonlySet<string>,
  externalDisposition: PreflightDisposition,
  acknowledgedIds: ReadonlySet<string>,
): PreflightFinding | undefined {
  if (!candidate.sharedByBothVariants) {
    return undefined;
  }
  const ownership = classifyResourceOwnership(candidate.reference, ownedLogicalIds);
  if (ownership !== 'external') {
    return undefined;
  }
  return buildFinding(
    'external-write-target',
    candidate,
    ownership,
    externalDisposition,
    acknowledgedIds,
    `Both variants would write to the external (non-owned) target "${candidate.resource}". ` +
    'Duplicated writes from the kata clone could affect a real downstream system; ' +
    'enabling this write path requires a non-default disposition and an explicit acknowledgement.',
  );
}

/**
 * Audit an event source (Req 11.3): a finding is emitted when the clone would
 * attach AND the source is classified `external`. The competing-consumer risk
 * is called out explicitly when the source already has consumers; either way
 * the attachment is blocked by default (Req 11.7).
 */
function auditEventSource(
  candidate: EventSourceCandidate,
  ownedLogicalIds: ReadonlySet<string>,
  externalDisposition: PreflightDisposition,
  acknowledgedIds: ReadonlySet<string>,
): PreflightFinding | undefined {
  if (!candidate.cloneWouldAttach) {
    return undefined;
  }
  const ownership = classifyResourceOwnership(candidate.reference, ownedLogicalIds);
  if (ownership !== 'external') {
    return undefined;
  }
  const detail = candidate.hasExistingConsumers
    ? `The kata clone would attach to the external event source "${candidate.resource}", which ` +
    'already has existing consumers; the clone would compete for messages with them ' +
    '(competing-consumer risk). The attachment is blocked by default.'
    : `The kata clone would attach to the external event source "${candidate.resource}". ` +
    'Attaching a clone to an external source is blocked by default; if consumers are added ' +
    'later the clone would compete for messages (competing-consumer risk).';
  return buildFinding(
    'external-event-source',
    candidate,
    ownership,
    externalDisposition,
    acknowledgedIds,
    detail,
  );
}

/**
 * Audit a fixed-physical-name resource (Req 11.4): a deployment-collision
 * finding is emitted when the kata variant would also require the same fixed
 * name. Always resolves to `block`.
 */
function auditFixedPhysicalName(
  candidate: FixedPhysicalNameCandidate,
  ownedLogicalIds: ReadonlySet<string>,
  acknowledgedIds: ReadonlySet<string>,
): PreflightFinding | undefined {
  if (!candidate.requiredByKataVariant) {
    return undefined;
  }
  const ownership = classifyResourceOwnership(candidate.reference, ownedLogicalIds);
  return buildFinding(
    'fixed-physical-name',
    candidate,
    ownership,
    FIXED_PHYSICAL_NAME_DISPOSITION,
    acknowledgedIds,
    `The Target_Stack assigns the fixed physical name "${candidate.physicalName}" to ` +
    `"${candidate.resource}", which the kata variant would also require; deploying both would ` +
    'collide. This finding is blocking — the kata variant must use a distinct name.',
  );
}

/**
 * Audit an expensive stateful resource (Req 11.5): always emits an advisory
 * (`warn`) cost finding identifying the resource and its type.
 */
function auditStatefulResource(
  candidate: StatefulResourceCandidate,
  ownedLogicalIds: ReadonlySet<string>,
  acknowledgedIds: ReadonlySet<string>,
): PreflightFinding {
  const ownership = classifyResourceOwnership(candidate.reference, ownedLogicalIds);
  return buildFinding(
    'expensive-stateful-resource',
    candidate,
    ownership,
    EXPENSIVE_STATEFUL_RESOURCE_DISPOSITION,
    acknowledgedIds,
    `Benchmark-relevant expensive stateful resource "${candidate.resource}" ` +
    `(${candidate.resourceType}) may incur cost during the run. This is an advisory cost finding.`,
  );
}

/**
 * Assemble a {@link PreflightFinding} from a candidate, resolving its
 * acknowledgement state and enablement (Req 11.8–11.11).
 */
function buildFinding(
  kind: PreflightFindingKind,
  candidate: PreflightCandidateBase,
  ownership: ResourceOwnership,
  disposition: PreflightDisposition,
  acknowledgedIds: ReadonlySet<string>,
  detail: string,
): PreflightFinding {
  const acknowledged = acknowledgedIds.has(candidate.id);
  return {
    id: candidate.id,
    kind,
    resource: candidate.resource,
    ownership,
    disposition,
    acknowledged,
    enabled: computeEnablement(disposition, acknowledged),
    detail,
  };
}

/** Push a finding onto the accumulator when one was produced. */
function appendIfPresent(target: PreflightFinding[], finding: PreflightFinding | undefined): void {
  if (finding !== undefined) {
    target.push(finding);
  }
}

/**
 * Compile-time exhaustiveness guard over {@link PreflightFindingKind}.
 *
 * Adding a new finding kind without a disposition rule makes `kind` no longer
 * `never`, failing the type-check and surfacing the missing rule at build time.
 *
 * @param kind - The unhandled finding kind, expected to be `never`.
 * @throws Always, as a defensive runtime guard for the unreachable branch.
 */
function assertExhaustiveKind(kind: never): never {
  throw new Error(`Unhandled preflight finding kind: ${JSON.stringify(kind)}.`);
}

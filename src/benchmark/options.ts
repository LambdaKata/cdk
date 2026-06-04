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
 * Typed configuration surface for the Lambda Kata Benchmark Harness (Layer A).
 *
 * This module owns the single, explicitly-typed options object accepted by
 * `kataBench(stack, options)` together with its conservative-by-default
 * resolver. The harness is safe-by-default: when the caller omits a field, the
 * resolver fills it with the most conservative documented value so that running
 * a benchmark in a real AWS account never silently does anything dangerous.
 *
 * Defaults are exported as named constants ({@link DEFAULT_FIDELITY_LEVEL},
 * {@link DEFAULT_SIDE_EFFECT_POLICY}, etc.) so the safety posture is visible,
 * reviewable, and testable rather than buried inside the resolver body.
 *
 * @remarks
 * Validates: Requirements 1.5, 1.6, 11.6, 11.7, 12.1, 12.7, 13.1, 13.2, 14.1,
 * 14.2, 20.5
 *
 * @module benchmark/options
 */

import type { Duration } from 'aws-cdk-lib';

import type { TriggerDeclaration } from './triggers/types';
import type { DiscoveredLambda } from './discovery';
import type { ManifestStorageOptions } from './manifest';

/**
 * Explicit, labelled measurement-realism tiers (Req 12.1).
 *
 * Higher levels trade safety/cost for realism:
 * - {@link FidelityLevel.L0} synthetic handler — pure runtime overhead, no
 *   business dependencies (the most conservative default).
 * - {@link FidelityLevel.L1} real code bundle, no network dependency calls.
 * - {@link FidelityLevel.L2} isolated copies of declared dependencies.
 * - {@link FidelityLevel.L3} the user's declared dev/staging dependencies.
 * - {@link FidelityLevel.L4} production shadow / controlled (explicit opt-in).
 */
export enum FidelityLevel {
  L0 = 'L0',
  L1 = 'L1',
  L2 = 'L2',
  L3 = 'L3',
  L4 = 'L4',
}

/**
 * The user-declared contract describing a handler's externally-observable
 * effects, used to gate parallel fan-out and trigger attachment (Req 13.1).
 *
 * - `read-only` — the handler performs no writes.
 * - `idempotent` — duplicate executions converge to the same external state.
 * - `isolated-writes` — writes target benchmark-isolated resources only.
 * - `unsafe` — effects are unknown/unsafe to duplicate (the conservative
 *   default; blocks parallel execution).
 */
export type SideEffectPolicy = 'read-only' | 'idempotent' | 'isolated-writes' | 'unsafe';

/**
 * How a Kata_Variant's execution role is derived from its Baseline_Variant
 * (Req 14.1).
 *
 * - `reuse-role` — the clone reuses the baseline execution role (default).
 * - `clone-role` — the clone receives a copy of the baseline role.
 * - `provided-role` — the clone is assigned a user-supplied role.
 */
export type RoleMode = 'reuse-role' | 'clone-role' | 'provided-role';

/**
 * Disposition applied to a Preflight_Auditor finding (Req 11.6).
 *
 * - `block` — prevent the affected attachment/write path from being enabled.
 * - `warn` — keep the affected path disabled and emit a warning.
 * - `allow-with-explicit-ack` — enable only after a recorded acknowledgement.
 */
export type PreflightDisposition = 'block' | 'warn' | 'allow-with-explicit-ack';

/**
 * Typed selector restricting which discovered Lambdas are cloned (Req 1.5).
 *
 * Modelled as a discriminated union so each selection strategy carries exactly
 * the data it needs. The `predicate` variant is a synth-time-only construct and
 * is intentionally not serialised into the benchmark manifest.
 */
export type TargetSelector =
  | { readonly type: 'all' }
  | { readonly type: 'paths'; readonly constructPaths: ReadonlyArray<string> }
  | { readonly type: 'functionNames'; readonly functionNames: ReadonlyArray<string> }
  | { readonly type: 'predicate'; readonly predicate: (lambda: DiscoveredLambda) => boolean };

/**
 * Explicit acknowledgement of a preflight finding, keyed by finding id, that
 * unlocks an `allow-with-explicit-ack` disposition (Req 11.10, 13.5).
 *
 * The acknowledgement is recorded into the Run_Design for auditability; it
 * never contains secret or environment-variable values.
 */
export interface FindingAcknowledgement {
  /** Identifier of the {@link PreflightDisposition} finding being acknowledged. */
  readonly findingId: string;
  /** Free-form attestation of who acknowledged the finding. */
  readonly acknowledgedBy?: string;
  /** Free-form justification recorded into the Run_Design. */
  readonly reason?: string;
}

/**
 * Production-shadow controls that gate the highest fidelity tier
 * ({@link FidelityLevel.L4}) (Req 12.6).
 *
 * L4 runs a Kata_Variant against production (or production-like) dependencies,
 * so it is the only tier that can have real blast radius. It is therefore
 * locked behind an explicit {@link optIn} acknowledgement and exposes a
 * {@link killSwitch} that disables benchmark routing entirely while leaving the
 * synthesized variants in place (so a run can be neutralised without a
 * redeploy). Both fields are intentionally surfaced (not hidden defaults) so the
 * production-shadow posture is visible and reviewable.
 */
export interface ProductionShadowOptions {
  /**
   * Explicit acknowledgement that the run may shadow production at
   * {@link FidelityLevel.L4} (Req 12.6). Defaults to `false`; L4 is rejected
   * unless this is `true`.
   */
  readonly optIn?: boolean;
  /**
   * Engages the L4 kill switch: when `true`, the harness disables benchmark
   * routing (no benchmark trigger mappings are provisioned) while still
   * synthesizing the variants and manifest (Req 12.6). Defaults to `false`.
   */
  readonly killSwitch?: boolean;
}

/**
 * Run-time guardrails bounding a benchmark run (Req 20.3, 20.4, 20.5).
 */
export interface LifecycleOptions {
  /** Hard ceiling on total run duration; on breach the runner stops load. */
  readonly maxRunDuration?: Duration;
  /** Maximum concurrent load applied during a window. */
  readonly maxConcurrency?: number;
  /**
   * Maximum estimated USD cost for the run. A value of `0` is explicitly
   * allowed (the run is NOT pre-blocked; it fails at the creation point that
   * would exceed the ceiling) — see Req 20.5, 20.6.
   */
  readonly maxCostUsd?: number;
  /** Tag key carrying the Bench_Run_Id for ownership/cleanup scoping. */
  readonly ownershipTagKey?: string;
}

/**
 * The single, explicitly-typed configuration surface for `kataBench` (Req 1.6).
 *
 * Every field is optional; omitted fields are filled by
 * {@link resolveKataBenchOptions} with the documented conservative defaults.
 */
export interface KataBenchOptions {
  /** Restrict to a subset of Lambdas; defaults to all cloneable (Req 1.5). */
  readonly targets?: TargetSelector;
  /** Measurement realism tier; defaults to {@link FidelityLevel.L0} (Req 12.1, 12.7). */
  readonly fidelity?: FidelityLevel;
  /** Handler side-effect contract; defaults to `unsafe` (Req 13.1, 13.2). */
  readonly sideEffectPolicy?: SideEffectPolicy;
  /** Clone role derivation; defaults to `reuse-role` (Req 14.1, 14.2). */
  readonly roleMode?: RoleMode;
  /** Disposition for external-resource findings; defaults to `block` (Req 11.6, 11.7). */
  readonly externalResourceDisposition?: PreflightDisposition;
  /** Explicit acknowledgements keyed by finding id (Req 11.10, 13.5). */
  readonly acknowledgements?: ReadonlyArray<FindingAcknowledgement>;
  /** Per-baseline trigger declarations (discriminated union) (Req 9). */
  readonly triggers?: ReadonlyArray<TriggerDeclaration>;
  /** Run guardrails (Req 20.3). */
  readonly lifecycle?: LifecycleOptions;
  /** Clone naming suffix; defaults to `kata` (Req 6.1). */
  readonly nameSuffix?: string;
  /** Manifest storage (SSM pointer + S3 body); defaults derived from the stack. */
  readonly manifest?: ManifestStorageOptions;
  /**
   * Production-shadow controls gating {@link FidelityLevel.L4} (Req 12.6). When
   * omitted, L4 is treated as not opted-in (and is rejected) and the kill
   * switch is disengaged.
   */
  readonly productionShadow?: ProductionShadowOptions;
}

/**
 * Fully-resolved lifecycle guardrails. Optional ceilings remain optional (they
 * are resolved at run-time), but {@link LifecycleOptions.ownershipTagKey} is
 * always populated so downstream tagging/cleanup has a concrete key.
 */
export interface ResolvedLifecycleOptions {
  readonly maxRunDuration?: Duration;
  readonly maxConcurrency?: number;
  readonly maxCostUsd?: number;
  readonly ownershipTagKey: string;
}

/**
 * Fully-resolved options: the result of applying the conservative defaults to a
 * (possibly partial) {@link KataBenchOptions}. All safety-relevant fields are
 * guaranteed present so downstream subsystems never re-derive defaults.
 */
export interface ResolvedKataBenchOptions {
  readonly targets: TargetSelector;
  readonly fidelity: FidelityLevel;
  readonly sideEffectPolicy: SideEffectPolicy;
  readonly roleMode: RoleMode;
  readonly externalResourceDisposition: PreflightDisposition;
  readonly acknowledgements: ReadonlyArray<FindingAcknowledgement>;
  readonly triggers: ReadonlyArray<TriggerDeclaration>;
  readonly lifecycle: ResolvedLifecycleOptions;
  readonly nameSuffix: string;
  readonly manifest?: ManifestStorageOptions;
  readonly productionShadow: ResolvedProductionShadowOptions;
}

/**
 * Fully-resolved production-shadow controls. Both flags are always present so
 * the orchestrator never re-derives the L4 gate (Req 12.6).
 */
export interface ResolvedProductionShadowOptions {
  readonly optIn: boolean;
  readonly killSwitch: boolean;
}

// ── Documented conservative defaults (visible & intentional) ─────────────────

/** Default measurement-realism tier — most conservative (Req 12.1, 12.7). */
export const DEFAULT_FIDELITY_LEVEL: FidelityLevel = FidelityLevel.L0;

/** Default side-effect posture — blocks parallel fan-out (Req 13.1, 13.2). */
export const DEFAULT_SIDE_EFFECT_POLICY: SideEffectPolicy = 'unsafe';

/** Default role handling — clone reuses the baseline role (Req 14.1, 14.2). */
export const DEFAULT_ROLE_MODE: RoleMode = 'reuse-role';

/** Default external-resource disposition — default-deny (Req 11.6, 11.7). */
export const DEFAULT_EXTERNAL_RESOURCE_DISPOSITION: PreflightDisposition = 'block';

/** Default clone naming suffix (Req 6.1). */
export const DEFAULT_NAME_SUFFIX = 'kata';

/** Default ownership tag key carrying the Bench_Run_Id (Req 20.1). */
export const DEFAULT_OWNERSHIP_TAG_KEY = 'lambda-kata:bench-run-id';

/** Default selection — every cloneable Lambda in the stack (Req 1.5). */
export const DEFAULT_TARGET_SELECTOR: TargetSelector = { type: 'all' };

/**
 * Resolve a (possibly undefined or partial) {@link KataBenchOptions} into a
 * fully-populated {@link ResolvedKataBenchOptions} using the documented
 * conservative defaults.
 *
 * The resolver is pure: it never mutates its argument and only fills omitted
 * fields. Explicitly provided values always win, including the deliberate
 * `maxCostUsd: 0` ceiling (Req 20.5), which must not be coalesced away.
 *
 * @param options - Caller-supplied options; omitted fields receive defaults.
 * @returns The fully-resolved options with all safety-relevant fields present.
 *
 * @remarks
 * Validates: Requirements 1.5, 1.6, 11.6, 11.7, 12.1, 12.7, 13.1, 13.2, 14.1,
 * 14.2, 20.5
 */
export function resolveKataBenchOptions(options?: KataBenchOptions): ResolvedKataBenchOptions {
  const provided: KataBenchOptions = options ?? {};
  const lifecycle: LifecycleOptions = provided.lifecycle ?? {};

  const resolvedLifecycle: ResolvedLifecycleOptions = {
    // `maxCostUsd: 0` is a legitimate explicit ceiling — preserve it as-is
    // and only treat `undefined` as "unset" (Req 20.5).
    ...(lifecycle.maxRunDuration !== undefined ? { maxRunDuration: lifecycle.maxRunDuration } : {}),
    ...(lifecycle.maxConcurrency !== undefined ? { maxConcurrency: lifecycle.maxConcurrency } : {}),
    ...(lifecycle.maxCostUsd !== undefined ? { maxCostUsd: lifecycle.maxCostUsd } : {}),
    ownershipTagKey: lifecycle.ownershipTagKey ?? DEFAULT_OWNERSHIP_TAG_KEY,
  };

  return {
    targets: provided.targets ?? DEFAULT_TARGET_SELECTOR,
    fidelity: provided.fidelity ?? DEFAULT_FIDELITY_LEVEL,
    sideEffectPolicy: provided.sideEffectPolicy ?? DEFAULT_SIDE_EFFECT_POLICY,
    roleMode: provided.roleMode ?? DEFAULT_ROLE_MODE,
    externalResourceDisposition:
      provided.externalResourceDisposition ?? DEFAULT_EXTERNAL_RESOURCE_DISPOSITION,
    acknowledgements: provided.acknowledgements ?? [],
    triggers: provided.triggers ?? [],
    lifecycle: resolvedLifecycle,
    nameSuffix: provided.nameSuffix ?? DEFAULT_NAME_SUFFIX,
    ...(provided.manifest !== undefined ? { manifest: provided.manifest } : {}),
    productionShadow: {
      optIn: provided.productionShadow?.optIn ?? false,
      killSwitch: provided.productionShadow?.killSwitch ?? false,
    },
  };
}

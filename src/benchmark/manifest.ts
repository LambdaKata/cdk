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
 * Layer C — Benchmark Manifest schema, Run_Design accumulator, and the
 * synth→run-time bridge (ManifestWriter).
 *
 * The manifest is the seam between synth-time CDK constructs and the run-time
 * runner: a `CfnOutput` carries only a pointer, while the versioned manifest
 * body (resolved physical ids, alias ARNs, event-source-mapping UUIDs) lives in
 * SSM Parameter Store (small) or S3 (large).
 *
 * This module owns three concerns, kept deliberately separate:
 *
 * 1. **The versioned data model** — the readonly {@link BenchmarkManifest} /
 *    {@link ManifestVariant} / {@link RunDesign} shapes the runner consumes,
 *    plus the {@link buildBenchmarkManifest} factory and the
 *    {@link serializeManifest} / {@link parseManifest} codec that guarantees a
 *    schema-versioned, deep-equal round-trip (Req 17.5).
 * 2. **The Run_Design accumulator** ({@link RunDesignAccumulator}) — the
 *    stateful, single-purpose collector the orchestrator (task 14) feeds as it
 *    walks the construct tree: eligibility results (Req 5.7), preflight findings
 *    and dispositions (Req 11.11), side-effect policy + acknowledgements
 *    (Req 13.6), per-trigger routing/correlation (Req 8), and — critically — the
 *    environment-variable KEYS copied onto each clone, **never their values**
 *    (Property 9, Req 14.4, 14.5).
 *
 * The synth-time **writer** that persists this body and emits the pointer
 * `CfnOutput` lives in `./manifest-writer` (`writeManifest` / `ManifestWriter`):
 * it depends on `aws-cdk-lib`, whereas THIS module stays CDK-free so the Layer D
 * runner can import the schema + codec without pulling in `aws-cdk-lib`.
 *
 * **Property 9 (no secret leakage).** The accumulator exposes exactly one
 * environment-recording entry point, {@link RunDesignAccumulator.recordEnvKeys},
 * whose parameter is `ReadonlyArray<string>` — a list of KEYS. There is no API
 * that accepts an environment map or a value, so no env value can ever reach the
 * Run_Design or the serialized manifest (Req 14.5).
 *
 * @remarks
 * Validates: Requirements 5.7, 10.3, 10.4, 11.11, 13.6, 14.4, 14.5, 17.5
 *
 * @module benchmark/manifest
 */

import {
  DEFAULT_FIDELITY_LEVEL,
  DEFAULT_SIDE_EFFECT_POLICY,
  DEFAULT_ROLE_MODE,
} from './options';
import type { FidelityLevel, RoleMode, SideEffectPolicy, FindingAcknowledgement } from './options';
import type { EligibilityResult } from './eligibility';
import type { PreflightFinding } from './preflight';
import type { RoutingClass, TriggerType } from './triggers/types';

/**
 * Where the manifest body is stored and how the pointer is surfaced.
 *
 * Both fields are optional; when omitted the writer derives conservative
 * defaults from the Target_Stack (an SSM parameter under a harness-owned
 * namespace, with S3 fallback for large bodies).
 */
export interface ManifestStorageOptions {
  /** Explicit SSM parameter name to hold the manifest pointer/body. */
  readonly ssmParameterName?: string;
  /** Explicit S3 bucket name to hold large manifest bodies. */
  readonly s3BucketName?: string;
}

/**
 * How a per-trigger sample is correlated back to its variant at run time
 * (Req 19): by an in-band invocation marker, or by a time window when no marker
 * can be carried by the source.
 */
export type TriggerCorrelation = 'invocation' | 'window';

/** A recorded eligibility classification for one discovered Lambda (Req 5.7). */
export interface RunDesignEligibilityEntry {
  /** `node.path` of the classified baseline. */
  readonly path: string;
  /** The exactly-one classification and its recorded reasons. */
  readonly result: EligibilityResult;
}

/** A recorded per-trigger routing/correlation decision (Req 8, Req 19). */
export interface RunDesignTriggerRecord {
  /** `node.path` of the baseline the trigger applies to. */
  readonly path: string;
  /** The trigger discriminant. */
  readonly type: TriggerType;
  /** The single routing class assigned to the trigger (Req 8.1). */
  readonly routingClass: RoutingClass;
  /** How samples for this trigger are correlated to their variant (Req 19). */
  readonly correlation: TriggerCorrelation;
}

/**
 * The recorded description of a benchmark run, accumulated at synth time and
 * embedded in both the manifest and the rendered report.
 *
 * Environment variables are recorded by KEY only — never by value — to avoid
 * leaking secrets (Property 9, Req 14.4, 14.5). This is a pure, readonly data
 * snapshot; it is produced by {@link RunDesignAccumulator.build}.
 */
export interface RunDesign {
  /** The measurement-realism tier the run was designed for (Req 12.1). */
  readonly fidelity: FidelityLevel;
  /** The declared handler side-effect contract (Req 13.1). */
  readonly sideEffectPolicy: SideEffectPolicy;
  /** How the clone execution role was derived (Req 14.1). */
  readonly roleMode: RoleMode;
  /** Eligibility classification recorded for each discovered Lambda (Req 5.7). */
  readonly eligibility: ReadonlyArray<RunDesignEligibilityEntry>;
  /** All preflight safety findings and their dispositions (Req 11.11). */
  readonly findings: ReadonlyArray<PreflightFinding>;
  /** Side-effect / disposition acknowledgements recorded for the run (Req 13.6). */
  readonly acknowledgements: ReadonlyArray<FindingAcknowledgement>;
  /** Map of construct path → env var KEYS copied (never values) (Req 14.4). */
  readonly envKeysCopied: Readonly<Record<string, ReadonlyArray<string>>>;
  /** Per-trigger routing/correlation decisions (Req 8, Req 19). */
  readonly perTrigger: ReadonlyArray<RunDesignTriggerRecord>;
}

/** The baseline side of a manifest variant pair. */
export interface ManifestBaseline {
  readonly functionName: string;
  readonly functionArn: string;
  readonly logGroup: string;
}

/** The kata side of a manifest variant pair. */
export interface ManifestKata {
  readonly functionName: string;
  readonly functionArn: string;
  readonly aliasArn: string;
  readonly version: string;
  readonly logGroup: string;
}

/** Per-trigger run-time wiring captured in the manifest (Req 10.3, 10.4). */
export interface ManifestTrigger {
  readonly type: TriggerType;
  readonly routingClass: RoutingClass;
  readonly baselineMappingUuid?: string;
  readonly kataMappingUuid?: string;
  readonly source: { readonly isolated: boolean; readonly ref: string };
}

/** A single baseline/kata variant pair as resolved into the manifest. */
export interface ManifestVariant {
  readonly constructPath: string;
  readonly baseline: ManifestBaseline;
  readonly kata: ManifestKata;
  readonly trigger?: ManifestTrigger;
}

/**
 * The current Benchmark Manifest schema version (Req 17.5).
 *
 * The manifest body is versioned so the run-time runner can detect and reject a
 * body it does not understand ({@link parseManifest} enforces this). It is a
 * literal `1` today; a breaking change to the body shape MUST bump this constant
 * and the {@link BenchmarkManifest.schemaVersion} literal together.
 */
export const MANIFEST_SCHEMA_VERSION = 1 as const;

/** The literal type of the supported manifest schema version. */
export type ManifestSchemaVersion = typeof MANIFEST_SCHEMA_VERSION;

/** The versioned benchmark manifest body (Req 17.5). */
export interface BenchmarkManifest {
  readonly schemaVersion: ManifestSchemaVersion;
  readonly benchRunSeed: string;
  readonly region: string;
  readonly fidelity: FidelityLevel;
  readonly sideEffectPolicy: SideEffectPolicy;
  readonly ownershipTag: { readonly key: string; readonly value: string };
  readonly variants: ReadonlyArray<ManifestVariant>;
  readonly runDesign: RunDesign;
}

/** Result of writing the manifest into the stack. */
export interface ManifestWriteResult {
  /** SSM parameter name holding the manifest pointer/body. */
  readonly parameterName: string;
}

// ── Run_Design accumulator (task 12) ────────────────────────────────────────

/**
 * The run-level fields a {@link RunDesignAccumulator} is seeded with. All are
 * optional; omitted fields fall back to the documented conservative defaults
 * (fidelity L0, policy `unsafe`, role mode `reuse-role`) so a partially-wired
 * orchestrator never silently records a permissive posture.
 */
export interface RunDesignInit {
  /** Measurement-realism tier; defaults to {@link DEFAULT_FIDELITY_LEVEL}. */
  readonly fidelity?: FidelityLevel;
  /** Declared side-effect policy; defaults to {@link DEFAULT_SIDE_EFFECT_POLICY}. */
  readonly sideEffectPolicy?: SideEffectPolicy;
  /** Clone role-handling mode; defaults to {@link DEFAULT_ROLE_MODE}. */
  readonly roleMode?: RoleMode;
}

/**
 * The side-effect slice the {@link SideEffectPolicyGate} contributes to the
 * Run_Design (Req 13.6): the declared policy and the recorded acknowledgements.
 *
 * Structurally identical to the gate's `SideEffectRunDesignContribution`
 * (declared there to avoid a circular import); the accumulator consumes it via
 * {@link RunDesignAccumulator.recordSideEffectContribution}.
 */
export interface SideEffectRunDesignSlice {
  readonly sideEffectPolicy: SideEffectPolicy;
  readonly acknowledgements: ReadonlyArray<FindingAcknowledgement>;
}

/**
 * Stateful Run_Design accumulator for one `kataBench` synthesis pass (task 12).
 *
 * The orchestrator (task 14) creates one accumulator per run and feeds it as it
 * walks the construct tree, then calls {@link build} to obtain the immutable
 * {@link RunDesign} embedded in the manifest. Each `record*` method returns
 * `this` so calls can be chained fluently.
 *
 * **Single-purpose by design.** The accumulator only *collects* already-derived
 * facts (eligibility results from the classifier, findings from the auditor,
 * acknowledgements from the gate, routing from the router, env KEYS from the
 * clone builder). It performs no classification, routing, or CDK work itself —
 * those live in their respective subsystems — keeping a single source of truth
 * for each decision.
 *
 * **Property 9 — no secret leakage.** {@link recordEnvKeys} is the ONLY
 * environment-recording entry point and its parameter is a list of KEYS
 * (`ReadonlyArray<string>`). There is no method that accepts an environment map
 * or a value, so no env value can ever enter the Run_Design (Req 14.4, 14.5).
 *
 * Path-keyed records (eligibility, per-trigger) are upserted: recording the same
 * path again replaces the prior entry in place, preserving first-seen ordering
 * so the resulting Run_Design is deterministic and free of duplicates.
 *
 * @remarks
 * Validates: Requirements 5.7, 11.11, 13.6, 14.4, 14.5
 */
export class RunDesignAccumulator {
  private fidelity: FidelityLevel;
  private sideEffectPolicy: SideEffectPolicy;
  private roleMode: RoleMode;

  /** Eligibility entries keyed by construct path, preserving insertion order. */
  private readonly eligibilityByPath: Map<string, RunDesignEligibilityEntry>;
  /** Preflight findings keyed by finding id, preserving insertion order. */
  private readonly findingsById: Map<string, PreflightFinding>;
  /** Acknowledgements keyed by finding id, preserving insertion order. */
  private readonly acknowledgementsById: Map<string, FindingAcknowledgement>;
  /** Per-path env var KEY sets, preserving insertion order within each path. */
  private readonly envKeysByPath: Map<string, string[]>;
  /** Per-trigger records keyed by `path::type`, preserving insertion order. */
  private readonly triggersByKey: Map<string, RunDesignTriggerRecord>;

  /**
   * @param init - Optional run-level seed values; omitted fields use the
   *   documented conservative defaults.
   */
  public constructor(init: RunDesignInit = {}) {
    this.fidelity = init.fidelity ?? DEFAULT_FIDELITY_LEVEL;
    this.sideEffectPolicy = init.sideEffectPolicy ?? DEFAULT_SIDE_EFFECT_POLICY;
    this.roleMode = init.roleMode ?? DEFAULT_ROLE_MODE;
    this.eligibilityByPath = new Map<string, RunDesignEligibilityEntry>();
    this.findingsById = new Map<string, PreflightFinding>();
    this.acknowledgementsById = new Map<string, FindingAcknowledgement>();
    this.envKeysByPath = new Map<string, string[]>();
    this.triggersByKey = new Map<string, RunDesignTriggerRecord>();
  }

  /** Set the measurement-realism tier for the run (Req 12.1). */
  public setFidelity(fidelity: FidelityLevel): this {
    this.fidelity = fidelity;
    return this;
  }

  /** Set the declared handler side-effect policy for the run (Req 13.1). */
  public setSideEffectPolicy(policy: SideEffectPolicy): this {
    this.sideEffectPolicy = policy;
    return this;
  }

  /** Set the clone role-handling mode for the run (Req 14.1). */
  public setRoleMode(roleMode: RoleMode): this {
    this.roleMode = roleMode;
    return this;
  }

  /**
   * Record (or replace) the eligibility classification for a discovered Lambda
   * (Req 5.7).
   *
   * @param path - `node.path` of the classified baseline.
   * @param result - The classifier's exactly-one result with its reasons.
   */
  public recordEligibility(path: string, result: EligibilityResult): this {
    this.eligibilityByPath.set(path, { path, result });
    return this;
  }

  /**
   * Record (or replace, by finding id) a preflight safety finding and its
   * resolved disposition (Req 11.11).
   *
   * @param finding - The finding emitted by the {@link auditPreflight} auditor.
   */
  public recordFinding(finding: PreflightFinding): this {
    this.findingsById.set(finding.id, finding);
    return this;
  }

  /**
   * Record (or replace, by finding id) a side-effect / disposition
   * acknowledgement (Req 11.10, 13.5, 13.6).
   *
   * @param acknowledgement - The acknowledgement to record.
   */
  public recordAcknowledgement(acknowledgement: FindingAcknowledgement): this {
    this.acknowledgementsById.set(acknowledgement.findingId, acknowledgement);
    return this;
  }

  /**
   * Fold the Side_Effect_Policy_Gate's contribution into the Run_Design: adopt
   * the declared policy and merge each recorded acknowledgement (Req 13.6).
   *
   * @param contribution - The gate's policy + acknowledgements slice.
   */
  public recordSideEffectContribution(contribution: SideEffectRunDesignSlice): this {
    this.sideEffectPolicy = contribution.sideEffectPolicy;
    for (const acknowledgement of contribution.acknowledgements) {
      this.acknowledgementsById.set(acknowledgement.findingId, acknowledgement);
    }
    return this;
  }

  /**
   * Record the environment-variable KEYS copied onto a clone — NEVER their
   * values (Property 9, Req 14.4, 14.5).
   *
   * This is the sole environment-recording entry point and it is key-only by
   * construction: its parameter is a list of strings (keys). Repeated calls for
   * the same path union the key sets, preserving first-seen order and dropping
   * duplicates, so the Run_Design is deterministic.
   *
   * @param path - `node.path` of the baseline whose env keys were copied.
   * @param keys - The environment-variable KEYS (e.g. `Object.keys(env)`).
   */
  public recordEnvKeys(path: string, keys: ReadonlyArray<string>): this {
    const existing = this.envKeysByPath.get(path);
    if (existing === undefined) {
      this.envKeysByPath.set(path, dedupePreservingOrder(keys));
      return this;
    }
    const seen = new Set<string>(existing);
    for (const key of keys) {
      if (!seen.has(key)) {
        seen.add(key);
        existing.push(key);
      }
    }
    return this;
  }

  /**
   * Record (or replace, by path+type) a per-trigger routing/correlation
   * decision (Req 8, Req 19).
   *
   * @param record - The trigger's path, type, routing class, and correlation.
   */
  public recordTriggerRouting(record: RunDesignTriggerRecord): this {
    this.triggersByKey.set(`${record.path}::${record.type}`, record);
    return this;
  }

  /**
   * Build the immutable {@link RunDesign} snapshot from the accumulated state.
   *
   * The returned object is a fresh, deeply-copied, JSON-serializable value: the
   * accumulator's internal maps are projected into plain arrays/records so that
   * later mutation of the accumulator cannot affect an already-built snapshot.
   *
   * @returns The recorded Run_Design for embedding in the manifest.
   */
  public build(): RunDesign {
    const envKeysCopied: Record<string, ReadonlyArray<string>> = {};
    for (const [path, keys] of this.envKeysByPath) {
      envKeysCopied[path] = [...keys];
    }

    return {
      fidelity: this.fidelity,
      sideEffectPolicy: this.sideEffectPolicy,
      roleMode: this.roleMode,
      eligibility: Array.from(this.eligibilityByPath.values()),
      findings: Array.from(this.findingsById.values()),
      acknowledgements: Array.from(this.acknowledgementsById.values()),
      envKeysCopied,
      perTrigger: Array.from(this.triggersByKey.values()),
    };
  }
}

/** Union a list of keys into a new array, dropping duplicates, order-stable. */
function dedupePreservingOrder(keys: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of keys) {
    if (!seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}

// ── Manifest factory + versioned codec (task 12) ─────────────────────────────

/**
 * The caller-supplied inputs to {@link buildBenchmarkManifest}: everything the
 * manifest needs except the schema version and the top-level fidelity/policy,
 * which are stamped/derived by the factory.
 */
export interface BuildBenchmarkManifestInput {
  /** Synth-stable id seed for the run (Req 1, 20.1). */
  readonly benchRunSeed: string;
  /** The AWS region the benchmark is synthesized into. */
  readonly region: string;
  /** Ownership tag carrying the Bench_Run_Id for cleanup scoping (Req 20.1). */
  readonly ownershipTag: { readonly key: string; readonly value: string };
  /** The resolved baseline/kata variant pairs (Req 10.3, 10.4). */
  readonly variants: ReadonlyArray<ManifestVariant>;
  /** The recorded Run_Design (from {@link RunDesignAccumulator.build}). */
  readonly runDesign: RunDesign;
}

/**
 * Assemble a versioned {@link BenchmarkManifest} body (Req 17.5).
 *
 * The factory stamps the current {@link MANIFEST_SCHEMA_VERSION} and derives the
 * top-level `fidelity` / `sideEffectPolicy` from the Run_Design so the two can
 * never drift apart — the Run_Design is the single source of truth for both.
 *
 * @param input - The manifest inputs (seed, region, tag, variants, run-design).
 * @returns The assembled, versioned manifest body.
 */
export function buildBenchmarkManifest(input: BuildBenchmarkManifestInput): BenchmarkManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    benchRunSeed: input.benchRunSeed,
    region: input.region,
    fidelity: input.runDesign.fidelity,
    sideEffectPolicy: input.runDesign.sideEffectPolicy,
    ownershipTag: input.ownershipTag,
    variants: input.variants,
    runDesign: input.runDesign,
  };
}

/**
 * Error raised when a serialized manifest body cannot be parsed back into a
 * {@link BenchmarkManifest} — malformed JSON, a non-object body, or an
 * unsupported {@link BenchmarkManifest.schemaVersion} (Req 17.5).
 */
export class ManifestSchemaError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ManifestSchemaError';
  }
}

/**
 * Serialize a {@link BenchmarkManifest} to its canonical JSON body for storage
 * in SSM/S3 (Req 17.5).
 *
 * @param manifest - The manifest body to serialize.
 * @returns The JSON string written to the manifest store.
 */
export function serializeManifest(manifest: BenchmarkManifest): string {
  return JSON.stringify(manifest);
}

/**
 * Parse a serialized manifest body back into a {@link BenchmarkManifest},
 * validating the schema version (Req 17.5).
 *
 * The codec guarantees a deep-equal round-trip with {@link serializeManifest}
 * for any manifest produced by {@link buildBenchmarkManifest}. It is
 * intentionally strict about the one invariant the runner depends on — the
 * schema version — and rejects any body it does not understand rather than
 * silently mis-reading a future shape.
 *
 * @param body - The serialized manifest JSON (from the manifest store).
 * @returns The parsed manifest body.
 *
 * @throws {ManifestSchemaError} If `body` is not valid JSON, is not an object,
 *   or carries an unsupported schema version.
 */
export function parseManifest(body: string): BenchmarkManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new ManifestSchemaError(
      `Manifest body is not valid JSON: ${(error as Error).message}.`,
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ManifestSchemaError(
      'Manifest body must be a JSON object with a recognized schemaVersion.',
    );
  }

  const schemaVersion = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new ManifestSchemaError(
      `Unsupported manifest schemaVersion ${JSON.stringify(schemaVersion)}; ` +
      `this runner understands schemaVersion ${MANIFEST_SCHEMA_VERSION}.`,
    );
  }

  return parsed as BenchmarkManifest;
}

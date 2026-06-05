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
 * Layer D — {@link LifecycleManager}: ownership tagging, run guardrails, and
 * tag-scoped, all-or-nothing cleanup of benchmark-created resources (run-time,
 * CDK-free) (Req 20.1, 20.2, 20.3, 20.5, 20.6, 20.7, 20.8).
 *
 * ## Responsibility
 *
 * The manager owns three concerns for a single benchmark run, all keyed off the
 * run's `Bench_Run_Id`:
 *
 * 1. **Ownership tagging (Req 20.1).** Every benchmark-created resource is
 *    stamped with an ownership tag whose VALUE is the `Bench_Run_Id`, marking it
 *    benchmark-harness-owned and scoping it to exactly one run.
 *    {@link LifecycleManager.ownershipTag} returns the `{ key, value }` tag and
 *    {@link LifecycleManager.tagsFor} merges it into a resource's tag map (the
 *    ownership tag always wins, so a caller can never accidentally un-own a
 *    resource).
 * 2. **Run guardrails (Req 20.3, 20.5, 20.6).** The manager exposes the three
 *    configured ceilings — maximum run duration, maximum concurrency, and
 *    maximum USD cost — and enforces the cost ceiling at the POINT a resource is
 *    created. A configured cost limit of zero (or any non-negative value) is
 *    ACCEPTED and never triggers a pre-flight block (Req 20.5); only an actual
 *    creation whose estimated cost would push cumulative spend past the ceiling
 *    fails, and it fails AT that creation point by throwing
 *    {@link CostLimitExceededError} (Req 20.6). The duration/concurrency ceilings
 *    are exposed as predicates the {@link BenchmarkRunner} consults (Req 20.4).
 * 3. **Tag-scoped, all-or-nothing cleanup (Req 20.2, 20.7, 20.8, Property 10).**
 *    Cleanup resolves the resources tagged for the targeted run, attempts to
 *    remove every one, and is atomic in REPORTING: if any resource cannot be
 *    removed, the operation is reported as FAILED ({@link CleanupResult.complete}
 *    `false`) and EACH remaining resource is listed
 *    ({@link CleanupResult.remaining}). It never touches a resource tagged for a
 *    different run or carrying no ownership tag (Req 20.7).
 *
 * ## Dependency inversion (testability)
 *
 * The capability to enumerate and delete benchmark-owned resources is expressed
 * as the minimal injected {@link BenchmarkResourceCleanupClient} port (mirroring
 * the injected client of `./trigger-toggler` and the injected reader of
 * `./metrics-collector`), so unit tests pass an in-memory mock and never touch
 * AWS. {@link LifecycleManager.withDefaultClient} constructs a real
 * `@aws-sdk/client-lambda`-backed adapter ({@link LambdaBenchmarkResourceCleanup})
 * for production callers.
 *
 * ## CDK-free constraint
 *
 * This module imports ONLY `@aws-sdk/client-lambda` (a runtime dependency of the
 * package) and no `aws-cdk-lib` / `constructs`, keeping the runner package
 * shippable without CDK (enforced by `test/benchmark-runner-cdk-free.test.ts`).
 *
 * @remarks
 * Validates: Requirements 20.1, 20.2, 20.3, 20.5, 20.6, 20.7, 20.8
 *
 * @module benchmark/runner/lifecycle-manager
 */

import {
  LambdaClient,
  DeleteFunctionCommand,
  DeleteAliasCommand,
  DeleteEventSourceMappingCommand,
  RemovePermissionCommand,
} from '@aws-sdk/client-lambda';

/** Default ownership tag key carrying the Bench_Run_Id (mirrors options.ts). */
export const DEFAULT_OWNERSHIP_TAG_KEY = 'lambda-kata:bench-run-id';

// ── Ownership tagging types (Req 20.1) ───────────────────────────────────────

/**
 * The benchmark-harness ownership tag: a `{ key, value }` pair whose VALUE is
 * the `Bench_Run_Id` (Req 20.1).
 *
 * This is the same shape used across the codebase (`BenchmarkManifest.ownershipTag`),
 * re-declared here so the CDK-free runner does not need to import a CDK-coupled
 * module for it.
 */
export interface OwnershipTag {
  /** The tag key carrying the Bench_Run_Id. */
  readonly key: string;
  /** The tag value — the `Bench_Run_Id` the resource belongs to. */
  readonly value: string;
}

// ── Resource cleanup port (Req 20.2, 20.7, 20.8) ─────────────────────────────

/**
 * The kinds of benchmark-created resource the cleanup removes (Req 20.2).
 *
 * The set mirrors the design's cleanup scope: the Kata_Variants (`function`),
 * their `alias`/`version`, their `log-group`, their benchmark-owned
 * `event-source-mapping` and `permission`, and any other benchmark `support`
 * resource created for the run.
 */
export type BenchmarkResourceType =
  | 'function'
  | 'alias'
  | 'version'
  | 'log-group'
  | 'event-source-mapping'
  | 'permission'
  | 'support';

/**
 * A single benchmark-harness-owned resource, scoped to one run by its
 * {@link benchRunId} (the ownership tag value) (Req 20.1, 20.7).
 *
 * The optional addressing fields carry the extra coordinates a concrete
 * deleter needs for resource types whose deletion is not addressable by a single
 * id (e.g. an alias/version/permission is addressed relative to its owning
 * function). They are intentionally optional so the unit-tested orchestration —
 * which only needs {@link type}, {@link id}, and {@link benchRunId} — stays
 * independent of the AWS deletion shapes.
 */
export interface TaggedResource {
  /** The resource kind (drives which deletion call the adapter issues). */
  readonly type: BenchmarkResourceType;
  /** A stable identifier for the resource (name, UUID, or ARN). */
  readonly id: string;
  /** The Bench_Run_Id the resource is tagged for (its ownership tag value). */
  readonly benchRunId: string;
  /** Owning function name, for alias/version/permission deletion. */
  readonly functionName?: string;
  /** Qualifier (alias name or version number), where applicable. */
  readonly qualifier?: string;
  /** Permission statement id, for `permission` deletion. */
  readonly statementId?: string;
  /** Full ARN, where the deleter addresses the resource by ARN. */
  readonly arn?: string;
}

/**
 * The minimal capability the {@link LifecycleManager} depends on to perform
 * tag-scoped cleanup, injected for testability (dependency inversion)
 * (Req 20.2, 20.7, 20.8).
 *
 * Implementations resolve the resources tagged for a run and delete one resource
 * at a time. Unit tests provide an in-memory mock; production uses the
 * `@aws-sdk/client-lambda`-backed {@link LambdaBenchmarkResourceCleanup}. The
 * manager never constructs SDK command objects itself, so its cleanup
 * orchestration (scoping + atomic reporting) is independent of the SDK shapes.
 */
export interface BenchmarkResourceCleanupClient {
  /**
   * Resolve the resources carrying the benchmark-harness ownership tag for the
   * targeted run (Req 20.7).
   *
   * @param benchRunId - The Bench_Run_Id whose tagged resources to enumerate.
   * @returns The resources tagged for that run (and only that run).
   */
  listTaggedResources(benchRunId: string): Promise<ReadonlyArray<TaggedResource>>;

  /**
   * Remove a single benchmark-owned resource.
   *
   * @param resource - The resource to delete.
   * @throws If the resource cannot be removed (the manager records it as
   *   remaining and fails the cleanup, Req 20.8).
   */
  deleteResource(resource: TaggedResource): Promise<void>;
}

// ── Guardrail configuration (Req 20.3) ───────────────────────────────────────

/**
 * The run guardrails the {@link LifecycleManager} exposes (Req 20.3).
 *
 * Durations are expressed in MILLISECONDS (a plain `number`) at the run-time
 * boundary rather than the CDK `Duration` type used by the synth-time
 * `LifecycleOptions`, because the runner is CDK-free. All ceilings are optional;
 * an omitted ceiling means "no limit of this kind".
 */
export interface RunGuardrails {
  /** Hard ceiling on total run duration, in milliseconds (Req 20.4). */
  readonly maxRunDurationMs?: number;
  /** Maximum concurrent load applied during a window. */
  readonly maxConcurrency?: number;
  /**
   * Maximum estimated USD cost for the run. `0` is explicitly allowed and is
   * NOT pre-blocking (Req 20.5); the run fails only at the creation point that
   * would exceed it (Req 20.6).
   */
  readonly maxCostUsd?: number;
}

// ── Cleanup result (consumed by runner.ts — keep stable) ─────────────────────

/**
 * The outcome of a tag-scoped cleanup pass (Req 20.7, 20.8).
 *
 * This is the contract consumed by `./runner` (`CleanupRunner`): the runner
 * reads {@link complete} and {@link remaining}. It MUST remain backward
 * compatible.
 */
export interface CleanupResult {
  /** `true` when every tagged resource for the run was removed (Req 20.8). */
  readonly complete: boolean;
  /**
   * The resources that could not be removed, each as a `type:id` label, reported
   * when the cleanup fails (Req 20.8). Empty when {@link complete} is `true`.
   */
  readonly remaining: ReadonlyArray<string>;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * Error raised for an invalid {@link LifecycleManager} configuration — a
 * negative cost/duration ceiling, a non-positive concurrency ceiling, or a
 * negative estimated creation cost.
 *
 * This is distinct from {@link CostLimitExceededError}: a configuration error is
 * a programming/usage fault surfaced eagerly (at construction or call), NOT the
 * in-budget/over-budget run outcome the cost guardrail models.
 */
export class LifecycleConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'LifecycleConfigurationError';
  }
}

/**
 * Error thrown AT the point a benchmark resource creation would push cumulative
 * estimated spend past the configured `maxCostUsd` ceiling (Req 20.6).
 *
 * It carries the full cost-accounting context so the {@link BenchmarkRunner} can
 * record a precise cost-limit run failure rather than a generic error: the
 * configured {@link limitUsd}, the {@link priorCostUsd} already accumulated, the
 * {@link attemptedCostUsd} of the rejected creation, and the
 * {@link projectedCostUsd} that would have resulted.
 */
export class CostLimitExceededError extends Error {
  /** The Bench_Run_Id whose cost ceiling was exceeded. */
  public readonly benchRunId: string;
  /** The configured maximum cost ceiling, in USD. */
  public readonly limitUsd: number;
  /** Cumulative spend already recorded before the rejected creation, in USD. */
  public readonly priorCostUsd: number;
  /** Estimated cost of the creation that was rejected, in USD. */
  public readonly attemptedCostUsd: number;
  /** The cumulative spend that would have resulted (`prior + attempted`), USD. */
  public readonly projectedCostUsd: number;

  public constructor(args: {
    readonly benchRunId: string;
    readonly limitUsd: number;
    readonly priorCostUsd: number;
    readonly attemptedCostUsd: number;
  }) {
    const projectedCostUsd = args.priorCostUsd + args.attemptedCostUsd;
    super(
      `Benchmark resource creation for run '${args.benchRunId}' would cost ` +
      `${args.attemptedCostUsd} USD on top of ${args.priorCostUsd} USD already ` +
      `recorded (projected ${projectedCostUsd} USD), exceeding the configured ` +
      `maximum cost limit of ${args.limitUsd} USD; failing the run at this ` +
      'creation point (Req 20.6).',
    );
    this.name = 'CostLimitExceededError';
    this.benchRunId = args.benchRunId;
    this.limitUsd = args.limitUsd;
    this.priorCostUsd = args.priorCostUsd;
    this.attemptedCostUsd = args.attemptedCostUsd;
    this.projectedCostUsd = projectedCostUsd;
  }
}

// ── LifecycleManager ──────────────────────────────────────────────────────────

/** Constructor inputs for a {@link LifecycleManager}. */
export interface LifecycleManagerOptions {
  /** The run this manager governs; its id is the ownership tag value (Req 20.1). */
  readonly benchRunId: string;
  /** The injected resource-cleanup capability (Req 20.2, 20.7). */
  readonly cleanupClient: BenchmarkResourceCleanupClient;
  /** Ownership tag key; defaults to {@link DEFAULT_OWNERSHIP_TAG_KEY} (Req 20.1). */
  readonly ownershipTagKey?: string;
  /** The run guardrails; omitted ceilings mean "no limit" (Req 20.3). */
  readonly guardrails?: RunGuardrails;
}

/**
 * Governs the lifecycle of one benchmark run's resources: ownership tagging, run
 * guardrails, and tag-scoped, all-or-nothing cleanup (Req 20).
 *
 * Construct it with the run's `Bench_Run_Id`, an injected
 * {@link BenchmarkResourceCleanupClient}, and the optional guardrails. The cost
 * guardrail is the only stateful concern (it accumulates spend across
 * {@link authorizeResourceCreation} calls); everything else is a pure function
 * of the construction inputs, which keeps the manager exhaustively unit-testable
 * with a mock client.
 *
 * @remarks
 * Validates: Requirements 20.1, 20.2, 20.3, 20.5, 20.6, 20.7, 20.8
 */
export class LifecycleManager {
  private readonly benchRunId: string;
  private readonly cleanupClient: BenchmarkResourceCleanupClient;
  private readonly ownershipTagKey: string;
  private readonly guardrailConfig: RunGuardrails;
  /** Cumulative estimated spend recorded across authorized creations, USD. */
  private cumulativeCostUsd: number;

  /**
   * @param options - The run id, injected cleanup client, ownership tag key, and
   *   guardrails. Invalid guardrail ceilings are rejected eagerly with a
   *   {@link LifecycleConfigurationError}; a `maxCostUsd` of `0` is VALID and is
   *   not a pre-flight block (Req 20.5).
   */
  public constructor(options: LifecycleManagerOptions) {
    if (options.benchRunId.length === 0) {
      throw new LifecycleConfigurationError('benchRunId must be a non-empty string.');
    }
    this.benchRunId = options.benchRunId;
    this.cleanupClient = options.cleanupClient;
    this.ownershipTagKey = options.ownershipTagKey ?? DEFAULT_OWNERSHIP_TAG_KEY;
    this.guardrailConfig = validateGuardrails(options.guardrails ?? {});
    this.cumulativeCostUsd = 0;
  }

  /**
   * Construct a manager backed by a real region-resolved {@link LambdaClient}
   * (production default). Tests use the constructor with a mock client.
   *
   * @param benchRunId - The run this manager governs.
   * @param options - Optional region, ownership tag key, guardrails, and the
   *   authoritative set of resources created for the run (typically derived from
   *   the Benchmark Manifest) the default Lambda-backed adapter cleans up.
   * @returns A manager backed by {@link LambdaBenchmarkResourceCleanup}.
   */
  public static withDefaultClient(
    benchRunId: string,
    options: {
      readonly region?: string;
      readonly ownershipTagKey?: string;
      readonly guardrails?: RunGuardrails;
      readonly knownResources?: ReadonlyArray<TaggedResource>;
    } = {},
  ): LifecycleManager {
    const config = options.region !== undefined ? { region: options.region } : {};
    const cleanupClient = new LambdaBenchmarkResourceCleanup(
      new LambdaClient(config),
      options.knownResources ?? [],
    );
    return new LifecycleManager({
      benchRunId,
      cleanupClient,
      ...(options.ownershipTagKey !== undefined ? { ownershipTagKey: options.ownershipTagKey } : {}),
      ...(options.guardrails !== undefined ? { guardrails: options.guardrails } : {}),
    });
  }

  /** The configured run guardrails (Req 20.3). */
  public get guardrails(): RunGuardrails {
    return this.guardrailConfig;
  }

  /** Cumulative estimated spend recorded so far for the run, in USD. */
  public get recordedCostUsd(): number {
    return this.cumulativeCostUsd;
  }

  // ── Ownership tagging (Req 20.1) ───────────────────────────────────────────

  /**
   * The ownership tag for this run: the configured key with the `Bench_Run_Id`
   * as its value (Req 20.1).
   *
   * @returns The `{ key, value }` ownership tag.
   */
  public ownershipTag(): OwnershipTag {
    return { key: this.ownershipTagKey, value: this.benchRunId };
  }

  /**
   * Merge the ownership tag into a resource's tag map, recording the
   * `Bench_Run_Id` (Req 20.1).
   *
   * The ownership tag ALWAYS wins: any same-keyed entry in {@link extraTags} is
   * overwritten, so a caller can never accidentally un-own or mis-scope a
   * benchmark resource.
   *
   * @param extraTags - Additional resource tags to include (optional).
   * @returns A fresh tag map containing the ownership tag plus the extras.
   */
  public tagsFor(extraTags: Readonly<Record<string, string>> = {}): Record<string, string> {
    return { ...extraTags, [this.ownershipTagKey]: this.benchRunId };
  }

  // ── Cost guardrail (Req 20.5, 20.6) ────────────────────────────────────────

  /**
   * Authorize a benchmark resource creation against the cost ceiling, recording
   * its estimated cost on success (Req 20.5, 20.6).
   *
   * The accounting is fail-at-creation, never pre-flight (Req 20.5): when no
   * `maxCostUsd` is configured the creation is always authorized; when one is
   * configured (including `0`), the creation is authorized iff the resulting
   * cumulative spend would not EXCEED the ceiling. A creation that would exceed
   * the ceiling throws {@link CostLimitExceededError} at this point and does NOT
   * accumulate (so the recorded spend reflects only authorized creations)
   * (Req 20.6). A zero-cost creation is always authorized, even under a zero
   * ceiling.
   *
   * @param estimatedCostUsd - The non-negative estimated USD cost of the creation.
   * @throws {LifecycleConfigurationError} If `estimatedCostUsd` is negative or
   *   not finite.
   * @throws {CostLimitExceededError} If authorizing would exceed `maxCostUsd`.
   */
  public authorizeResourceCreation(estimatedCostUsd: number): void {
    if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) {
      throw new LifecycleConfigurationError(
        `estimatedCostUsd must be a finite, non-negative number; got ${estimatedCostUsd}.`,
      );
    }
    const limit = this.guardrailConfig.maxCostUsd;
    if (limit !== undefined && this.cumulativeCostUsd + estimatedCostUsd > limit) {
      throw new CostLimitExceededError({
        benchRunId: this.benchRunId,
        limitUsd: limit,
        priorCostUsd: this.cumulativeCostUsd,
        attemptedCostUsd: estimatedCostUsd,
      });
    }
    this.cumulativeCostUsd += estimatedCostUsd;
  }

  // ── Duration / concurrency guardrails (Req 20.3, 20.4) ─────────────────────

  /**
   * Whether an elapsed run duration has exceeded the configured ceiling
   * (Req 20.4).
   *
   * @param elapsedMs - The elapsed run time, in milliseconds.
   * @returns `true` when a ceiling is configured and `elapsedMs` is strictly
   *   greater than it; `false` when no ceiling is configured.
   */
  public isRunDurationExceeded(elapsedMs: number): boolean {
    const limit = this.guardrailConfig.maxRunDurationMs;
    return limit !== undefined && elapsedMs > limit;
  }

  /**
   * Whether a concurrency level is within the configured ceiling (Req 20.3).
   *
   * @param concurrency - The concurrency level to check.
   * @returns `true` when no ceiling is configured or `concurrency` is at or below
   *   it; `false` when it exceeds the ceiling.
   */
  public isConcurrencyWithinLimit(concurrency: number): boolean {
    const limit = this.guardrailConfig.maxConcurrency;
    return limit === undefined || concurrency <= limit;
  }

  // ── Tag-scoped, all-or-nothing cleanup (Req 20.2, 20.7, 20.8) ──────────────

  /**
   * Remove every resource tagged for this run, atomically in reporting
   * (Req 20.2, 20.7, 20.8, Property 10).
   *
   * The pass resolves the resources tagged for the run, defensively re-scopes
   * the result to this run's `Bench_Run_Id` (so a mis-attributed resource from a
   * buggy client is never deleted — Req 20.7), then attempts to delete EVERY
   * resource, collecting any that fail rather than stopping at the first. If the
   * collected-failure set is non-empty the operation is reported as FAILED
   * ({@link CleanupResult.complete} `false`) with each remaining resource listed
   * as a `type:id` label (Req 20.8); otherwise it is complete with an empty
   * remaining set.
   *
   * @returns The cleanup outcome for this run.
   */
  public async cleanup(): Promise<CleanupResult> {
    const discovered = await this.cleanupClient.listTaggedResources(this.benchRunId);
    // Defensively remove only resources tagged for THIS run (Req 20.7): never
    // act on a resource a buggy/over-broad client mis-attributed to this run.
    const scoped = discovered.filter((resource) => resource.benchRunId === this.benchRunId);

    const remaining: string[] = [];
    for (const resource of scoped) {
      try {
        await this.cleanupClient.deleteResource(resource);
      } catch {
        // Collect and continue: cleanup attempts ALL resources, then reports the
        // ones that could not be removed (Req 20.8) rather than aborting early.
        remaining.push(`${resource.type}:${resource.id}`);
      }
    }

    return { complete: remaining.length === 0, remaining };
  }
}

/** Validate guardrail ceilings, returning a frozen normalized copy. */
function validateGuardrails(guardrails: RunGuardrails): RunGuardrails {
  if (guardrails.maxCostUsd !== undefined) {
    if (!Number.isFinite(guardrails.maxCostUsd) || guardrails.maxCostUsd < 0) {
      throw new LifecycleConfigurationError(
        `maxCostUsd must be a finite value of zero or greater; got ${guardrails.maxCostUsd} ` +
        '(a zero limit is allowed and is not a pre-flight block — Req 20.5).',
      );
    }
  }
  if (guardrails.maxConcurrency !== undefined) {
    if (!Number.isInteger(guardrails.maxConcurrency) || guardrails.maxConcurrency < 1) {
      throw new LifecycleConfigurationError(
        `maxConcurrency must be a positive integer; got ${guardrails.maxConcurrency}.`,
      );
    }
  }
  if (guardrails.maxRunDurationMs !== undefined) {
    if (!Number.isFinite(guardrails.maxRunDurationMs) || guardrails.maxRunDurationMs < 0) {
      throw new LifecycleConfigurationError(
        `maxRunDurationMs must be a finite, non-negative number of milliseconds; ` +
        `got ${guardrails.maxRunDurationMs}.`,
      );
    }
  }
  return {
    ...(guardrails.maxRunDurationMs !== undefined ? { maxRunDurationMs: guardrails.maxRunDurationMs } : {}),
    ...(guardrails.maxConcurrency !== undefined ? { maxConcurrency: guardrails.maxConcurrency } : {}),
    ...(guardrails.maxCostUsd !== undefined ? { maxCostUsd: guardrails.maxCostUsd } : {}),
  };
}

// ── Real AWS-SDK-backed cleanup adapter (Req 20.2) ───────────────────────────

/**
 * Adapter implementing {@link BenchmarkResourceCleanupClient} over a concrete
 * AWS SDK v3 {@link LambdaClient} (Req 20.2).
 *
 * It is the only place that constructs Lambda deletion command objects, keeping
 * the SDK surface isolated from the manager's cleanup orchestration. Production
 * callers obtain it via {@link LifecycleManager.withDefaultClient}; tests bypass
 * it entirely with a mock port.
 *
 * **Resource discovery.** The authoritative record of the resources created for
 * a run is the Benchmark Manifest (function/alias ARNs, log groups, event source
 * mapping UUIDs), each stamped with the ownership tag at creation time. The
 * adapter is therefore SEEDED with that known set and {@link listTaggedResources}
 * returns the subset whose `benchRunId` matches the targeted run — the ownership
 * tag value is the scoping key (Req 20.7). This avoids an account-wide tag scan
 * for resources the harness already knows it created.
 *
 * **Deletion scope.** This adapter deletes the Lambda-owned resource types via
 * `@aws-sdk/client-lambda` (the package's runtime dependency): `function`,
 * `alias`, `version` (DeleteFunction with a qualifier), `event-source-mapping`,
 * and `permission`. Non-Lambda resource types (`log-group`, `support`) are not
 * removable through the Lambda API; a deletion attempt for one throws, which the
 * {@link LifecycleManager} surfaces as a remaining resource (Req 20.8) — callers
 * that own those services compose a client that handles them. Mirrors the
 * `metrics-collector` boundary, which keeps the dev-only CloudWatch Logs client
 * out of the runtime surface.
 */
export class LambdaBenchmarkResourceCleanup implements BenchmarkResourceCleanupClient {
  private readonly client: LambdaClient;
  private readonly knownResources: ReadonlyArray<TaggedResource>;

  /**
   * @param client - The AWS SDK Lambda client used to issue deletions.
   * @param knownResources - The resources created for the run (from the manifest),
   *   each carrying its ownership `benchRunId`.
   */
  public constructor(client: LambdaClient, knownResources: ReadonlyArray<TaggedResource> = []) {
    this.client = client;
    this.knownResources = knownResources;
  }

  /** @inheritDoc */
  public async listTaggedResources(
    benchRunId: string,
  ): Promise<ReadonlyArray<TaggedResource>> {
    return this.knownResources.filter((resource) => resource.benchRunId === benchRunId);
  }

  /** @inheritDoc */
  public async deleteResource(resource: TaggedResource): Promise<void> {
    switch (resource.type) {
      case 'function':
        await this.client.send(
          new DeleteFunctionCommand({ FunctionName: resource.functionName ?? resource.id }),
        );
        return;
      case 'version':
        await this.client.send(
          new DeleteFunctionCommand({
            FunctionName: resource.functionName ?? resource.id,
            Qualifier: resource.qualifier,
          }),
        );
        return;
      case 'alias':
        await this.client.send(
          new DeleteAliasCommand({
            FunctionName: resource.functionName ?? resource.id,
            Name: resource.qualifier ?? resource.id,
          }),
        );
        return;
      case 'event-source-mapping':
        await this.client.send(new DeleteEventSourceMappingCommand({ UUID: resource.id }));
        return;
      case 'permission':
        await this.client.send(
          new RemovePermissionCommand({
            FunctionName: resource.functionName ?? resource.id,
            StatementId: resource.statementId ?? resource.id,
          }),
        );
        return;
      case 'log-group':
      case 'support':
      default:
        throw new LifecycleConfigurationError(
          `The Lambda-backed cleanup adapter cannot remove resource of type ` +
          `'${resource.type}' ('${resource.id}'); compose a cleanup client that ` +
          'handles this resource type.',
        );
    }
  }
}

// ── Backward-compatible free function (consumed by runner.ts) ────────────────

/** Options for the {@link cleanupRun} convenience function. */
export interface CleanupRunOptions {
  /** An injected cleanup client; when omitted a default Lambda-backed one is built. */
  readonly cleanupClient?: BenchmarkResourceCleanupClient;
  /** Ownership tag key; defaults to {@link DEFAULT_OWNERSHIP_TAG_KEY}. */
  readonly ownershipTagKey?: string;
  /** Region for the default client (when no client is injected). */
  readonly region?: string;
  /** The known resources for the run (from the manifest), for the default client. */
  readonly knownResources?: ReadonlyArray<TaggedResource>;
}

/**
 * Remove all resources tagged with the targeted Bench_Run_Id, atomically
 * (Req 20.2, 20.7, 20.8).
 *
 * This is the stable entry point consumed by `./runner` (its `CleanupRunner`
 * port and `DEFAULT_CLEANUP_RUNNER` call `cleanupRun(benchRunId)`); it delegates
 * to a {@link LifecycleManager}. When a {@link CleanupRunOptions.cleanupClient}
 * is supplied (tests, or a caller that owns resource discovery) it is used as-is;
 * otherwise a default {@link LambdaBenchmarkResourceCleanup} is constructed from
 * the optional known-resource set.
 *
 * @param benchRunId - The run whose tagged resources should be cleaned up.
 * @param options - Optional injected client / tag key / region / known resources.
 * @returns The cleanup result the runner reports.
 */
export async function cleanupRun(
  benchRunId: string,
  options: CleanupRunOptions = {},
): Promise<CleanupResult> {
  const manager = options.cleanupClient !== undefined
    ? new LifecycleManager({
      benchRunId,
      cleanupClient: options.cleanupClient,
      ...(options.ownershipTagKey !== undefined ? { ownershipTagKey: options.ownershipTagKey } : {}),
    })
    : LifecycleManager.withDefaultClient(benchRunId, {
      ...(options.region !== undefined ? { region: options.region } : {}),
      ...(options.ownershipTagKey !== undefined ? { ownershipTagKey: options.ownershipTagKey } : {}),
      ...(options.knownResources !== undefined ? { knownResources: options.knownResources } : {}),
    });
  return manager.cleanup();
}

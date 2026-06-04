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
 * Layer D — {@link BenchmarkRunner}: the run-time orchestration state machine
 * (run-time, CDK-free) (Req 18, 20.4).
 *
 * ## Responsibility
 *
 * The runner is the standalone, out-of-stack orchestrator that drives a single
 * benchmark run end-to-end. It is a deliberate state machine that mirrors the
 * design diagram exactly:
 *
 * ```text
 * ReadManifest → WaitSnapStartReady (per kata variant)
 *   ├─ not ready within wait → Invalid for that variant (Req 18.8)
 *   └─ ready → SelectMode
 *        ├─ observe-only  (default, Req 18.5): no trigger switching, baseline only
 *        ├─ benchmark     : ABBA for competing sources / parallel|req-resp otherwise
 *        └─ production-canary (Req 18.6): explicit opt-in REQUIRED
 *             └─ opt-in missing/failed → Blocked, NO fallback (Req 18.7)
 *   Benchmark → ABBA | ParallelOrReqResp → Collect → Report → Cleanup
 *   Benchmark → Stop (max duration exceeded, Req 20.4) → Cleanup
 * ```
 *
 * The runner OWNS the sequencing and gating decisions; it DELEGATES every side
 * effect to an injected subsystem ({@link RunnerSubsystems}): manifest loading,
 * SnapStart-readiness probing, event-source-mapping toggling, load generation,
 * metrics collection, report rendering, and tag-scoped cleanup. This is the
 * dependency-inversion seam that keeps the state machine pure, deterministic,
 * and unit-testable with mocked subsystems (no AWS, no network), and it keeps
 * the runner decoupled from subsystems still under construction.
 *
 * ## Key invariants
 *
 * - **ABBA fairness (Req 18.1–18.3).** A competing source is measured over the
 *   fixed window order {@link ABBA_SEQUENCE} (baseline → kata → kata → baseline),
 *   run back-to-back (close in time) with batch size and concurrency held
 *   CONSTANT across all four windows.
 * - **SnapStart-ready gate (Req 18.4, 18.8).** A kata variant is measured only
 *   after its SnapStart optimization reports ready; if it does not become ready
 *   within the configured wait, that variant's run is marked invalid with a
 *   recorded reason and the remaining variants still proceed.
 * - **Mode gating (Req 18.5–18.7).** Observe-only (the default) switches no
 *   trigger. Production-canary requires an explicit, valid opt-in; a missing or
 *   failed opt-in BLOCKS all production switching with no fallback path.
 * - **Bounded runs (Req 20.4, Property 16).** When the elapsed run time reaches
 *   the configured maximum, the runner stops generating further load and
 *   disables every benchmark-owned competing mapping before cleanup.
 *
 * ## CDK-free constraint
 *
 * This module imports the AWS SDK only (for the default SnapStart probe) and the
 * sibling CDK-free runner modules — never `aws-cdk-lib` / `constructs` (enforced
 * by `test/benchmark-runner-cdk-free.test.ts`).
 *
 * @remarks
 * Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 20.4
 *
 * @module benchmark/runner/runner
 */

import {
  LambdaClient,
  GetFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda';

import type { BenchmarkManifest, ManifestTrigger, ManifestVariant } from '../manifest';
import { ManifestLoader } from './manifest-loader';
import {
  TriggerToggler,
  type CompetingMappingPair,
  type ToggleVariant,
  type ActivateVariantResult,
} from './trigger-toggler';
import type {
  ReportSample,
  VariantMetrics,
  LogEventsQuery,
} from './metrics-collector';
import {
  TraceCorrelator,
  type BenchTriggerType,
  type CorrelatedSample,
  type CorrelationVariant,
} from './trace-correlator';
import { renderReport, type RenderedReport } from './report-renderer';
import { cleanupRun, type CleanupResult } from './lifecycle-manager';

// ── Run mode + control options ───────────────────────────────────────────────

/**
 * The run mode selected for a benchmark run (Req 18.5, 18.6).
 *
 * - `observe-only` — the conservative DEFAULT: clones keep disabled triggers and
 *   only baseline metrics are collected; NO trigger is ever switched (Req 18.5).
 * - `benchmark` — switches benchmark-owned, isolated event source mappings to run
 *   ABBA windows for competing sources (and parallel / request-response load
 *   otherwise); never touches a production trigger.
 * - `production-canary` — switches a real production trigger to a Kata_Variant;
 *   permitted ONLY behind an explicit, valid opt-in (Req 18.6, 18.7).
 */
export type RunMode = 'observe-only' | 'benchmark' | 'production-canary';

/**
 * The fixed ABBA window order for a Competing_Source (Req 18.1).
 *
 * Running baseline → kata → kata → baseline (rather than a single A/B pair)
 * averages out monotonic time-based drift in the shared dependencies the two
 * variants compete over: the baseline brackets the kata pair, so a linear trend
 * across the window cancels in the per-variant means.
 */
export const ABBA_SEQUENCE: readonly CorrelationVariant[] = [
  'baseline',
  'kata',
  'kata',
  'baseline',
];

/** Default number of SnapStart-readiness polls before a variant is invalidated. */
export const DEFAULT_SNAPSTART_MAX_POLLS = 60;

/** Default delay (ms) between SnapStart-readiness polls. */
export const DEFAULT_SNAPSTART_POLL_INTERVAL_MS = 5000;

/** Default per-window batch size, held constant across an ABBA sequence. */
export const DEFAULT_BATCH_SIZE = 10;

/** Default per-window concurrency, held constant across an ABBA sequence. */
export const DEFAULT_CONCURRENCY = 1;

/**
 * The explicit production-canary opt-in (Req 18.6, 18.7).
 *
 * Switching a real production trigger to a Kata_Variant is the single most
 * dangerous action the runner can take, so it is gated behind an explicit
 * acknowledgement and an OPTIONAL asynchronous confirmation hook that may fail
 * (e.g. an external guard/approval check). The opt-in is considered VALID only
 * when {@link acknowledged} is `true` AND, when supplied, {@link confirm}
 * resolves `true`. A missing opt-in, `acknowledged !== true`, a `false`
 * confirmation, or a throwing confirmation each BLOCK production switching with
 * no fallback (Req 18.7).
 */
export interface ProductionCanaryOptIn {
  /** Explicit acknowledgement that production triggers may be switched. */
  readonly acknowledged: boolean;
  /**
   * Optional async confirmation that can fail. Resolving `false` (or throwing)
   * is treated as a failed opt-in and blocks switching with no fallback.
   */
  readonly confirm?: () => Promise<boolean>;
}

/**
 * The control inputs for a single {@link BenchmarkRunner} invocation — the
 * "what to run and how" knobs, distinct from the injected subsystems that
 * perform the work.
 */
export interface RunnerControlOptions {
  /** SSM parameter name pointing at the manifest (read at run start). */
  readonly manifestParameterName: string;
  /** The run mode; defaults to the safe `observe-only` when omitted (Req 18.5). */
  readonly mode?: RunMode;
  /** The explicit production-canary opt-in; required for that mode (Req 18.6). */
  readonly productionCanaryOptIn?: ProductionCanaryOptIn;
  /** Per-window batch size, held CONSTANT across an ABBA sequence (Req 18.3). */
  readonly batchSize?: number;
  /** Per-window concurrency, held CONSTANT across an ABBA sequence (Req 18.3). */
  readonly concurrency?: number;
  /**
   * Hard ceiling on total run duration in milliseconds; on breach the runner
   * stops load and disables benchmark-owned mappings (Req 20.4). Omitted ⇒ no
   * duration ceiling.
   */
  readonly maxRunDurationMs?: number;
  /** Maximum SnapStart-readiness polls before invalidation (Req 18.8). */
  readonly snapStartMaxPolls?: number;
  /** Delay (ms) between SnapStart-readiness polls. */
  readonly snapStartPollIntervalMs?: number;
}

// ── Injected subsystem ports (dependency inversion) ──────────────────────────

/** The manifest-loading capability the runner depends on (Req 10.3). */
export interface ManifestSource {
  /**
   * Resolve the run's manifest from its SSM pointer.
   *
   * @param parameterName - The SSM parameter name handed to the runner.
   * @returns The parsed, schema-validated manifest body.
   */
  loadManifest(parameterName: string): Promise<BenchmarkManifest>;
}

/**
 * The normalized result of a single SnapStart-readiness probe (Req 18.4).
 *
 * `ready` is the only signal the polling loop acts on to PROCEED; `status`
 * carries the raw service status for diagnostics/recorded reasons; and
 * `terminalFailure` lets a probe short-circuit the poll loop when the version
 * has reached a terminal non-ready state (e.g. optimization `Failed`) so the
 * runner invalidates immediately instead of waiting out the full budget.
 */
export interface SnapStartReadinessResult {
  /** Whether the kata version's SnapStart optimization is ready to measure. */
  readonly ready: boolean;
  /** Raw service status string, surfaced in diagnostics and invalid reasons. */
  readonly status: string;
  /** When `true`, the state is terminally not-ready; stop polling early. */
  readonly terminalFailure?: boolean;
}

/**
 * The SnapStart-readiness probing capability the runner depends on (Req 18.4),
 * injected for testability. Production callers use {@link LambdaSnapStartProbe};
 * unit tests pass a mock that returns scripted readiness results.
 */
export interface SnapStartReadinessProbe {
  /**
   * Probe the SnapStart optimization status of a published kata version/alias.
   *
   * @param functionName - The kata function name.
   * @param qualifier - The published version or alias to probe.
   * @returns The normalized readiness result.
   */
  checkReadiness(
    functionName: string,
    qualifier: string,
  ): Promise<SnapStartReadinessResult>;
}

/**
 * The competing-mapping activation capability the runner depends on (Req 10.5),
 * satisfied by {@link TriggerToggler}. Expressed as a minimal port so unit tests
 * inject a recording mock.
 */
export interface VariantActivator {
  /** Activate exactly one variant of a competing pair for a window (Req 10.5). */
  activateVariant(
    pair: CompetingMappingPair,
    variant: ToggleVariant,
  ): Promise<ActivateVariantResult>;
  /** Disable BOTH competing mappings (safe state / max-duration stop) (Req 20.4). */
  disableBoth(pair: CompetingMappingPair): Promise<void>;
}

/**
 * A single window's load request handed to the {@link LoadDriver}.
 *
 * The runner composes this from the manifest variant, the window's active
 * variant, and the CONSTANT batch size / concurrency for the sequence (Req 18.3);
 * the driver (task 19's per-adapter generators, injected here) performs the
 * actual delivery with correlation markers.
 */
export interface WindowLoadRequest {
  /** Construct path of the variant pair the window measures. */
  readonly constructPath: string;
  /** The trigger type the load is generated for, when the variant has a trigger. */
  readonly triggerType?: BenchTriggerType;
  /** The variant the window targets/measures. */
  readonly variant: CorrelationVariant;
  /** The run phase label (e.g. the ABBA phase). */
  readonly phase: string;
  /** The window sequence number within the run. */
  readonly window: number;
  /** Batch size for the window; constant across an ABBA sequence (Req 18.3). */
  readonly batchSize: number;
  /** Concurrency for the window; constant across an ABBA sequence (Req 18.3). */
  readonly concurrency: number;
}

/**
 * The load-generation capability the runner depends on (Req 9.4–9.6), injected
 * for testability. The runner calls it once per window with the window's active
 * variant and the constant batch/concurrency; the concrete implementation routes
 * delivery per the trigger's routing class.
 */
export interface LoadDriver {
  /**
   * Generate one window's worth of load for the requested variant.
   *
   * @param request - The window's load request.
   */
  runWindowLoad(request: WindowLoadRequest): Promise<void>;
}

/**
 * The per-variant metrics-collection capability the runner depends on (Req 15),
 * satisfied by {@link MetricsCollector}. Expressed as a minimal port so unit
 * tests inject a mock returning scripted samples.
 */
export interface VariantMetricsSource {
  /**
   * Read and parse a variant's dedicated log group into its metrics.
   *
   * @param variant - The variant the query's log group belongs to.
   * @param query - The log group and optional run window to read.
   * @returns The variant's samples and error/throttle counts.
   */
  collect(
    variant: 'baseline' | 'kata',
    query: LogEventsQuery,
  ): Promise<VariantMetrics>;
}

/** The report-rendering capability the runner depends on (Req 17). */
export interface ReportSink {
  /**
   * Render the layered benchmark report from the collected samples.
   *
   * @param samples - The collected samples for both variants.
   * @returns The rendered JSON + HTML artifacts.
   */
  render(samples: ReadonlyArray<ReportSample>): RenderedReport;
}

/** The tag-scoped cleanup capability the runner depends on (Req 20.2, 20.7). */
export interface CleanupRunner {
  /**
   * Remove all resources tagged with the targeted Bench_Run_Id.
   *
   * @param benchRunId - The run whose tagged resources should be cleaned up.
   * @returns The cleanup result.
   */
  cleanupRun(benchRunId: string): Promise<CleanupResult>;
}

/**
 * The full set of subsystems a {@link BenchmarkRunner} orchestrates, injected as
 * a single explicit bundle (dependency inversion).
 *
 * Every field is a narrow PORT, not a concrete class, so the state machine is
 * decoupled from the subsystems' implementations and unit tests can supply
 * mocks. {@link clock} and {@link sleep} are injected timing seams: tests pass a
 * controllable clock and a no-op sleep so the duration guardrail and readiness
 * polling run deterministically without wall-clock waits.
 */
export interface RunnerSubsystems {
  /** Resolves the manifest from its SSM pointer (Req 10.3). */
  readonly manifestSource: ManifestSource;
  /** Probes kata SnapStart optimization readiness (Req 18.4). */
  readonly snapStartProbe: SnapStartReadinessProbe;
  /** Toggles competing event source mappings (Req 10.5). */
  readonly toggler: VariantActivator;
  /** Generates per-window load (Req 9.4–9.6). */
  readonly loadDriver: LoadDriver;
  /** Collects per-variant CloudWatch REPORT metrics (Req 15). */
  readonly metrics: VariantMetricsSource;
  /** Mints the Bench_Run_Id and correlates samples (Req 19). */
  readonly correlator: TraceCorrelator;
  /** Renders the layered report (Req 17). */
  readonly reportSink: ReportSink;
  /** Performs tag-scoped cleanup (Req 20.2, 20.7). */
  readonly cleanup: CleanupRunner;
  /** Monotonic clock (ms); defaults to {@link Date.now}. */
  readonly clock?: () => number;
  /** Delay used between polls; defaults to a `setTimeout`-based sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

// ── Result types ─────────────────────────────────────────────────────────────

/** The reason a run was stopped before completing its windows. */
export type RunStopReason = 'max-duration-exceeded';

/** The outcome of one measurement window. */
export interface WindowOutcome {
  /** The run phase label (e.g. the ABBA phase). */
  readonly phase: string;
  /** The window sequence number. */
  readonly window: number;
  /** The variant active/measured in the window. */
  readonly activeVariant: CorrelationVariant;
  /** Batch size used (constant across an ABBA sequence; Req 18.3). */
  readonly batchSize: number;
  /** Concurrency used (constant across an ABBA sequence; Req 18.3). */
  readonly concurrency: number;
}

/** The outcome for a single baseline/kata variant pair. */
export interface VariantRunOutcome {
  /** The construct path of the variant pair. */
  readonly constructPath: string;
  /**
   * `false` when the kata variant's SnapStart never became ready within the
   * configured wait — the variant is excluded from measurement (Req 18.8).
   */
  readonly valid: boolean;
  /** The recorded reason a variant was marked invalid (Req 18.8). */
  readonly invalidReason?: string;
  /** The measurement windows run for this variant (empty for invalid/observe). */
  readonly windows: ReadonlyArray<WindowOutcome>;
}

/** The full result of a benchmark run. */
export interface RunnerResult {
  /** The Bench_Run_Id this run was correlated under (Req 19.1). */
  readonly benchRunId: string;
  /** The resolved run mode. */
  readonly mode: RunMode;
  /** `true` when production-canary switching was blocked (Req 18.7). */
  readonly productionCanaryBlocked: boolean;
  /** The recorded reason production-canary switching was blocked (Req 18.7). */
  readonly productionCanaryBlockReason?: string;
  /** Set when the run was stopped before completing (e.g. max duration). */
  readonly stoppedReason?: RunStopReason;
  /** Per-variant outcomes, including invalidated variants (Req 18.8). */
  readonly variants: ReadonlyArray<VariantRunOutcome>;
  /** The correlated samples collected (omitted when the run stopped early). */
  readonly samples: ReadonlyArray<CorrelatedSample>;
  /** The rendered report (omitted when the run stopped early; Req 17). */
  readonly report?: RenderedReport;
  /** The cleanup outcome (Req 20.2, 20.7). */
  readonly cleanup?: CleanupResult;
}

// ── Default AWS-backed adapters ──────────────────────────────────────────────

/**
 * Default {@link SnapStartReadinessProbe} backed by `@aws-sdk/client-lambda`
 * `GetFunctionConfiguration` (Req 18.4).
 *
 * A published kata version is READY to measure when its `State` is `Active`
 * (the snapshot has been created and the version is invocable) and its
 * `SnapStart.OptimizationStatus` is `On` (the snapshot is optimized). A `Failed`
 * state is terminal — there is no point polling further — so the probe flags it
 * for early invalidation.
 */
export class LambdaSnapStartProbe implements SnapStartReadinessProbe {
  private readonly client: LambdaClient;

  /**
   * @param client - The AWS SDK Lambda client used to read function config.
   */
  public constructor(client: LambdaClient) {
    this.client = client;
  }

  /**
   * Build a probe backed by a real region-resolved {@link LambdaClient}.
   *
   * @param region - Optional explicit region; resolved from the provider chain
   *   when omitted.
   * @returns A probe backed by a real Lambda client.
   */
  public static withDefaultClient(region?: string): LambdaSnapStartProbe {
    const config = region !== undefined ? { region } : {};
    return new LambdaSnapStartProbe(new LambdaClient(config));
  }

  /** @inheritDoc */
  public async checkReadiness(
    functionName: string,
    qualifier: string,
  ): Promise<SnapStartReadinessResult> {
    const response = await this.client.send(
      new GetFunctionConfigurationCommand({
        FunctionName: functionName,
        Qualifier: qualifier,
      }),
    );
    const state = response.State ?? 'Unknown';
    const optimizationStatus = response.SnapStart?.OptimizationStatus ?? 'Unknown';
    const ready = state === 'Active' && optimizationStatus === 'On';
    return {
      ready,
      status: `${state}/${optimizationStatus}`,
      terminalFailure: state === 'Failed',
    };
  }
}

/** Real `setTimeout`-based delay used when no {@link sleep} is injected. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Default {@link ReportSink} delegating to the run-time {@link renderReport}. */
const DEFAULT_REPORT_SINK: ReportSink = {
  render: (samples) => renderReport(samples),
};

/** Default {@link CleanupRunner} delegating to the run-time {@link cleanupRun}. */
const DEFAULT_CLEANUP_RUNNER: CleanupRunner = {
  cleanupRun: (benchRunId) => cleanupRun(benchRunId),
};

// ── The state machine ────────────────────────────────────────────────────────

/**
 * The result of resolving the production-canary opt-in gate (Req 18.6, 18.7).
 *
 * @internal
 */
interface CanaryGateResult {
  readonly approved: boolean;
  readonly reason?: string;
}

/**
 * The result of waiting for a kata variant's SnapStart optimization to be ready
 * (Req 18.4, 18.8).
 *
 * @internal
 */
interface ReadinessOutcome {
  readonly ready: boolean;
  readonly reason?: string;
}

/**
 * The {@link BenchmarkRunner} drives a single benchmark run as an explicit state
 * machine over injected subsystems (Req 18, 20.4).
 *
 * Construct it with a fully-specified {@link RunnerSubsystems} bundle and the
 * {@link RunnerControlOptions}; the state machine itself performs no I/O beyond
 * the injected ports, which is what makes its sequencing/gating logic
 * exhaustively unit-testable. The convenience {@link runBenchmark} function wires
 * production defaults and is the entry point the CLI uses.
 *
 * @remarks
 * Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 20.4
 */
export class BenchmarkRunner {
  private readonly subsystems: RunnerSubsystems;
  private readonly options: RunnerControlOptions;
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly snapStartMaxPolls: number;
  private readonly snapStartPollIntervalMs: number;

  /**
   * @param subsystems - The fully-specified injected subsystem bundle.
   * @param options - The control inputs for this run.
   */
  public constructor(subsystems: RunnerSubsystems, options: RunnerControlOptions) {
    this.subsystems = subsystems;
    this.options = options;
    this.clock = subsystems.clock ?? Date.now;
    this.sleep = subsystems.sleep ?? defaultSleep;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.snapStartMaxPolls = options.snapStartMaxPolls ?? DEFAULT_SNAPSTART_MAX_POLLS;
    this.snapStartPollIntervalMs =
      options.snapStartPollIntervalMs ?? DEFAULT_SNAPSTART_POLL_INTERVAL_MS;
  }

  /**
   * Execute the benchmark run end-to-end (Req 18).
   *
   * The method walks the state machine: read manifest → wait SnapStart ready per
   * kata variant → select mode → run windows (ABBA for competing sources,
   * parallel/request-response otherwise) → collect → report → cleanup, enforcing
   * the max-duration guardrail throughout (Req 20.4).
   *
   * @returns The full {@link RunnerResult} describing the run.
   */
  public async run(): Promise<RunnerResult> {
    // ── ReadManifest ─────────────────────────────────────────────────────────
    const manifest = await this.subsystems.manifestSource.loadManifest(
      this.options.manifestParameterName,
    );
    const mode: RunMode = this.options.mode ?? 'observe-only';
    const benchRunId = this.subsystems.correlator.benchRunId;

    // ── SelectMode gating (production-canary opt-in, Req 18.6, 18.7) ──────────
    const canary = await this.resolveCanaryGate(mode);
    // Switching is permitted for `benchmark` always, and for an APPROVED
    // production-canary. Observe-only and a blocked canary switch nothing.
    const switchingAllowed =
      mode === 'benchmark' || (mode === 'production-canary' && canary.approved);

    // ── WaitSnapStartReady (per kata variant, Req 18.4, 18.8) ─────────────────
    const variantOutcomes: VariantRunOutcome[] = [];
    const measurable: ManifestVariant[] = [];
    for (const variant of manifest.variants) {
      const readiness = await this.waitForSnapStartReady(variant);
      if (!readiness.ready) {
        // Mark the run invalid for this variant and continue the others
        // (Req 18.8): never abort the whole run for one unready clone.
        variantOutcomes.push({
          constructPath: variant.constructPath,
          valid: false,
          invalidReason: readiness.reason,
          windows: [],
        });
        continue;
      }
      measurable.push(variant);
    }

    // ── Run windows (Benchmark → ABBA | ParallelOrReqResp), max-duration gated ─
    const startedAt = this.clock();
    let stoppedReason: RunStopReason | undefined;
    for (const variant of measurable) {
      if (this.maxDurationExceeded(startedAt)) {
        stoppedReason = 'max-duration-exceeded';
        break;
      }
      const windows = await this.runVariantWindows(
        variant,
        switchingAllowed,
        startedAt,
      );
      variantOutcomes.push({
        constructPath: variant.constructPath,
        valid: true,
        windows: windows.windows,
      });
      if (windows.stopped) {
        stoppedReason = 'max-duration-exceeded';
        break;
      }
    }
    // Any measurable variants not reached before a stop are still recorded as
    // valid (they were ready) but with no windows, so the result is complete.
    for (const variant of measurable) {
      if (!variantOutcomes.some((o) => o.constructPath === variant.constructPath)) {
        variantOutcomes.push({
          constructPath: variant.constructPath,
          valid: true,
          windows: [],
        });
      }
    }

    // ── Stop path (Req 20.4): disable benchmark-owned mappings, skip report ───
    if (stoppedReason !== undefined) {
      await this.disableBenchmarkOwnedMappings(manifest);
      const cleanup = await this.subsystems.cleanup.cleanupRun(benchRunId);
      return {
        benchRunId,
        mode,
        productionCanaryBlocked: mode === 'production-canary' && !canary.approved,
        ...(canary.reason !== undefined ? { productionCanaryBlockReason: canary.reason } : {}),
        stoppedReason,
        variants: variantOutcomes,
        samples: [],
        cleanup,
      };
    }

    // ── Collect → Report → Cleanup (normal path) ──────────────────────────────
    const collectKata = switchingAllowed; // only measured variants get kata samples
    const samples = await this.collectSamples(measurable, collectKata);
    const report = this.subsystems.reportSink.render(samples.map((s) => s.sample));
    const cleanup = await this.subsystems.cleanup.cleanupRun(benchRunId);

    return {
      benchRunId,
      mode,
      productionCanaryBlocked: mode === 'production-canary' && !canary.approved,
      ...(canary.reason !== undefined ? { productionCanaryBlockReason: canary.reason } : {}),
      variants: variantOutcomes,
      samples,
      report,
      cleanup,
    };
  }

  /**
   * Resolve the production-canary opt-in gate (Req 18.6, 18.7).
   *
   * For non-canary modes the gate is a no-op (approved with no reason). For
   * `production-canary` the opt-in must be present, `acknowledged === true`, and
   * — when a {@link ProductionCanaryOptIn.confirm} hook is supplied — confirm
   * `true`; any other outcome blocks switching with no fallback.
   *
   * @internal
   */
  private async resolveCanaryGate(mode: RunMode): Promise<CanaryGateResult> {
    if (mode !== 'production-canary') {
      return { approved: true };
    }
    const optIn = this.options.productionCanaryOptIn;
    if (optIn === undefined || optIn.acknowledged !== true) {
      return {
        approved: false,
        reason:
          'production-canary opt-in missing: an explicit acknowledged opt-in is ' +
          'required before any production trigger can be switched (Req 18.6).',
      };
    }
    if (optIn.confirm !== undefined) {
      try {
        const confirmed = await optIn.confirm();
        if (!confirmed) {
          return {
            approved: false,
            reason:
              'production-canary opt-in confirmation returned false; production ' +
              'switching is blocked with no fallback (Req 18.7).',
          };
        }
      } catch (error) {
        return {
          approved: false,
          reason:
            'production-canary opt-in confirmation failed: ' +
            `${(error as Error).message}; production switching is blocked with ` +
            'no fallback (Req 18.7).',
        };
      }
    }
    return { approved: true };
  }

  /**
   * Poll the kata variant's SnapStart optimization status until ready or the
   * configured wait elapses (Req 18.4, 18.8).
   *
   * The kata version's published version is the qualifier probed. A terminal
   * failure short-circuits the loop; exhausting the poll budget yields a
   * timeout reason. Either non-ready outcome marks the variant invalid.
   *
   * @internal
   */
  private async waitForSnapStartReady(
    variant: ManifestVariant,
  ): Promise<ReadinessOutcome> {
    const { functionName, version } = variant.kata;
    let polls = 0;
    // One initial probe plus up to snapStartMaxPolls re-probes after a sleep.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await this.subsystems.snapStartProbe.checkReadiness(
        functionName,
        version,
      );
      if (result.ready) {
        return { ready: true };
      }
      if (result.terminalFailure === true) {
        return {
          ready: false,
          reason:
            `kata variant '${functionName}' (version ${version}) reached a ` +
            `terminal SnapStart state '${result.status}'; marking the run ` +
            'invalid for this variant (Req 18.8).',
        };
      }
      if (polls >= this.snapStartMaxPolls) {
        return {
          ready: false,
          reason:
            `kata variant '${functionName}' (version ${version}) SnapStart did ` +
            `not report ready (last status '${result.status}') within ` +
            `${this.snapStartMaxPolls} polls; marking the run invalid for this ` +
            'variant (Req 18.8).',
        };
      }
      polls += 1;
      await this.sleep(this.snapStartPollIntervalMs);
    }
  }

  /**
   * Run the measurement windows for one ready variant, dispatching by routing
   * class and respecting the max-duration guardrail (Req 18.1–18.3, 20.4).
   *
   * - Observe-only / blocked canary (`switchingAllowed === false`) ⇒ no windows
   *   (baseline-only collection happens in the collect step), no switching.
   * - A competing source with both mapping UUIDs ⇒ the ABBA sequence.
   * - Any other (fan-out, shared-read, request-response) ⇒ one parallel
   *   measurement window per variant, no toggling.
   *
   * @internal
   */
  private async runVariantWindows(
    variant: ManifestVariant,
    switchingAllowed: boolean,
    startedAt: number,
  ): Promise<{ windows: WindowOutcome[]; stopped: boolean }> {
    if (!switchingAllowed) {
      return { windows: [], stopped: false };
    }
    if (isCompetingTrigger(variant.trigger)) {
      return this.runAbbaWindows(variant, startedAt);
    }
    return this.runParallelWindows(variant, startedAt);
  }

  /**
   * Run the fixed ABBA window sequence for a competing source (Req 18.1–18.3).
   *
   * Each window disables the non-active mapping then enables the active one (via
   * the toggler), generates one window of load for the active variant with the
   * CONSTANT batch size / concurrency, then advances. The max-duration guardrail
   * is checked before each window so a breach stops further load (Req 20.4).
   *
   * @internal
   */
  private async runAbbaWindows(
    variant: ManifestVariant,
    startedAt: number,
  ): Promise<{ windows: WindowOutcome[]; stopped: boolean }> {
    const pair = competingPairOf(variant.trigger as ManifestTrigger);
    const triggerType = variant.trigger?.type as BenchTriggerType | undefined;
    const windows: WindowOutcome[] = [];
    for (let index = 0; index < ABBA_SEQUENCE.length; index += 1) {
      if (this.maxDurationExceeded(startedAt)) {
        return { windows, stopped: true };
      }
      const active = ABBA_SEQUENCE[index];
      await this.subsystems.toggler.activateVariant(pair, active);
      await this.subsystems.loadDriver.runWindowLoad({
        constructPath: variant.constructPath,
        ...(triggerType !== undefined ? { triggerType } : {}),
        variant: active,
        phase: 'abba',
        window: index,
        batchSize: this.batchSize,
        concurrency: this.concurrency,
      });
      windows.push({
        phase: 'abba',
        window: index,
        activeVariant: active,
        batchSize: this.batchSize,
        concurrency: this.concurrency,
      });
    }
    return { windows, stopped: false };
  }

  /**
   * Run a single measurement window per variant for a non-competing source
   * (fan-out / shared-read / request-response), without toggling any mapping.
   *
   * The max-duration guardrail is checked before each window (Req 20.4).
   *
   * @internal
   */
  private async runParallelWindows(
    variant: ManifestVariant,
    startedAt: number,
  ): Promise<{ windows: WindowOutcome[]; stopped: boolean }> {
    const triggerType = variant.trigger?.type as BenchTriggerType | undefined;
    const windows: WindowOutcome[] = [];
    let index = 0;
    for (const active of ['baseline', 'kata'] as const) {
      if (this.maxDurationExceeded(startedAt)) {
        return { windows, stopped: true };
      }
      await this.subsystems.loadDriver.runWindowLoad({
        constructPath: variant.constructPath,
        ...(triggerType !== undefined ? { triggerType } : {}),
        variant: active,
        phase: 'parallel',
        window: index,
        batchSize: this.batchSize,
        concurrency: this.concurrency,
      });
      windows.push({
        phase: 'parallel',
        window: index,
        activeVariant: active,
        batchSize: this.batchSize,
        concurrency: this.concurrency,
      });
      index += 1;
    }
    return { windows, stopped: false };
  }

  /**
   * Collect and correlate samples for each measurable variant (Req 15, 19.3).
   *
   * Baseline samples are always collected; kata samples are collected only when
   * the kata variant was measured (`collectKata`). Samples are correlated to the
   * run/variant/phase/window coordinate via the {@link TraceCorrelator}; the
   * window coordinate is `0` here because collection reads the variant's whole
   * dedicated log group rather than a per-window slice.
   *
   * @internal
   */
  private async collectSamples(
    variants: ReadonlyArray<ManifestVariant>,
    collectKata: boolean,
  ): Promise<CorrelatedSample[]> {
    const correlated: CorrelatedSample[] = [];
    for (const variant of variants) {
      const triggerType = (variant.trigger?.type ?? 'invoke') as BenchTriggerType;

      const baseline = await this.subsystems.metrics.collect('baseline', {
        logGroupName: variant.baseline.logGroup,
      });
      correlated.push(
        ...this.subsystems.correlator.correlate(
          triggerType,
          baseline.samples,
          'baseline',
          'collect',
          0,
        ),
      );

      if (collectKata) {
        const kata = await this.subsystems.metrics.collect('kata', {
          logGroupName: variant.kata.logGroup,
        });
        correlated.push(
          ...this.subsystems.correlator.correlate(
            triggerType,
            kata.samples,
            'kata',
            'collect',
            0,
          ),
        );
      }
    }
    return correlated;
  }

  /**
   * Disable every benchmark-owned competing mapping in the manifest (Req 20.4).
   *
   * Invoked on the max-duration stop path: each competing variant pair's
   * mappings are driven to disabled via the toggler so no further benchmark load
   * can be delivered through them.
   *
   * @internal
   */
  private async disableBenchmarkOwnedMappings(
    manifest: BenchmarkManifest,
  ): Promise<void> {
    for (const variant of manifest.variants) {
      if (isCompetingTrigger(variant.trigger)) {
        await this.subsystems.toggler.disableBoth(
          competingPairOf(variant.trigger as ManifestTrigger),
        );
      }
    }
  }

  /**
   * Whether the elapsed run time has reached the configured maximum (Req 20.4).
   *
   * Returns `false` when no ceiling is configured. The comparison is `>=` so a
   * run that has consumed exactly its budget is treated as exceeded.
   *
   * @internal
   */
  private maxDurationExceeded(startedAt: number): boolean {
    const max = this.options.maxRunDurationMs;
    if (max === undefined) {
      return false;
    }
    return this.clock() - startedAt >= max;
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Whether a manifest trigger is a competing source with both event source
 * mapping UUIDs present (so it can be ABBA-toggled at run time).
 *
 * @param trigger - The manifest trigger, when the variant has one.
 * @returns `true` when the trigger is competing and fully wired for toggling.
 */
function isCompetingTrigger(trigger: ManifestTrigger | undefined): boolean {
  return (
    trigger !== undefined &&
    trigger.routingClass === 'competing' &&
    typeof trigger.baselineMappingUuid === 'string' &&
    typeof trigger.kataMappingUuid === 'string'
  );
}

/**
 * Extract the competing mapping pair from a manifest trigger known to be
 * competing (caller guarantees via {@link isCompetingTrigger}).
 *
 * @param trigger - The competing manifest trigger.
 * @returns The baseline/kata mapping UUID pair.
 */
function competingPairOf(trigger: ManifestTrigger): CompetingMappingPair {
  return {
    baselineMappingUuid: trigger.baselineMappingUuid as string,
    kataMappingUuid: trigger.kataMappingUuid as string,
  };
}

// ── Convenience entry point ──────────────────────────────────────────────────

/**
 * Options controlling a single {@link runBenchmark} invocation.
 *
 * Extends {@link RunnerControlOptions} with production wiring knobs: an optional
 * explicit AWS `region` for the default AWS-backed adapters, and a
 * {@link RunnerSubsystems} `subsystems` override so callers (and tests) can
 * inject any subset of subsystems while the rest fall back to defaults. The two
 * subsystems with no AWS-self-wireable default — {@link RunnerSubsystems.metrics}
 * (its CloudWatch Logs reader is a devDependency) and
 * {@link RunnerSubsystems.loadDriver} — MUST be supplied via `subsystems`.
 */
export interface RunnerOptions extends RunnerControlOptions {
  /** Optional explicit AWS region for the default AWS-backed adapters. */
  readonly region?: string;
  /** Optional subsystem overrides; unspecified ports fall back to defaults. */
  readonly subsystems?: Partial<RunnerSubsystems>;
}

/**
 * Execute a benchmark run end-to-end with production defaults (Req 18).
 *
 * Wires the AWS-backed defaults that can self-construct — the manifest loader,
 * the SnapStart probe, and the trigger toggler — together with a fresh
 * {@link TraceCorrelator}, the default report sink, and the default cleanup
 * runner, then runs the {@link BenchmarkRunner}. Any subsystem supplied in
 * {@link RunnerOptions.subsystems} overrides its default. The metrics collector
 * and load driver have no self-wireable default and MUST be provided via
 * `subsystems`; a clear error is raised if a run reaches a step that needs one
 * and it is absent.
 *
 * @param options - The runner options, including the manifest pointer.
 * @returns The full {@link RunnerResult}.
 */
export async function runBenchmark(options: RunnerOptions): Promise<RunnerResult> {
  const overrides = options.subsystems ?? {};
  const subsystems: RunnerSubsystems = {
    manifestSource:
      overrides.manifestSource ?? ManifestLoader.withDefaultClients(options.region),
    snapStartProbe:
      overrides.snapStartProbe ?? LambdaSnapStartProbe.withDefaultClient(options.region),
    toggler: overrides.toggler ?? TriggerToggler.withDefaultClient(options.region),
    loadDriver: overrides.loadDriver ?? MISSING_LOAD_DRIVER,
    metrics: overrides.metrics ?? MISSING_METRICS_SOURCE,
    correlator: overrides.correlator ?? new TraceCorrelator(),
    reportSink: overrides.reportSink ?? DEFAULT_REPORT_SINK,
    cleanup: overrides.cleanup ?? DEFAULT_CLEANUP_RUNNER,
    ...(overrides.clock !== undefined ? { clock: overrides.clock } : {}),
    ...(overrides.sleep !== undefined ? { sleep: overrides.sleep } : {}),
  };
  return new BenchmarkRunner(subsystems, options).run();
}

/**
 * Placeholder {@link LoadDriver} that fails fast with a descriptive error when a
 * run reaches the load step without an injected driver. The per-adapter load
 * generators (task 19) or a test mock must be supplied via
 * {@link RunnerOptions.subsystems}.
 *
 * @internal
 */
const MISSING_LOAD_DRIVER: LoadDriver = {
  runWindowLoad: () => {
    throw new Error(
      'No LoadDriver configured: supply `subsystems.loadDriver` (the per-adapter ' +
      'load generators) to run benchmark windows.',
    );
  },
};

/**
 * Placeholder {@link VariantMetricsSource} that fails fast with a descriptive
 * error when a run reaches the collect step without an injected collector. A
 * {@link MetricsCollector} (with a CloudWatch Logs reader) or a test mock must be
 * supplied via {@link RunnerOptions.subsystems}.
 *
 * @internal
 */
const MISSING_METRICS_SOURCE: VariantMetricsSource = {
  collect: () => {
    throw new Error(
      'No VariantMetricsSource configured: supply `subsystems.metrics` (a ' +
      'MetricsCollector with a CloudWatch Logs reader) to collect samples.',
    );
  },
};

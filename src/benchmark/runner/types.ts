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
 * Layer D — Shared run-time report types (run-time, CDK-free).
 *
 * This module is the single source of truth for the **run-time** data model the
 * runner produces and the {@link ReportRenderer} (task 22) serializes: the
 * reusable {@link Distribution} primitive, the per-variant {@link VariantStats}
 * aggregate, and the top-level {@link BenchmarkReport}. The per-invocation
 * {@link ReportSample} lives in `./metrics-collector` (it is the collector's
 * owned output type); this module **re-exports** it so downstream consumers have
 * one import site for the run-time report surface without duplicating its shape.
 *
 * ## Why these shapes (Req 17 — honest, layered, never merged)
 *
 * The report is deliberately **layered and never collapsed into a single
 * "winner" number** (Req 17.1, 17.2). Cold-start, handler execution, and trigger
 * delivery are distinct metric layers measured independently, so the types here
 * keep their distributions separate rather than folding them into one score.
 * The three non-merged layers described in the design are:
 *
 * 1. **Runtime Cold-Start** — Init (baseline) vs Restore (kata) platform phase,
 *    plus the composed {@link VariantStats.coldInvokeServerTime}.
 * 2. **Handler Execution** — warm Duration, first-invoke-after-restore Duration,
 *    billed time, and memory.
 * 3. **Trigger Delivery** — source-specific delivery metrics (Req 17.4).
 *
 * Every interface here is `readonly` and JSON-serializable: the renderer emits
 * the report as JSON (and HTML) and the shapes must round-trip without behavior.
 *
 * This module imports NO `aws-cdk-lib` and NO AWS SDK — it is pure data types,
 * keeping the runner package free of `aws-cdk-lib` (enforced by the guard test
 * added in task 16) and import-cheap.
 *
 * @remarks
 * Validates: Requirements 17.1, 17.2, 17.3, 17.6, 17.7
 *
 * @module benchmark/runner/types
 */

import type { ReportSample } from './metrics-collector';
// Type-only import (erased at compile time): the run-time report carries the
// synth-time Run_Design verbatim (Req 17.5). This is a `import type` so NO
// runtime `require` is emitted and the runner package stays CDK-free — exactly
// as `./runner` already imports the manifest types.
import type { RunDesign } from '../manifest';

/**
 * Re-export of the per-invocation sample produced by the {@link MetricsCollector}.
 *
 * {@link ReportSample} is owned by `./metrics-collector` (its parser is the sole
 * producer); it is surfaced here so the run-time report surface has a single
 * import site. There is intentionally exactly one definition — this is a
 * re-export, not a redefinition.
 */
export type { ReportSample };

/**
 * Marker recorded on a {@link Distribution} (or omitted percentile) when a
 * statistic was withheld because the sample count fell below the reporting
 * threshold (Req 17.6).
 *
 * Statistical hygiene: high percentiles (p90/p95/p99) are not meaningful on a
 * handful of samples, so they are suppressed rather than reported misleadingly.
 */
export type SuppressionReason = 'insufficient-samples';

/**
 * A statistical summary of a numeric series (e.g. handler durations, billed
 * milliseconds, restore times) — the reusable distribution primitive shared by
 * all metric layers.
 *
 * All times are milliseconds and all values are non-negative. Percentiles are
 * explicit and ordered (`p50 ≤ p90 ≤ p95 ≤ p99`) for a well-formed series. The
 * high percentiles ({@link p90}, {@link p95}, {@link p99}) are OPTIONAL: they
 * are omitted (left `undefined`) when the sample count is below the reporting
 * threshold, in which case {@link suppressed} records WHY (Req 17.6). The basic
 * summary fields ({@link count}, {@link min}, {@link max}, {@link mean},
 * {@link p50}, {@link stddev}) are always present.
 */
export interface Distribution {
  /** Number of samples the distribution was computed from. */
  readonly count: number;
  /** Smallest observed value (ms). */
  readonly min: number;
  /** Largest observed value (ms). */
  readonly max: number;
  /** Arithmetic mean of the series (ms). */
  readonly mean: number;
  /** Sample standard deviation of the series (ms). */
  readonly stddev: number;
  /** 50th percentile / median (ms); always present. */
  readonly p50: number;
  /** 90th percentile (ms); omitted below the sample threshold (Req 17.6). */
  readonly p90?: number;
  /** 95th percentile (ms); omitted below the sample threshold (Req 17.6). */
  readonly p95?: number;
  /** 99th percentile (ms); omitted below the sample threshold (Req 17.6). */
  readonly p99?: number;
  /** Set when high percentiles were withheld; records WHY (Req 17.6). */
  readonly suppressed?: SuppressionReason;
}

/**
 * The variant a {@link VariantStats} block describes — the immutable baseline
 * (Node.js) or the kata clone (SnapStart). Mirrors {@link ReportSample.variant}.
 */
export type VariantId = 'baseline' | 'kata';

/**
 * Per-variant aggregate statistics over all collected {@link ReportSample}s for
 * a single variant (`'baseline'` or `'kata'`), aligned field-for-field with the
 * sample shape so the collector → stats projection is mechanical.
 *
 * The cold-start distributions are split by variant semantics — {@link init}
 * (baseline cold startup) and {@link restore} (kata cold startup) are NOT
 * merged (Req 17.1) — and {@link coldInvokeServerTime} carries the composed,
 * honest cold-path latency (Req 16). All distribution-bearing fields reuse the
 * {@link Distribution} primitive; the optional ones are omitted when the
 * variant produced no samples of that kind (e.g. a baseline has no
 * {@link restore}, a kata has no {@link init}).
 */
export interface VariantStats {
  /** Which variant these statistics describe. */
  readonly variant: VariantId;
  /** Total number of samples (cold + warm) for the variant. */
  readonly n: number;
  /** Number of cold-start samples among {@link n}. */
  readonly coldSamples: number;
  /** Baseline cold-start platform phase (Init); present for baseline only. */
  readonly init?: Distribution;
  /** Kata cold-start platform phase (Restore); present for kata only. */
  readonly restore?: Distribution;
  /** Warm handler Duration distribution (Req 17.3). */
  readonly warmDuration: Distribution;
  /** Composed cold-invoke server time (startup + same-invoke duration; Req 16). */
  readonly coldInvokeServerTime?: Distribution;
  /** Billed-duration distribution (ms). */
  readonly billed: Distribution;
  /** Max-memory-used distribution (MB). */
  readonly maxMemoryMb: Distribution;
  /** Count of invocations that errored. */
  readonly errors: number;
  /** Count of invocations that were throttled. */
  readonly throttles: number;
  /**
   * `false` when the variant produced zero cold samples — the block is still
   * INCLUDED but flagged not statistically valid (Req 17.7).
   */
  readonly statisticallyValid: boolean;
}

/**
 * The headline experienced-latency line of a {@link BenchmarkReport}.
 *
 * This is the single user-facing comparison, and it is explicitly NOT a merged
 * "winner" score: it reports the experienced latency for each variant side by
 * side with a {@link note} explaining the decomposition, so the layered metrics
 * remain the source of truth (Req 17.2).
 */
export interface BenchmarkHeadline {
  /** Discriminant fixing the headline to experienced-latency (Req 17.2). */
  readonly metric: 'experienced-latency';
  /** Experienced latency for the immutable baseline variant (ms). */
  readonly baseline: number;
  /** Experienced latency for the kata clone variant (ms). */
  readonly kata: number;
  /** Human-readable decomposition note (never a single combined number). */
  readonly note: string;
}

/**
 * The top-level benchmark run report (Req 17) — the artifact the
 * {@link ReportRenderer} (task 22) serializes to JSON and HTML.
 *
 * It carries the run identifier, per-variant {@link VariantStats} for the
 * baseline and kata variants, and report metadata. The two variants are kept as
 * distinct, non-merged blocks (Req 17.1): there is no combined per-metric figure
 * here — only the explicit {@link BenchmarkHeadline} experienced-latency line.
 *
 * Later tasks populate ({@link MetricsCollector}, task 17) and render
 * ({@link ReportRenderer}, task 22) this report; task 16 only fixes its shape.
 */
export interface BenchmarkReport {
  /** The unique run identifier (Bench_Run_Id) minted at run start (Req 19.1). */
  readonly benchRunId: string;
  /** ISO-8601 timestamp recording when the report was generated. */
  readonly generatedAt: string;
  /** Aggregate statistics for the immutable baseline variant. */
  readonly baseline: VariantStats;
  /** Aggregate statistics for the kata (SnapStart) clone variant. */
  readonly kata: VariantStats;
  /** The experienced-latency headline (never a merged winner number; Req 17.2). */
  readonly headline: BenchmarkHeadline;
}

// ── Layered report model (task 22 — ReportRenderer) ──────────────────────────

/**
 * The stable identifier of one of the three non-merged metric layers (Req 17.1).
 *
 * These are deliberately distinct, machine-stable ids so downstream tooling can
 * key on a layer WITHOUT collapsing the three into one (Req 17.2).
 */
export type MetricLayerId =
  | 'runtime-cold-start'
  | 'handler-execution'
  | 'trigger-delivery';

/**
 * Fields every metric layer carries, regardless of its specific shape.
 *
 * {@link merged} is invariably `false`: it is an explicit, serialized assertion
 * that the layer was NOT folded into a single aggregate score (Req 17.2). The
 * three layers are surfaced side by side; none is ever combined with another.
 */
export interface MetricLayerBase {
  /** The layer's stable identifier (Req 17.1). */
  readonly id: MetricLayerId;
  /** Human-readable layer title for the rendered report. */
  readonly title: string;
  /** Always `false` — layers are never merged into one score (Req 17.2). */
  readonly merged: false;
}

/**
 * The Runtime Cold-Start view for a SINGLE variant (Req 16.3, 16.4, 17.1).
 *
 * The platform startup phase ({@link platformPhase} — Init for baseline, Restore
 * for kata) and the composed {@link coldInvokeServerTime} are kept as DISTINCT
 * distributions (Req 16.3); a report must never present the platform-phase-only
 * figure as the cold-start result without the server time (Req 16.4).
 */
export interface ColdStartVariantView {
  /** Which variant this view describes. */
  readonly variant: VariantId;
  /** Number of cold-start samples observed for the variant (Req 17.7). */
  readonly coldSamples: number;
  /** Platform startup phase (Init/Restore); absent when no cold samples. */
  readonly platformPhase?: Distribution;
  /** Composed cold-invoke server time (startup + duration); absent if no cold. */
  readonly coldInvokeServerTime?: Distribution;
  /** `false` when the variant produced zero cold samples (Req 17.7). */
  readonly statisticallyValid: boolean;
  /** `true` when high percentiles were withheld below threshold (Req 17.6). */
  readonly highPercentilesSuppressed: boolean;
}

/**
 * Layer 1 — Runtime Cold-Start (Req 17.1). Init (baseline) vs Restore (kata)
 * platform phase, plus the honest {@link ColdStartVariantView.coldInvokeServerTime}.
 *
 * The two variant views are SEPARATE objects (Req 17.2): there is no combined
 * cold-start number on this layer.
 */
export interface RuntimeColdStartLayer extends MetricLayerBase {
  readonly id: 'runtime-cold-start';
  readonly baseline: ColdStartVariantView;
  readonly kata: ColdStartVariantView;
}

/**
 * The Handler Execution view for a SINGLE variant (Req 17.1).
 *
 * Warm handler duration, billed time, and memory — the steady-state cost once a
 * variant is past its startup phase.
 */
export interface HandlerExecutionVariantView {
  /** Which variant this view describes. */
  readonly variant: VariantId;
  /** Total samples (cold + warm) for the variant. */
  readonly n: number;
  /** Warm handler Duration distribution. */
  readonly warmDuration: Distribution;
  /** Billed-duration distribution (ms). */
  readonly billed: Distribution;
  /** Max-memory-used distribution (MB). */
  readonly maxMemoryMb: Distribution;
  /** `true` when high percentiles were withheld below threshold (Req 17.6). */
  readonly highPercentilesSuppressed: boolean;
}

/**
 * Layer 2 — Handler Execution (Req 17.1). Warm Duration, billed time, and
 * memory, kept as distinct baseline/kata views (Req 17.2).
 */
export interface HandlerExecutionLayer extends MetricLayerBase {
  readonly id: 'handler-execution';
  readonly baseline: HandlerExecutionVariantView;
  readonly kata: HandlerExecutionVariantView;
}

/**
 * Source-specific delivery metrics for the Trigger Delivery layer (Req 17.4).
 *
 * Each field is OPTIONAL: a source surfaces only the delivery metrics that are
 * meaningful for it (e.g. SQS enqueue-to-start, Kinesis/DynamoDB iterator age,
 * stream consumer lag, batch latency). Absent fields mean "not available for
 * this source", never zero.
 */
export interface TriggerDeliveryMetrics {
  /** Enqueue-to-start latency (e.g. SQS) (Req 17.4). */
  readonly enqueueToStartMs?: Distribution;
  /** Consumer lag (e.g. Kafka/streams) (Req 17.4). */
  readonly consumerLagMs?: Distribution;
  /** Iterator age (e.g. Kinesis, DynamoDB Streams) (Req 17.4). */
  readonly iteratorAgeMs?: Distribution;
  /** Per-batch processing latency (Req 17.4). */
  readonly batchLatencyMs?: Distribution;
}

/**
 * A derived aggregate value, explicitly labeled as derived, trigger-specific,
 * and non-universal (Req 17.3).
 *
 * Any figure computed by combining other measurements is surfaced through this
 * shape so the three required labels travel WITH the value and cannot be read as
 * a universal score: {@link derived} `=== true`, {@link triggerSpecific}
 * `=== true`, {@link universal} `=== false`.
 */
export interface DerivedAggregate {
  /** Stable id of the derived aggregate. */
  readonly id: string;
  /** Human-readable label. */
  readonly label: string;
  /** The derived numeric value (ms unless the label states otherwise). */
  readonly value: number;
  /** Always `true` — this value is derived, not directly measured (Req 17.3). */
  readonly derived: true;
  /** Always `true` — meaningful only for this trigger/source (Req 17.3). */
  readonly triggerSpecific: true;
  /** Always `false` — NOT a universal/cross-source score (Req 17.3). */
  readonly universal: false;
}

/**
 * Layer 3 — Trigger Delivery (Req 17.4). Source-specific delivery metrics, with
 * any derived aggregate explicitly labeled (Req 17.3).
 *
 * {@link available} is `false` when the run carried no source delivery metrics
 * (e.g. a request/response source, or metrics not collected); the layer is still
 * PRESENT and non-merged so the report's three-layer structure is invariant.
 */
export interface TriggerDeliveryLayer extends MetricLayerBase {
  readonly id: 'trigger-delivery';
  /** Whether any source-specific delivery metric was available (Req 17.4). */
  readonly available: boolean;
  /** The source-specific delivery metrics, when available (Req 17.4). */
  readonly metrics?: TriggerDeliveryMetrics;
  /** Derived aggregates, each labeled derived/trigger-specific/non-universal. */
  readonly derivedAggregates: ReadonlyArray<DerivedAggregate>;
}

/** The bundle of all three non-merged metric layers (Req 17.1, 17.2). */
export interface MetricLayers {
  /** Layer 1 — Runtime Cold-Start. */
  readonly runtimeColdStart: RuntimeColdStartLayer;
  /** Layer 2 — Handler Execution. */
  readonly handlerExecution: HandlerExecutionLayer;
  /** Layer 3 — Trigger Delivery. */
  readonly triggerDelivery: TriggerDeliveryLayer;
}

/**
 * A single measurement window recorded into the Run_Design view of the report
 * (Req 17.5) — e.g. one ABBA window. Structurally mirrors the runner's window
 * outcome so the runner can hand its windows straight to the renderer.
 */
export interface RunWindowRecord {
  /** The run phase label (e.g. `abba`, `parallel`). */
  readonly phase: string;
  /** The window sequence number within the run. */
  readonly window: number;
  /** The variant active/measured in the window. */
  readonly activeVariant: VariantId;
  /** Batch size used for the window. */
  readonly batchSize: number;
  /** Concurrency used for the window. */
  readonly concurrency: number;
}

/**
 * The full layered benchmark report artifact serialized by the
 * {@link ReportRenderer} (task 22) to JSON (and rendered to HTML).
 *
 * It is the honest, layered superset of {@link BenchmarkReport}: it keeps the
 * per-variant {@link VariantStats} and the experienced-latency
 * {@link BenchmarkHeadline}, and adds the three non-merged {@link MetricLayers}
 * (Req 17.1, 17.2), the recorded {@link RunDesign} and {@link windows} of the
 * run (Req 17.5). There is no merged per-metric score anywhere in this artifact.
 */
export interface LayeredBenchmarkReport {
  /** The unique run identifier (Bench_Run_Id), when known (Req 19.1). */
  readonly benchRunId?: string;
  /** ISO-8601 timestamp recording when the report was generated. */
  readonly generatedAt: string;
  /** Per-variant aggregate statistics (baseline + kata), never merged. */
  readonly variants: {
    readonly baseline: VariantStats;
    readonly kata: VariantStats;
  };
  /** The three non-merged metric layers (Req 17.1, 17.2). */
  readonly layers: MetricLayers;
  /** The experienced-latency headline with layer-decomposition note (Req 17.8). */
  readonly headline: BenchmarkHeadline;
  /** The recorded Run_Design (source, routing, fidelity, …) (Req 17.5). */
  readonly runDesign?: RunDesign;
  /** The measurement windows run (e.g. ABBA windows) (Req 17.5). */
  readonly windows: ReadonlyArray<RunWindowRecord>;
}

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
 * Layer D — {@link ReportRenderer}: the layered benchmark report (run-time,
 * CDK-free).
 *
 * ## Responsibility
 *
 * The renderer turns the collected per-invocation {@link ReportSample}s into the
 * honest, layered benchmark report (Req 17) and serializes it as BOTH JSON and
 * HTML. It is the productized form of the proven sandbox report and is built
 * from small, single-responsibility pieces:
 *
 * 1. **Pure statistics** ({@link computeDistribution}) — `number[] → Distribution`
 *    with high-percentile suppression below a configurable sample threshold
 *    (Req 17.6). No I/O, exhaustively property-tested.
 * 2. **Per-variant aggregation** ({@link buildVariantStats}) — projects a
 *    variant's samples into the {@link VariantStats} shape, splitting cold/warm
 *    series and marking a zero-cold variant statistically invalid yet KEEPING it
 *    (Req 17.7).
 * 3. **Layer composition** ({@link ReportRenderer}) — assembles the THREE
 *    non-merged metric layers (Runtime Cold-Start, Handler Execution, Trigger
 *    Delivery), the experienced-latency headline with its decomposition note,
 *    the recorded Run_Design, and renders the HTML.
 *
 * ## The honesty contract (Req 16, 17)
 *
 * - The three layers are NEVER folded into a single score; each carries distinct
 *   baseline/kata views and a serialized `merged: false` assertion (Req 17.1,
 *   17.2).
 * - Any derived aggregate is labeled derived / trigger-specific / non-universal
 *   (Req 17.3).
 * - The platform startup phase and {@link Distribution} of `Cold_Invoke_Server_Time`
 *   are presented as DISTINCT values (Req 16.3, 16.4).
 * - High percentiles are withheld below the sample threshold with an explicit
 *   `insufficient-samples` reason (Req 17.6); a zero-cold variant is flagged
 *   statistically invalid but still reported (Req 17.7).
 * - The headline is the experienced latency; the layers are the explanation of
 *   where the time was spent (Req 17.8).
 *
 * ## CDK-free constraint
 *
 * This module imports nothing from `aws-cdk-lib`/`constructs` and no AWS SDK —
 * it is pure data → string rendering. The only non-runtime import is the
 * `import type { RunDesign }` (erased at compile time), keeping the runner
 * package CDK-free (enforced by `test/benchmark-runner-cdk-free.test.ts`).
 *
 * @remarks
 * Validates: Requirements 16.3, 16.4, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8
 *
 * @module benchmark/runner/report-renderer
 */

import type { ReportSample } from './metrics-collector';
import type { RunDesign } from '../manifest';
import type {
  Distribution,
  SuppressionReason,
  VariantId,
  VariantStats,
  BenchmarkHeadline,
  ColdStartVariantView,
  HandlerExecutionVariantView,
  RuntimeColdStartLayer,
  HandlerExecutionLayer,
  TriggerDeliveryLayer,
  TriggerDeliveryMetrics,
  DerivedAggregate,
  MetricLayers,
  RunWindowRecord,
  LayeredBenchmarkReport,
} from './types';

/**
 * The default minimum sample count required before high percentiles
 * (p90/p95/p99) are reported for a distribution (Req 17.6).
 *
 * Thirty is the conventional small-sample rule-of-thumb threshold: below it,
 * tail percentiles are dominated by a handful of points and would mislead, so
 * they are suppressed rather than reported.
 */
export const DEFAULT_HIGH_PERCENTILE_MIN_SAMPLES = 30;

/** The marker stamped on a distribution whose high percentiles were withheld. */
const INSUFFICIENT_SAMPLES: SuppressionReason = 'insufficient-samples';

/**
 * Optional context the {@link ReportRenderer} weaves into the report beyond the
 * raw samples (Req 17.5).
 *
 * Everything here is optional so the renderer degrades gracefully: a bare
 * `renderReport(samples)` still produces a valid layered report. Richer runs
 * supply the run identity, the recorded Run_Design, the measurement windows, a
 * tuned percentile threshold, and any source-specific trigger-delivery metrics.
 */
export interface RenderReportContext {
  /** The Bench_Run_Id the run was correlated under (Req 19.1). */
  readonly benchRunId?: string;
  /** ISO-8601 generation timestamp; defaults to now when omitted. */
  readonly generatedAt?: string;
  /** The recorded Run_Design to embed and render (Req 17.5). */
  readonly runDesign?: RunDesign;
  /** The measurement windows run (e.g. ABBA windows) (Req 17.5). */
  readonly windows?: ReadonlyArray<RunWindowRecord>;
  /** Minimum samples before high percentiles are reported (Req 17.6). */
  readonly highPercentileMinSamples?: number;
  /** Source-specific trigger-delivery metrics for layer 3 (Req 17.4). */
  readonly triggerDelivery?: TriggerDeliveryMetrics;
}

/** The rendered report artifacts. */
export interface RenderedReport {
  /** The full {@link LayeredBenchmarkReport} serialized as pretty JSON. */
  readonly json: string;
  /** A self-contained HTML document rendering of the same report. */
  readonly html: string;
}

// ── Pure statistics ──────────────────────────────────────────────────────────

/**
 * Compute the linear-interpolated percentile of an ASCENDING-sorted series
 * (the R-7 / `PERCENTILE.INC` method).
 *
 * @param sorted - The values sorted ascending (caller guarantees the order).
 * @param fraction - The percentile as a fraction in `[0, 1]` (e.g. `0.9`).
 * @returns The interpolated percentile, or `0` for an empty series.
 *
 * @internal
 */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }
  const rank = fraction * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) {
    return sorted[low];
  }
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

/**
 * Summarize a numeric series into a {@link Distribution}, suppressing high
 * percentiles when the series is smaller than `minSamples` (Req 17.6).
 *
 * The basic summary fields (`count`, `min`, `max`, `mean`, `stddev`, `p50`) are
 * ALWAYS present — including for an empty series, where they are `0` — so the
 * shape is total. The high percentiles (`p90`/`p95`/`p99`) are present IFF
 * `count >= minSamples`; below the threshold they are omitted and
 * {@link Distribution.suppressed} records the `insufficient-samples` reason
 * (Req 17.6).
 *
 * @param values - The raw series (any order); copied and sorted internally.
 * @param minSamples - The minimum count to report high percentiles.
 * @returns The computed distribution.
 */
export function computeDistribution(
  values: readonly number[],
  minSamples: number = DEFAULT_HIGH_PERCENTILE_MIN_SAMPLES,
): Distribution {
  const count = values.length;
  if (count === 0) {
    // A total, honest empty distribution: zeros for the basic fields and an
    // explicit suppression reason (there are not enough samples for any tail).
    return { count: 0, min: 0, max: 0, mean: 0, stddev: 0, p50: 0, suppressed: INSUFFICIENT_SAMPLES };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const mean = sum / count;
  const variance =
    sorted.reduce((acc, value) => acc + (value - mean) ** 2, 0) / count;
  const stddev = Math.sqrt(variance);

  const base = {
    count,
    min: sorted[0],
    max: sorted[count - 1],
    mean,
    stddev,
    p50: percentile(sorted, 0.5),
  };

  // Statistical hygiene: high percentiles are meaningful only with enough
  // samples; below the threshold they are withheld with a recorded reason.
  if (count < minSamples) {
    return { ...base, suppressed: INSUFFICIENT_SAMPLES };
  }

  return {
    ...base,
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

/**
 * Whether a distribution had its high percentiles suppressed (Req 17.6).
 *
 * @internal
 */
function isSuppressed(distribution: Distribution | undefined): boolean {
  return distribution?.suppressed === INSUFFICIENT_SAMPLES;
}

// ── Per-variant aggregation ──────────────────────────────────────────────────

/**
 * Project one variant's samples into its {@link VariantStats} (Req 16, 17.7).
 *
 * Cold and warm series are split: `init` (baseline cold) / `restore` (kata cold)
 * carry the platform startup phase, `coldInvokeServerTime` the composed honest
 * cold latency, and `warmDuration` the steady-state handler cost. A variant with
 * ZERO cold samples is marked `statisticallyValid: false` and its cold
 * distributions are OMITTED (never fabricated) — but the block is still produced,
 * so a zero-cold variant remains in the report (Req 17.7).
 *
 * @param variant - Which variant the samples belong to.
 * @param samples - The variant's collected samples.
 * @param minSamples - The high-percentile reporting threshold (Req 17.6).
 * @returns The per-variant aggregate statistics.
 */
export function buildVariantStats(
  variant: VariantId,
  samples: readonly ReportSample[],
  minSamples: number = DEFAULT_HIGH_PERCENTILE_MIN_SAMPLES,
): VariantStats {
  const cold = samples.filter((sample) => sample.cold);
  const warm = samples.filter((sample) => !sample.cold);

  const initValues = cold
    .map((sample) => sample.initDurationMs)
    .filter((value): value is number => value !== undefined);
  const restoreValues = cold
    .map((sample) => sample.restoreDurationMs)
    .filter((value): value is number => value !== undefined);
  const coldServerValues = cold
    .map((sample) => sample.coldInvokeServerTimeMs)
    .filter((value): value is number => value !== undefined);

  const coldSamples = cold.length;
  const statisticallyValid = coldSamples > 0;

  // Cold distributions are present ONLY when the variant has the corresponding
  // cold samples; they are never fabricated for a zero-cold variant (Req 17.7).
  const init = variant === 'baseline' && initValues.length > 0
    ? computeDistribution(initValues, minSamples)
    : undefined;
  const restore = variant === 'kata' && restoreValues.length > 0
    ? computeDistribution(restoreValues, minSamples)
    : undefined;
  const coldInvokeServerTime = coldServerValues.length > 0
    ? computeDistribution(coldServerValues, minSamples)
    : undefined;

  return {
    variant,
    n: samples.length,
    coldSamples,
    ...(init !== undefined ? { init } : {}),
    ...(restore !== undefined ? { restore } : {}),
    warmDuration: computeDistribution(
      warm.map((sample) => sample.durationMs),
      minSamples,
    ),
    ...(coldInvokeServerTime !== undefined ? { coldInvokeServerTime } : {}),
    billed: computeDistribution(
      samples.map((sample) => sample.billedMs),
      minSamples,
    ),
    maxMemoryMb: computeDistribution(
      samples.map((sample) => sample.maxMemoryMb),
      minSamples,
    ),
    errors: 0,
    throttles: 0,
    statisticallyValid,
  };
}

/**
 * Compute a variant's EXPERIENCED latency series — what the caller actually
 * waited for on each invocation (Req 17.8).
 *
 * For a cold invocation that is the composed `Cold_Invoke_Server_Time` (startup
 * phase + the same invocation's handler Duration); for a warm invocation it is
 * the handler Duration. This is deliberately NOT a merged cross-layer score: it
 * is the end-to-end latency per invocation, and the three layers explain where
 * that time was spent.
 *
 * @internal
 */
function experiencedLatencyValues(samples: readonly ReportSample[]): number[] {
  return samples.map((sample) =>
    sample.cold
      ? sample.coldInvokeServerTimeMs ?? sample.durationMs
      : sample.durationMs,
  );
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

/** Escape a string for safe interpolation into HTML text/attributes. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format a millisecond value for display, tolerant of `undefined`. */
function fmtMs(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(2)} ms`;
}

/** Render a distribution as a compact HTML cell, noting any suppression. */
function renderDistributionCell(label: string, distribution: Distribution | undefined): string {
  if (distribution === undefined) {
    return `<td><strong>${escapeHtml(label)}</strong>: —</td>`;
  }
  const tail = isSuppressed(distribution)
    ? '<span class="note">high percentiles withheld — sample size insufficient</span>'
    : `p90 ${fmtMs(distribution.p90)} · p99 ${fmtMs(distribution.p99)}`;
  return (
    `<td><strong>${escapeHtml(label)}</strong>: ` +
    `p50 ${fmtMs(distribution.p50)} · mean ${fmtMs(distribution.mean)} · ` +
    `min ${fmtMs(distribution.min)} · max ${fmtMs(distribution.max)} ` +
    `(n=${distribution.count}) ${tail}</td>`
  );
}

// ── The renderer component ───────────────────────────────────────────────────

/**
 * The {@link ReportRenderer} composes the honest, layered benchmark report from
 * collected samples and serializes it to JSON and HTML (Req 17).
 *
 * It is a cohesive, stateless component: construct one (no configuration) and
 * call {@link render} as often as needed. All run-specific inputs travel through
 * the {@link RenderReportContext}, so the same renderer instance can render many
 * runs. The convenience {@link renderReport} function wraps a single instance.
 *
 * @remarks
 * Validates: Requirements 16.3, 16.4, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8
 */
export class ReportRenderer {
  /**
   * Render the layered benchmark report from collected samples (Req 17).
   *
   * @param samples - The collected {@link ReportSample}s for both variants.
   * @param context - Optional run identity / Run_Design / windows / threshold /
   *   trigger-delivery metrics woven into the report (Req 17.4, 17.5, 17.6).
   * @returns The rendered JSON + HTML artifacts.
   */
  public render(
    samples: ReadonlyArray<ReportSample>,
    context: RenderReportContext = {},
  ): RenderedReport {
    const report = this.buildReport(samples, context);
    return {
      json: JSON.stringify(report, null, 2),
      html: this.renderHtml(report),
    };
  }

  /**
   * Assemble the {@link LayeredBenchmarkReport} data model (Req 17.1–17.8).
   *
   * @internal
   */
  private buildReport(
    samples: ReadonlyArray<ReportSample>,
    context: RenderReportContext,
  ): LayeredBenchmarkReport {
    const minSamples = context.highPercentileMinSamples ?? DEFAULT_HIGH_PERCENTILE_MIN_SAMPLES;
    const baselineSamples = samples.filter((sample) => sample.variant === 'baseline');
    const kataSamples = samples.filter((sample) => sample.variant === 'kata');

    const baseline = buildVariantStats('baseline', baselineSamples, minSamples);
    const kata = buildVariantStats('kata', kataSamples, minSamples);

    const layers = this.composeLayers(baseline, kata, context);
    const headline = this.composeHeadline(baselineSamples, kataSamples);

    return {
      ...(context.benchRunId !== undefined ? { benchRunId: context.benchRunId } : {}),
      generatedAt: context.generatedAt ?? new Date().toISOString(),
      variants: { baseline, kata },
      layers,
      headline,
      ...(context.runDesign !== undefined ? { runDesign: context.runDesign } : {}),
      windows: context.windows ?? [],
    };
  }

  /**
   * Compose the THREE non-merged metric layers (Req 17.1, 17.2).
   *
   * @internal
   */
  private composeLayers(
    baseline: VariantStats,
    kata: VariantStats,
    context: RenderReportContext,
  ): MetricLayers {
    return {
      runtimeColdStart: this.composeColdStartLayer(baseline, kata),
      handlerExecution: this.composeHandlerLayer(baseline, kata),
      triggerDelivery: this.composeTriggerDeliveryLayer(context.triggerDelivery),
    };
  }

  /**
   * Layer 1 — Runtime Cold-Start: Init (baseline) vs Restore (kata) platform
   * phase, kept DISTINCT from the composed cold-invoke server time (Req 16.3,
   * 16.4, 17.1).
   *
   * @internal
   */
  private composeColdStartLayer(
    baseline: VariantStats,
    kata: VariantStats,
  ): RuntimeColdStartLayer {
    return {
      id: 'runtime-cold-start',
      title: 'Runtime Cold-Start',
      merged: false,
      baseline: this.coldStartView(baseline, baseline.init),
      kata: this.coldStartView(kata, kata.restore),
    };
  }

  /**
   * Build the per-variant cold-start view, keeping the platform phase and the
   * composed server time as separate distributions (Req 16.3, 16.4).
   *
   * @internal
   */
  private coldStartView(
    stats: VariantStats,
    platformPhase: Distribution | undefined,
  ): ColdStartVariantView {
    return {
      variant: stats.variant,
      coldSamples: stats.coldSamples,
      ...(platformPhase !== undefined ? { platformPhase } : {}),
      ...(stats.coldInvokeServerTime !== undefined
        ? { coldInvokeServerTime: stats.coldInvokeServerTime }
        : {}),
      statisticallyValid: stats.statisticallyValid,
      highPercentilesSuppressed:
        isSuppressed(platformPhase) || isSuppressed(stats.coldInvokeServerTime),
    };
  }

  /**
   * Layer 2 — Handler Execution: warm Duration, billed time, and memory, kept as
   * distinct baseline/kata views (Req 17.1, 17.2).
   *
   * @internal
   */
  private composeHandlerLayer(
    baseline: VariantStats,
    kata: VariantStats,
  ): HandlerExecutionLayer {
    return {
      id: 'handler-execution',
      title: 'Handler Execution',
      merged: false,
      baseline: this.handlerView(baseline),
      kata: this.handlerView(kata),
    };
  }

  /**
   * Build the per-variant handler-execution view.
   *
   * @internal
   */
  private handlerView(stats: VariantStats): HandlerExecutionVariantView {
    return {
      variant: stats.variant,
      n: stats.n,
      warmDuration: stats.warmDuration,
      billed: stats.billed,
      maxMemoryMb: stats.maxMemoryMb,
      highPercentilesSuppressed: isSuppressed(stats.warmDuration),
    };
  }

  /**
   * Layer 3 — Trigger Delivery: source-specific delivery metrics, with every
   * derived aggregate labeled derived / trigger-specific / non-universal
   * (Req 17.3, 17.4).
   *
   * @internal
   */
  private composeTriggerDeliveryLayer(
    metrics: TriggerDeliveryMetrics | undefined,
  ): TriggerDeliveryLayer {
    const derivedAggregates = this.deriveTriggerAggregates(metrics);
    const available = metrics !== undefined && this.hasAnyMetric(metrics);
    return {
      id: 'trigger-delivery',
      title: 'Trigger Delivery',
      merged: false,
      available,
      ...(available ? { metrics } : {}),
      derivedAggregates,
    };
  }

  /** Whether any source-specific delivery metric is present. @internal */
  private hasAnyMetric(metrics: TriggerDeliveryMetrics): boolean {
    return (
      metrics.enqueueToStartMs !== undefined ||
      metrics.consumerLagMs !== undefined ||
      metrics.iteratorAgeMs !== undefined ||
      metrics.batchLatencyMs !== undefined
    );
  }

  /**
   * Derive a labeled aggregate (median) from each available delivery metric
   * (Req 17.3, 17.4).
   *
   * Each derived value is explicitly stamped derived / trigger-specific /
   * non-universal so it can never be read as a universal score.
   *
   * @internal
   */
  private deriveTriggerAggregates(
    metrics: TriggerDeliveryMetrics | undefined,
  ): DerivedAggregate[] {
    if (metrics === undefined) {
      return [];
    }
    const specs: ReadonlyArray<{ id: string; label: string; dist?: Distribution }> = [
      { id: 'enqueue-to-start-p50', label: 'Enqueue-to-start latency (p50)', dist: metrics.enqueueToStartMs },
      { id: 'consumer-lag-p50', label: 'Consumer lag (p50)', dist: metrics.consumerLagMs },
      { id: 'iterator-age-p50', label: 'Iterator age (p50)', dist: metrics.iteratorAgeMs },
      { id: 'batch-latency-p50', label: 'Batch latency (p50)', dist: metrics.batchLatencyMs },
    ];
    const aggregates: DerivedAggregate[] = [];
    for (const spec of specs) {
      if (spec.dist !== undefined) {
        aggregates.push({
          id: spec.id,
          label: spec.label,
          value: spec.dist.p50,
          derived: true,
          triggerSpecific: true,
          universal: false,
        });
      }
    }
    return aggregates;
  }

  /**
   * Compose the experienced-latency headline with its decomposition note
   * (Req 17.8).
   *
   * The headline reports the median end-to-end latency the caller experienced
   * per variant; the note directs the reader to the three layers for the
   * explanation, explicitly NOT a single merged winner number (Req 17.2, 17.8).
   *
   * @internal
   */
  private composeHeadline(
    baselineSamples: readonly ReportSample[],
    kataSamples: readonly ReportSample[],
  ): BenchmarkHeadline {
    const baseline = computeDistribution(
      experiencedLatencyValues(baselineSamples),
      1,
    ).p50;
    const kata = computeDistribution(experiencedLatencyValues(kataSamples), 1).p50;
    return {
      metric: 'experienced-latency',
      baseline,
      kata,
      note:
        'Experienced latency is the median end-to-end server time per invocation ' +
        '(cold = startup phase + handler duration; warm = handler duration). See ' +
        'the three metric layers for where the time was spent — this is never a ' +
        'single merged score.',
    };
  }

  /**
   * Render the report as a self-contained HTML document (Req 17).
   *
   * @internal
   */
  private renderHtml(report: LayeredBenchmarkReport): string {
    const sections = [
      this.renderHeadlineHtml(report),
      this.renderColdStartHtml(report.layers.runtimeColdStart),
      this.renderHandlerHtml(report.layers.handlerExecution),
      this.renderTriggerDeliveryHtml(report.layers.triggerDelivery),
      this.renderRunDesignHtml(report),
    ].join('\n');

    const title = report.benchRunId !== undefined
      ? `Lambda Kata Benchmark — ${escapeHtml(report.benchRunId)}`
      : 'Lambda Kata Benchmark Report';

    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8" />',
      `<title>${title}</title>`,
      '<style>',
      'body{font-family:system-ui,sans-serif;margin:2rem;color:#1a1a1a}',
      'section{border:1px solid #ddd;border-radius:8px;padding:1rem;margin-bottom:1rem}',
      'h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:0}',
      'table{border-collapse:collapse;width:100%}td{padding:.4rem;border-top:1px solid #eee;vertical-align:top}',
      '.note{color:#a15c00;font-style:italic}.invalid{color:#b00020;font-weight:600}',
      '.label{color:#555;font-size:.85rem}',
      '</style>',
      '</head>',
      '<body>',
      `<h1>${title}</h1>`,
      `<p class="label">Generated at ${escapeHtml(report.generatedAt)}. Three metric layers, never merged into a single score.</p>`,
      sections,
      '</body>',
      '</html>',
    ].join('\n');
  }

  /** Render the experienced-latency headline section. @internal */
  private renderHeadlineHtml(report: LayeredBenchmarkReport): string {
    const { headline } = report;
    return [
      '<section>',
      '<h2>Experienced latency (headline)</h2>',
      '<table>',
      `<tr><td><strong>Baseline</strong></td><td>${fmtMs(headline.baseline)}</td></tr>`,
      `<tr><td><strong>Kata</strong></td><td>${fmtMs(headline.kata)}</td></tr>`,
      '</table>',
      `<p class="note">${escapeHtml(headline.note)}</p>`,
      '</section>',
    ].join('\n');
  }

  /** Render the Runtime Cold-Start layer section. @internal */
  private renderColdStartHtml(layer: RuntimeColdStartLayer): string {
    return [
      '<section>',
      `<h2>Layer 1 — ${escapeHtml(layer.title)}</h2>`,
      '<table>',
      this.renderColdStartRow(layer.baseline),
      this.renderColdStartRow(layer.kata),
      '</table>',
      '</section>',
    ].join('\n');
  }

  /** Render one variant row for the cold-start layer. @internal */
  private renderColdStartRow(view: ColdStartVariantView): string {
    const validity = view.statisticallyValid
      ? `<span class="label">${view.coldSamples} cold sample(s)</span>`
      : '<span class="invalid">statistically invalid — zero cold samples</span>';
    return [
      '<tr>',
      `<td><strong>${escapeHtml(view.variant)}</strong><br/>${validity}</td>`,
      renderDistributionCell('Platform phase', view.platformPhase),
      renderDistributionCell('Cold-invoke server time', view.coldInvokeServerTime),
      '</tr>',
    ].join('');
  }

  /** Render the Handler Execution layer section. @internal */
  private renderHandlerHtml(layer: HandlerExecutionLayer): string {
    return [
      '<section>',
      `<h2>Layer 2 — ${escapeHtml(layer.title)}</h2>`,
      '<table>',
      this.renderHandlerRow(layer.baseline),
      this.renderHandlerRow(layer.kata),
      '</table>',
      '</section>',
    ].join('\n');
  }

  /** Render one variant row for the handler layer. @internal */
  private renderHandlerRow(view: HandlerExecutionVariantView): string {
    return [
      '<tr>',
      `<td><strong>${escapeHtml(view.variant)}</strong><br/><span class="label">n=${view.n}</span></td>`,
      renderDistributionCell('Warm duration', view.warmDuration),
      renderDistributionCell('Billed', view.billed),
      renderDistributionCell('Max memory (MB)', view.maxMemoryMb),
      '</tr>',
    ].join('');
  }

  /** Render the Trigger Delivery layer section. @internal */
  private renderTriggerDeliveryHtml(layer: TriggerDeliveryLayer): string {
    const body = layer.available
      ? this.renderDerivedAggregates(layer.derivedAggregates)
      : '<p class="label">No source-specific delivery metrics available for this run.</p>';
    return [
      '<section>',
      `<h2>Layer 3 — ${escapeHtml(layer.title)}</h2>`,
      body,
      '</section>',
    ].join('\n');
  }

  /** Render the labeled derived aggregates list. @internal */
  private renderDerivedAggregates(aggregates: ReadonlyArray<DerivedAggregate>): string {
    if (aggregates.length === 0) {
      return '<p class="label">No derived aggregates.</p>';
    }
    const rows = aggregates
      .map(
        (agg) =>
          `<tr><td><strong>${escapeHtml(agg.label)}</strong></td>` +
          `<td>${fmtMs(agg.value)} ` +
          '<span class="note">(derived · trigger-specific · non-universal)</span></td></tr>',
      )
      .join('\n');
    return `<table>\n${rows}\n</table>`;
  }

  /** Render the Run_Design section (Req 17.5). @internal */
  private renderRunDesignHtml(report: LayeredBenchmarkReport): string {
    const { runDesign, windows } = report;
    const rows: string[] = [];
    if (runDesign !== undefined) {
      rows.push(`<tr><td><strong>Fidelity</strong></td><td>${escapeHtml(runDesign.fidelity)}</td></tr>`);
      rows.push(
        `<tr><td><strong>Side-effect policy</strong></td><td>${escapeHtml(runDesign.sideEffectPolicy)}</td></tr>`,
      );
      rows.push(`<tr><td><strong>Role mode</strong></td><td>${escapeHtml(runDesign.roleMode)}</td></tr>`);
      for (const trigger of runDesign.perTrigger) {
        rows.push(
          `<tr><td><strong>Source</strong> ${escapeHtml(trigger.path)}</td>` +
          `<td>${escapeHtml(trigger.type)} · routing ${escapeHtml(trigger.routingClass)} · ` +
          `correlation ${escapeHtml(trigger.correlation)}</td></tr>`,
        );
      }
      for (const [path, keys] of Object.entries(runDesign.envKeysCopied)) {
        rows.push(
          `<tr><td><strong>Env keys</strong> ${escapeHtml(path)}</td>` +
          `<td>${escapeHtml(keys.join(', '))}</td></tr>`,
        );
      }
    }
    rows.push(
      `<tr><td><strong>Windows</strong></td><td>${windows.length} window(s): ` +
      `${escapeHtml(windows.map((w) => `${w.phase}#${w.window}:${w.activeVariant}`).join(', ')) || '—'}</td></tr>`,
    );
    rows.push(
      `<tr><td><strong>Sample counts</strong></td><td>baseline n=${report.variants.baseline.n} · ` +
      `kata n=${report.variants.kata.n}</td></tr>`,
    );

    return [
      '<section>',
      '<h2>Run Design</h2>',
      '<table>',
      rows.join('\n'),
      '</table>',
      '</section>',
    ].join('\n');
  }
}

/** Shared, stateless renderer instance backing {@link renderReport}. */
const SHARED_RENDERER = new ReportRenderer();

/**
 * Render the layered benchmark report from collected samples (Req 17.1, 17.2).
 *
 * Convenience wrapper over a shared {@link ReportRenderer} instance. The
 * single-argument form keeps backward compatibility with the runner's default
 * {@link ReportSink}; supply a {@link RenderReportContext} to embed run identity,
 * the Run_Design, measurement windows, a tuned percentile threshold, and any
 * trigger-delivery metrics (Req 17.4, 17.5, 17.6).
 *
 * @param samples - The collected {@link ReportSample}s for both variants.
 * @param context - Optional rendering context.
 * @returns The rendered JSON + HTML artifacts.
 */
export function renderReport(
  samples: ReadonlyArray<ReportSample>,
  context: RenderReportContext = {},
): RenderedReport {
  return SHARED_RENDERER.render(samples, context);
}

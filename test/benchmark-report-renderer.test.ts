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
 * Unit tests for the run-time {@link ReportRenderer} / {@link renderReport}
 * (Layer D, task 22).
 *
 * The renderer turns collected {@link ReportSample}s into the layered benchmark
 * report (three non-merged metric layers + Run_Design) as JSON and HTML. These
 * tests assert the Requirement 17 acceptance bar:
 *
 *  - three distinct Metric_Layers, NEVER merged into a single score (17.1, 17.2);
 *  - derived aggregates labeled derived/trigger-specific/non-universal (17.3);
 *  - the Trigger Delivery layer surfaces source-specific metrics when available
 *    (17.4);
 *  - the Run_Design (source, routing, ABBA windows, sample counts, fidelity) is
 *    recorded (17.5);
 *  - high percentiles are withheld below the configured threshold with an
 *    explicit insufficient-samples reason (17.6);
 *  - a zero-cold-sample variant is marked statistically invalid yet still
 *    included (17.7);
 *  - the headline is experienced latency with the layers as decomposition
 *    (17.8);
 *  - the platform startup phase and Cold_Invoke_Server_Time are distinct (16.3,
 *    16.4);
 *  - both JSON and HTML artifacts are emitted, and HTML escapes dynamic content.
 *
 * **Validates: Requirements 16.3, 16.4, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8**
 *
 * @module benchmark-report-renderer.test
 */

import {
  renderReport,
  ReportRenderer,
  DEFAULT_HIGH_PERCENTILE_MIN_SAMPLES,
  type RenderReportContext,
} from '../src/benchmark/runner/report-renderer';
import type { LayeredBenchmarkReport } from '../src/benchmark/runner/types';
import type { ReportSample } from '../src/benchmark/runner/metrics-collector';
import type { RunDesign } from '../src/benchmark/manifest';
import { FidelityLevel } from '../src/benchmark/options';

// ── Sample builders ──────────────────────────────────────────────────────────

let nextRequestId = 0;

/** A baseline cold sample (carries Init Duration → coldInvokeServerTime). */
function baselineCold(initMs: number, durationMs: number): ReportSample {
  nextRequestId += 1;
  return {
    requestId: `b-cold-${nextRequestId}`,
    variant: 'baseline',
    cold: true,
    initDurationMs: initMs,
    durationMs,
    billedMs: Math.ceil(durationMs),
    maxMemoryMb: 100,
    memorySizeMb: 512,
    coldInvokeServerTimeMs: initMs + durationMs,
  };
}

/** A baseline warm sample (no startup phase). */
function baselineWarm(durationMs: number): ReportSample {
  nextRequestId += 1;
  return {
    requestId: `b-warm-${nextRequestId}`,
    variant: 'baseline',
    cold: false,
    durationMs,
    billedMs: Math.ceil(durationMs),
    maxMemoryMb: 95,
    memorySizeMb: 512,
  };
}

/** A kata cold sample (carries Restore Duration → coldInvokeServerTime). */
function kataCold(restoreMs: number, durationMs: number): ReportSample {
  nextRequestId += 1;
  return {
    requestId: `k-cold-${nextRequestId}`,
    variant: 'kata',
    cold: true,
    restoreDurationMs: restoreMs,
    durationMs,
    billedMs: Math.ceil(durationMs),
    maxMemoryMb: 140,
    memorySizeMb: 1024,
    coldInvokeServerTimeMs: restoreMs + durationMs,
  };
}

/** A kata warm sample (no startup phase). */
function kataWarm(durationMs: number): ReportSample {
  nextRequestId += 1;
  return {
    requestId: `k-warm-${nextRequestId}`,
    variant: 'kata',
    cold: false,
    durationMs,
    billedMs: Math.ceil(durationMs),
    maxMemoryMb: 142,
    memorySizeMb: 1024,
  };
}

/** Build `count` baseline cold samples with deterministic, increasing values. */
function manyBaselineCold(count: number): ReportSample[] {
  return Array.from({ length: count }, (_unused, i) => baselineCold(200 + i, 10 + i));
}

/** Build `count` kata cold samples with deterministic, increasing values. */
function manyKataCold(count: number): ReportSample[] {
  return Array.from({ length: count }, (_unused, i) => kataCold(80 + i, 12 + i));
}

/** A minimal Run_Design fixture for Req 17.5 rendering. */
function runDesignFixture(): RunDesign {
  return {
    fidelity: FidelityLevel.L2,
    sideEffectPolicy: 'read-only',
    roleMode: 'reuse-role',
    eligibility: [],
    findings: [],
    acknowledgements: [],
    envKeysCopied: { 'Stack/Orders': ['TABLE_NAME', 'REGION'] },
    perTrigger: [
      { path: 'Stack/Orders', type: 'sqs', routingClass: 'competing', correlation: 'window' },
    ],
  };
}

function parse(report: { json: string }): LayeredBenchmarkReport {
  return JSON.parse(report.json) as LayeredBenchmarkReport;
}

// ── Output artifacts (JSON + HTML) ───────────────────────────────────────────

describe('renderReport — emits JSON and HTML artifacts', () => {
  it('emits parseable JSON and an HTML document', () => {
    const samples = [...manyBaselineCold(30), ...manyKataCold(30)];

    const rendered = renderReport(samples);

    expect(() => JSON.parse(rendered.json)).not.toThrow();
    expect(rendered.html).toContain('<!DOCTYPE html>');
    expect(rendered.html.toLowerCase()).toContain('<html');
    expect(rendered.html).toContain('</html>');
  });

  it('does not throw on an empty sample set (degenerate run)', () => {
    expect(() => renderReport([])).not.toThrow();
    const report = parse(renderReport([]));
    expect(report.variants.baseline.n).toBe(0);
    expect(report.variants.kata.n).toBe(0);
  });
});

// ── Three layers, never merged (Req 17.1, 17.2) ──────────────────────────────

describe('renderReport — three distinct, non-merged metric layers (Req 17.1, 17.2)', () => {
  const samples = [
    ...manyBaselineCold(25),
    baselineWarm(5),
    ...manyKataCold(25),
    kataWarm(6),
  ];
  const report = parse(renderReport(samples));

  it('exposes exactly the three named layers', () => {
    expect(Object.keys(report.layers).sort()).toEqual(
      ['handlerExecution', 'runtimeColdStart', 'triggerDelivery'].sort(),
    );
    expect(report.layers.runtimeColdStart.id).toBe('runtime-cold-start');
    expect(report.layers.handlerExecution.id).toBe('handler-execution');
    expect(report.layers.triggerDelivery.id).toBe('trigger-delivery');
  });

  it('keeps every layer non-merged with distinct baseline/kata blocks (Req 17.2)', () => {
    expect(report.layers.runtimeColdStart.merged).toBe(false);
    expect(report.layers.handlerExecution.merged).toBe(false);
    expect(report.layers.triggerDelivery.merged).toBe(false);

    // Baseline and kata are SEPARATE objects in each comparison layer — there is
    // no single combined per-metric figure.
    expect(report.layers.runtimeColdStart.baseline).not.toBe(
      report.layers.runtimeColdStart.kata,
    );
    expect(report.layers.handlerExecution.baseline).toBeDefined();
    expect(report.layers.handlerExecution.kata).toBeDefined();
  });

  it('never emits a merged "score"/"winner" field anywhere in the JSON', () => {
    expect(renderReport(samples).json).not.toMatch(/"(winner|mergedScore|score)"/);
  });
});

// ── Cold-start: platform phase distinct from server time (Req 16.3, 16.4) ─────

describe('renderReport — platform phase and Cold_Invoke_Server_Time are distinct (Req 16.3, 16.4)', () => {
  it('reports init/restore platform phase separately from coldInvokeServerTime', () => {
    const samples = [...manyBaselineCold(25), ...manyKataCold(25)];
    const report = parse(renderReport(samples));

    const base = report.layers.runtimeColdStart.baseline;
    const kata = report.layers.runtimeColdStart.kata;

    // Both distributions exist and are NOT the same object/value series.
    expect(base.platformPhase).toBeDefined();
    expect(base.coldInvokeServerTime).toBeDefined();
    // Server time strictly exceeds platform phase (it adds the handler Duration).
    expect(base.coldInvokeServerTime!.p50).toBeGreaterThan(base.platformPhase!.p50);
    expect(kata.platformPhase).toBeDefined();
    expect(kata.coldInvokeServerTime).toBeDefined();
    expect(kata.coldInvokeServerTime!.p50).toBeGreaterThan(kata.platformPhase!.p50);

    // Per-variant stats keep init (baseline) and restore (kata) separate.
    expect(report.variants.baseline.init).toBeDefined();
    expect(report.variants.baseline.restore).toBeUndefined();
    expect(report.variants.kata.restore).toBeDefined();
    expect(report.variants.kata.init).toBeUndefined();
  });
});

// ── Percentile suppression below threshold (Req 17.6) ─────────────────────────

describe('renderReport — high-percentile suppression below threshold (Req 17.6)', () => {
  it('withholds p90/p95/p99 and records insufficient-samples when cold samples are few', () => {
    // Three cold samples, default threshold is far higher → suppressed.
    const samples = [...manyBaselineCold(3), ...manyKataCold(3)];
    const report = parse(renderReport(samples));

    const base = report.variants.baseline.init!;
    expect(base.count).toBe(3);
    expect(base.p50).toBeDefined();
    expect(base.p90).toBeUndefined();
    expect(base.p95).toBeUndefined();
    expect(base.p99).toBeUndefined();
    expect(base.suppressed).toBe('insufficient-samples');

    // The cold-start layer view flags suppression for the operator.
    expect(report.layers.runtimeColdStart.baseline.highPercentilesSuppressed).toBe(true);
    // And the HTML states the sample size is insufficient.
    expect(renderReport(samples).html.toLowerCase()).toContain('insufficient');
  });

  it('emits high percentiles once the sample count meets the threshold', () => {
    const n = DEFAULT_HIGH_PERCENTILE_MIN_SAMPLES;
    const samples = manyBaselineCold(n);
    const report = parse(renderReport(samples));

    const base = report.variants.baseline.init!;
    expect(base.count).toBe(n);
    expect(base.p90).toBeDefined();
    expect(base.p99).toBeDefined();
    expect(base.suppressed).toBeUndefined();
    expect(report.layers.runtimeColdStart.baseline.highPercentilesSuppressed).toBe(false);
  });

  it('honors a caller-configured threshold', () => {
    const samples = manyKataCold(5);
    const ctx: RenderReportContext = { highPercentileMinSamples: 4 };
    const report = parse(renderReport(samples, ctx));

    // 5 cold samples ≥ configured threshold 4 → percentiles present.
    expect(report.variants.kata.restore!.p90).toBeDefined();
  });
});

// ── Zero cold samples → invalid but included (Req 17.7) ───────────────────────

describe('renderReport — zero-cold-sample variant is invalid yet included (Req 17.7)', () => {
  it('marks a warm-only variant statistically invalid but keeps it in the report', () => {
    // Baseline has cold samples; kata is warm-only (zero cold samples).
    const samples = [...manyBaselineCold(25), kataWarm(6), kataWarm(7), kataWarm(8)];
    const report = parse(renderReport(samples));

    expect(report.variants.kata.coldSamples).toBe(0);
    expect(report.variants.kata.statisticallyValid).toBe(false);
    // Still INCLUDED: the kata block and the cold-start layer kata view exist.
    expect(report.variants.kata.n).toBe(3);
    expect(report.layers.runtimeColdStart.kata.statisticallyValid).toBe(false);
    expect(report.layers.runtimeColdStart.kata.coldSamples).toBe(0);
    // No cold distributions are fabricated for a zero-cold variant.
    expect(report.variants.kata.restore).toBeUndefined();
    expect(report.variants.kata.coldInvokeServerTime).toBeUndefined();

    // The baseline (valid) is unaffected.
    expect(report.variants.baseline.statisticallyValid).toBe(true);

    // HTML communicates the invalidity.
    expect(renderReport(samples).html.toLowerCase()).toContain('statistically invalid');
  });
});

// ── Trigger Delivery layer + derived-aggregate labeling (Req 17.3, 17.4) ──────

describe('renderReport — Trigger Delivery layer and derived-aggregate labeling (Req 17.3, 17.4)', () => {
  it('marks the trigger-delivery layer unavailable when no source metrics are supplied', () => {
    const report = parse(renderReport([...manyBaselineCold(5), ...manyKataCold(5)]));
    expect(report.layers.triggerDelivery.available).toBe(false);
    expect(report.layers.triggerDelivery.derivedAggregates).toEqual([]);
  });

  it('surfaces source-specific delivery metrics and labels derived aggregates', () => {
    const ctx: RenderReportContext = {
      triggerDelivery: {
        enqueueToStartMs: {
          count: 25,
          min: 5,
          max: 40,
          mean: 20,
          stddev: 8,
          p50: 18,
          p90: 35,
          p95: 38,
          p99: 40,
        },
      },
    };
    const samples = [...manyBaselineCold(25), ...manyKataCold(25)];
    const report = parse(renderReport(samples, ctx));

    expect(report.layers.triggerDelivery.available).toBe(true);
    expect(report.layers.triggerDelivery.metrics?.enqueueToStartMs?.p50).toBe(18);

    // Req 17.3: every derived aggregate carries the three required labels.
    expect(report.layers.triggerDelivery.derivedAggregates.length).toBeGreaterThan(0);
    for (const agg of report.layers.triggerDelivery.derivedAggregates) {
      expect(agg.derived).toBe(true);
      expect(agg.triggerSpecific).toBe(true);
      expect(agg.universal).toBe(false);
    }
    // The HTML labels them too.
    const html = renderReport(samples, ctx).html.toLowerCase();
    expect(html).toContain('derived');
    expect(html).toContain('trigger-specific');
    expect(html).toContain('non-universal');
  });
});

// ── Run_Design rendering (Req 17.5) ───────────────────────────────────────────

describe('renderReport — Run_Design recording (Req 17.5)', () => {
  it('records source, routing, ABBA windows, sample counts, and fidelity', () => {
    const samples = [...manyBaselineCold(25), ...manyKataCold(25)];
    const ctx: RenderReportContext = {
      benchRunId: 'bench-xyz',
      runDesign: runDesignFixture(),
      windows: [
        { phase: 'abba', window: 0, activeVariant: 'baseline', batchSize: 10, concurrency: 1 },
        { phase: 'abba', window: 1, activeVariant: 'kata', batchSize: 10, concurrency: 1 },
        { phase: 'abba', window: 2, activeVariant: 'kata', batchSize: 10, concurrency: 1 },
        { phase: 'abba', window: 3, activeVariant: 'baseline', batchSize: 10, concurrency: 1 },
      ],
    };
    const rendered = renderReport(samples, ctx);
    const report = parse(rendered);

    expect(report.benchRunId).toBe('bench-xyz');
    // Fidelity (Req 12.8 / 17.5).
    expect(report.runDesign?.fidelity).toBe(FidelityLevel.L2);
    // Source + routing (Req 17.5).
    expect(report.runDesign?.perTrigger[0]).toMatchObject({
      type: 'sqs',
      routingClass: 'competing',
    });
    // ABBA windows recorded.
    expect(report.windows).toHaveLength(4);
    expect(report.windows.map((w) => w.activeVariant)).toEqual([
      'baseline',
      'kata',
      'kata',
      'baseline',
    ]);
    // Sample counts recorded per variant.
    expect(report.variants.baseline.n).toBe(25);
    expect(report.variants.kata.n).toBe(25);

    // The HTML renders a Run Design section with the fidelity and routing.
    const html = rendered.html;
    expect(html).toContain('Run Design');
    expect(html).toContain('L2');
    expect(html).toContain('competing');
    expect(html).toContain('sqs');
  });
});

// ── Headline = experienced latency with decomposition (Req 17.8) ──────────────

describe('renderReport — headline is experienced latency with layer decomposition (Req 17.8)', () => {
  it('presents experienced latency per variant and a decomposition note', () => {
    const samples = [...manyBaselineCold(25), ...manyKataCold(25)];
    const report = parse(renderReport(samples));

    expect(report.headline.metric).toBe('experienced-latency');
    expect(typeof report.headline.baseline).toBe('number');
    expect(typeof report.headline.kata).toBe('number');
    // The note points at the layered decomposition (not a merged winner).
    expect(report.headline.note.toLowerCase()).toContain('layer');

    const html = renderReport(samples).html;
    expect(html).toContain('Experienced latency');
  });
});

// ── HTML escaping (no injection from dynamic content) ─────────────────────────

describe('renderReport — escapes dynamic content in HTML', () => {
  it('escapes angle brackets from env keys / run-design strings', () => {
    const runDesign: RunDesign = {
      ...runDesignFixture(),
      envKeysCopied: { 'Stack/<script>alert(1)</script>': ['<b>KEY</b>'] },
    };
    const html = renderReport(manyBaselineCold(3), { runDesign }).html;

    // The raw injection must NOT appear; its escaped form must.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ── ReportRenderer class parity ───────────────────────────────────────────────

describe('ReportRenderer — class entry point parity with renderReport', () => {
  it('produces the same artifacts as the functional helper for fixed inputs', () => {
    const samples = [...manyBaselineCold(25), ...manyKataCold(25)];
    const ctx: RenderReportContext = { benchRunId: 'fixed', generatedAt: '2025-01-01T00:00:00.000Z' };

    const fromFn = renderReport(samples, ctx);
    const fromClass = new ReportRenderer().render(samples, ctx);

    expect(fromClass.json).toEqual(fromFn.json);
    expect(fromClass.html).toEqual(fromFn.html);
  });
});

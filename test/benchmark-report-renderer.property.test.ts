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
 * Property-based tests for the run-time {@link ReportRenderer} (Layer D,
 * task 22) — the **Property 17 (statistical honesty)** acceptance bar.
 *
 * Across any generated mix of cold/warm baseline and kata samples and any
 * threshold, the renderer must keep the report HONEST:
 *
 *  - **Layers never merged (Req 17.1, 17.2):** every metric layer always carries
 *    distinct baseline/kata views and is flagged `merged === false`; no merged
 *    winner/score field is ever emitted.
 *  - **High-percentile suppression (Req 17.6):** for every distribution, the
 *    high percentiles (p90/p95/p99) are present IFF the distribution's sample
 *    count meets the threshold; below threshold they are absent AND the
 *    distribution records the `insufficient-samples` reason.
 *  - **Zero-cold ⇒ invalid yet included (Req 17.7):** a variant is marked
 *    `statisticallyValid === false` IFF it produced zero cold samples, and the
 *    variant block is ALWAYS present in the report regardless.
 *
 * **Validates: Requirements 17.1, 17.2, 17.6, 17.7 (Property 17)**
 *
 * @module benchmark-report-renderer.property.test
 */

import * as fc from 'fast-check';

import {
  renderReport,
  DEFAULT_HIGH_PERCENTILE_MIN_SAMPLES,
  type RenderReportContext,
} from '../src/benchmark/runner/report-renderer';
import type { LayeredBenchmarkReport, Distribution } from '../src/benchmark/runner/types';
import type { ReportSample } from '../src/benchmark/runner/metrics-collector';

// ── Generators ───────────────────────────────────────────────────────────────

let seq = 0;

/** Arbitrary baseline sample (cold carries Init, warm carries no startup). */
const baselineSampleArb: fc.Arbitrary<ReportSample> = fc
  .record({
    cold: fc.boolean(),
    initMs: fc.double({ min: 1, max: 2000, noNaN: true }),
    durationMs: fc.double({ min: 0.1, max: 1000, noNaN: true }),
  })
  .map(({ cold, initMs, durationMs }) => {
    seq += 1;
    const base = {
      requestId: `b-${seq}`,
      variant: 'baseline' as const,
      cold,
      durationMs,
      billedMs: Math.ceil(durationMs),
      maxMemoryMb: 100,
      memorySizeMb: 512,
    };
    return cold
      ? { ...base, initDurationMs: initMs, coldInvokeServerTimeMs: initMs + durationMs }
      : base;
  });

/** Arbitrary kata sample (cold carries Restore, warm carries no startup). */
const kataSampleArb: fc.Arbitrary<ReportSample> = fc
  .record({
    cold: fc.boolean(),
    restoreMs: fc.double({ min: 1, max: 2000, noNaN: true }),
    durationMs: fc.double({ min: 0.1, max: 1000, noNaN: true }),
  })
  .map(({ cold, restoreMs, durationMs }) => {
    seq += 1;
    const base = {
      requestId: `k-${seq}`,
      variant: 'kata' as const,
      cold,
      durationMs,
      billedMs: Math.ceil(durationMs),
      maxMemoryMb: 140,
      memorySizeMb: 1024,
    };
    return cold
      ? { ...base, restoreDurationMs: restoreMs, coldInvokeServerTimeMs: restoreMs + durationMs }
      : base;
  });

const samplesArb: fc.Arbitrary<ReportSample[]> = fc
  .tuple(
    fc.array(baselineSampleArb, { maxLength: 60 }),
    fc.array(kataSampleArb, { maxLength: 60 }),
  )
  .map(([baseline, kata]) => [...baseline, ...kata]);

const thresholdArb = fc.integer({ min: 2, max: 40 });

function parse(json: string): LayeredBenchmarkReport {
  return JSON.parse(json) as LayeredBenchmarkReport;
}

/** Every distribution that appears in a variant's stats block. */
function distributionsOf(report: LayeredBenchmarkReport): Distribution[] {
  const out: Distribution[] = [];
  for (const variant of [report.variants.baseline, report.variants.kata]) {
    for (const dist of [
      variant.init,
      variant.restore,
      variant.warmDuration,
      variant.coldInvokeServerTime,
      variant.billed,
      variant.maxMemoryMb,
    ]) {
      if (dist !== undefined) {
        out.push(dist);
      }
    }
  }
  return out;
}

// ── Property 17a — layers never merged ───────────────────────────────────────

describe('Property 17 — layers are never merged (Req 17.1, 17.2)', () => {
  it('keeps three non-merged layers with distinct baseline/kata views for any input', () => {
    fc.assert(
      fc.property(samplesArb, (samples) => {
        const report = parse(renderReport(samples).json);

        // Exactly the three named layers, each flagged non-merged.
        expect(Object.keys(report.layers).sort()).toEqual(
          ['handlerExecution', 'runtimeColdStart', 'triggerDelivery'].sort(),
        );
        expect(report.layers.runtimeColdStart.merged).toBe(false);
        expect(report.layers.handlerExecution.merged).toBe(false);
        expect(report.layers.triggerDelivery.merged).toBe(false);

        // Comparison layers always carry separate baseline/kata views.
        expect(report.layers.runtimeColdStart.baseline).toBeDefined();
        expect(report.layers.runtimeColdStart.kata).toBeDefined();
        expect(report.layers.handlerExecution.baseline).toBeDefined();
        expect(report.layers.handlerExecution.kata).toBeDefined();

        // Never a merged winner/score field.
        expect(renderReport(samples).json).not.toMatch(/"(winner|mergedScore|score)"/);
      }),
      { numRuns: 200 },
    );
  });
});

// ── Property 17b — high-percentile suppression below threshold ────────────────

describe('Property 17 — high percentiles present IFF count ≥ threshold (Req 17.6)', () => {
  it('suppresses p90/p95/p99 with a reason below threshold and emits them at/above it', () => {
    fc.assert(
      fc.property(samplesArb, thresholdArb, (samples, threshold) => {
        const ctx: RenderReportContext = { highPercentileMinSamples: threshold };
        const report = parse(renderReport(samples, ctx).json);

        for (const dist of distributionsOf(report)) {
          const meets = dist.count >= threshold;
          if (meets) {
            // Above threshold: high percentiles are present, no suppression.
            expect(dist.p90).toBeDefined();
            expect(dist.p95).toBeDefined();
            expect(dist.p99).toBeDefined();
            expect(dist.suppressed).toBeUndefined();
          } else {
            // Below threshold: NO high-percentile claim, explicit reason.
            expect(dist.p90).toBeUndefined();
            expect(dist.p95).toBeUndefined();
            expect(dist.p99).toBeUndefined();
            expect(dist.suppressed).toBe('insufficient-samples');
          }
          // The basic summary fields are ALWAYS present (count > 0 by construction).
          expect(typeof dist.p50).toBe('number');
          expect(typeof dist.min).toBe('number');
          expect(typeof dist.max).toBe('number');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('uses the default threshold when none is configured', () => {
    fc.assert(
      fc.property(samplesArb, (samples) => {
        const report = parse(renderReport(samples).json);
        for (const dist of distributionsOf(report)) {
          const meets = dist.count >= DEFAULT_HIGH_PERCENTILE_MIN_SAMPLES;
          expect(dist.p99 !== undefined).toBe(meets);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 17c — zero cold ⇒ invalid yet included ───────────────────────────

describe('Property 17 — zero-cold variant invalid yet included (Req 17.7)', () => {
  it('flags statisticallyValid IFF coldSamples > 0 and always includes the variant', () => {
    fc.assert(
      fc.property(samplesArb, (samples) => {
        const report = parse(renderReport(samples).json);

        for (const variant of [report.variants.baseline, report.variants.kata]) {
          // INCLUDED unconditionally.
          expect(variant).toBeDefined();
          // Valid IFF it has at least one cold sample.
          expect(variant.statisticallyValid).toBe(variant.coldSamples > 0);
          // A zero-cold variant fabricates no cold distributions.
          if (variant.coldSamples === 0) {
            expect(variant.init).toBeUndefined();
            expect(variant.restore).toBeUndefined();
            expect(variant.coldInvokeServerTime).toBeUndefined();
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

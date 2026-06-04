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
 * Unit tests for the run-time {@link MetricsCollector} REPORT parser
 * (Layer D, task 17).
 *
 * These golden-fixture tests author realistic CloudWatch Lambda `REPORT` and
 * `RESTORE_REPORT` lines inline (the `sandbox/` prototype is gitignored/absent,
 * so fixtures are self-contained) and assert the parser's contract:
 *
 *  - baseline cold (`Init Duration`) → `initDurationMs` set, `restoreDurationMs`
 *    undefined, `cold === true`, `coldInvokeServerTimeMs === init + duration`;
 *  - kata cold (`Restore Duration`) → `restoreDurationMs` set, `initDurationMs`
 *    undefined, `cold === true`, `coldInvokeServerTimeMs === restore + duration`;
 *  - warm (no startup phase) → `cold === false`, no `coldInvokeServerTimeMs`;
 *  - `RESTORE_REPORT` lines are ignored and contribute nothing (Property 8);
 *  - errors and throttles are counted per variant (Req 15.4);
 *  - missing-sample marking yields an explicit missing marker, never a
 *    substituted record (Req 15.7, Property 8);
 *  - all numeric fields parse correctly, including fractional ms.
 *
 * **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 16.1, 16.2, 16.5**
 *
 * @module benchmark-metrics-collector.test
 */

import {
  parseReportSamples,
  collectMetrics,
  reconcileSamples,
  MetricsCollector,
  type LogEventsQuery,
  type LogEventsReader,
  type ReportSample,
} from '../src/benchmark/runner/metrics-collector';

/** A baseline cold REPORT line: carries `Init Duration` (Node.js init). */
const BASELINE_COLD_LINE =
  'REPORT RequestId: 11111111-1111-4111-8111-111111111111\t' +
  'Duration: 12.34 ms\tBilled Duration: 13 ms\t' +
  'Memory Size: 512 MB\tMax Memory Used: 88 MB\t' +
  'Init Duration: 220.50 ms';

/** A baseline warm REPORT line: no startup phase. */
const BASELINE_WARM_LINE =
  'REPORT RequestId: 22222222-2222-4222-8222-222222222222\t' +
  'Duration: 5.67 ms\tBilled Duration: 6 ms\t' +
  'Memory Size: 512 MB\tMax Memory Used: 90 MB';

/** A kata cold REPORT line: carries `Restore Duration` (SnapStart restore). */
const KATA_COLD_LINE =
  'REPORT RequestId: 33333333-3333-4333-8333-333333333333\t' +
  'Duration: 41.00 ms\tBilled Duration: 42 ms\t' +
  'Memory Size: 1024 MB\tMax Memory Used: 140 MB\t' +
  'Restore Duration: 180.25 ms';

/** A kata warm REPORT line: no startup phase. */
const KATA_WARM_LINE =
  'REPORT RequestId: 44444444-4444-4444-8444-444444444444\t' +
  'Duration: 7.10 ms\tBilled Duration: 8 ms\t' +
  'Memory Size: 1024 MB\tMax Memory Used: 142 MB';

/**
 * A runtime `RESTORE_REPORT` line. It CONTAINS the substring `REPORT RequestId`
 * and carries a `Restore Duration`, so it is the adversarial case the parser
 * must ignore entirely (Property 8).
 */
const RESTORE_REPORT_LINE =
  'RESTORE_REPORT RequestId: 99999999-9999-4999-8999-999999999999\t' +
  'Restore Duration: 999.99 ms';

describe('parseReportSamples — baseline cold sample (Req 15.2, 15.3, 15.5, 16.1)', () => {
  it('sets initDurationMs, leaves restoreDurationMs undefined, and composes cold server time', () => {
    const [sample] = parseReportSamples('baseline', BASELINE_COLD_LINE);

    expect(sample.requestId).toBe('11111111-1111-4111-8111-111111111111');
    expect(sample.variant).toBe('baseline');
    expect(sample.cold).toBe(true);
    expect(sample.initDurationMs).toBe(220.5);
    expect(sample.restoreDurationMs).toBeUndefined();
    expect(sample.durationMs).toBe(12.34);
    // Property 7: cold server time = startup (Init) + same-invoke Duration.
    expect(sample.coldInvokeServerTimeMs).toBeCloseTo(220.5 + 12.34, 10);
  });
});

describe('parseReportSamples — kata cold sample (Req 15.2, 15.3, 15.5, 16.2)', () => {
  it('sets restoreDurationMs, leaves initDurationMs undefined, and composes cold server time', () => {
    const [sample] = parseReportSamples('kata', KATA_COLD_LINE);

    expect(sample.requestId).toBe('33333333-3333-4333-8333-333333333333');
    expect(sample.variant).toBe('kata');
    expect(sample.cold).toBe(true);
    expect(sample.restoreDurationMs).toBe(180.25);
    expect(sample.initDurationMs).toBeUndefined();
    expect(sample.durationMs).toBe(41);
    // Property 7: cold server time = startup (Restore) + same-invoke Duration.
    expect(sample.coldInvokeServerTimeMs).toBeCloseTo(180.25 + 41, 10);
  });
});

describe('parseReportSamples — warm sample (Req 15.3, 16)', () => {
  it('classifies a baseline warm sample with no startup phase and no cold server time', () => {
    const [sample] = parseReportSamples('baseline', BASELINE_WARM_LINE);

    expect(sample.cold).toBe(false);
    expect(sample.initDurationMs).toBeUndefined();
    expect(sample.restoreDurationMs).toBeUndefined();
    expect(sample.coldInvokeServerTimeMs).toBeUndefined();
  });

  it('classifies a kata warm sample with no startup phase and no cold server time', () => {
    const [sample] = parseReportSamples('kata', KATA_WARM_LINE);

    expect(sample.cold).toBe(false);
    expect(sample.initDurationMs).toBeUndefined();
    expect(sample.restoreDurationMs).toBeUndefined();
    expect(sample.coldInvokeServerTimeMs).toBeUndefined();
  });
});

describe('parseReportSamples — startup attribution is variant-exclusive (Req 15.5)', () => {
  it('never populates restoreDurationMs for baseline even if a Restore field is present', () => {
    // Adversarial: a baseline line that erroneously carries a Restore Duration.
    const line =
      'REPORT RequestId: 55555555-5555-4555-8555-555555555555\t' +
      'Duration: 10.00 ms\tBilled Duration: 11 ms\t' +
      'Memory Size: 256 MB\tMax Memory Used: 70 MB\t' +
      'Restore Duration: 300.00 ms';

    const [sample] = parseReportSamples('baseline', line);

    // No baseline startup phase present → warm, and Restore is NEVER attributed.
    expect(sample.restoreDurationMs).toBeUndefined();
    expect(sample.initDurationMs).toBeUndefined();
    expect(sample.cold).toBe(false);
    expect(sample.coldInvokeServerTimeMs).toBeUndefined();
  });

  it('never populates initDurationMs for kata even if an Init field is present', () => {
    // Adversarial: a kata line that erroneously carries an Init Duration.
    const line =
      'REPORT RequestId: 66666666-6666-4666-8666-666666666666\t' +
      'Duration: 9.00 ms\tBilled Duration: 10 ms\t' +
      'Memory Size: 256 MB\tMax Memory Used: 60 MB\t' +
      'Init Duration: 250.00 ms';

    const [sample] = parseReportSamples('kata', line);

    expect(sample.initDurationMs).toBeUndefined();
    expect(sample.restoreDurationMs).toBeUndefined();
    expect(sample.cold).toBe(false);
    expect(sample.coldInvokeServerTimeMs).toBeUndefined();
  });
});

describe('parseReportSamples — RESTORE_REPORT lines are ignored (Req 15.6, Property 8)', () => {
  it('contributes nothing from a RESTORE_REPORT line interleaved with REPORT lines', () => {
    const log = [
      RESTORE_REPORT_LINE,
      KATA_COLD_LINE,
      RESTORE_REPORT_LINE,
      KATA_WARM_LINE,
    ].join('\n');

    const samples = parseReportSamples('kata', log);

    // Only the two REPORT lines yield samples; neither RESTORE_REPORT does.
    expect(samples).toHaveLength(2);
    const ids = samples.map((s) => s.requestId);
    expect(ids).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ]);
    // The RESTORE_REPORT's Restore Duration (999.99) must never appear anywhere.
    expect(samples.every((s) => s.restoreDurationMs !== 999.99)).toBe(true);
    expect(
      samples.every((s) => (s.coldInvokeServerTimeMs ?? 0) < 999.99),
    ).toBe(true);
  });
});

describe('collectMetrics — errors and throttles counted per variant (Req 15.4)', () => {
  it('counts error indicators (Status: error, errorType, task timed out)', () => {
    const log = [
      BASELINE_WARM_LINE,
      'REPORT RequestId: aaaa\tDuration: 1.00 ms\tStatus: error',
      '{"errorType":"Runtime.UnhandledException","errorMessage":"boom"}',
      '2024-01-01T00:00:00Z abcd Task timed out after 3.00 seconds',
    ].join('\n');

    const metrics = collectMetrics('baseline', log);

    expect(metrics.errors).toBe(3);
  });

  it('counts throttle indicators (Rate Exceeded, TooManyRequestsException, Throttl)', () => {
    const log = [
      KATA_WARM_LINE,
      'Rate Exceeded for function',
      'TooManyRequestsException: too many requests',
      'Request was Throttled by the service',
    ].join('\n');

    const metrics = collectMetrics('kata', log);

    expect(metrics.throttles).toBe(3);
  });

  it('reports zero errors and throttles for a clean log', () => {
    const log = [BASELINE_COLD_LINE, BASELINE_WARM_LINE].join('\n');

    const metrics = collectMetrics('baseline', log);

    expect(metrics.errors).toBe(0);
    expect(metrics.throttles).toBe(0);
    expect(metrics.samples).toHaveLength(2);
  });
});

describe('parseReportSamples — numeric field parsing including fractional ms (Req 15.2)', () => {
  it('parses duration, billed, max memory, and memory size correctly', () => {
    const [sample] = parseReportSamples('baseline', BASELINE_COLD_LINE);

    expect(sample.durationMs).toBe(12.34);
    expect(sample.billedMs).toBe(13);
    expect(sample.maxMemoryMb).toBe(88);
    expect(sample.memorySizeMb).toBe(512);
  });
});

describe('reconcileSamples — missing-sample marking (Req 15.7, Property 8)', () => {
  const samples: readonly ReportSample[] = parseReportSamples(
    'baseline',
    [BASELINE_COLD_LINE, BASELINE_WARM_LINE].join('\n'),
  );

  it('marks an expected invocation with no REPORT as missing, never substituted', () => {
    const expected = [
      '11111111-1111-4111-8111-111111111111', // present (cold)
      '22222222-2222-4222-8222-222222222222', // present (warm)
      'deadbeef-0000-4000-8000-000000000000', // expected but absent → missing
    ];

    const reconciliation = reconcileSamples(expected, samples);

    expect(reconciliation).toHaveLength(3);

    const present = reconciliation.filter((r) => !r.missing);
    const missing = reconciliation.filter((r) => r.missing);
    expect(present).toHaveLength(2);
    expect(missing).toHaveLength(1);

    // The missing entry carries ONLY the request id — no substituted record.
    expect(missing[0]).toEqual({
      missing: true,
      requestId: 'deadbeef-0000-4000-8000-000000000000',
    });

    // The present entries reconcile to their OWN samples (no cross-attribution).
    const presentById = new Map(present.map((p) => [p.requestId, p]));
    expect(presentById.get('11111111-1111-4111-8111-111111111111')?.missing).toBe(false);
  });

  it('deduplicates expected ids and preserves first-seen order', () => {
    const expected = [
      '22222222-2222-4222-8222-222222222222',
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    ];

    const reconciliation = reconcileSamples(expected, samples);

    expect(reconciliation.map((r) => r.requestId)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    ]);
  });
});

/** An in-memory {@link LogEventsReader} returning pre-seeded messages. */
function fakeReader(messages: readonly string[]): LogEventsReader {
  return {
    readLogEvents: async (_query: LogEventsQuery): Promise<readonly string[]> =>
      messages,
  };
}

describe('MetricsCollector — injected reader (dependency inversion, Req 15.1)', () => {
  it('collects metrics from the injected reader without touching AWS', async () => {
    const collector = new MetricsCollector(
      fakeReader([BASELINE_COLD_LINE, BASELINE_WARM_LINE]),
    );

    const metrics = await collector.collect('baseline', {
      logGroupName: '/aws/lambda/order-service',
    });

    expect(metrics.variant).toBe('baseline');
    expect(metrics.samples).toHaveLength(2);
    expect(metrics.samples[0].coldInvokeServerTimeMs).toBeCloseTo(220.5 + 12.34, 10);
  });

  it('collects and reconciles expected ids in one step', async () => {
    const collector = new MetricsCollector(fakeReader([KATA_COLD_LINE]));

    const result = await collector.collectAndReconcile(
      'kata',
      { logGroupName: '/aws/lambda/order-service-kata' },
      ['33333333-3333-4333-8333-333333333333', 'missing-id'],
    );

    expect(result.metrics.samples).toHaveLength(1);
    expect(result.reconciliation).toHaveLength(2);
    expect(result.reconciliation.find((r) => r.requestId === 'missing-id')?.missing).toBe(true);
  });
});

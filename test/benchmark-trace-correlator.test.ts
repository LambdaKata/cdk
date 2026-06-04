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
 * Unit tests for the run-time {@link TraceCorrelator} (Layer D, task 18).
 *
 * These tests author self-contained fixtures (no AWS, no CDK) and assert the
 * correlator's contract:
 *
 *  - `createBenchRunId()` mints a unique, non-empty run id on every call
 *    (Req 19.1);
 *  - `buildMarker(benchRunId, variant, phase, window)` yields exactly those
 *    fields (Req 19.2);
 *  - tagging an event whose trigger PERMITS a marker embeds a recoverable marker
 *    and reports `invocation-correlated` (Req 19.2);
 *  - tagging an event whose trigger does NOT permit a marker leaves the payload
 *    untouched and reports `window-correlated` (Req 19.4);
 *  - associating collected samples with a marker yields invocation-correlated
 *    samples carrying benchRunId/variant/phase/window (Req 19.3);
 *  - the marker-permitted matrix maps every trigger type to the correct
 *    correlation mode (Req 19.2, 19.4).
 *
 * **Validates: Requirements 19.1, 19.2, 19.3, 19.4**
 *
 * @module benchmark-trace-correlator.test
 */

import {
  createBenchRunId,
  buildMarker,
  embedMarker,
  extractMarker,
  tagEvent,
  correlateSamples,
  triggerPermitsMarker,
  correlationModeFor,
  TraceCorrelator,
  MARKER_KEY,
  MARKER_PERMITTED_TRIGGER_TYPES,
  WINDOW_CORRELATED_TRIGGER_TYPES,
  type BenchTriggerType,
  type CorrelationMarker,
} from '../src/benchmark/runner/trace-correlator';
import type { ReportSample } from '../src/benchmark/runner/metrics-collector';

/** All nine supported trigger discriminants, mirrored from the synth union. */
const ALL_TRIGGER_TYPES: readonly BenchTriggerType[] = [
  'invoke',
  'apiGateway',
  'functionUrl',
  'sqs',
  'eventBridge',
  'sns',
  'kinesis',
  'dynamoDbStreams',
  'kafka',
];

/** A warm baseline sample fixture. */
const WARM_BASELINE_SAMPLE: ReportSample = {
  requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  variant: 'baseline',
  cold: false,
  durationMs: 5,
  billedMs: 6,
  maxMemoryMb: 80,
  memorySizeMb: 512,
};

/** A cold kata sample fixture. */
const COLD_KATA_SAMPLE: ReportSample = {
  requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  variant: 'kata',
  cold: true,
  restoreDurationMs: 180,
  durationMs: 40,
  billedMs: 41,
  maxMemoryMb: 140,
  memorySizeMb: 1024,
  coldInvokeServerTimeMs: 220,
};

describe('createBenchRunId — unique run id per run (Req 19.1)', () => {
  it('returns a non-empty string', () => {
    const id = createBenchRunId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('is unique across many calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      ids.add(createBenchRunId());
    }
    expect(ids.size).toBe(10_000);
  });

  it('is tag-safe (only lowercase alphanumerics and dashes)', () => {
    // The run id is used as an ownership tag and resource-name fragment
    // (Req 20.1), so it must stay within a conservative charset.
    expect(createBenchRunId()).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('buildMarker — marker field set (Req 19.2)', () => {
  it('produces a marker with exactly benchRunId/variant/phase/window', () => {
    const marker = buildMarker('bench-run-1', 'kata', 'measure', 3);

    expect(marker).toEqual<CorrelationMarker>({
      benchRunId: 'bench-run-1',
      variant: 'kata',
      phase: 'measure',
      window: 3,
    });
  });
});

describe('embedMarker / extractMarker — round-trip (Req 19.2)', () => {
  const marker = buildMarker('bench-run-2', 'baseline', 'baseline-1', 0);

  it('embeds a marker under the reserved key and recovers it exactly', () => {
    const payload = { orderId: 42, items: ['a', 'b'] };
    const tagged = embedMarker(payload, marker);

    expect(tagged[MARKER_KEY]).toEqual(marker);
    // Original fields are preserved.
    expect(tagged.orderId).toBe(42);
    expect(tagged.items).toEqual(['a', 'b']);
    expect(extractMarker(tagged)).toEqual(marker);
  });

  it('does not mutate the source payload', () => {
    const payload = { k: 1 };
    embedMarker(payload, marker);
    expect(payload).toEqual({ k: 1 });
    expect(MARKER_KEY in payload).toBe(false);
  });

  it('returns undefined when no marker is present', () => {
    expect(extractMarker({ orderId: 1 })).toBeUndefined();
    expect(extractMarker(undefined)).toBeUndefined();
    expect(extractMarker(null)).toBeUndefined();
    expect(extractMarker('not-an-object')).toBeUndefined();
  });

  it('returns undefined when the reserved key holds a malformed marker', () => {
    expect(extractMarker({ [MARKER_KEY]: { variant: 'kata' } })).toBeUndefined();
    expect(extractMarker({ [MARKER_KEY]: 'nope' })).toBeUndefined();
  });
});

describe('tagEvent — marker-permitted vs window-correlated (Req 19.2, 19.4)', () => {
  const marker = buildMarker('bench-run-3', 'kata', 'measure', 2);

  it('embeds a recoverable marker for a trigger that permits one (invoke)', () => {
    const tagged = tagEvent('invoke', { input: 'x' }, marker);

    expect(tagged.mode).toBe('invocation-correlated');
    expect(tagged.marker).toEqual(marker);
    expect(extractMarker(tagged.payload)).toEqual(marker);
  });

  it('leaves the payload untouched and reports window-correlated for a stream trigger (dynamoDbStreams)', () => {
    const payload = { input: 'x' };
    const tagged = tagEvent('dynamoDbStreams', payload, marker);

    expect(tagged.mode).toBe('window-correlated');
    expect(tagged.marker).toBeUndefined();
    // No marker is embedded into a source that cannot carry one.
    expect(extractMarker(tagged.payload)).toBeUndefined();
    expect(tagged.payload).toEqual({ input: 'x' });
  });
});

describe('correlateSamples — association (Req 19.3, 19.4)', () => {
  const context = {
    benchRunId: 'bench-run-4',
    variant: 'kata' as const,
    phase: 'measure',
    window: 1,
  };

  it('associates each sample with benchRunId/variant/phase/window as invocation-correlated for a marker-bearing trigger', () => {
    const correlated = correlateSamples('sqs', [COLD_KATA_SAMPLE], context);

    expect(correlated).toHaveLength(1);
    expect(correlated[0]).toMatchObject({
      sample: COLD_KATA_SAMPLE,
      benchRunId: 'bench-run-4',
      variant: 'kata',
      phase: 'measure',
      window: 1,
      mode: 'invocation-correlated',
    });
  });

  it('records samples as window-correlated for a trigger that cannot carry a marker', () => {
    const correlated = correlateSamples('kinesis', [WARM_BASELINE_SAMPLE], {
      ...context,
      variant: 'baseline',
    });

    expect(correlated).toHaveLength(1);
    expect(correlated[0].mode).toBe('window-correlated');
    expect(correlated[0].benchRunId).toBe('bench-run-4');
    expect(correlated[0].variant).toBe('baseline');
    expect(correlated[0].window).toBe(1);
  });

  it('preserves sample order and count', () => {
    const correlated = correlateSamples(
      'invoke',
      [WARM_BASELINE_SAMPLE, COLD_KATA_SAMPLE],
      context,
    );
    expect(correlated.map((c) => c.sample.requestId)).toEqual([
      WARM_BASELINE_SAMPLE.requestId,
      COLD_KATA_SAMPLE.requestId,
    ]);
  });
});

describe('marker-permitted matrix — every trigger type maps to a mode (Req 19.2, 19.4)', () => {
  it('partitions all trigger types into permitted vs window-correlated with no overlap or gap', () => {
    const permitted = new Set(MARKER_PERMITTED_TRIGGER_TYPES);
    const windowed = new Set(WINDOW_CORRELATED_TRIGGER_TYPES);

    // Disjoint.
    for (const type of permitted) {
      expect(windowed.has(type)).toBe(false);
    }
    // Exhaustive cover of all nine types.
    expect(new Set([...permitted, ...windowed])).toEqual(new Set(ALL_TRIGGER_TYPES));
  });

  it.each(ALL_TRIGGER_TYPES)('classifies %s consistently across the API', (type) => {
    const permitted = triggerPermitsMarker(type);
    const mode = correlationModeFor(type);
    expect(mode).toBe(permitted ? 'invocation-correlated' : 'window-correlated');

    // tagEvent agrees with the matrix.
    const marker = buildMarker('run', 'baseline', 'p', 0);
    const tagged = tagEvent(type, { v: 1 }, marker);
    expect(tagged.mode).toBe(mode);
    expect(tagged.marker !== undefined).toBe(permitted);
  });

  it('permits markers for request/response and push/attribute sources', () => {
    expect(triggerPermitsMarker('invoke')).toBe(true);
    expect(triggerPermitsMarker('apiGateway')).toBe(true);
    expect(triggerPermitsMarker('functionUrl')).toBe(true);
    expect(triggerPermitsMarker('sqs')).toBe(true);
    expect(triggerPermitsMarker('sns')).toBe(true);
    expect(triggerPermitsMarker('eventBridge')).toBe(true);
  });

  it('falls back to window-correlation for pure stream/read sources', () => {
    expect(triggerPermitsMarker('kinesis')).toBe(false);
    expect(triggerPermitsMarker('dynamoDbStreams')).toBe(false);
    expect(triggerPermitsMarker('kafka')).toBe(false);
  });
});

describe('TraceCorrelator — run-scoped facade (Req 19.1, 19.2, 19.3, 19.4)', () => {
  it('mints a run id at construction and reuses it for every marker', () => {
    const correlator = new TraceCorrelator();

    expect(correlator.benchRunId).toMatch(/^[a-z0-9-]+$/);
    const m1 = correlator.marker('baseline', 'baseline-1', 0);
    const m2 = correlator.marker('kata', 'kata-1', 1);
    expect(m1.benchRunId).toBe(correlator.benchRunId);
    expect(m2.benchRunId).toBe(correlator.benchRunId);
  });

  it('accepts an explicit run id (for resuming/correlating a known run)', () => {
    const correlator = new TraceCorrelator('bench-explicit');
    expect(correlator.benchRunId).toBe('bench-explicit');
    expect(correlator.marker('kata', 'measure', 2).benchRunId).toBe('bench-explicit');
  });

  it('tags and correlates using the run id, choosing mode by trigger type', () => {
    const correlator = new TraceCorrelator('bench-5');

    const tagged = correlator.tag('sqs', { body: 'm' }, 'kata', 'measure', 3);
    expect(tagged.mode).toBe('invocation-correlated');
    expect(extractMarker(tagged.payload)?.benchRunId).toBe('bench-5');

    const correlated = correlator.correlate('kafka', [COLD_KATA_SAMPLE], 'kata', 'measure', 3);
    expect(correlated[0].mode).toBe('window-correlated');
    expect(correlated[0].benchRunId).toBe('bench-5');
    expect(correlated[0].window).toBe(3);
  });
});

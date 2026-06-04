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
 * Property-Based Tests for the {@link MetricsCollector} REPORT parser
 * (Layer D, task 17).
 *
 * Two design Correctness Properties are proven across the input space rather
 * than for hand-picked examples:
 *
 * - **Property 7 (Cold-start composition):** for ANY cold sample,
 *   `Cold_Invoke_Server_Time` equals that same invocation's startup phase
 *   (`Init` for baseline, `Restore` for kata) plus that invocation's `Duration`
 *   (Req 16.1, 16.2).
 * - **Property 8 (Authoritative metrics only):** every metric value originates
 *   from a `REPORT RequestId` line; no value derives from a `RESTORE_REPORT`
 *   line; an invocation with no matching REPORT yields a missing sample, never a
 *   substituted one (Req 15.6, 15.7).
 *
 * **Validates: Requirements 15.6, 15.7, 16.1, 16.2**
 *
 * @module benchmark-metrics-collector.property.test
 */

import * as fc from 'fast-check';

import {
  parseReportSamples,
  reconcileSamples,
} from '../src/benchmark/runner/metrics-collector';

/** A UUID-shaped request id (hex + dashes; matches the parser's id charset). */
const requestIdArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 12, maxLength: 12 }),
  )
  .map((parts) => parts.join('-'));

/** A non-negative millisecond value with up to 2 fractional digits. */
const msArb: fc.Arbitrary<number> = fc
  .integer({ min: 0, max: 1_000_000 })
  .map((hundredths) => hundredths / 100);

/** A positive integer MB value (memory size / max memory used). */
const mbArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 10_240 });

const variantArb: fc.Arbitrary<'baseline' | 'kata'> = fc.constantFrom(
  'baseline',
  'kata',
);

/** The startup mechanism a generated cold line should carry. */
interface ColdSpec {
  readonly variant: 'baseline' | 'kata';
  readonly requestId: string;
  readonly durationMs: number;
  readonly startupMs: number;
  readonly billedMs: number;
  readonly memorySizeMb: number;
  readonly maxMemoryMb: number;
}

const coldSpecArb: fc.Arbitrary<ColdSpec> = fc.record({
  variant: variantArb,
  requestId: requestIdArb,
  durationMs: msArb,
  startupMs: msArb,
  billedMs: msArb,
  memorySizeMb: mbArb,
  maxMemoryMb: mbArb,
});

/** Render a `REPORT` line for a cold spec, using the variant's startup field. */
function renderColdLine(spec: ColdSpec): string {
  const startupField =
    spec.variant === 'baseline'
      ? `Init Duration: ${spec.startupMs} ms`
      : `Restore Duration: ${spec.startupMs} ms`;
  return (
    `REPORT RequestId: ${spec.requestId}\t` +
    `Duration: ${spec.durationMs} ms\t` +
    `Billed Duration: ${spec.billedMs} ms\t` +
    `Memory Size: ${spec.memorySizeMb} MB\t` +
    `Max Memory Used: ${spec.maxMemoryMb} MB\t` +
    startupField
  );
}

describe('Property 7 — cold-start composition (Req 16.1, 16.2)', () => {
  it('Cold_Invoke_Server_Time always equals startup + same-invoke duration', () => {
    fc.assert(
      fc.property(coldSpecArb, (spec) => {
        const [sample] = parseReportSamples(spec.variant, renderColdLine(spec));

        const startup =
          spec.variant === 'baseline'
            ? sample.initDurationMs
            : sample.restoreDurationMs;

        return (
          sample.cold === true &&
          startup !== undefined &&
          sample.coldInvokeServerTimeMs !== undefined &&
          Math.abs(
            sample.coldInvokeServerTimeMs - (startup + sample.durationMs),
          ) < 1e-9 &&
          // Cross-variant startup field is never populated.
          (spec.variant === 'baseline'
            ? sample.restoreDurationMs === undefined
            : sample.initDurationMs === undefined)
        );
      }),
      { numRuns: 500 },
    );
  });
});

describe('Property 8 — authoritative metrics only (Req 15.6, 15.7)', () => {
  it('never derives any value from an interleaved RESTORE_REPORT line', () => {
    fc.assert(
      fc.property(
        coldSpecArb,
        requestIdArb,
        msArb,
        (spec, restoreReportId, restoreReportMs) => {
          // A RESTORE_REPORT line carrying a DISTINCT, large restore value.
          const poison = restoreReportMs + 1_000_000;
          const restoreReportLine =
            `RESTORE_REPORT RequestId: ${restoreReportId}\t` +
            `Restore Duration: ${poison} ms`;

          const log = [restoreReportLine, renderColdLine(spec)].join('\n');
          const samples = parseReportSamples(spec.variant, log);

          // Exactly one sample (from the REPORT line), and the RESTORE_REPORT's
          // poison value never appears in ANY field.
          return (
            samples.length === 1 &&
            samples[0].requestId === spec.requestId &&
            samples[0].restoreDurationMs !== poison &&
            (samples[0].coldInvokeServerTimeMs ?? 0) !== poison &&
            samples[0].durationMs !== poison
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('marks any expected invocation with no REPORT as missing, never substituted', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(coldSpecArb, {
          minLength: 0,
          maxLength: 6,
          selector: (spec) => spec.requestId,
        }),
        fc.uniqueArray(requestIdArb, { minLength: 0, maxLength: 6 }),
        (presentSpecs, extraExpectedIds) => {
          const variant = presentSpecs[0]?.variant ?? 'baseline';
          // All present specs share the variant so the log is internally
          // consistent (a single variant's log group).
          const normalized = presentSpecs.map((spec) => ({ ...spec, variant }));
          const log = normalized.map(renderColdLine).join('\n');
          const samples = parseReportSamples(variant, log);

          const presentIds = normalized.map((spec) => spec.requestId);
          const presentIdSet = new Set(presentIds);
          // Expected = the present ids plus extra ids that are NOT present.
          const trulyMissing = extraExpectedIds.filter(
            (id) => !presentIdSet.has(id),
          );
          const expected = [...presentIds, ...trulyMissing];

          const reconciliation = reconcileSamples(expected, samples);

          // One entry per unique expected id.
          const uniqueExpected = new Set(expected);
          if (reconciliation.length !== uniqueExpected.size) {
            return false;
          }

          return reconciliation.every((entry) => {
            if (presentIdSet.has(entry.requestId)) {
              // Present entries carry their OWN sample (no substitution).
              return !entry.missing && entry.sample.requestId === entry.requestId;
            }
            // Absent ids must be marked missing with no smuggled sample.
            return entry.missing === true && !('sample' in entry);
          });
        },
      ),
      { numRuns: 300 },
    );
  });
});

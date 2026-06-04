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
 * Layer D — {@link MetricsCollector}: authoritative CloudWatch `REPORT` parsing
 * (run-time, CDK-free).
 *
 * ## Responsibility
 *
 * The collector turns a variant's raw CloudWatch log content into the run-time
 * data model the report is built from. It is the productized form of the proven
 * sandbox prototype parser and is split into two cleanly separated layers:
 *
 * 1. **A pure parser** (`string → samples`) — {@link parseReportSamples} and
 *    {@link collectMetrics}. This is the core deliverable: it has no I/O, no AWS
 *    dependency, and is exhaustively unit/property tested. It reads ONLY
 *    authoritative `REPORT RequestId` lines, classifies cold/warm, attributes
 *    the startup phase per variant, composes `Cold_Invoke_Server_Time`, and
 *    counts errors/throttles.
 * 2. **A thin I/O subsystem** ({@link MetricsCollector}) that reads a variant's
 *    dedicated log group through an injected {@link LogEventsReader} and feeds
 *    the bytes to the pure parser.
 *
 * ## CloudWatch Logs dependency boundary (dependency inversion)
 *
 * `@aws-sdk/client-cloudwatch-logs` is a **devDependency only** of this package,
 * never a runtime dependency. This module therefore imports NO concrete
 * CloudWatch Logs client. The "read from a log group" capability is expressed as
 * the minimal injected {@link LogEventsReader} contract (mirroring the
 * constructor-injected clients of `./manifest-loader`), so unit tests pass a mock
 * and never touch AWS, and a concrete CloudWatch-Logs-backed reader can be wired
 * by a caller that owns that dependency without dragging it into `src/`.
 *
 * ## CDK-free constraint
 *
 * This module imports nothing from `aws-cdk-lib`/`constructs` (and no AWS SDK
 * client). It is pure run-time logic, keeping the runner package CDK-free
 * (enforced by `test/benchmark-runner-cdk-free.test.ts`).
 *
 * @remarks
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 16.1, 16.2, 16.5
 *
 * @module benchmark/runner/metrics-collector
 */

/** A single parsed CloudWatch `REPORT` sample for one invocation. */
export interface ReportSample {
  readonly requestId: string;
  readonly variant: 'baseline' | 'kata';
  readonly cold: boolean;
  /** Baseline cold-start platform phase. */
  readonly initDurationMs?: number;
  /** Kata cold-start platform phase. */
  readonly restoreDurationMs?: number;
  /** Handler duration of THIS invocation. */
  readonly durationMs: number;
  readonly billedMs: number;
  readonly maxMemoryMb: number;
  readonly memorySizeMb: number;
  /** startup phase + same-invoke duration (Req 16.1, 16.2). */
  readonly coldInvokeServerTimeMs?: number;
}

/**
 * The prefix that uniquely identifies an authoritative platform `REPORT` line.
 *
 * Matching this as a line PREFIX (after trimming) is what makes the parser
 * reject runtime `RESTORE_REPORT` lines: `'RESTORE_REPORT RequestId'` does not
 * start with `'REPORT RequestId'`, even though it contains the substring
 * `'REPORT RequestId'`. A substring/`includes` test would wrongly match, so the
 * collector always anchors at the start of the line (Req 15.6, Property 8).
 */
const REPORT_LINE_PREFIX = 'REPORT RequestId';

/**
 * Field extractors for a single `REPORT` line.
 *
 * Each metric (except the request id) is anchored on the leading TAB that
 * CloudWatch uses to delimit `REPORT` fields. The tab anchor is essential for
 * {@link RE_DURATION}: without it, `\tDuration:` would also match inside
 * `Billed Duration:`, `Init Duration:`, and `Restore Duration:`. Anchoring on
 * `\t` isolates the standalone handler `Duration` from the qualified durations.
 */
const RE_REQUEST_ID = /REPORT RequestId:\s*([0-9a-fA-F-]+)/;
const RE_DURATION = /\tDuration:\s*([\d.]+) ms/;
const RE_BILLED = /\tBilled Duration:\s*([\d.]+) ms/;
const RE_INIT = /\tInit Duration:\s*([\d.]+) ms/;
const RE_RESTORE = /\tRestore Duration:\s*([\d.]+) ms/;
const RE_MAX_MEMORY = /\tMax Memory Used:\s*(\d+) MB/;
const RE_MEMORY_SIZE = /\tMemory Size:\s*(\d+) MB/;

/**
 * Per-line indicators that a Lambda invocation ERRORED (Req 15.4).
 *
 * These match the platform/runtime error surfaces: the platform `Status: error`
 * field on a logging-config function report, a structured `errorType` field
 * emitted by the runtime on an unhandled fault, and the runtime's
 * task-timed-out line.
 */
const ERROR_INDICATORS: readonly RegExp[] = [
  /\bStatus:\s*error\b/i,
  /errorType/,
  /Task timed out after/i,
];

/**
 * Per-line indicators that a Lambda invocation was THROTTLED (Req 15.4).
 *
 * These match the AWS throttling surfaces: the API error `Rate Exceeded`, the
 * SDK exception name `TooManyRequestsException`, and any `Throttl*`
 * (Throttled/Throttling) message.
 */
const THROTTLE_INDICATORS: readonly RegExp[] = [
  /Rate Exceeded/i,
  /TooManyRequestsException/,
  /Throttl/i,
];

/**
 * A per-variant metrics surface: the parsed samples plus the observed error and
 * throttle counts for the variant (Req 15.4).
 *
 * This is the explicit, typed result the runner consumes. `errors` and
 * `throttles` are counted as "one per matching log line" against the
 * {@link ERROR_INDICATORS}/{@link THROTTLE_INDICATORS}; a single line that
 * matches both an error and a throttle indicator contributes to both counts
 * (a throttled invocation that also surfaced an error).
 */
export interface VariantMetrics {
  /** Which variant the metrics belong to. */
  readonly variant: 'baseline' | 'kata';
  /** The authoritative `REPORT`-derived samples for the variant. */
  readonly samples: readonly ReportSample[];
  /** Count of log lines indicating an invocation error (Req 15.4). */
  readonly errors: number;
  /** Count of log lines indicating a throttle (Req 15.4). */
  readonly throttles: number;
}

/**
 * Reconciliation entry for an EXPECTED invocation whose `REPORT` was found.
 *
 * @see SampleReconciliation
 */
export interface PresentSample {
  /** Discriminant: the expected invocation has a matching `REPORT`. */
  readonly missing: false;
  /** The request id this entry reconciles. */
  readonly requestId: string;
  /** The authoritative sample parsed from the matching `REPORT` line. */
  readonly sample: ReportSample;
}

/**
 * Reconciliation entry for an EXPECTED invocation with NO matching `REPORT`.
 *
 * Missing is modeled explicitly (Req 15.7, Property 8): the collector never
 * back-fills a missing invocation with another invocation's sample, so a
 * `MissingSample` carries the request id only — there is structurally no place
 * to smuggle a substituted record.
 */
export interface MissingSample {
  /** Discriminant: the expected invocation has no matching `REPORT`. */
  readonly missing: true;
  /** The request id that was expected but never reported. */
  readonly requestId: string;
}

/**
 * The result of reconciling expected invocation request-ids against the parsed
 * samples: a discriminated union of present-vs-missing, one entry per expected
 * request id (Req 15.7, Property 8).
 */
export type SampleReconciliation = PresentSample | MissingSample;

/**
 * A read query for a variant's dedicated CloudWatch log group, optionally bound
 * to the run's time window.
 */
export interface LogEventsQuery {
  /** The variant's dedicated log group name (e.g. `/aws/lambda/<fn>`). */
  readonly logGroupName: string;
  /** Inclusive lower bound of the run window (epoch ms); omit for unbounded. */
  readonly startTimeMs?: number;
  /** Inclusive upper bound of the run window (epoch ms); omit for unbounded. */
  readonly endTimeMs?: number;
}

/**
 * The minimal log-reading capability the {@link MetricsCollector} depends on,
 * injected to keep the collector CDK-free, AWS-SDK-free, and unit-testable
 * (dependency inversion; mirrors the injected clients of `./manifest-loader`).
 *
 * Implementations return the raw log-event messages for the query (each element
 * is one CloudWatch log-event `message`). The concrete implementation —
 * typically backed by `@aws-sdk/client-cloudwatch-logs`, which is a
 * devDependency of this package — is supplied by the caller; the collector never
 * imports it, so the dev-only CloudWatch Logs dependency never becomes a runtime
 * dependency of `src/`.
 */
export interface LogEventsReader {
  /**
   * Read all log-event messages for `query`.
   *
   * @param query - The log group and optional time window to read.
   * @returns The raw event messages, in any order; the collector concatenates
   *   them before parsing, so ordering is not required.
   */
  readLogEvents(query: LogEventsQuery): Promise<readonly string[]>;
}

/**
 * The combined result of {@link MetricsCollector.collectAndReconcile}: the
 * variant metrics plus the explicit reconciliation of every expected invocation.
 */
export interface ReconciledVariantMetrics {
  /** The per-variant metrics (samples + error/throttle counts). */
  readonly metrics: VariantMetrics;
  /** Present/missing entry for each expected request id (Req 15.7). */
  readonly reconciliation: readonly SampleReconciliation[];
}

/**
 * Resolve the cold-start startup phase a variant is allowed to attribute, given
 * the raw `Init`/`Restore` values parsed from a line.
 *
 * Enforces Req 15.5 structurally: a baseline may attribute ONLY `Init Duration`
 * and a kata may attribute ONLY `Restore Duration`. A stray cross-variant
 * startup field on a line (e.g. an `Init Duration` on a kata line) is ignored
 * for attribution, so `initDurationMs` is never populated for a kata and
 * `restoreDurationMs` is never populated for a baseline.
 *
 * @internal
 */
function resolveStartupMs(
  variant: 'baseline' | 'kata',
  initMs: number | undefined,
  restoreMs: number | undefined,
): number | undefined {
  return variant === 'baseline' ? initMs : restoreMs;
}

/**
 * Extract the first capture group of `pattern` from `line` as a finite number,
 * or `undefined` when the field is absent.
 *
 * @internal
 */
function matchNumber(line: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(line);
  if (match === null) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Parse a SINGLE authoritative `REPORT` line into a {@link ReportSample}.
 *
 * Returns `null` when the line is not an authoritative platform `REPORT` line
 * (including every `RESTORE_REPORT` line) or is too malformed to yield a usable
 * sample (no request id, or no handler `Duration`). The cold/warm classification
 * and `Cold_Invoke_Server_Time` composition follow Req 15.3/15.5 and 16.1/16.2.
 *
 * @param variant - The variant the line belongs to; drives startup attribution.
 * @param line - One log line (already split from the log content).
 * @returns The parsed sample, or `null` if the line is not a usable `REPORT`.
 *
 * @internal
 */
function parseReportLine(
  variant: 'baseline' | 'kata',
  line: string,
): ReportSample | null {
  const trimmed = line.trim();
  // Authoritative source ONLY: ignore RESTORE_REPORT and any non-REPORT line
  // (Req 15.6, Property 8). Anchored at the start so 'RESTORE_REPORT ...' — which
  // merely CONTAINS 'REPORT RequestId' — is never matched.
  if (!trimmed.startsWith(REPORT_LINE_PREFIX)) {
    return null;
  }

  const requestId = RE_REQUEST_ID.exec(trimmed)?.[1];
  const durationMs = matchNumber(trimmed, RE_DURATION);
  if (requestId === undefined || durationMs === undefined) {
    return null;
  }

  const initMs = matchNumber(trimmed, RE_INIT);
  const restoreMs = matchNumber(trimmed, RE_RESTORE);
  const startupMs = resolveStartupMs(variant, initMs, restoreMs);
  const cold = startupMs !== undefined;

  return {
    requestId,
    variant,
    cold,
    // Attribute Init→baseline cold ONLY, Restore→kata cold ONLY (Req 15.5).
    initDurationMs: variant === 'baseline' ? initMs : undefined,
    restoreDurationMs: variant === 'kata' ? restoreMs : undefined,
    durationMs,
    billedMs: matchNumber(trimmed, RE_BILLED) ?? 0,
    maxMemoryMb: matchNumber(trimmed, RE_MAX_MEMORY) ?? 0,
    memorySizeMb: matchNumber(trimmed, RE_MEMORY_SIZE) ?? 0,
    // Cold_Invoke_Server_Time = startup phase + the SAME invocation's Duration
    // (Req 16.1, 16.2). The post-restore reconnect cost lives inside this
    // invocation's Duration and is therefore included here, never subtracted out
    // (Req 16.5). Warm samples have no startup phase and thus no value.
    coldInvokeServerTimeMs: cold ? startupMs + durationMs : undefined,
  };
}

/**
 * Split raw log content into individual lines, tolerant of `\n` and `\r\n`.
 *
 * @internal
 */
function toLines(logContent: string): string[] {
  return logContent.split(/\r?\n/);
}

/**
 * Count the number of lines in `logContent` that match ANY of `indicators`.
 *
 * Counting is "one per matching line": a line contributes at most one to the
 * total regardless of how many indicators it matches, which keeps error and
 * throttle tallies proportional to log lines rather than to pattern overlap.
 *
 * @internal
 */
function countMatchingLines(
  logContent: string,
  indicators: readonly RegExp[],
): number {
  let count = 0;
  for (const line of toLines(logContent)) {
    if (indicators.some((pattern) => pattern.test(line))) {
      count += 1;
    }
  }
  return count;
}

/**
 * Parse CloudWatch `REPORT` log content into {@link ReportSample}s (Req 15.1).
 *
 * Reads ONLY authoritative `REPORT RequestId` lines, ignoring every
 * `RESTORE_REPORT` line (Req 15.6, Property 8). Each sample is classified cold
 * vs warm (Req 15.3); `Init Duration` is attributed to the baseline cold path
 * and `Restore Duration` to the kata cold path (Req 15.5); and a cold sample's
 * `coldInvokeServerTimeMs` is composed as startup phase + that same invocation's
 * `Duration` (Req 16.1, 16.2).
 *
 * @param variant - Which variant the log content belongs to.
 * @param logContent - Raw log content from the variant's dedicated log group.
 * @returns The parsed samples, in line order, excluding non-`REPORT` lines.
 */
export function parseReportSamples(
  variant: 'baseline' | 'kata',
  logContent: string,
): ReportSample[] {
  const samples: ReportSample[] = [];
  for (const line of toLines(logContent)) {
    const sample = parseReportLine(variant, line);
    if (sample !== null) {
      samples.push(sample);
    }
  }
  return samples;
}

/**
 * Parse log content into the full per-variant metrics surface: the samples plus
 * the observed error and throttle counts (Req 15.1, 15.4).
 *
 * @param variant - Which variant the log content belongs to.
 * @param logContent - Raw log content from the variant's dedicated log group.
 * @returns The variant's samples and error/throttle counts.
 */
export function collectMetrics(
  variant: 'baseline' | 'kata',
  logContent: string,
): VariantMetrics {
  return {
    variant,
    samples: parseReportSamples(variant, logContent),
    errors: countMatchingLines(logContent, ERROR_INDICATORS),
    throttles: countMatchingLines(logContent, THROTTLE_INDICATORS),
  };
}

/**
 * Reconcile the EXPECTED benchmark invocation request-ids against the parsed
 * samples, marking any expected invocation with no matching `REPORT` as MISSING
 * rather than substituting an unrelated record (Req 15.7, Property 8).
 *
 * The result has exactly one entry per expected request id (in the order
 * supplied), deduplicated. A missing invocation yields a {@link MissingSample}
 * that carries only the request id — there is no field in which an unrelated
 * sample could be back-filled.
 *
 * @param expectedRequestIds - The request-ids the run expected to observe.
 * @param samples - The samples parsed from authoritative `REPORT` lines.
 * @returns One present/missing entry per (deduplicated) expected request id.
 */
export function reconcileSamples(
  expectedRequestIds: Iterable<string>,
  samples: readonly ReportSample[],
): SampleReconciliation[] {
  const byRequestId = new Map<string, ReportSample>();
  for (const sample of samples) {
    // First authoritative REPORT wins for a given id; never overwritten by a
    // later, unrelated record.
    if (!byRequestId.has(sample.requestId)) {
      byRequestId.set(sample.requestId, sample);
    }
  }

  const reconciliation: SampleReconciliation[] = [];
  const seen = new Set<string>();
  for (const requestId of expectedRequestIds) {
    if (seen.has(requestId)) {
      continue;
    }
    seen.add(requestId);
    const sample = byRequestId.get(requestId);
    if (sample === undefined) {
      reconciliation.push({ missing: true, requestId });
    } else {
      reconciliation.push({ missing: false, requestId, sample });
    }
  }
  return reconciliation;
}

/**
 * Run-time subsystem that reads a variant's dedicated CloudWatch log group via
 * an injected {@link LogEventsReader} and parses it into the variant metrics
 * (Req 15.1).
 *
 * The collector owns NO AWS dependency: the reader is injected
 * (dependency inversion), so production callers supply a CloudWatch-Logs-backed
 * reader while unit tests supply a mock. This is what keeps the dev-only
 * `@aws-sdk/client-cloudwatch-logs` dependency out of the runtime surface of
 * `src/` and the runner package CDK-free.
 *
 * @remarks
 * Validates: Requirements 15.1, 15.4, 15.7
 */
export class MetricsCollector {
  private readonly reader: LogEventsReader;

  /**
   * @param reader - The injected log-reading capability. Required, so the
   *   collector is always constructed with an explicit dependency.
   */
  public constructor(reader: LogEventsReader) {
    this.reader = reader;
  }

  /**
   * Read the variant's log group and parse it into the variant metrics.
   *
   * @param variant - Which variant `query`'s log group belongs to.
   * @param query - The log group and optional run window to read.
   * @returns The variant's samples and error/throttle counts.
   */
  public async collect(
    variant: 'baseline' | 'kata',
    query: LogEventsQuery,
  ): Promise<VariantMetrics> {
    const messages = await this.reader.readLogEvents(query);
    return collectMetrics(variant, messages.join('\n'));
  }

  /**
   * Read the variant's log group, parse it, and reconcile the parsed samples
   * against the expected invocation request-ids in one step (Req 15.1, 15.7).
   *
   * @param variant - Which variant `query`'s log group belongs to.
   * @param query - The log group and optional run window to read.
   * @param expectedRequestIds - The request-ids the run expected to observe.
   * @returns The variant metrics and the present/missing reconciliation.
   */
  public async collectAndReconcile(
    variant: 'baseline' | 'kata',
    query: LogEventsQuery,
    expectedRequestIds: Iterable<string>,
  ): Promise<ReconciledVariantMetrics> {
    const metrics = await this.collect(variant, query);
    return {
      metrics,
      reconciliation: reconcileSamples(expectedRequestIds, metrics.samples),
    };
  }
}

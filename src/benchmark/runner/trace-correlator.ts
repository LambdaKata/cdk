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
 * Layer D — {@link TraceCorrelator}: deterministic trace correlation (run-time,
 * CDK-free).
 *
 * ## Responsibility
 *
 * The correlator makes report attribution and ABBA sequencing unambiguous
 * (Req 19). It owns three concerns:
 *
 * 1. **Run identity (Req 19.1).** {@link createBenchRunId} mints a unique,
 *    collision-resistant `Bench_Run_Id` per run; {@link TraceCorrelator} binds
 *    one id for a run's lifetime and stamps it onto every marker it issues.
 * 2. **Event/invocation tagging (Req 19.2).** {@link buildMarker} composes a
 *    `(benchRunId, variant, phase, window)` {@link CorrelationMarker};
 *    {@link embedMarker}/{@link tagEvent} attach it to a generated event payload
 *    under the reserved {@link MARKER_KEY} **where the trigger type permits a
 *    correlation marker** (the load generators of task 19 are the producers of
 *    those events). {@link extractMarker} recovers it.
 * 3. **Sample association + window fallback (Req 19.3, 19.4).**
 *    {@link correlateSamples} pairs each collected {@link ReportSample} with its
 *    run/variant/phase/window into a non-breaking {@link CorrelatedSample},
 *    choosing `invocation-correlated` when the trigger carried a marker and
 *    falling back to `window-correlated` when it could not (the affected samples
 *    are then rendered as window-correlated by the {@link ReportRenderer}).
 *
 * ## Why a non-breaking association type
 *
 * Per Req 19.3 every sample must be associated with its
 * `benchRunId/variant/phase/window`, but {@link ReportSample} is the
 * {@link MetricsCollector}'s owned output shape and is depended on (unchanged) by
 * the collector and its tests. Correlation is therefore expressed as the
 * additive {@link CorrelatedSample} wrapper (sample + correlation fields + mode)
 * rather than by mutating {@link ReportSample} — backward-compatible by design.
 *
 * ## CDK-free + dependency-light constraint
 *
 * This module imports nothing from `aws-cdk-lib`/`constructs` and no AWS SDK
 * client — only Node's built-in `crypto` (Node ≥ 18, the project minimum). The
 * trigger-type literal union {@link BenchTriggerType} is declared **locally**
 * (it mirrors the synth-time `TriggerDeclaration['type']` discriminants) rather
 * than imported from `../triggers/types`, because that module carries
 * `import type` references to `aws-cdk-lib`; re-declaring the plain string
 * literals here keeps the runner package CDK-free (enforced by
 * `test/benchmark-runner-cdk-free.test.ts`).
 *
 * @remarks
 * Validates: Requirements 19.1, 19.2, 19.3, 19.4
 *
 * @module benchmark/runner/trace-correlator
 */

import { randomUUID } from 'crypto';

import type { ReportSample } from './metrics-collector';

/**
 * The variant a correlation marker (or sample) belongs to — the immutable
 * baseline (Node.js) or the kata clone (SnapStart). Mirrors
 * {@link ReportSample.variant} and the runner's `VariantId`.
 */
export type CorrelationVariant = 'baseline' | 'kata';

/**
 * The string-literal discriminants of the supported benchmark trigger types.
 *
 * This is a local mirror of the synth-time `TriggerDeclaration['type']` union
 * (`src/benchmark/triggers/types.ts`). It is intentionally re-declared here as
 * plain literals — never imported — so the CDK-free runner package does not pull
 * in the `aws-cdk-lib` type references that the synth-time trigger module
 * carries. The two unions are kept in lockstep by the exhaustiveness guard in
 * {@link triggerPermitsMarker}.
 */
export type BenchTriggerType =
  | 'invoke'
  | 'apiGateway'
  | 'functionUrl'
  | 'sqs'
  | 'eventBridge'
  | 'sns'
  | 'kinesis'
  | 'dynamoDbStreams'
  | 'kafka';

/**
 * How a sample is correlated back to the run that produced it (Req 19.4).
 *
 * - `invocation-correlated` — the generated event carried a
 *   {@link CorrelationMarker}, so the sample is tied to a specific invocation of
 *   the run.
 * - `window-correlated` — the trigger type could not carry a marker, so the
 *   sample is attributed by the time window it falls in rather than by a
 *   per-invocation marker. The {@link ReportRenderer} states this explicitly.
 */
export type CorrelationMode = 'invocation-correlated' | 'window-correlated';

/** A correlation marker attached to a generated event/invocation. */
export interface CorrelationMarker {
  readonly benchRunId: string;
  readonly variant: CorrelationVariant;
  readonly phase: string;
  readonly window: number;
}

/**
 * The reserved key under which a {@link CorrelationMarker} is embedded into a
 * generated event payload (Req 19.2).
 *
 * It is namespaced and underscore-prefixed to avoid colliding with a target
 * function's own payload fields. Load generators that target a marker-bearing
 * trigger write the marker here; the analysis side reads it back via
 * {@link extractMarker}.
 */
export const MARKER_KEY = '__kataBenchMarker' as const;

/**
 * A generated event payload carrying an embedded {@link CorrelationMarker} under
 * the reserved {@link MARKER_KEY}.
 *
 * @typeParam T - The original payload shape, preserved alongside the marker.
 */
export type MarkedPayload<T extends object = Record<string, unknown>> = T & {
  readonly [MARKER_KEY]: CorrelationMarker;
};

/**
 * The result of tagging a generated event (Req 19.2, 19.4).
 *
 * `mode` records whether the event could carry a marker: when
 * `invocation-correlated`, {@link payload} carries the embedded {@link marker};
 * when `window-correlated`, the trigger could not carry a marker so
 * {@link payload} is the original (untouched) payload and {@link marker} is
 * absent.
 *
 * @typeParam T - The original payload shape.
 */
export interface TaggedEvent<T extends object = Record<string, unknown>> {
  /** The correlation mode chosen for this trigger type. */
  readonly mode: CorrelationMode;
  /**
   * The payload to deliver: marker-embedded when invocation-correlated, the
   * original payload when window-correlated.
   */
  readonly payload: T | MarkedPayload<T>;
  /** The embedded marker when invocation-correlated; absent otherwise. */
  readonly marker?: CorrelationMarker;
}

/**
 * The run/variant/phase/window context a sample is correlated against (Req 19.3).
 *
 * This is the marker's field set minus the trigger-type concern; it is the
 * minimal coordinate the {@link MetricsCollector}'s samples are associated with.
 */
export interface CorrelationContext {
  readonly benchRunId: string;
  readonly variant: CorrelationVariant;
  readonly phase: string;
  readonly window: number;
}

/**
 * A collected {@link ReportSample} associated with its run coordinate and
 * correlation mode (Req 19.3, 19.4).
 *
 * This is the additive, non-breaking association type: it WRAPS a
 * {@link ReportSample} rather than extending it, so the collector's owned sample
 * shape is untouched. The four correlation fields satisfy Req 19.3; {@link mode}
 * carries the invocation-vs-window distinction of Req 19.4 through to the report.
 */
export interface CorrelatedSample {
  /** The collected sample, unchanged. */
  readonly sample: ReportSample;
  /** The run this sample belongs to (Req 19.1, 19.3). */
  readonly benchRunId: string;
  /** The variant this sample belongs to (Req 19.3). */
  readonly variant: CorrelationVariant;
  /** The run phase this sample was collected in (Req 19.3). */
  readonly phase: string;
  /** The window sequence this sample was collected in (Req 19.3). */
  readonly window: number;
  /** Whether the sample is invocation- or window-correlated (Req 19.4). */
  readonly mode: CorrelationMode;
}

/**
 * The trigger types that PERMIT a per-invocation correlation marker (Req 19.2).
 *
 * These are the request/response sources whose invocation the load generator
 * controls directly (`invoke` via client context / payload, `apiGateway` and
 * `functionUrl` via request body/header) and the push/attribute-bearing sources
 * whose records the generator publishes with a marker (`sqs` message attribute,
 * `sns` message attribute, `eventBridge` detail field). For these, a sample can
 * be tied to a specific invocation.
 */
export const MARKER_PERMITTED_TRIGGER_TYPES: readonly BenchTriggerType[] = [
  'invoke',
  'apiGateway',
  'functionUrl',
  'sqs',
  'eventBridge',
  'sns',
];

/**
 * The trigger types that do NOT permit a per-invocation marker and so fall back
 * to window-correlation (Req 19.4).
 *
 * These are the pure stream/read sources (`kinesis`, `dynamoDbStreams`, `kafka`)
 * whose records the harness does not author with a per-invocation marker channel
 * tied to a single Lambda invocation; their samples are attributed by time
 * window instead.
 */
export const WINDOW_CORRELATED_TRIGGER_TYPES: readonly BenchTriggerType[] = [
  'kinesis',
  'dynamoDbStreams',
  'kafka',
];

/** O(1) membership set backing {@link triggerPermitsMarker}. */
const MARKER_PERMITTED_SET: ReadonlySet<BenchTriggerType> = new Set(
  MARKER_PERMITTED_TRIGGER_TYPES,
);

/**
 * Mint a unique `Bench_Run_Id` for a run (Req 19.1).
 *
 * The id is collision-resistant and tag-safe: a stable `bench-` prefix, a
 * base-36 millisecond timestamp (human-orderable), and a UUID-derived random
 * segment. It matches `^[a-z0-9-]+$`, so it is safe to use directly as an
 * AWS ownership-tag value and as a resource-name fragment (Req 20.1).
 *
 * @returns A unique run identifier, unique per call.
 */
export function createBenchRunId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomUUID().replace(/-/g, '');
  return `bench-${timestamp}-${random}`;
}

/**
 * Build a {@link CorrelationMarker} for a `(benchRunId, variant, phase, window)`
 * coordinate (Req 19.2).
 *
 * @param benchRunId - The run id minted by {@link createBenchRunId}.
 * @param variant - The variant the event/invocation targets.
 * @param phase - The run phase (e.g. an ABBA window label).
 * @param window - The window sequence number.
 * @returns The composed marker.
 */
export function buildMarker(
  benchRunId: string,
  variant: CorrelationVariant,
  phase: string,
  window: number,
): CorrelationMarker {
  return { benchRunId, variant, phase, window };
}

/**
 * Whether `type` permits a per-invocation correlation marker (Req 19.2).
 *
 * The `switch` is exhaustive over {@link BenchTriggerType}; its `default` branch
 * is a compile-time `never` guard, so adding a new trigger discriminant without
 * deciding its correlation mode is a build error rather than a silent default.
 *
 * @param type - The trigger discriminant.
 * @returns `true` when the trigger can carry a marker, `false` when its samples
 *   must fall back to window-correlation.
 */
export function triggerPermitsMarker(type: BenchTriggerType): boolean {
  switch (type) {
    case 'invoke':
    case 'apiGateway':
    case 'functionUrl':
    case 'sqs':
    case 'eventBridge':
    case 'sns':
      return true;
    case 'kinesis':
    case 'dynamoDbStreams':
    case 'kafka':
      return false;
    default:
      return assertExhaustive(type);
  }
}

/**
 * The {@link CorrelationMode} a trigger type maps to (Req 19.2, 19.4).
 *
 * @param type - The trigger discriminant.
 * @returns `invocation-correlated` when the trigger permits a marker, otherwise
 *   `window-correlated`.
 */
export function correlationModeFor(type: BenchTriggerType): CorrelationMode {
  return triggerPermitsMarker(type)
    ? 'invocation-correlated'
    : 'window-correlated';
}

/**
 * Embed a {@link CorrelationMarker} into a copy of `payload` under the reserved
 * {@link MARKER_KEY} (Req 19.2).
 *
 * The source payload is never mutated — a shallow copy is returned with the
 * marker added — so callers can safely reuse the original event template.
 *
 * @typeParam T - The original payload shape.
 * @param payload - The event payload to tag.
 * @param marker - The marker to embed.
 * @returns A new payload carrying the marker.
 */
export function embedMarker<T extends object>(
  payload: T,
  marker: CorrelationMarker,
): MarkedPayload<T> {
  return { ...payload, [MARKER_KEY]: marker };
}

/**
 * Recover a {@link CorrelationMarker} previously embedded by {@link embedMarker}
 * (Req 19.2).
 *
 * Returns `undefined` when `value` is not an object, carries no marker, or the
 * value under {@link MARKER_KEY} is not a well-formed marker — so a malformed or
 * absent marker can never be silently treated as valid.
 *
 * @param value - A value that may be a marked payload.
 * @returns The recovered marker, or `undefined` when none is present/valid.
 */
export function extractMarker(value: unknown): CorrelationMarker | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[MARKER_KEY];
  return isCorrelationMarker(candidate) ? candidate : undefined;
}

/**
 * Tag a generated event for a trigger, choosing the correlation mode by trigger
 * type (Req 19.2, 19.4).
 *
 * When the trigger PERMITS a marker, the marker is embedded into the payload and
 * the result is `invocation-correlated`. When it does NOT, the payload is left
 * untouched and the result is `window-correlated` — there is structurally no
 * marker to attach, so a window-correlated event can never accidentally carry
 * one.
 *
 * @typeParam T - The original payload shape.
 * @param type - The trigger discriminant the event is generated for.
 * @param payload - The event payload to deliver.
 * @param marker - The marker to embed when the trigger permits one.
 * @returns The tagged event with its chosen {@link CorrelationMode}.
 */
export function tagEvent<T extends object>(
  type: BenchTriggerType,
  payload: T,
  marker: CorrelationMarker,
): TaggedEvent<T> {
  if (triggerPermitsMarker(type)) {
    return {
      mode: 'invocation-correlated',
      payload: embedMarker(payload, marker),
      marker,
    };
  }
  return { mode: 'window-correlated', payload };
}

/**
 * Associate collected samples with a run coordinate, choosing invocation- vs
 * window-correlation by trigger type (Req 19.3, 19.4).
 *
 * Every sample is wrapped into a {@link CorrelatedSample} carrying the
 * `benchRunId/variant/phase/window` (Req 19.3); the {@link CorrelationMode} is
 * `invocation-correlated` when the trigger permits a marker and
 * `window-correlated` otherwise (Req 19.4). Sample order and count are preserved.
 *
 * @param type - The trigger discriminant the samples were generated under.
 * @param samples - The collected samples to correlate.
 * @param context - The run/variant/phase/window coordinate to associate.
 * @returns One correlated sample per input sample, in input order.
 */
export function correlateSamples(
  type: BenchTriggerType,
  samples: readonly ReportSample[],
  context: CorrelationContext,
): CorrelatedSample[] {
  const mode = correlationModeFor(type);
  return samples.map((sample) => ({
    sample,
    benchRunId: context.benchRunId,
    variant: context.variant,
    phase: context.phase,
    window: context.window,
    mode,
  }));
}

/**
 * Run-scoped facade over the correlation functions (Req 19).
 *
 * A `TraceCorrelator` binds ONE `Bench_Run_Id` for the lifetime of a run
 * (Req 19.1) and offers ergonomic {@link marker}/{@link tag}/{@link correlate}
 * methods that stamp that id automatically, so callers (the
 * {@link BenchmarkRunner} and the load generators) never thread the run id by
 * hand or risk mixing ids across a run.
 *
 * @remarks
 * Validates: Requirements 19.1, 19.2, 19.3, 19.4
 */
export class TraceCorrelator {
  /** The immutable run id bound for this correlator's lifetime (Req 19.1). */
  public readonly benchRunId: string;

  /**
   * @param benchRunId - An explicit run id to bind (e.g. to correlate against a
   *   known run); when omitted a fresh unique id is minted via
   *   {@link createBenchRunId} (Req 19.1).
   */
  public constructor(benchRunId: string = createBenchRunId()) {
    this.benchRunId = benchRunId;
  }

  /**
   * Build a {@link CorrelationMarker} for this run (Req 19.2).
   *
   * @param variant - The variant the marker targets.
   * @param phase - The run phase.
   * @param window - The window sequence number.
   * @returns A marker stamped with {@link benchRunId}.
   */
  public marker(
    variant: CorrelationVariant,
    phase: string,
    window: number,
  ): CorrelationMarker {
    return buildMarker(this.benchRunId, variant, phase, window);
  }

  /**
   * Tag a generated event for this run, choosing the mode by trigger type
   * (Req 19.2, 19.4).
   *
   * @typeParam T - The original payload shape.
   * @param type - The trigger discriminant the event is generated for.
   * @param payload - The event payload to deliver.
   * @param variant - The variant the event targets.
   * @param phase - The run phase.
   * @param window - The window sequence number.
   * @returns The tagged event with its chosen {@link CorrelationMode}.
   */
  public tag<T extends object>(
    type: BenchTriggerType,
    payload: T,
    variant: CorrelationVariant,
    phase: string,
    window: number,
  ): TaggedEvent<T> {
    return tagEvent(type, payload, this.marker(variant, phase, window));
  }

  /**
   * Associate collected samples with this run's coordinate (Req 19.3, 19.4).
   *
   * @param type - The trigger discriminant the samples were generated under.
   * @param samples - The collected samples to correlate.
   * @param variant - The variant the samples belong to.
   * @param phase - The run phase.
   * @param window - The window sequence number.
   * @returns One correlated sample per input sample, in input order.
   */
  public correlate(
    type: BenchTriggerType,
    samples: readonly ReportSample[],
    variant: CorrelationVariant,
    phase: string,
    window: number,
  ): CorrelatedSample[] {
    return correlateSamples(type, samples, {
      benchRunId: this.benchRunId,
      variant,
      phase,
      window,
    });
  }
}

/**
 * Structural type guard for a {@link CorrelationMarker}.
 *
 * @internal
 */
function isCorrelationMarker(value: unknown): value is CorrelationMarker {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const marker = value as Record<string, unknown>;
  return (
    typeof marker.benchRunId === 'string' &&
    (marker.variant === 'baseline' || marker.variant === 'kata') &&
    typeof marker.phase === 'string' &&
    typeof marker.window === 'number'
  );
}

/**
 * Compile-time exhaustiveness guard for {@link BenchTriggerType}.
 *
 * If a new trigger discriminant is added without a branch in
 * {@link triggerPermitsMarker}, `value` is no longer `never` and this call fails
 * to type-check — surfacing the missing correlation decision at build time.
 *
 * @param value - The unhandled trigger type, expected to be `never`.
 * @throws Always, as a defensive runtime guard for the unreachable branch.
 */
function assertExhaustive(value: never): never {
  throw new Error(
    `Unhandled trigger type in TraceCorrelator: ${JSON.stringify(value)}. ` +
    'Every BenchTriggerType must have a correlation-mode decision (Req 19.2, 19.4).',
  );
}

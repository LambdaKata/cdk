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
 * Layer D — Run-time runner package barrel (run-time, CDK-free).
 *
 * Single import site for the standalone `lambda-kata-bench` runner's public
 * surface: the shared run-time report types, the {@link ManifestLoader}, and the
 * public types/functions of the runner subsystems (each implemented in a later
 * task; their stubs are surfaced here so the barrel is stable).
 *
 * **CDK-free by construction.** Everything re-exported here imports the AWS SDK
 * and CDK-free modules only — NEVER `aws-cdk-lib` or `constructs`. This is the
 * boundary that lets the runner ship without CDK; it is enforced by the guard
 * test in `test/benchmark-runner-cdk-free.test.ts`. Consequently the synth-time
 * `../index` barrel does NOT re-export this package (and vice versa).
 *
 * @remarks
 * Validates: Requirements 10.3, 17.1, 17.2, 18 (host)
 *
 * @module benchmark/runner
 */

// Shared run-time report types (task 16).
export type {
  ReportSample,
  Distribution,
  SuppressionReason,
  VariantId,
  VariantStats,
  BenchmarkHeadline,
  BenchmarkReport,
} from './types';

// Manifest loader — run-time half of the synth→run-time bridge (task 16).
export { ManifestLoader, ManifestLoadError, S3_POINTER_SCHEME } from './manifest-loader';
export type { ManifestLoaderClients } from './manifest-loader';

// TriggerToggler — run-time event-source-mapping toggling control plane (task 20).
export {
  TriggerToggler,
  LambdaEventSourceMappingControl,
  TriggerToggleError,
  TRANSIENT_MAPPING_STATES,
  DEFAULT_MAX_SETTLE_POLLS,
  DEFAULT_POLL_INTERVAL_MS,
} from './trigger-toggler';
export type {
  EventSourceMappingControlClient,
  EventSourceMappingState,
  EventSourceMappingStatus,
  UpdateEventSourceMappingRequest,
  CompetingMappingPair,
  ActivateVariantResult,
  ToggleVariant,
  TriggerTogglerOptions,
} from './trigger-toggler';

// MetricsCollector — CloudWatch REPORT parsing (task 17).
export {
  parseReportSamples,
  collectMetrics,
  reconcileSamples,
  MetricsCollector,
} from './metrics-collector';
export type {
  VariantMetrics,
  PresentSample,
  MissingSample,
  SampleReconciliation,
  LogEventsQuery,
  LogEventsReader,
  ReconciledVariantMetrics,
} from './metrics-collector';

// TraceCorrelator — Bench_Run_Id minting + correlation (task 18).
export {
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
} from './trace-correlator';
export type {
  CorrelationMarker,
  CorrelationVariant,
  CorrelationMode,
  CorrelationContext,
  CorrelatedSample,
  MarkedPayload,
  TaggedEvent,
  BenchTriggerType,
} from './trace-correlator';

// ReportRenderer — layered HTML+JSON report (task 22).
export { renderReport } from './report-renderer';
export type { RenderedReport } from './report-renderer';

// LifecycleManager — tagging, guardrails, tag-scoped cleanup (task 23).
export { cleanupRun } from './lifecycle-manager';
export type { CleanupResult } from './lifecycle-manager';

// BenchmarkRunner state machine (task 21).
export {
  BenchmarkRunner,
  runBenchmark,
  LambdaSnapStartProbe,
  ABBA_SEQUENCE,
  DEFAULT_SNAPSTART_MAX_POLLS,
  DEFAULT_SNAPSTART_POLL_INTERVAL_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_CONCURRENCY,
} from './runner';
export type {
  RunMode,
  RunnerOptions,
  RunnerControlOptions,
  RunnerSubsystems,
  RunnerResult,
  RunStopReason,
  VariantRunOutcome,
  WindowOutcome,
  WindowLoadRequest,
  ProductionCanaryOptIn,
  SnapStartReadinessProbe,
  SnapStartReadinessResult,
  ManifestSource,
  VariantActivator,
  LoadDriver,
  VariantMetricsSource,
  ReportSink,
  CleanupRunner,
} from './runner';

// CLI entry point (task 24).
export { main } from './cli';

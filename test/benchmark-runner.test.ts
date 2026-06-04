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
 * Unit tests for the run-time {@link BenchmarkRunner} state machine (Layer D,
 * task 21).
 *
 * The runner orchestrates the documented state machine — read manifest → wait
 * SnapStart ready (per kata variant) → select mode → run windows (ABBA for
 * competing sources / parallel|request-response otherwise) → collect → report →
 * cleanup — while enforcing the max-duration guardrail. Every side effect is an
 * injected PORT, so these tests supply recording mocks (no AWS, no CDK, no
 * network) and assert the sequencing and gating invariants:
 *
 *  - ABBA sequencing toggles baseline → kata → kata → baseline with batch size
 *    and concurrency held CONSTANT across the four windows (Req 18.1–18.3);
 *  - a kata variant whose SnapStart never reports ready within the configured
 *    wait is marked invalid (with a reason) and the other variants still run
 *    (Req 18.4, 18.8);
 *  - observe-only (default) switches no trigger (Req 18.5);
 *  - production-canary requires an explicit valid opt-in; a missing/failed opt-in
 *    blocks switching with no fallback (Req 18.6, 18.7, Property 13);
 *  - on max-duration breach the runner stops load and disables benchmark-owned
 *    mappings (Req 20.4, Property 16).
 *
 * **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 20.4**
 *
 * @module benchmark-runner.test
 */

import {
  BenchmarkRunner,
  ABBA_SEQUENCE,
  type RunnerControlOptions,
  type RunnerSubsystems,
  type ManifestSource,
  type SnapStartReadinessProbe,
  type SnapStartReadinessResult,
  type VariantActivator,
  type LoadDriver,
  type WindowLoadRequest,
  type VariantMetricsSource,
  type ReportSink,
  type CleanupRunner,
} from '../src/benchmark/runner/runner';
import { TraceCorrelator } from '../src/benchmark/runner/trace-correlator';
import type {
  BenchmarkManifest,
  ManifestVariant,
  ManifestTrigger,
} from '../src/benchmark/manifest';
import { FidelityLevel } from '../src/benchmark/options';
import type { CompetingMappingPair, ToggleVariant, ActivateVariantResult } from '../src/benchmark/runner/trigger-toggler';
import type { VariantMetrics, ReportSample, LogEventsQuery } from '../src/benchmark/runner/metrics-collector';
import type { CleanupResult } from '../src/benchmark/runner/lifecycle-manager';
import type { RenderedReport } from '../src/benchmark/runner/report-renderer';

// ── Test fixtures ────────────────────────────────────────────────────────────

/** Build a competing-source manifest trigger with both mapping UUIDs. */
function competingTrigger(overrides: Partial<ManifestTrigger> = {}): ManifestTrigger {
  return {
    type: 'sqs',
    routingClass: 'competing',
    baselineMappingUuid: 'uuid-baseline',
    kataMappingUuid: 'uuid-kata',
    source: { isolated: true, ref: 'bench-queue' },
    ...overrides,
  };
}

/** Build a single baseline/kata manifest variant pair. */
function variant(
  constructPath: string,
  trigger?: ManifestTrigger,
): ManifestVariant {
  return {
    constructPath,
    baseline: {
      functionName: `${constructPath}-baseline`,
      functionArn: `arn:aws:lambda:::function:${constructPath}-baseline`,
      logGroup: `/aws/lambda/${constructPath}-baseline`,
    },
    kata: {
      functionName: `${constructPath}-kata`,
      functionArn: `arn:aws:lambda:::function:${constructPath}-kata`,
      aliasArn: `arn:aws:lambda:::function:${constructPath}-kata:kata`,
      version: '1',
      logGroup: `/aws/lambda/${constructPath}-kata`,
    },
    ...(trigger !== undefined ? { trigger } : {}),
  };
}

/** Build a manifest from a list of variants. */
function manifestOf(variants: ManifestVariant[]): BenchmarkManifest {
  return {
    schemaVersion: 1,
    benchRunSeed: 'seed',
    region: 'us-east-1',
    fidelity: FidelityLevel.L0,
    sideEffectPolicy: 'unsafe',
    ownershipTag: { key: 'kata:benchRunId', value: 'bench-1' },
    variants,
    runDesign: {
      fidelity: FidelityLevel.L0,
      sideEffectPolicy: 'unsafe',
      roleMode: 'reuse-role',
      eligibility: [],
      findings: [],
      acknowledgements: [],
      envKeysCopied: {},
      perTrigger: [],
    },
  };
}

/** A manifest source returning a fixed manifest. */
function manifestSourceOf(manifest: BenchmarkManifest): ManifestSource {
  return { loadManifest: jest.fn().mockResolvedValue(manifest) };
}

/** A SnapStart probe that always reports ready (Active/On). */
function alwaysReadyProbe(): SnapStartReadinessProbe {
  return {
    checkReadiness: jest
      .fn<Promise<SnapStartReadinessResult>, [string, string]>()
      .mockResolvedValue({ ready: true, status: 'Active/On' }),
  };
}

/**
 * A recording {@link VariantActivator} that tracks, in call order, every
 * activation and disableBoth so a test can assert the ABBA toggle sequence.
 */
class RecordingActivator implements VariantActivator {
  public readonly activations: ToggleVariant[] = [];
  public readonly disableBothCalls: CompetingMappingPair[] = [];

  public async activateVariant(
    pair: CompetingMappingPair,
    variantToActivate: ToggleVariant,
  ): Promise<ActivateVariantResult> {
    this.activations.push(variantToActivate);
    const activeUuid =
      variantToActivate === 'baseline'
        ? pair.baselineMappingUuid
        : pair.kataMappingUuid;
    const inactiveUuid =
      variantToActivate === 'baseline'
        ? pair.kataMappingUuid
        : pair.baselineMappingUuid;
    return {
      active: variantToActivate,
      activeUuid,
      inactiveUuid,
      activeState: 'Enabled',
      inactiveState: 'Disabled',
    };
  }

  public async disableBoth(pair: CompetingMappingPair): Promise<void> {
    this.disableBothCalls.push(pair);
  }
}

/** A recording {@link LoadDriver} that captures every window request. */
class RecordingLoadDriver implements LoadDriver {
  public readonly requests: WindowLoadRequest[] = [];
  public async runWindowLoad(request: WindowLoadRequest): Promise<void> {
    this.requests.push(request);
  }
}

/** A metrics source returning empty samples for any variant. */
function emptyMetricsSource(): VariantMetricsSource {
  const collect = jest
    .fn<Promise<VariantMetrics>, ['baseline' | 'kata', LogEventsQuery]>()
    .mockImplementation(async (variantId) => ({
      variant: variantId,
      samples: [] as ReportSample[],
      errors: 0,
      throttles: 0,
    }));
  return { collect };
}

/** A report sink returning a fixed rendered report. */
function fixedReportSink(): ReportSink {
  const rendered: RenderedReport = { json: '{}', html: '<html></html>' };
  return { render: jest.fn().mockReturnValue(rendered) };
}

/** A cleanup runner returning a complete cleanup. */
function completeCleanup(): CleanupRunner {
  const result: CleanupResult = { complete: true, remaining: [] };
  return { cleanupRun: jest.fn().mockResolvedValue(result) };
}

/**
 * Assemble a full subsystem bundle with sensible recording mocks; individual
 * fields can be overridden per test.
 */
function subsystemsOf(
  manifest: BenchmarkManifest,
  overrides: Partial<RunnerSubsystems> = {},
): RunnerSubsystems {
  return {
    manifestSource: manifestSourceOf(manifest),
    snapStartProbe: alwaysReadyProbe(),
    toggler: new RecordingActivator(),
    loadDriver: new RecordingLoadDriver(),
    metrics: emptyMetricsSource(),
    correlator: new TraceCorrelator('bench-test'),
    reportSink: fixedReportSink(),
    cleanup: completeCleanup(),
    // Deterministic timing: no wall-clock waits.
    sleep: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Base control options; per-test overrides merge over these. */
function controlOf(overrides: Partial<RunnerControlOptions> = {}): RunnerControlOptions {
  return {
    manifestParameterName: '/bench/manifest',
    batchSize: 25,
    concurrency: 4,
    ...overrides,
  };
}

// ── ABBA sequencing (Req 18.1–18.3) ──────────────────────────────────────────

describe('BenchmarkRunner — ABBA sequencing for competing sources (Req 18.1, 18.2, 18.3)', () => {
  it('toggles baseline→kata→kata→baseline with constant batch size and concurrency', async () => {
    const manifest = manifestOf([variant('Orders', competingTrigger())]);
    const activator = new RecordingActivator();
    const loadDriver = new RecordingLoadDriver();
    const subsystems = subsystemsOf(manifest, { toggler: activator, loadDriver });

    const result = await new BenchmarkRunner(
      subsystems,
      controlOf({ mode: 'benchmark' }),
    ).run();

    // The activation order is exactly the ABBA sequence (Req 18.1).
    expect(activator.activations).toEqual(['baseline', 'kata', 'kata', 'baseline']);
    expect(activator.activations).toEqual([...ABBA_SEQUENCE]);

    // One load window per ABBA window, targeting the active variant in order
    // (windows are run back-to-back, close in time — Req 18.2).
    expect(loadDriver.requests).toHaveLength(4);
    expect(loadDriver.requests.map((r) => r.variant)).toEqual([
      'baseline',
      'kata',
      'kata',
      'baseline',
    ]);

    // Batch size and concurrency are CONSTANT across all four windows (Req 18.3).
    expect(loadDriver.requests.every((r) => r.batchSize === 25)).toBe(true);
    expect(loadDriver.requests.every((r) => r.concurrency === 4)).toBe(true);

    // Window outcomes mirror the sequence and are marked valid.
    const outcome = result.variants.find((v) => v.constructPath === 'Orders');
    expect(outcome?.valid).toBe(true);
    expect(outcome?.windows.map((w) => w.activeVariant)).toEqual([
      'baseline',
      'kata',
      'kata',
      'baseline',
    ]);
    expect(outcome?.windows.every((w) => w.batchSize === 25 && w.concurrency === 4)).toBe(true);
  });

  it('uses one parallel window per variant (no toggling) for non-competing sources', async () => {
    const fanOutTrigger: ManifestTrigger = {
      type: 'sns',
      routingClass: 'fan-out',
      source: { isolated: true, ref: 'arn:topic' },
    };
    const manifest = manifestOf([variant('Notify', fanOutTrigger)]);
    const activator = new RecordingActivator();
    const loadDriver = new RecordingLoadDriver();
    const subsystems = subsystemsOf(manifest, { toggler: activator, loadDriver });

    await new BenchmarkRunner(subsystems, controlOf({ mode: 'benchmark' })).run();

    // Fan-out never toggles a competing mapping.
    expect(activator.activations).toEqual([]);
    // One window per variant, no ABBA.
    expect(loadDriver.requests.map((r) => r.variant)).toEqual(['baseline', 'kata']);
    expect(loadDriver.requests.every((r) => r.phase === 'parallel')).toBe(true);
  });
});

// ── SnapStart-ready timeout invalidation (Req 18.4, 18.8) ─────────────────────

describe('BenchmarkRunner — SnapStart readiness gating (Req 18.4, 18.8)', () => {
  it('marks a variant invalid with a reason when SnapStart never reports ready within the wait', async () => {
    const manifest = manifestOf([variant('Slow', competingTrigger())]);
    const probe: SnapStartReadinessProbe = {
      checkReadiness: jest.fn().mockResolvedValue({ ready: false, status: 'Active/InProgress' }),
    };
    const loadDriver = new RecordingLoadDriver();
    const subsystems = subsystemsOf(manifest, { snapStartProbe: probe, loadDriver });

    const result = await new BenchmarkRunner(
      subsystems,
      controlOf({ mode: 'benchmark', snapStartMaxPolls: 3 }),
    ).run();

    const outcome = result.variants.find((v) => v.constructPath === 'Slow');
    expect(outcome?.valid).toBe(false);
    expect(outcome?.invalidReason).toContain('did not report ready');
    expect(outcome?.invalidReason).toContain('Req 18.8');
    // An invalid variant is never measured.
    expect(loadDriver.requests).toHaveLength(0);
    // initial probe + snapStartMaxPolls retries.
    expect(probe.checkReadiness).toHaveBeenCalledTimes(4);
  });

  it('short-circuits on a terminal SnapStart failure without exhausting the poll budget', async () => {
    const manifest = manifestOf([variant('Broken', competingTrigger())]);
    const probe: SnapStartReadinessProbe = {
      checkReadiness: jest
        .fn()
        .mockResolvedValue({ ready: false, status: 'Failed/Off', terminalFailure: true }),
    };
    const subsystems = subsystemsOf(manifest, { snapStartProbe: probe });

    const result = await new BenchmarkRunner(
      subsystems,
      controlOf({ mode: 'benchmark', snapStartMaxPolls: 10 }),
    ).run();

    const outcome = result.variants.find((v) => v.constructPath === 'Broken');
    expect(outcome?.valid).toBe(false);
    expect(outcome?.invalidReason).toContain('terminal SnapStart state');
    // Terminal failure stops after the FIRST probe — no retries.
    expect(probe.checkReadiness).toHaveBeenCalledTimes(1);
  });

  it('invalidates only the unready variant and still runs the ready ones (Req 18.8 skip-and-continue)', async () => {
    const ready = variant('Ready', competingTrigger());
    const unready = variant('Unready', competingTrigger({ baselineMappingUuid: 'u-b2', kataMappingUuid: 'u-k2' }));
    const manifest = manifestOf([unready, ready]);
    const loadDriver = new RecordingLoadDriver();
    const probe: SnapStartReadinessProbe = {
      checkReadiness: jest.fn(async (functionName: string) =>
        functionName.startsWith('Unready')
          ? { ready: false, status: 'Active/InProgress', terminalFailure: true }
          : { ready: true, status: 'Active/On' },
      ),
    };
    const subsystems = subsystemsOf(manifest, { snapStartProbe: probe, loadDriver });

    const result = await new BenchmarkRunner(
      subsystems,
      controlOf({ mode: 'benchmark' }),
    ).run();

    expect(result.variants.find((v) => v.constructPath === 'Unready')?.valid).toBe(false);
    expect(result.variants.find((v) => v.constructPath === 'Ready')?.valid).toBe(true);
    // Only the ready variant produced load windows (4 ABBA windows).
    expect(loadDriver.requests.every((r) => r.constructPath === 'Ready')).toBe(true);
    expect(loadDriver.requests).toHaveLength(4);
  });
});

// ── Mode gating (Req 18.5, 18.6, 18.7 / Property 13) ──────────────────────────

describe('BenchmarkRunner — mode gating (Req 18.5, 18.6, 18.7 / Property 13)', () => {
  it('observe-only is the default and switches no trigger', async () => {
    const manifest = manifestOf([variant('Orders', competingTrigger())]);
    const activator = new RecordingActivator();
    const loadDriver = new RecordingLoadDriver();
    const subsystems = subsystemsOf(manifest, { toggler: activator, loadDriver });

    // No mode supplied ⇒ observe-only.
    const result = await new BenchmarkRunner(subsystems, controlOf()).run();

    expect(result.mode).toBe('observe-only');
    expect(activator.activations).toEqual([]);
    expect(loadDriver.requests).toEqual([]);
    // Baseline metrics are still collected (observe-only collects baseline).
    expect(subsystems.metrics.collect).toHaveBeenCalledWith('baseline', expect.anything());
    expect(subsystems.metrics.collect).not.toHaveBeenCalledWith('kata', expect.anything());
  });

  it('production-canary with no opt-in blocks switching with no fallback (Req 18.7)', async () => {
    const manifest = manifestOf([variant('Orders', competingTrigger())]);
    const activator = new RecordingActivator();
    const loadDriver = new RecordingLoadDriver();
    const subsystems = subsystemsOf(manifest, { toggler: activator, loadDriver });

    const result = await new BenchmarkRunner(
      subsystems,
      controlOf({ mode: 'production-canary' }),
    ).run();

    expect(result.productionCanaryBlocked).toBe(true);
    expect(result.productionCanaryBlockReason).toContain('opt-in missing');
    // BLOCKED ⇒ no trigger switched, no load — there is no fallback path.
    expect(activator.activations).toEqual([]);
    expect(loadDriver.requests).toEqual([]);
  });

  it('production-canary with a failed confirmation blocks switching (Req 18.7)', async () => {
    const manifest = manifestOf([variant('Orders', competingTrigger())]);
    const activator = new RecordingActivator();
    const subsystems = subsystemsOf(manifest, { toggler: activator });

    const result = await new BenchmarkRunner(
      subsystems,
      controlOf({
        mode: 'production-canary',
        productionCanaryOptIn: { acknowledged: true, confirm: async () => false },
      }),
    ).run();

    expect(result.productionCanaryBlocked).toBe(true);
    expect(result.productionCanaryBlockReason).toContain('confirmation returned false');
    expect(activator.activations).toEqual([]);
  });

  it('production-canary with a throwing confirmation blocks switching (Req 18.7)', async () => {
    const manifest = manifestOf([variant('Orders', competingTrigger())]);
    const activator = new RecordingActivator();
    const subsystems = subsystemsOf(manifest, { toggler: activator });

    const result = await new BenchmarkRunner(
      subsystems,
      controlOf({
        mode: 'production-canary',
        productionCanaryOptIn: {
          acknowledged: true,
          confirm: async () => {
            throw new Error('approval service unavailable');
          },
        },
      }),
    ).run();

    expect(result.productionCanaryBlocked).toBe(true);
    expect(result.productionCanaryBlockReason).toContain('confirmation failed');
    expect(activator.activations).toEqual([]);
  });

  it('production-canary with a valid acknowledged + confirmed opt-in permits switching (Req 18.6)', async () => {
    const manifest = manifestOf([variant('Orders', competingTrigger())]);
    const activator = new RecordingActivator();
    const loadDriver = new RecordingLoadDriver();
    const subsystems = subsystemsOf(manifest, { toggler: activator, loadDriver });

    const result = await new BenchmarkRunner(
      subsystems,
      controlOf({
        mode: 'production-canary',
        productionCanaryOptIn: { acknowledged: true, confirm: async () => true },
      }),
    ).run();

    expect(result.productionCanaryBlocked).toBe(false);
    // Approved ⇒ the ABBA sequence runs and toggles the trigger.
    expect(activator.activations).toEqual(['baseline', 'kata', 'kata', 'baseline']);
    expect(loadDriver.requests).toHaveLength(4);
  });
});

// ── Max-duration guardrail (Req 20.4 / Property 16) ───────────────────────────

describe('BenchmarkRunner — max-duration guardrail (Req 20.4 / Property 16)', () => {
  it('stops generating load and disables benchmark-owned mappings on breach', async () => {
    const manifest = manifestOf([
      variant('Orders', competingTrigger()),
      variant('Payments', competingTrigger({ baselineMappingUuid: 'u-b2', kataMappingUuid: 'u-k2' })),
    ]);
    const activator = new RecordingActivator();
    const loadDriver = new RecordingLoadDriver();

    // A clock that advances 100ms each read; with a 50ms ceiling the run is
    // already over budget by the first window check, so NO load runs and the
    // guardrail disables every benchmark-owned mapping.
    let now = 1000;
    const clock = jest.fn(() => {
      const value = now;
      now += 100;
      return value;
    });
    const subsystems = subsystemsOf(manifest, { toggler: activator, loadDriver, clock });

    const result = await new BenchmarkRunner(
      subsystems,
      controlOf({ mode: 'benchmark', maxRunDurationMs: 50 }),
    ).run();

    expect(result.stoppedReason).toBe('max-duration-exceeded');
    // No load was generated after the breach.
    expect(loadDriver.requests).toHaveLength(0);
    // Both competing variant pairs' mappings were disabled (Req 20.4).
    expect(activator.disableBothCalls).toHaveLength(2);
    // The stop path skips report rendering and returns no samples.
    expect(result.report).toBeUndefined();
    expect(result.samples).toEqual([]);
    // Cleanup still runs.
    expect(subsystems.cleanup.cleanupRun).toHaveBeenCalledWith('bench-test');
  });

  it('does not stop when the run stays within its duration budget', async () => {
    const manifest = manifestOf([variant('Orders', competingTrigger())]);
    const loadDriver = new RecordingLoadDriver();
    // A fixed clock never advances ⇒ elapsed is always 0 < ceiling.
    const subsystems = subsystemsOf(manifest, { loadDriver, clock: () => 1000 });

    const result = await new BenchmarkRunner(
      subsystems,
      controlOf({ mode: 'benchmark', maxRunDurationMs: 10_000 }),
    ).run();

    expect(result.stoppedReason).toBeUndefined();
    expect(loadDriver.requests).toHaveLength(4);
    expect(result.report).toBeDefined();
  });
});

// ── Collect → Report → Cleanup happy path ─────────────────────────────────────

describe('BenchmarkRunner — collect → report → cleanup flow', () => {
  it('collects samples, renders the report, and cleans up by Bench_Run_Id', async () => {
    const manifest = manifestOf([variant('Orders', competingTrigger())]);
    const baselineSample: ReportSample = {
      requestId: 'r-1',
      variant: 'baseline',
      cold: true,
      initDurationMs: 120,
      durationMs: 30,
      billedMs: 150,
      maxMemoryMb: 128,
      memorySizeMb: 256,
      coldInvokeServerTimeMs: 150,
    };
    const metrics: VariantMetricsSource = {
      collect: jest.fn(async (variantId: 'baseline' | 'kata') => ({
        variant: variantId,
        samples: [{ ...baselineSample, variant: variantId }],
        errors: 0,
        throttles: 0,
      })),
    };
    const reportSink = fixedReportSink();
    const cleanup = completeCleanup();
    const subsystems = subsystemsOf(manifest, { metrics, reportSink, cleanup });

    const result = await new BenchmarkRunner(
      subsystems,
      controlOf({ mode: 'benchmark' }),
    ).run();

    // Both variants collected (benchmark mode measures kata too).
    expect(metrics.collect).toHaveBeenCalledWith('baseline', expect.anything());
    expect(metrics.collect).toHaveBeenCalledWith('kata', expect.anything());
    // Samples are correlated under the run id.
    expect(result.samples.every((s) => s.benchRunId === 'bench-test')).toBe(true);
    expect(result.samples).toHaveLength(2);
    // Report rendered from the collected samples.
    expect(reportSink.render).toHaveBeenCalledTimes(1);
    expect(result.report).toEqual({ json: '{}', html: '<html></html>' });
    // Cleanup scoped to the Bench_Run_Id.
    expect(cleanup.cleanupRun).toHaveBeenCalledWith('bench-test');
    expect(result.cleanup).toEqual({ complete: true, remaining: [] });
  });
});

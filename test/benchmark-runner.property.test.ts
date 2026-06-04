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
 * Property-based tests for the run-time {@link BenchmarkRunner} state machine
 * (Layer D, task 21).
 *
 * These exercise the two named correctness properties the runner is responsible
 * for, across generated input spaces (no AWS, no CDK, injected mocks only):
 *
 *  - **Property 13 (production switching gated, Req 18.6/18.7):** across ANY
 *    production-canary opt-in shape, a production trigger is switched IFF the
 *    opt-in is acknowledged AND its confirmation (when present) resolves true;
 *    every other shape blocks switching with NO fallback (zero activations).
 *  - **Property 16 (bounded runs, Req 20.4):** across ANY competing manifest, a
 *    run whose duration budget is already exhausted at the first window check
 *    stops, generates zero further load, and disables EVERY benchmark-owned
 *    competing mapping (one `disableBoth` per competing variant pair).
 *
 * **Validates: Requirements 18.6, 18.7, 20.4**
 *
 * @module benchmark-runner.property.test
 */

import * as fc from 'fast-check';

import {
  BenchmarkRunner,
  ABBA_SEQUENCE,
  type RunnerControlOptions,
  type RunnerSubsystems,
  type ManifestSource,
  type SnapStartReadinessProbe,
  type VariantActivator,
  type LoadDriver,
  type WindowLoadRequest,
  type VariantMetricsSource,
  type ReportSink,
  type CleanupRunner,
  type ProductionCanaryOptIn,
} from '../src/benchmark/runner/runner';
import { TraceCorrelator } from '../src/benchmark/runner/trace-correlator';
import { FidelityLevel } from '../src/benchmark/options';
import type { BenchmarkManifest, ManifestVariant, ManifestTrigger } from '../src/benchmark/manifest';
import type {
  CompetingMappingPair,
  ToggleVariant,
  ActivateVariantResult,
} from '../src/benchmark/runner/trigger-toggler';
import type { VariantMetrics } from '../src/benchmark/runner/metrics-collector';

/** Build a competing variant pair with unique mapping UUIDs derived from index. */
function competingVariant(index: number): ManifestVariant {
  const trigger: ManifestTrigger = {
    type: 'sqs',
    routingClass: 'competing',
    baselineMappingUuid: `uuid-b-${index}`,
    kataMappingUuid: `uuid-k-${index}`,
    source: { isolated: true, ref: `bench-queue-${index}` },
  };
  return {
    constructPath: `Fn${index}`,
    baseline: {
      functionName: `Fn${index}-baseline`,
      functionArn: `arn:aws:lambda:::function:Fn${index}-baseline`,
      logGroup: `/aws/lambda/Fn${index}-baseline`,
    },
    kata: {
      functionName: `Fn${index}-kata`,
      functionArn: `arn:aws:lambda:::function:Fn${index}-kata`,
      aliasArn: `arn:aws:lambda:::function:Fn${index}-kata:kata`,
      version: '1',
      logGroup: `/aws/lambda/Fn${index}-kata`,
    },
    trigger,
  };
}

/** Build a manifest from N competing variants. */
function competingManifest(count: number): BenchmarkManifest {
  const variants: ManifestVariant[] = [];
  for (let i = 0; i < count; i += 1) {
    variants.push(competingVariant(i));
  }
  return {
    schemaVersion: 1,
    benchRunSeed: 'seed',
    region: 'us-east-1',
    fidelity: FidelityLevel.L0,
    sideEffectPolicy: 'unsafe',
    ownershipTag: { key: 'kata:benchRunId', value: 'bench-prop' },
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

/** Recording activator counting activations and disableBoth calls. */
class CountingActivator implements VariantActivator {
  public activations = 0;
  public disableBothCount = 0;

  public async activateVariant(
    pair: CompetingMappingPair,
    variant: ToggleVariant,
  ): Promise<ActivateVariantResult> {
    this.activations += 1;
    const activeUuid = variant === 'baseline' ? pair.baselineMappingUuid : pair.kataMappingUuid;
    const inactiveUuid = variant === 'baseline' ? pair.kataMappingUuid : pair.baselineMappingUuid;
    return { active: variant, activeUuid, inactiveUuid, activeState: 'Enabled', inactiveState: 'Disabled' };
  }

  public async disableBoth(): Promise<void> {
    this.disableBothCount += 1;
  }
}

/** Recording load driver counting window requests. */
class CountingLoadDriver implements LoadDriver {
  public requests: WindowLoadRequest[] = [];
  public async runWindowLoad(request: WindowLoadRequest): Promise<void> {
    this.requests.push(request);
  }
}

/** Minimal always-ready/empty subsystems with the supplied activator + driver. */
function subsystemsFor(
  manifest: BenchmarkManifest,
  activator: VariantActivator,
  loadDriver: LoadDriver,
  clock?: () => number,
): RunnerSubsystems {
  const manifestSource: ManifestSource = { loadManifest: async () => manifest };
  const snapStartProbe: SnapStartReadinessProbe = {
    checkReadiness: async () => ({ ready: true, status: 'Active/On' }),
  };
  const metrics: VariantMetricsSource = {
    collect: async (variant): Promise<VariantMetrics> => ({
      variant,
      samples: [],
      errors: 0,
      throttles: 0,
    }),
  };
  const reportSink: ReportSink = { render: () => ({ json: '{}', html: '' }) };
  const cleanup: CleanupRunner = { cleanupRun: async () => ({ complete: true, remaining: [] }) };
  return {
    manifestSource,
    snapStartProbe,
    toggler: activator,
    loadDriver,
    metrics,
    correlator: new TraceCorrelator('bench-prop'),
    reportSink,
    cleanup,
    sleep: async () => undefined,
    ...(clock !== undefined ? { clock } : {}),
  };
}

function controlFor(overrides: Partial<RunnerControlOptions>): RunnerControlOptions {
  return { manifestParameterName: '/bench/manifest', ...overrides };
}

describe('BenchmarkRunner property — Property 13: production switching gated (Req 18.6, 18.7)', () => {
  it('switches a production trigger IFF the opt-in is acknowledged and confirmed, else blocks with no fallback', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(), // acknowledged
        fc.option(fc.boolean(), { nil: undefined }), // confirm result (undefined ⇒ no confirm hook)
        fc.boolean(), // whether the opt-in object is supplied at all
        async (acknowledged, confirmResult, supplyOptIn) => {
          const manifest = competingManifest(1);
          const activator = new CountingActivator();
          const loadDriver = new CountingLoadDriver();
          const subsystems = subsystemsFor(manifest, activator, loadDriver);

          let optIn: ProductionCanaryOptIn | undefined;
          if (supplyOptIn) {
            optIn = {
              acknowledged,
              ...(confirmResult !== undefined
                ? { confirm: async () => confirmResult }
                : {}),
            };
          }

          const result = await new BenchmarkRunner(
            subsystems,
            controlFor({
              mode: 'production-canary',
              ...(optIn !== undefined ? { productionCanaryOptIn: optIn } : {}),
            }),
          ).run();

          // The opt-in is VALID iff supplied, acknowledged, and (no confirm hook
          // OR confirm resolved true).
          const valid =
            supplyOptIn && acknowledged && (confirmResult === undefined || confirmResult === true);

          if (valid) {
            expect(result.productionCanaryBlocked).toBe(false);
            // Approved ⇒ the ABBA sequence ran (one activation per ABBA window).
            expect(activator.activations).toBe(ABBA_SEQUENCE.length);
          } else {
            // Blocked ⇒ NO switching, NO load — there is no fallback path.
            expect(result.productionCanaryBlocked).toBe(true);
            expect(result.productionCanaryBlockReason).toBeDefined();
            expect(activator.activations).toBe(0);
            expect(loadDriver.requests).toHaveLength(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('BenchmarkRunner property — Property 16: bounded runs (Req 20.4)', () => {
  it('an exhausted duration budget stops load and disables every benchmark-owned mapping', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }), // number of competing variants
        fc.integer({ min: 0, max: 1000 }), // max run duration (already exhausted)
        async (variantCount, maxRunDurationMs) => {
          const manifest = competingManifest(variantCount);
          const activator = new CountingActivator();
          const loadDriver = new CountingLoadDriver();
          // A clock guaranteeing the elapsed time is already past the budget at
          // the first check: start at 0, then jump beyond the ceiling.
          let firstRead = true;
          const clock = (): number => {
            if (firstRead) {
              firstRead = false;
              return 0;
            }
            return maxRunDurationMs + 1;
          };
          const subsystems = subsystemsFor(manifest, activator, loadDriver, clock);

          const result = await new BenchmarkRunner(
            subsystems,
            controlFor({ mode: 'benchmark', maxRunDurationMs }),
          ).run();

          // The run is STOPPED: no load generated, report skipped.
          expect(result.stoppedReason).toBe('max-duration-exceeded');
          expect(loadDriver.requests).toHaveLength(0);
          expect(result.report).toBeUndefined();
          // EVERY benchmark-owned competing mapping is disabled — one disableBoth
          // per competing variant pair (Req 20.4).
          expect(activator.disableBothCount).toBe(variantCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a generous duration budget never stops the run and lets all ABBA windows complete', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (variantCount) => {
        const manifest = competingManifest(variantCount);
        const activator = new CountingActivator();
        const loadDriver = new CountingLoadDriver();
        // A fixed clock never advances ⇒ elapsed is always 0 < ceiling.
        const subsystems = subsystemsFor(manifest, activator, loadDriver, () => 0);

        const result = await new BenchmarkRunner(
          subsystems,
          controlFor({ mode: 'benchmark', maxRunDurationMs: 10_000 }),
        ).run();

        expect(result.stoppedReason).toBeUndefined();
        // Every variant ran a full ABBA sequence.
        expect(loadDriver.requests).toHaveLength(variantCount * ABBA_SEQUENCE.length);
        expect(activator.disableBothCount).toBe(0);
      }),
      { numRuns: 50 },
    );
  });
});

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
 * Layer A — Fidelity_Level handler selection and the L4 production-shadow gate
 * (Req 12).
 *
 * The five labelled {@link FidelityLevel} tiers trade safety/cost for realism by
 * choosing WHAT each Kata_Variant runs against at run time:
 *
 * | Level | Handler strategy        | Dependency strategy          | Req        |
 * | ----- | ----------------------- | ---------------------------- | ---------- |
 * | L0    | synthetic handler       | none (pure runtime overhead) | 12.2, 12.7 |
 * | L1    | real code bundle        | no network dependency calls  | 12.3       |
 * | L2    | real code bundle        | isolated dependency copies   | 12.4       |
 * | L3    | real code bundle        | declared dev/staging deps    | 12.5       |
 * | L4    | real code bundle        | production shadow/controlled | 12.6       |
 *
 * This module is the **pure, synth-time** resolution of that selection. It does
 * NOT execute load or alter the `kata()` transformation (the clone is always
 * built through the unchanged public `kata()` path — the handler/dependency
 * STRATEGY a level implies is a run-time concern the {@link FidelityPlan}
 * records for the runner). What the synth-time harness MUST enforce here is the
 * L4 safety gate (Req 12.6):
 *
 * - **L4 requires an explicit production-shadow opt-in** — without it the run is
 *   rejected so a benchmark never silently shadows production.
 * - **L4 exposes a kill switch** — when engaged, benchmark routing is disabled
 *   (no benchmark trigger mappings are provisioned) while the variants and
 *   manifest are still synthesized, so a run can be neutralised without a
 *   redeploy.
 *
 * The selected level is recorded into the Run_Design by the orchestrator
 * (Req 12.8); this module surfaces it on the plan.
 *
 * @remarks
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8
 *
 * @module benchmark/fidelity
 */

import { FidelityLevel } from './options';
import type { ResolvedProductionShadowOptions } from './options';

/**
 * Error raised when a {@link FidelityLevel.L4} run is requested without the
 * required explicit production-shadow opt-in (Req 12.6).
 */
export class FidelityGateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FidelityGateError';
  }
}

/**
 * The handler strategy a {@link FidelityLevel} selects for each Kata_Variant
 * (Req 12.2–12.5).
 *
 * - `synthetic` — a synthetic handler exercising pure runtime overhead with no
 *   business dependencies (L0, the most conservative default, Req 12.2, 12.7).
 * - `real-code` — the Kata_Variant's real code bundle (L1–L4, Req 12.3–12.6).
 */
export type FidelityHandlerStrategy = 'synthetic' | 'real-code';

/**
 * The dependency strategy a {@link FidelityLevel} selects (Req 12.2–12.6).
 */
export type FidelityDependencyStrategy =
  | 'none'
  | 'no-network'
  | 'isolated'
  | 'dev-staging'
  | 'production-shadow';

/**
 * The resolved, synth-time fidelity plan for a run.
 *
 * It captures the selected level (recorded into the Run_Design, Req 12.8), the
 * handler/dependency strategy the runner must apply (Req 12.2–12.6), and the
 * single synth-time decision the orchestrator acts on: whether benchmark
 * routing is enabled (disabled by the L4 kill switch, Req 12.6).
 */
export interface FidelityPlan {
  /** The selected measurement-realism tier (Req 12.1, 12.8). */
  readonly level: FidelityLevel;
  /** The handler strategy the runner applies per variant (Req 12.2, 12.3). */
  readonly handlerStrategy: FidelityHandlerStrategy;
  /** The dependency strategy the runner applies per variant (Req 12.2–12.6). */
  readonly dependencyStrategy: FidelityDependencyStrategy;
  /**
   * Whether benchmark trigger routing is provisioned. `false` only when the L4
   * kill switch is engaged (Req 12.6); the variants and manifest are still
   * synthesized so the run can be neutralised without a redeploy.
   */
  readonly benchmarkRoutingEnabled: boolean;
  /** Whether this is an L4 production-shadow run (gated by opt-in, Req 12.6). */
  readonly productionShadow: boolean;
}

/** The handler/dependency strategy each level selects (Req 12.2–12.6). */
const FIDELITY_STRATEGY: {
  readonly [K in FidelityLevel]: {
    readonly handlerStrategy: FidelityHandlerStrategy;
    readonly dependencyStrategy: FidelityDependencyStrategy;
  };
} = {
  [FidelityLevel.L0]: { handlerStrategy: 'synthetic', dependencyStrategy: 'none' },
  [FidelityLevel.L1]: { handlerStrategy: 'real-code', dependencyStrategy: 'no-network' },
  [FidelityLevel.L2]: { handlerStrategy: 'real-code', dependencyStrategy: 'isolated' },
  [FidelityLevel.L3]: { handlerStrategy: 'real-code', dependencyStrategy: 'dev-staging' },
  [FidelityLevel.L4]: { handlerStrategy: 'real-code', dependencyStrategy: 'production-shadow' },
} as const;

/**
 * Resolve the synth-time {@link FidelityPlan} for a run, enforcing the L4
 * production-shadow gate (Req 12.6).
 *
 * @param level - The selected (already-defaulted) fidelity level (Req 12.1, 12.7).
 * @param productionShadow - The resolved production-shadow opt-in / kill-switch
 *   controls.
 * @returns The fidelity plan describing the handler/dependency strategy and
 *   whether benchmark routing is enabled.
 *
 * @throws {FidelityGateError} If `level` is {@link FidelityLevel.L4} and
 *   `productionShadow.optIn` is `false` (Req 12.6).
 */
export function resolveFidelityPlan(
  level: FidelityLevel,
  productionShadow: ResolvedProductionShadowOptions,
): FidelityPlan {
  const isL4 = level === FidelityLevel.L4;

  if (isL4 && !productionShadow.optIn) {
    throw new FidelityGateError(
      'Fidelity level L4 (production-shadow) requires an explicit opt-in: pass ' +
      'productionShadow: { optIn: true } to acknowledge that the benchmark may shadow ' +
      'production dependencies (Req 12.6).',
    );
  }

  const strategy = FIDELITY_STRATEGY[level];

  // The L4 kill switch disables benchmark routing without removing the
  // variants/manifest (Req 12.6). It is only meaningful for an opted-in L4 run.
  const benchmarkRoutingEnabled = !(isL4 && productionShadow.killSwitch);

  return {
    level,
    handlerStrategy: strategy.handlerStrategy,
    dependencyStrategy: strategy.dependencyStrategy,
    benchmarkRoutingEnabled,
    productionShadow: isL4,
  };
}

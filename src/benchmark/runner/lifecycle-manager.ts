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
 * Layer D — LifecycleManager (run-time, CDK-free).
 *
 * Owns ownership tagging, run guardrails (max duration/concurrency/cost), and
 * deterministic tag-scoped, all-or-nothing cleanup of benchmark-created
 * resources. Implemented in task 23; this scaffold provides the result type and
 * a guarded stub.
 *
 * @remarks
 * Validates: Requirements 20.1, 20.2, 20.7, 20.8
 *
 * @module benchmark/runner/lifecycle-manager
 */

/** The outcome of a tag-scoped cleanup pass (Req 20.7, 20.8). */
export interface CleanupResult {
  /** `true` when every tagged resource for the run was removed. */
  readonly complete: boolean;
  /** Resources that could not be removed (reported on failure). */
  readonly remaining: ReadonlyArray<string>;
}

/**
 * Remove all resources tagged with the targeted Bench_Run_Id, atomically
 * (Req 20.7, 20.8).
 *
 * @param benchRunId - The run whose tagged resources should be cleaned up.
 * @returns The cleanup result.
 *
 * @throws Always, until implemented by task 23 (LifecycleManager).
 */
export async function cleanupRun(benchRunId: string): Promise<CleanupResult> {
  void benchRunId;
  throw new Error('cleanupRun is not implemented yet (LifecycleManager — task 23).');
}

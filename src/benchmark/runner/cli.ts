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
 * Layer D — `lambda-kata-bench` CLI entry (run-time, CDK-free).
 *
 * Wires the run / report / cleanup commands over the runner subsystems, reading
 * the manifest by SSM pointer and exposing observe-only as the default mode.
 * Implemented in task 24; this scaffold provides a guarded entry stub.
 *
 * @remarks
 * Validates: Requirements 18.5, 18.6
 *
 * @module benchmark/runner/cli
 */

/**
 * CLI entry point dispatching the `lambda-kata-bench` subcommands.
 *
 * @param argv - Process arguments (excluding the node binary + script path).
 * @returns A promise resolving when the command completes.
 *
 * @throws Always, until implemented by task 24 (CLI).
 */
export async function main(argv: ReadonlyArray<string>): Promise<void> {
  void argv;
  throw new Error('lambda-kata-bench CLI is not implemented yet (task 24).');
}

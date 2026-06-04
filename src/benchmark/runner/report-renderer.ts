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
 * Layer D — ReportRenderer (run-time, CDK-free).
 *
 * Produces the layered benchmark report (three non-merged metric layers plus
 * the Run_Design) as HTML and JSON, never collapsing results into a single
 * "winner" number. Implemented in task 22; this scaffold provides the report
 * shape and a guarded stub.
 *
 * @remarks
 * Validates: Requirements 17.1, 17.2, 17.5
 *
 * @module benchmark/runner/report-renderer
 */

import type { ReportSample } from './metrics-collector';

/** The rendered report artifacts. */
export interface RenderedReport {
  readonly json: string;
  readonly html: string;
}

/**
 * Render the layered benchmark report from collected samples (Req 17.1, 17.2).
 *
 * @param samples - The collected {@link ReportSample}s for both variants.
 * @returns The rendered JSON + HTML artifacts.
 *
 * @throws Always, until implemented by task 22 (ReportRenderer).
 */
export function renderReport(samples: ReadonlyArray<ReportSample>): RenderedReport {
  void samples;
  throw new Error('renderReport is not implemented yet (ReportRenderer — task 22).');
}

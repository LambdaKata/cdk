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
 * Layer D — Deterministic partition/record key helper for stream producers
 * (run-time, CDK-free).
 *
 * @module benchmark/runner/load/partition-key
 */

import type { CorrelationVariant } from '../trace-correlator';

/**
 * Build a deterministic, variant-scoped key for a stream record (Kinesis
 * partition key / Kafka record key).
 *
 * The key is stable for a `(benchRunId, variant)` pair so a variant's records
 * map consistently and remain attributable by the run/variant coordinate even
 * though stream records are window-correlated and carry no embedded marker.
 *
 * @param benchRunId - The run id the records belong to.
 * @param variant - The variant the record targets.
 * @returns A non-empty, stable string key.
 */
export function partitionKeyFor(
  benchRunId: string,
  variant: CorrelationVariant,
): string {
  return `${benchRunId}:${variant}`;
}

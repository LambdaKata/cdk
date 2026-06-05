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
 * Layer D — Load-generation error type (run-time, CDK-free).
 *
 * @module benchmark/runner/load/errors
 */

import type { BenchTriggerType } from '../trace-correlator';

/**
 * Error raised when a load generator cannot perform a tick because its routing
 * inputs are invalid (Req 9.4–9.6).
 *
 * Thrown when a request-response/competing generator is asked to deliver to a
 * variant under test that is unspecified, or whose variant has no matching
 * {@link VariantEndpoint}. Distinct, named, and carrying the offending trigger
 * type so the runner can surface a precise diagnosis rather than a generic
 * `TypeError`.
 */
export class LoadGenerationError extends Error {
  /** The trigger type whose generation failed. */
  public readonly triggerType: BenchTriggerType;

  /**
   * @param message - The human-readable failure description.
   * @param triggerType - The trigger type the failure concerns.
   */
  public constructor(message: string, triggerType: BenchTriggerType) {
    super(message);
    this.name = 'LoadGenerationError';
    this.triggerType = triggerType;
  }
}

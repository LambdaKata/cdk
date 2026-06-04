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
 * Layer C — direct `Invoke` trigger adapter (Req 8.7, 9.1, 9.3, 9.4).
 *
 * Direct invoke is a Request_Response_Source: there is no poll-based event
 * source to provision and no `Enabled` flag to toggle. Load is request-driven at
 * run time — the run-time generator delivers discrete `Invoke` (RequestResponse)
 * calls to the variant under test. The adapter therefore creates no benchmark
 * source resource and reports `isolated: false` with no mappings, while still
 * participating uniformly in the {@link TriggerAdapter} contract (classifying
 * its routing class and validating the kata function is present).
 *
 * @remarks
 * Validates: Requirements 8.7, 9.1, 9.3, 9.4
 *
 * @module benchmark/triggers/invoke
 */

import { AbstractTriggerAdapter } from './adapter-base';
import type { AdapterProvisionResult, AdapterSynthContext, InvokeTrigger } from './types';

/**
 * Direct synchronous `Invoke` adapter (request-response, Req 8.7, 9.4).
 */
export class InvokeTriggerAdapter extends AbstractTriggerAdapter<InvokeTrigger> {
  /** The trigger discriminant this adapter handles. */
  public readonly type = 'invoke' as const;

  /**
   * Validate the kata function is present and report the request-response
   * contract; no benchmark source or event source mapping is created.
   *
   * @param context - The synth-time context.
   * @param _declaration - The invoke declaration (no source config).
   * @returns The request-response provision result (no source, no mappings).
   */
  public provision(
    context: AdapterSynthContext,
    _declaration: InvokeTrigger,
  ): AdapterProvisionResult {
    // Validate the variant is present so the orchestrator fails fast on a
    // misconfigured request-response trigger, even though no source is created.
    this.requireKataFunction(context);
    return { routingClass: 'request-response', isolated: false };
  }
}

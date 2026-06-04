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
 * Layer C — API Gateway trigger adapter (Req 8.7, 9.1, 9.3, 9.4).
 *
 * API Gateway is a Request_Response_Source: no poll-based event source is
 * provisioned and no `Enabled` flag is toggled. The run-time generator issues
 * HTTPS requests (random 1..N concurrent per tick) to the benchmark route/stage
 * targeting the variant under test. The adapter creates no benchmark source
 * resource and reports `isolated: false` with no mappings, while still
 * participating uniformly in the {@link TriggerAdapter} contract.
 *
 * @remarks
 * Validates: Requirements 8.7, 9.1, 9.3, 9.4
 *
 * @module benchmark/triggers/apigw
 */

import { AbstractTriggerAdapter } from './adapter-base';
import type { AdapterProvisionResult, AdapterSynthContext, ApiGatewayTrigger } from './types';

/**
 * API Gateway adapter (request-response, Req 8.7, 9.4).
 */
export class ApiGatewayTriggerAdapter extends AbstractTriggerAdapter<ApiGatewayTrigger> {
  /** The trigger discriminant this adapter handles. */
  public readonly type = 'apiGateway' as const;

  /**
   * Validate the kata function is present and report the request-response
   * contract; no benchmark source or event source mapping is created.
   *
   * @param context - The synth-time context.
   * @param _declaration - The API Gateway declaration.
   * @returns The request-response provision result (no source, no mappings).
   */
  public provision(
    context: AdapterSynthContext,
    _declaration: ApiGatewayTrigger,
  ): AdapterProvisionResult {
    this.requireKataFunction(context);
    return { routingClass: 'request-response', isolated: false };
  }
}

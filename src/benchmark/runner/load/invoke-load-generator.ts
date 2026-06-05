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
 * Layer D — {@link InvokeLoadGenerator}: direct Lambda invoke load
 * (request-response, run-time, CDK-free).
 *
 * @module benchmark/runner/load/invoke-load-generator
 */

import type { TaggedEvent, TraceCorrelator } from '../trace-correlator';
import { BaseLoadGenerator } from './base-load-generator';
import type {
  Delivery,
  LambdaInvokerClient,
  LoadGenerationRequest,
  LoadRoutingClass,
  VariantEndpoint,
} from './types';

/**
 * Drives load by invoking the variant UNDER TEST directly via the Lambda
 * `Invoke` operation with `InvocationType=RequestResponse` (Req 9.4).
 *
 * Request-response sources are not "fanned out": exactly one synchronous
 * invocation of the active variant is issued per tick, carrying an embedded
 * correlation marker in the JSON payload (invoke permits a marker).
 */
export class InvokeLoadGenerator extends BaseLoadGenerator {
  /** @inheritDoc */
  public readonly type = 'invoke' as const;

  /** @inheritDoc */
  public readonly routingClass: LoadRoutingClass = 'request-response';

  private readonly client: LambdaInvokerClient;

  /**
   * @param correlator - The run-scoped correlator that mints/embeds markers.
   * @param client - The injected direct-invoke port.
   */
  public constructor(correlator: TraceCorrelator, client: LambdaInvokerClient) {
    super(correlator);
    this.client = client;
  }

  /** @inheritDoc */
  protected async dispatch(
    endpoint: VariantEndpoint,
    tagged: TaggedEvent<Record<string, unknown>>,
    _request: LoadGenerationRequest,
  ): Promise<Delivery[]> {
    await this.client.invoke({
      functionName: endpoint.address,
      invocationType: 'RequestResponse',
      payload: this.serialize(tagged),
    });
    return [this.toDelivery(endpoint, tagged)];
  }
}

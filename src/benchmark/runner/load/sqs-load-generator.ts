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
 * Layer D — {@link SqsLoadGenerator}: SQS publisher load (competing, run-time,
 * CDK-free).
 *
 * @module benchmark/runner/load/sqs-load-generator
 */

import type { TaggedEvent, TraceCorrelator } from '../trace-correlator';
import { BaseLoadGenerator } from './base-load-generator';
import type {
  Delivery,
  LoadGenerationRequest,
  LoadRoutingClass,
  SqsPublisherClient,
  VariantEndpoint,
} from './types';

/**
 * Drives load by publishing ONE SQS message per tick to the SINGLE active
 * variant (Req 9.5).
 *
 * SQS is a competing source: both variants consume from one shared queue, so a
 * message must be delivered to exactly one variant (the one under test) — never
 * fanned out. The message body carries an embedded correlation marker (SQS
 * permits a marker).
 */
export class SqsLoadGenerator extends BaseLoadGenerator {
  /** @inheritDoc */
  public readonly type = 'sqs' as const;

  /** @inheritDoc */
  public readonly routingClass: LoadRoutingClass = 'competing';

  private readonly client: SqsPublisherClient;

  /**
   * @param correlator - The run-scoped correlator that mints/embeds markers.
   * @param client - The injected SQS publisher port.
   */
  public constructor(correlator: TraceCorrelator, client: SqsPublisherClient) {
    super(correlator);
    this.client = client;
  }

  /** @inheritDoc */
  protected async dispatch(
    endpoint: VariantEndpoint,
    tagged: TaggedEvent<Record<string, unknown>>,
    _request: LoadGenerationRequest,
  ): Promise<Delivery[]> {
    await this.client.sendMessage({
      queueUrl: endpoint.address,
      messageBody: this.serialize(tagged),
    });
    return [this.toDelivery(endpoint, tagged)];
  }
}

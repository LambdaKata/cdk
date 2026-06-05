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
 * Layer D — {@link SnsLoadGenerator}: SNS publisher load (fan-out, run-time,
 * CDK-free).
 *
 * @module benchmark/runner/load/sns-load-generator
 */

import type { TaggedEvent, TraceCorrelator } from '../trace-correlator';
import { BaseLoadGenerator } from './base-load-generator';
import type {
  Delivery,
  LoadGenerationRequest,
  LoadRoutingClass,
  SnsPublisherClient,
  VariantEndpoint,
} from './types';

/**
 * Drives load by publishing to EVERY subscribed variant's topic per tick
 * (Req 9.6).
 *
 * SNS is a fan-out source: each variant has its own topic, and a benchmark event
 * is delivered to every subscribed variant, each tagged with ITS OWN variant
 * marker (the base re-tags per endpoint). Every message carries an embedded
 * correlation marker (SNS permits a marker).
 */
export class SnsLoadGenerator extends BaseLoadGenerator {
  /** @inheritDoc */
  public readonly type = 'sns' as const;

  /** @inheritDoc */
  public readonly routingClass: LoadRoutingClass = 'fan-out';

  private readonly client: SnsPublisherClient;

  /**
   * @param correlator - The run-scoped correlator that mints/embeds markers.
   * @param client - The injected SNS publisher port.
   */
  public constructor(correlator: TraceCorrelator, client: SnsPublisherClient) {
    super(correlator);
    this.client = client;
  }

  /** @inheritDoc */
  protected async dispatch(
    endpoint: VariantEndpoint,
    tagged: TaggedEvent<Record<string, unknown>>,
    _request: LoadGenerationRequest,
  ): Promise<Delivery[]> {
    await this.client.publish({
      topicArn: endpoint.address,
      message: this.serialize(tagged),
    });
    return [this.toDelivery(endpoint, tagged)];
  }
}

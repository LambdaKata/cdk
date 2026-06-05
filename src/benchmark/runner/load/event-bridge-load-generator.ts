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
 * Layer D — {@link EventBridgeLoadGenerator}: EventBridge publisher load
 * (fan-out, run-time, CDK-free).
 *
 * @module benchmark/runner/load/event-bridge-load-generator
 */

import type { TaggedEvent, TraceCorrelator } from '../trace-correlator';
import { BaseLoadGenerator } from './base-load-generator';
import type {
  Delivery,
  EventBridgeLoadGeneratorConfig,
  EventBridgePublisherClient,
  LoadGenerationRequest,
  LoadRoutingClass,
  VariantEndpoint,
} from './types';

/**
 * Drives load by putting an event onto EVERY subscribed variant's bus per tick
 * (Req 9.6).
 *
 * EventBridge is a fan-out source: each variant has its own bus, and a benchmark
 * event is delivered to every subscribed variant, each tagged with its own
 * variant marker. The configured {@link EventBridgeLoadGeneratorConfig.source}
 * and {@link EventBridgeLoadGeneratorConfig.detailType} are stamped onto every
 * event, and the marker is embedded in the event `detail` (EventBridge permits a
 * marker).
 */
export class EventBridgeLoadGenerator extends BaseLoadGenerator {
  /** @inheritDoc */
  public readonly type = 'eventBridge' as const;

  /** @inheritDoc */
  public readonly routingClass: LoadRoutingClass = 'fan-out';

  private readonly client: EventBridgePublisherClient;
  private readonly source: string;
  private readonly detailType: string;

  /**
   * @param correlator - The run-scoped correlator that mints/embeds markers.
   * @param client - The injected EventBridge publisher port.
   * @param config - The `source` and `detail-type` stamped onto every event.
   */
  public constructor(
    correlator: TraceCorrelator,
    client: EventBridgePublisherClient,
    config: EventBridgeLoadGeneratorConfig,
  ) {
    super(correlator);
    this.client = client;
    this.source = config.source;
    this.detailType = config.detailType;
  }

  /** @inheritDoc */
  protected async dispatch(
    endpoint: VariantEndpoint,
    tagged: TaggedEvent<Record<string, unknown>>,
    _request: LoadGenerationRequest,
  ): Promise<Delivery[]> {
    await this.client.putEvents({
      busName: endpoint.address,
      source: this.source,
      detailType: this.detailType,
      detail: this.serialize(tagged),
    });
    return [this.toDelivery(endpoint, tagged)];
  }
}

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
 * Layer D — {@link KafkaLoadGenerator}: Kafka producer load (competing
 * same-group vs fan-out distinct-group, window-correlated, run-time, CDK-free).
 *
 * @module benchmark/runner/load/kafka-load-generator
 */

import type { TaggedEvent, TraceCorrelator } from '../trace-correlator';
import { BaseLoadGenerator } from './base-load-generator';
import { partitionKeyFor } from './partition-key';
import type {
  Delivery,
  KafkaLoadGeneratorConfig,
  KafkaProducerClient,
  LoadGenerationRequest,
  LoadRoutingClass,
  VariantEndpoint,
} from './types';

/**
 * Drives load by producing records to a Kafka topic (Req 9.5, 9.6).
 *
 * Kafka routing depends on the consumer-group topology, supplied at
 * construction:
 *
 * - `competing` (same consumer group) — both variants compete for one topic, so
 *   a record is produced to the SINGLE active variant;
 * - `fan-out` (distinct consumer groups) — each variant has its own topic/group,
 *   so a record is produced to EVERY subscribed variant.
 *
 * Kafka is a window-correlated trigger: its records carry no per-invocation
 * marker, so the produced `value` is the ORIGINAL payload (no embedded marker)
 * and every {@link Delivery} is `window-correlated`.
 */
export class KafkaLoadGenerator extends BaseLoadGenerator {
  /** @inheritDoc */
  public readonly type = 'kafka' as const;

  /** @inheritDoc */
  public readonly routingClass: LoadRoutingClass;

  private readonly client: KafkaProducerClient;

  /**
   * @param correlator - The run-scoped correlator (records are window-correlated).
   * @param client - The injected Kafka producer port.
   * @param config - The routing class: `competing` (same-group) or `fan-out`
   *   (distinct-group).
   */
  public constructor(
    correlator: TraceCorrelator,
    client: KafkaProducerClient,
    config: KafkaLoadGeneratorConfig,
  ) {
    super(correlator);
    this.client = client;
    this.routingClass = config.routingClass;
  }

  /** @inheritDoc */
  protected async dispatch(
    endpoint: VariantEndpoint,
    tagged: TaggedEvent<Record<string, unknown>>,
    _request: LoadGenerationRequest,
  ): Promise<Delivery[]> {
    await this.client.produce({
      topic: endpoint.address,
      key: partitionKeyFor(this.correlator.benchRunId, endpoint.variant),
      value: this.serialize(tagged),
    });
    return [this.toDelivery(endpoint, tagged)];
  }
}

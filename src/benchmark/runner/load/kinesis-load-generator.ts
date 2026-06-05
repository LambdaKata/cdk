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
 * Layer D — {@link KinesisLoadGenerator}: Kinesis producer load (fan-out EFO vs
 * shared-read standard, window-correlated, run-time, CDK-free).
 *
 * @module benchmark/runner/load/kinesis-load-generator
 */

import type { TaggedEvent, TraceCorrelator } from '../trace-correlator';
import { BaseLoadGenerator } from './base-load-generator';
import { partitionKeyFor } from './partition-key';
import type {
  Delivery,
  KinesisLoadGeneratorConfig,
  KinesisProducerClient,
  LoadGenerationRequest,
  LoadRoutingClass,
  VariantEndpoint,
} from './types';

/**
 * Drives load by producing records to a Kinesis stream (Req 9.6).
 *
 * Kinesis routing depends on the consumer mode, supplied at construction:
 *
 * - `fan-out` (enhanced fan-out) — each variant consumes its own stream, so a
 *   record is produced to EVERY subscribed variant's stream;
 * - `shared-read` (standard iterator) — both variants read one shared stream, so
 *   a record is produced ONCE to the shared source.
 *
 * Kinesis is a window-correlated trigger: its records cannot carry a
 * per-invocation marker, so the produced `data` is the ORIGINAL payload (no
 * embedded marker) and every {@link Delivery} is `window-correlated`. The
 * partition key is a deterministic, variant-scoped string.
 */
export class KinesisLoadGenerator extends BaseLoadGenerator {
  /** @inheritDoc */
  public readonly type = 'kinesis' as const;

  /** @inheritDoc */
  public readonly routingClass: LoadRoutingClass;

  private readonly client: KinesisProducerClient;

  /**
   * @param correlator - The run-scoped correlator (records are window-correlated).
   * @param client - The injected Kinesis producer port.
   * @param config - The routing class: `fan-out` (EFO) or `shared-read`
   *   (standard).
   */
  public constructor(
    correlator: TraceCorrelator,
    client: KinesisProducerClient,
    config: KinesisLoadGeneratorConfig,
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
    await this.client.putRecord({
      streamName: endpoint.address,
      partitionKey: partitionKeyFor(this.correlator.benchRunId, endpoint.variant),
      data: this.serialize(tagged),
    });
    return [this.toDelivery(endpoint, tagged)];
  }
}

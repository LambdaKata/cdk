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
 * Layer D — {@link DynamoDbStreamsLoadGenerator}: DynamoDB Streams driver load
 * (shared-read, window-correlated, run-time, CDK-free).
 *
 * @module benchmark/runner/load/dynamodb-streams-load-generator
 */

import type { TaggedEvent, TraceCorrelator } from '../trace-correlator';
import { BaseLoadGenerator } from './base-load-generator';
import type {
  Delivery,
  DynamoDbStreamWriterClient,
  LoadGenerationRequest,
  LoadRoutingClass,
  VariantEndpoint,
} from './types';

/**
 * Drives load by writing items to a shared table to drive its DynamoDB Stream
 * (Req 9.6).
 *
 * DynamoDB Streams is a shared-read source: both variants read one stream off a
 * single table, so an item is written ONCE per tick to the shared table. It is a
 * window-correlated trigger — the stream record cannot carry a per-invocation
 * marker — so the written `item` is the ORIGINAL payload (no embedded marker)
 * and the {@link Delivery} is `window-correlated`.
 */
export class DynamoDbStreamsLoadGenerator extends BaseLoadGenerator {
  /** @inheritDoc */
  public readonly type = 'dynamoDbStreams' as const;

  /** @inheritDoc */
  public readonly routingClass: LoadRoutingClass = 'shared-read';

  private readonly client: DynamoDbStreamWriterClient;

  /**
   * @param correlator - The run-scoped correlator (items are window-correlated).
   * @param client - The injected DynamoDB stream-writer port.
   */
  public constructor(
    correlator: TraceCorrelator,
    client: DynamoDbStreamWriterClient,
  ) {
    super(correlator);
    this.client = client;
  }

  /** @inheritDoc */
  protected async dispatch(
    endpoint: VariantEndpoint,
    tagged: TaggedEvent<Record<string, unknown>>,
    _request: LoadGenerationRequest,
  ): Promise<Delivery[]> {
    // window-correlated: `tagged.payload` is the original payload (no marker).
    await this.client.putItem({
      tableName: endpoint.address,
      item: { ...tagged.payload },
    });
    return [this.toDelivery(endpoint, tagged)];
  }
}

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
 * Layer C — DynamoDB Streams trigger adapter
 * (Req 8.5, 9.1, 9.3, 9.6, 10.1, 10.2, 3.2–3.4).
 *
 * DynamoDB Streams is a Shared_Read source (Req 8.5). Per the design isolation
 * table the adapter creates an **isolated benchmark table with its stream
 * enabled** (writes to that table drive the stream) and attaches BOTH variants
 * via `AWS::Lambda::EventSourceMapping`:
 *
 * - the kata mapping is created ALWAYS disabled (Req 10.2, 3.3), targeting the
 *   clone's SnapStart alias when supplied (Req 7);
 * - the baseline mapping is created in the routing-driven state, defaulting to
 *   disabled (Req 10.1, 10.2, 3.4).
 *
 * The isolation is a real isolated TABLE with a stream — not merely a stream
 * declaration — so benchmark writes never touch production data (Req 9.6, 3.5).
 * Mappings use a deterministic `LATEST` starting position. The baseline's
 * pre-existing production stream mapping is never read or mutated (Property 4,
 * Req 3.2).
 *
 * @remarks
 * Validates: Requirements 8.5, 9.1, 9.3, 9.6, 10.1, 10.2, 10.3, 10.4, 3.2, 3.3, 3.4
 *
 * @module benchmark/triggers/dynamodb-streams
 */

import { AttributeType, StreamViewType, Table } from 'aws-cdk-lib/aws-dynamodb';

import { AbstractTriggerAdapter, BENCHMARK_STREAM_STARTING_POSITION } from './adapter-base';
import type { AdapterProvisionResult, AdapterSynthContext, DynamoDbStreamsTrigger } from './types';

/**
 * DynamoDB Streams adapter (shared-read, isolated benchmark table + stream,
 * Req 8.5, 9.6).
 */
export class DynamoDbStreamsTriggerAdapter extends AbstractTriggerAdapter<DynamoDbStreamsTrigger> {
  /** The trigger discriminant this adapter handles. */
  public readonly type = 'dynamoDbStreams' as const;

  /**
   * Create an isolated benchmark table with a stream and attach both variants
   * with the kata mapping disabled (Req 9.6, 10.1, 10.2).
   *
   * @param context - The synth-time context.
   * @param _declaration - The DynamoDB Streams declaration.
   * @returns The shared-read provision result with both mapping UUID tokens.
   */
  public provision(
    context: AdapterSynthContext,
    _declaration: DynamoDbStreamsTrigger,
  ): AdapterProvisionResult {
    const scope = this.requireScope(context);
    const variantId = this.variantIdOf(context);

    // Isolated benchmark table WITH a stream — writes drive the stream. Never
    // the production table (Req 9.6, 3.5).
    const benchmarkTable = new Table(scope, `${variantId}BenchTable`, {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // A table stream ARN is only defined when a stream is enabled (it is here).
    const streamArn = benchmarkTable.tableStreamArn;
    if (streamArn === undefined) {
      throw new Error(
        `dynamoDbStreams adapter: benchmark table for "${context.baselineConstructPath}" has ` +
        'no stream ARN; a stream must be enabled to drive the event source mapping.',
      );
    }

    const mappings = this.createVariantMappings(context, {
      eventSourceArn: streamArn,
      startingPosition: BENCHMARK_STREAM_STARTING_POSITION,
    });

    return {
      routingClass: 'shared-read',
      isolated: true,
      sourceRef: streamArn,
      mappings,
    };
  }
}

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
 * Layer D — {@link createLoadGenerators}: wire one load generator per supported
 * trigger type (run-time, CDK-free).
 *
 * @module benchmark/runner/load/create-load-generators
 */

import type { BenchTriggerType, TraceCorrelator } from '../trace-correlator';
import { DynamoDbStreamsLoadGenerator } from './dynamodb-streams-load-generator';
import { EventBridgeLoadGenerator } from './event-bridge-load-generator';
import { HttpLoadGenerator } from './http-load-generator';
import { InvokeLoadGenerator } from './invoke-load-generator';
import { KafkaLoadGenerator } from './kafka-load-generator';
import { KinesisLoadGenerator } from './kinesis-load-generator';
import { SnsLoadGenerator } from './sns-load-generator';
import { SqsLoadGenerator } from './sqs-load-generator';
import {
  DEFAULT_EVENT_BRIDGE_DETAIL_TYPE,
  DEFAULT_EVENT_BRIDGE_SOURCE,
  DEFAULT_KAFKA_ROUTING_CLASS,
  DEFAULT_KINESIS_ROUTING_CLASS,
} from './types';
import type { LoadGenerator, LoadGeneratorClients } from './types';

/**
 * Build the registry of run-time load generators, one per supported trigger type
 * (Req 9.4–9.6).
 *
 * All nine supported trigger discriminants are wired from the injected client
 * ports; `apiGateway` and `functionUrl` BOTH use the single
 * {@link LoadGeneratorClients.httpRequester} (they deliver over HTTPS). The
 * generators that take a routing-class mode (`kinesis`, `kafka`) are wired with
 * the conservative defaults (`shared-read` / `competing`) matching the
 * synth-time routing table; the runner can construct a generator with the other
 * mode directly when the manifest declares EFO / distinct-group.
 *
 * @param correlator - The run-scoped correlator threaded into every generator.
 * @param clients - The injected client ports backing each generator.
 * @returns A map from {@link BenchTriggerType} to its generator (nine entries).
 */
export function createLoadGenerators(
  correlator: TraceCorrelator,
  clients: LoadGeneratorClients,
): Map<BenchTriggerType, LoadGenerator> {
  const generators = new Map<BenchTriggerType, LoadGenerator>();

  generators.set('invoke', new InvokeLoadGenerator(correlator, clients.lambdaInvoker));
  generators.set(
    'apiGateway',
    new HttpLoadGenerator(correlator, clients.httpRequester, { type: 'apiGateway' }),
  );
  generators.set(
    'functionUrl',
    new HttpLoadGenerator(correlator, clients.httpRequester, { type: 'functionUrl' }),
  );
  generators.set('sqs', new SqsLoadGenerator(correlator, clients.sqs));
  generators.set('sns', new SnsLoadGenerator(correlator, clients.sns));
  generators.set(
    'eventBridge',
    new EventBridgeLoadGenerator(correlator, clients.eventBridge, {
      source: DEFAULT_EVENT_BRIDGE_SOURCE,
      detailType: DEFAULT_EVENT_BRIDGE_DETAIL_TYPE,
    }),
  );
  generators.set(
    'kinesis',
    new KinesisLoadGenerator(correlator, clients.kinesis, {
      routingClass: DEFAULT_KINESIS_ROUTING_CLASS,
    }),
  );
  generators.set(
    'dynamoDbStreams',
    new DynamoDbStreamsLoadGenerator(correlator, clients.dynamoDbStreams),
  );
  generators.set(
    'kafka',
    new KafkaLoadGenerator(correlator, clients.kafka, {
      routingClass: DEFAULT_KAFKA_ROUTING_CLASS,
    }),
  );

  return generators;
}

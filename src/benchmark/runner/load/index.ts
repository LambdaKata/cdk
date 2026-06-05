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
 * Layer D — Run-time per-adapter load generators package barrel (run-time,
 * CDK-free).
 *
 * Single import site for the load-generation subsystem (task 19): the nine
 * per-adapter generators, the {@link createLoadGenerators} registry factory, the
 * {@link LoadGenerationError} type, and the client ports / value types they are
 * wired from. The generators are the PRODUCERS of correlation-marked benchmark
 * events; they deliver to the variant under test (request-response), the single
 * active variant (competing), every subscribed variant (fan-out), or a shared
 * source (shared-read), delegating all marker concerns to the
 * {@link TraceCorrelator} (Req 9.4–9.6, 19.2, 19.4).
 *
 * **CDK-free by construction.** Every module re-exported here imports the
 * sibling `./trace-correlator` and the AWS SDK only — NEVER `aws-cdk-lib` or
 * `constructs` — keeping the runner package shippable without CDK (enforced by
 * `test/benchmark-runner-cdk-free.test.ts`). The client capabilities are
 * expressed as plain interface ports (dependency inversion), so no concrete AWS
 * SDK client is bound here.
 *
 * @remarks
 * Validates: Requirements 9.4, 9.5, 9.6
 *
 * @module benchmark/runner/load
 */

// Concrete per-adapter generators.
export { InvokeLoadGenerator } from './invoke-load-generator';
export { HttpLoadGenerator } from './http-load-generator';
export { SqsLoadGenerator } from './sqs-load-generator';
export { SnsLoadGenerator } from './sns-load-generator';
export { EventBridgeLoadGenerator } from './event-bridge-load-generator';
export { KinesisLoadGenerator } from './kinesis-load-generator';
export { DynamoDbStreamsLoadGenerator } from './dynamodb-streams-load-generator';
export { KafkaLoadGenerator } from './kafka-load-generator';

// Shared base + registry factory.
export { BaseLoadGenerator } from './base-load-generator';
export { createLoadGenerators } from './create-load-generators';

// Error type.
export { LoadGenerationError } from './errors';

// Deterministic stream key helper.
export { partitionKeyFor } from './partition-key';

// Contracts, ports, and value types.
export {
  DEFAULT_EVENT_BRIDGE_SOURCE,
  DEFAULT_EVENT_BRIDGE_DETAIL_TYPE,
  DEFAULT_KINESIS_ROUTING_CLASS,
  DEFAULT_KAFKA_ROUTING_CLASS,
} from './types';
export type {
  LoadRoutingClass,
  VariantEndpoint,
  LoadRouting,
  LoadProfile,
  LoadGenerationRequest,
  Delivery,
  LoadGenerationResult,
  LoadGenerator,
  InvokeRequest,
  LambdaInvokerClient,
  HttpRequest,
  HttpRequester,
  SqsSendMessageRequest,
  SqsPublisherClient,
  SnsPublishRequest,
  SnsPublisherClient,
  EventBridgePutEventsRequest,
  EventBridgePublisherClient,
  KinesisPutRecordRequest,
  KinesisProducerClient,
  DynamoDbPutItemRequest,
  DynamoDbStreamWriterClient,
  KafkaProduceRequest,
  KafkaProducerClient,
  HttpLoadGeneratorConfig,
  EventBridgeLoadGeneratorConfig,
  KinesisLoadGeneratorConfig,
  KafkaLoadGeneratorConfig,
  LoadGeneratorClients,
} from './types';

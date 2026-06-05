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
 * Layer D — Load-generator contracts (run-time, CDK-free).
 *
 * This module declares the **ports and value types** shared by the per-adapter
 * run-time load generators (task 19). It owns no behavior — only the dependency
 * inversion seam (the eight client ports), the request/response value objects,
 * and the {@link LoadGenerator} contract every concrete generator implements.
 *
 * ## Dependency inversion (testability + CDK-free)
 *
 * Each generator talks to its delivery channel through a MINIMAL port interface
 * (e.g. {@link SqsPublisherClient}) rather than a concrete AWS SDK client. The
 * runner (task 21) injects real SDK-backed adapters; unit tests inject `jest.fn`
 * mocks. The generators therefore depend on no concrete SDK client and import no
 * `aws-cdk-lib`/`constructs`, keeping the runner package shippable without CDK
 * (enforced by `test/benchmark-runner-cdk-free.test.ts`).
 *
 * ## Routing classes
 *
 * {@link LoadRoutingClass} mirrors the synth-time `RoutingClass` union
 * (`src/benchmark/triggers/types.ts`). It is intentionally re-declared here as
 * plain literals — never imported — for the same reason {@link BenchTriggerType}
 * is re-declared in `./trace-correlator`: the synth-time module carries
 * `aws-cdk-lib` type references, and importing it would pull CDK into the runner.
 *
 * @remarks
 * Validates: Requirements 9.4, 9.5, 9.6
 *
 * @module benchmark/runner/load/types
 */

import type {
  BenchTriggerType,
  CorrelationMarker,
  CorrelationMode,
  CorrelationVariant,
} from '../trace-correlator';

/**
 * The execution-semantics class a generator delivers under (Req 8.1, 9.4–9.6).
 *
 * Local mirror of the synth-time `RoutingClass` union, kept CDK-free:
 *
 * - `request-response` — deliver to the variant under test (invoke / HTTPS);
 * - `competing` — deliver one event to the single active variant (SQS,
 *   same-group Kafka);
 * - `fan-out` — deliver to every subscribed variant (SNS, EventBridge, Kinesis
 *   EFO, distinct-group Kafka);
 * - `shared-read` — produce once to the shared source (standard Kinesis,
 *   DynamoDB Streams).
 */
export type LoadRoutingClass =
  | 'request-response'
  | 'competing'
  | 'fan-out'
  | 'shared-read';

/**
 * A variant's delivery address for one trigger (Req 9.4–9.6).
 *
 * The `address` is the channel the variant is reached through and is
 * trigger-specific: a function name (invoke), an HTTPS URL (apiGateway /
 * functionUrl), a queue URL (SQS), a topic ARN (SNS), an event bus name
 * (EventBridge), a stream name (Kinesis), a table name (DynamoDB Streams), or a
 * topic (Kafka).
 */
export interface VariantEndpoint {
  /** Which variant this endpoint reaches. */
  readonly variant: CorrelationVariant;
  /** The trigger-specific delivery address for the variant. */
  readonly address: string;
}

/**
 * The routing topology for one generation tick: the variant endpoints and, for
 * request-response/competing classes, which variant is under test.
 */
export interface LoadRouting {
  /** The subscribed variant endpoints for the trigger. */
  readonly endpoints: readonly VariantEndpoint[];
  /**
   * The variant under test for this tick. Required for the request-response and
   * competing classes (a {@link LoadGenerationError} is thrown when it is absent
   * or has no matching endpoint); ignored for fan-out and shared-read.
   */
  readonly activeVariant?: CorrelationVariant;
}

/** Per-tick load shaping (Req 9.4). */
export interface LoadProfile {
  /**
   * The upper bound of the inclusive `1..concurrency` band of concurrent
   * requests an HTTPS generator emits per tick. Defaults to `1` when omitted.
   */
  readonly concurrency?: number;
}

/** One generation tick's request (Req 9.4–9.6). */
export interface LoadGenerationRequest {
  /** The routing topology and the variant under test (when applicable). */
  readonly routing: LoadRouting;
  /** The run phase label (e.g. an ABBA window label). */
  readonly phase: string;
  /** The window sequence number within the run. */
  readonly window: number;
  /** The event/invocation payload template (correlation marker added per type). */
  readonly payload: Record<string, unknown>;
  /** Optional per-tick load shaping (HTTPS concurrency band). */
  readonly load?: LoadProfile;
}

/**
 * A single delivery the generator performed in a tick (Req 9.4–9.6, 19.4).
 *
 * `mode` is `invocation-correlated` when the trigger carried an embedded marker
 * and `window-correlated` otherwise; {@link marker} is present only in the
 * former case. These are sourced from the {@link TraceCorrelator}, never decided
 * by the generator.
 */
export interface Delivery {
  /** The variant this delivery targeted. */
  readonly variant: CorrelationVariant;
  /** The address the delivery was sent to. */
  readonly address: string;
  /** Whether the delivery carried a per-invocation marker or is window-correlated. */
  readonly mode: CorrelationMode;
  /** The embedded marker when invocation-correlated; absent otherwise. */
  readonly marker?: CorrelationMarker;
}

/** The result of one generation tick: the deliveries performed. */
export interface LoadGenerationResult {
  /** One entry per delivery performed, in dispatch order. */
  readonly deliveries: Delivery[];
}

/**
 * The contract every per-adapter load generator implements (Req 9.4–9.6).
 *
 * A generator is bound to one {@link BenchTriggerType} and one
 * {@link LoadRoutingClass}; {@link generate} performs one tick of load and
 * reports the deliveries it made.
 */
export interface LoadGenerator {
  /** The trigger type this generator produces load for. */
  readonly type: BenchTriggerType;
  /** The routing class governing how the tick is delivered. */
  readonly routingClass: LoadRoutingClass;
  /**
   * Perform one tick of load.
   *
   * @param request - The routing, run coordinate, payload, and load shaping.
   * @returns The deliveries performed during the tick.
   */
  generate(request: LoadGenerationRequest): Promise<LoadGenerationResult>;
}

// ── Client ports (dependency inversion seam) ─────────────────────────────────

/** A direct Lambda `Invoke` request (RequestResponse only for benchmarking). */
export interface InvokeRequest {
  /** The target function name or ARN. */
  readonly functionName: string;
  /** Always `RequestResponse` so the generator observes the synchronous result. */
  readonly invocationType: 'RequestResponse';
  /** The JSON-serialized, marker-embedded payload. */
  readonly payload: string;
}

/** Port wrapping a direct Lambda `Invoke` (request-response). */
export interface LambdaInvokerClient {
  /**
   * Invoke a function synchronously.
   *
   * @param request - The function name, invocation type, and JSON payload.
   */
  invoke(request: InvokeRequest): Promise<unknown>;
}

/** An HTTPS request to an apiGateway/functionUrl endpoint. */
export interface HttpRequest {
  /** The endpoint URL of the variant under test. */
  readonly url: string;
  /** The HTTP method (always `POST` for a payload-bearing benchmark request). */
  readonly method: string;
  /** Request headers. */
  readonly headers: Record<string, string>;
  /** The JSON-serialized, marker-embedded request body. */
  readonly body: string;
}

/** Port wrapping an HTTPS request (apiGateway / functionUrl). */
export interface HttpRequester {
  /**
   * Send an HTTPS request.
   *
   * @param request - The URL, method, headers, and JSON body.
   */
  send(request: HttpRequest): Promise<unknown>;
}

/** An SQS `SendMessage` request. */
export interface SqsSendMessageRequest {
  /** The target queue URL. */
  readonly queueUrl: string;
  /** The JSON-serialized, marker-embedded message body. */
  readonly messageBody: string;
}

/** Port wrapping SQS `SendMessage` (competing). */
export interface SqsPublisherClient {
  /**
   * Publish one message to a queue.
   *
   * @param request - The queue URL and JSON message body.
   */
  sendMessage(request: SqsSendMessageRequest): Promise<unknown>;
}

/** An SNS `Publish` request. */
export interface SnsPublishRequest {
  /** The target topic ARN. */
  readonly topicArn: string;
  /** The JSON-serialized, marker-embedded message. */
  readonly message: string;
}

/** Port wrapping SNS `Publish` (fan-out). */
export interface SnsPublisherClient {
  /**
   * Publish one message to a topic.
   *
   * @param request - The topic ARN and JSON message.
   */
  publish(request: SnsPublishRequest): Promise<unknown>;
}

/** An EventBridge `PutEvents` request (single entry). */
export interface EventBridgePutEventsRequest {
  /** The target event bus name. */
  readonly busName: string;
  /** The event source attribute. */
  readonly source: string;
  /** The event detail-type attribute. */
  readonly detailType: string;
  /** The JSON-serialized, marker-embedded event detail. */
  readonly detail: string;
}

/** Port wrapping EventBridge `PutEvents` (fan-out). */
export interface EventBridgePublisherClient {
  /**
   * Put one event onto a bus.
   *
   * @param request - The bus name, source, detail-type, and JSON detail.
   */
  putEvents(request: EventBridgePutEventsRequest): Promise<unknown>;
}

/** A Kinesis `PutRecord` request. */
export interface KinesisPutRecordRequest {
  /** The target stream name. */
  readonly streamName: string;
  /** The partition key (a string, deterministic per variant/run). */
  readonly partitionKey: string;
  /** The JSON-serialized record data (window-correlated: no embedded marker). */
  readonly data: string;
}

/** Port wrapping Kinesis `PutRecord` (fan-out EFO / shared-read standard). */
export interface KinesisProducerClient {
  /**
   * Produce one record to a stream.
   *
   * @param request - The stream name, partition key, and JSON data.
   */
  putRecord(request: KinesisPutRecordRequest): Promise<unknown>;
}

/** A DynamoDB `PutItem` request driving a DynamoDB Stream. */
export interface DynamoDbPutItemRequest {
  /** The target table name. */
  readonly tableName: string;
  /** The item to write (window-correlated: the payload object, no marker). */
  readonly item: Record<string, unknown>;
}

/** Port wrapping DynamoDB `PutItem` (shared-read stream source). */
export interface DynamoDbStreamWriterClient {
  /**
   * Write one item to a table to drive its stream.
   *
   * @param request - The table name and item object.
   */
  putItem(request: DynamoDbPutItemRequest): Promise<unknown>;
}

/** A Kafka produce request. */
export interface KafkaProduceRequest {
  /** The target topic. */
  readonly topic: string;
  /** An optional record key (deterministic per variant). */
  readonly key?: string;
  /** The JSON-serialized record value (window-correlated: no embedded marker). */
  readonly value: string;
}

/** Port wrapping a Kafka produce (competing same-group / fan-out distinct-group). */
export interface KafkaProducerClient {
  /**
   * Produce one record to a topic.
   *
   * @param request - The topic, optional key, and JSON value.
   */
  produce(request: KafkaProduceRequest): Promise<unknown>;
}

// ── Generator construction configs ───────────────────────────────────────────

/** Construction config for {@link HttpLoadGenerator}. */
export interface HttpLoadGeneratorConfig {
  /** Which HTTPS trigger this generator drives. */
  readonly type: 'apiGateway' | 'functionUrl';
  /**
   * Random source in `[0, 1)` used to pick the per-tick request count within the
   * inclusive `1..concurrency` band. Defaults to `Math.random`; tests inject a
   * deterministic source.
   */
  readonly random?: () => number;
}

/** Construction config for {@link EventBridgeLoadGenerator}. */
export interface EventBridgeLoadGeneratorConfig {
  /** The `source` attribute stamped onto every emitted event. */
  readonly source: string;
  /** The `detail-type` attribute stamped onto every emitted event. */
  readonly detailType: string;
}

/** Construction config for {@link KinesisLoadGenerator}. */
export interface KinesisLoadGeneratorConfig {
  /** `fan-out` for enhanced fan-out, `shared-read` for a standard iterator. */
  readonly routingClass: 'fan-out' | 'shared-read';
}

/** Construction config for {@link KafkaLoadGenerator}. */
export interface KafkaLoadGeneratorConfig {
  /** `competing` for a same-group consumer, `fan-out` for distinct groups. */
  readonly routingClass: 'competing' | 'fan-out';
}

/**
 * The bundle of injected client ports {@link createLoadGenerators} wires the
 * generators from (Req 9.4–9.6).
 *
 * `apiGateway` and `functionUrl` share the single {@link httpRequester} (both
 * deliver over HTTPS).
 */
export interface LoadGeneratorClients {
  /** Direct Lambda invoke port (invoke). */
  readonly lambdaInvoker: LambdaInvokerClient;
  /** HTTPS port shared by apiGateway + functionUrl. */
  readonly httpRequester: HttpRequester;
  /** SQS publisher port (competing). */
  readonly sqs: SqsPublisherClient;
  /** SNS publisher port (fan-out). */
  readonly sns: SnsPublisherClient;
  /** EventBridge publisher port (fan-out). */
  readonly eventBridge: EventBridgePublisherClient;
  /** Kinesis producer port (fan-out EFO / shared-read standard). */
  readonly kinesis: KinesisProducerClient;
  /** DynamoDB stream-writer port (shared-read). */
  readonly dynamoDbStreams: DynamoDbStreamWriterClient;
  /** Kafka producer port (competing / fan-out). */
  readonly kafka: KafkaProducerClient;
}

/** Default EventBridge `source` used when wiring via {@link createLoadGenerators}. */
export const DEFAULT_EVENT_BRIDGE_SOURCE = 'lambda-kata.bench' as const;

/** Default EventBridge `detail-type` used when wiring via {@link createLoadGenerators}. */
export const DEFAULT_EVENT_BRIDGE_DETAIL_TYPE = 'BenchEvent' as const;

/**
 * Default Kinesis routing class when wiring via {@link createLoadGenerators}.
 *
 * `shared-read` mirrors a standard (non-EFO) iterator — the conservative default
 * matching the synth-time routing table (standard = shared-read).
 */
export const DEFAULT_KINESIS_ROUTING_CLASS: KinesisLoadGeneratorConfig['routingClass'] =
  'shared-read';

/**
 * Default Kafka routing class when wiring via {@link createLoadGenerators}.
 *
 * `competing` mirrors a single shared consumer group — the conservative default
 * matching the synth-time routing table (same-group = competing).
 */
export const DEFAULT_KAFKA_ROUTING_CLASS: KafkaLoadGeneratorConfig['routingClass'] =
  'competing';

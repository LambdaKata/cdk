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
 * Unit tests for the run-time per-adapter load generators (Layer D, task 19).
 *
 * The generators are the PRODUCERS of correlation-marked benchmark events. These
 * tests inject MOCKED client ports (no AWS, no CDK, no network) and assert the
 * delivery semantics per routing class (Req 9.4, 9.5, 9.6):
 *
 *  - request-response (invoke, apiGateway, functionUrl): delivers to THE VARIANT
 *    UNDER TEST; HTTPS emits a RANDOM 1..N concurrent requests per tick;
 *  - competing (sqs, kafka same-group): delivers to the SINGLE ACTIVE variant;
 *  - fan-out (sns, eventBridge, kinesis EFO, kafka distinct-group): delivers each
 *    event to EVERY SUBSCRIBED variant;
 *  - shared-read (kinesis standard, dynamoDbStreams): produces to the shared
 *    source;
 *  - markers are injected where the trigger permits one (invoke/apiGateway/
 *    functionUrl/sqs/sns/eventBridge) and ABSENT for window-correlated triggers
 *    (kinesis/dynamoDbStreams/kafka), per the TraceCorrelator contract.
 *
 * **Validates: Requirements 9.4, 9.5, 9.6**
 *
 * @module benchmark-load-generators.test
 */

import { MARKER_KEY, TraceCorrelator } from '../src/benchmark/runner/trace-correlator';
import {
  InvokeLoadGenerator,
  HttpLoadGenerator,
  SqsLoadGenerator,
  SnsLoadGenerator,
  EventBridgeLoadGenerator,
  KinesisLoadGenerator,
  DynamoDbStreamsLoadGenerator,
  KafkaLoadGenerator,
  LoadGenerationError,
  createLoadGenerators,
} from '../src/benchmark/runner/load';
import type {
  LambdaInvokerClient,
  HttpRequester,
  SqsPublisherClient,
  SnsPublisherClient,
  EventBridgePublisherClient,
  KinesisProducerClient,
  DynamoDbStreamWriterClient,
  KafkaProducerClient,
  VariantEndpoint,
} from '../src/benchmark/runner/load';

/** Both-variant endpoints sharing one address (competing/shared source topology). */
function sharedEndpoints(address: string): VariantEndpoint[] {
  return [
    { variant: 'baseline', address },
    { variant: 'kata', address },
  ];
}

/** Both-variant endpoints with distinct addresses (fan-out / direct topology). */
function distinctEndpoints(baseline: string, kata: string): VariantEndpoint[] {
  return [
    { variant: 'baseline', address: baseline },
    { variant: 'kata', address: kata },
  ];
}

describe('InvokeLoadGenerator — request-response, variant under test (Req 9.4)', () => {
  it('invokes only the variant under test with a RequestResponse call and embedded marker', async () => {
    const invoke = jest.fn().mockResolvedValue({ statusCode: 200 });
    const client: LambdaInvokerClient = { invoke };
    const generator = new InvokeLoadGenerator(new TraceCorrelator('bench-inv'), client);

    expect(generator.type).toBe('invoke');
    expect(generator.routingClass).toBe('request-response');

    const result = await generator.generate({
      routing: {
        endpoints: distinctEndpoints('fn-baseline', 'fn-kata'),
        activeVariant: 'kata',
      },
      phase: 'measure',
      window: 2,
      payload: { orderId: 7 },
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    const sent = invoke.mock.calls[0][0];
    expect(sent.functionName).toBe('fn-kata');
    expect(sent.invocationType).toBe('RequestResponse');

    const payload = JSON.parse(sent.payload);
    expect(payload.orderId).toBe(7);
    expect(payload[MARKER_KEY]).toMatchObject({
      benchRunId: 'bench-inv',
      variant: 'kata',
      phase: 'measure',
      window: 2,
    });

    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]).toMatchObject({
      variant: 'kata',
      address: 'fn-kata',
      mode: 'invocation-correlated',
    });
    expect(result.deliveries[0].marker).toBeDefined();
  });

  it('never delivers to the variant that is not under test', async () => {
    const invoke = jest.fn().mockResolvedValue({ statusCode: 200 });
    const generator = new InvokeLoadGenerator(new TraceCorrelator('b'), { invoke });

    await generator.generate({
      routing: { endpoints: distinctEndpoints('fn-baseline', 'fn-kata'), activeVariant: 'baseline' },
      phase: 'p',
      window: 0,
      payload: {},
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0].functionName).toBe('fn-baseline');
  });

  it('throws LoadGenerationError when no variant under test is specified', async () => {
    const generator = new InvokeLoadGenerator(new TraceCorrelator('b'), { invoke: jest.fn() });

    await expect(
      generator.generate({
        routing: { endpoints: distinctEndpoints('fn-baseline', 'fn-kata') },
        phase: 'p',
        window: 0,
        payload: {},
      }),
    ).rejects.toBeInstanceOf(LoadGenerationError);
  });

  it('throws LoadGenerationError when the active variant has no endpoint', async () => {
    const generator = new InvokeLoadGenerator(new TraceCorrelator('b'), { invoke: jest.fn() });

    await expect(
      generator.generate({
        routing: { endpoints: [{ variant: 'baseline', address: 'fn-baseline' }], activeVariant: 'kata' },
        phase: 'p',
        window: 0,
        payload: {},
      }),
    ).rejects.toBeInstanceOf(LoadGenerationError);
  });
});

describe('HttpLoadGenerator — request-response, random 1..N concurrent per tick (Req 9.4)', () => {
  it('emits N concurrent requests to the variant under test when the RNG is maximal', async () => {
    const send = jest.fn().mockResolvedValue({ status: 200 });
    const client: HttpRequester = { send };
    const generator = new HttpLoadGenerator(new TraceCorrelator('bench-http'), client, {
      type: 'apiGateway',
      random: () => 0.99,
    });

    expect(generator.type).toBe('apiGateway');
    expect(generator.routingClass).toBe('request-response');

    const result = await generator.generate({
      routing: { endpoints: distinctEndpoints('https://b.example', 'https://k.example'), activeVariant: 'kata' },
      phase: 'measure',
      window: 1,
      payload: { q: 1 },
      load: { concurrency: 5 },
    });

    expect(send).toHaveBeenCalledTimes(5);
    for (const call of send.mock.calls) {
      expect(call[0].url).toBe('https://k.example');
    }
    expect(result.deliveries).toHaveLength(5);
    // Every HTTPS request carries the marker (apiGateway permits a marker).
    const firstBody = JSON.parse(send.mock.calls[0][0].body);
    expect(firstBody[MARKER_KEY]).toMatchObject({ variant: 'kata', phase: 'measure', window: 1 });
  });

  it('emits exactly one request when the RNG is minimal', async () => {
    const send = jest.fn().mockResolvedValue({ status: 200 });
    const generator = new HttpLoadGenerator(new TraceCorrelator('b'), { send }, {
      type: 'functionUrl',
      random: () => 0,
    });

    expect(generator.type).toBe('functionUrl');

    await generator.generate({
      routing: { endpoints: distinctEndpoints('https://b', 'https://k'), activeVariant: 'baseline' },
      phase: 'p',
      window: 0,
      payload: {},
      load: { concurrency: 5 },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].url).toBe('https://b');
  });

  it('stays within the inclusive 1..N band across many ticks', async () => {
    const send = jest.fn().mockResolvedValue({ status: 200 });
    let counter = 0;
    // Cycle the RNG across the [0,1) interval to exercise the whole band.
    const generator = new HttpLoadGenerator(new TraceCorrelator('b'), { send }, {
      type: 'apiGateway',
      random: () => {
        const values = [0, 0.25, 0.5, 0.75, 0.999];
        const value = values[counter % values.length];
        counter += 1;
        return value;
      },
    });

    for (let i = 0; i < 5; i += 1) {
      send.mockClear();
      await generator.generate({
        routing: { endpoints: distinctEndpoints('https://b', 'https://k'), activeVariant: 'kata' },
        phase: 'p',
        window: i,
        payload: {},
        load: { concurrency: 4 },
      });
      expect(send.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(send.mock.calls.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('SqsLoadGenerator — competing, single active variant (Req 9.5)', () => {
  it('publishes one message to the active variant only, with an embedded marker', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const client: SqsPublisherClient = { sendMessage };
    const generator = new SqsLoadGenerator(new TraceCorrelator('bench-sqs'), client);

    expect(generator.type).toBe('sqs');
    expect(generator.routingClass).toBe('competing');

    const result = await generator.generate({
      routing: { endpoints: sharedEndpoints('https://sqs/bench-queue'), activeVariant: 'baseline' },
      phase: 'baseline-1',
      window: 0,
      payload: { task: 'x' },
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const sent = sendMessage.mock.calls[0][0];
    expect(sent.queueUrl).toBe('https://sqs/bench-queue');

    const body = JSON.parse(sent.messageBody);
    expect(body.task).toBe('x');
    expect(body[MARKER_KEY]).toMatchObject({ benchRunId: 'bench-sqs', variant: 'baseline', window: 0 });

    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0].variant).toBe('baseline');
    expect(result.deliveries[0].mode).toBe('invocation-correlated');
  });
});

describe('SnsLoadGenerator — fan-out, every subscribed variant (Req 9.6)', () => {
  it('publishes to every subscribed variant, each with its own variant marker', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const client: SnsPublisherClient = { publish };
    const generator = new SnsLoadGenerator(new TraceCorrelator('bench-sns'), client);

    expect(generator.type).toBe('sns');
    expect(generator.routingClass).toBe('fan-out');

    const result = await generator.generate({
      routing: { endpoints: distinctEndpoints('arn:topic:baseline', 'arn:topic:kata') },
      phase: 'measure',
      window: 3,
      payload: { evt: 1 },
    });

    expect(publish).toHaveBeenCalledTimes(2);
    const byTopic = new Map<string, string>(
      publish.mock.calls.map((call) => [call[0].topicArn, call[0].message]),
    );
    expect([...byTopic.keys()].sort()).toEqual(['arn:topic:baseline', 'arn:topic:kata']);

    const baselineMsg = JSON.parse(byTopic.get('arn:topic:baseline') as string);
    const kataMsg = JSON.parse(byTopic.get('arn:topic:kata') as string);
    expect(baselineMsg[MARKER_KEY].variant).toBe('baseline');
    expect(kataMsg[MARKER_KEY].variant).toBe('kata');

    expect(result.deliveries.map((d) => d.variant).sort()).toEqual(['baseline', 'kata']);
    expect(result.deliveries.every((d) => d.mode === 'invocation-correlated')).toBe(true);
  });
});

describe('EventBridgeLoadGenerator — fan-out, every subscribed variant (Req 9.6)', () => {
  it('puts an event to every subscribed variant bus with a marker in the detail', async () => {
    const putEvents = jest.fn().mockResolvedValue(undefined);
    const client: EventBridgePublisherClient = { putEvents };
    const generator = new EventBridgeLoadGenerator(new TraceCorrelator('bench-eb'), client, {
      source: 'lambda-kata.bench',
      detailType: 'BenchEvent',
    });

    expect(generator.type).toBe('eventBridge');
    expect(generator.routingClass).toBe('fan-out');

    const result = await generator.generate({
      routing: { endpoints: distinctEndpoints('bus-baseline', 'bus-kata') },
      phase: 'measure',
      window: 1,
      payload: { d: 1 },
    });

    expect(putEvents).toHaveBeenCalledTimes(2);
    for (const call of putEvents.mock.calls) {
      expect(call[0].source).toBe('lambda-kata.bench');
      expect(call[0].detailType).toBe('BenchEvent');
    }
    const buses = putEvents.mock.calls.map((call) => call[0].busName).sort();
    expect(buses).toEqual(['bus-baseline', 'bus-kata']);

    const firstDetail = JSON.parse(putEvents.mock.calls[0][0].detail);
    expect(firstDetail[MARKER_KEY]).toBeDefined();
    expect(result.deliveries).toHaveLength(2);
  });
});

describe('KinesisLoadGenerator — fan-out (EFO) vs shared-read (standard), window-correlated (Req 9.6)', () => {
  it('produces to every subscribed variant for enhanced fan-out, with NO marker (window-correlated)', async () => {
    const putRecord = jest.fn().mockResolvedValue(undefined);
    const client: KinesisProducerClient = { putRecord };
    const generator = new KinesisLoadGenerator(new TraceCorrelator('bench-kin'), client, {
      routingClass: 'fan-out',
    });

    expect(generator.type).toBe('kinesis');
    expect(generator.routingClass).toBe('fan-out');

    const result = await generator.generate({
      routing: { endpoints: distinctEndpoints('stream-baseline', 'stream-kata') },
      phase: 'measure',
      window: 4,
      payload: { rec: 1 },
    });

    expect(putRecord).toHaveBeenCalledTimes(2);
    for (const call of putRecord.mock.calls) {
      const data = JSON.parse(call[0].data);
      // window-correlated: the source cannot carry a per-invocation marker.
      expect(data[MARKER_KEY]).toBeUndefined();
      expect(typeof call[0].partitionKey).toBe('string');
    }
    expect(result.deliveries.every((d) => d.mode === 'window-correlated')).toBe(true);
    expect(result.deliveries.every((d) => d.marker === undefined)).toBe(true);
  });

  it('produces once to the shared source for the standard iterator', async () => {
    const putRecord = jest.fn().mockResolvedValue(undefined);
    const generator = new KinesisLoadGenerator(new TraceCorrelator('b'), { putRecord }, {
      routingClass: 'shared-read',
    });

    expect(generator.routingClass).toBe('shared-read');

    await generator.generate({
      routing: { endpoints: [{ variant: 'baseline', address: 'shared-stream' }] },
      phase: 'p',
      window: 0,
      payload: {},
    });

    expect(putRecord).toHaveBeenCalledTimes(1);
    expect(putRecord.mock.calls[0][0].streamName).toBe('shared-stream');
  });
});

describe('DynamoDbStreamsLoadGenerator — shared-read, shared source, window-correlated (Req 9.6)', () => {
  it('writes items to the shared table to drive the stream, with NO marker', async () => {
    const putItem = jest.fn().mockResolvedValue(undefined);
    const client: DynamoDbStreamWriterClient = { putItem };
    const generator = new DynamoDbStreamsLoadGenerator(new TraceCorrelator('bench-ddb'), client);

    expect(generator.type).toBe('dynamoDbStreams');
    expect(generator.routingClass).toBe('shared-read');

    const result = await generator.generate({
      routing: { endpoints: [{ variant: 'baseline', address: 'bench-table' }] },
      phase: 'p',
      window: 0,
      payload: { id: 'a', value: 1 },
    });

    expect(putItem).toHaveBeenCalledTimes(1);
    const sent = putItem.mock.calls[0][0];
    expect(sent.tableName).toBe('bench-table');
    expect(sent.item.id).toBe('a');
    expect(sent.item[MARKER_KEY]).toBeUndefined();
    expect(result.deliveries[0].mode).toBe('window-correlated');
  });
});

describe('KafkaLoadGenerator — competing (same-group) vs fan-out (distinct-group), window-correlated (Req 9.5, 9.6)', () => {
  it('produces to the single active variant for the same-group competing mode', async () => {
    const produce = jest.fn().mockResolvedValue(undefined);
    const client: KafkaProducerClient = { produce };
    const generator = new KafkaLoadGenerator(new TraceCorrelator('bench-kafka'), client, {
      routingClass: 'competing',
    });

    expect(generator.type).toBe('kafka');
    expect(generator.routingClass).toBe('competing');

    const result = await generator.generate({
      routing: { endpoints: sharedEndpoints('bench-topic'), activeVariant: 'kata' },
      phase: 'p',
      window: 0,
      payload: {},
    });

    expect(produce).toHaveBeenCalledTimes(1);
    expect(produce.mock.calls[0][0].topic).toBe('bench-topic');
    expect(result.deliveries[0].variant).toBe('kata');
    expect(result.deliveries[0].mode).toBe('window-correlated');
  });

  it('produces to every subscribed variant for the distinct-group fan-out mode', async () => {
    const produce = jest.fn().mockResolvedValue(undefined);
    const generator = new KafkaLoadGenerator(new TraceCorrelator('b'), { produce }, {
      routingClass: 'fan-out',
    });

    expect(generator.routingClass).toBe('fan-out');

    await generator.generate({
      routing: { endpoints: distinctEndpoints('topic-baseline', 'topic-kata') },
      phase: 'p',
      window: 0,
      payload: {},
    });

    expect(produce).toHaveBeenCalledTimes(2);
    const topics = produce.mock.calls.map((call) => call[0].topic).sort();
    expect(topics).toEqual(['topic-baseline', 'topic-kata']);
  });
});

describe('createLoadGenerators — one generator per supported trigger type', () => {
  it('wires a generator for every supported trigger type with apiGateway/functionUrl over HTTPS', () => {
    const generators = createLoadGenerators(new TraceCorrelator('b'), {
      lambdaInvoker: { invoke: jest.fn() },
      httpRequester: { send: jest.fn() },
      sqs: { sendMessage: jest.fn() },
      sns: { publish: jest.fn() },
      eventBridge: { putEvents: jest.fn() },
      kinesis: { putRecord: jest.fn() },
      dynamoDbStreams: { putItem: jest.fn() },
      kafka: { produce: jest.fn() },
    });

    expect(generators.get('invoke')?.routingClass).toBe('request-response');
    expect(generators.get('apiGateway')?.routingClass).toBe('request-response');
    expect(generators.get('functionUrl')?.routingClass).toBe('request-response');
    expect(generators.get('sqs')?.routingClass).toBe('competing');
    expect(generators.get('sns')?.routingClass).toBe('fan-out');
    expect(generators.get('eventBridge')?.routingClass).toBe('fan-out');
    expect(generators.get('dynamoDbStreams')?.routingClass).toBe('shared-read');

    // Exactly the nine supported trigger types are wired.
    expect([...generators.keys()].sort()).toEqual(
      [
        'apiGateway',
        'dynamoDbStreams',
        'eventBridge',
        'functionUrl',
        'invoke',
        'kafka',
        'kinesis',
        'sns',
        'sqs',
      ],
    );
  });
});

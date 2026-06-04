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
 * CDK assertion tests for the per-trigger synth-time adapters (Layer C, task 10).
 *
 * Per adapter the suite proves the four task-10 acceptance points:
 *
 * 1. **isolated source created** — the adapter creates its OWN benchmark source
 *    per the design isolation table (SQS queue, Kinesis stream, DynamoDB table +
 *    stream, SNS topic, EventBridge bus, Kafka benchmark topic), never the
 *    production source (Req 9.5, 9.6).
 * 2. **clone (kata) mapping synthesized disabled** — every kata event source
 *    mapping is `Enabled: false` and targets the SnapStart ALIAS, not `$LATEST`
 *    (Req 10.2, 3.3, 7).
 * 3. **baseline pre-existing mapping unchanged (Property 4)** — a baseline
 *    production event source mapping created before provisioning is byte-stable
 *    afterwards; the adapter only creates NEW benchmark-owned resources
 *    (Req 3.2).
 * 4. **`CfnEventSourceMapping.attrId` exposed for the manifest** — the result
 *    surfaces the kata (and, when created, baseline) mapping UUID attribute
 *    tokens (Req 10.3, 10.4).
 *
 * Push-based adapters (SNS, EventBridge) carry no Lambda event source mapping;
 * they create an isolated source + a fresh invoke permission for the clone alias
 * and leave the clone detached by default (Req 3.3, 9.7). Request-response
 * adapters (invoke, apiGateway, functionUrl) create no source.
 *
 * Entitlement is forced via the native licensing module mock — the SAME seam the
 * clone-builder and invoke-path-rewriter tests use — so `kata()` actually
 * transforms the clone and exposes the alias the adapters target.
 *
 * **Validates: Requirements 9.4, 9.5, 9.6, 9.7, 10.1, 10.2, 3.2, 3.3, 3.4**
 *
 * @module benchmark-triggers-adapters.test
 */

import * as path from 'path';
import { App, Stack, Token } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  CfnEventSourceMapping,
  CfnUrl,
  Code,
  Function as LambdaFunction,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';

// Imported after the mock is declared (jest hoists the mock above imports).
import { NativeLicensingService } from '@lambda-kata/licensing';

import { buildKataClone, KataCloneResult } from '../src/benchmark/clone-builder';
import { createDefaultTriggerAdapterRegistry } from '../src/benchmark/triggers/default-registry';
import { InvokeTriggerAdapter } from '../src/benchmark/triggers/invoke';
import { ApiGatewayTriggerAdapter } from '../src/benchmark/triggers/apigw';
import { FunctionUrlTriggerAdapter } from '../src/benchmark/triggers/function-url';
import { SqsTriggerAdapter } from '../src/benchmark/triggers/sqs';
import { KinesisTriggerAdapter } from '../src/benchmark/triggers/kinesis';
import { DynamoDbStreamsTriggerAdapter } from '../src/benchmark/triggers/dynamodb-streams';
import { SnsTriggerAdapter } from '../src/benchmark/triggers/sns';
import { EventBridgeTriggerAdapter } from '../src/benchmark/triggers/eventbridge';
import { KafkaTriggerAdapter } from '../src/benchmark/triggers/kafka';
import type { AdapterSynthContext, TriggerType } from '../src/benchmark/triggers/types';

const TEST_ACCOUNT = '123456789012';
const TEST_REGION = 'us-east-1';
const TEST_LAYER_ARN = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
const TEST_ENV = { account: TEST_ACCOUNT, region: TEST_REGION };
const FIXTURE_ASSET_DIR = path.join(__dirname, 'fixtures');
const BASELINE_HANDLER = 'simple-handler.handler';
const PROD_QUEUE_ARN = `arn:aws:sqs:${TEST_REGION}:${TEST_ACCOUNT}:prod-queue`;
const VARIANT_ID = 'OrdersV';

jest.mock('@lambda-kata/licensing', () => ({
  NativeLicensingService: jest.fn().mockImplementation(() => ({
    checkEntitlementSync: jest.fn(),
  })),
}));

const mockNativeLicensingService = NativeLicensingService as jest.Mock;

/** Configure the mock to report the test account as ENTITLED. */
function mockEntitled(): void {
  mockNativeLicensingService.mockImplementation(() => ({
    checkEntitlementSync: jest.fn().mockReturnValue({
      entitled: true,
      layerVersionArn: TEST_LAYER_ARN,
    }),
  }));
}

beforeEach(() => {
  mockNativeLicensingService.mockClear();
  mockEntitled();
});

/** Create an isolated App + Stack for a single test case. */
function createStack(id: string): Stack {
  return new Stack(new App({ context: { 'aws:cdk:account': TEST_ACCOUNT } }), id, { env: TEST_ENV });
}

/** Create an asset-backed Node.js baseline Lambda. */
function createBaseline(stack: Stack, id: string): LambdaFunction {
  return new LambdaFunction(stack, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: BASELINE_HANDLER,
    code: Code.fromAsset(FIXTURE_ASSET_DIR),
  });
}

/** Build a synth context for a source-creating adapter from a baseline + clone,
 * with the baseline mapping ENABLED so the kata-disabled / baseline-enabled
 * split (Req 10.2) is observable.
 */
function makeContext(
  stack: Stack,
  baseline: LambdaFunction,
  clone: KataCloneResult,
  baselineMappingState: 'enabled' | 'disabled' = 'enabled',
): AdapterSynthContext {
  return {
    scope: stack,
    baselineConstructPath: baseline.node.path,
    variantId: VARIANT_ID,
    kataFunction: clone.cloneFunction,
    baselineFunction: baseline,
    kataAliasArnRef: clone.aliasArnRef as string,
    baselineMappingState,
  };
}

/** Add a baseline PRODUCTION event source mapping (the Property-4 control). */
function addBaselineProdMapping(baseline: LambdaFunction): CfnEventSourceMapping {
  const mapping = baseline.addEventSourceMapping('ProdMapping', { eventSourceArn: PROD_QUEUE_ARN });
  return mapping.node.defaultChild as CfnEventSourceMapping;
}

/** The kata mapping created by a poll-based adapter (deterministic id). */
function kataMappingOf(stack: Stack): CfnEventSourceMapping {
  return stack.node.findChild(`${VARIANT_ID}KataMapping`) as CfnEventSourceMapping;
}

/** The baseline mapping created by a poll-based adapter (deterministic id). */
function baselineMappingOf(stack: Stack): CfnEventSourceMapping {
  return stack.node.findChild(`${VARIANT_ID}BaselineMapping`) as CfnEventSourceMapping;
}

// ---------------------------------------------------------------------------
// Poll-based adapters: SQS, Kinesis, DynamoDB Streams, Kafka.
// ---------------------------------------------------------------------------

describe('SqsTriggerAdapter — isolated queue + disabled kata mapping (Req 9.5, 10.1, 10.2)', () => {
  it('creates an isolated benchmark queue, a disabled kata mapping on the alias, and a per-options baseline mapping', () => {
    const stack = createStack('SqsAdapterStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');
    const prodCfn = addBaselineProdMapping(baseline);
    const prodFnBefore = stack.resolve(prodCfn.functionName);
    const prodEnabledBefore = prodCfn.enabled;

    const result = new SqsTriggerAdapter().provision(
      makeContext(stack, baseline, clone),
      { type: 'sqs', target: baseline.node.path },
    );

    // (1) isolated benchmark source created (never the production queue).
    expect(result.isolated).toBe(true);
    Template.fromStack(stack).resourceCountIs('AWS::SQS::Queue', 1);

    // (2) kata mapping disabled + targets the alias, not $LATEST.
    const kataMapping = kataMappingOf(stack);
    expect(kataMapping.enabled).toBe(false);
    expect(stack.resolve(kataMapping.functionName)).toEqual(stack.resolve(clone.aliasArnRef));

    // baseline mapping enabled per routing options, targeting the baseline.
    const baselineMapping = baselineMappingOf(stack);
    expect(baselineMapping.enabled).toBe(true);
    expect(stack.resolve(baselineMapping.functionName)).toEqual(stack.resolve(baseline.functionArn));

    // (3) Property 4: the baseline's pre-existing production mapping is unchanged.
    expect(stack.resolve(prodCfn.functionName)).toEqual(prodFnBefore);
    expect(prodCfn.enabled).toBe(prodEnabledBefore);

    // (4) attrId exposed for the manifest (kata + baseline UUID tokens).
    expect(result.mappings).toBeDefined();
    expect(stack.resolve(result.mappings?.kataMappingUuid)).toEqual(stack.resolve(kataMapping.attrId));
    expect(stack.resolve(result.mappings?.baselineMappingUuid)).toEqual(
      stack.resolve(baselineMapping.attrId),
    );
    expect(Token.isUnresolved(result.mappings?.kataMappingUuid)).toBe(true);
    expect(result.routingClass).toBe('competing');

    // Total mappings: 1 production + 1 kata + 1 baseline benchmark.
    Template.fromStack(stack).resourceCountIs('AWS::Lambda::EventSourceMapping', 3);
  });

  it('keeps BOTH benchmark mappings disabled by default (observe-only, Req 3.4)', () => {
    const stack = createStack('SqsDefaultDisabledStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');

    new SqsTriggerAdapter().provision(
      makeContext(stack, baseline, clone, 'disabled'),
      { type: 'sqs', target: baseline.node.path },
    );

    expect(kataMappingOf(stack).enabled).toBe(false);
    expect(baselineMappingOf(stack).enabled).toBe(false);
  });
});

describe('KinesisTriggerAdapter — isolated stream + disabled kata mapping (Req 8.4, 9.6, 10.2)', () => {
  it('creates an isolated stream, a disabled kata mapping with a deterministic starting position', () => {
    const stack = createStack('KinesisAdapterStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');
    const prodCfn = addBaselineProdMapping(baseline);
    const prodFnBefore = stack.resolve(prodCfn.functionName);

    const result = new KinesisTriggerAdapter().provision(
      makeContext(stack, baseline, clone),
      { type: 'kinesis', target: baseline.node.path, consumer: 'standard-iterator' },
    );

    expect(result.isolated).toBe(true);
    Template.fromStack(stack).resourceCountIs('AWS::Kinesis::Stream', 1);

    const kataMapping = kataMappingOf(stack);
    expect(kataMapping.enabled).toBe(false);
    expect(kataMapping.startingPosition).toBe('LATEST');
    expect(stack.resolve(kataMapping.functionName)).toEqual(stack.resolve(clone.aliasArnRef));

    expect(stack.resolve(prodCfn.functionName)).toEqual(prodFnBefore);
    expect(stack.resolve(result.mappings?.kataMappingUuid)).toEqual(stack.resolve(kataMapping.attrId));
    expect(result.routingClass).toBe('shared-read');
  });

  it('routes enhanced fan-out as fan-out (Req 8.4)', () => {
    const stack = createStack('KinesisEfoStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');

    const result = new KinesisTriggerAdapter().provision(
      makeContext(stack, baseline, clone),
      { type: 'kinesis', target: baseline.node.path, consumer: 'enhanced-fan-out' },
    );

    expect(result.routingClass).toBe('fan-out');
  });
});

describe('DynamoDbStreamsTriggerAdapter — isolated table + stream (Req 8.5, 9.6, 10.2)', () => {
  it('creates an isolated table WITH a stream and a disabled kata mapping on the stream', () => {
    const stack = createStack('DdbStreamsAdapterStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');
    const prodCfn = addBaselineProdMapping(baseline);
    const prodFnBefore = stack.resolve(prodCfn.functionName);

    const result = new DynamoDbStreamsTriggerAdapter().provision(
      makeContext(stack, baseline, clone),
      { type: 'dynamoDbStreams', target: baseline.node.path },
    );

    expect(result.isolated).toBe(true);
    // Isolated TABLE with a stream — not merely a stream declaration.
    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      StreamSpecification: { StreamViewType: 'NEW_AND_OLD_IMAGES' },
    });

    const kataMapping = kataMappingOf(stack);
    expect(kataMapping.enabled).toBe(false);
    expect(kataMapping.startingPosition).toBe('LATEST');
    expect(stack.resolve(kataMapping.functionName)).toEqual(stack.resolve(clone.aliasArnRef));

    expect(stack.resolve(prodCfn.functionName)).toEqual(prodFnBefore);
    expect(stack.resolve(result.mappings?.kataMappingUuid)).toEqual(stack.resolve(kataMapping.attrId));
    expect(result.routingClass).toBe('shared-read');
  });
});

describe('KafkaTriggerAdapter — existing cluster + benchmark topic (Req 8.3, 9.5, 9.7, 10.2)', () => {
  const clusterArn = `arn:aws:kafka:${TEST_REGION}:${TEST_ACCOUNT}:cluster/prod/abc`;

  it('attaches both variants to the benchmark topic with a shared group (competing, same-group)', () => {
    const stack = createStack('KafkaSameGroupStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');

    const result = new KafkaTriggerAdapter().provision(
      makeContext(stack, baseline, clone),
      { type: 'kafka', target: baseline.node.path, cluster: { arn: clusterArn }, consumerGroupMode: 'same-group' },
    );

    expect(result.routingClass).toBe('competing');
    expect(result.isolated).toBe(true);

    const kataMapping = kataMappingOf(stack);
    expect(kataMapping.enabled).toBe(false);
    expect(stack.resolve(kataMapping.functionName)).toEqual(stack.resolve(clone.aliasArnRef));
    expect(stack.resolve(kataMapping.eventSourceArn)).toBe(clusterArn);
    expect(stack.resolve(result.mappings?.kataMappingUuid)).toEqual(stack.resolve(kataMapping.attrId));

    // Same group: both variants share the SAME consumer group id.
    const kataGroup = stack.resolve(kataMapping.amazonManagedKafkaEventSourceConfig);
    const baselineGroup = stack.resolve(baselineMappingOf(stack).amazonManagedKafkaEventSourceConfig);
    expect(kataGroup).toEqual(baselineGroup);
  });

  it('uses a distinct consumer group per variant (fan-out, distinct-group-per-variant)', () => {
    const stack = createStack('KafkaDistinctGroupStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');

    const result = new KafkaTriggerAdapter().provision(
      makeContext(stack, baseline, clone),
      {
        type: 'kafka',
        target: baseline.node.path,
        cluster: { arn: clusterArn },
        consumerGroupMode: 'distinct-group-per-variant',
      },
    );

    expect(result.routingClass).toBe('fan-out');
    const kataGroup = stack.resolve(kataMappingOf(stack).amazonManagedKafkaEventSourceConfig);
    const baselineGroup = stack.resolve(baselineMappingOf(stack).amazonManagedKafkaEventSourceConfig);
    expect(kataGroup).not.toEqual(baselineGroup);
  });

  it('leaves the clone DETACHED with a recorded reason when no cluster ARN is resolvable (Req 9.7)', () => {
    const stack = createStack('KafkaDetachedStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');

    const result = new KafkaTriggerAdapter().provision(
      makeContext(stack, baseline, clone),
      { type: 'kafka', target: baseline.node.path, consumerGroupMode: 'same-group' },
    );

    expect(result.detached).toBe(true);
    expect(result.detachedReason).toMatch(/cluster ARN/i);
    expect(result.mappings).toBeUndefined();
    // No benchmark mapping was synthesized for the detached clone.
    expect(stack.node.tryFindChild(`${VARIANT_ID}KataMapping`)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Push-based adapters: SNS, EventBridge (no event source mapping).
// ---------------------------------------------------------------------------

describe('SnsTriggerAdapter — isolated topic + detached clone (Req 8.6, 9.6, 3.3)', () => {
  it('creates an isolated topic and a fresh invoke permission for the clone alias, no event source mapping', () => {
    const stack = createStack('SnsAdapterStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');

    const result = new SnsTriggerAdapter().provision(
      makeContext(stack, baseline, clone, 'disabled'),
      { type: 'sns', target: baseline.node.path },
    );

    expect(result.routingClass).toBe('fan-out');
    expect(result.isolated).toBe(true);
    expect(result.mappings).toBeUndefined();

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::SNS::Topic', 1);
    // No event source mapping for a push-based source.
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 0);
    // A fresh invoke permission for the SNS principal targeting the clone alias.
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'sns.amazonaws.com',
    });
  });
});

describe('EventBridgeTriggerAdapter — isolated bus + rule + detached clone (Req 8.6, 9.6, 3.3)', () => {
  it('creates an isolated bus, a scoped benchmark rule, and a fresh invoke permission for the clone alias', () => {
    const stack = createStack('EventBridgeAdapterStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');

    const result = new EventBridgeTriggerAdapter().provision(
      makeContext(stack, baseline, clone, 'disabled'),
      { type: 'eventBridge', target: baseline.node.path },
    );

    expect(result.routingClass).toBe('fan-out');
    expect(result.isolated).toBe(true);
    expect(result.mappings).toBeUndefined();

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::Events::EventBus', 1);
    template.resourceCountIs('AWS::Events::Rule', 1);
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 0);
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'events.amazonaws.com',
    });
  });
});

// ---------------------------------------------------------------------------
// Request-response adapters: invoke, apiGateway, functionUrl (no source).
// ---------------------------------------------------------------------------

describe('Request-response adapters — no benchmark source (Req 8.7, 9.4)', () => {
  it('InvokeTriggerAdapter creates no source and reports request-response', () => {
    const stack = createStack('InvokeAdapterStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');

    const result = new InvokeTriggerAdapter().provision(
      makeContext(stack, baseline, clone),
      { type: 'invoke', target: baseline.node.path },
    );

    expect(result).toEqual({ routingClass: 'request-response', isolated: false });
    Template.fromStack(stack).resourceCountIs('AWS::Lambda::EventSourceMapping', 0);
  });

  it('ApiGatewayTriggerAdapter creates no source and reports request-response', () => {
    const stack = createStack('ApiGwAdapterStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');

    const result = new ApiGatewayTriggerAdapter().provision(
      makeContext(stack, baseline, clone),
      { type: 'apiGateway', target: baseline.node.path },
    );

    expect(result).toEqual({ routingClass: 'request-response', isolated: false });
  });

  it('FunctionUrlTriggerAdapter repoints an existing clone Function URL at the alias qualifier (Req 7.3)', () => {
    const stack = createStack('FunctionUrlAdapterStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');

    const url = clone.cloneFunction.addFunctionUrl();
    const urlCfn = url.node.defaultChild as CfnUrl;
    expect(urlCfn.qualifier).toBeUndefined();

    const result = new FunctionUrlTriggerAdapter().provision(
      makeContext(stack, baseline, clone),
      { type: 'functionUrl', target: baseline.node.path },
    );

    expect(result).toEqual({ routingClass: 'request-response', isolated: false });
    expect(urlCfn.qualifier).toBe('kata');
  });
});

// ---------------------------------------------------------------------------
// Default registry wiring + provisioning precondition.
// ---------------------------------------------------------------------------

describe('createDefaultTriggerAdapterRegistry — one adapter per supported type (Req 9.1, 9.3)', () => {
  const ALL_TYPES: ReadonlyArray<TriggerType> = [
    'invoke',
    'apiGateway',
    'functionUrl',
    'sqs',
    'eventBridge',
    'sns',
    'kinesis',
    'dynamoDbStreams',
    'kafka',
  ];

  it('registers exactly one adapter for every supported trigger type', () => {
    const registry = createDefaultTriggerAdapterRegistry();
    expect(registry.size).toBe(ALL_TYPES.length);
    for (const type of ALL_TYPES) {
      expect(registry.resolve(type).type).toBe(type);
    }
  });

  it('resolves the SQS adapter through the registry and provisions an isolated benchmark queue', () => {
    const stack = createStack('RegistrySqsStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');

    const adapter = createDefaultTriggerAdapterRegistry().resolve('sqs');
    const result = adapter.provision(makeContext(stack, baseline, clone), {
      type: 'sqs',
      target: baseline.node.path,
    });

    expect(result.isolated).toBe(true);
    expect(result.mappings?.kataMappingUuid).toBeDefined();
  });

  it('fails fast when a source-creating adapter is missing the scope precondition', () => {
    const stack = createStack('PreconditionStack');
    const baseline = createBaseline(stack, 'Orders');
    const clone = buildKataClone(stack, 'OrdersClone', baseline.node.defaultChild as never, 'reuse-role');

    // A context WITHOUT a scope (only the Task-7 required field) must throw.
    const incompleteContext: AdapterSynthContext = {
      baselineConstructPath: baseline.node.path,
      kataFunction: clone.cloneFunction,
    };

    expect(() =>
      new SqsTriggerAdapter().provision(incompleteContext, { type: 'sqs', target: baseline.node.path }),
    ).toThrow(/scope/i);
  });
});

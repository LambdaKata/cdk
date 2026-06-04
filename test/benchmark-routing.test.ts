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
 * Table-driven unit tests for the TriggerRouter (Layer C, Requirement 8).
 *
 * The router assigns exactly one {@link RoutingClass} per trigger and exposes
 * the exclusive-vs-parallel {@link ExecutionIntent} for that class. These tests
 * exercise EVERY trigger type and BOTH the Kafka consumer-group modes and BOTH
 * the Kinesis consumer modes against the design routing table
 * (design.md §Trigger_Adapter contract):
 *
 * | Trigger                                   | Routing_Class    | Req  |
 * | ----------------------------------------- | ---------------- | ---- |
 * | SQS                                       | competing        | 8.2  |
 * | Kafka/MSK, same consumer group            | competing        | 8.3  |
 * | Kafka/MSK, distinct group per variant     | fan-out          | 8.3  |
 * | Kinesis, standard iterator                | shared-read      | 8.4  |
 * | Kinesis, enhanced fan-out                 | fan-out          | 8.4  |
 * | DynamoDB Streams                          | shared-read      | 8.5  |
 * | SNS, EventBridge                          | fan-out          | 8.6  |
 * | direct Invoke, API Gateway, Function URL  | request-response | 8.7  |
 *
 * It also pins the execution-intent contract (Req 8.8–8.10): competing is
 * always exclusive (parallel never permitted); fan-out and shared-read default
 * to exclusive and require Side_Effect_Policy_Gate approval before parallel;
 * request-response is parallel-capable without gate approval.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10**
 *
 * @module benchmark-routing.test
 */

import {
  classifyRouting,
  executionIntentFor,
  routeTrigger,
} from '../src/benchmark/routing';
import type { RoutingClass, TriggerDeclaration } from '../src/benchmark/triggers/types';

const TARGET = 'Stack/Service/Handler';

const VALID_ROUTING_CLASSES: ReadonlyArray<RoutingClass> = [
  'competing',
  'fan-out',
  'shared-read',
  'request-response',
];

describe('classifyRouting — request/response sources (Req 8.7)', () => {
  it.each<TriggerDeclaration>([
    { type: 'invoke', target: TARGET },
    { type: 'apiGateway', target: TARGET },
    { type: 'functionUrl', target: TARGET },
  ])('classifies $type as request-response', (declaration) => {
    expect(classifyRouting(declaration)).toBe('request-response');
  });
});

describe('classifyRouting — SQS competing source (Req 8.2)', () => {
  it('classifies sqs as competing', () => {
    expect(classifyRouting({ type: 'sqs', target: TARGET })).toBe('competing');
  });
});

describe('classifyRouting — fan-out sources (Req 8.6)', () => {
  it('classifies sns as fan-out', () => {
    expect(classifyRouting({ type: 'sns', target: TARGET })).toBe('fan-out');
  });

  it('classifies eventBridge as fan-out', () => {
    expect(classifyRouting({ type: 'eventBridge', target: TARGET })).toBe('fan-out');
  });
});

describe('classifyRouting — DynamoDB Streams shared-read source (Req 8.5)', () => {
  it('classifies dynamoDbStreams as shared-read', () => {
    expect(classifyRouting({ type: 'dynamoDbStreams', target: TARGET })).toBe('shared-read');
  });
});

describe('classifyRouting — Kinesis mode branches (Req 8.4)', () => {
  it('classifies a standard-iterator stream as shared-read', () => {
    expect(
      classifyRouting({ type: 'kinesis', target: TARGET, consumer: 'standard-iterator' }),
    ).toBe('shared-read');
  });

  it('classifies an enhanced-fan-out stream as fan-out', () => {
    expect(
      classifyRouting({ type: 'kinesis', target: TARGET, consumer: 'enhanced-fan-out' }),
    ).toBe('fan-out');
  });

  it('defaults an unspecified Kinesis consumer to the standard-iterator shared-read class', () => {
    // Standard iterator is the AWS default; the conservative shared-read class
    // keeps execution exclusive-by-default.
    expect(classifyRouting({ type: 'kinesis', target: TARGET })).toBe('shared-read');
  });
});

describe('classifyRouting — Kafka/MSK mode branches (Req 8.3)', () => {
  it('classifies a same consumer group as competing', () => {
    expect(
      classifyRouting({ type: 'kafka', target: TARGET, consumerGroupMode: 'same-group' }),
    ).toBe('competing');
  });

  it('classifies a distinct group per variant as fan-out', () => {
    expect(
      classifyRouting({
        type: 'kafka',
        target: TARGET,
        consumerGroupMode: 'distinct-group-per-variant',
      }),
    ).toBe('fan-out');
  });

  it('defaults an unspecified Kafka consumer-group mode to the same-group competing class', () => {
    // Same-group (one message → one consumer) is the conservative competing
    // default, keeping execution exclusive-by-default.
    expect(classifyRouting({ type: 'kafka', target: TARGET })).toBe('competing');
  });
});

describe('classifyRouting — exactly-one classification invariant (Property 6, Req 8.1)', () => {
  it('always returns exactly one of the four valid routing classes', () => {
    const declarations: ReadonlyArray<TriggerDeclaration> = [
      { type: 'invoke', target: TARGET },
      { type: 'apiGateway', target: TARGET },
      { type: 'functionUrl', target: TARGET },
      { type: 'sqs', target: TARGET },
      { type: 'sns', target: TARGET },
      { type: 'eventBridge', target: TARGET },
      { type: 'dynamoDbStreams', target: TARGET },
      { type: 'kinesis', target: TARGET, consumer: 'standard-iterator' },
      { type: 'kinesis', target: TARGET, consumer: 'enhanced-fan-out' },
      { type: 'kafka', target: TARGET, consumerGroupMode: 'same-group' },
      { type: 'kafka', target: TARGET, consumerGroupMode: 'distinct-group-per-variant' },
    ];

    for (const declaration of declarations) {
      const routingClass = classifyRouting(declaration);
      expect(VALID_ROUTING_CLASSES).toContain(routingClass);
      expect(VALID_ROUTING_CLASSES.filter((c) => c === routingClass)).toHaveLength(1);
    }
  });
});

describe('executionIntentFor — exclusive-vs-parallel intent (Req 8.8, 8.9, 8.10)', () => {
  it('competing is exclusive and never permits parallel execution (Req 8.8)', () => {
    const intent = executionIntentFor('competing');
    expect(intent).toEqual({
      routingClass: 'competing',
      defaultMode: 'exclusive',
      parallelPermitted: false,
      parallelRequiresGateApproval: false,
    });
  });

  it('fan-out defaults to exclusive and requires gate approval for parallel (Req 8.9)', () => {
    const intent = executionIntentFor('fan-out');
    expect(intent).toEqual({
      routingClass: 'fan-out',
      defaultMode: 'exclusive',
      parallelPermitted: true,
      parallelRequiresGateApproval: true,
    });
  });

  it('shared-read defaults to exclusive and requires gate approval for parallel (Req 8.10)', () => {
    const intent = executionIntentFor('shared-read');
    expect(intent).toEqual({
      routingClass: 'shared-read',
      defaultMode: 'exclusive',
      parallelPermitted: true,
      parallelRequiresGateApproval: true,
    });
  });

  it('request-response is parallel-capable without gate approval (Req 8.7)', () => {
    const intent = executionIntentFor('request-response');
    expect(intent).toEqual({
      routingClass: 'request-response',
      defaultMode: 'parallel',
      parallelPermitted: true,
      parallelRequiresGateApproval: false,
    });
  });
});

describe('routeTrigger — combined classification + intent', () => {
  it('pairs each declaration with the intent of its routing class', () => {
    const routed = routeTrigger({
      type: 'kafka',
      target: TARGET,
      consumerGroupMode: 'distinct-group-per-variant',
    });

    expect(routed.routingClass).toBe('fan-out');
    expect(routed.intent).toEqual(executionIntentFor('fan-out'));
  });

  it('keeps a competing SQS trigger exclusive end-to-end', () => {
    const routed = routeTrigger({ type: 'sqs', target: TARGET });

    expect(routed.routingClass).toBe('competing');
    expect(routed.intent.defaultMode).toBe('exclusive');
    expect(routed.intent.parallelPermitted).toBe(false);
  });
});

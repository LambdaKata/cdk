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
 * Property-Based Test for the TriggerRouter — Property 6.
 *
 * Property 6 (Exactly-one classification): for EVERY declared trigger, the
 * router assigns exactly one {@link RoutingClass} of `competing`, `fan-out`,
 * `shared-read`, or `request-response`, and the {@link ExecutionIntent} it
 * exposes for that class is internally consistent with the exclusive-vs-parallel
 * contract (Req 8.8–8.10): an `exclusive` default with `parallelPermitted=false`
 * never requires gate approval, and every gate-gated class permits parallel
 * only behind approval.
 *
 * The generator spans the full trigger input space — every discriminant, both
 * Kafka consumer-group modes (including unspecified), and both Kinesis consumer
 * modes (including unspecified) — so the invariant is proven across the space
 * rather than for the hand-picked unit examples.
 *
 * **Validates: Requirements 8.1**
 *
 * @module benchmark-routing.property.test
 */

import * as fc from 'fast-check';

import { classifyRouting, executionIntentFor, routeTrigger } from '../src/benchmark/routing';
import type {
  KafkaTrigger,
  KinesisTrigger,
  RoutingClass,
  TriggerDeclaration,
} from '../src/benchmark/triggers/types';

const TARGET = 'Stack/Service/Handler';

/** The Kinesis consumer-mode literal union, derived from its declaration. */
type KinesisConsumer = NonNullable<KinesisTrigger['consumer']>;
/** The Kafka consumer-group-mode literal union, derived from its declaration. */
type KafkaGroupMode = NonNullable<KafkaTrigger['consumerGroupMode']>;

const VALID_ROUTING_CLASSES: ReadonlyArray<RoutingClass> = [
  'competing',
  'fan-out',
  'shared-read',
  'request-response',
];

/**
 * Generates the full space of trigger declarations, deliberately covering the
 * `undefined` mode branches for Kafka and Kinesis as well as the explicit ones.
 */
const triggerDeclarationArb: fc.Arbitrary<TriggerDeclaration> = fc.oneof(
  fc.constant<TriggerDeclaration>({ type: 'invoke', target: TARGET }),
  fc.constant<TriggerDeclaration>({ type: 'apiGateway', target: TARGET }),
  fc.constant<TriggerDeclaration>({ type: 'functionUrl', target: TARGET }),
  fc.constant<TriggerDeclaration>({ type: 'sqs', target: TARGET }),
  fc.constant<TriggerDeclaration>({ type: 'sns', target: TARGET }),
  fc.constant<TriggerDeclaration>({ type: 'eventBridge', target: TARGET }),
  fc.constant<TriggerDeclaration>({ type: 'dynamoDbStreams', target: TARGET }),
  fc
    .option(
      fc.constantFrom<KinesisConsumer>('standard-iterator', 'enhanced-fan-out'),
      { nil: undefined },
    )
    .map<TriggerDeclaration>((consumer) => ({ type: 'kinesis', target: TARGET, consumer })),
  fc
    .option(
      fc.constantFrom<KafkaGroupMode>('same-group', 'distinct-group-per-variant'),
      { nil: undefined },
    )
    .map<TriggerDeclaration>((consumerGroupMode) => ({
      type: 'kafka',
      target: TARGET,
      consumerGroupMode,
    })),
);

describe('TriggerRouter — Property 6 (exactly-one classification)', () => {
  /**
   * **Validates: Requirements 8.1**
   *
   * For any declared trigger, the result is always exactly one of the four
   * valid routing classes.
   */
  it('always assigns exactly one valid RoutingClass', () => {
    fc.assert(
      fc.property(triggerDeclarationArb, (declaration) => {
        const routingClass = classifyRouting(declaration);
        return VALID_ROUTING_CLASSES.filter((c) => c === routingClass).length === 1;
      }),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 8.1, 8.8, 8.9, 8.10**
   *
   * The exposed execution intent is internally consistent: an exclusive default
   * that forbids parallel cannot require gate approval; any class that permits
   * parallel from an exclusive default must require gate approval; a parallel
   * default never needs gate approval.
   */
  it('exposes an execution intent consistent with the exclusive-vs-parallel contract', () => {
    fc.assert(
      fc.property(triggerDeclarationArb, (declaration) => {
        const routed = routeTrigger(declaration);
        const intent = routed.intent;

        // routeTrigger and the standalone helpers agree.
        const classMatches = routed.routingClass === classifyRouting(declaration);
        const intentMatches =
          JSON.stringify(intent) === JSON.stringify(executionIntentFor(routed.routingClass));

        const consistent =
          intent.defaultMode === 'parallel'
            ? intent.parallelPermitted && !intent.parallelRequiresGateApproval
            : // exclusive default
            intent.parallelPermitted
              ? intent.parallelRequiresGateApproval
              : !intent.parallelRequiresGateApproval;

        return classMatches && intentMatches && consistent;
      }),
      { numRuns: 300 },
    );
  });
});

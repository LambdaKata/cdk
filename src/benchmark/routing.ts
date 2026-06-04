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
 * Layer C — TriggerRouter (Req 8).
 *
 * Assigns exactly one {@link RoutingClass} to each declared trigger and exposes,
 * per class, whether its variants run exclusively (one at a time) or in parallel
 * — and, when parallel, whether the Side_Effect_Policy_Gate must approve first.
 *
 * This module is **pure, synth-time logic**: it consumes the trigger
 * discriminated union from {@link module:benchmark/triggers/types} and has no
 * `aws-cdk-lib` runtime dependency. It deliberately performs classification and
 * intent *declaration* only — it never invokes the side-effect gate itself.
 * Gate evaluation is owned by {@link module:benchmark/side-effect-gate} (task 9),
 * keeping the separation of concerns clean: the router states *what* a class
 * permits in principle; the gate decides *whether* a concrete run may proceed.
 *
 * Routing table (design.md §Trigger_Adapter contract), assigned with
 * exactly-one classification (Property 6, Req 8.1):
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
 * Execution-intent contract per class (Req 8.8–8.10):
 *
 * | Routing_Class    | defaultMode | parallelPermitted | parallelRequiresGateApproval | Req  |
 * | ---------------- | ----------- | ----------------- | ---------------------------- | ---- |
 * | competing        | exclusive   | false             | false                        | 8.8  |
 * | fan-out          | exclusive   | true              | true                         | 8.9  |
 * | shared-read      | exclusive   | true              | true                         | 8.10 |
 * | request-response | parallel    | true              | false                        | 8.7  |
 *
 * @remarks
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10
 *
 * @module benchmark/routing
 */

import type { RoutingClass, TriggerDeclaration } from './triggers/types';

/**
 * How a trigger's two variants execute by default within a benchmark window.
 *
 * - `exclusive` — only one variant is active per window (the other is held
 *   disabled); Competing_Sources use this with run-time ABBA sequencing, and
 *   Fan_Out / Shared_Read sources fall back to it until the gate approves
 *   parallel execution.
 * - `parallel` — both variants are exercised within the same window without
 *   contending for the same messages.
 */
export type ExecutionMode = 'exclusive' | 'parallel';

/**
 * The exclusive-vs-parallel execution contract a {@link RoutingClass} declares
 * (Req 8.8–8.10).
 *
 * This is an explicit, documented mapping rather than scattered booleans so the
 * router's intent is readable at a glance and consumable by the runner and the
 * side-effect gate without re-deriving it.
 */
export interface ExecutionIntent {
  /** The routing class this intent describes. */
  readonly routingClass: RoutingClass;
  /** The default execution mode for the class (Req 8.8, 8.10). */
  readonly defaultMode: ExecutionMode;
  /**
   * Whether parallel execution of both variants is permissible in principle for
   * this class. `false` for Competing_Sources, where each message is delivered
   * to exactly one consumer and parallel variants would steal each other's
   * messages (Req 8.8).
   */
  readonly parallelPermitted: boolean;
  /**
   * Whether reaching the parallel mode requires explicit
   * Side_Effect_Policy_Gate approval (Req 8.9, 8.10). The router only declares
   * this requirement; the gate (task 9) enforces it. Always `false` when
   * {@link parallelPermitted} is `false`, and `false` for request-response,
   * whose discrete requests each target a specific variant and so never share
   * side effects across variants.
   */
  readonly parallelRequiresGateApproval: boolean;
}

/**
 * The combined result of routing a trigger: its {@link RoutingClass} and the
 * {@link ExecutionIntent} that class implies.
 */
export interface RoutedTrigger {
  /** The declaration that was routed. */
  readonly declaration: TriggerDeclaration;
  /** The single routing class assigned to the declaration (Req 8.1). */
  readonly routingClass: RoutingClass;
  /** The exclusive-vs-parallel intent for {@link routingClass}. */
  readonly intent: ExecutionIntent;
}

/**
 * The execution-intent table, keyed by {@link RoutingClass} (Req 8.7–8.10).
 *
 * Declared `const` and frozen via `as const` so the contract is a single source
 * of truth that cannot drift at runtime. {@link executionIntentFor} returns
 * these entries directly.
 */
const EXECUTION_INTENT: { readonly [K in RoutingClass]: ExecutionIntent } = {
  // Competing: each message goes to exactly one consumer; variants must never
  // run in parallel or they would steal one another's messages (Req 8.8).
  competing: {
    routingClass: 'competing',
    defaultMode: 'exclusive',
    parallelPermitted: false,
    parallelRequiresGateApproval: false,
  },
  // Fan-out: every subscriber gets its own copy, so parallel is possible — but
  // only after the side-effect gate approves duplicate side effects (Req 8.9).
  'fan-out': {
    routingClass: 'fan-out',
    defaultMode: 'exclusive',
    parallelPermitted: true,
    parallelRequiresGateApproval: true,
  },
  // Shared-read: multiple readers of the same records; exclusive by default,
  // parallel only after gate approval (Req 8.10).
  'shared-read': {
    routingClass: 'shared-read',
    defaultMode: 'exclusive',
    parallelPermitted: true,
    parallelRequiresGateApproval: true,
  },
  // Request-response: discrete requests each target a specific variant, so the
  // variants can be exercised in parallel without sharing side effects and
  // without gate approval (Req 8.7).
  'request-response': {
    routingClass: 'request-response',
    defaultMode: 'parallel',
    parallelPermitted: true,
    parallelRequiresGateApproval: false,
  },
} as const;

/**
 * Assign the {@link RoutingClass} for a declared trigger (Req 8.1).
 *
 * The mapping is exhaustive over the trigger discriminated union. The `default`
 * branch performs a TypeScript exhaustiveness check via the `never` type, so
 * adding a new trigger discriminant without a routing rule here is a
 * compile-time error rather than a silent runtime fall-through.
 *
 * @param declaration - The trigger declaration to classify.
 * @returns Exactly one of `competing`, `fan-out`, `shared-read`, or
 *   `request-response`.
 */
export function classifyRouting(declaration: TriggerDeclaration): RoutingClass {
  switch (declaration.type) {
    case 'invoke':
    case 'apiGateway':
    case 'functionUrl':
      // Synchronous, discrete-request triggers (Req 8.7).
      return 'request-response';

    case 'sqs':
      // Each message is delivered to exactly one consumer (Req 8.2).
      return 'competing';

    case 'sns':
    case 'eventBridge':
      // Each subscriber receives its own copy of the event (Req 8.6).
      return 'fan-out';

    case 'dynamoDbStreams':
      // Stream read by multiple consumers sharing read throughput (Req 8.5).
      return 'shared-read';

    case 'kinesis':
      // Enhanced fan-out gives each consumer a dedicated pipe (fan-out);
      // the standard iterator shares read throughput (shared-read). An
      // unspecified consumer defaults to the AWS standard iterator, the
      // conservative exclusive-by-default class (Req 8.4).
      return declaration.consumer === 'enhanced-fan-out' ? 'fan-out' : 'shared-read';

    case 'kafka':
      // A distinct consumer group per variant makes each variant an independent
      // subscriber (fan-out); a single shared group makes them compete for
      // partitions (competing). An unspecified mode defaults to the
      // conservative same-group competing class (Req 8.3).
      return declaration.consumerGroupMode === 'distinct-group-per-variant'
        ? 'fan-out'
        : 'competing';

    default:
      return assertExhaustive(declaration);
  }
}

/**
 * Return the {@link ExecutionIntent} for a routing class (Req 8.8–8.10).
 *
 * @param routingClass - The routing class to describe.
 * @returns The exclusive-vs-parallel intent for the class.
 */
export function executionIntentFor(routingClass: RoutingClass): ExecutionIntent {
  return EXECUTION_INTENT[routingClass];
}

/**
 * Route a trigger end-to-end: classify it and pair it with its execution intent.
 *
 * This is the convenience entry point for callers (e.g. the orchestrator and
 * the manifest accumulator) that need both the class and its intent in one step.
 *
 * @param declaration - The trigger declaration to route.
 * @returns The declaration, its {@link RoutingClass}, and the class's
 *   {@link ExecutionIntent}.
 */
export function routeTrigger(declaration: TriggerDeclaration): RoutedTrigger {
  const routingClass = classifyRouting(declaration);
  return {
    declaration,
    routingClass,
    intent: executionIntentFor(routingClass),
  };
}

/**
 * Compile-time exhaustiveness guard for the trigger discriminated union.
 *
 * If a new {@link TriggerDeclaration} variant is added without a corresponding
 * branch in {@link classifyRouting}, `value` will no longer be `never` and this
 * call fails to type-check — surfacing the missing routing rule at build time.
 *
 * @param value - The unhandled declaration, expected to be `never`.
 * @throws Always, as a defensive runtime guard for the unreachable branch.
 */
function assertExhaustive(value: never): never {
  throw new Error(
    `Unhandled trigger declaration in TriggerRouter: ${JSON.stringify(value)}. ` +
    'Every TriggerDeclaration variant must have a routing rule (Req 8.1).',
  );
}

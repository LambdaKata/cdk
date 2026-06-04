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
 * Compile-time (type-level) tests for the trigger discriminated union and the
 * synth-time Trigger_Adapter contract (Layer C, Requirement 9.1, 9.2, 9.3).
 *
 * These assertions are validated by the TypeScript compiler: `yarn build`
 * (`tsc`) and the ts-jest transform both type-check this file, so a regression
 * in the union shape, its discriminants, or the adapter contract fails the
 * build rather than slipping through. The runtime `describe`/`it` block exists
 * only so jest reports the file as an executed, passing test once it compiles.
 *
 * What is proven at compile time:
 *
 * 1. `TriggerType` is EXACTLY the set of `type` discriminants of every member
 *    of `TriggerDeclaration` — no missing, no extra discriminant (Req 9.2).
 * 2. Switching on the `type` discriminant narrows `TriggerDeclaration` to the
 *    precise member interface for each arm, and the union is exhaustive — a new
 *    member added without an arm is a compile error via `assertNever` (Req 9.1).
 * 3. The `TriggerAdapter<T>` contract exposes `type`, `routingClass`, and
 *    `provision` with the documented shapes (Req 9.3).
 *
 * **Validates: Requirements 9.1, 9.2, 9.3**
 *
 * @module benchmark-trigger-types.test
 */

import type {
  AdapterProvisionResult,
  AdapterSynthContext,
  ApiGatewayTrigger,
  DynamoDbStreamsTrigger,
  EventBridgeTrigger,
  FunctionUrlTrigger,
  InvokeTrigger,
  KafkaTrigger,
  KinesisTrigger,
  RoutingClass,
  SnsTrigger,
  SqsTrigger,
  TriggerAdapter,
  TriggerDeclaration,
  TriggerType,
} from '../src/benchmark/triggers/types';

// ---------------------------------------------------------------------------
// Type-level assertion helpers (compile-time only; zero runtime footprint).
// ---------------------------------------------------------------------------

/** Structural type-equality check: `true` only when `A` and `B` are identical. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/** Compile-time assertion that a type resolves to the literal `true`. */
type Expect<T extends true> = T;

/**
 * Runtime exhaustiveness guard mirrored from the production modules: if a new
 * {@link TriggerDeclaration} member is added without a handling arm below, the
 * argument is no longer `never` and this call fails to type-check.
 */
function assertNever(value: never): never {
  throw new Error(`Unhandled trigger declaration: ${JSON.stringify(value)}.`);
}

// ---------------------------------------------------------------------------
// 1. TriggerType is exactly the union of member discriminants (Req 9.2).
// ---------------------------------------------------------------------------

type ExpectedTriggerType =
  | 'invoke'
  | 'apiGateway'
  | 'functionUrl'
  | 'sqs'
  | 'eventBridge'
  | 'sns'
  | 'kinesis'
  | 'dynamoDbStreams'
  | 'kafka';

type _TriggerTypeMatchesDiscriminants = Expect<Equal<TriggerType, ExpectedTriggerType>>;
type _TriggerTypeIsUnionDiscriminant = Expect<Equal<TriggerType, TriggerDeclaration['type']>>;

// ---------------------------------------------------------------------------
// 2. The `type` discriminant narrows the union to the precise member, and the
//    union is exhaustive (Req 9.1).
// ---------------------------------------------------------------------------

/**
 * Map a declaration to its narrowed member type via the discriminant. Each arm
 * returns the input typed as the specific member; the assignments below confirm
 * the narrowing is exact, and the `default` arm proves exhaustiveness.
 */
function narrowByDiscriminant(declaration: TriggerDeclaration): RoutingClass {
  switch (declaration.type) {
    case 'invoke': {
      const narrowed: InvokeTrigger = declaration;
      type _NarrowsToInvoke = Expect<Equal<typeof narrowed, InvokeTrigger>>;
      return 'request-response';
    }
    case 'apiGateway': {
      const narrowed: ApiGatewayTrigger = declaration;
      type _NarrowsToApiGateway = Expect<Equal<typeof narrowed, ApiGatewayTrigger>>;
      return 'request-response';
    }
    case 'functionUrl': {
      const narrowed: FunctionUrlTrigger = declaration;
      type _NarrowsToFunctionUrl = Expect<Equal<typeof narrowed, FunctionUrlTrigger>>;
      return 'request-response';
    }
    case 'sqs': {
      const narrowed: SqsTrigger = declaration;
      type _NarrowsToSqs = Expect<Equal<typeof narrowed, SqsTrigger>>;
      return 'competing';
    }
    case 'eventBridge': {
      const narrowed: EventBridgeTrigger = declaration;
      type _NarrowsToEventBridge = Expect<Equal<typeof narrowed, EventBridgeTrigger>>;
      return 'fan-out';
    }
    case 'sns': {
      const narrowed: SnsTrigger = declaration;
      type _NarrowsToSns = Expect<Equal<typeof narrowed, SnsTrigger>>;
      return 'fan-out';
    }
    case 'kinesis': {
      const narrowed: KinesisTrigger = declaration;
      type _NarrowsToKinesis = Expect<Equal<typeof narrowed, KinesisTrigger>>;
      return narrowed.consumer === 'enhanced-fan-out' ? 'fan-out' : 'shared-read';
    }
    case 'dynamoDbStreams': {
      const narrowed: DynamoDbStreamsTrigger = declaration;
      type _NarrowsToDynamoDbStreams = Expect<Equal<typeof narrowed, DynamoDbStreamsTrigger>>;
      return 'shared-read';
    }
    case 'kafka': {
      const narrowed: KafkaTrigger = declaration;
      type _NarrowsToKafka = Expect<Equal<typeof narrowed, KafkaTrigger>>;
      return narrowed.consumerGroupMode === 'distinct-group-per-variant' ? 'fan-out' : 'competing';
    }
    default:
      // Exhaustiveness: `declaration` is `never` here only if every member is
      // handled above. Adding a new union member without an arm is a compile
      // error (Req 9.1).
      return assertNever(declaration);
  }
}

// ---------------------------------------------------------------------------
// 3. The TriggerAdapter<T> contract shape (Req 9.3).
// ---------------------------------------------------------------------------

type _AdapterTypeIsDiscriminant = Expect<Equal<TriggerAdapter<SqsTrigger>['type'], 'sqs'>>;
type _AdapterRoutingClassReturn = Expect<
  Equal<ReturnType<TriggerAdapter<SqsTrigger>['routingClass']>, RoutingClass>
>;
type _AdapterProvisionReturn = Expect<
  Equal<ReturnType<TriggerAdapter<SqsTrigger>['provision']>, AdapterProvisionResult>
>;

/** A minimal adapter literal must structurally satisfy the contract (Req 9.3). */
const sqsAdapterShape: TriggerAdapter<SqsTrigger> = {
  type: 'sqs',
  routingClass: (): RoutingClass => 'competing',
  provision: (_context: AdapterSynthContext, _declaration: SqsTrigger): AdapterProvisionResult => ({
    routingClass: 'competing',
    isolated: true,
  }),
};

// ---------------------------------------------------------------------------
// Runtime shim so jest registers the compile-time suite as executed/passing.
// The real assertions above are enforced by `tsc`; these merely exercise the
// helper functions so the file is not dead code at runtime.
// ---------------------------------------------------------------------------

describe('trigger types — compile-time contract (Req 9.1, 9.2, 9.3)', () => {
  it('narrows every discriminant to its routing class', () => {
    expect(narrowByDiscriminant({ type: 'invoke', target: 'Stack/Fn' })).toBe('request-response');
    expect(narrowByDiscriminant({ type: 'sqs', target: 'Stack/Fn' })).toBe('competing');
    expect(narrowByDiscriminant({ type: 'sns', target: 'Stack/Fn' })).toBe('fan-out');
    expect(
      narrowByDiscriminant({ type: 'kinesis', target: 'Stack/Fn', consumer: 'enhanced-fan-out' }),
    ).toBe('fan-out');
    expect(
      narrowByDiscriminant({ type: 'kafka', target: 'Stack/Fn', consumerGroupMode: 'same-group' }),
    ).toBe('competing');
  });

  it('exposes a structurally valid TriggerAdapter contract', () => {
    expect(sqsAdapterShape.type).toBe('sqs');
    expect(sqsAdapterShape.routingClass({ type: 'sqs', target: 'Stack/Fn' })).toBe('competing');
    expect(
      sqsAdapterShape.provision({ baselineConstructPath: 'Stack/Fn' }, { type: 'sqs', target: 'Stack/Fn' }),
    ).toEqual({ routingClass: 'competing', isolated: true });
  });
});

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
 * Unit tests for the TriggerAdapter registry (Layer C, Requirement 9.3).
 *
 * These tests pin the design invariant — "an adapter registry resolves exactly
 * one adapter per `type`" — and the registry's documented contract decisions:
 *
 * - registering one adapter per supported trigger type yields a registry whose
 *   `resolve(type)` returns the correct adapter for each type;
 * - registering two adapters with the same `type` throws a
 *   `TriggerAdapterRegistryError` (DUPLICATE_ADAPTER);
 * - resolving an unregistered type throws a `TriggerAdapterRegistryError`
 *   (UNKNOWN_TRIGGER_TYPE), while `tryResolve` returns `undefined`.
 *
 * **Validates: Requirements 9.1, 9.2, 9.3**
 *
 * @module benchmark-trigger-adapter-registry.test
 */

import {
  TriggerAdapterRegistry,
  TriggerAdapterRegistryError,
  TriggerAdapterRegistryErrorCode,
} from '../src/benchmark/triggers/registry';
import type {
  AdapterProvisionResult,
  AdapterSynthContext,
  RoutingClass,
  TriggerAdapter,
  TriggerDeclaration,
  TriggerType,
} from '../src/benchmark/triggers/types';

/** Every supported trigger discriminant, per design.md §Trigger_Adapter contract. */
const ALL_TRIGGER_TYPES: ReadonlyArray<TriggerType> = [
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

/** The routing class each discriminant resolves to, used as a per-adapter fingerprint. */
const ROUTING_BY_TYPE: { readonly [K in TriggerType]: RoutingClass } = {
  invoke: 'request-response',
  apiGateway: 'request-response',
  functionUrl: 'request-response',
  sqs: 'competing',
  eventBridge: 'fan-out',
  sns: 'fan-out',
  kinesis: 'shared-read',
  dynamoDbStreams: 'shared-read',
  kafka: 'competing',
};

/**
 * Build a minimal, deterministic stub adapter for a trigger discriminant. The
 * stub reports the design routing class for its type so each adapter instance
 * is distinguishable on resolution.
 */
function makeAdapter(type: TriggerType): TriggerAdapter {
  const routingClass = ROUTING_BY_TYPE[type];
  return {
    type,
    routingClass: (): RoutingClass => routingClass,
    provision: (_context: AdapterSynthContext, _declaration: TriggerDeclaration): AdapterProvisionResult => ({
      routingClass,
      isolated: true,
    }),
  };
}

/** A representative declaration for a given trigger type. */
function declarationFor(type: TriggerType): TriggerDeclaration {
  return { type, target: 'Stack/Service/Handler' } as TriggerDeclaration;
}

describe('TriggerAdapterRegistry — one adapter per supported type (Req 9.3)', () => {
  it('resolves exactly one adapter per supported trigger type', () => {
    const adapters = ALL_TRIGGER_TYPES.map(makeAdapter);
    const registry = new TriggerAdapterRegistry(adapters);

    expect(registry.size).toBe(ALL_TRIGGER_TYPES.length);
    expect([...registry.registeredTypes].sort()).toEqual([...ALL_TRIGGER_TYPES].sort());

    for (const type of ALL_TRIGGER_TYPES) {
      const resolved = registry.resolve(type);
      expect(resolved.type).toBe(type);
      // The resolved adapter is the exact instance registered for this type.
      expect(resolved).toBe(adapters.find((adapter) => adapter.type === type));
      // And it behaves as that type's adapter (per-type fingerprint).
      expect(resolved.routingClass(declarationFor(type))).toBe(ROUTING_BY_TYPE[type]);
    }
  });

  it('reports presence via has() and tryResolve() for registered types', () => {
    const registry = new TriggerAdapterRegistry([makeAdapter('sqs')]);

    expect(registry.has('sqs')).toBe(true);
    expect(registry.tryResolve('sqs')?.type).toBe('sqs');
  });

  it('supports fluent incremental registration', () => {
    const registry = new TriggerAdapterRegistry();
    const result = registry.register(makeAdapter('sns')).register(makeAdapter('kinesis'));

    expect(result).toBe(registry);
    expect(registry.size).toBe(2);
    expect(registry.resolve('sns').type).toBe('sns');
    expect(registry.resolve('kinesis').type).toBe('kinesis');
  });
});

describe('TriggerAdapterRegistry — duplicate registration is rejected (Req 9.3)', () => {
  it('throws DUPLICATE_ADAPTER when two adapters share the same type via the constructor', () => {
    const seed = [makeAdapter('sqs'), makeAdapter('sqs')];

    expect(() => new TriggerAdapterRegistry(seed)).toThrow(TriggerAdapterRegistryError);

    try {
      // eslint-disable-next-line no-new
      new TriggerAdapterRegistry(seed);
      throw new Error('expected constructor to throw on duplicate adapter');
    } catch (error) {
      expect(error).toBeInstanceOf(TriggerAdapterRegistryError);
      const registryError = error as TriggerAdapterRegistryError;
      expect(registryError.code).toBe(TriggerAdapterRegistryErrorCode.DUPLICATE_ADAPTER);
      expect(registryError.triggerType).toBe('sqs');
    }
  });

  it('throws DUPLICATE_ADAPTER when register() is called twice for the same type', () => {
    const registry = new TriggerAdapterRegistry([makeAdapter('kafka')]);

    expect(() => registry.register(makeAdapter('kafka'))).toThrow(TriggerAdapterRegistryError);
    // The first adapter remains the single resolution for the type.
    expect(registry.size).toBe(1);
    expect(registry.resolve('kafka').type).toBe('kafka');
  });
});

describe('TriggerAdapterRegistry — unknown-type lookups (Req 9.3)', () => {
  it('resolve() throws UNKNOWN_TRIGGER_TYPE for an unregistered type', () => {
    const registry = new TriggerAdapterRegistry([makeAdapter('sqs')]);

    expect(() => registry.resolve('kinesis')).toThrow(TriggerAdapterRegistryError);

    try {
      registry.resolve('kinesis');
      throw new Error('expected resolve() to throw on unknown type');
    } catch (error) {
      expect(error).toBeInstanceOf(TriggerAdapterRegistryError);
      const registryError = error as TriggerAdapterRegistryError;
      expect(registryError.code).toBe(TriggerAdapterRegistryErrorCode.UNKNOWN_TRIGGER_TYPE);
      expect(registryError.triggerType).toBe('kinesis');
    }
  });

  it('tryResolve() returns undefined and has() returns false for an unregistered type', () => {
    const registry = new TriggerAdapterRegistry([makeAdapter('sqs')]);

    expect(registry.tryResolve('eventBridge')).toBeUndefined();
    expect(registry.has('eventBridge')).toBe(false);
  });
});

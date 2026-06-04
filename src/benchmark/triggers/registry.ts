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
 * Layer C — the TriggerAdapter registry (Req 9.1, 9.2, 9.3).
 *
 * The harness provides one typed {@link TriggerAdapter} per supported trigger
 * type (invoke, apiGateway, functionUrl, sqs, eventBridge, sns, kinesis,
 * dynamoDbStreams, kafka). This registry is the single resolution authority
 * that enforces the design invariant:
 *
 * > an adapter registry resolves exactly one adapter per `type`.
 *
 * Concretely the registry maintains a one-to-one map from {@link TriggerType}
 * discriminant to adapter instance. It is intentionally a small, explicit class
 * with a clear responsibility (registration + lookup) so the adapter wiring in
 * task 10 has a maintainable, testable seam rather than an ad-hoc object map.
 *
 * Contract decisions (documented and tested):
 *
 * - **Duplicate registration** of an adapter for an already-registered `type`
 *   is rejected with a {@link TriggerAdapterRegistryError} carrying
 *   {@link TriggerAdapterRegistryErrorCode.DUPLICATE_ADAPTER}. This guarantees
 *   the "exactly one adapter per type" invariant at registration time rather
 *   than silently overwriting an earlier adapter.
 * - **Lookup of an unregistered `type`** via {@link TriggerAdapterRegistry.resolve}
 *   throws a {@link TriggerAdapterRegistryError} carrying
 *   {@link TriggerAdapterRegistryErrorCode.UNKNOWN_TRIGGER_TYPE}. Callers that
 *   prefer a presence check without exceptions use
 *   {@link TriggerAdapterRegistry.tryResolve}, which returns `undefined`.
 *
 * This module is pure, synth-time logic with no `aws-cdk-lib` runtime
 * dependency; it operates only on the type contracts from
 * {@link module:benchmark/triggers/types}.
 *
 * @remarks
 * Validates: Requirements 9.1, 9.2, 9.3
 *
 * @module benchmark/triggers/registry
 */

import type { TriggerAdapter, TriggerDeclaration, TriggerType } from './types';

/**
 * The {@link TriggerAdapter} instance type that handles a specific
 * {@link TriggerType} discriminant `K` — i.e. the adapter parameterised by the
 * single union member whose `type` is `K`.
 *
 * @typeParam K - A trigger discriminant from {@link TriggerType}.
 */
export type TriggerAdapterFor<K extends TriggerType> = TriggerAdapter<
  Extract<TriggerDeclaration, { type: K }>
>;

/**
 * Structured error codes for {@link TriggerAdapterRegistryError}, mirroring the
 * `ErrorCodes` convention used elsewhere in the library (AGENTS.md §5). Codes
 * allow programmatic handling without string matching on messages.
 */
export enum TriggerAdapterRegistryErrorCode {
  /** An adapter was registered for a `type` that is already registered. */
  DUPLICATE_ADAPTER = 'DUPLICATE_ADAPTER',
  /** A lookup requested a `type` that has no registered adapter. */
  UNKNOWN_TRIGGER_TYPE = 'UNKNOWN_TRIGGER_TYPE',
}

/**
 * Error raised by {@link TriggerAdapterRegistry} for duplicate registrations
 * and unknown-type lookups.
 *
 * Carries a structured {@link TriggerAdapterRegistryErrorCode} and the offending
 * {@link TriggerType} so callers can branch on the failure mode without parsing
 * the human-readable message.
 */
export class TriggerAdapterRegistryError extends Error {
  /**
   * @param message - Human-readable description of the failure.
   * @param code - Structured classification of the failure.
   * @param triggerType - The trigger discriminant the failure relates to.
   */
  public constructor(
    message: string,
    public readonly code: TriggerAdapterRegistryErrorCode,
    public readonly triggerType: TriggerType,
  ) {
    super(message);
    this.name = 'TriggerAdapterRegistryError';

    // Maintain a proper V8 stack trace pointing at the throw site.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TriggerAdapterRegistryError);
    }
  }
}

/**
 * A one-to-one registry of synth-time {@link TriggerAdapter}s keyed by their
 * {@link TriggerType} discriminant (Req 9.3).
 *
 * The registry owns a single responsibility: hold at most one adapter per
 * trigger discriminant and resolve the adapter for a given discriminant. It
 * deliberately does NOT mandate that every supported trigger type be present —
 * completeness is the caller's concern (task 10 wires the full adapter set) —
 * but it guarantees that whatever is registered is unambiguous: a given `type`
 * never maps to two adapters.
 *
 * Registration is fail-fast: attempting to register a second adapter for an
 * already-registered `type` throws rather than overwriting, so a wiring mistake
 * surfaces immediately at construction time.
 */
export class TriggerAdapterRegistry {
  /**
   * Backing one-to-one map. The value is stored as the open
   * {@link TriggerAdapter} (parameterised by the full union) and narrowed back
   * to the precise per-discriminant adapter type on resolution; the map key is
   * the authoritative discriminant for every entry.
   */
  private readonly adaptersByType = new Map<TriggerType, TriggerAdapter>();

  /**
   * Construct a registry, optionally seeding it with an initial adapter set.
   *
   * Seeding applies the same duplicate-registration rule as
   * {@link register}, so passing two adapters with the same `type` throws.
   *
   * @param adapters - Optional adapters to register in order.
   * @throws {TriggerAdapterRegistryError} On the first duplicate `type`
   *   ({@link TriggerAdapterRegistryErrorCode.DUPLICATE_ADAPTER}).
   */
  public constructor(adapters?: ReadonlyArray<TriggerAdapter>) {
    if (adapters !== undefined) {
      for (const adapter of adapters) {
        this.register(adapter);
      }
    }
  }

  /**
   * Register a single adapter, enforcing the exactly-one-per-type invariant.
   *
   * @param adapter - The adapter to register under its own `type`.
   * @returns This registry, to allow fluent chained registration.
   * @throws {TriggerAdapterRegistryError} If an adapter is already registered
   *   for `adapter.type`
   *   ({@link TriggerAdapterRegistryErrorCode.DUPLICATE_ADAPTER}).
   */
  public register(adapter: TriggerAdapter): this {
    const { type } = adapter;
    if (this.adaptersByType.has(type)) {
      throw new TriggerAdapterRegistryError(
        `A TriggerAdapter is already registered for trigger type "${type}"; ` +
        'each trigger type must resolve to exactly one adapter (Req 9.3).',
        TriggerAdapterRegistryErrorCode.DUPLICATE_ADAPTER,
        type,
      );
    }

    this.adaptersByType.set(type, adapter);
    return this;
  }

  /**
   * Resolve the single adapter registered for a trigger discriminant.
   *
   * @typeParam K - The trigger discriminant to resolve.
   * @param type - The {@link TriggerType} to look up.
   * @returns The adapter registered for `type`, narrowed to its precise
   *   per-discriminant adapter type.
   * @throws {TriggerAdapterRegistryError} If no adapter is registered for `type`
   *   ({@link TriggerAdapterRegistryErrorCode.UNKNOWN_TRIGGER_TYPE}).
   */
  public resolve<K extends TriggerType>(type: K): TriggerAdapterFor<K> {
    const adapter = this.adaptersByType.get(type);
    if (adapter === undefined) {
      throw new TriggerAdapterRegistryError(
        `No TriggerAdapter is registered for trigger type "${type}".`,
        TriggerAdapterRegistryErrorCode.UNKNOWN_TRIGGER_TYPE,
        type,
      );
    }

    return adapter as TriggerAdapterFor<K>;
  }

  /**
   * Resolve the adapter for a trigger discriminant without throwing.
   *
   * @typeParam K - The trigger discriminant to resolve.
   * @param type - The {@link TriggerType} to look up.
   * @returns The registered adapter narrowed to its precise type, or
   *   `undefined` when none is registered.
   */
  public tryResolve<K extends TriggerType>(type: K): TriggerAdapterFor<K> | undefined {
    return this.adaptersByType.get(type) as TriggerAdapterFor<K> | undefined;
  }

  /**
   * @param type - The {@link TriggerType} to check.
   * @returns `true` if an adapter is registered for `type`.
   */
  public has(type: TriggerType): boolean {
    return this.adaptersByType.has(type);
  }

  /** The trigger discriminants that currently have a registered adapter. */
  public get registeredTypes(): ReadonlyArray<TriggerType> {
    return Array.from(this.adaptersByType.keys());
  }

  /** The number of registered adapters (equivalently, distinct registered types). */
  public get size(): number {
    return this.adaptersByType.size;
  }
}

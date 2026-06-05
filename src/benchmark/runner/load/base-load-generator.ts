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
 * Layer D — {@link BaseLoadGenerator}: the routing-class orchestration shared by
 * every per-adapter run-time load generator (run-time, CDK-free).
 *
 * ## Responsibility
 *
 * The base owns the parts that are IDENTICAL across all nine generators so each
 * concrete subclass only declares its `type`/`routingClass` and implements the
 * single channel-specific {@link BaseLoadGenerator.dispatch} primitive:
 *
 * 1. **Routing-class delivery topology (Req 9.4–9.6).** {@link generate} selects
 *    the delivery shape by {@link routingClass}:
 *    - `request-response` / `competing` → deliver to the ONE variant under test
 *      ({@link resolveActiveEndpoint}); a missing/unmatched active variant is a
 *      {@link LoadGenerationError};
 *    - `fan-out` → deliver to EVERY subscribed endpoint, each tagged with ITS
 *      OWN variant marker;
 *    - `shared-read` → produce ONCE to the single shared source.
 * 2. **Marker delegation (Req 19.2, 19.4).** The base NEVER reinvents the marker
 *    key or the invocation-vs-window decision: it calls
 *    {@link TraceCorrelator.tag}, which embeds a marker under {@link MARKER_KEY}
 *    for marker-permitting triggers (mode `invocation-correlated`) and leaves the
 *    payload untouched for window-correlated triggers (mode `window-correlated`,
 *    no marker). The resulting {@link Delivery.mode}/{@link Delivery.marker} are
 *    copied straight from the {@link TaggedEvent}.
 *
 * The routing class (delivery topology) and the correlation mode (marker
 * presence) are INDEPENDENT axes: e.g. a Kafka same-group generator is
 * `competing` (single active variant) yet `window-correlated` (no marker), and
 * the base composes the two without either concern leaking into the other.
 *
 * @remarks
 * Validates: Requirements 9.4, 9.5, 9.6, 19.2, 19.4
 *
 * @module benchmark/runner/load/base-load-generator
 */

import type {
  BenchTriggerType,
  TaggedEvent,
  TraceCorrelator,
} from '../trace-correlator';
import { LoadGenerationError } from './errors';
import type {
  Delivery,
  LoadGenerationRequest,
  LoadGenerationResult,
  LoadGenerator,
  LoadRoutingClass,
  VariantEndpoint,
} from './types';

/**
 * Abstract base implementing the routing-class delivery topology and marker
 * delegation for every concrete load generator (Req 9.4–9.6).
 *
 * Subclasses declare {@link type} and {@link routingClass} and implement
 * {@link dispatch} — the only channel-specific behavior (the actual SDK port
 * call(s) for a single endpoint). Everything else (which endpoints to target,
 * tagging, delivery-record assembly, error semantics) is centralized here so the
 * nine generators cannot diverge in their routing semantics.
 */
export abstract class BaseLoadGenerator implements LoadGenerator {
  /** The trigger type this generator produces load for. */
  public abstract readonly type: BenchTriggerType;

  /** The routing class governing how each tick is delivered. */
  public abstract readonly routingClass: LoadRoutingClass;

  /** The run-scoped correlator that mints and embeds markers (Req 19). */
  protected readonly correlator: TraceCorrelator;

  /**
   * @param correlator - The run-scoped {@link TraceCorrelator}; all markers for
   *   the tick are minted/embedded through it so the marker key and mode are
   *   owned in exactly one place.
   */
  protected constructor(correlator: TraceCorrelator) {
    this.correlator = correlator;
  }

  /**
   * Perform one tick of load, dispatching by {@link routingClass} (Req 9.4–9.6).
   *
   * @param request - The routing, run coordinate, payload, and load shaping.
   * @returns The deliveries performed during the tick.
   *
   * @throws {LoadGenerationError} When a request-response/competing tick has no
   *   resolvable variant under test, or a shared-read tick has no source
   *   endpoint.
   */
  public async generate(
    request: LoadGenerationRequest,
  ): Promise<LoadGenerationResult> {
    switch (this.routingClass) {
      case 'request-response':
      case 'competing':
        return this.generateToActiveVariant(request);
      case 'fan-out':
        return this.generateFanOut(request);
      case 'shared-read':
        return this.generateToSharedSource(request);
      default:
        return assertExhaustiveRoutingClass(this.routingClass);
    }
  }

  /**
   * Channel-specific delivery of one tagged event to one endpoint (Req 9.4–9.6).
   *
   * Implementations issue the underlying SDK-port call(s) for `endpoint` and
   * return one {@link Delivery} per call performed. All generators emit exactly
   * one delivery per endpoint EXCEPT the HTTPS generator, which may emit a random
   * `1..N` concurrent requests per tick (Req 9.4).
   *
   * @param endpoint - The target variant endpoint.
   * @param tagged - The marker-tagged event (payload + mode + optional marker).
   * @param request - The originating tick request (for load shaping).
   * @returns The deliveries performed for `endpoint`.
   */
  protected abstract dispatch(
    endpoint: VariantEndpoint,
    tagged: TaggedEvent<Record<string, unknown>>,
    request: LoadGenerationRequest,
  ): Promise<Delivery[]>;

  /**
   * Deliver to the single variant under test (request-response + competing).
   *
   * @param request - The tick request; its `routing.activeVariant` selects the
   *   target endpoint.
   * @returns The deliveries performed for the active variant.
   *
   * @throws {LoadGenerationError} When the active variant is unspecified or has
   *   no matching endpoint.
   */
  private async generateToActiveVariant(
    request: LoadGenerationRequest,
  ): Promise<LoadGenerationResult> {
    const endpoint = this.resolveActiveEndpoint(request);
    const deliveries = await this.dispatchTo(endpoint, request);
    return { deliveries };
  }

  /**
   * Deliver to EVERY subscribed variant, each tagged with its own variant marker
   * (fan-out) (Req 9.6).
   *
   * @param request - The tick request; every `routing.endpoints` entry receives
   *   the event.
   * @returns The deliveries performed across all subscribed variants.
   */
  private async generateFanOut(
    request: LoadGenerationRequest,
  ): Promise<LoadGenerationResult> {
    const deliveries: Delivery[] = [];
    for (const endpoint of request.routing.endpoints) {
      deliveries.push(...(await this.dispatchTo(endpoint, request)));
    }
    return { deliveries };
  }

  /**
   * Produce ONCE to the single shared source (shared-read) (Req 9.6).
   *
   * The shared source is a single channel both variants read from, so exactly
   * one record is produced; the first declared endpoint is the source address.
   *
   * @param request - The tick request; `routing.endpoints[0]` is the shared
   *   source.
   * @returns The single delivery performed to the shared source.
   *
   * @throws {LoadGenerationError} When no source endpoint is declared.
   */
  private async generateToSharedSource(
    request: LoadGenerationRequest,
  ): Promise<LoadGenerationResult> {
    const [endpoint] = request.routing.endpoints;
    if (endpoint === undefined) {
      throw new LoadGenerationError(
        `No shared source endpoint declared for trigger '${this.type}'.`,
        this.type,
      );
    }
    const deliveries = await this.dispatchTo(endpoint, request);
    return { deliveries };
  }

  /**
   * Tag the payload for `endpoint`'s variant and hand it to {@link dispatch}.
   *
   * Centralizes the {@link TraceCorrelator.tag} call so every routing path tags
   * identically (Req 19.2, 19.4).
   *
   * @param endpoint - The target endpoint.
   * @param request - The originating tick request.
   * @returns The deliveries {@link dispatch} performed.
   */
  private dispatchTo(
    endpoint: VariantEndpoint,
    request: LoadGenerationRequest,
  ): Promise<Delivery[]> {
    const tagged = this.correlator.tag(
      this.type,
      request.payload,
      endpoint.variant,
      request.phase,
      request.window,
    );
    return this.dispatch(endpoint, tagged, request);
  }

  /**
   * Assemble the {@link Delivery} record for one dispatched call (Req 19.4).
   *
   * The {@link Delivery.mode} and {@link Delivery.marker} are copied from the
   * {@link TaggedEvent}, never decided here, so a window-correlated trigger can
   * never accidentally report a marker.
   *
   * @param endpoint - The endpoint the call targeted.
   * @param tagged - The tagged event the call delivered.
   * @returns The delivery record.
   */
  protected toDelivery(
    endpoint: VariantEndpoint,
    tagged: TaggedEvent<Record<string, unknown>>,
  ): Delivery {
    return {
      variant: endpoint.variant,
      address: endpoint.address,
      mode: tagged.mode,
      marker: tagged.marker,
    };
  }

  /**
   * Serialize a tagged payload to the JSON string the SDK ports carry.
   *
   * @param tagged - The tagged event whose payload to serialize.
   * @returns The JSON string of the (marker-embedded or original) payload.
   */
  protected serialize(tagged: TaggedEvent<Record<string, unknown>>): string {
    return JSON.stringify(tagged.payload);
  }

  /**
   * Resolve the endpoint of the variant under test (Req 9.4, 9.5).
   *
   * @param request - The tick request carrying `routing.activeVariant`.
   * @returns The matching endpoint.
   *
   * @throws {LoadGenerationError} When the active variant is unspecified or has
   *   no matching endpoint.
   */
  protected resolveActiveEndpoint(
    request: LoadGenerationRequest,
  ): VariantEndpoint {
    const { activeVariant, endpoints } = request.routing;
    if (activeVariant === undefined) {
      throw new LoadGenerationError(
        `No variant under test specified for '${this.type}' ` +
        `(${this.routingClass}); a ${this.routingClass} generator must be ` +
        'told which variant to drive.',
        this.type,
      );
    }
    const endpoint = endpoints.find((e) => e.variant === activeVariant);
    if (endpoint === undefined) {
      throw new LoadGenerationError(
        `No endpoint found for the variant under test '${activeVariant}' ` +
        `of trigger '${this.type}'.`,
        this.type,
      );
    }
    return endpoint;
  }
}

/**
 * Compile-time exhaustiveness guard for {@link LoadRoutingClass}.
 *
 * If a new routing class is added without a branch in
 * {@link BaseLoadGenerator.generate}, `value` is no longer `never` and this call
 * fails to type-check.
 *
 * @param value - The unhandled routing class, expected to be `never`.
 * @throws Always, as a defensive runtime guard for the unreachable branch.
 */
function assertExhaustiveRoutingClass(value: never): never {
  throw new Error(
    `Unhandled routing class in BaseLoadGenerator: ${JSON.stringify(value)}.`,
  );
}

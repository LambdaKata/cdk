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
 * Layer D — {@link HttpLoadGenerator}: HTTPS load for `apiGateway`/`functionUrl`
 * (request-response, run-time, CDK-free).
 *
 * @module benchmark/runner/load/http-load-generator
 */

import type { TaggedEvent, TraceCorrelator } from '../trace-correlator';
import { BaseLoadGenerator } from './base-load-generator';
import type {
  Delivery,
  HttpLoadGeneratorConfig,
  HttpRequester,
  LoadGenerationRequest,
  LoadRoutingClass,
  VariantEndpoint,
} from './types';

/** HTTP method used for payload-bearing benchmark requests. */
const HTTP_METHOD = 'POST';

/** Content type of the JSON benchmark request body. */
const JSON_CONTENT_TYPE = 'application/json';

/** Lower bound of the per-tick concurrent-request band (Req 9.4). */
const MIN_REQUESTS_PER_TICK = 1;

/**
 * Drives load over HTTPS against the variant UNDER TEST for an `apiGateway` or
 * `functionUrl` trigger (Req 9.4).
 *
 * Unlike the single-shot direct invoke, an HTTPS tick emits a RANDOM number of
 * CONCURRENT requests in the inclusive band `1..concurrency`, selected from the
 * injected {@link HttpLoadGeneratorConfig.random} source: a minimal RNG yields
 * exactly one request, a maximal RNG yields `concurrency` requests. Every
 * request targets the active variant's URL and carries an embedded marker in its
 * JSON body (apiGateway/functionUrl permit a marker).
 */
export class HttpLoadGenerator extends BaseLoadGenerator {
  /** @inheritDoc */
  public readonly type: 'apiGateway' | 'functionUrl';

  /** @inheritDoc */
  public readonly routingClass: LoadRoutingClass = 'request-response';

  private readonly client: HttpRequester;
  private readonly random: () => number;

  /**
   * @param correlator - The run-scoped correlator that mints/embeds markers.
   * @param client - The injected HTTPS port.
   * @param config - The HTTPS trigger type and an optional deterministic RNG
   *   (defaults to `Math.random`).
   */
  public constructor(
    correlator: TraceCorrelator,
    client: HttpRequester,
    config: HttpLoadGeneratorConfig,
  ) {
    super(correlator);
    this.client = client;
    this.type = config.type;
    this.random = config.random ?? Math.random;
  }

  /**
   * Emit a random `1..concurrency` burst of concurrent HTTPS requests to the
   * active variant (Req 9.4).
   *
   * @inheritDoc
   */
  protected async dispatch(
    endpoint: VariantEndpoint,
    tagged: TaggedEvent<Record<string, unknown>>,
    request: LoadGenerationRequest,
  ): Promise<Delivery[]> {
    const requestCount = this.pickRequestCount(request.load?.concurrency);
    const body = this.serialize(tagged);

    // Fire the burst concurrently — this is the per-tick HTTPS load (Req 9.4).
    const sends = Array.from({ length: requestCount }, () =>
      this.client.send({
        url: endpoint.address,
        method: HTTP_METHOD,
        headers: { 'content-type': JSON_CONTENT_TYPE },
        body,
      }),
    );
    await Promise.all(sends);

    return sends.map(() => this.toDelivery(endpoint, tagged));
  }

  /**
   * Pick the per-tick request count in the inclusive band
   * `[MIN_REQUESTS_PER_TICK, concurrency]` from the injected RNG (Req 9.4).
   *
   * `count = 1 + floor(random() * concurrency)`. Because `random()` is in
   * `[0, 1)`, `floor(random() * concurrency)` is in `[0, concurrency - 1]`, so
   * the count is in `[1, concurrency]`: a minimal RNG (`0`) yields exactly one
   * request and a maximal RNG yields `concurrency`. `concurrency` is floored to
   * at least `1`, so a tick always emits at least one request.
   *
   * @param concurrency - The upper bound of the band; defaults to `1`.
   * @returns The number of concurrent requests to emit this tick.
   */
  private pickRequestCount(concurrency: number | undefined): number {
    const upperBound = Math.max(
      MIN_REQUESTS_PER_TICK,
      Math.floor(concurrency ?? MIN_REQUESTS_PER_TICK),
    );
    const draw = Math.floor(this.random() * upperBound);
    const bounded = Math.min(upperBound - 1, Math.max(0, draw));
    return MIN_REQUESTS_PER_TICK + bounded;
  }
}

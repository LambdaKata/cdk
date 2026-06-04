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
 * Layer C — Kinesis trigger adapter
 * (Req 8.4, 9.1, 9.3, 9.5/9.6, 10.1, 10.2, 3.2–3.4).
 *
 * Kinesis is Shared_Read for a standard iterator and Fan_Out for enhanced
 * fan-out (Req 8.4). Per the design isolation table the adapter creates an
 * **isolated benchmark stream** (or, for EFO, an isolated stream plus consumers)
 * and attaches BOTH variants via `AWS::Lambda::EventSourceMapping`:
 *
 * - the kata mapping is created ALWAYS disabled (Req 10.2, 3.3), targeting the
 *   clone's SnapStart alias when supplied (Req 7);
 * - the baseline mapping is created in the routing-driven state, defaulting to
 *   disabled (Req 10.1, 10.2, 3.4).
 *
 * Mappings use an explicit, deterministic `LATEST` starting position so a run
 * reads only benchmark-generated records, never unrelated historical ones. The
 * baseline's pre-existing production stream mapping is never read or mutated —
 * only NEW benchmark-owned mappings on the isolated stream are created
 * (Property 4, Req 3.2).
 *
 * @remarks
 * Validates: Requirements 8.4, 9.1, 9.3, 9.5, 9.6, 10.1, 10.2, 10.3, 10.4, 3.2, 3.3, 3.4
 *
 * @module benchmark/triggers/kinesis
 */

import { Stream } from 'aws-cdk-lib/aws-kinesis';

import { AbstractTriggerAdapter, BENCHMARK_STREAM_STARTING_POSITION } from './adapter-base';
import type { AdapterProvisionResult, AdapterSynthContext, KinesisTrigger } from './types';

/**
 * Kinesis adapter (shared-read / enhanced-fan-out, isolated benchmark stream,
 * Req 8.4, 9.5, 9.6).
 */
export class KinesisTriggerAdapter extends AbstractTriggerAdapter<KinesisTrigger> {
  /** The trigger discriminant this adapter handles. */
  public readonly type = 'kinesis' as const;

  /**
   * Create an isolated benchmark stream and attach both variants with the kata
   * mapping disabled and a deterministic starting position (Req 9.5/9.6, 10.x).
   *
   * @param context - The synth-time context.
   * @param declaration - The Kinesis declaration (consumer mode).
   * @returns The provision result with both mapping UUID tokens; routing class
   *   is fan-out for enhanced fan-out, else shared-read (Req 8.4).
   */
  public provision(
    context: AdapterSynthContext,
    declaration: KinesisTrigger,
  ): AdapterProvisionResult {
    const scope = this.requireScope(context);
    const variantId = this.variantIdOf(context);

    // Isolated benchmark stream — never the production stream (Req 9.6, 3.5).
    const benchmarkStream = new Stream(scope, `${variantId}BenchStream`);

    const mappings = this.createVariantMappings(context, {
      eventSourceArn: benchmarkStream.streamArn,
      startingPosition: BENCHMARK_STREAM_STARTING_POSITION,
    });

    return {
      routingClass: this.routingClass(declaration),
      isolated: true,
      sourceRef: benchmarkStream.streamArn,
      mappings,
    };
  }
}

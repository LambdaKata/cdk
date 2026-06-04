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
 * Layer C — SQS trigger adapter (Req 8.2, 9.1, 9.3, 9.5, 10.1, 10.2, 3.2–3.4).
 *
 * SQS is a Competing_Source: each message is delivered to exactly one consumer.
 * Per the design isolation table the adapter creates an **isolated benchmark
 * queue** (never the production queue) and attaches BOTH variants to it via
 * `AWS::Lambda::EventSourceMapping`:
 *
 * - the kata mapping is created ALWAYS disabled (Req 10.2, 3.3), targeting the
 *   clone's SnapStart alias when supplied (Req 7);
 * - the baseline mapping is created in the routing-driven state, defaulting to
 *   disabled (Req 10.1, 10.2, 3.4).
 *
 * The baseline's pre-existing production SQS mapping is never read or mutated —
 * only NEW benchmark-owned mappings on the isolated queue are created
 * (Property 4 — baseline non-interference, Req 3.2). Both mapping UUID tokens
 * ({@link CfnEventSourceMapping.attrId}) are surfaced for the manifest so the
 * runner can toggle them via `UpdateEventSourceMapping` (Req 10.3, 10.4).
 *
 * @remarks
 * Validates: Requirements 8.2, 9.1, 9.3, 9.5, 10.1, 10.2, 10.3, 10.4, 3.2, 3.3, 3.4
 *
 * @module benchmark/triggers/sqs
 */

import { Queue } from 'aws-cdk-lib/aws-sqs';

import { AbstractTriggerAdapter } from './adapter-base';
import type { AdapterProvisionResult, AdapterSynthContext, SqsTrigger } from './types';

/**
 * SQS adapter (competing, isolated benchmark queue, Req 8.2, 9.5).
 */
export class SqsTriggerAdapter extends AbstractTriggerAdapter<SqsTrigger> {
  /** The trigger discriminant this adapter handles. */
  public readonly type = 'sqs' as const;

  /**
   * Create an isolated benchmark queue and attach both variants with the kata
   * mapping disabled (Req 9.5, 10.1, 10.2).
   *
   * @param context - The synth-time context.
   * @param declaration - The SQS declaration (optional batch size).
   * @returns The competing provision result with both mapping UUID tokens.
   */
  public provision(context: AdapterSynthContext, declaration: SqsTrigger): AdapterProvisionResult {
    const scope = this.requireScope(context);
    const variantId = this.variantIdOf(context);

    // Isolated benchmark queue — never the production queue (Req 9.5, 3.5).
    const benchmarkQueue = new Queue(scope, `${variantId}BenchQueue`);

    const mappings = this.createVariantMappings(context, {
      eventSourceArn: benchmarkQueue.queueArn,
      ...(declaration.batchSize !== undefined ? { batchSize: declaration.batchSize } : {}),
    });

    return {
      routingClass: 'competing',
      isolated: true,
      sourceRef: benchmarkQueue.queueArn,
      mappings,
    };
  }
}

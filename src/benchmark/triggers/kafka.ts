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
 * Layer C — Kafka / Amazon MSK trigger adapter
 * (Req 8.3, 9.1, 9.3, 9.5/9.6, 10.1, 10.2, 3.2–3.4).
 *
 * Kafka is Competing when both variants share a single consumer group, and
 * Fan_Out when each variant uses a distinct consumer group (Req 8.3). Unlike the
 * other poll-based sources, the cluster is NOT duplicated: per the design
 * isolation table the adapter reuses the **existing MSK cluster** and isolates
 * benchmark traffic via a **benchmark topic** plus a **consumer group per mode**
 * — creating an MSK cluster as an isolated benchmark resource is intentionally
 * out of scope (cluster provisioning is heavyweight and not symmetric with the
 * other adapters). The benchmark topic is the isolation boundary
 * (`isolated: true`).
 *
 * Both variants attach to the existing cluster via
 * `AWS::Lambda::EventSourceMapping` against the benchmark topic:
 *
 * - the kata mapping is created ALWAYS disabled (Req 10.2, 3.3), targeting the
 *   clone's SnapStart alias when supplied (Req 7);
 * - the baseline mapping is created in the routing-driven state, defaulting to
 *   disabled (Req 10.1, 10.2, 3.4);
 * - consumer groups follow the declared mode: a single shared group id for
 *   `same-group` (competing), or a distinct group id per variant for
 *   `distinct-group-per-variant` (fan-out) (Req 8.3).
 *
 * A Kafka declaration without a resolvable cluster ARN cannot be wired to a
 * benchmark source, so the clone trigger is left **detached** and the reason is
 * recorded (Req 9.7). The baseline's pre-existing production Kafka mapping is
 * never read or mutated (Property 4, Req 3.2).
 *
 * @remarks
 * Validates: Requirements 8.3, 9.1, 9.3, 9.5, 9.6, 9.7, 10.1, 10.2, 10.3, 10.4, 3.2, 3.3, 3.4
 *
 * @module benchmark/triggers/kafka
 */

import { AbstractTriggerAdapter, BENCHMARK_STREAM_STARTING_POSITION } from './adapter-base';
import type { AdapterProvisionResult, AdapterSynthContext, KafkaTrigger } from './types';

/** The default benchmark topic name when the declaration does not specify one. */
const DEFAULT_BENCHMARK_TOPIC = 'lambda-kata-bench';

/** The benchmark consumer-group id prefix used to isolate benchmark consumption. */
const BENCH_GROUP_PREFIX = 'lambda-kata-bench';

/**
 * Kafka / MSK adapter (competing or fan-out, existing cluster + benchmark topic,
 * Req 8.3, 9.5/9.6).
 */
export class KafkaTriggerAdapter extends AbstractTriggerAdapter<KafkaTrigger> {
  /** The trigger discriminant this adapter handles. */
  public readonly type = 'kafka' as const;

  /**
   * Attach both variants to the existing cluster's benchmark topic with the
   * kata mapping disabled and a consumer group per mode (Req 8.3, 9.5/9.6,
   * 10.1, 10.2). When no cluster ARN is resolvable, leave the clone detached
   * and record the reason (Req 9.7).
   *
   * @param context - The synth-time context.
   * @param declaration - The Kafka declaration (cluster, topic, group mode).
   * @returns The provision result; routing class is fan-out for distinct
   *   groups, else competing (Req 8.3).
   */
  public provision(context: AdapterSynthContext, declaration: KafkaTrigger): AdapterProvisionResult {
    // The scope and kata function are required to wire any benchmark source.
    this.requireScope(context);
    this.requireKataFunction(context);

    const routingClass = this.routingClass(declaration);
    const clusterArn = declaration.cluster?.arn;

    // Without a resolvable existing cluster ARN there is nothing to attach the
    // benchmark topic mapping to; leave the clone trigger detached (Req 9.7).
    if (clusterArn === undefined) {
      return {
        routingClass,
        isolated: false,
        detached: true,
        detachedReason:
          'Kafka trigger has no resolvable cluster ARN; the harness reuses an existing MSK ' +
          'cluster and cannot attach a benchmark topic mapping without it. Clone left detached.',
      };
    }

    const variantId = this.variantIdOf(context);
    const topic = declaration.topic ?? DEFAULT_BENCHMARK_TOPIC;
    const distinctGroups = declaration.consumerGroupMode === 'distinct-group-per-variant';

    // same-group (competing): one shared consumer group for both variants;
    // distinct-group-per-variant (fan-out): a distinct group per variant.
    const sharedGroupId = `${BENCH_GROUP_PREFIX}-${variantId}`;
    const kataGroupId = distinctGroups ? `${sharedGroupId}-kata` : sharedGroupId;
    const baselineGroupId = distinctGroups ? `${sharedGroupId}-baseline` : sharedGroupId;

    const mappings = this.createVariantMappings(context, {
      eventSourceArn: clusterArn,
      topics: [topic],
      startingPosition: BENCHMARK_STREAM_STARTING_POSITION,
      perVariantProps: {
        kata: { amazonManagedKafkaEventSourceConfig: { consumerGroupId: kataGroupId } },
        baseline: { amazonManagedKafkaEventSourceConfig: { consumerGroupId: baselineGroupId } },
      },
    });

    return {
      routingClass,
      isolated: true,
      sourceRef: `${clusterArn}#${topic}`,
      mappings,
    };
  }
}

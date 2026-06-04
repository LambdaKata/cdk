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
 * Layer C — EventBridge trigger adapter (Req 8.6, 9.1, 9.3, 9.6, 3.2, 3.3, 3.4).
 *
 * EventBridge is a Fan_Out source: each subscribed rule target receives its own
 * copy of the event (Req 8.6). EventBridge is a **push** integration — AWS does
 * NOT model it as a Lambda `EventSourceMapping`. Per the design isolation table
 * the adapter creates an **isolated benchmark bus** (with a reserved
 * detail-type/source) and a benchmark rule, wiring the variants as
 * EventBridge→Lambda push targets rather than event source mappings:
 *
 * - the KATA clone target is left **detached by default** — the benchmark rule
 *   is created WITHOUT an active clone target — which is the explicitly-allowed
 *   conservative posture for a clone trigger (Req 3.3 "detached or disabled",
 *   Req 3.4). A fresh `AWS::Lambda::Permission` for the clone's SnapStart
 *   **alias** is created so the runner can add the clone as a rule target
 *   (once the gate approves) without an IAM redeploy (Req 7.3);
 * - the BASELINE target is wired only when routing explicitly enables it.
 *
 * The baseline's pre-existing production EventBridge rules are never read or
 * mutated — only NEW benchmark-owned wiring on the isolated bus is created
 * (Property 4 — baseline non-interference, Req 3.2).
 *
 * @remarks
 * Validates: Requirements 8.6, 9.1, 9.3, 9.6, 3.2, 3.3, 3.4, 7.3
 *
 * @module benchmark/triggers/eventbridge
 */

import { CfnRule, EventBus } from 'aws-cdk-lib/aws-events';

import { AbstractTriggerAdapter, DEFAULT_BASELINE_MAPPING_STATE } from './adapter-base';
import type { AdapterProvisionResult, AdapterSynthContext, EventBridgeTrigger } from './types';

/** The EventBridge service principal permitted to invoke the variant functions. */
const EVENTS_SERVICE_PRINCIPAL = 'events.amazonaws.com';

/** The reserved benchmark detail-type used to isolate benchmark events. */
const BENCHMARK_DETAIL_TYPE = 'lambda-kata-bench';

/** The reserved benchmark event source used to isolate benchmark events. */
const BENCHMARK_EVENT_SOURCE = 'lambda-kata.bench';

/**
 * EventBridge adapter (fan-out, isolated benchmark bus + rule, Req 8.6, 9.6).
 */
export class EventBridgeTriggerAdapter extends AbstractTriggerAdapter<EventBridgeTrigger> {
  /** The trigger discriminant this adapter handles. */
  public readonly type = 'eventBridge' as const;

  /**
   * Create an isolated benchmark bus + rule, a fresh invoke permission for the
   * clone alias, and (when routing enables it) the baseline rule target; the
   * clone target is left detached by default (Req 9.6, 3.3, 3.4).
   *
   * @param context - The synth-time context.
   * @param declaration - The EventBridge declaration (detail type / source).
   * @returns The fan-out provision result (isolated bus ref; no event source
   *   mappings — EventBridge is push-based).
   */
  public provision(
    context: AdapterSynthContext,
    declaration: EventBridgeTrigger,
  ): AdapterProvisionResult {
    const scope = this.requireScope(context);
    const variantId = this.variantIdOf(context);

    // Isolated benchmark bus — never the production bus (Req 9.6, 3.5).
    const benchmarkBus = new EventBus(scope, `${variantId}BenchBus`);

    // Fresh invoke permission for the clone ALIAS so EventBridge may invoke the
    // clone once the runner adds it as a target; the clone stays detached by
    // default (Req 3.3, 7.3).
    this.createInvokePermission(
      scope,
      `${variantId}KataEventsInvoke`,
      this.kataTargetRef(context),
      EVENTS_SERVICE_PRINCIPAL,
    );

    // Benchmark rule on the isolated bus, scoped to the reserved
    // detail-type/source so it never matches production traffic.
    const detailType = declaration.detailType ?? BENCHMARK_DETAIL_TYPE;
    const source = declaration.source ?? BENCHMARK_EVENT_SOURCE;

    // The baseline is wired as a rule target only when routing explicitly
    // enables it; the default disabled posture leaves it detached (Req 3.4).
    const baselineState = context.baselineMappingState ?? DEFAULT_BASELINE_MAPPING_STATE;
    const targets =
      context.baselineFunction !== undefined && baselineState === 'enabled'
        ? [{ id: 'BaselineTarget', arn: context.baselineFunction.functionArn }]
        : [];

    if (targets.length > 0) {
      this.createInvokePermission(
        scope,
        `${variantId}BaselineEventsInvoke`,
        context.baselineFunction!.functionArn,
        EVENTS_SERVICE_PRINCIPAL,
      );
    }

    // eslint-disable-next-line no-new
    new CfnRule(scope, `${variantId}BenchRule`, {
      eventBusName: benchmarkBus.eventBusName,
      eventPattern: {
        'detail-type': [detailType],
        source: [source],
      },
      // A rule must declare at least one target to be useful; when no baseline
      // target is active the rule is created with no targets (the clone is
      // added at run time). CloudFormation permits a rule with zero targets.
      ...(targets.length > 0 ? { targets } : {}),
    });

    return {
      routingClass: 'fan-out',
      isolated: true,
      sourceRef: benchmarkBus.eventBusArn,
    };
  }
}

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
 * Layer C — SNS trigger adapter (Req 8.6, 9.1, 9.3, 9.6, 3.2, 3.3, 3.4).
 *
 * SNS is a Fan_Out source: every subscriber receives its own copy of the event
 * (Req 8.6). SNS is a **push** integration — AWS does NOT model it as a Lambda
 * `EventSourceMapping` (event source mappings only exist for poll-based sources
 * such as SQS, Kinesis, DynamoDB Streams, MSK). Per the design isolation table
 * the adapter therefore creates an **isolated benchmark topic** and wires the
 * variants as SNS→Lambda push integrations rather than event source mappings:
 *
 * - the BASELINE is subscribed when routing enables it (default disabled →
 *   detached, observe-only), reusing a fresh invoke permission;
 * - the KATA clone is left **detached by default** (no active subscription),
 *   which is the explicitly-allowed conservative posture for a clone trigger
 *   (Req 3.3 "detached or disabled"; Req 3.4). A fresh `AWS::Lambda::Permission`
 *   for the clone's SnapStart **alias** is created so the run-time runner can
 *   subscribe the clone (once the Side_Effect_Policy_Gate approves parallel
 *   fan-out) without an IAM redeploy (Req 7.3).
 *
 * The baseline's pre-existing production SNS subscriptions are never read or
 * mutated — only NEW benchmark-owned wiring on the isolated topic is created
 * (Property 4 — baseline non-interference, Req 3.2).
 *
 * @remarks
 * Validates: Requirements 8.6, 9.1, 9.3, 9.6, 3.2, 3.3, 3.4, 7.3
 *
 * @module benchmark/triggers/sns
 */

import { Topic } from 'aws-cdk-lib/aws-sns';

import { AbstractTriggerAdapter, DEFAULT_BASELINE_MAPPING_STATE } from './adapter-base';
import type { AdapterProvisionResult, AdapterSynthContext, SnsTrigger } from './types';

/** The SNS service principal permitted to invoke the variant functions. */
const SNS_SERVICE_PRINCIPAL = 'sns.amazonaws.com';

/**
 * SNS adapter (fan-out, isolated benchmark topic, Req 8.6, 9.6).
 */
export class SnsTriggerAdapter extends AbstractTriggerAdapter<SnsTrigger> {
  /** The trigger discriminant this adapter handles. */
  public readonly type = 'sns' as const;

  /**
   * Create an isolated benchmark topic, a fresh invoke permission for the
   * clone alias, and (when routing enables it) the baseline subscription;
   * the clone is left detached by default (Req 9.6, 3.3, 3.4).
   *
   * @param context - The synth-time context.
   * @param _declaration - The SNS declaration.
   * @returns The fan-out provision result (isolated topic ref; no mappings —
   *   SNS is push-based and carries no event source mapping).
   */
  public provision(context: AdapterSynthContext, _declaration: SnsTrigger): AdapterProvisionResult {
    const scope = this.requireScope(context);
    const variantId = this.variantIdOf(context);

    // Isolated benchmark topic — never the production topic (Req 9.6, 3.5).
    const benchmarkTopic = new Topic(scope, `${variantId}BenchTopic`);

    // Fresh invoke permission for the clone ALIAS so SNS may invoke the clone
    // once the runner subscribes it; the clone stays detached by default
    // (Req 3.3, 7.3).
    this.createInvokePermission(
      scope,
      `${variantId}KataSnsInvoke`,
      this.kataTargetRef(context),
      SNS_SERVICE_PRINCIPAL,
      benchmarkTopic.topicArn,
    );

    // The baseline is wired only when routing explicitly enables it; the
    // default disabled posture leaves it detached (observe-only, Req 3.4).
    const baselineState = context.baselineMappingState ?? DEFAULT_BASELINE_MAPPING_STATE;
    if (context.baselineFunction !== undefined && baselineState === 'enabled') {
      this.createInvokePermission(
        scope,
        `${variantId}BaselineSnsInvoke`,
        context.baselineFunction.functionArn,
        SNS_SERVICE_PRINCIPAL,
        benchmarkTopic.topicArn,
      );
    }

    return {
      routingClass: 'fan-out',
      isolated: true,
      sourceRef: benchmarkTopic.topicArn,
    };
  }
}

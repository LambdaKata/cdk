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
 * Trigger declarations and the synth-time Trigger_Adapter contract (Layer C).
 *
 * The supported trigger set is modelled as a discriminated union keyed by
 * `type` so each trigger is selected and configured through its own typed shape
 * (Req 9.1, 9.2). The {@link TriggerAdapter} contract is the synth-time seam an
 * adapter implements to declare its routing class and provision isolated
 * benchmark sources; run-time load generation lives in the CDK-free `runner/`
 * subtree and is intentionally not part of this contract.
 *
 * This module is type-only: it defines the shapes later tasks (7, 8, 10)
 * implement against. It contains no runtime logic. The CDK imports below are
 * `import type` only — they are erased at compile time and add no runtime
 * `aws-cdk-lib` dependency, so the module stays import-free at run time.
 *
 * @remarks
 * Validates: Requirements 8.1, 9.1, 9.2, 9.3
 *
 * @module benchmark/triggers/types
 */

import type { Construct } from 'constructs';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';

/**
 * The classification of a trigger that determines exclusive-vs-parallel
 * execution semantics (Req 8.1).
 */
export type RoutingClass = 'competing' | 'fan-out' | 'shared-read' | 'request-response';

/**
 * How a trigger's event source is isolated for benchmarking.
 *
 * - `isolated` — a dedicated benchmark source is created.
 * - `attach-existing` — variants attach to an existing (possibly external)
 *   source; only permitted after the preflight/side-effect gates approve.
 */
export type IsolationStrategy = 'isolated' | 'attach-existing';

/**
 * Load shape consumed by the run-time generator for a trigger.
 */
export interface LoadProfile {
  /** Total minutes to generate load. */
  readonly minutes?: number;
  /** Maximum burst size per tick. */
  readonly maxBurst?: number;
  /** Tick interval in milliseconds. */
  readonly tickMs?: number;
  /** Batch size for batched sources (e.g. SQS, Kinesis). */
  readonly batchSize?: number;
  /** Concurrency for request/response sources. */
  readonly concurrency?: number;
}

/**
 * A reference to an existing resource (by ARN, name, or import token). The
 * concrete resolution strategy is implemented by later tasks; the shape is kept
 * open here to avoid leaking `aws-cdk-lib` resource types into option callers.
 */
export interface ResourceRef {
  /** ARN of the referenced resource, when known at declaration time. */
  readonly arn?: string;
  /** Logical/physical name of the referenced resource, when known. */
  readonly name?: string;
}

/**
 * Fields shared by every trigger declaration.
 */
export interface TriggerBase {
  /** `node.path` of the baseline this trigger applies to. */
  readonly target: string;
  /** Per-trigger override of run isolation; defaults derived from routing class. */
  readonly isolation?: IsolationStrategy;
  /** Load shape for the run-time generator. */
  readonly load?: LoadProfile;
}

/** Direct synchronous `Invoke` trigger (request/response). */
export interface InvokeTrigger extends TriggerBase {
  readonly type: 'invoke';
  readonly payloads?: ReadonlyArray<unknown>;
}

/** API Gateway trigger (request/response). */
export interface ApiGatewayTrigger extends TriggerBase {
  readonly type: 'apiGateway';
  readonly path?: string;
  readonly method?: string;
}

/** Lambda Function URL trigger (request/response). */
export interface FunctionUrlTrigger extends TriggerBase {
  readonly type: 'functionUrl';
}

/** SQS trigger (competing). */
export interface SqsTrigger extends TriggerBase {
  readonly type: 'sqs';
  readonly queue?: ResourceRef;
  readonly batchSize?: number;
}

/** EventBridge trigger (fan-out). */
export interface EventBridgeTrigger extends TriggerBase {
  readonly type: 'eventBridge';
  readonly busName?: string;
  readonly detailType?: string;
  readonly source?: string;
}

/** SNS trigger (fan-out). */
export interface SnsTrigger extends TriggerBase {
  readonly type: 'sns';
  readonly topic?: ResourceRef;
}

/** Kinesis trigger (shared-read for standard iterator, fan-out for EFO). */
export interface KinesisTrigger extends TriggerBase {
  readonly type: 'kinesis';
  readonly stream?: ResourceRef;
  readonly consumer?: 'standard-iterator' | 'enhanced-fan-out';
}

/** DynamoDB Streams trigger (shared-read). */
export interface DynamoDbStreamsTrigger extends TriggerBase {
  readonly type: 'dynamoDbStreams';
  readonly streamArn?: string;
}

/** Kafka/MSK trigger (competing for same group, fan-out for distinct groups). */
export interface KafkaTrigger extends TriggerBase {
  readonly type: 'kafka';
  readonly cluster?: ResourceRef;
  readonly topic?: string;
  readonly consumerGroupMode?: 'same-group' | 'distinct-group-per-variant';
}

/**
 * The discriminated union of all supported trigger declarations (Req 9.1, 9.2).
 */
export type TriggerDeclaration =
  | InvokeTrigger
  | ApiGatewayTrigger
  | FunctionUrlTrigger
  | SqsTrigger
  | EventBridgeTrigger
  | SnsTrigger
  | KinesisTrigger
  | DynamoDbStreamsTrigger
  | KafkaTrigger;

/** The string literal discriminants of {@link TriggerDeclaration}. */
export type TriggerType = TriggerDeclaration['type'];

/**
 * The enablement state of a synthesized event source mapping (Req 10.1, 10.2).
 *
 * The kata (clone) mapping is ALWAYS created `disabled`; the baseline mapping's
 * state is driven by the routing options (defaulting to `disabled` for the
 * conservative, observe-only posture).
 */
export type MappingEnablement = 'enabled' | 'disabled';

/**
 * Synth-time context handed to a {@link TriggerAdapter} when it provisions
 * benchmark infrastructure (finalised by task 10).
 *
 * It carries the construct scope the adapter creates benchmark-owned resources
 * within, the transformed Kata_Variant function (and its SnapStart alias
 * reference, so mappings target the alias rather than `$LATEST`), and the
 * baseline identity. The adapter NEVER mutates the baseline's pre-existing
 * trigger wiring (Property 4 — baseline non-interference, Req 3.2).
 */
export interface AdapterSynthContext {
  /** `node.path` of the baseline being provisioned. */
  readonly baselineConstructPath: string;
  /**
   * The construct scope benchmark-owned resources are created within. Optional
   * on the shared shape (the Task 7 contract carried only the construct path);
   * every source-creating adapter REQUIRES it and enforces its presence at the
   * provisioning boundary via a descriptive precondition error.
   */
  readonly scope?: Construct;
  /**
   * Stable, unique id fragment for the baseline within the run, used to
   * namespace benchmark resource construct ids so multiple variants in one
   * scope never collide. Defaults to a sanitized {@link baselineConstructPath}
   * when omitted.
   */
  readonly variantId?: string;
  /**
   * The transformed Kata_Variant (clone) function the benchmark source is
   * attached to. Its event source mappings are created `disabled` (Req 10.2)
   * and target the SnapStart alias when {@link kataAliasArnRef} is supplied.
   * Required by every source-creating adapter (enforced at provisioning).
   */
  readonly kataFunction?: IFunction;
  /**
   * The Baseline_Variant function the benchmark source is also attached to, so
   * the runner can route load to either variant at run time (Req 10.1). When
   * omitted only the kata mapping is created (e.g. observe-only synthesis).
   */
  readonly baselineFunction?: IFunction;
  /**
   * The clone's SnapStart alias ARN reference
   * ({@link SnapStartActivator.aliasArnRef}). When present the kata mapping
   * targets the alias rather than the unqualified function, so the benchmark
   * exercises SnapStart (Req 7). When absent the kata function reference is
   * used directly.
   */
  readonly kataAliasArnRef?: string;
  /**
   * The desired baseline mapping enablement, derived from the routing options
   * (Req 10.2). Defaults to `disabled` (the conservative, observe-only
   * posture) when omitted.
   */
  readonly baselineMappingState?: MappingEnablement;
}

/**
 * The event source mappings a poll-based adapter synthesizes for the two
 * variants (Req 10.1, 10.2). Each entry carries the `CfnEventSourceMapping`
 * UUID attribute token ({@link CfnEventSourceMapping.attrId}) the runtime
 * runner uses with `UpdateEventSourceMapping` (Req 10.3, 10.4).
 */
export interface AdapterMappingRefs {
  /**
   * The kata (clone) mapping UUID attribute token. Always created `disabled`
   * (Req 10.2).
   */
  readonly kataMappingUuid: string;
  /**
   * The baseline mapping UUID attribute token, when a baseline mapping was
   * created (Req 10.1). Absent for push-based or request-response adapters that
   * create no event source mapping.
   */
  readonly baselineMappingUuid?: string;
}

/**
 * Result of a {@link TriggerAdapter} provisioning pass (finalised by task 10).
 *
 * Captures the routing class, whether an isolated benchmark source was created,
 * the benchmark source reference, the synthesized mapping UUID tokens (for the
 * manifest), and — for an unsupported declaration — the detached flag and
 * reason (Req 9.7).
 */
export interface AdapterProvisionResult {
  /** The routing class resolved for the provisioned trigger. */
  readonly routingClass: RoutingClass;
  /** Whether an isolated benchmark source was created (Req 9.3 isolation table). */
  readonly isolated: boolean;
  /**
   * A reference to the benchmark source the variants are attached to (ARN, name
   * token, or logical ref), surfaced into the manifest. Absent for
   * request-response adapters (load is request-driven, no source) and for an
   * unsupported, detached declaration.
   */
  readonly sourceRef?: string;
  /**
   * The synthesized event source mapping UUID tokens (Req 10.1, 10.2, 10.3).
   * Present only for poll-based adapters that create event source mappings;
   * absent for push-based, request-response, and detached results.
   */
  readonly mappings?: AdapterMappingRefs;
  /**
   * `true` when the trigger type is unsupported and the clone trigger was left
   * detached (Req 9.7). `false` (or absent) for a provisioned trigger.
   */
  readonly detached?: boolean;
  /** Human-readable reason recorded into the Run_Design when {@link detached}. */
  readonly detachedReason?: string;
}

/**
 * The synth-time contract a per-trigger adapter implements (Req 9.3).
 *
 * @typeParam T - The specific {@link TriggerDeclaration} this adapter handles.
 */
export interface TriggerAdapter<T extends TriggerDeclaration = TriggerDeclaration> {
  /** The trigger discriminant this adapter handles. */
  readonly type: T['type'];
  /** Routing class for this trigger instance (may depend on declared config). */
  routingClass(declaration: T): RoutingClass;
  /** Create the isolated benchmark source + variant mappings (disabled by default). */
  provision(context: AdapterSynthContext, declaration: T): AdapterProvisionResult;
}

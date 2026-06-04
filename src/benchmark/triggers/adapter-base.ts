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
 * Layer C — shared base for the synth-time per-trigger adapters (Req 9, 10, 3).
 *
 * Every supported {@link TriggerAdapter} is a class that extends
 * {@link AbstractTriggerAdapter}. The base owns the cross-cutting concerns that
 * are identical across adapters so each concrete adapter only expresses what is
 * genuinely trigger-specific (its isolated source and how variants attach):
 *
 * - **Routing classification** is delegated to the single source of truth,
 *   {@link classifyRouting} (Req 8), so an adapter never re-derives its routing
 *   class.
 * - **Context preconditions** — the shared {@link AdapterSynthContext} carries
 *   optional fields (the Task 7 contract only required `baselineConstructPath`);
 *   the base enforces, at the provisioning boundary, that a source-creating
 *   adapter received the scope and kata function it needs, failing fast with a
 *   descriptive error rather than producing a half-wired benchmark.
 * - **Variant event source mappings** — the base creates the kata mapping
 *   ALWAYS disabled (Req 10.2) and, when a baseline function is supplied, the
 *   baseline mapping in the routing-driven state (Req 10.1). The kata mapping
 *   targets the SnapStart **alias** rather than `$LATEST` when an alias ref is
 *   supplied (Req 7), and every mapping exposes its
 *   {@link CfnEventSourceMapping.attrId} UUID token for the manifest
 *   (Req 10.3, 10.4).
 *
 * The base NEVER reads or mutates the baseline's pre-existing trigger wiring: it
 * only creates NEW, benchmark-owned resources attached to the ISOLATED source,
 * preserving baseline non-interference (Property 4, Req 3.2).
 *
 * This module is synth-time (Layer C) and MAY import `aws-cdk-lib`.
 *
 * @remarks
 * Validates: Requirements 3.2, 3.3, 3.4, 9.3, 10.1, 10.2, 10.3, 10.4
 *
 * @module benchmark/triggers/adapter-base
 */

import { CfnEventSourceMapping, CfnPermission, IFunction } from 'aws-cdk-lib/aws-lambda';
import type { CfnEventSourceMappingProps } from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';

import { classifyRouting } from '../routing';
import type {
  AdapterMappingRefs,
  AdapterSynthContext,
  MappingEnablement,
  RoutingClass,
  TriggerAdapter,
  TriggerDeclaration,
} from './types';

/**
 * The default baseline mapping enablement when the routing options do not
 * specify one — the conservative, observe-only posture (Req 10.2, 3.4).
 */
export const DEFAULT_BASELINE_MAPPING_STATE: MappingEnablement = 'disabled';

/** Matches characters outside the CloudFormation logical-id-safe set. */
const NON_ID_SAFE_CHARS = /[^A-Za-z0-9]/g;

/**
 * Stream-source starting position used for benchmark mappings (Kinesis,
 * DynamoDB Streams, Kafka). `LATEST` is deterministic for benchmark-generated
 * traffic: the mapping reads only records produced after it is enabled, so a
 * run never replays unrelated historical records.
 */
export const BENCHMARK_STREAM_STARTING_POSITION = 'LATEST';

/**
 * The synth-time properties shared by both variant mappings, expressed as the
 * subset of `CfnEventSourceMappingProps` an adapter sets. Kept as a partial
 * record so each adapter passes exactly the source-specific props it needs.
 */
export interface SharedMappingConfig {
  /** The ARN of the isolated benchmark event source (queue/stream/cluster). */
  readonly eventSourceArn?: string;
  /** Stream starting position (Kinesis/DynamoDB Streams/Kafka). */
  readonly startingPosition?: string;
  /** Batch size for batched sources. */
  readonly batchSize?: number;
  /** Kafka topic list (MSK/self-managed). */
  readonly topics?: ReadonlyArray<string>;
  /**
   * Additional raw `CfnEventSourceMappingProps` applied to BOTH variant
   * mappings (e.g. Amazon MSK `amazonManagedKafkaEventSourceConfig`). Adapter
   * authors use this escape hatch for source-specific config the typed fields
   * above do not cover; the base still owns `functionName` and `enabled`.
   */
  readonly extraProps?: Partial<CfnEventSourceMappingProps>;
  /**
   * A per-variant override of the raw props, keyed by variant. Used by adapters
   * whose two variants must differ — e.g. Kafka with a distinct consumer group
   * per variant (fan-out) sets a different consumer-group id for kata vs
   * baseline.
   */
  readonly perVariantProps?: {
    readonly kata?: Partial<CfnEventSourceMappingProps>;
    readonly baseline?: Partial<CfnEventSourceMappingProps>;
  };
}

/**
 * The abstract base every concrete per-trigger adapter extends (Req 9.3).
 *
 * @typeParam T - The specific {@link TriggerDeclaration} the adapter handles.
 */
export abstract class AbstractTriggerAdapter<T extends TriggerDeclaration>
  implements TriggerAdapter<T> {
  /** The trigger discriminant this adapter handles (Req 9.2). */
  public abstract readonly type: T['type'];

  /**
   * Routing class for the declaration, delegated to the single source of truth
   * {@link classifyRouting} so the routing taxonomy is never duplicated (Req 8).
   *
   * @param declaration - The trigger declaration to classify.
   * @returns The trigger's routing class.
   */
  public routingClass(declaration: T): RoutingClass {
    return classifyRouting(declaration);
  }

  /**
   * Provision the isolated benchmark source and attach both variants with the
   * kata mapping disabled (Req 9.3–9.6, 10.1, 10.2).
   *
   * @param context - The synth-time context (scope, variant functions, alias).
   * @param declaration - The typed trigger declaration.
   */
  public abstract provision(
    context: AdapterSynthContext,
    declaration: T,
  ): ReturnType<TriggerAdapter<T>['provision']>;

  /**
   * Resolve the construct scope benchmark resources are created within,
   * enforcing the precondition that a source-creating adapter received one.
   *
   * @param context - The synth-time context.
   * @returns The construct scope.
   * @throws If `context.scope` is absent.
   */
  protected requireScope(context: AdapterSynthContext): Construct {
    if (context.scope === undefined) {
      throw new Error(
        `TriggerAdapter "${this.type}" requires an AdapterSynthContext.scope to create ` +
        `benchmark-owned resources for baseline "${context.baselineConstructPath}".`,
      );
    }
    return context.scope;
  }

  /**
   * Resolve the transformed Kata_Variant function, enforcing the precondition
   * that a source-creating adapter received one.
   *
   * @param context - The synth-time context.
   * @returns The kata function.
   * @throws If `context.kataFunction` is absent.
   */
  protected requireKataFunction(context: AdapterSynthContext): IFunction {
    if (context.kataFunction === undefined) {
      throw new Error(
        `TriggerAdapter "${this.type}" requires an AdapterSynthContext.kataFunction to ` +
        `attach the benchmark source for baseline "${context.baselineConstructPath}".`,
      );
    }
    return context.kataFunction;
  }

  /**
   * A CloudFormation-logical-id-safe, unique id fragment for the baseline,
   * used to namespace benchmark resource construct ids so multiple variants in
   * one scope never collide.
   *
   * @param context - The synth-time context.
   * @returns The sanitized variant id fragment.
   */
  protected variantIdOf(context: AdapterSynthContext): string {
    const raw = context.variantId ?? context.baselineConstructPath;
    const sanitized = raw.replace(NON_ID_SAFE_CHARS, '');
    return sanitized.length > 0 ? sanitized : 'Variant';
  }

  /**
   * The function-target reference the kata mapping/subscription points at: the
   * SnapStart alias ARN when supplied (so SnapStart is exercised, Req 7), else
   * the unqualified clone function ARN.
   *
   * @param context - The synth-time context.
   * @returns The kata invoke-target reference.
   */
  protected kataTargetRef(context: AdapterSynthContext): string {
    const kataFunction = this.requireKataFunction(context);
    return context.kataAliasArnRef ?? kataFunction.functionArn;
  }

  /**
   * Create the kata (disabled) and optional baseline event source mappings for
   * a poll-based source and return their UUID attribute tokens (Req 10.1–10.4).
   *
   * The kata mapping is ALWAYS `Enabled: false` (Req 10.2). The baseline mapping
   * is created only when a baseline function is supplied, in the routing-driven
   * state (defaulting to disabled, Req 10.2, 3.4). Both mappings attach to the
   * SAME isolated benchmark source; neither touches the baseline's pre-existing
   * production mappings (Property 4, Req 3.2).
   *
   * @param context - The synth-time context.
   * @param config - Source-specific mapping properties (event source ARN,
   *   starting position, topics, batch size).
   * @returns The kata (and optional baseline) mapping UUID attribute tokens.
   */
  protected createVariantMappings(
    context: AdapterSynthContext,
    config: SharedMappingConfig,
  ): AdapterMappingRefs {
    const scope = this.requireScope(context);
    const variantId = this.variantIdOf(context);

    const kataMapping = this.createMapping(
      scope,
      `${variantId}KataMapping`,
      this.kataTargetRef(context),
      false, // kata is ALWAYS disabled by default (Req 10.2, 3.3).
      config,
      config.perVariantProps?.kata,
    );

    if (context.baselineFunction === undefined) {
      return { kataMappingUuid: kataMapping.attrId };
    }

    const baselineState = context.baselineMappingState ?? DEFAULT_BASELINE_MAPPING_STATE;
    const baselineMapping = this.createMapping(
      scope,
      `${variantId}BaselineMapping`,
      context.baselineFunction.functionArn,
      baselineState === 'enabled', // baseline state per routing options (Req 10.1, 10.2).
      config,
      config.perVariantProps?.baseline,
    );

    return {
      kataMappingUuid: kataMapping.attrId,
      baselineMappingUuid: baselineMapping.attrId,
    };
  }

  /**
   * Create a single `AWS::Lambda::EventSourceMapping` targeting a variant.
   *
   * @internal
   */
  private createMapping(
    scope: Construct,
    id: string,
    functionTarget: string,
    enabled: boolean,
    config: SharedMappingConfig,
    variantProps?: Partial<CfnEventSourceMappingProps>,
  ): CfnEventSourceMapping {
    return new CfnEventSourceMapping(scope, id, {
      ...config.extraProps,
      ...variantProps,
      functionName: functionTarget,
      enabled,
      ...(config.eventSourceArn !== undefined ? { eventSourceArn: config.eventSourceArn } : {}),
      ...(config.startingPosition !== undefined
        ? { startingPosition: config.startingPosition }
        : {}),
      ...(config.batchSize !== undefined ? { batchSize: config.batchSize } : {}),
      ...(config.topics !== undefined ? { topics: [...config.topics] } : {}),
    });
  }

  /**
   * Create a fresh `AWS::Lambda::Permission` granting a push-source principal
   * (SNS, EventBridge) invoke access to a variant target (Req 7.3).
   *
   * @param scope - The construct scope to create the permission within.
   * @param id - The permission construct id.
   * @param functionTarget - The variant invoke target (alias ARN or function ARN).
   * @param principal - The invoking service principal.
   * @param sourceArn - The ARN of the source permitted to invoke, when scoped.
   * @returns The created permission.
   */
  protected createInvokePermission(
    scope: Construct,
    id: string,
    functionTarget: string,
    principal: string,
    sourceArn?: string,
  ): CfnPermission {
    return new CfnPermission(scope, id, {
      action: 'lambda:InvokeFunction',
      principal,
      functionName: functionTarget,
      ...(sourceArn !== undefined ? { sourceArn } : {}),
    });
  }
}

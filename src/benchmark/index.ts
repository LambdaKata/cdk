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
 * Public surface of the Lambda Kata Benchmark Harness.
 *
 * This is an ADDITIVE layer on top of `@lambdakata/cdk`: it exports the
 * `kataBench` entry point and its typed option/result surface without removing
 * or renaming any pre-existing library export. Run-time-only subsystems live
 * under `./runner` and are imported by the standalone CLI, not from this synth
 * surface, to keep the run-time package free of `aws-cdk-lib`.
 *
 * @remarks
 * Validates: Requirements 2.2, 2.4
 *
 * @module benchmark
 */

// Layer A — entry point + typed options surface.
export { kataBench } from './kata-bench';
export type { KataBenchResult, VariantPair, SkippedLambda } from './kata-bench';

export {
  FidelityLevel,
  resolveKataBenchOptions,
  DEFAULT_FIDELITY_LEVEL,
  DEFAULT_SIDE_EFFECT_POLICY,
  DEFAULT_ROLE_MODE,
  DEFAULT_EXTERNAL_RESOURCE_DISPOSITION,
  DEFAULT_NAME_SUFFIX,
  DEFAULT_OWNERSHIP_TAG_KEY,
  DEFAULT_TARGET_SELECTOR,
} from './options';
export type {
  KataBenchOptions,
  ResolvedKataBenchOptions,
  ResolvedLifecycleOptions,
  LifecycleOptions,
  SideEffectPolicy,
  RoleMode,
  PreflightDisposition,
  TargetSelector,
  FindingAcknowledgement,
  ProductionShadowOptions,
  ResolvedProductionShadowOptions,
} from './options';

export { resolveFidelityPlan, FidelityGateError } from './fidelity';
export type {
  FidelityPlan,
  FidelityHandlerStrategy,
  FidelityDependencyStrategy,
} from './fidelity';

// Layer B — discovery, eligibility, naming, clone, invoke-path.
export { discoverLambdas, LambdaDiscoveryError } from './discovery';
export type { DiscoveredLambda } from './discovery';

export { classify } from './eligibility';
export type { Eligibility, EligibilityReason, EligibilityReasonCode, EligibilityResult } from './eligibility';

export {
  resolveCloneName,
  NamingResolver,
  MAX_LAMBDA_FUNCTION_NAME_LENGTH,
  DEFAULT_CLONE_NAME_SUFFIX,
  DEFAULT_CLONE_NAME_HASH_LENGTH,
} from './naming';
export type { NamingResolverOptions } from './naming';

export { materializeCloneFunction, readBaselineFunctionProps, buildKataClone } from './clone-builder';
export type {
  BaselineFunctionProps,
  CloneEligibilityWarning,
  CloneMaterializationOptions,
  CloneMaterializationResult,
  BuildKataCloneOptions,
  KataCloneResult,
} from './clone-builder';

export { rewriteInvokePaths, DEFAULT_KATA_ALIAS_NAME } from './invoke-path-rewriter';
export type {
  InvokePathRewriteResult,
  VariantContext,
  FreshInvokePermissionSpec,
} from './invoke-path-rewriter';

// Layer C — triggers, routing, safety, manifest.
export type {
  RoutingClass,
  IsolationStrategy,
  LoadProfile,
  ResourceRef,
  TriggerBase,
  TriggerDeclaration,
  TriggerType,
  InvokeTrigger,
  ApiGatewayTrigger,
  FunctionUrlTrigger,
  SqsTrigger,
  EventBridgeTrigger,
  SnsTrigger,
  KinesisTrigger,
  DynamoDbStreamsTrigger,
  KafkaTrigger,
  TriggerAdapter,
  AdapterSynthContext,
  AdapterProvisionResult,
} from './triggers/types';

export { TriggerAdapterRegistry, TriggerAdapterRegistryError, TriggerAdapterRegistryErrorCode } from './triggers/registry';
export type { TriggerAdapterFor } from './triggers/registry';

export type {
  MappingEnablement,
  AdapterMappingRefs,
} from './triggers/types';

export { AbstractTriggerAdapter, DEFAULT_BASELINE_MAPPING_STATE, BENCHMARK_STREAM_STARTING_POSITION } from './triggers/adapter-base';
export type { SharedMappingConfig } from './triggers/adapter-base';

export { createDefaultTriggerAdapterRegistry } from './triggers/default-registry';

export { InvokeTriggerAdapter } from './triggers/invoke';
export { ApiGatewayTriggerAdapter } from './triggers/apigw';
export { FunctionUrlTriggerAdapter } from './triggers/function-url';
export { SqsTriggerAdapter } from './triggers/sqs';
export { EventBridgeTriggerAdapter } from './triggers/eventbridge';
export { SnsTriggerAdapter } from './triggers/sns';
export { KinesisTriggerAdapter } from './triggers/kinesis';
export { DynamoDbStreamsTriggerAdapter } from './triggers/dynamodb-streams';
export { KafkaTriggerAdapter } from './triggers/kafka';

export { classifyRouting, executionIntentFor, routeTrigger } from './routing';
export type { ExecutionMode, ExecutionIntent, RoutedTrigger } from './routing';

export { evaluateSideEffectGate, SideEffectPolicyGate, isParallelSafePolicy, PARALLEL_SAFE_POLICIES } from './side-effect-gate';
export type {
  SideEffectGateDecision,
  SideEffectGateRequest,
  SideEffectGateResolution,
  SideEffectRunDesignContribution,
  ParallelSafePolicy,
} from './side-effect-gate';

export {
  auditPreflight,
  classifyResourceOwnership,
  collectOwnedLogicalIds,
  computeEnablement,
  resolveFindingDisposition,
  FIXED_PHYSICAL_NAME_DISPOSITION,
  EXPENSIVE_STATEFUL_RESOURCE_DISPOSITION,
} from './preflight';
export type {
  PreflightFinding,
  PreflightFindingKind,
  ResourceOwnership,
  CfnReference,
  PreflightCandidateBase,
  WriteTargetCandidate,
  EventSourceCandidate,
  FixedPhysicalNameCandidate,
  StatefulResourceCandidate,
  PreflightAuditRequest,
} from './preflight';

export { RunDesignAccumulator, buildBenchmarkManifest, serializeManifest, parseManifest, ManifestSchemaError, MANIFEST_SCHEMA_VERSION } from './manifest';
export type {
  ManifestStorageOptions,
  RunDesign,
  RunDesignInit,
  RunDesignEligibilityEntry,
  RunDesignTriggerRecord,
  TriggerCorrelation,
  SideEffectRunDesignSlice,
  BenchmarkManifest,
  ManifestSchemaVersion,
  BuildBenchmarkManifestInput,
  ManifestVariant,
  ManifestBaseline,
  ManifestKata,
  ManifestTrigger,
  ManifestWriteResult,
} from './manifest';

// Layer C — synth-time manifest writer (SSM/S3 body + CfnOutput pointer).
export {
  writeManifest,
  ManifestWriter,
  DEFAULT_MANIFEST_PARAMETER_PREFIX,
  SSM_INLINE_MAX_BYTES,
  MANIFEST_S3_OBJECT_KEY,
} from './manifest-writer';
export type { ManifestWriterProps } from './manifest-writer';

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
 * Layer A — `kataBench` orchestrator entry point (Req 1, 2, 3, 5, 12).
 *
 * `kataBench(stack, options)` wraps an already-constructed Target_Stack and
 * drives the synth-time benchmark pipeline by composing the Layer B/C
 * subsystems in the design's fixed order:
 *
 * ```
 * discover → classify → (skip unsupported, continue) → clone + kata()
 *   → invoke-path rewrite → naming → trigger provision → routing
 *   → side-effect gate → preflight → run-design accumulation → manifest write
 * ```
 *
 * It is **pure wiring**: every transformation, classification, routing, gating,
 * and persistence decision lives in its own already-tested subsystem
 * ({@link discoverLambdas}, {@link classify}, {@link buildKataClone},
 * {@link rewriteInvokePaths}, {@link NamingResolver}, the trigger adapter
 * registry, {@link routeTrigger}, {@link SideEffectPolicyGate},
 * {@link auditPreflight}, {@link RunDesignAccumulator} /
 * {@link buildBenchmarkManifest}, {@link writeManifest}). The orchestrator never
 * re-implements them, and it NEVER alters the do-not-touch public `kata()`
 * contract — the Lambda Kata transformation flows EXCLUSIVELY through
 * {@link buildKataClone} → `kata()` (AGENTS.md §10, Req 2.1, 21.1, 21.3).
 *
 * Conservative-by-default safety is preserved end-to-end: baselines are left
 * untouched (Req 1.4, 3.1), clones are created with their benchmark trigger
 * mappings disabled (Property 4, Req 3.3, 10.2), unsupported Lambdas are skipped
 * without aborting the run (Property 15, Req 5.8), external attachments are
 * default-denied by the preflight auditor (Property 11), and the L4
 * production-shadow tier is locked behind an explicit opt-in plus a kill switch
 * (Req 12.6).
 *
 * @remarks
 * Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.7, 3.1, 3.5, 3.6, 5.8, 12.1,
 * 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8
 *
 * @module benchmark/kata-bench
 */

import { Stack, Token } from 'aws-cdk-lib';
import { CfnFunction, IFunction } from 'aws-cdk-lib/aws-lambda';

import {
  resolveKataBenchOptions,
  type KataBenchOptions,
  type ResolvedKataBenchOptions,
  type TargetSelector,
} from './options';
import { resolveFidelityPlan, type FidelityPlan } from './fidelity';
import { discoverLambdas, type DiscoveredLambda } from './discovery';
import { classify, type EligibilityResult } from './eligibility';
import { buildKataClone, type KataCloneResult } from './clone-builder';
import { rewriteInvokePaths } from './invoke-path-rewriter';
import { NamingResolver } from './naming';
import { routeTrigger } from './routing';
import { SideEffectPolicyGate } from './side-effect-gate';
import { auditPreflight, collectOwnedLogicalIds, type PreflightFinding } from './preflight';
import {
  RunDesignAccumulator,
  buildBenchmarkManifest,
  type ManifestTrigger,
  type ManifestVariant,
  type TriggerCorrelation,
} from './manifest';
import { writeManifest } from './manifest-writer';
import { createDefaultTriggerAdapterRegistry } from './triggers/default-registry';
import type {
  AdapterProvisionResult,
  AdapterSynthContext,
  RoutingClass,
  TriggerDeclaration,
} from './triggers/types';

/** A baseline/kata variant pair produced by `kataBench`. */
export interface VariantPair {
  readonly baselineFunctionName: string;
  readonly kataFunctionName: string;
  /** `node.path` of the baseline. */
  readonly constructPath: string;
  readonly eligibility: EligibilityResult;
}

/** A Lambda that was discovered but skipped (e.g. unsupported) (Req 5.8). */
export interface SkippedLambda {
  readonly constructPath: string;
  readonly eligibility: EligibilityResult;
}

/** The handle returned by `kataBench` for tooling/tests. */
export interface KataBenchResult {
  /** Synth-stable id seed; the run id is finalised at run-time. */
  readonly benchRunId: string;
  readonly variants: ReadonlyArray<VariantPair>;
  readonly skipped: ReadonlyArray<SkippedLambda>;
  /** SSM parameter name holding the manifest S3 pointer. */
  readonly manifestParameterName: string;
  readonly findings: ReadonlyArray<PreflightFinding>;
}

/**
 * The fully-derived per-variant context the orchestrator accumulates as it
 * walks the pipeline, used to assemble the manifest at the end.
 *
 * @internal
 */
interface VariantBuild {
  readonly discovered: DiscoveredLambda;
  readonly eligibility: EligibilityResult;
  readonly clone: KataCloneResult;
  readonly trigger?: ManifestTrigger;
}

/**
 * Public entry point: walk `stack`, clone eligible Lambdas through the
 * unchanged `kata()` path, wire benchmark infrastructure, and emit the manifest
 * (Req 1.1).
 *
 * @param stack - The already-constructed Target_Stack to benchmark.
 * @param options - Optional, conservatively-defaulted configuration.
 * @returns A {@link KataBenchResult} describing the variants, skipped Lambdas,
 *   manifest pointer, and preflight findings.
 *
 * @throws If `stack` is not a CDK `Stack` (Req 1.7), or if fidelity L4 is
 *   requested without the explicit production-shadow opt-in (Req 12.6).
 */
export function kataBench(stack: Stack, options?: KataBenchOptions): KataBenchResult {
  // (Req 1.7) Validate the argument is a CDK Stack with a descriptive error that
  // names the offending argument, BEFORE any subsystem is engaged.
  if (!Stack.isStack(stack)) {
    throw new Error(
      'kataBench(stack, options): the `stack` argument must be a CDK Stack instance; ' +
      `received ${describeInvalidArgument(stack)}. Pass the already-constructed Target_Stack ` +
      'you want to benchmark.',
    );
  }

  const resolved = resolveKataBenchOptions(options);
  // (Req 12.6) Resolve the fidelity plan first; an L4 run without the explicit
  // production-shadow opt-in is rejected before any resource is synthesized.
  const fidelityPlan = resolveFidelityPlan(resolved.fidelity, resolved.productionShadow);

  const benchRunId = deriveBenchRunId(stack);
  const runDesign = new RunDesignAccumulator({
    fidelity: resolved.fidelity,
    sideEffectPolicy: resolved.sideEffectPolicy,
    roleMode: resolved.roleMode,
  });
  const naming = new NamingResolver({ suffix: resolved.nameSuffix });
  const gate = new SideEffectPolicyGate(resolved.sideEffectPolicy, resolved.acknowledgements);
  const registry = createDefaultTriggerAdapterRegistry();
  const triggersByPath = indexTriggersByTarget(resolved.triggers);
  const usedConstructIds = new Set<string>();

  // (Req 1.2) Discover every Lambda once; the traversal is deterministic.
  const discovered = discoverLambdas(stack);

  const variants: VariantBuild[] = [];
  const skipped: SkippedLambda[] = [];

  for (const lambda of discovered) {
    // (Req 5.1, 5.7) Classify and record EVERY discovered Lambda.
    const eligibility = classify(lambda);
    runDesign.recordEligibility(lambda.constructPath, eligibility);

    // (Req 5.8, Property 15) Unsupported Lambdas are skipped and recorded; the
    // run continues with the remaining Lambdas.
    if (eligibility.eligibility === 'unsupported') {
      skipped.push({ constructPath: lambda.constructPath, eligibility });
      continue;
    }

    // (Req 1.5) Honour an explicit targets subset: only clone selected Lambdas.
    if (!isTargeted(lambda, resolved.targets, stack)) {
      continue;
    }

    // The classifier only yields a non-`unsupported` result when an owned L1
    // definition is present, so this is a type-narrowing guard, not a branch
    // we expect to hit at run time.
    if (lambda.cfn === undefined) {
      continue;
    }

    const built = buildVariant({
      stack,
      lambda,
      cfn: lambda.cfn,
      eligibility,
      resolved,
      fidelityPlan,
      naming,
      gate,
      registry,
      runDesign,
      triggerDeclarations: triggersByPath.get(lambda.constructPath) ?? [],
      usedConstructIds,
    });
    variants.push(built);
  }

  // (Req 11) Preflight audit + (Req 13.6) side-effect policy/acknowledgements,
  // both folded into the Run_Design.
  const findings = runPreflight(stack, resolved, runDesign);
  runDesign.recordSideEffectContribution(gate.toRunDesign());

  // (Req 10.3, 10.4, 17.5) Assemble and persist the manifest; the CfnOutput
  // carries only the SSM pointer.
  const manifest = buildBenchmarkManifest({
    benchRunSeed: benchRunId,
    region: stack.region,
    ownershipTag: { key: resolved.lifecycle.ownershipTagKey, value: benchRunId },
    variants: variants.map((v) => toManifestVariant(v)),
    runDesign: runDesign.build(),
  });
  const { parameterName } = writeManifest(stack, manifest, resolved.manifest);

  return {
    benchRunId,
    variants: variants.map((v) => toVariantPair(v)),
    skipped,
    manifestParameterName: parameterName,
    findings,
  };
}

/** The dependencies threaded into {@link buildVariant}. */
interface BuildVariantArgs {
  readonly stack: Stack;
  readonly lambda: DiscoveredLambda;
  readonly cfn: CfnFunction;
  readonly eligibility: EligibilityResult;
  readonly resolved: ResolvedKataBenchOptions;
  readonly fidelityPlan: FidelityPlan;
  readonly naming: NamingResolver;
  readonly gate: SideEffectPolicyGate;
  readonly registry: ReturnType<typeof createDefaultTriggerAdapterRegistry>;
  readonly runDesign: RunDesignAccumulator;
  readonly triggerDeclarations: ReadonlyArray<TriggerDeclaration>;
  readonly usedConstructIds: Set<string>;
}

/**
 * Build a single Kata_Variant: clone + kata() → invoke-path rewrite → trigger
 * provision → routing → side-effect gate → run-design recording (Req 4, 7, 8,
 * 9, 10, 13, 14).
 *
 * @internal
 */
function buildVariant(args: BuildVariantArgs): VariantBuild {
  const { stack, lambda, cfn, eligibility, resolved, fidelityPlan, naming, runDesign } = args;

  const cloneId = uniqueConstructId(args.usedConstructIds, lambda.constructPath);

  // (Req 2.1, 4, 14, 21) Clone from L1 and transform through the ONLY path:
  // kata(). The baseline is never read or mutated by this call.
  const clone = buildKataClone(stack, cloneId, cfn, resolved.roleMode, {
    naming,
    identity: lambda.constructPath,
  });

  // (Req 14.4, 14.5, Property 9) Record env var KEYS copied — never values.
  runDesign.recordEnvKeys(lambda.constructPath, clone.envKeysCopied);

  // (Req 7, Property 14) Repoint the clone's invoke paths off $LATEST onto the
  // SnapStart alias. Only meaningful for a transformed clone (an unentitled
  // `warn` clone has no alias); an untransformed clone keeps no invoke paths.
  if (clone.transformed && clone.aliasArnRef !== undefined) {
    rewriteInvokePaths({ cloneFunction: clone.cloneFunction }, clone.aliasArnRef);
  }

  // Trigger provisioning is suppressed when benchmark routing is disabled (the
  // L4 kill switch, Req 12.6) or when the clone was not transformed (no alias to
  // target). Either way the variant + manifest are still produced.
  const trigger =
    fidelityPlan.benchmarkRoutingEnabled && clone.transformed && clone.aliasArnRef !== undefined
      ? provisionTriggers({ ...args, clone, cloneId })
      : undefined;

  return { discovered: lambda, eligibility, clone, ...(trigger !== undefined ? { trigger } : {}) };
}

/** Args for {@link provisionTriggers}. */
interface ProvisionTriggersArgs extends BuildVariantArgs {
  readonly clone: KataCloneResult;
  readonly cloneId: string;
}

/**
 * Provision the declared triggers for a variant: route each, evaluate the
 * side-effect gate, provision the isolated benchmark source with disabled
 * mappings, and record routing into the Run_Design (Req 8, 9, 10, 13).
 *
 * The first successfully-provisioned trigger becomes the variant's manifest
 * trigger; every declaration is recorded in the Run_Design `perTrigger` slice.
 *
 * @internal
 */
function provisionTriggers(args: ProvisionTriggersArgs): ManifestTrigger | undefined {
  const { stack, lambda, clone, cloneId, gate, registry, runDesign, resolved } = args;

  let manifestTrigger: ManifestTrigger | undefined;

  for (const declaration of args.triggerDeclarations) {
    const routed = routeTrigger(declaration);

    // (Req 13) Evaluate the gate so the run-time attachment decision and the
    // acknowledgement requirement are computed against the declared policy. The
    // synth-time mappings are created disabled regardless (Property 4), so this
    // never enables anything unsafe at synth time.
    const attachesToProductionSource = declaration.isolation === 'attach-existing';
    gate.evaluate({
      routingClass: routed.routingClass,
      attachesToProductionSource,
    });

    const adapter = registry.tryResolve(declaration.type);
    let provision: AdapterProvisionResult;
    if (adapter === undefined) {
      // (Req 9.7) Unsupported trigger type — record detached, leave clone inert.
      provision = {
        routingClass: routed.routingClass,
        isolated: false,
        detached: true,
        detachedReason: `No adapter registered for trigger type "${declaration.type}".`,
      };
    } else {
      const context = buildAdapterContext({
        stack,
        baselineConstructPath: lambda.constructPath,
        variantId: cloneId,
        clone,
        baselineFunction: asFunction(lambda),
      });
      provision = adapter.provision(context, declaration as never);
    }

    // (Req 8, Req 19) Record the per-trigger routing/correlation decision.
    runDesign.recordTriggerRouting({
      path: lambda.constructPath,
      type: declaration.type,
      routingClass: provision.routingClass,
      correlation: correlationFor(provision.routingClass),
    });

    // The first non-detached provisioning result drives the manifest trigger.
    if (manifestTrigger === undefined && provision.detached !== true) {
      manifestTrigger = toManifestTrigger(declaration, provision);
    }
  }

  void resolved;
  return manifestTrigger;
}

/** Args for {@link buildAdapterContext}. */
interface AdapterContextArgs {
  readonly stack: Stack;
  readonly baselineConstructPath: string;
  readonly variantId: string;
  readonly clone: KataCloneResult;
  readonly baselineFunction?: IFunction;
}

/**
 * Assemble the {@link AdapterSynthContext} for a trigger adapter. The kata
 * mapping targets the SnapStart alias (Req 7); the baseline mapping defaults to
 * disabled (the conservative observe-only posture, Req 3.4, 10.2).
 *
 * @internal
 */
function buildAdapterContext(args: AdapterContextArgs): AdapterSynthContext {
  return {
    scope: args.stack,
    baselineConstructPath: args.baselineConstructPath,
    variantId: args.variantId,
    kataFunction: args.clone.cloneFunction,
    ...(args.baselineFunction !== undefined ? { baselineFunction: args.baselineFunction } : {}),
    ...(args.clone.aliasArnRef !== undefined ? { kataAliasArnRef: args.clone.aliasArnRef } : {}),
    baselineMappingState: 'disabled',
  };
}

/**
 * Run the preflight safety audit and fold its findings into the Run_Design
 * (Req 11). Task 14 wires the in-template ownership inventory and the default
 * disposition/acknowledgements; richer candidate discovery (external write
 * targets, attach-existing event sources) is layered by later orchestration.
 * With the default isolated-source path no external attachment exists, so the
 * audit is correctly empty (Property 11, default-deny).
 *
 * @internal
 */
function runPreflight(
  stack: Stack,
  resolved: ResolvedKataBenchOptions,
  runDesign: RunDesignAccumulator,
): ReadonlyArray<PreflightFinding> {
  const findings = auditPreflight({
    ownedLogicalIds: collectOwnedLogicalIds(stack),
    externalResourceDisposition: resolved.externalResourceDisposition,
    acknowledgements: resolved.acknowledgements,
  });
  for (const finding of findings) {
    runDesign.recordFinding(finding);
  }
  return findings;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Index trigger declarations by their target baseline `node.path` so each
 * variant can resolve its own declarations in O(1) (Req 9).
 *
 * @internal
 */
function indexTriggersByTarget(
  triggers: ReadonlyArray<TriggerDeclaration>,
): Map<string, TriggerDeclaration[]> {
  const byPath = new Map<string, TriggerDeclaration[]>();
  for (const trigger of triggers) {
    const existing = byPath.get(trigger.target);
    if (existing === undefined) {
      byPath.set(trigger.target, [trigger]);
    } else {
      existing.push(trigger);
    }
  }
  return byPath;
}

/**
 * Decide whether a discovered Lambda is selected by the targets subset
 * (Req 1.5). `all` selects everything; `paths` / `functionNames` match by the
 * baseline's stable identity / readable physical name; `predicate` defers to the
 * caller-supplied function.
 *
 * @internal
 */
function isTargeted(
  lambda: DiscoveredLambda,
  targets: TargetSelector,
  stack: Stack,
): boolean {
  switch (targets.type) {
    case 'all':
      return true;
    case 'paths':
      return targets.constructPaths.includes(lambda.constructPath);
    case 'functionNames': {
      const name = readableFunctionName(lambda, stack);
      return name !== undefined && targets.functionNames.includes(name);
    }
    case 'predicate':
      return targets.predicate(lambda);
    default:
      return assertExhaustiveSelector(targets);
  }
}

/**
 * The baseline's readable physical function name, when the L1 `functionName` is
 * a concrete literal (an unresolved token cannot be matched by name).
 *
 * @internal
 */
function readableFunctionName(lambda: DiscoveredLambda, stack: Stack): string | undefined {
  const name = lambda.cfn?.functionName;
  if (name === undefined) {
    return undefined;
  }
  const resolved = stack.resolve(name) as unknown;
  return typeof resolved === 'string' && !Token.isUnresolved(resolved) ? resolved : undefined;
}

/**
 * The run-time correlation strategy a routing class implies (Req 19): synchronous
 * request-response triggers carry a per-invocation marker; poll/push sources are
 * window-correlated. The authoritative correlation is finalised by the run-time
 * TraceCorrelator (task 18); this is the synth-time recorded intent.
 *
 * @internal
 */
function correlationFor(routingClass: RoutingClass): TriggerCorrelation {
  return routingClass === 'request-response' ? 'invocation' : 'window';
}

/**
 * Narrow a discovered Lambda's owning construct to an `IFunction` for adapter
 * wiring; owned (non-imported) discoveries are always `lambda.Function`s.
 *
 * @internal
 */
function asFunction(lambda: DiscoveredLambda): IFunction | undefined {
  return lambda.isImported ? undefined : (lambda.node as unknown as IFunction);
}

/**
 * Project a {@link VariantBuild} into the public {@link VariantPair}.
 *
 * @internal
 */
function toVariantPair(build: VariantBuild): VariantPair {
  return {
    baselineFunctionName: build.discovered.node.node.id,
    kataFunctionName: build.clone.cloneName,
    constructPath: build.discovered.constructPath,
    eligibility: build.eligibility,
  };
}

/**
 * Project a {@link VariantBuild} into a resolved {@link ManifestVariant}. Names
 * and ARNs may be CDK tokens; they are rendered into the deployed manifest body
 * by the {@link ManifestWriter} (Req 10.3, 10.4).
 *
 * @internal
 */
function toManifestVariant(build: VariantBuild): ManifestVariant {
  const baseline = build.discovered.node as unknown as IFunction;
  const clone = build.clone;

  return {
    constructPath: build.discovered.constructPath,
    baseline: {
      functionName: baseline.functionName,
      functionArn: baseline.functionArn,
      logGroup: `/aws/lambda/${baseline.functionName}`,
    },
    kata: {
      functionName: clone.cloneName,
      functionArn: clone.cloneFunction.functionArn,
      aliasArn: clone.aliasArnRef ?? '',
      version: clone.versionRef ?? '',
      logGroup: `/aws/lambda/${clone.cloneName}`,
    },
    ...(build.trigger !== undefined ? { trigger: build.trigger } : {}),
  };
}

/**
 * Project an adapter provisioning result into a {@link ManifestTrigger}
 * (Req 10.3, 10.4).
 *
 * @internal
 */
function toManifestTrigger(
  declaration: TriggerDeclaration,
  provision: AdapterProvisionResult,
): ManifestTrigger {
  return {
    type: declaration.type,
    routingClass: provision.routingClass,
    ...(provision.mappings?.baselineMappingUuid !== undefined
      ? { baselineMappingUuid: provision.mappings.baselineMappingUuid }
      : {}),
    ...(provision.mappings?.kataMappingUuid !== undefined
      ? { kataMappingUuid: provision.mappings.kataMappingUuid }
      : {}),
    source: { isolated: provision.isolated, ref: provision.sourceRef ?? '' },
  };
}

/**
 * Derive a synth-stable benchmark run id seed from the stack identity. Uses the
 * construct `node.addr` (a deterministic hash), so repeated synthesis of the
 * same stack yields the same seed; the final run id is minted at run-time.
 *
 * @internal
 */
function deriveBenchRunId(stack: Stack): string {
  return `bench-${stack.node.addr.slice(0, 16)}`;
}

/**
 * Derive a CloudFormation-logical-id-safe, stack-unique construct id for a clone
 * from its baseline `node.path`, disambiguating on the rare sanitised-collision.
 *
 * @internal
 */
function uniqueConstructId(used: Set<string>, constructPath: string): string {
  const base = `${constructPath.replace(/[^A-Za-z0-9]/g, '')}KataVariant`;
  let candidate = base;
  let index = 1;
  while (used.has(candidate)) {
    candidate = `${base}${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Describe an invalid (non-`Stack`) argument for the Req 1.7 error message
 * without throwing on exotic inputs.
 *
 * @internal
 */
function describeInvalidArgument(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  const constructorName = (value as { constructor?: { name?: string } })?.constructor?.name;
  return constructorName !== undefined ? `a value of type ${constructorName}` : `a ${typeof value}`;
}

/**
 * Compile-time exhaustiveness guard over {@link TargetSelector}.
 *
 * @internal
 */
function assertExhaustiveSelector(value: never): never {
  throw new Error(`Unhandled TargetSelector variant: ${JSON.stringify(value)}.`);
}

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
 * Layer B — CloneBuilder (Req 4, 14): L1 prop reader + clone materializer.
 *
 * This module owns the seam that lets the harness build a faithful
 * Kata_Variant from a Baseline_Variant's **synthesized L1 `CfnFunction`**
 * (Req 4.1) while preserving the do-not-touch public `kata()` contract
 * (AGENTS.md §10, Req 2). It is the **clone-from-L1 materializer only**; the
 * `kata(cloneL2, kataProps)` application is intentionally deferred to task 5.2,
 * and the {@link CloneMaterializationResult} is shaped so that step can call
 * `kata()` on {@link CloneMaterializationResult.cloneFunction} without any
 * change to the wrapper's signature.
 *
 * ## Why an L2 shell + L1 escape-hatch copy (the design seam)
 *
 * `kata()` requires a real L2 `lambda.Function` — it calls `addLayers`, reads
 * `node.defaultChild`, and passes the function as an `IFunction` to the
 * `SnapStartActivator`. The faithful L1 values, however, cannot all be
 * expressed through L2 abstractions: `vpcConfig` is subnet/SG **ids** (not an
 * `IVpc`), `role` is an **ARN string** (not an `IRole`), `fileSystemConfigs` are
 * access-point **ARNs**, and `kmsKeyArn` is a raw ARN. Reconstructing those as
 * L2 imports would either re-resolve to different physical values or fight CDK.
 *
 * The materializer therefore:
 *
 * 1. Builds a **minimal L2 `lambda.Function` shell** with placeholder inline
 *    code and an **imported execution role** ({@link RoleMode}-driven) so CDK
 *    does NOT synthesize a second default execution role for the clone.
 * 2. Transfers the baseline L1 props onto the clone's own `CfnFunction` via the
 *    escape hatch, reusing the **SAME** code asset reference (no re-upload,
 *    Req 4.5) and **SAME** role (Req 14.2) — copying `runtime`, `handler`,
 *    `environment`, `timeout`, `memorySize`, `architectures` (Req 4.2) and,
 *    when present, `ephemeralStorage`, `fileSystemConfigs`, `kmsKeyArn`,
 *    `tracingConfig`, `vpcConfig` (Req 4.3).
 * 3. Reuses the baseline **layers through the L2 API** (`addLayers`) so a later
 *    `kata().addLayers(...)` call in task 5.2 merges additively rather than
 *    overwriting.
 *
 * ## Documented L2-facade fallback (design note §CloneBuilder)
 *
 * Props that reference an external resource by raw id/ARN — `vpcConfig`,
 * `fileSystemConfigs`, `kmsKeyArn` — cannot be represented by the light L2
 * facade, so they are copied verbatim through the raw `CfnFunction` escape
 * hatch and EACH such prop is recorded as a {@link CloneEligibilityWarning}
 * (Req 4.6). This never alters `kata()`'s public signature; the warnings flow
 * into the Run_Design so the report is honest about what was reconstructed
 * faithfully vs. carried over raw.
 *
 * @remarks
 * Validates: Requirements 4.1, 4.2, 4.3, 4.5, 14.1, 14.2, 14.3
 *
 * @module benchmark/clone-builder
 */

import { Construct } from 'constructs';
import { Fn, Stack, Token } from 'aws-cdk-lib';
import {
  CfnFunction,
  Code,
  Function as LambdaFunction,
  LayerVersion,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { IRole, Role } from 'aws-cdk-lib/aws-iam';

import { kata, KataWrapperOptions } from '../kata-wrapper';
import { SnapStartActivator } from '../snapstart-construct';
import type { RoleMode } from './options';
import type { EligibilityReasonCode } from './eligibility';
import {
  DEFAULT_CLONE_NAME_SUFFIX,
  NamingResolver,
  resolveCloneName,
} from './naming';

/**
 * Placeholder source attached to the L2 shell before the real baseline code
 * asset is transferred over it via the escape hatch. It is never deployed: the
 * `CfnFunction.code` is overwritten with the baseline's asset reference in
 * {@link materializeCloneFunction}.
 *
 * @internal
 */
const CLONE_SHELL_PLACEHOLDER_CODE = 'exports.handler = async () => ({});';

/**
 * Placeholder handler/runtime for the L2 shell, overwritten with the baseline's
 * values during the L1 copy. A concrete Node.js runtime is used so the L2
 * `Function` validates at construction time before the escape-hatch copy.
 *
 * @internal
 */
const CLONE_SHELL_PLACEHOLDER_HANDLER = 'index.handler';

/**
 * The baseline L1 props the CloneBuilder reads and copies onto a Kata_Variant.
 *
 * This is a faithful, **read-only projection** of the baseline's synthesized
 * `CfnFunction`. Scalar/struct values are carried as-is (they may be concrete
 * literals or CDK tokens — both are copied verbatim so the clone resolves to
 * the SAME physical values as the baseline). The required props (Req 4.2) are
 * always present in the shape; the when-present props (Req 4.3) are optional
 * and omitted entirely when the baseline does not declare them.
 */
export interface BaselineFunctionProps {
  /** The baseline `Code` reference (asset/bucket/key); reused, never re-uploaded (Req 4.5). */
  readonly code: CfnFunction['code'];
  /** The baseline execution role ARN/ref; reused by default (Req 14.2). */
  readonly roleArn: CfnFunction['role'];
  /** The baseline handler string (e.g. `index.handler`). */
  readonly handler: CfnFunction['handler'];
  /** The baseline runtime (e.g. `nodejs20.x`). */
  readonly runtime: CfnFunction['runtime'];
  /** The baseline environment block (`{ variables: {...} }`). */
  readonly environment: CfnFunction['environment'];
  /** The baseline timeout in seconds. */
  readonly timeout: CfnFunction['timeout'];
  /** The baseline memory size in MB. */
  readonly memorySize: CfnFunction['memorySize'];
  /** The baseline architectures (e.g. `['arm64']`). */
  readonly architectures: CfnFunction['architectures'];
  /** Baseline ephemeral storage, when present (Req 4.3). */
  readonly ephemeralStorage?: CfnFunction['ephemeralStorage'];
  /** Baseline EFS file-system configs, when present (Req 4.3). */
  readonly fileSystemConfigs?: CfnFunction['fileSystemConfigs'];
  /** Baseline KMS key ARN, when present (Req 4.3). */
  readonly kmsKeyArn?: CfnFunction['kmsKeyArn'];
  /** Baseline tracing config, when present (Req 4.3). */
  readonly tracingConfig?: CfnFunction['tracingConfig'];
  /** Baseline VPC config (subnet/SG ids), when present (Req 4.3). */
  readonly vpcConfig?: CfnFunction['vpcConfig'];
}

/**
 * A warning recorded when the light L2 facade cannot faithfully represent a
 * baseline prop, so it is copied via the raw `CfnFunction` escape hatch instead
 * (design note §CloneBuilder, Req 4.6). The `code` reuses the
 * {@link EligibilityReasonCode} space so the Run_Design carries a single,
 * uniform warning vocabulary.
 */
export interface CloneEligibilityWarning {
  /** Stable machine-readable discriminator (subset of {@link EligibilityReasonCode}). */
  readonly code: Extract<EligibilityReasonCode, `l2-facade-fallback-${string}`>;
  /** Human-readable explanation safe to surface in the Run_Design. */
  readonly message: string;
}

/**
 * Options refining how a clone is materialized. All fields are optional; the
 * defaults reproduce the conservative `kataBench` behaviour (suffix `kata`,
 * a fresh stateless name derivation, reuse-role role handling).
 */
export interface CloneMaterializationOptions {
  /**
   * Stack-scoped naming authority (Req 6.3). When provided, the clone name is
   * resolved through it so names stay unique within the Target_Stack; when
   * omitted a stateless {@link resolveCloneName} derivation is used.
   */
  readonly naming?: NamingResolver;
  /** Distinguishing kata suffix used when {@link naming} is omitted (Req 6.1). */
  readonly nameSuffix?: string;
  /**
   * The Baseline_Variant function name to derive the clone name from. Defaults
   * to the baseline L1 `functionName` when readable, else the construct `id`.
   */
  readonly baselineName?: string;
  /**
   * The baseline construct identity (`node.path`) seeding the deterministic
   * tail hash (Req 6.4). Defaults to the clone construct path when omitted.
   */
  readonly identity?: string;
  /**
   * The user-supplied execution role assigned to the clone when
   * {@link RoleMode} is `provided-role` (Req 14.3). Required in that mode.
   */
  readonly providedRole?: IRole;
}

/**
 * The result of materializing a clone, shaped so task 5.2 can call
 * `kata(result.cloneFunction, kataProps)` directly.
 */
export interface CloneMaterializationResult {
  /** The materialized clone, ready for the `kata()` transformation (5.2). */
  readonly cloneFunction: LambdaFunction;
  /** The resolved, length-safe, collision-free clone function name (Req 6). */
  readonly cloneName: string;
  /** The reused/assigned execution role of the clone (Req 14). */
  readonly role: IRole;
  /**
   * Environment variable KEYS copied onto the clone — never their values
   * (Req 14.4, 14.5). Recorded into the Run_Design by the orchestrator.
   */
  readonly envKeysCopied: ReadonlyArray<string>;
  /** L2-facade fallback warnings, one per leaky prop carried raw (Req 4.6). */
  readonly warnings: ReadonlyArray<CloneEligibilityWarning>;
}

/**
 * Read the Baseline_Variant's synthesized L1 props that the CloneBuilder copies
 * onto a Kata_Variant (Req 4.2, 4.3).
 *
 * The reader is a pure projection: it performs no synthesis side effects and
 * does not mutate the baseline. When-present props (Req 4.3) are included only
 * if the baseline declares them, so {@link materializeCloneFunction} can copy
 * exactly the props that exist and omit the rest.
 *
 * @param l1 - The Baseline_Variant's synthesized `CfnFunction`.
 * @returns The read-only projection of the baseline's clone-relevant props.
 */
export function readBaselineFunctionProps(l1: CfnFunction): BaselineFunctionProps {
  return {
    code: l1.code,
    roleArn: l1.role,
    handler: l1.handler,
    runtime: l1.runtime,
    environment: l1.environment,
    timeout: l1.timeout,
    memorySize: l1.memorySize,
    architectures: l1.architectures,
    ...(l1.ephemeralStorage !== undefined ? { ephemeralStorage: l1.ephemeralStorage } : {}),
    ...(l1.fileSystemConfigs !== undefined ? { fileSystemConfigs: l1.fileSystemConfigs } : {}),
    ...(l1.kmsKeyArn !== undefined ? { kmsKeyArn: l1.kmsKeyArn } : {}),
    ...(l1.tracingConfig !== undefined ? { tracingConfig: l1.tracingConfig } : {}),
    ...(l1.vpcConfig !== undefined ? { vpcConfig: l1.vpcConfig } : {}),
  };
}

/**
 * Materialize a Kata_Variant clone as a sibling `lambda.Function` from the
 * baseline's synthesized L1 definition (Req 4.1, 4.2, 4.3), reusing the SAME
 * code asset and SAME role (Req 4.5, 14.2) and named via the
 * {@link NamingResolver} (Req 6).
 *
 * The returned {@link CloneMaterializationResult.cloneFunction} is a real L2
 * `lambda.Function` ready for `kata()` — task 5.2 applies the transformation;
 * this function does NOT call `kata()` and does NOT alter its signature.
 *
 * @param scope - The construct scope (the Target_Stack or a child) the clone is
 *   placed within, making it a sibling of its baseline.
 * @param id - The construct id for the clone.
 * @param l1 - The Baseline_Variant's synthesized `CfnFunction`.
 * @param roleMode - How the clone's execution role is derived (Req 14.1).
 * @param options - Optional naming/role refinements.
 * @returns The materialized clone plus recorded env keys and fallback warnings.
 *
 * @throws If `roleMode` is `provided-role` and no `providedRole` is supplied
 *   (Req 14.3), or if the baseline role ARN is unreadable for an import-based
 *   mode.
 */
export function materializeCloneFunction(
  scope: Construct,
  id: string,
  l1: CfnFunction,
  roleMode: RoleMode,
  options: CloneMaterializationOptions = {},
): CloneMaterializationResult {
  const props = readBaselineFunctionProps(l1);

  // 1. Resolve the clone's execution role per the role-handling mode (Req 14).
  const role = resolveCloneRole(scope, id, props.roleArn, roleMode, options.providedRole);

  // 2. Build the minimal L2 shell. Providing `role` here prevents CDK from
  //    synthesizing a second default execution role for the clone (Req 4.5).
  const cloneFunction = new LambdaFunction(scope, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: CLONE_SHELL_PLACEHOLDER_HANDLER,
    code: Code.fromInline(CLONE_SHELL_PLACEHOLDER_CODE),
    role,
  });
  const cloneCfn = cloneFunction.node.defaultChild as CfnFunction;

  // 3. Transfer the required baseline props via the escape hatch (Req 4.2).
  //    The code reference is reused as-is — the SAME asset/bucket/key — so no
  //    new asset is uploaded (Req 4.5).
  cloneCfn.code = props.code;
  cloneCfn.handler = props.handler;
  cloneCfn.runtime = props.runtime;
  cloneCfn.environment = props.environment;
  cloneCfn.timeout = props.timeout;
  cloneCfn.memorySize = props.memorySize;
  cloneCfn.architectures = props.architectures;

  // 4. Copy the when-present props (Req 4.3). The leaky ones (external
  //    resources referenced by raw id/ARN) are carried via this same raw
  //    escape hatch and recorded as L2-facade fallback warnings (Req 4.6).
  const warnings = copyWhenPresentProps(cloneCfn, props);

  // 5. Reuse baseline layers through the L2 API so a later kata().addLayers()
  //    (task 5.2) merges additively (Req 4.2 layers; kata() compatibility).
  reuseBaselineLayers(scope, id, cloneFunction, l1.layers);

  // 6. Resolve the clone name through the NamingResolver and pin it on the L1
  //    (Req 6). Done last so the readable name reflects the final identity.
  const cloneName = resolveName(scope, id, l1, options);
  cloneCfn.functionName = cloneName;

  return {
    cloneFunction,
    cloneName,
    role,
    envKeysCopied: extractEnvKeys(scope, props.environment),
    warnings,
  };
}

/**
 * Resolve the clone's execution role according to the role-handling mode
 * (Req 14.1–14.3).
 *
 * - `reuse-role` / `clone-role` import the baseline role by ARN. The import is
 *   marked mutable for `clone-role` (so later policy additions are permitted on
 *   the clone's copy of the role) and immutable for `reuse-role` (the clone
 *   must not mutate the baseline's shared role). Neither mode creates a new
 *   `AWS::IAM::Role` (Req 4.5, 14.2).
 * - `provided-role` assigns the user-supplied role (Req 14.3).
 *
 * @internal
 */
function resolveCloneRole(
  scope: Construct,
  id: string,
  baselineRoleArn: CfnFunction['role'],
  roleMode: RoleMode,
  providedRole?: IRole,
): IRole {
  if (roleMode === 'provided-role') {
    if (providedRole === undefined) {
      throw new Error(
        'materializeCloneFunction: roleMode "provided-role" requires options.providedRole ' +
        'to be supplied (Req 14.3).',
      );
    }
    return providedRole;
  }

  if (baselineRoleArn === undefined) {
    throw new Error(
      `materializeCloneFunction: cannot derive the clone role for "${id}" because the ` +
      'baseline L1 has no readable role ARN; supply a provided-role instead (Req 14).',
    );
  }

  // `reuse-role` shares the baseline role read-only; `clone-role` imports it as
  // a mutable copy so the clone may receive its own policy additions later.
  const mutable = roleMode === 'clone-role';
  return Role.fromRoleArn(scope, `${id}Role`, baselineRoleArn, { mutable });
}

/**
 * Copy the when-present baseline props onto the clone L1 (Req 4.3) and record
 * an L2-facade fallback warning for each leaky prop carried raw (Req 4.6).
 *
 * `tracingConfig` and `ephemeralStorage` are plain self-contained structs the
 * facade represents faithfully, so they are copied without a warning.
 * `vpcConfig`, `fileSystemConfigs`, and `kmsKeyArn` reference external
 * resources by raw id/ARN and are the documented fallback cases.
 *
 * @internal
 */
function copyWhenPresentProps(
  cloneCfn: CfnFunction,
  props: BaselineFunctionProps,
): CloneEligibilityWarning[] {
  const warnings: CloneEligibilityWarning[] = [];

  if (props.ephemeralStorage !== undefined) {
    cloneCfn.ephemeralStorage = props.ephemeralStorage;
  }
  if (props.tracingConfig !== undefined) {
    cloneCfn.tracingConfig = props.tracingConfig;
  }

  if (props.vpcConfig !== undefined) {
    cloneCfn.vpcConfig = props.vpcConfig;
    warnings.push({
      code: 'l2-facade-fallback-vpc-config',
      message:
        'VpcConfig (subnet/security-group ids) was copied verbatim from the baseline L1 via ' +
        'the raw CfnFunction fallback; the clone shares the SAME VPC placement as the baseline.',
    });
  }
  if (props.fileSystemConfigs !== undefined) {
    cloneCfn.fileSystemConfigs = props.fileSystemConfigs;
    warnings.push({
      code: 'l2-facade-fallback-file-system-configs',
      message:
        'FileSystemConfigs (EFS access-point ARNs) were copied verbatim from the baseline L1 ' +
        'via the raw CfnFunction fallback; the clone mounts the SAME file system as the baseline.',
    });
  }
  if (props.kmsKeyArn !== undefined) {
    cloneCfn.kmsKeyArn = props.kmsKeyArn;
    warnings.push({
      code: 'l2-facade-fallback-kms-key',
      message:
        'KmsKeyArn was copied verbatim from the baseline L1 via the raw CfnFunction fallback; ' +
        'the clone uses the SAME KMS key as the baseline.',
    });
  }

  return warnings;
}

/**
 * Reuse the baseline layers on the clone through the L2 API (`addLayers`).
 *
 * Using the L2 API (rather than overwriting `cloneCfn.layers`) is deliberate:
 * the L2 `Function` renders `layers` lazily by concatenating every layer added
 * through `addLayers`, so a later `kata().addLayers(...)` call in task 5.2
 * MERGES additively instead of overwriting the reused baseline layers.
 *
 * The baseline `CfnFunction.layers` is, for an L2-owned baseline, a single CDK
 * **list-token sentinel** that resolves to the full ARN array — it is NOT an
 * enumerable array of ARNs at synth time. We therefore resolve it through the
 * stack to learn the element COUNT, then extract each element with
 * `Fn.select(i, listToken)` (a deploy-time-safe accessor) and import it
 * read-only via `LayerVersion.fromLayerVersionArn`. When the baseline declares
 * no layers (the value is absent, an unresolved non-list token, or resolves to
 * an empty list), nothing is added.
 *
 * @internal
 */
function reuseBaselineLayers(
  scope: Construct,
  id: string,
  cloneFunction: LambdaFunction,
  baselineLayers: CfnFunction['layers'],
): void {
  if (baselineLayers === undefined) {
    return;
  }

  const resolved = Stack.of(scope).resolve(baselineLayers) as unknown;
  if (!Array.isArray(resolved) || resolved.length === 0) {
    return;
  }

  for (let index = 0; index < resolved.length; index += 1) {
    // `Fn.select` over the original list token yields a per-element token that
    // resolves correctly at deploy time regardless of whether each entry is a
    // literal ARN or a `Ref`/`Fn::GetAtt` to an in-template layer version.
    const layerArn = Fn.select(index, baselineLayers as string[]);
    const imported = LayerVersion.fromLayerVersionArn(
      scope,
      `${id}ReusedLayer${index}`,
      layerArn,
    );
    cloneFunction.addLayers(imported);
  }
}

/**
 * Resolve the clone function name through the {@link NamingResolver} (Req 6).
 *
 * When a stack-scoped resolver is provided it is used (so names stay unique
 * within the Target_Stack, Req 6.3); otherwise a stateless deterministic
 * derivation is used. The baseline name defaults to the readable L1
 * `functionName`, falling back to the construct id when the name is an
 * unresolved token or absent; the identity defaults to the clone's construct
 * path so repeated synthesis is stable (Req 6.4).
 *
 * @internal
 */
function resolveName(
  scope: Construct,
  id: string,
  l1: CfnFunction,
  options: CloneMaterializationOptions,
): string {
  const readableFunctionName =
    l1.functionName !== undefined && !Token.isUnresolved(l1.functionName)
      ? l1.functionName
      : undefined;
  const baselineName = options.baselineName ?? readableFunctionName ?? id;
  const identity = options.identity ?? `${Stack.of(scope).node.path}/${id}`;

  if (options.naming !== undefined) {
    return options.naming.resolve(baselineName, identity);
  }

  const suffix = options.nameSuffix ?? DEFAULT_CLONE_NAME_SUFFIX;
  return resolveCloneName(baselineName, suffix, identity);
}

/**
 * Extract the set of environment variable KEYS from the baseline environment
 * block, never their values (Req 14.4, 14.5).
 *
 * The environment is resolved through the stack so a Lazy-rendered block
 * becomes plain JSON; only the `variables` object keys are returned. Values are
 * never read into the result, so no secret can leak into the Run_Design.
 *
 * @internal
 */
function extractEnvKeys(scope: Construct, environment: CfnFunction['environment']): string[] {
  if (environment === undefined) {
    return [];
  }
  const resolved = Stack.of(scope).resolve(environment) as
    | { variables?: Record<string, unknown> }
    | undefined;
  const variables = resolved?.variables;
  if (variables === undefined || variables === null || typeof variables !== 'object') {
    return [];
  }
  return Object.keys(variables);
}

/**
 * Options refining how a kata clone is built. Extends
 * {@link CloneMaterializationOptions} with the (optional) props threaded into
 * the unchanged public `kata()` transformation.
 */
export interface BuildKataCloneOptions extends CloneMaterializationOptions {
  /**
   * Options passed verbatim to the public `kata()` wrapper (e.g.
   * `unlicensedBehavior`). This is the ONLY transformation path; there is no
   * alternate path and no licensing bypass (Req 21.1, 21.3).
   */
  readonly kataProps?: KataWrapperOptions;
}

/**
 * The result of building a kata clone: the materialization data plus the
 * transformation outcome, shaped so the orchestrator (task 14) and the
 * Run_Design accumulator (task 12) can record it directly.
 *
 * It deliberately carries only run-design-relevant projections (env KEYS, role
 * mode, warnings, name, SnapStart alias/version refs, transformed flag) rather
 * than building a `RunDesign` itself — the accumulation lives in the
 * orchestrator, keeping this seam single-purpose.
 */
export interface KataCloneResult extends CloneMaterializationResult {
  /**
   * Whether the public `kata()` path actually transformed the clone. `false`
   * when the account is not entitled and `unlicensedBehavior` is `warn` — the
   * clone then keeps the copied baseline runtime/handler untransformed
   * (Req 21.2). There is no alternate transformation path (Req 21.1, 21.3).
   */
  readonly transformed: boolean;
  /** The role-handling mode applied to the clone, threaded for the Run_Design (Req 14.1). */
  readonly roleMode: RoleMode;
  /**
   * The clone's SnapStart alias ARN reference (CloudFormation attribute), for
   * the InvokePathRewriter (task 6) to target the alias rather than `$LATEST`
   * (Req 7). `undefined` when the clone was not transformed.
   */
  readonly aliasArnRef?: string;
  /**
   * The clone's published-version reference (CloudFormation attribute).
   * `undefined` when the clone was not transformed.
   */
  readonly versionRef?: string;
}

/**
 * Build a Kata_Variant by materializing a clone from the baseline L1 and then
 * applying the Lambda Kata transformation to it through the **unchanged public
 * `kata()` path** — the ONLY transformation path (Req 2.1, 4.4, 21.1, 21.3).
 *
 * This is the task 5.2 seam. It composes the two halves of the CloneBuilder:
 *
 * 1. {@link materializeCloneFunction} builds a sibling `lambda.Function` from
 *    the baseline L1, reusing the SAME code asset and SAME role (Req 4.5, 14)
 *    and recording env KEYS (never values) and L2-facade warnings.
 * 2. `kata(cloneFunction, kataProps)` transforms the clone to python3.12 +
 *    layers and attaches a `SnapStartActivator` — exactly as a direct `kata()`
 *    caller would experience. No `kata()` signature, `KataWrapperOptions`, or
 *    licensing behaviour is altered (AGENTS.md §10).
 *
 * The baseline is never read or mutated by `kata()` here — only the clone is
 * passed in — so the baseline `CfnFunction` stays byte-identical (Property 1).
 * When the account is entitled the clone is transformed (python3.12 + SnapStart
 * on the clone only, Properties 2/3); when it is not, `kata()` honours
 * `unlicensedBehavior` (warn keeps the clone untransformed; fail throws),
 * proving there is no bypass (Req 21).
 *
 * @param scope - The construct scope (the Target_Stack or a child) the clone is
 *   placed within, making it a sibling of its baseline.
 * @param id - The construct id for the clone.
 * @param l1 - The Baseline_Variant's synthesized `CfnFunction`.
 * @param roleMode - How the clone's execution role is derived (Req 14.1).
 * @param options - Optional naming/role refinements plus `kata()` props.
 * @returns The transformed clone plus run-design-relevant projections.
 *
 * @throws If materialization fails (see {@link materializeCloneFunction}) or if
 *   the account is not entitled and `kataProps.unlicensedBehavior` is `fail`.
 */
export function buildKataClone(
  scope: Construct,
  id: string,
  l1: CfnFunction,
  roleMode: RoleMode,
  options: BuildKataCloneOptions = {},
): KataCloneResult {
  // 1. Materialize the clone from the baseline L1 (Req 4.1–4.3, 14).
  const materialization = materializeCloneFunction(scope, id, l1, roleMode, options);

  // 2. Apply the Lambda Kata transformation through the ONLY path: kata()
  //    (Req 2.1, 4.4, 21.1, 21.3). kata() mutates the clone in place and
  //    returns the same construct.
  kata(materialization.cloneFunction, options.kataProps);

  // 3. Surface the SnapStart alias/version refs kata() attached on the clone,
  //    so the InvokePathRewriter (task 6) can target the alias (Req 7). The
  //    activator is a child of the clone; its absence means the clone was not
  //    transformed (unentitled + warn — no bypass, Req 21.2).
  const activator = materialization.cloneFunction.node.tryFindChild('SnapStartActivator') as
    | SnapStartActivator
    | undefined;
  const transformed = activator !== undefined;

  return {
    ...materialization,
    transformed,
    roleMode,
    ...(activator !== undefined
      ? { aliasArnRef: activator.aliasArnRef, versionRef: activator.versionRef }
      : {}),
  };
}

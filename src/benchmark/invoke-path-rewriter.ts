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
 * Layer B — InvokePathRewriter (Req 7).
 *
 * After `kata()` transforms a Kata_Variant it attaches a `SnapStartActivator`
 * that publishes a SnapStart-enabled version and creates the `kata` alias,
 * exposing the alias ARN as a CloudFormation attribute (`aliasArnRef`). By
 * default, however, every invoke path CDK synthesizes for the clone still
 * targets the unqualified function (`$LATEST`): event source mappings point at
 * the clone `FunctionName`, resource-based permissions and Function URLs point
 * at the clone `FunctionArn`. Measuring through `$LATEST` would bypass
 * SnapStart entirely and make the cold-start benchmark dishonest (Req 7.1).
 *
 * This module repoints the clone's invoke paths at the alias/published version:
 *
 * - clone event source mappings (`AWS::Lambda::EventSourceMapping`) →
 *   `FunctionName = aliasArnRef` (Req 7.2);
 * - clone synchronous integrations (`AWS::Lambda::Url`) and resource-based
 *   invoke permissions (`AWS::Lambda::Permission`) → the alias (Req 7.3);
 * - fresh resource-based invoke permissions are created against the clone alias
 *   rather than inherited from the baseline (Req 7.3).
 *
 * Any invoke path the rewriter cannot reach — for example a consumer in another
 * stack that references the clone by a literal ARN, surfaced to the rewriter by
 * the orchestrator (task 14) — is recorded in {@link InvokePathRewriteResult}
 * and flips {@link InvokePathRewriteResult.snapStartGuaranteed} to `false`, so
 * the report honestly marks that clone's SnapStart exercise "not guaranteed"
 * (Req 7.4, Property 14).
 *
 * ## Why traverse the stack subtree (the design seam)
 *
 * The clone's invoke-path resources are NOT all children of the clone function
 * construct: `addPermission` nests a raw `CfnPermission` under the function, but
 * a standalone `new EventSourceMapping(stack, id, { target: clone })` lives
 * elsewhere in the stack. The only reliable way to find every invoke path that
 * targets the clone is to walk the enclosing stack
 * (`Stack.of(clone).node.findAll()`) and match each `CfnEventSourceMapping` /
 * `CfnPermission` / `CfnUrl` whose function-target reference resolves to the
 * clone's `FunctionName` or `FunctionArn`. Matching by resolved reference (not
 * by construct ancestry) also guarantees the rewriter never touches an invoke
 * path that belongs to a different function (e.g. the baseline, or the
 * SnapStart provider framework Lambda).
 *
 * @remarks
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 *
 * @module benchmark/invoke-path-rewriter
 */

import { Stack } from 'aws-cdk-lib';
import { CfnEventSourceMapping, CfnPermission, CfnUrl, IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct, IConstruct } from 'constructs';

/**
 * The default alias name `kata()` creates via the `SnapStartActivator`
 * (mirrors {@link SnapStartActivatorProps.aliasName}'s default). Used to set the
 * `Qualifier` on Function URL integrations, which select an alias by name
 * rather than by ARN.
 */
export const DEFAULT_KATA_ALIAS_NAME = 'kata';

/** The IAM action a resource-based invoke permission grants by default. */
const DEFAULT_INVOKE_ACTION = 'lambda:InvokeFunction';

/**
 * Declaration of a resource-based invoke permission to create FRESH against the
 * Kata_Variant alias (Req 7.3).
 *
 * Resource-based permissions are NOT inherited from the baseline: a clone alias
 * needs its own `AWS::Lambda::Permission` granting the invoking principal
 * (e.g. API Gateway, SNS, EventBridge) access to the alias. Each spec becomes a
 * `CfnPermission` whose `FunctionName` is the alias ARN.
 */
export interface FreshInvokePermissionSpec {
  /** Construct id for the created permission (unique within the clone scope). */
  readonly id: string;
  /** The invoking principal (service principal string or account id). */
  readonly principal: string;
  /** The granted action; defaults to `lambda:InvokeFunction`. */
  readonly action?: string;
  /** The ARN of the AWS resource permitted to invoke the alias, when scoped. */
  readonly sourceArn?: string;
  /** The owning account of the source resource, when scoped. */
  readonly sourceAccount?: string;
}

/**
 * The clone-variant context the rewriter operates on. Designed so the
 * orchestrator (task 14) can build it directly from a
 * {@link KataCloneResult} — `cloneFunction` is
 * {@link KataCloneResult.cloneFunction} and `aliasName` defaults to the alias
 * `kata()` creates.
 */
export interface VariantContext {
  /**
   * The transformed Kata_Variant function whose invoke paths are rewritten. It
   * provides the enclosing stack (for subtree traversal) and the
   * `FunctionName`/`FunctionArn` references used to match invoke paths.
   */
  readonly cloneFunction: IFunction;
  /**
   * The clone alias name used as the `Qualifier` for Function URL integrations.
   * Defaults to {@link DEFAULT_KATA_ALIAS_NAME}.
   */
  readonly aliasName?: string;
  /**
   * Fresh resource-based invoke permissions to create against the clone alias
   * (Req 7.3). They are created as children of the clone function so they are
   * unambiguously clone-owned and discoverable by the manifest writer.
   */
  readonly freshInvokePermissions?: ReadonlyArray<FreshInvokePermissionSpec>;
  /**
   * Invoke paths the orchestrator knows target the clone but the rewriter
   * cannot reach at synth time (e.g. cross-stack consumers referencing the
   * clone by literal ARN). Each is recorded as un-rewritable (Req 7.4).
   */
  readonly externalInvokePaths?: ReadonlyArray<string>;
}

/**
 * Result of rewriting a Kata_Variant's invoke paths.
 */
export interface InvokePathRewriteResult {
  /**
   * `true` when every invoke path was directed to the alias/version — i.e. no
   * un-rewritable path was recorded. `false` marks the clone's SnapStart
   * exercise "not guaranteed" (Req 7.1, 7.4, Property 14).
   */
  readonly snapStartGuaranteed: boolean;
  /** `node.path` of every invoke path redirected to the alias (incl. fresh permissions). */
  readonly rewrittenPaths: ReadonlyArray<string>;
  /** Invoke paths that could not be redirected (recorded into Run_Design, Req 7.4). */
  readonly unrewritablePaths: ReadonlyArray<string>;
}

/**
 * Rewrite a Kata_Variant's invoke paths to its alias/published version (Req 7).
 *
 * Walks the clone's enclosing stack, repoints every event source mapping,
 * resource-based permission, and Function URL that targets the clone at the
 * alias, creates any requested fresh invoke permissions against the alias, and
 * records any orchestrator-supplied path it cannot reach.
 *
 * @param clone - The Kata_Variant context (clone function + alias details).
 * @param aliasArnRef - The `SnapStartActivator.aliasArnRef` to target. Must be a
 *   non-empty reference; an empty value means the clone was not transformed and
 *   there is no alias to target.
 * @returns The rewrite result, including any un-rewritable paths (Req 7.4).
 *
 * @throws If `aliasArnRef` is empty/whitespace (no alias to rewrite to), or if
 *   the clone function is not a construct scope under which fresh permissions
 *   can be created.
 */
export function rewriteInvokePaths(
  clone: VariantContext,
  aliasArnRef: string,
): InvokePathRewriteResult {
  if (aliasArnRef === undefined || aliasArnRef.trim() === '') {
    throw new Error(
      'rewriteInvokePaths: a non-empty alias ARN reference is required to redirect the ' +
      'clone invoke paths off $LATEST; an empty alias means the clone was not transformed ' +
      'by kata() (Req 7.1).',
    );
  }

  const { cloneFunction } = clone;
  const stack = Stack.of(cloneFunction);
  const aliasName = clone.aliasName ?? DEFAULT_KATA_ALIAS_NAME;

  // Resolve the clone identity ONCE (stable across the pass): an invoke path
  // belongs to the clone iff its function-target reference resolves to the
  // clone's FunctionName (event source mappings) or FunctionArn (permissions,
  // Function URLs). Matching by resolved reference — not construct ancestry —
  // keeps the rewriter from touching any other function's invoke paths.
  const cloneIdentity = new Set<string>([
    JSON.stringify(stack.resolve(cloneFunction.functionName)),
    JSON.stringify(stack.resolve(cloneFunction.functionArn)),
  ]);

  const rewrittenPaths: string[] = [];

  for (const node of stack.node.findAll()) {
    if (CfnEventSourceMapping.isCfnEventSourceMapping(node)) {
      if (targetsClone(stack, node.functionName, cloneIdentity)) {
        node.functionName = aliasArnRef; // Req 7.2
        rewrittenPaths.push(node.node.path);
      }
      continue;
    }

    if (CfnPermission.isCfnPermission(node)) {
      if (targetsClone(stack, node.functionName, cloneIdentity)) {
        node.functionName = aliasArnRef; // Req 7.3
        rewrittenPaths.push(node.node.path);
      }
      continue;
    }

    if (CfnUrl.isCfnUrl(node)) {
      if (targetsClone(stack, node.targetFunctionArn, cloneIdentity)) {
        // A Function URL selects the alias via its Qualifier; the target arn
        // stays the function arn (Req 7.3).
        node.qualifier = aliasName;
        rewrittenPaths.push(node.node.path);
      }
    }
  }

  // Create fresh resource-based invoke permissions against the alias (Req 7.3):
  // the clone alias does not inherit the baseline's permissions.
  for (const spec of clone.freshInvokePermissions ?? []) {
    const permission = createFreshInvokePermission(cloneFunction, aliasArnRef, spec);
    rewrittenPaths.push(permission.node.path);
  }

  // Any path the orchestrator flagged as unreachable is recorded and flips the
  // SnapStart guarantee off (Req 7.4, Property 14).
  const unrewritablePaths = [...(clone.externalInvokePaths ?? [])];

  return {
    snapStartGuaranteed: unrewritablePaths.length === 0,
    rewrittenPaths,
    unrewritablePaths,
  };
}

/**
 * Determine whether a synthesized function-target reference resolves to the
 * clone's identity (its `FunctionName` or `FunctionArn`).
 *
 * @internal
 */
function targetsClone(stack: Stack, target: string, cloneIdentity: Set<string>): boolean {
  if (target === undefined) {
    return false;
  }
  return cloneIdentity.has(JSON.stringify(stack.resolve(target)));
}

/**
 * Create a fresh `AWS::Lambda::Permission` granting `spec.principal` invoke
 * access to the clone ALIAS (its `FunctionName` is the alias ARN, never the
 * baseline's permission) (Req 7.3).
 *
 * The permission is created as a SIBLING of the clone function (in the clone's
 * own scope), NOT as a child of it. This is a correctness requirement, not a
 * style choice: `kata()` attaches a `SnapStartActivator` that declares
 * `addDependency(cloneFunction)` on the whole function subtree, so a permission
 * nested under the function would make the activator depend on the permission
 * while the permission depends on the activator's alias ARN — a CloudFormation
 * dependency cycle. Placing the permission as a sibling keeps the dependency
 * one-way (permission → alias) and undeployable cycles are avoided. The id is
 * namespaced with the clone's construct id so permissions for different clones
 * in the same scope never collide.
 *
 * @internal
 */
function createFreshInvokePermission(
  cloneFunction: IFunction,
  aliasArnRef: string,
  spec: FreshInvokePermissionSpec,
): CfnPermission {
  const scope = resolveCloneScope(cloneFunction);
  return new CfnPermission(scope, `${cloneFunction.node.id}${spec.id}`, {
    action: spec.action ?? DEFAULT_INVOKE_ACTION,
    principal: spec.principal,
    functionName: aliasArnRef,
    ...(spec.sourceArn !== undefined ? { sourceArn: spec.sourceArn } : {}),
    ...(spec.sourceAccount !== undefined ? { sourceAccount: spec.sourceAccount } : {}),
  });
}

/**
 * Resolve the scope under which fresh permission resources are created: the
 * clone function's own scope (making the permission a SIBLING of the clone, see
 * {@link createFreshInvokePermission} for why nesting under the function would
 * create a dependency cycle with the `SnapStartActivator`).
 *
 * A transformed Kata_Variant is always a concrete `lambda.Function` whose
 * `node.scope` is a `Construct`; the guard makes the requirement explicit and
 * type-safe rather than relying on a cast.
 *
 * @internal
 */
function resolveCloneScope(cloneFunction: IFunction): Construct {
  const scope: IConstruct | undefined = cloneFunction.node.scope;
  if (scope === undefined || !Construct.isConstruct(scope)) {
    throw new Error(
      'rewriteInvokePaths: the clone function has no construct scope, so fresh invoke ' +
      'permissions cannot be created as its sibling. Pass the materialized Kata_Variant function.',
    );
  }
  return scope;
}

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
 * Layer B — construct-tree traversal that discovers Lambda functions in a
 * Target_Stack (Req 1.2).
 *
 * Discovery uses **explicit post-construction traversal** (not a CDK Aspect) so
 * the harness controls ordering deterministically: clone creation must happen
 * after the baseline tree is fully built, and the order of operations across
 * subsystems must be fixed.
 *
 * The traversal walks `stack.node.findAll()` once and selects the **base Lambda
 * function** constructs, classifying each as either:
 *
 * - **owned** — an in-template `AWS::Lambda::Function` whose `node.defaultChild`
 *   is a {@link CfnFunction}; or
 * - **imported** — a function referenced by ARN/attributes
 *   (`Function.fromFunctionArn` / `fromFunctionAttributes` / `fromFunctionName`)
 *   that owns no `CfnFunction` in this tree and is therefore marked
 *   `isImported` and routed to the classifier as unsupported (Req 5.2).
 *
 * A "base Lambda function" is any `FunctionBase` that is NOT a
 * `QualifiedFunctionBase`, which deliberately excludes the `Version` and
 * `Alias` support constructs (both `QualifiedFunctionBase` subclasses) so a
 * single function is never double-counted.
 *
 * @remarks
 * Validates: Requirements 1.2
 *
 * @module benchmark/discovery
 */

import { Stack } from 'aws-cdk-lib';
import {
  CfnFunction,
  FunctionBase,
  QualifiedFunctionBase,
} from 'aws-cdk-lib/aws-lambda';
import type { Construct, IConstruct } from 'constructs';

/**
 * A Lambda discovered during construct-tree traversal of the Target_Stack.
 */
export interface DiscoveredLambda {
  /** The owning L2 construct (`Function` | `NodejsFunction` | imported). */
  readonly node: Construct;
  /**
   * The synthesized L1 definition (`node.defaultChild` as `CfnFunction`).
   *
   * Present for owned functions; `undefined` for imported-by-reference
   * functions, which own no `CfnFunction` in this tree (see {@link isImported}).
   */
  readonly cfn?: CfnFunction;
  /** The baseline's `node.path`, used as its stable identity. */
  readonly constructPath: string;
  /** `true` when the function is imported by reference (no owned `CfnFunction`). */
  readonly isImported: boolean;
}

/**
 * Error raised when {@link discoverLambdas} is invoked with an argument that is
 * not a CDK {@link Stack} instance (Req 1.7 — surfaced here so the entry point
 * fails fast with a descriptive, identifiable error).
 */
export class LambdaDiscoveryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'LambdaDiscoveryError';
  }
}

/**
 * Determine whether a construct is a **base Lambda function** — i.e. an owned
 * `Function`/`NodejsFunction` or an imported function reference — as opposed to
 * a qualified function support construct (`Version`/`Alias`).
 *
 * Both owned and imported base functions extend `FunctionBase`; only the
 * qualified constructs extend `QualifiedFunctionBase`. Excluding the latter is
 * what prevents a single function (which materialises a `currentVersion` and/or
 * aliases) from being discovered more than once.
 *
 * @param construct - A construct visited during traversal.
 * @returns `true` if `construct` is a base Lambda function.
 */
function isBaseLambdaFunction(construct: IConstruct): construct is FunctionBase {
  return construct instanceof FunctionBase && !(construct instanceof QualifiedFunctionBase);
}

/**
 * Resolve the owned {@link CfnFunction} of a base Lambda function, if any.
 *
 * Owned `Function` constructs expose their `AWS::Lambda::Function` as
 * `node.defaultChild`; imported references have no default child (or a
 * non-`CfnFunction` one), in which case `undefined` is returned and the caller
 * records the function as imported.
 *
 * @param fn - A base Lambda function construct.
 * @returns The owned `CfnFunction`, or `undefined` for imported functions.
 */
function resolveOwnedCfnFunction(fn: FunctionBase): CfnFunction | undefined {
  const defaultChild = fn.node.defaultChild;
  return defaultChild instanceof CfnFunction ? defaultChild : undefined;
}

/**
 * Traverse a Target_Stack and identify every Lambda function construct it
 * contains (Req 1.2).
 *
 * The traversal is a single pass over `stack.node.findAll()` and is
 * deterministic: for a fixed stack it always yields the same constructs in the
 * same order (CDK's child registration order), so repeated synthesis is stable.
 *
 * @param stack - The already-constructed Target_Stack to traverse.
 * @returns The discovered Lambdas, including imported-by-reference functions
 *   (flagged `isImported` with no owned `cfn`).
 *
 * @throws {LambdaDiscoveryError} If `stack` is not a CDK `Stack` instance.
 */
export function discoverLambdas(stack: Stack): DiscoveredLambda[] {
  if (!Stack.isStack(stack)) {
    throw new LambdaDiscoveryError(
      'discoverLambdas requires a CDK Stack instance; received a value that is not a Stack.',
    );
  }

  const discovered: DiscoveredLambda[] = [];

  for (const construct of stack.node.findAll()) {
    if (!isBaseLambdaFunction(construct)) {
      continue;
    }

    const cfn = resolveOwnedCfnFunction(construct);

    discovered.push({
      node: construct,
      ...(cfn !== undefined ? { cfn } : {}),
      constructPath: construct.node.path,
      isImported: cfn === undefined,
    });
  }

  return discovered;
}

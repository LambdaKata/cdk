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
 * Layer B — EligibilityClassifier (Req 5).
 *
 * Pure decision rules that classify each {@link DiscoveredLambda} as exactly
 * one of `cloneable`, `cloneable-with-warnings`, or `unsupported`, with machine-
 * and human-readable reasons recorded for every applicable condition.
 *
 * The classifier is a **pure function** of the discovered construct: it reads
 * the synthesized L1 `CfnFunction` props and the owning L2 construct subtree,
 * performs no CDK synthesis side effects, and never mutates its input. Where a
 * required prop is an unresolved CDK token it cannot read at traversal time, it
 * records the limitation rather than guessing (Req 4.6).
 *
 * Decision table (design.md §EligibilityClassifier), applied with
 * exactly-one classification (Property 6, Req 5.1):
 *
 * | Condition                                                   | Result                  | Req        |
 * | ----------------------------------------------------------- | ----------------------- | ---------- |
 * | Imported-by-ARN (no owned CfnFunction)                      | unsupported             | 5.2        |
 * | `PackageType: Image` (container image)                      | unsupported             | 5.3        |
 * | Role policy scoped to original function name / its log group| cloneable-with-warnings | 5.4, 14.6  |
 * | Existing version / alias / provisioned concurrency          | cloneable-with-warnings | 5.5        |
 * | Runtime not supported by the kata transformation            | unsupported             | 5.6        |
 * | Required prop is an unreadable/unresolved token             | cloneable-with-warnings | 4.6        |
 * | otherwise                                                   | cloneable               | —          |
 *
 * When several conditions apply, ALL of their reasons are recorded and the
 * final eligibility is the most severe implied: any unsupported-level condition
 * yields `unsupported`; else any warning-level condition yields
 * `cloneable-with-warnings`; else `cloneable`. Every reason is recordable into
 * the Run_Design (Req 5.7), and unsupported Lambdas are skipped (but still
 * correctly classified) so the orchestrator can continue (Req 5.8).
 *
 * @remarks
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 4.6, 14.6
 *
 * @module benchmark/eligibility
 */

import { Stack, Token } from 'aws-cdk-lib';
import { Alias, CfnAlias, CfnVersion, FunctionBase, Version } from 'aws-cdk-lib/aws-lambda';
import { CfnPolicy, CfnRole, CfnRolePolicy, Role } from 'aws-cdk-lib/aws-iam';
import type { IConstruct } from 'constructs';

import type { DiscoveredLambda } from './discovery';

/** The exactly-one classification assigned to a discovered Lambda (Req 5.1). */
export type Eligibility = 'cloneable' | 'cloneable-with-warnings' | 'unsupported';

/** Stable, machine-readable reason codes, one per decision-table condition. */
export type EligibilityReasonCode =
  | 'imported-by-arn'
  | 'container-image'
  | 'role-scoped-to-name'
  | 'role-scoped-to-loggroup'
  | 'existing-version-or-alias'
  | 'provisioned-concurrency'
  | 'unsupported-runtime'
  | 'unreadable-token'
  // CloneBuilder L2-facade fallback warnings (design note §CloneBuilder): a
  // prop that the light L2 facade cannot faithfully represent (because it
  // references an external resource by raw id/ARN rather than a CDK construct)
  // is copied verbatim via the raw `CfnFunction` escape hatch and recorded here
  // for the Run_Design (Req 4.6).
  | 'l2-facade-fallback-vpc-config'
  | 'l2-facade-fallback-file-system-configs'
  | 'l2-facade-fallback-kms-key';

/** A machine + human readable reason contributing to an {@link Eligibility}. */
export interface EligibilityReason {
  /** Stable machine-readable discriminator for the condition (Req 5.7). */
  readonly code: EligibilityReasonCode;
  /** Human-readable explanation safe to surface in the Run_Design (Req 5.7). */
  readonly message: string;
}

/** The result of classifying a single discovered Lambda. */
export interface EligibilityResult {
  readonly eligibility: Eligibility;
  readonly reasons: ReadonlyArray<EligibilityReason>;
}

/**
 * Severity levels implied by each reason, used to collapse the recorded reasons
 * into the single most-severe {@link Eligibility} (precedence:
 * `unsupported` > `cloneable-with-warnings` > `cloneable`).
 */
type Severity = 'unsupported' | 'warning';

/**
 * Node.js source runtimes the kata transformation supports.
 *
 * This MUST stay in lockstep with `NODEJS_RUNTIMES` in `src/kata-wrapper.ts`,
 * which is the product's source of truth: `kata()` only switches Node.js source
 * runtimes (`nodejsNN.x`) to the Python 3.12 + Node-layer + SnapStart target.
 * A clone built from a non-Node runtime cannot be transformed, so such Lambdas
 * are `unsupported` (Req 5.6). The set is duplicated (not imported) because the
 * wrapper constant is private to that do-not-touch module (AGENTS.md §10) and
 * this additive layer must not alter the wrapper's public surface.
 */
const KATA_SUPPORTED_NODEJS_RUNTIMES: ReadonlySet<string> = new Set([
  'nodejs18.x',
  'nodejs20.x',
  'nodejs22.x',
  'nodejs24.x',
]);

/** Internal accumulator entry pairing a reason with its implied severity. */
interface SeveredReason {
  readonly severity: Severity;
  readonly reason: EligibilityReason;
}

/** Construct a severed reason, keeping reason construction terse and uniform. */
function reason(
  severity: Severity,
  code: EligibilityReasonCode,
  message: string,
): SeveredReason {
  return { severity, reason: { code, message } };
}

/**
 * Rule (Req 5.2): a function imported by ARN/attributes owns no `CfnFunction`
 * in this tree, so its code/role/config cannot be read and no faithful clone
 * can be built. {@link DiscoveredLambda.isImported} is the authoritative signal
 * (set by discovery when `node.defaultChild` is not a `CfnFunction`).
 */
function detectImported(discovered: DiscoveredLambda): SeveredReason | undefined {
  if (!discovered.isImported || discovered.cfn !== undefined) {
    return undefined;
  }
  return reason(
    'unsupported',
    'imported-by-arn',
    `Lambda "${discovered.constructPath}" is imported by reference (no owned ` +
    'AWS::Lambda::Function in this stack); it cannot be cloned faithfully.',
  );
}

/**
 * Rule (Req 5.3): container-image functions (`PackageType: Image`) carry no
 * Node.js source runtime for the kata transformation to switch, so they are
 * unsupported. An unresolved `packageType` token is handled by the dedicated
 * unreadable-token rule, not here.
 */
function detectContainerImage(cfn: NonNullable<DiscoveredLambda['cfn']>): SeveredReason | undefined {
  const packageType = cfn.packageType;
  if (packageType === undefined || Token.isUnresolved(packageType)) {
    return undefined;
  }
  if (packageType === 'Image') {
    return reason(
      'unsupported',
      'container-image',
      'Function uses a container image package type (PackageType: Image); the ' +
      'kata transformation only supports Node.js zip functions.',
    );
  }
  return undefined;
}

/**
 * Rule (Req 5.6): the kata transformation only supports Node.js source runtimes
 * ({@link KATA_SUPPORTED_NODEJS_RUNTIMES}). A readable runtime outside that set
 * is unsupported. An unresolved runtime token is deferred to the
 * unreadable-token rule (Req 4.6), and image functions legitimately omit a
 * runtime (handled by the container-image rule), so an absent runtime on a
 * non-image function is itself an unreadable/indeterminate input.
 */
function detectUnsupportedRuntime(
  cfn: NonNullable<DiscoveredLambda['cfn']>,
): SeveredReason | undefined {
  const runtime = cfn.runtime;
  if (runtime === undefined || Token.isUnresolved(runtime)) {
    return undefined;
  }
  if (!KATA_SUPPORTED_NODEJS_RUNTIMES.has(runtime)) {
    return reason(
      'unsupported',
      'unsupported-runtime',
      `Runtime "${runtime}" is not supported by the kata transformation ` +
      `(supported: ${[...KATA_SUPPORTED_NODEJS_RUNTIMES].join(', ')}).`,
    );
  }
  return undefined;
}

/**
 * Rule (Req 4.6): a required prop that is an unresolved CDK token cannot be read
 * at traversal time, so the clone cannot be built faithfully from it. We treat
 * the kata-relevant required props — `runtime` and `packageType` — as the
 * inputs the Clone_Builder must read to decide the transformation. An
 * unresolved token on either is recorded and downgrades the Lambda to
 * cloneable-with-warnings (the conservative end of the design's
 * "warnings or unsupported" range, since a token MAY still resolve to a
 * supported value at deploy time).
 */
function detectUnreadableToken(
  cfn: NonNullable<DiscoveredLambda['cfn']>,
): SeveredReason | undefined {
  const unreadable: string[] = [];
  if (cfn.runtime !== undefined && Token.isUnresolved(cfn.runtime)) {
    unreadable.push('runtime');
  }
  if (cfn.packageType !== undefined && Token.isUnresolved(cfn.packageType)) {
    unreadable.push('packageType');
  }
  if (unreadable.length === 0) {
    return undefined;
  }
  return reason(
    'warning',
    'unreadable-token',
    `Required prop(s) [${unreadable.join(', ')}] are unresolved CDK tokens at ` +
    'traversal time; the clone is built best-effort and flagged for review.',
  );
}

/**
 * Rule (Req 5.5): detect existing published versions / aliases / provisioned
 * concurrency declared on the baseline by scanning the owning function's
 * subtree for `Version` / `Alias` L2 constructs (and their `CfnVersion` /
 * `CfnAlias` L1 children). Discovery deliberately excludes
 * `QualifiedFunctionBase` constructs from the *result set*, but they remain in
 * the owning function's subtree, which is exactly where `addAlias` /
 * `currentVersion` place them — so the owning node is the robust place to look.
 *
 * Returns up to two reasons: one for the presence of a version/alias and one
 * for provisioned concurrency, both warning-level.
 */
function detectExistingVersionOrAlias(node: IConstruct): SeveredReason[] {
  const qualified = node.node
    .findAll()
    .filter((c): c is Version | Alias => c instanceof Version || c instanceof Alias);

  if (qualified.length === 0) {
    return [];
  }

  const reasons: SeveredReason[] = [
    reason(
      'warning',
      'existing-version-or-alias',
      `Baseline already defines ${qualified.length} published version/alias ` +
      'construct(s); existing version configuration is recorded for review.',
    ),
  ];

  if (hasProvisionedConcurrency(qualified)) {
    reasons.push(
      reason(
        'warning',
        'provisioned-concurrency',
        'Baseline declares provisioned concurrency on a version/alias; the ' +
        'clone does not inherit it and the existing configuration is recorded.',
      ),
    );
  }

  return reasons;
}

/**
 * Determine whether any of the given version/alias constructs declares
 * provisioned concurrency, reading the readable L1 `provisionedConcurrencyConfig`
 * of their `CfnVersion` / `CfnAlias` children. Unresolved tokens are treated as
 * "not detectable here" (the value may resolve at deploy time) and do not
 * fabricate a provisioned-concurrency reason.
 */
function hasProvisionedConcurrency(qualified: ReadonlyArray<Version | Alias>): boolean {
  for (const construct of qualified) {
    for (const child of construct.node.findAll()) {
      if (child instanceof CfnVersion || child instanceof CfnAlias) {
        const config = child.provisionedConcurrencyConfig;
        if (config !== undefined && !Token.isUnresolved(config)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Rule (Req 5.4, 14.6): detect an execution role whose policies are scoped to
 * the original function name or its log group, which would leave a clone (that
 * reuses the role) without the access the policy implies. This rule is
 * deliberately conservative: it emits a reason ONLY when scoping is genuinely
 * detectable from readable inputs.
 *
 * It can introspect only an **owned** `Role` construct; an imported role (ARN)
 * or an unresolved role token cannot be inspected, so no warning is fabricated.
 * It also requires a readable literal function name to attribute a resource to
 * "this function" precisely (avoiding false positives on unrelated ARNs).
 *
 * @returns Up to two reasons (name-scoped and/or log-group-scoped), or none.
 */
function detectRoleScoping(discovered: DiscoveredLambda): SeveredReason[] {
  const cfn = discovered.cfn;
  if (cfn === undefined) {
    return [];
  }

  const functionName = cfn.functionName;
  if (functionName === undefined || Token.isUnresolved(functionName)) {
    // Without a readable function name we cannot attribute a policy resource to
    // this specific function; stay silent rather than guess (Req 14.6).
    return [];
  }

  const role = (discovered.node as FunctionBase).role;
  if (!(role instanceof Role)) {
    return []; // imported / external role — not introspectable.
  }

  const resources = collectRoleResourceStrings(role);
  if (resources.length === 0) {
    return [];
  }

  const logGroupFragment = `:log-group:/aws/lambda/${functionName}`;
  const functionFragment = `:function:${functionName}`;

  const reasons: SeveredReason[] = [];

  if (resources.some((r) => r.includes(logGroupFragment))) {
    reasons.push(
      reason(
        'warning',
        'role-scoped-to-loggroup',
        `Execution role has a policy scoped to the original function's log ` +
        `group (/aws/lambda/${functionName}); the clone writes to a different ` +
        'log group and may be denied. Reusing this role is flagged for review.',
      ),
    );
  }

  if (resources.some((r) => r.includes(functionFragment))) {
    reasons.push(
      reason(
        'warning',
        'role-scoped-to-name',
        `Execution role has a policy scoped to the original function name ` +
        `("${functionName}"); the clone has a different name and may be denied. ` +
        'Reusing this role is flagged for review.',
      ),
    );
  }

  return reasons;
}

/**
 * Collect every literal resource string referenced by an owned role's inline
 * and attached policies.
 *
 * Policy documents are resolved through the stack (resolving Lazy values and
 * tokens into plain JSON) and then walked for string leaves. Unresolved
 * references (e.g. `{ Ref: ... }`/`{ 'Fn::GetAtt': ... }`) resolve to objects,
 * not strings, so they are naturally ignored — keeping the rule honest about
 * what is actually readable.
 *
 * @param role - The owned execution `Role` construct.
 * @returns The flattened list of literal resource strings across its policies.
 */
function collectRoleResourceStrings(role: Role): string[] {
  const stack = Stack.of(role);
  const documents: unknown[] = [];

  for (const construct of role.node.findAll()) {
    if (construct instanceof CfnRole) {
      const policies = stack.resolve(construct.policies) as unknown;
      if (Array.isArray(policies)) {
        for (const policy of policies) {
          documents.push((policy as { policyDocument?: unknown })?.policyDocument);
        }
      }
    } else if (construct instanceof CfnPolicy || construct instanceof CfnRolePolicy) {
      documents.push(stack.resolve(construct.policyDocument) as unknown);
    }
  }

  const resources: string[] = [];
  for (const document of documents) {
    collectResourceStringsFromDocument(stack.resolve(document) as unknown, resources);
  }
  return resources;
}

/**
 * Extract resource strings from a resolved IAM policy document.
 *
 * Walks each statement's `Resource` field, accepting both the single-string and
 * array forms, and pushes every literal string onto `out`.
 *
 * @param document - A resolved policy document (plain JSON) or `undefined`.
 * @param out - Accumulator that receives the literal resource strings.
 */
function collectResourceStringsFromDocument(document: unknown, out: string[]): void {
  if (document === null || typeof document !== 'object') {
    return;
  }
  const statements = (document as { Statement?: unknown }).Statement;
  const statementList = Array.isArray(statements) ? statements : statements ? [statements] : [];

  for (const statement of statementList) {
    if (statement === null || typeof statement !== 'object') {
      continue;
    }
    const resource = (statement as { Resource?: unknown }).Resource;
    if (typeof resource === 'string') {
      out.push(resource);
    } else if (Array.isArray(resource)) {
      for (const entry of resource) {
        if (typeof entry === 'string') {
          out.push(entry);
        }
      }
    }
  }
}

/**
 * Collapse the recorded severed reasons into the single most-severe
 * {@link Eligibility} (Property 6 — exactly one classification, Req 5.1).
 *
 * Precedence: any `unsupported`-severity reason ⇒ `unsupported`; else any
 * `warning`-severity reason ⇒ `cloneable-with-warnings`; else `cloneable`.
 *
 * @param severed - All reasons accumulated by the decision rules.
 * @returns The single eligibility implied by the most severe reason.
 */
function collapseEligibility(severed: ReadonlyArray<SeveredReason>): Eligibility {
  if (severed.some((s) => s.severity === 'unsupported')) {
    return 'unsupported';
  }
  if (severed.some((s) => s.severity === 'warning')) {
    return 'cloneable-with-warnings';
  }
  return 'cloneable';
}

/**
 * Classify a discovered Lambda's clone eligibility (Req 5.1).
 *
 * Applies the full decision table as a set of independent, pure rules, records
 * EVERY applicable reason (Req 5.7), and returns the single most-severe
 * {@link Eligibility} (Property 6). The function is pure and side-effect free.
 *
 * @param discovered - The Lambda to classify (from {@link discoverLambdas}).
 * @returns Exactly one {@link Eligibility} with its contributing reasons.
 */
export function classify(discovered: DiscoveredLambda): EligibilityResult {
  // Imported-by-ARN is terminal: with no owned CfnFunction there is nothing
  // further to inspect, and it is unambiguously unsupported (Req 5.2).
  const imported = detectImported(discovered);
  if (imported !== undefined) {
    return { eligibility: 'unsupported', reasons: [imported.reason] };
  }

  const cfn = discovered.cfn;
  if (cfn === undefined) {
    // Defensive: a non-imported discovery with no owned CfnFunction is an
    // indeterminate input we cannot read (Req 4.6). This is not expected given
    // discovery's contract, but we classify conservatively rather than throw.
    return {
      eligibility: 'cloneable-with-warnings',
      reasons: [
        {
          code: 'unreadable-token',
          message:
            `Lambda "${discovered.constructPath}" has no readable ` +
            'AWS::Lambda::Function definition at traversal time.',
        },
      ],
    };
  }

  const severed: SeveredReason[] = [];

  pushIfPresent(severed, detectContainerImage(cfn));
  pushIfPresent(severed, detectUnsupportedRuntime(cfn));
  pushIfPresent(severed, detectUnreadableToken(cfn));
  severed.push(...detectRoleScoping(discovered));
  severed.push(...detectExistingVersionOrAlias(discovered.node));

  return {
    eligibility: collapseEligibility(severed),
    reasons: severed.map((s) => s.reason),
  };
}

/** Push a severed reason onto the accumulator when one was produced. */
function pushIfPresent(target: SeveredReason[], candidate: SeveredReason | undefined): void {
  if (candidate !== undefined) {
    target.push(candidate);
  }
}

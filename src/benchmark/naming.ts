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
 * Layer B — NamingResolver (Req 6).
 *
 * Derives collision-free Kata_Variant names within the AWS 64-character Lambda
 * function-name limit, using a deterministic, sha256-derived tail hash when
 * truncation is required.
 *
 * This module is intentionally **pure**: it has no `aws-cdk-lib` runtime
 * dependency, performs no I/O and no network calls, and relies only on Node's
 * built-in `crypto` for the deterministic hash. It exposes two complementary
 * contracts:
 *
 * - {@link resolveCloneName} — the stateless, deterministic name derivation for
 *   a single Baseline_Variant (Req 6.1, 6.2, 6.4, 6.5).
 * - {@link NamingResolver} — a stack-scoped component that layers
 *   collision-resolution on top of {@link resolveCloneName} by tracking a
 *   used-name set and extending the hash length until the name is unique
 *   within the Target_Stack (Req 6.3).
 *
 * All produced names satisfy the AWS Lambda function-name character set
 * `[a-zA-Z0-9-_]` and never exceed {@link MAX_LAMBDA_FUNCTION_NAME_LENGTH}
 * characters, for every possible input.
 *
 * @remarks
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 *
 * @module benchmark/naming
 */

import { createHash } from 'crypto';

/** The AWS Lambda function-name maximum length, in characters. */
export const MAX_LAMBDA_FUNCTION_NAME_LENGTH = 64;

/** The default distinguishing kata suffix appended to a clone name (Req 6.1). */
export const DEFAULT_CLONE_NAME_SUFFIX = 'kata';

/** The default sha256-derived tail-hash length, in hex characters (Req 6.2). */
export const DEFAULT_CLONE_NAME_HASH_LENGTH = 8;

/** The full length, in hex characters, of a sha256 digest. */
const SHA256_HEX_LENGTH = 64;

/** The single separator character placed between name components. */
const NAME_SEPARATOR = '-';

/**
 * Matches any character that is NOT in the AWS Lambda function-name set
 * `[a-zA-Z0-9-_]`. The literal `-` is placed last so it is a literal, not a
 * range operator.
 */
const NON_LAMBDA_NAME_CHARS = /[^a-zA-Z0-9_-]/g;

/** Replacement used for characters outside the Lambda function-name set. */
const SANITIZE_REPLACEMENT = '_';

/**
 * Sanitize a name component to the AWS Lambda function-name character set
 * `[a-zA-Z0-9-_]` (Req 6.5).
 *
 * Out-of-set characters are replaced 1:1 with `_` so that the component length
 * is preserved (which keeps the length-safe truncation in
 * {@link buildHashedName} predictable). An empty or all-stripped component is
 * never returned; it falls back to a single `_` so the result is always a
 * valid, non-empty Lambda name fragment.
 *
 * @param value - The raw component (e.g. a baseline function name or suffix).
 * @returns A non-empty string containing only `[a-zA-Z0-9-_]`.
 */
function sanitizeNameComponent(value: string): string {
  const cleaned = value.replace(NON_LAMBDA_NAME_CHARS, SANITIZE_REPLACEMENT);
  return cleaned.length > 0 ? cleaned : SANITIZE_REPLACEMENT;
}

/**
 * Compute the deterministic sha256 hex digest of an identity string.
 *
 * The hash is derived purely from the Baseline_Variant identity (its
 * `node.path`), so repeated synthesis of the same stack yields the same digest
 * and therefore the same clone name (Req 6.4).
 *
 * @param identity - The baseline construct identity used to seed the hash.
 * @returns The 64-character lowercase hex sha256 digest (`[0-9a-f]`).
 */
function sha256Hex(identity: string): string {
  return createHash('sha256').update(identity, 'utf8').digest('hex');
}

/**
 * Build a length-safe, hashed clone name of the form
 * `${prefix}-${hash}-${suffix}` (Req 6.2).
 *
 * The hash is taken from the leading `hashLength` hex characters of
 * `sha256(identity)`. A readable prefix from the sanitized baseline name is
 * preserved when room remains; the result is GUARANTEED to be at most
 * {@link MAX_LAMBDA_FUNCTION_NAME_LENGTH} characters and to contain only
 * `[a-zA-Z0-9-_]`, for every input — including pathological suffixes that on
 * their own would exceed the limit (in which case the leading components are
 * truncated as a last resort, never the integrity of the charset).
 *
 * @param sanitizedBase - The already-sanitized baseline name.
 * @param sanitizedSuffix - The already-sanitized kata suffix.
 * @param identity - The baseline identity seeding the deterministic hash.
 * @param hashLength - Desired hash length in hex characters; clamped to
 *   `[1, 64]`.
 * @returns A deterministic, length-safe, charset-valid clone name.
 */
function buildHashedName(
  sanitizedBase: string,
  sanitizedSuffix: string,
  identity: string,
  hashLength: number,
): string {
  const clampedHashLength = Math.max(1, Math.min(Math.trunc(hashLength), SHA256_HEX_LENGTH));
  const hash = sha256Hex(identity).slice(0, clampedHashLength);

  // Characters reserved for the tail: `-${hash}-${suffix}`.
  const reserved = NAME_SEPARATOR.length + hash.length + NAME_SEPARATOR.length + sanitizedSuffix.length;
  const prefixLength = MAX_LAMBDA_FUNCTION_NAME_LENGTH - reserved;

  if (prefixLength > 0) {
    const prefix = sanitizedBase.slice(0, prefixLength);
    return `${prefix}${NAME_SEPARATOR}${hash}${NAME_SEPARATOR}${sanitizedSuffix}`;
  }

  // No room for a readable prefix (an unusually long suffix): drop the prefix
  // and, as a final guard, truncate to the hard limit. Every character here is
  // already from the valid set, so truncation cannot break the charset.
  const tail = `${hash}${NAME_SEPARATOR}${sanitizedSuffix}`;
  return tail.length <= MAX_LAMBDA_FUNCTION_NAME_LENGTH
    ? tail
    : tail.slice(0, MAX_LAMBDA_FUNCTION_NAME_LENGTH);
}

/**
 * Resolve a deterministic, length-safe Kata_Variant function name (Req 6).
 *
 * Behaviour:
 * - Appends `-${suffix}` to the (sanitized) baseline name (Req 6.1).
 * - When the readable `name-suffix` form would exceed
 *   {@link MAX_LAMBDA_FUNCTION_NAME_LENGTH}, preserves a readable prefix and
 *   replaces the tail with a deterministic sha256-derived hash so the result is
 *   at most 64 characters (Req 6.2).
 * - Derives the hash from `identity` so repeated synthesis is stable (Req 6.4).
 * - Always returns a name constrained to `[a-zA-Z0-9-_]` (Req 6.5).
 *
 * This function is stateless and therefore does NOT, by itself, guarantee
 * uniqueness across multiple clones — that stack-scoped concern is owned by
 * {@link NamingResolver}, which layers collision-resolution on top.
 *
 * @param baselineName - The Baseline_Variant function name.
 * @param suffix - The distinguishing kata suffix (e.g. `kata`).
 * @param identity - The baseline construct identity (`node.path`) used to seed
 *   the deterministic tail hash.
 * @returns A name of at most {@link MAX_LAMBDA_FUNCTION_NAME_LENGTH} characters
 *   containing only `[a-zA-Z0-9-_]`.
 */
export function resolveCloneName(baselineName: string, suffix: string, identity: string): string {
  const sanitizedBase = sanitizeNameComponent(baselineName);
  const sanitizedSuffix = sanitizeNameComponent(suffix);

  const readableName = `${sanitizedBase}${NAME_SEPARATOR}${sanitizedSuffix}`;
  if (readableName.length <= MAX_LAMBDA_FUNCTION_NAME_LENGTH) {
    return readableName;
  }

  return buildHashedName(sanitizedBase, sanitizedSuffix, identity, DEFAULT_CLONE_NAME_HASH_LENGTH);
}

/** Construction options for a {@link NamingResolver}. */
export interface NamingResolverOptions {
  /** Distinguishing kata suffix; defaults to {@link DEFAULT_CLONE_NAME_SUFFIX}. */
  readonly suffix?: string;
  /**
   * Initial sha256 hash length (hex chars) used when a collision forces the
   * hashed form; defaults to {@link DEFAULT_CLONE_NAME_HASH_LENGTH}. The
   * resolver extends the length up to the full digest on further collisions.
   */
  readonly initialHashLength?: number;
}

/**
 * Stack-scoped, collision-aware clone-name resolver (Req 6.3).
 *
 * A single {@link NamingResolver} instance represents the naming authority for
 * one Target_Stack. It tracks the set of names already handed out and, on
 * collision, extends the deterministic hash length until the candidate is
 * unique — so no two Kata_Variant names collide within a stack.
 *
 * Determinism (Req 6.4) is preserved at the stack level: because the algorithm
 * is a pure function of `(baselineName, identity, usage-order)`, feeding the
 * same baselines in the same discovery order to a fresh resolver always yields
 * the same sequence of names. Within a stack each baseline has a distinct
 * `node.path`, which guarantees the hash-extension loop converges to a unique
 * name (distinct identities diverge before the full digest is exhausted).
 */
export class NamingResolver {
  private readonly suffix: string;
  private readonly initialHashLength: number;
  private readonly usedNames: Set<string>;

  /**
   * @param options - Optional suffix / initial-hash-length overrides.
   */
  public constructor(options?: NamingResolverOptions) {
    this.suffix = sanitizeNameComponent(options?.suffix ?? DEFAULT_CLONE_NAME_SUFFIX);
    this.initialHashLength = options?.initialHashLength ?? DEFAULT_CLONE_NAME_HASH_LENGTH;
    this.usedNames = new Set<string>();
  }

  /**
   * Resolve a unique, length-safe, charset-valid clone name for a baseline
   * within this stack, registering it in the used-name set.
   *
   * The readable `name-suffix` form is attempted first; on collision the
   * resolver switches to the hashed form and extends the hash length
   * deterministically (seeded by `identity`) until the name is unique.
   *
   * @param baselineName - The Baseline_Variant function name.
   * @param identity - The baseline construct identity (`node.path`).
   * @returns A clone name unique within this resolver's stack scope.
   * @throws If no unique name can be derived even at full sha256 length, which
   *   cannot occur for distinct identities and indicates a caller passing
   *   genuinely identical `(baselineName, identity)` inputs twice.
   */
  public resolve(baselineName: string, identity: string): string {
    const readableName = resolveCloneName(baselineName, this.suffix, identity);
    if (!this.usedNames.has(readableName)) {
      this.usedNames.add(readableName);
      return readableName;
    }

    const sanitizedBase = sanitizeNameComponent(baselineName);
    for (let hashLength = this.initialHashLength; hashLength <= SHA256_HEX_LENGTH; hashLength += 1) {
      const candidate = buildHashedName(sanitizedBase, this.suffix, identity, hashLength);
      if (!this.usedNames.has(candidate)) {
        this.usedNames.add(candidate);
        return candidate;
      }
    }

    throw new Error(
      `NamingResolver could not derive a unique clone name for baseline "${baselineName}" ` +
      `(identity "${identity}"); the same identity appears to have been resolved already.`,
    );
  }

  /**
   * @param name - A candidate clone name.
   * @returns `true` if `name` has already been handed out by this resolver.
   */
  public has(name: string): boolean {
    return this.usedNames.has(name);
  }

  /** The number of distinct clone names handed out by this resolver. */
  public get size(): number {
    return this.usedNames.size;
  }
}

/*
 * MIT
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the MIT; see the LICENSE file
 * or https://choosealicense.com/licenses/mit/ for details.
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * Account ID Resolution for Lambda Kata CDK Integration
 *
 * This module provides functionality to determine the target AWS account ID
 * during CDK synthesis/deploy time. The account ID is required for validating
 * AWS Marketplace entitlements.
 *
 * Resolution strategies (in order of precedence):
 * 1. CDK context value (explicit configuration)
 * 2. Stack account (if not a token/unresolved)
 * 3. STS GetCallerIdentity (fallback for runtime resolution)
 *
 * @module account-resolver
 */

import { Construct } from 'constructs';
import { Stack, Token } from 'aws-cdk-lib';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

/**
 * Error thrown when account ID cannot be resolved through any strategy.
 */
export class AccountResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountResolutionError';
  }
}

/**
 * Result of account ID resolution, including the source of the resolution.
 */
export interface AccountResolutionResult {
  /**
   * The resolved AWS account ID (12-digit string)
   */
  accountId: string;

  /**
   * The source/strategy that successfully resolved the account ID
   */
  source: 'context' | 'stack' | 'sts';
}

/**
 * Options for account ID resolution.
 */
export interface AccountResolverOptions {
  /**
   * Custom STS client for testing or custom configuration.
   * If not provided, a default client will be created.
   */
  stsClient?: STSClient;

  /**
   * Whether to skip the STS fallback (useful for testing).
   * Default: false
   */
  skipStsFallback?: boolean;
}

/**
 * Resolves the target AWS account ID for entitlement checking.
 *
 * This function attempts to determine the AWS account ID using multiple
 * strategies in order of precedence:
 *
 * 1. **CDK Context**: Checks for `aws:cdk:account` context value
 * 2. **Stack Account**: Uses the Stack's account if it's not a token
 * 3. **STS Fallback**: Calls STS GetCallerIdentity as a last resort
 *
 * @param scope - The CDK construct scope to resolve the account for
 * @param options - Optional configuration for resolution behavior
 * @returns Promise resolving to the AWS account ID (12-digit string)
 * @throws AccountResolutionError if account cannot be resolved through any strategy
 *
 * @example
 * ```typescript
 * const accountId = await resolveAccountId(this);
 * console.log(`Deploying to account: ${accountId}`);
 * ```
 *
 * @remarks
 * Validates: Requirements 3.1
 * - WHEN `cdk deploy` is executed, THE kata_Wrapper SHALL determine the target AWS account ID
 */
export async function resolveAccountId(
  scope: Construct,
  options: AccountResolverOptions = {},
): Promise<string> {
  const result = await resolveAccountIdWithSource(scope, options);
  return result.accountId;
}

/**
 * Resolves the target AWS account ID with information about the resolution source.
 *
 * This is an extended version of `resolveAccountId` that also returns
 * information about which strategy was used to resolve the account ID.
 *
 * @param scope - The CDK construct scope to resolve the account for
 * @param options - Optional configuration for resolution behavior
 * @returns Promise resolving to the account ID and resolution source
 * @throws AccountResolutionError if account cannot be resolved through any strategy
 *
 * @example
 * ```typescript
 * const { accountId, source } = await resolveAccountIdWithSource(this);
 * console.log(`Account ${accountId} resolved via ${source}`);
 * ```
 */
export async function resolveAccountIdWithSource(
  scope: Construct,
  options: AccountResolverOptions = {},
): Promise<AccountResolutionResult> {
  // Strategy 1: CDK context value (explicit configuration)
  const contextResult = resolveFromContext(scope);
  if (contextResult) {
    return contextResult;
  }

  // Strategy 2: Stack account (if not a token/unresolved)
  const stackResult = resolveFromStack(scope);
  if (stackResult) {
    return stackResult;
  }

  // Strategy 3: STS GetCallerIdentity (fallback)
  if (!options.skipStsFallback) {
    const stsResult = await resolveFromSts(options.stsClient);
    if (stsResult) {
      return stsResult;
    }
  }

  // All strategies failed
  throw new AccountResolutionError(
    'Unable to determine AWS account ID. Ensure CDK is configured with valid credentials. ' +
    'You can set the account explicitly via CDK context (aws:cdk:account), ' +
    'stack environment, or ensure AWS credentials are available for STS calls.',
  );
}

/**
 * Attempts to resolve account ID from CDK context.
 *
 * Checks for the `aws:cdk:account` context value, which can be set via:
 * - cdk.json context
 * - Command line: `cdk deploy --context aws:cdk:account=123456789012`
 * - Programmatically via `node.setContext()`
 *
 * @param scope - The CDK construct scope
 * @returns AccountResolutionResult if found, undefined otherwise
 */
function resolveFromContext(scope: Construct): AccountResolutionResult | undefined {
  const contextAccountId = scope.node.tryGetContext('aws:cdk:account');

  // Check if context value exists and is valid
  if (contextAccountId &&
    typeof contextAccountId === 'string' &&
    contextAccountId !== 'unknown' &&
    isValidAccountIdFormat(contextAccountId)) {
    return {
      accountId: contextAccountId,
      source: 'context',
    };
  }

  return undefined;
}

/**
 * Attempts to resolve account ID from the Stack's account property.
 *
 * The Stack account may be set via:
 * - Stack props: `new Stack(app, 'MyStack', { env: { account: '123456789012' } })`
 * - Environment variables: CDK_DEFAULT_ACCOUNT
 *
 * Note: If the account is a CDK Token (unresolved), this strategy will not
 * return a result, as we need a concrete account ID for licensing validation.
 *
 * @param scope - The CDK construct scope
 * @returns AccountResolutionResult if found and resolved, undefined otherwise
 */
function resolveFromStack(scope: Construct): AccountResolutionResult | undefined {
  try {
    const stack = Stack.of(scope);

    // Check if stack has an account and it's not a token (unresolved)
    if (stack.account && !Token.isUnresolved(stack.account)) {
      // Validate the account format
      if (isValidAccountIdFormat(stack.account)) {
        return {
          accountId: stack.account,
          source: 'stack',
        };
      }
    }
  } catch {
    // Stack.of() may throw if scope is not within a stack
    // This is fine - we'll try the next strategy
  }

  return undefined;
}

/**
 * Attempts to resolve account ID via STS GetCallerIdentity.
 *
 * This is the fallback strategy when neither context nor stack account
 * are available. It requires valid AWS credentials to be configured.
 *
 * @param stsClient - Optional custom STS client
 * @returns AccountResolutionResult if successful, undefined otherwise
 */
async function resolveFromSts(
  stsClient?: STSClient,
): Promise<AccountResolutionResult | undefined> {
  try {
    const client = stsClient ?? new STSClient({});
    const command = new GetCallerIdentityCommand({});
    const response = await client.send(command);

    if (response.Account && isValidAccountIdFormat(response.Account)) {
      return {
        accountId: response.Account,
        source: 'sts',
      };
    }
  } catch {
    // STS call failed - credentials may not be configured
    // This is fine - we'll throw a comprehensive error after all strategies fail
  }

  return undefined;
}

/**
 * Validates that a string is a valid AWS account ID format.
 *
 * AWS account IDs are exactly 12 digits.
 *
 * @param accountId - The string to validate
 * @returns true if the string is a valid 12-digit account ID
 */
export function isValidAccountIdFormat(accountId: string): boolean {
  return /^\d{12}$/.test(accountId);
}

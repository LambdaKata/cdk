/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Synchronous Account ID Resolution for Lambda Kata CDK Integration
 *
 * This module provides synchronous account ID resolution for use during
 * CDK synthesis, which requires synchronous operations.
 *
 * Resolution strategies (in order of precedence):
 * 1. CDK context value (explicit configuration)
 * 2. Stack account (if not a token/unresolved)
 * 3. Environment variables (AWS_ACCOUNT_ID, CDK_DEFAULT_ACCOUNT)
 * 4. STS GetCallerIdentity via execSync (fallback)
 *
 * @module sync-account-resolver
 */

import { Construct } from 'constructs';
import { Stack, Token } from 'aws-cdk-lib';
import { execSync } from 'child_process';

/**
 * Error thrown when account ID cannot be resolved through any strategy.
 */
export class SyncAccountResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncAccountResolutionError';
  }
}

/**
 * Result of account ID resolution, including the source of the resolution.
 */
export interface SyncAccountResolutionResult {
  accountId: string;
  source: 'context' | 'stack' | 'env' | 'sts';
}

/**
 * Options for synchronous account ID resolution.
 */
export interface SyncAccountResolverOptions {
  /**
   * Whether to skip the STS fallback (useful for testing).
   * Default: false
   */
  skipStsFallback?: boolean;
}

/**
 * Validates that a string is a valid AWS account ID format.
 */
function isValidAccountIdFormat(accountId: string): boolean {
  return /^\d{12}$/.test(accountId);
}

/**
 * Attempts to resolve account ID from CDK context.
 */
function resolveFromContext(scope: Construct): SyncAccountResolutionResult | undefined {
  const contextAccountId = scope.node.tryGetContext('aws:cdk:account');

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
 */
function resolveFromStack(scope: Construct): SyncAccountResolutionResult | undefined {
  try {
    const stack = Stack.of(scope);

    if (stack.account && !Token.isUnresolved(stack.account)) {
      if (isValidAccountIdFormat(stack.account)) {
        return {
          accountId: stack.account,
          source: 'stack',
        };
      }
    }
  } catch {
    // Stack.of() may throw if scope is not within a stack
  }

  return undefined;
}

/**
 * Attempts to resolve account ID from environment variables.
 */
function resolveFromEnv(): SyncAccountResolutionResult | undefined {
  // Check common environment variables
  const envVars = ['AWS_ACCOUNT_ID', 'CDK_DEFAULT_ACCOUNT'];

  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value && isValidAccountIdFormat(value)) {
      return {
        accountId: value,
        source: 'env',
      };
    }
  }

  return undefined;
}

/**
 * Attempts to resolve account ID via STS GetCallerIdentity using execSync.
 */
function resolveFromStsSync(): SyncAccountResolutionResult | undefined {
  try {
    // Use AWS CLI to get caller identity synchronously
    const result = execSync('aws sts get-caller-identity --query Account --output text', {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const accountId = result.trim();
    if (isValidAccountIdFormat(accountId)) {
      return {
        accountId,
        source: 'sts',
      };
    }
  } catch {
    // AWS CLI not available or credentials not configured
  }

  return undefined;
}

/**
 * Resolves the target AWS account ID synchronously.
 *
 * This function attempts to determine the AWS account ID using multiple
 * strategies in order of precedence:
 *
 * 1. **CDK Context**: Checks for `aws:cdk:account` context value
 * 2. **Stack Account**: Uses the Stack's account if it's not a token
 * 3. **Environment Variables**: Checks AWS_ACCOUNT_ID, CDK_DEFAULT_ACCOUNT
 * 4. **STS Fallback**: Calls AWS CLI sts get-caller-identity
 *
 * @param scope - The CDK construct scope to resolve the account for
 * @param options - Optional configuration for resolution behavior
 * @returns The AWS account ID (12-digit string)
 * @throws SyncAccountResolutionError if account cannot be resolved
 */
export function resolveAccountIdSync(
  scope: Construct,
  options: SyncAccountResolverOptions = {},
): string {
  const result = resolveAccountIdSyncWithSource(scope, options);
  return result.accountId;
}

/**
 * Resolves the target AWS account ID synchronously with source information.
 */
export function resolveAccountIdSyncWithSource(
  scope: Construct,
  options: SyncAccountResolverOptions = {},
): SyncAccountResolutionResult {
  // Strategy 1: CDK context value
  const contextResult = resolveFromContext(scope);
  if (contextResult) {
    return contextResult;
  }

  // Strategy 2: Stack account
  const stackResult = resolveFromStack(scope);
  if (stackResult) {
    return stackResult;
  }

  // Strategy 3: Environment variables
  const envResult = resolveFromEnv();
  if (envResult) {
    return envResult;
  }

  // Strategy 4: STS GetCallerIdentity via AWS CLI
  if (!options.skipStsFallback) {
    const stsResult = resolveFromStsSync();
    if (stsResult) {
      return stsResult;
    }
  }

  // All strategies failed
  throw new SyncAccountResolutionError(
    'Unable to determine AWS account ID synchronously. ' +
    'Please specify account explicitly via:\n' +
    '  - Stack env: new Stack(app, "MyStack", { env: { account: "123456789012" } })\n' +
    '  - CDK context: cdk deploy --context aws:cdk:account=123456789012\n' +
    '  - Environment variable: AWS_ACCOUNT_ID=123456789012\n' +
    '  - Or ensure AWS CLI is configured with valid credentials',
  );
}

/**
 * Resolves the deployment region synchronously.
 */
export function resolveRegionSync(scope: Construct): string {
  try {
    const stack = Stack.of(scope);

    // Check if stack region is resolved
    if (stack.region && !Token.isUnresolved(stack.region)) {
      return stack.region;
    }

    // Try CDK context
    const contextRegion = scope.node.tryGetContext('aws:cdk:region') as string | undefined;
    if (contextRegion && typeof contextRegion === 'string') {
      return contextRegion;
    }

    // Try environment variables
    const envRegion = process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || process.env.AWS_DEFAULT_REGION;
    if (envRegion) {
      return envRegion;
    }

    // Try AWS CLI
    try {
      const result = execSync('aws configure get region', {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const region = result.trim();
      if (region) {
        return region;
      }
    } catch {
      // AWS CLI not available
    }

  } catch {
    // Stack.of() may throw
  }

  // Default fallback
  return 'us-east-1';
}

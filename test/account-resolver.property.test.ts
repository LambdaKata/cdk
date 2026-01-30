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
 * Property-Based Tests for Account ID Resolution
 *
 * Feature: cdk-integration, Property 8: Account ID Resolution
 *
 * Property 8: Account ID Resolution
 * *For any* CDK stack with a resolvable account (via context, stack account, or STS),
 * the `kata()` wrapper SHALL successfully determine the target AWS account ID.
 *
 * **Validates: Requirements 3.1**
 * - WHEN `cdk deploy` is executed, THE kata_Wrapper SHALL determine the target AWS account ID
 *
 * @module account-resolver.property.test
 */

import * as fc from 'fast-check';
import { App, Stack, Token } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import {
    resolveAccountId,
    resolveAccountIdWithSource,
    isValidAccountIdFormat,
    AccountResolutionError,
    AccountResolutionResult,
} from '../src/account-resolver';

/**
 * Arbitrary generator for valid AWS account IDs (12-digit strings)
 */
const arbitraryAccountId = (): fc.Arbitrary<string> =>
    fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
        minLength: 12,
        maxLength: 12,
    });

/**
 * Arbitrary generator for invalid AWS account IDs
 */
const arbitraryInvalidAccountId = (): fc.Arbitrary<string> =>
    fc.oneof(
        // Too short (1-11 digits)
        fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
            minLength: 1,
            maxLength: 11,
        }),
        // Too long (13+ digits)
        fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
            minLength: 13,
            maxLength: 20,
        }),
        // Contains non-digit characters
        fc.string({ minLength: 12, maxLength: 12 }).filter((s) => !/^\d{12}$/.test(s)),
        // Empty string
        fc.constant('')
    );

/**
 * Mock STS client that returns a configurable account ID
 */
class MockSTSClient {
    private accountId: string | undefined;
    private shouldFail: boolean = false;

    constructor(accountId?: string, shouldFail: boolean = false) {
        this.accountId = accountId;
        this.shouldFail = shouldFail;
    }

    async send(_command: GetCallerIdentityCommand): Promise<{ Account?: string }> {
        if (this.shouldFail) {
            throw new Error('STS call failed');
        }
        return { Account: this.accountId };
    }
}

/**
 * Helper to create a CDK stack with optional account configuration
 */
function createTestStack(options: {
    contextAccountId?: string;
    stackAccountId?: string;
    useToken?: boolean;
}): { app: App; stack: Stack; construct: Construct } {
    const app = new App({
        context: options.contextAccountId
            ? { 'aws:cdk:account': options.contextAccountId }
            : undefined,
    });

    const stackProps = options.stackAccountId
        ? {
            env: {
                account: options.useToken
                    ? Token.asString({ Ref: 'AWS::AccountId' })
                    : options.stackAccountId,
            },
        }
        : undefined;

    const stack = new Stack(app, 'TestStack', stackProps);
    const construct = new Construct(stack, 'TestConstruct');

    return { app, stack, construct };
}

describe('Feature: cdk-integration, Property 8: Account ID Resolution', () => {
    /**
     * **Validates: Requirements 3.1**
     */
    describe('Property 8: Account ID Resolution', () => {
        describe('isValidAccountIdFormat', () => {
            it('should return true for any valid 12-digit account ID', () => {
                fc.assert(
                    fc.property(arbitraryAccountId(), (accountId) => {
                        return isValidAccountIdFormat(accountId) === true;
                    }),
                    { numRuns: 100 }
                );
            });

            it('should return false for any invalid account ID', () => {
                fc.assert(
                    fc.property(arbitraryInvalidAccountId(), (accountId) => {
                        return isValidAccountIdFormat(accountId) === false;
                    }),
                    { numRuns: 100 }
                );
            });
        });

        describe('Context Resolution Strategy', () => {
            it('should resolve account ID from CDK context for any valid account ID', () => {
                fc.assert(
                    fc.asyncProperty(arbitraryAccountId(), async (accountId) => {
                        const { construct } = createTestStack({
                            contextAccountId: accountId,
                        });

                        const result = await resolveAccountIdWithSource(construct, {
                            skipStsFallback: true,
                        });

                        return result.accountId === accountId && result.source === 'context';
                    }),
                    { numRuns: 100 }
                );
            });

            it('should skip context resolution for invalid account IDs', () => {
                fc.assert(
                    fc.asyncProperty(
                        arbitraryInvalidAccountId(),
                        arbitraryAccountId(),
                        async (invalidContextId, validStackId) => {
                            const { construct } = createTestStack({
                                contextAccountId: invalidContextId,
                                stackAccountId: validStackId,
                            });

                            const result = await resolveAccountIdWithSource(construct, {
                                skipStsFallback: true,
                            });

                            // Should fall through to stack resolution since context is invalid
                            return result.source === 'stack' && result.accountId === validStackId;
                        }
                    ),
                    { numRuns: 100 }
                );
            });

            it('should skip context resolution when context value is "unknown"', () => {
                fc.assert(
                    fc.asyncProperty(arbitraryAccountId(), async (stackAccountId) => {
                        const app = new App({
                            context: { 'aws:cdk:account': 'unknown' },
                        });
                        const stack = new Stack(app, 'TestStack', {
                            env: { account: stackAccountId },
                        });
                        const construct = new Construct(stack, 'TestConstruct');

                        const result = await resolveAccountIdWithSource(construct, {
                            skipStsFallback: true,
                        });

                        // Should fall through to stack resolution
                        return result.source === 'stack' && result.accountId === stackAccountId;
                    }),
                    { numRuns: 100 }
                );
            });
        });

        describe('Stack Resolution Strategy', () => {
            it('should resolve account ID from stack for any valid account ID when context is not set', () => {
                fc.assert(
                    fc.asyncProperty(arbitraryAccountId(), async (accountId) => {
                        const { construct } = createTestStack({
                            stackAccountId: accountId,
                        });

                        const result = await resolveAccountIdWithSource(construct, {
                            skipStsFallback: true,
                        });

                        return result.accountId === accountId && result.source === 'stack';
                    }),
                    { numRuns: 100 }
                );
            });

            it('should skip stack resolution when account is a token (unresolved)', () => {
                fc.assert(
                    fc.asyncProperty(arbitraryAccountId(), async (stsAccountId) => {
                        const { construct } = createTestStack({
                            stackAccountId: '123456789012', // Will be replaced with token
                            useToken: true,
                        });

                        const mockSts = new MockSTSClient(stsAccountId) as unknown as STSClient;

                        const result = await resolveAccountIdWithSource(construct, {
                            stsClient: mockSts,
                        });

                        // Should fall through to STS resolution since stack account is a token
                        return result.source === 'sts' && result.accountId === stsAccountId;
                    }),
                    { numRuns: 100 }
                );
            });
        });

        describe('STS Fallback Strategy', () => {
            it('should resolve account ID from STS when context and stack are not available', () => {
                fc.assert(
                    fc.asyncProperty(arbitraryAccountId(), async (accountId) => {
                        const { construct } = createTestStack({});

                        const mockSts = new MockSTSClient(accountId) as unknown as STSClient;

                        const result = await resolveAccountIdWithSource(construct, {
                            stsClient: mockSts,
                        });

                        return result.accountId === accountId && result.source === 'sts';
                    }),
                    { numRuns: 100 }
                );
            });

            it('should throw AccountResolutionError when all strategies fail', () => {
                fc.assert(
                    fc.asyncProperty(fc.constant(null), async () => {
                        const { construct } = createTestStack({});

                        const mockSts = new MockSTSClient(
                            undefined,
                            true
                        ) as unknown as STSClient;

                        try {
                            await resolveAccountId(construct, {
                                stsClient: mockSts,
                            });
                            return false; // Should have thrown
                        } catch (error) {
                            return error instanceof AccountResolutionError;
                        }
                    }),
                    { numRuns: 100 }
                );
            });

            it('should skip STS fallback when skipStsFallback option is true', () => {
                fc.assert(
                    fc.asyncProperty(fc.constant(null), async () => {
                        const { construct } = createTestStack({});

                        try {
                            await resolveAccountId(construct, {
                                skipStsFallback: true,
                            });
                            return false; // Should have thrown
                        } catch (error) {
                            return error instanceof AccountResolutionError;
                        }
                    }),
                    { numRuns: 100 }
                );
            });
        });

        describe('Resolution Priority', () => {
            it('should prefer context over stack when both are valid', () => {
                fc.assert(
                    fc.asyncProperty(
                        arbitraryAccountId(),
                        arbitraryAccountId().filter((id) => id !== ''),
                        async (contextAccountId, stackAccountId) => {
                            // Ensure they are different to verify priority
                            fc.pre(contextAccountId !== stackAccountId);

                            const { construct } = createTestStack({
                                contextAccountId,
                                stackAccountId,
                            });

                            const result = await resolveAccountIdWithSource(construct, {
                                skipStsFallback: true,
                            });

                            return (
                                result.accountId === contextAccountId && result.source === 'context'
                            );
                        }
                    ),
                    { numRuns: 100 }
                );
            });

            it('should prefer stack over STS when context is not available', () => {
                fc.assert(
                    fc.asyncProperty(
                        arbitraryAccountId(),
                        arbitraryAccountId(),
                        async (stackAccountId, stsAccountId) => {
                            // Ensure they are different to verify priority
                            fc.pre(stackAccountId !== stsAccountId);

                            const { construct } = createTestStack({
                                stackAccountId,
                            });

                            const mockSts = new MockSTSClient(stsAccountId) as unknown as STSClient;

                            const result = await resolveAccountIdWithSource(construct, {
                                stsClient: mockSts,
                            });

                            return (
                                result.accountId === stackAccountId && result.source === 'stack'
                            );
                        }
                    ),
                    { numRuns: 100 }
                );
            });
        });

        describe('resolveAccountId convenience function', () => {
            it('should return only the account ID string for any valid resolution', () => {
                fc.assert(
                    fc.asyncProperty(arbitraryAccountId(), async (accountId) => {
                        const { construct } = createTestStack({
                            contextAccountId: accountId,
                        });

                        const result = await resolveAccountId(construct, {
                            skipStsFallback: true,
                        });

                        return result === accountId && typeof result === 'string';
                    }),
                    { numRuns: 100 }
                );
            });
        });

        describe('Edge Cases', () => {
            it('should handle all-zero account IDs', () => {
                fc.assert(
                    fc.asyncProperty(fc.constant('000000000000'), async (accountId) => {
                        const { construct } = createTestStack({
                            contextAccountId: accountId,
                        });

                        const result = await resolveAccountId(construct, {
                            skipStsFallback: true,
                        });

                        return result === accountId;
                    }),
                    { numRuns: 10 }
                );
            });

            it('should handle all-nine account IDs', () => {
                fc.assert(
                    fc.asyncProperty(fc.constant('999999999999'), async (accountId) => {
                        const { construct } = createTestStack({
                            contextAccountId: accountId,
                        });

                        const result = await resolveAccountId(construct, {
                            skipStsFallback: true,
                        });

                        return result === accountId;
                    }),
                    { numRuns: 10 }
                );
            });
        });
    });
});

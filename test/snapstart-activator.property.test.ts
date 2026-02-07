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
 * Property-Based Tests for SnapStart Activator
 *
 * These tests use fast-check to verify invariants of the SnapStart
 * activation logic across a wide range of inputs.
 *
 * @module snapstart-activator.property.test
 */

import * as fc from 'fast-check';
import {
    CustomResourceEvent,
    handler,
} from '../src/snapstart-activator';

// Mock AWS SDK
const mockSend = jest.fn();
const mockWaitUntilFunctionActiveV2 = jest.fn();
const mockWaitUntilFunctionUpdatedV2 = jest.fn();

jest.mock('@aws-sdk/client-lambda', () => {
    // Create mock class inside factory to ensure proper scoping
    class MockResourceNotFoundException extends Error {
        constructor(message?: string) {
            super(message);
            this.name = 'ResourceNotFoundException';
        }
    }

    return {
        LambdaClient: jest.fn().mockImplementation(() => ({
            send: mockSend,
        })),
        UpdateFunctionConfigurationCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'UpdateFunctionConfiguration' })),
        PublishVersionCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'PublishVersion' })),
        GetFunctionConfigurationCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'GetFunctionConfiguration' })),
        CreateAliasCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'CreateAlias' })),
        UpdateAliasCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'UpdateAlias' })),
        GetAliasCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'GetAlias' })),
        ResourceNotFoundException: MockResourceNotFoundException,
        waitUntilFunctionUpdatedV2: (...args: unknown[]) => mockWaitUntilFunctionUpdatedV2(...args),
        waitUntilFunctionActiveV2: (...args: unknown[]) => mockWaitUntilFunctionActiveV2(...args),
    };
});

/**
 * Arbitrary for valid Lambda function names
 */
const functionNameArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'),
    { minLength: 1, maxLength: 64 }
);

/**
 * Arbitrary for valid alias names
 */
const aliasNameArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'),
    { minLength: 1, maxLength: 128 }
);

/**
 * Arbitrary for version numbers
 */
const versionArb = fc.integer({ min: 1, max: 9999 }).map(String);

/**
 * Arbitrary for Custom Resource request types
 */
const requestTypeArb = fc.constantFrom('Create', 'Update', 'Delete') as fc.Arbitrary<'Create' | 'Update' | 'Delete'>;

describe('snapstart-activator property tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });
    });

    describe('Custom Resource handler invariants', () => {
        it('should always return a valid response structure', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    requestTypeArb,
                    async (functionName, requestType) => {
                        // Setup mock for success case
                        mockSend.mockImplementation((command: any) => {
                            if (command._type === 'PublishVersion') return Promise.resolve({ Version: '1' });
                            if (command._type === 'GetFunctionConfiguration') {
                                return Promise.resolve({ State: 'Active', SnapStart: { OptimizationStatus: 'On' } });
                            }
                            if (command._type === 'GetAlias') {
                                const error = new Error('Not found');
                                (error as any).name = 'ResourceNotFoundException';
                                return Promise.reject(error);
                            }
                            if (command._type === 'CreateAlias') {
                                return Promise.resolve({ AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:kata` });
                            }
                            return Promise.resolve({});
                        });

                        const event: CustomResourceEvent = {
                            RequestType: requestType,
                            ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                            ResponseURL: 'https://cloudformation.s3.amazonaws.com/...',
                            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/TestStack/guid',
                            RequestId: 'request-id',
                            ResourceType: 'Custom::SnapStartActivator',
                            LogicalResourceId: 'SnapStart',
                            ResourceProperties: {
                                ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                                FunctionName: functionName,
                            },
                        };

                        const response = await handler(event);

                        // Invariants that must always hold
                        expect(response).toBeDefined();
                        expect(response.Status).toMatch(/^(SUCCESS|FAILED)$/);
                        expect(response.PhysicalResourceId).toBeDefined();
                        expect(response.PhysicalResourceId.length).toBeGreaterThan(0);
                        expect(response.StackId).toBe(event.StackId);
                        expect(response.RequestId).toBe(event.RequestId);
                        expect(response.LogicalResourceId).toBe(event.LogicalResourceId);

                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });

        it('should always return SUCCESS for Delete requests without calling Lambda APIs', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    async (functionName) => {
                        mockSend.mockClear();

                        const event: CustomResourceEvent = {
                            RequestType: 'Delete',
                            ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                            ResponseURL: 'https://cloudformation.s3.amazonaws.com/...',
                            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/TestStack/guid',
                            RequestId: 'request-id',
                            ResourceType: 'Custom::SnapStartActivator',
                            LogicalResourceId: 'SnapStart',
                            PhysicalResourceId: `${functionName}:snapstart:kata`,
                            ResourceProperties: {
                                ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                                FunctionName: functionName,
                            },
                        };

                        const response = await handler(event);

                        expect(response.Status).toBe('SUCCESS');
                        expect(mockSend).not.toHaveBeenCalled();

                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });

        it('should include function name in physical resource ID', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    async (functionName, aliasName) => {
                        mockSend.mockImplementation((command: any) => {
                            if (command._type === 'PublishVersion') return Promise.resolve({ Version: '1' });
                            if (command._type === 'GetFunctionConfiguration') {
                                return Promise.resolve({ State: 'Active', SnapStart: { OptimizationStatus: 'On' } });
                            }
                            if (command._type === 'GetAlias') {
                                const error = new Error('Not found');
                                (error as any).name = 'ResourceNotFoundException';
                                return Promise.reject(error);
                            }
                            if (command._type === 'CreateAlias') {
                                return Promise.resolve({ AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}` });
                            }
                            return Promise.resolve({});
                        });

                        const event: CustomResourceEvent = {
                            RequestType: 'Create',
                            ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                            ResponseURL: 'https://cloudformation.s3.amazonaws.com/...',
                            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/TestStack/guid',
                            RequestId: 'request-id',
                            ResourceType: 'Custom::SnapStartActivator',
                            LogicalResourceId: 'SnapStart',
                            ResourceProperties: {
                                ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                                FunctionName: functionName,
                                AliasName: aliasName,
                            },
                        };

                        const response = await handler(event);

                        expect(response.PhysicalResourceId).toContain(functionName);

                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });

        it('should return version number in Data on success', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    versionArb,
                    async (functionName, version) => {
                        mockSend.mockImplementation((command: any) => {
                            if (command._type === 'PublishVersion') return Promise.resolve({ Version: version });
                            if (command._type === 'GetFunctionConfiguration') {
                                return Promise.resolve({ State: 'Active', SnapStart: { OptimizationStatus: 'On' } });
                            }
                            if (command._type === 'GetAlias') {
                                const error = new Error('Not found');
                                (error as any).name = 'ResourceNotFoundException';
                                return Promise.reject(error);
                            }
                            if (command._type === 'CreateAlias') {
                                return Promise.resolve({ AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:kata` });
                            }
                            return Promise.resolve({});
                        });

                        const event: CustomResourceEvent = {
                            RequestType: 'Create',
                            ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                            ResponseURL: 'https://cloudformation.s3.amazonaws.com/...',
                            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/TestStack/guid',
                            RequestId: 'request-id',
                            ResourceType: 'Custom::SnapStartActivator',
                            LogicalResourceId: 'SnapStart',
                            ResourceProperties: {
                                ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                                FunctionName: functionName,
                            },
                        };

                        const response = await handler(event);

                        if (response.Status === 'SUCCESS') {
                            expect(response.Data?.Version).toBe(version);
                        }

                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });
    });

    describe('error handling invariants', () => {
        it('should return FAILED with reason on any error', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    fc.string({ minLength: 1, maxLength: 100 }),
                    async (functionName, errorMessage) => {
                        mockWaitUntilFunctionActiveV2.mockRejectedValue(new Error(errorMessage));

                        const event: CustomResourceEvent = {
                            RequestType: 'Create',
                            ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                            ResponseURL: 'https://cloudformation.s3.amazonaws.com/...',
                            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/TestStack/guid',
                            RequestId: 'request-id',
                            ResourceType: 'Custom::SnapStartActivator',
                            LogicalResourceId: 'SnapStart',
                            ResourceProperties: {
                                ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                                FunctionName: functionName,
                            },
                        };

                        const response = await handler(event);

                        expect(response.Status).toBe('FAILED');
                        expect(response.Reason).toBeDefined();
                        expect(response.Reason!.length).toBeGreaterThan(0);

                        // Reset mock for next iteration
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });
    });
});

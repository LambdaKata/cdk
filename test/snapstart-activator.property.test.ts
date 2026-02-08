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
    activateSnapStart,
    SnapStartActivatorConfig,
    _testable,
} from '../src/snapstart-activator';

// Mock sleep to avoid real delays in property tests
const originalSleep = _testable.sleep;
beforeAll(() => {
    _testable.sleep = jest.fn().mockResolvedValue(undefined);
});
afterAll(() => {
    _testable.sleep = originalSleep;
});

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

    /**
     * Property 1: Activation Cycle Ordering
     *
     * For any SnapStart activation execution, the operations SHALL occur in the following order:
     * 1. waitUntilFunctionActiveV2 (ensure function is ready)
     * 2. UpdateFunctionConfiguration (enable SnapStart)
     * 3. waitUntilFunctionUpdatedV2 (wait for config update)
     * 4. PublishVersion (create new version)
     * 5. GetFunctionConfiguration polling (wait for snapshot)
     * 6. GetAlias/CreateAlias/UpdateAlias (manage alias)
     *
     * **Validates: Requirements 1.2, 1.3, 2.1, 2.3, 3.1**
     */
    describe('Property 1: Activation Cycle Ordering', () => {
        it('should execute operations in the correct sequence for any function name and alias name', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    versionArb,
                    async (functionName, aliasName, version) => {
                        // Reset mocks and operation log for each iteration
                        jest.clearAllMocks();
                        const operationLog: string[] = [];

                        // Track waiter calls in order
                        mockWaitUntilFunctionActiveV2.mockImplementation(async () => {
                            operationLog.push('waitUntilFunctionActiveV2');
                            return { state: 'SUCCESS' };
                        });
                        mockWaitUntilFunctionUpdatedV2.mockImplementation(async () => {
                            operationLog.push('waitUntilFunctionUpdatedV2');
                            return { state: 'SUCCESS' };
                        });

                        // Track send calls in order
                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;
                            operationLog.push(cmdType);

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                return Promise.resolve({
                                    State: 'Active',
                                    SnapStart: { OptimizationStatus: 'On' },
                                });
                            }
                            if (cmdType === 'GetAlias') {
                                const error = new Error('Not found');
                                (error as any).name = 'ResourceNotFoundException';
                                return Promise.reject(error);
                            }
                            if (cmdType === 'CreateAlias') {
                                return Promise.resolve({
                                    AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`,
                                });
                            }
                            if (cmdType === 'UpdateAlias') {
                                return Promise.resolve({
                                    AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`,
                                });
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

                        // Must succeed for ordering to be meaningful
                        expect(response.Status).toBe('SUCCESS');

                        // Verify the exact ordering invariant:
                        // 1. waitUntilFunctionActiveV2 must come first
                        const activeIdx = operationLog.indexOf('waitUntilFunctionActiveV2');
                        expect(activeIdx).toBeGreaterThanOrEqual(0);

                        // 2. UpdateFunctionConfiguration must come after waitUntilFunctionActiveV2
                        const updateConfigIdx = operationLog.indexOf('UpdateFunctionConfiguration');
                        expect(updateConfigIdx).toBeGreaterThan(activeIdx);

                        // 3. waitUntilFunctionUpdatedV2 must come after UpdateFunctionConfiguration
                        const updatedIdx = operationLog.indexOf('waitUntilFunctionUpdatedV2');
                        expect(updatedIdx).toBeGreaterThan(updateConfigIdx);

                        // 4. PublishVersion must come after waitUntilFunctionUpdatedV2
                        const publishIdx = operationLog.indexOf('PublishVersion');
                        expect(publishIdx).toBeGreaterThan(updatedIdx);

                        // 5. GetFunctionConfiguration (polling) must come after PublishVersion
                        const getFuncConfigIdx = operationLog.indexOf('GetFunctionConfiguration');
                        expect(getFuncConfigIdx).toBeGreaterThan(publishIdx);

                        // 6. Alias management (GetAlias followed by CreateAlias or UpdateAlias)
                        //    must come after GetFunctionConfiguration polling
                        const getAliasIdx = operationLog.indexOf('GetAlias');
                        expect(getAliasIdx).toBeGreaterThan(getFuncConfigIdx);

                        // Either CreateAlias or UpdateAlias must follow GetAlias
                        const createAliasIdx = operationLog.indexOf('CreateAlias');
                        const updateAliasIdx = operationLog.indexOf('UpdateAlias');
                        const aliasWriteIdx = Math.max(createAliasIdx, updateAliasIdx);
                        expect(aliasWriteIdx).toBeGreaterThan(getAliasIdx);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should execute operations in the correct sequence when alias already exists', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    versionArb,
                    async (functionName, aliasName, version) => {
                        // Reset mocks and operation log for each iteration
                        jest.clearAllMocks();
                        const operationLog: string[] = [];

                        // Track waiter calls in order
                        mockWaitUntilFunctionActiveV2.mockImplementation(async () => {
                            operationLog.push('waitUntilFunctionActiveV2');
                            return { state: 'SUCCESS' };
                        });
                        mockWaitUntilFunctionUpdatedV2.mockImplementation(async () => {
                            operationLog.push('waitUntilFunctionUpdatedV2');
                            return { state: 'SUCCESS' };
                        });

                        // Track send calls - alias EXISTS in this scenario
                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;
                            operationLog.push(cmdType);

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                return Promise.resolve({
                                    State: 'Active',
                                    SnapStart: { OptimizationStatus: 'On' },
                                });
                            }
                            if (cmdType === 'GetAlias') {
                                // Alias already exists
                                return Promise.resolve({
                                    AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`,
                                    FunctionVersion: '1',
                                });
                            }
                            if (cmdType === 'UpdateAlias') {
                                return Promise.resolve({
                                    AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`,
                                });
                            }
                            return Promise.resolve({});
                        });

                        const event: CustomResourceEvent = {
                            RequestType: 'Update',
                            ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                            ResponseURL: 'https://cloudformation.s3.amazonaws.com/...',
                            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/TestStack/guid',
                            RequestId: 'request-id',
                            ResourceType: 'Custom::SnapStartActivator',
                            LogicalResourceId: 'SnapStart',
                            PhysicalResourceId: `${functionName}:snapstart:${aliasName}`,
                            ResourceProperties: {
                                ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                                FunctionName: functionName,
                                AliasName: aliasName,
                            },
                        };

                        const response = await handler(event);

                        // Must succeed for ordering to be meaningful
                        expect(response.Status).toBe('SUCCESS');

                        // Verify the same ordering invariant holds when alias exists
                        const activeIdx = operationLog.indexOf('waitUntilFunctionActiveV2');
                        const updateConfigIdx = operationLog.indexOf('UpdateFunctionConfiguration');
                        const updatedIdx = operationLog.indexOf('waitUntilFunctionUpdatedV2');
                        const publishIdx = operationLog.indexOf('PublishVersion');
                        const getFuncConfigIdx = operationLog.indexOf('GetFunctionConfiguration');
                        const getAliasIdx = operationLog.indexOf('GetAlias');
                        const updateAliasIdx = operationLog.indexOf('UpdateAlias');

                        // All operations must be present
                        expect(activeIdx).toBeGreaterThanOrEqual(0);
                        expect(updateConfigIdx).toBeGreaterThanOrEqual(0);
                        expect(updatedIdx).toBeGreaterThanOrEqual(0);
                        expect(publishIdx).toBeGreaterThanOrEqual(0);
                        expect(getFuncConfigIdx).toBeGreaterThanOrEqual(0);
                        expect(getAliasIdx).toBeGreaterThanOrEqual(0);
                        expect(updateAliasIdx).toBeGreaterThanOrEqual(0);

                        // Strict ordering: active < config < updated < publish < poll < alias
                        expect(updateConfigIdx).toBeGreaterThan(activeIdx);
                        expect(updatedIdx).toBeGreaterThan(updateConfigIdx);
                        expect(publishIdx).toBeGreaterThan(updatedIdx);
                        expect(getFuncConfigIdx).toBeGreaterThan(publishIdx);
                        expect(getAliasIdx).toBeGreaterThan(getFuncConfigIdx);
                        expect(updateAliasIdx).toBeGreaterThan(getAliasIdx);

                        // CreateAlias must NOT be called when alias exists
                        expect(operationLog).not.toContain('CreateAlias');

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 3: Alias Management Idempotency
     *
     * For any alias name and function, if the alias exists, UpdateAlias SHALL be called;
     * if the alias does not exist (ResourceNotFoundException), CreateAlias SHALL be called.
     * The alias SHALL always point to the newly published version.
     *
     * **Validates: Requirements 3.2, 3.3, 3.4, 5.2**
     */
    describe('Property 3: Alias Management Idempotency', () => {
        it('should call UpdateAlias when alias exists, CreateAlias when it does not, always pointing to the published version', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    versionArb,
                    fc.boolean(),
                    async (functionName, aliasName, version, aliasExists) => {
                        jest.clearAllMocks();
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        // Track alias-related commands and their inputs
                        let createAliasInput: any = null;
                        let updateAliasInput: any = null;
                        let createAliasCalled = false;
                        let updateAliasCalled = false;

                        const expectedAliasArn = `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`;

                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                return Promise.resolve({
                                    State: 'Active',
                                    SnapStart: { OptimizationStatus: 'On' },
                                });
                            }
                            if (cmdType === 'GetAlias') {
                                if (aliasExists) {
                                    // Alias already exists — return existing alias pointing to an old version
                                    return Promise.resolve({
                                        AliasArn: expectedAliasArn,
                                        FunctionVersion: '0',
                                        Name: aliasName,
                                    });
                                } else {
                                    // Alias does not exist — throw ResourceNotFoundException
                                    const error = new Error(`Alias not found: ${aliasName}`);
                                    (error as any).name = 'ResourceNotFoundException';
                                    return Promise.reject(error);
                                }
                            }
                            if (cmdType === 'CreateAlias') {
                                createAliasCalled = true;
                                createAliasInput = command.input;
                                return Promise.resolve({ AliasArn: expectedAliasArn });
                            }
                            if (cmdType === 'UpdateAlias') {
                                updateAliasCalled = true;
                                updateAliasInput = command.input;
                                return Promise.resolve({ AliasArn: expectedAliasArn });
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

                        // Activation must succeed
                        expect(response.Status).toBe('SUCCESS');

                        if (aliasExists) {
                            // Requirement 3.3: When alias exists, UpdateAlias SHALL be called
                            expect(updateAliasCalled).toBe(true);
                            expect(createAliasCalled).toBe(false);

                            // Requirement 5.2: UpdateAlias SHALL point to the newly published version
                            expect(updateAliasInput).toBeDefined();
                            expect(updateAliasInput.FunctionName).toBe(functionName);
                            expect(updateAliasInput.Name).toBe(aliasName);
                            expect(updateAliasInput.FunctionVersion).toBe(version);
                        } else {
                            // Requirement 3.4: When alias does not exist, CreateAlias SHALL be called
                            expect(createAliasCalled).toBe(true);
                            expect(updateAliasCalled).toBe(false);

                            // CreateAlias SHALL point to the newly published version
                            expect(createAliasInput).toBeDefined();
                            expect(createAliasInput.FunctionName).toBe(functionName);
                            expect(createAliasInput.Name).toBe(aliasName);
                            expect(createAliasInput.FunctionVersion).toBe(version);
                        }

                        // Requirement 3.2: The alias name used must match the configured alias name
                        expect(response.Data?.AliasName).toBe(aliasName);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should be idempotent: repeated activations with same alias always update (not create duplicate)', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    versionArb,
                    async (functionName, aliasName, version) => {
                        jest.clearAllMocks();
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        let updateAliasCallCount = 0;
                        let createAliasCallCount = 0;
                        let lastUpdateAliasVersion: string | undefined;

                        const expectedAliasArn = `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`;

                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                return Promise.resolve({
                                    State: 'Active',
                                    SnapStart: { OptimizationStatus: 'On' },
                                });
                            }
                            if (cmdType === 'GetAlias') {
                                // Alias exists (simulating repeated deployment)
                                return Promise.resolve({
                                    AliasArn: expectedAliasArn,
                                    FunctionVersion: '1',
                                    Name: aliasName,
                                });
                            }
                            if (cmdType === 'CreateAlias') {
                                createAliasCallCount++;
                                return Promise.resolve({ AliasArn: expectedAliasArn });
                            }
                            if (cmdType === 'UpdateAlias') {
                                updateAliasCallCount++;
                                lastUpdateAliasVersion = command.input.FunctionVersion;
                                return Promise.resolve({ AliasArn: expectedAliasArn });
                            }
                            return Promise.resolve({});
                        });

                        const event: CustomResourceEvent = {
                            RequestType: 'Update',
                            ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                            ResponseURL: 'https://cloudformation.s3.amazonaws.com/...',
                            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/TestStack/guid',
                            RequestId: 'request-id',
                            ResourceType: 'Custom::SnapStartActivator',
                            LogicalResourceId: 'SnapStart',
                            PhysicalResourceId: `${functionName}:snapstart:${aliasName}`,
                            ResourceProperties: {
                                ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                                FunctionName: functionName,
                                AliasName: aliasName,
                            },
                        };

                        const response = await handler(event);

                        expect(response.Status).toBe('SUCCESS');

                        // Requirement 5.2: On re-run, SHALL update existing alias (not create duplicates)
                        expect(updateAliasCallCount).toBe(1);
                        expect(createAliasCallCount).toBe(0);

                        // The alias SHALL always point to the newly published version
                        expect(lastUpdateAliasVersion).toBe(version);

                        return true;
                    }
                ),
                { numRuns: 100 }
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

    /**
     * Property 2: SnapStart Configuration Correctness
     *
     * For any SnapStart activation, the UpdateFunctionConfiguration command SHALL include
     * `SnapStart: { ApplyOn: 'PublishedVersions' }` as the configuration parameter.
     *
     * **Validates: Requirements 1.1**
     */
    describe('Property 2: SnapStart Configuration Correctness', () => {
        it('should always include SnapStart ApplyOn PublishedVersions in UpdateFunctionConfiguration for any function name', async () => {
            // Import the mocked command constructor so we can inspect captured inputs
            const { UpdateFunctionConfigurationCommand } = require('@aws-sdk/client-lambda');

            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    versionArb,
                    async (functionName, aliasName, version) => {
                        jest.clearAllMocks();
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        // Track the input passed to UpdateFunctionConfigurationCommand
                        let capturedUpdateInput: any = null;

                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                capturedUpdateInput = command.input;
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                return Promise.resolve({
                                    State: 'Active',
                                    SnapStart: { OptimizationStatus: 'On' },
                                });
                            }
                            if (cmdType === 'GetAlias') {
                                const error = new Error('Not found');
                                (error as any).name = 'ResourceNotFoundException';
                                return Promise.reject(error);
                            }
                            if (cmdType === 'CreateAlias') {
                                return Promise.resolve({
                                    AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`,
                                });
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

                        // Activation must succeed for the property to be meaningful
                        expect(response.Status).toBe('SUCCESS');

                        // The UpdateFunctionConfigurationCommand must have been constructed
                        expect(UpdateFunctionConfigurationCommand).toHaveBeenCalled();

                        // Verify the captured input has the correct SnapStart configuration
                        expect(capturedUpdateInput).toBeDefined();
                        expect(capturedUpdateInput.FunctionName).toBe(functionName);
                        expect(capturedUpdateInput.SnapStart).toEqual({ ApplyOn: 'PublishedVersions' });

                        // Verify the SnapStart config is exactly { ApplyOn: 'PublishedVersions' }
                        // and contains no other keys
                        expect(Object.keys(capturedUpdateInput.SnapStart)).toEqual(['ApplyOn']);
                        expect(capturedUpdateInput.SnapStart.ApplyOn).toBe('PublishedVersions');

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should include correct SnapStart config regardless of request type (Create or Update)', async () => {
            const { UpdateFunctionConfigurationCommand } = require('@aws-sdk/client-lambda');
            const createOrUpdateArb = fc.constantFrom('Create', 'Update') as fc.Arbitrary<'Create' | 'Update'>;

            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    createOrUpdateArb,
                    versionArb,
                    async (functionName, requestType, version) => {
                        jest.clearAllMocks();
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        let capturedUpdateInput: any = null;

                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                capturedUpdateInput = command.input;
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                return Promise.resolve({
                                    State: 'Active',
                                    SnapStart: { OptimizationStatus: 'On' },
                                });
                            }
                            if (cmdType === 'GetAlias') {
                                const error = new Error('Not found');
                                (error as any).name = 'ResourceNotFoundException';
                                return Promise.reject(error);
                            }
                            if (cmdType === 'CreateAlias') {
                                return Promise.resolve({
                                    AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:kata`,
                                });
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
                            PhysicalResourceId: `${functionName}:snapstart:kata`,
                            ResourceProperties: {
                                ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                                FunctionName: functionName,
                            },
                        };

                        const response = await handler(event);

                        expect(response.Status).toBe('SUCCESS');

                        // The SnapStart configuration must always be { ApplyOn: 'PublishedVersions' }
                        // regardless of whether this is a Create or Update request
                        expect(capturedUpdateInput).toBeDefined();
                        expect(capturedUpdateInput.SnapStart).toEqual({ ApplyOn: 'PublishedVersions' });

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 4: Error Propagation
     *
     * For any AWS API error during activation, the Custom Resource response SHALL have
     * Status='FAILED' and the Reason field SHALL contain the original error message.
     *
     * **Validates: Requirements 5.4, 9.2**
     */
    describe('Property 4: Error Propagation', () => {
        /**
         * Error injection stages representing each point in the activation cycle
         * where an AWS API error can occur.
         */
        const ERROR_STAGES = {
            WaitActive: 0,
            UpdateFunctionConfiguration: 1,
            WaitUpdated: 2,
            PublishVersion: 3,
            GetFunctionConfiguration: 4,
            GetAlias: 5,
            CreateAlias: 6,
        } as const;

        type ErrorStage = typeof ERROR_STAGES[keyof typeof ERROR_STAGES];

        /**
         * Arbitrary for error injection stages.
         */
        const errorStageArb: fc.Arbitrary<ErrorStage> = fc.constantFrom(
            ERROR_STAGES.WaitActive,
            ERROR_STAGES.UpdateFunctionConfiguration,
            ERROR_STAGES.WaitUpdated,
            ERROR_STAGES.PublishVersion,
            ERROR_STAGES.GetFunctionConfiguration,
            ERROR_STAGES.GetAlias,
            ERROR_STAGES.CreateAlias,
        );

        /**
         * Arbitrary for non-empty error messages (printable ASCII, no control chars).
         * Constrained to avoid empty strings which would not carry meaningful error info.
         */
        const errorMessageArb = fc.stringOf(
            fc.constantFrom(
                ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:!?-_()[]{}/'
            ),
            { minLength: 1, maxLength: 200 }
        );

        it('should return FAILED status with original error message for any AWS error at any activation stage', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    versionArb,
                    errorStageArb,
                    errorMessageArb,
                    async (functionName, aliasName, version, errorStage, errorMessage) => {
                        jest.clearAllMocks();

                        const injectedError = new Error(errorMessage);

                        // Configure waiters: inject error at waiter stages, otherwise succeed
                        if (errorStage === ERROR_STAGES.WaitActive) {
                            mockWaitUntilFunctionActiveV2.mockRejectedValue(injectedError);
                        } else {
                            mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        }

                        if (errorStage === ERROR_STAGES.WaitUpdated) {
                            mockWaitUntilFunctionUpdatedV2.mockRejectedValue(injectedError);
                        } else {
                            mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });
                        }

                        // Configure send mock: inject error at the targeted send stage,
                        // otherwise return successful responses for all prior stages
                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                if (errorStage === ERROR_STAGES.UpdateFunctionConfiguration) {
                                    return Promise.reject(injectedError);
                                }
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                if (errorStage === ERROR_STAGES.PublishVersion) {
                                    return Promise.reject(injectedError);
                                }
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                if (errorStage === ERROR_STAGES.GetFunctionConfiguration) {
                                    return Promise.reject(injectedError);
                                }
                                return Promise.resolve({
                                    State: 'Active',
                                    SnapStart: { OptimizationStatus: 'On' },
                                });
                            }
                            if (cmdType === 'GetAlias') {
                                if (errorStage === ERROR_STAGES.GetAlias) {
                                    // Inject a non-ResourceNotFoundException error so it propagates
                                    // (ResourceNotFoundException is handled as "alias not found" — not an error)
                                    return Promise.reject(injectedError);
                                }
                                // Alias does not exist — trigger CreateAlias path
                                const notFoundError = new Error('Not found');
                                (notFoundError as any).name = 'ResourceNotFoundException';
                                return Promise.reject(notFoundError);
                            }
                            if (cmdType === 'CreateAlias') {
                                if (errorStage === ERROR_STAGES.CreateAlias) {
                                    return Promise.reject(injectedError);
                                }
                                return Promise.resolve({
                                    AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`,
                                });
                            }
                            if (cmdType === 'UpdateAlias') {
                                return Promise.resolve({
                                    AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`,
                                });
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

                        // Requirement 5.4: Custom Resource SHALL return FAILED status
                        expect(response.Status).toBe('FAILED');

                        // Requirement 9.2: Reason SHALL contain the original error message
                        expect(response.Reason).toBeDefined();
                        expect(response.Reason!).toContain(errorMessage);

                        // Response must still have valid CloudFormation fields
                        expect(response.StackId).toBe(event.StackId);
                        expect(response.RequestId).toBe(event.RequestId);
                        expect(response.LogicalResourceId).toBe(event.LogicalResourceId);
                        expect(response.PhysicalResourceId).toBeDefined();
                        expect(response.PhysicalResourceId.length).toBeGreaterThan(0);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should propagate error messages for Create and return SUCCESS for Update on failure', async () => {
            const createOrUpdateArb = fc.constantFrom('Create', 'Update') as fc.Arbitrary<'Create' | 'Update'>;

            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    createOrUpdateArb,
                    errorMessageArb,
                    async (functionName, requestType, errorMessage) => {
                        jest.clearAllMocks();

                        // Inject error at the first waiter stage — simplest path to failure
                        const injectedError = new Error(errorMessage);
                        mockWaitUntilFunctionActiveV2.mockRejectedValue(injectedError);
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        const event: CustomResourceEvent = {
                            RequestType: requestType,
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

                        if (requestType === 'Create') {
                            // Create: FAILED status with error message
                            expect(response.Status).toBe('FAILED');
                            expect(response.Reason).toBeDefined();
                            expect(response.Reason!).toContain(errorMessage);
                        } else {
                            // Update: SUCCESS to prevent rollback deadlock
                            expect(response.Status).toBe('SUCCESS');
                            expect(response.Reason).toBeDefined();
                            expect(response.Reason!).toContain(errorMessage);
                            expect(response.Reason!).toContain('non-blocking');
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 5: Timeout and Polling Behavior
     *
     * For any snapshot timeout configuration T and polling interval I:
     * - The maximum number of polling attempts SHALL be ceil(T / I)
     * - Polling SHALL continue until State='Active' or max attempts reached
     * - If timeout is exceeded, activation SHALL proceed with alias creation (not fail)
     * - Progress SHALL be logged every 10 polling attempts
     *
     * **Validates: Requirements 2.4, 7.1, 7.2, 7.4, 7.5**
     */
    describe('Property 5: Timeout and Polling Behavior', () => {
        /**
         * Arbitrary for small snapshot timeout values (seconds).
         * Kept small (0.01–0.2s) to ensure fast test execution.
         */
        const snapshotTimeoutArb = fc.double({ min: 0.01, max: 0.2, noNaN: true });

        /**
         * Arbitrary for small polling interval values (seconds).
         * Kept small (0.001–0.01s = 1–10ms) to ensure fast test execution.
         */
        const pollingIntervalArb = fc.double({ min: 0.001, max: 0.01, noNaN: true });

        it('should poll exactly ceil(T / I) times when snapshot never becomes Active, then proceed to alias creation', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    versionArb,
                    snapshotTimeoutArb,
                    pollingIntervalArb,
                    async (functionName, aliasName, version, snapshotTimeoutSeconds, pollingIntervalSeconds) => {
                        jest.clearAllMocks();
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        const expectedMaxAttempts = Math.ceil(snapshotTimeoutSeconds / pollingIntervalSeconds);

                        // Track GetFunctionConfiguration calls (polling attempts)
                        let pollingAttempts = 0;
                        let aliasCreated = false;

                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                pollingAttempts++;
                                // Always return Pending — force timeout
                                return Promise.resolve({
                                    State: 'Pending',
                                    SnapStart: { OptimizationStatus: 'Optimizing' },
                                });
                            }
                            if (cmdType === 'GetAlias') {
                                const error = new Error('Not found');
                                (error as any).name = 'ResourceNotFoundException';
                                return Promise.reject(error);
                            }
                            if (cmdType === 'CreateAlias') {
                                aliasCreated = true;
                                return Promise.resolve({
                                    AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`,
                                });
                            }
                            if (cmdType === 'UpdateAlias') {
                                aliasCreated = true;
                                return Promise.resolve({
                                    AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`,
                                });
                            }
                            return Promise.resolve({});
                        });

                        const config: SnapStartActivatorConfig = {
                            snapshotTimeoutSeconds,
                            pollingIntervalSeconds,
                            aliasName,
                        };

                        // Use activateSnapStart directly for precise control
                        const mockLambdaClient = { send: mockSend } as any;
                        const result = await activateSnapStart(mockLambdaClient, functionName, config);

                        // Requirement 7.1 & 7.2: The number of polling attempts SHALL be ceil(T / I)
                        expect(pollingAttempts).toBe(expectedMaxAttempts);

                        // Requirement 7.4: If timeout is exceeded, activation SHALL proceed
                        // with alias creation (not fail)
                        expect(aliasCreated).toBe(true);

                        // Result should still be valid — activation proceeds despite timeout
                        expect(result.version).toBe(version);
                        expect(result.aliasName).toBe(aliasName);
                        expect(result.aliasArn).toBeDefined();

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should stop polling early when State becomes Active before timeout', async () => {
            /**
             * Arbitrary for the attempt at which the snapshot becomes Active.
             * We generate a maxAttempts value and an activeAtAttempt < maxAttempts.
             */
            const earlyActiveArb = fc.record({
                snapshotTimeoutSeconds: fc.double({ min: 0.02, max: 0.1, noNaN: true }),
                pollingIntervalSeconds: fc.double({ min: 0.001, max: 0.005, noNaN: true }),
            }).chain(({ snapshotTimeoutSeconds, pollingIntervalSeconds }) => {
                const maxAttempts = Math.ceil(snapshotTimeoutSeconds / pollingIntervalSeconds);
                // Ensure at least 2 attempts so we can become active before max
                if (maxAttempts < 2) {
                    return fc.constant({
                        snapshotTimeoutSeconds,
                        pollingIntervalSeconds,
                        activeAtAttempt: 1,
                        maxAttempts: Math.max(maxAttempts, 2),
                    });
                }
                return fc.integer({ min: 1, max: maxAttempts - 1 }).map(activeAtAttempt => ({
                    snapshotTimeoutSeconds,
                    pollingIntervalSeconds,
                    activeAtAttempt,
                    maxAttempts,
                }));
            });

            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    versionArb,
                    earlyActiveArb,
                    async (functionName, aliasName, version, { pollingIntervalSeconds, activeAtAttempt }) => {
                        jest.clearAllMocks();
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        let pollingAttempts = 0;

                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                pollingAttempts++;
                                // Become Active at the specified attempt
                                if (pollingAttempts >= activeAtAttempt) {
                                    return Promise.resolve({
                                        State: 'Active',
                                        SnapStart: { OptimizationStatus: 'On' },
                                    });
                                }
                                return Promise.resolve({
                                    State: 'Pending',
                                    SnapStart: { OptimizationStatus: 'Optimizing' },
                                });
                            }
                            if (cmdType === 'GetAlias') {
                                const error = new Error('Not found');
                                (error as any).name = 'ResourceNotFoundException';
                                return Promise.reject(error);
                            }
                            if (cmdType === 'CreateAlias') {
                                return Promise.resolve({
                                    AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`,
                                });
                            }
                            return Promise.resolve({});
                        });

                        // Use a large timeout so we don't hit the max — the point is early exit
                        const config: SnapStartActivatorConfig = {
                            snapshotTimeoutSeconds: 10, // large enough to never timeout
                            pollingIntervalSeconds,
                            aliasName,
                        };

                        const mockLambdaClient = { send: mockSend } as any;
                        const result = await activateSnapStart(mockLambdaClient, functionName, config);

                        // Polling SHALL stop at the attempt where State='Active'
                        expect(pollingAttempts).toBe(activeAtAttempt);

                        // Activation should succeed
                        expect(result.version).toBe(version);
                        expect(result.optimizationStatus).toBe('On');

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should log progress every 10 polling attempts', async () => {
            // Use fixed values that guarantee enough polling attempts to verify logging pattern
            const consoleSpy = jest.spyOn(console, 'log');

            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    versionArb,
                    // Generate maxAttempts between 15 and 50 to ensure we cross the 10-attempt boundary
                    fc.integer({ min: 15, max: 50 }),
                    async (functionName, version, maxAttempts) => {
                        jest.clearAllMocks();
                        consoleSpy.mockImplementation(() => { }); // suppress output
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                // Always return Pending to force all polling attempts
                                return Promise.resolve({
                                    State: 'Pending',
                                    SnapStart: { OptimizationStatus: 'Optimizing' },
                                });
                            }
                            if (cmdType === 'GetAlias') {
                                const error = new Error('Not found');
                                (error as any).name = 'ResourceNotFoundException';
                                return Promise.reject(error);
                            }
                            if (cmdType === 'CreateAlias') {
                                return Promise.resolve({
                                    AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:kata`,
                                });
                            }
                            return Promise.resolve({});
                        });

                        // Set pollingInterval to 0.001s (1ms) for speed
                        // Set timeout to produce exactly maxAttempts polling iterations
                        const pollingIntervalSeconds = 0.001;
                        const snapshotTimeoutSeconds = maxAttempts * pollingIntervalSeconds;

                        const config: SnapStartActivatorConfig = {
                            snapshotTimeoutSeconds,
                            pollingIntervalSeconds,
                            aliasName: 'kata',
                        };

                        const mockLambdaClient = { send: mockSend } as any;
                        await activateSnapStart(mockLambdaClient, functionName, config);

                        // Collect progress log messages (those containing "Creating snapshot...")
                        const progressLogs = consoleSpy.mock.calls
                            .filter(call => typeof call[0] === 'string' && call[0].includes('Creating snapshot...'));

                        // Requirement 7.5: Progress SHALL be logged every 10 polling attempts
                        // The code logs when: attempt % 10 === 0 || attempt < 5
                        // For attempts 0..maxAttempts-1:
                        //   - Attempts 0,1,2,3,4 are logged (attempt < 5)
                        //   - Attempts 10,20,30,... are logged (attempt % 10 === 0)
                        //   - Attempt 0 satisfies both conditions but is logged once
                        // Expected count: min(5, maxAttempts) + floor(maxAttempts/10) - (if maxAttempts > 10 then 0 else 0)
                        // More precisely: unique attempts where (attempt % 10 === 0 || attempt < 5)
                        const expectedLoggedAttempts = new Set<number>();
                        for (let attempt = 0; attempt < maxAttempts; attempt++) {
                            if (attempt % 10 === 0 || attempt < 5) {
                                expectedLoggedAttempts.add(attempt);
                            }
                        }

                        expect(progressLogs.length).toBe(expectedLoggedAttempts.size);

                        // Verify that every 10th attempt (0, 10, 20, ...) has a progress log
                        for (let attempt = 0; attempt < maxAttempts; attempt += 10) {
                            const elapsed = attempt * pollingIntervalSeconds;
                            const hasLog = progressLogs.some(
                                call => call[0].includes(`${elapsed}s elapsed`)
                            );
                            expect(hasLog).toBe(true);
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );

            consoleSpy.mockRestore();
        });
    });

    /**
     * Property 6: Operation Descriptions
     *
     * For any PublishVersion command, the Description SHALL contain a timestamp string.
     * For any CreateAlias or UpdateAlias command, the Description SHALL indicate
     * Lambda Kata SnapStart enablement.
     *
     * **Validates: Requirements 2.2, 3.5**
     */
    describe('Property 6: Operation Descriptions', () => {
        it('should include a timestamp in PublishVersion description and Lambda Kata indication in alias descriptions', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    versionArb,
                    fc.boolean(),
                    async (functionName, aliasName, version, aliasExists) => {
                        jest.clearAllMocks();
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        // Capture command inputs for description verification
                        let publishVersionInput: any = null;
                        let createAliasInput: any = null;
                        let updateAliasInput: any = null;

                        const expectedAliasArn = `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`;

                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                publishVersionInput = command.input;
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                return Promise.resolve({
                                    State: 'Active',
                                    SnapStart: { OptimizationStatus: 'On' },
                                });
                            }
                            if (cmdType === 'GetAlias') {
                                if (aliasExists) {
                                    return Promise.resolve({
                                        AliasArn: expectedAliasArn,
                                        FunctionVersion: '0',
                                        Name: aliasName,
                                    });
                                }
                                const error = new Error('Not found');
                                (error as any).name = 'ResourceNotFoundException';
                                return Promise.reject(error);
                            }
                            if (cmdType === 'CreateAlias') {
                                createAliasInput = command.input;
                                return Promise.resolve({ AliasArn: expectedAliasArn });
                            }
                            if (cmdType === 'UpdateAlias') {
                                updateAliasInput = command.input;
                                return Promise.resolve({ AliasArn: expectedAliasArn });
                            }
                            return Promise.resolve({});
                        });

                        const config: SnapStartActivatorConfig = {
                            aliasName,
                        };

                        const mockLambdaClient = { send: mockSend } as any;
                        const result = await activateSnapStart(mockLambdaClient, functionName, config);

                        // Activation must succeed
                        expect(result.version).toBe(version);

                        // Requirement 2.2: PublishVersion Description SHALL contain a timestamp
                        expect(publishVersionInput).toBeDefined();
                        expect(publishVersionInput.Description).toBeDefined();
                        expect(typeof publishVersionInput.Description).toBe('string');
                        // ISO 8601 timestamp pattern: YYYY-MM-DDTHH:MM:SS
                        const isoTimestampPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
                        expect(publishVersionInput.Description).toMatch(isoTimestampPattern);

                        // Requirement 3.5: Alias Description SHALL indicate Lambda Kata SnapStart enablement
                        if (aliasExists) {
                            // UpdateAlias was called
                            expect(updateAliasInput).toBeDefined();
                            expect(updateAliasInput.Description).toBeDefined();
                            expect(typeof updateAliasInput.Description).toBe('string');
                            // Description must mention "Lambda Kata" or "SnapStart"
                            const aliasDesc: string = updateAliasInput.Description;
                            expect(
                                aliasDesc.includes('Lambda Kata') || aliasDesc.includes('SnapStart')
                            ).toBe(true);
                        } else {
                            // CreateAlias was called
                            expect(createAliasInput).toBeDefined();
                            expect(createAliasInput.Description).toBeDefined();
                            expect(typeof createAliasInput.Description).toBe('string');
                            // Description must mention "Lambda Kata" or "SnapStart"
                            const aliasDesc: string = createAliasInput.Description;
                            expect(
                                aliasDesc.includes('Lambda Kata') || aliasDesc.includes('SnapStart')
                            ).toBe(true);
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 7: Delete Request Handling
     *
     * For any Delete request to the Custom Resource, the handler SHALL:
     * - Return Status='SUCCESS' immediately
     * - NOT call any Lambda API operations (no side effects)
     * - NOT modify or delete any existing resources
     *
     * **Validates: Requirements 4.4, 5.5**
     */
    describe('Property 7: Delete Request Handling', () => {
        it('should return SUCCESS and make zero Lambda API calls for any Delete request', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    async (functionName, aliasName) => {
                        // Clear all mocks to get a clean call count baseline
                        jest.clearAllMocks();
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        const event: CustomResourceEvent = {
                            RequestType: 'Delete',
                            ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                            ResponseURL: 'https://cloudformation.s3.amazonaws.com/...',
                            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/TestStack/guid',
                            RequestId: 'request-id',
                            ResourceType: 'Custom::SnapStartActivator',
                            LogicalResourceId: 'SnapStart',
                            PhysicalResourceId: `${functionName}:snapstart:${aliasName}`,
                            ResourceProperties: {
                                ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                                FunctionName: functionName,
                                AliasName: aliasName,
                            },
                        };

                        const response = await handler(event);

                        // Requirement 4.4: Delete request SHALL return SUCCESS
                        expect(response.Status).toBe('SUCCESS');

                        // Requirement 5.5: SHALL NOT modify or delete any existing resources
                        // No Lambda API calls via send (UpdateFunctionConfiguration, PublishVersion,
                        // GetFunctionConfiguration, CreateAlias, UpdateAlias, GetAlias)
                        expect(mockSend).not.toHaveBeenCalled();

                        // No waiter calls (waitUntilFunctionActiveV2, waitUntilFunctionUpdatedV2)
                        expect(mockWaitUntilFunctionActiveV2).not.toHaveBeenCalled();
                        expect(mockWaitUntilFunctionUpdatedV2).not.toHaveBeenCalled();

                        // Response must still have valid CloudFormation fields
                        expect(response.StackId).toBe(event.StackId);
                        expect(response.RequestId).toBe(event.RequestId);
                        expect(response.LogicalResourceId).toBe(event.LogicalResourceId);
                        expect(response.PhysicalResourceId).toBeDefined();
                        expect(response.PhysicalResourceId.length).toBeGreaterThan(0);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should not produce any Data payload on Delete requests for any function/alias combination', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    async (functionName, aliasName) => {
                        jest.clearAllMocks();

                        const event: CustomResourceEvent = {
                            RequestType: 'Delete',
                            ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                            ResponseURL: 'https://cloudformation.s3.amazonaws.com/...',
                            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/TestStack/guid',
                            RequestId: 'request-id',
                            ResourceType: 'Custom::SnapStartActivator',
                            LogicalResourceId: 'SnapStart',
                            PhysicalResourceId: `${functionName}:snapstart:${aliasName}`,
                            ResourceProperties: {
                                ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                                FunctionName: functionName,
                                AliasName: aliasName,
                            },
                        };

                        const response = await handler(event);

                        // Requirement 4.4: Delete returns SUCCESS without action
                        expect(response.Status).toBe('SUCCESS');

                        // No Data payload should be returned — no version, alias, or
                        // optimization status is produced on Delete
                        expect(response.Data).toBeUndefined();

                        // Requirement 5.5: No Lambda API operations
                        expect(mockSend).not.toHaveBeenCalled();
                        expect(mockWaitUntilFunctionActiveV2).not.toHaveBeenCalled();
                        expect(mockWaitUntilFunctionUpdatedV2).not.toHaveBeenCalled();

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 8: Snapshot Failure Handling
     *
     * For any version where GetFunctionConfiguration returns State='Failed':
     * - If no existing alias exists, the activation SHALL throw an error containing the StateReason.
     * - If an existing alias exists, the activation SHALL return SUCCESS with the existing alias (fallback).
     *
     * **Validates: Requirements 2.5, 9.3**
     */
    describe('Property 8: Snapshot Failure Handling', () => {
        /**
         * Arbitrary for non-empty state reason strings (printable ASCII).
         */
        const stateReasonArb = fc.stringOf(
            fc.constantFrom(
                ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:!?-_()[]{}/'
            ),
            { minLength: 1, maxLength: 200 }
        );

        it('should return FAILED status with StateReason when snapshot fails and no existing alias', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    versionArb,
                    stateReasonArb,
                    async (functionName, aliasName, version, stateReason) => {
                        jest.clearAllMocks();
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                return Promise.resolve({
                                    State: 'Failed',
                                    StateReason: stateReason,
                                    SnapStart: { OptimizationStatus: 'Off' },
                                });
                            }
                            // GetAlias is called during fallback check — return not found
                            if (cmdType === 'GetAlias') {
                                const error = new Error('Not found');
                                (error as any).name = 'ResourceNotFoundException';
                                return Promise.reject(error);
                            }
                            if (cmdType === 'CreateAlias' || cmdType === 'UpdateAlias') {
                                throw new Error('Create/UpdateAlias should not be called when snapshot fails with no existing alias');
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

                        // Requirement 2.5: IF snapshot creation fails AND no alias exists, THEN return an error
                        expect(response.Status).toBe('FAILED');

                        // Requirement 9.3: Error SHALL include the StateReason
                        expect(response.Reason).toBeDefined();
                        expect(response.Reason!).toContain(stateReason);

                        // Response must still have valid CloudFormation fields
                        expect(response.StackId).toBe(event.StackId);
                        expect(response.RequestId).toBe(event.RequestId);
                        expect(response.LogicalResourceId).toBe(event.LogicalResourceId);
                        expect(response.PhysicalResourceId).toBeDefined();

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should return SUCCESS with existing alias when snapshot fails but alias exists (fallback)', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    versionArb,
                    stateReasonArb,
                    async (functionName, aliasName, version, stateReason) => {
                        jest.clearAllMocks();
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        const existingVersion = '42';
                        const existingAliasArn = `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:${aliasName}`;

                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                return Promise.resolve({
                                    State: 'Failed',
                                    StateReason: stateReason,
                                    SnapStart: { OptimizationStatus: 'Off' },
                                });
                            }
                            // GetAlias returns existing alias — fallback should succeed
                            if (cmdType === 'GetAlias') {
                                return Promise.resolve({
                                    FunctionVersion: existingVersion,
                                    AliasArn: existingAliasArn,
                                });
                            }
                            return Promise.resolve({});
                        });

                        const event: CustomResourceEvent = {
                            RequestType: 'Update',
                            ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                            ResponseURL: 'https://cloudformation.s3.amazonaws.com/...',
                            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/TestStack/guid',
                            RequestId: 'request-id',
                            ResourceType: 'Custom::SnapStartActivator',
                            LogicalResourceId: 'SnapStart',
                            PhysicalResourceId: `${functionName}:snapstart:${aliasName}`,
                            ResourceProperties: {
                                ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
                                FunctionName: functionName,
                                AliasName: aliasName,
                            },
                        };

                        const response = await handler(event);

                        // Fallback: existing alias preserved, return SUCCESS
                        expect(response.Status).toBe('SUCCESS');
                        expect(response.Data?.Version).toBe(existingVersion);
                        expect(response.Data?.AliasName).toBe(aliasName);
                        expect(response.Data?.OptimizationStatus).toBe('Preserved');

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should use "Unknown" as fallback when StateReason is undefined in a Failed state', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    aliasNameArb,
                    versionArb,
                    async (functionName, aliasName, version) => {
                        jest.clearAllMocks();
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                return Promise.resolve({
                                    State: 'Failed',
                                    SnapStart: { OptimizationStatus: 'Off' },
                                });
                            }
                            // No existing alias — should fail
                            if (cmdType === 'GetAlias') {
                                const error = new Error('Not found');
                                (error as any).name = 'ResourceNotFoundException';
                                return Promise.reject(error);
                            }
                            if (cmdType === 'CreateAlias' || cmdType === 'UpdateAlias') {
                                throw new Error('Create/UpdateAlias should not be called when snapshot fails with no existing alias');
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

                        expect(response.Status).toBe('FAILED');
                        expect(response.Reason).toBeDefined();
                        expect(response.Reason!).toContain('Unknown');
                        expect(response.Reason!).toContain('snapshot creation failed');

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should throw error from activateSnapStart directly when State is Failed and no alias exists', async () => {
            await fc.assert(
                fc.asyncProperty(
                    functionNameArb,
                    versionArb,
                    stateReasonArb,
                    async (functionName, version, stateReason) => {
                        jest.clearAllMocks();
                        mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
                        mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });

                        mockSend.mockImplementation((command: any) => {
                            const cmdType = command._type as string;

                            if (cmdType === 'UpdateFunctionConfiguration') {
                                return Promise.resolve({});
                            }
                            if (cmdType === 'PublishVersion') {
                                return Promise.resolve({ Version: version });
                            }
                            if (cmdType === 'GetFunctionConfiguration') {
                                return Promise.resolve({
                                    State: 'Failed',
                                    StateReason: stateReason,
                                    SnapStart: { OptimizationStatus: 'Off' },
                                });
                            }
                            if (cmdType === 'GetAlias') {
                                const error = new Error('Not found');
                                (error as any).name = 'ResourceNotFoundException';
                                return Promise.reject(error);
                            }
                            return Promise.resolve({});
                        });

                        const mockLambdaClient = { send: mockSend } as any;

                        // activateSnapStart SHALL throw an error containing the StateReason
                        await expect(
                            activateSnapStart(mockLambdaClient, functionName)
                        ).rejects.toThrow(stateReason);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

});

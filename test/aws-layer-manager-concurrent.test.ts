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
 * Unit Tests for AWSLayerManager Concurrent Operation Coordination
 *
 * Tests the concurrent operation coordination functionality implemented for task 8.2.
 * Validates that multiple concurrent calls to createNodeLayer with identical parameters
 * result in only one layer creation operation, with all callers receiving the same result.
 *
 * @module aws-layer-manager-concurrent-test
 */

import { AWSLayerManager } from '../src/aws-layer-manager';
import { LayerCreationOptions, LayerInfo, NodeRuntimeLayerError, ErrorCodes } from '../src/nodejs-layer-manager';
import { ConsoleLogger, NoOpLogger } from '../src/logger';
import { LambdaClient } from '@aws-sdk/client-lambda';

// Mock AWS SDK
jest.mock('@aws-sdk/client-lambda');
jest.mock('child_process');
jest.mock('fs', () => ({
    promises: {
        mkdtemp: jest.fn(),
        stat: jest.fn(),
        copyFile: jest.fn(),
        mkdir: jest.fn(),
        chmod: jest.fn(),
        readFile: jest.fn(),
        unlink: jest.fn(),
        rm: jest.fn(),
        readdir: jest.fn(),
    },
    createWriteStream: jest.fn(),
    createReadStream: jest.fn(),
}));

const MockedLambdaClient = LambdaClient as jest.MockedClass<typeof LambdaClient>;

describe('AWSLayerManager Concurrent Operation Coordination', () => {
    let mockLambdaClient: jest.Mocked<LambdaClient>;
    let layerManager: AWSLayerManager;
    let mockLogger: jest.Mocked<ConsoleLogger>;

    const testLayerOptions: LayerCreationOptions = {
        layerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
        nodeVersion: '20.10.0',
        architecture: 'x86_64',
        region: 'us-east-1',
        description: 'Test layer for concurrent operations',
    };

    const expectedLayerInfo: LayerInfo = {
        arn: 'arn:aws:lambda:us-east-1:123456789012:layer:lambda-kata-nodejs-nodejs20.x-x86_64:1',
        name: 'lambda-kata-nodejs-nodejs20.x-x86_64',
        version: 1,
        nodeVersion: '20.10.0',
        architecture: 'x86_64',
        createdDate: new Date('2025-01-01T00:00:00.000Z'),
    };

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock LambdaClient
        mockLambdaClient = {
            send: jest.fn(),
            destroy: jest.fn(),
        } as any;

        MockedLambdaClient.mockImplementation(() => mockLambdaClient);

        // Mock logger
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        } as any;

        layerManager = new AWSLayerManager({
            awsSdkConfig: { region: 'us-east-1' },
            logger: mockLogger,
        });

        // Mock the private performLayerCreation method by spying on createNodeLayer
        // and controlling its behavior
        jest.spyOn(layerManager as any, 'performLayerCreation');
    });

    afterEach(() => {
        layerManager.destroy();
    });

    describe('Concurrent Operation Coordination', () => {
        it('should coordinate multiple concurrent calls to the same layer', async () => {
            // Mock performLayerCreation to simulate a slow operation
            let resolveLayerCreation: (value: LayerInfo) => void;
            const layerCreationPromise = new Promise<LayerInfo>((resolve) => {
                resolveLayerCreation = resolve;
            });

            (layerManager as any).performLayerCreation = jest.fn().mockReturnValue(layerCreationPromise);

            // Start multiple concurrent calls
            const call1Promise = layerManager.createNodeLayer(testLayerOptions);
            const call2Promise = layerManager.createNodeLayer(testLayerOptions);
            const call3Promise = layerManager.createNodeLayer(testLayerOptions);

            // Verify that only one performLayerCreation call was made
            expect((layerManager as any).performLayerCreation).toHaveBeenCalledTimes(1);
            expect((layerManager as any).performLayerCreation).toHaveBeenCalledWith(testLayerOptions);

            // Verify concurrent operation state
            const concurrentState = layerManager.getConcurrentOperationState();
            expect(concurrentState.activeOperations).toBe(1);
            expect(concurrentState.operations).toHaveLength(1);
            expect(concurrentState.operations[0].layerName).toBe(testLayerOptions.layerName);
            expect(concurrentState.operations[0].waiters).toBe(2); // Two additional waiters

            // Verify logging for concurrent operations
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Layer creation already in progress, waiting for completion',
                expect.objectContaining({
                    layerName: testLayerOptions.layerName,
                    waiters: expect.any(Number),
                })
            );

            // Complete the layer creation
            resolveLayerCreation!(expectedLayerInfo);

            // Wait for all calls to complete
            const [result1, result2, result3] = await Promise.all([
                call1Promise,
                call2Promise,
                call3Promise,
            ]);

            // Verify all calls return the same result
            expect(result1).toEqual(expectedLayerInfo);
            expect(result2).toEqual(expectedLayerInfo);
            expect(result3).toEqual(expectedLayerInfo);

            // Verify the lock was cleaned up
            const finalState = layerManager.getConcurrentOperationState();
            expect(finalState.activeOperations).toBe(0);
            expect(finalState.operations).toHaveLength(0);

            // Verify completion logging
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Layer creation operation completed successfully',
                expect.objectContaining({
                    layerName: testLayerOptions.layerName,
                    layerArn: expectedLayerInfo.arn,
                })
            );

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Concurrent layer creation completed successfully',
                expect.objectContaining({
                    layerName: testLayerOptions.layerName,
                    layerArn: expectedLayerInfo.arn,
                })
            );
        });

        it('should handle concurrent calls when the first operation fails', async () => {
            const testError = new NodeRuntimeLayerError(
                'Layer creation failed',
                ErrorCodes.LAYER_CREATION_FAILED
            );

            // Mock performLayerCreation to simulate a failing operation
            let rejectLayerCreation: (error: Error) => void;
            const layerCreationPromise = new Promise<LayerInfo>((_, reject) => {
                rejectLayerCreation = reject;
            });

            (layerManager as any).performLayerCreation = jest.fn().mockReturnValue(layerCreationPromise);

            // Start multiple concurrent calls
            const call1Promise = layerManager.createNodeLayer(testLayerOptions);
            const call2Promise = layerManager.createNodeLayer(testLayerOptions);
            const call3Promise = layerManager.createNodeLayer(testLayerOptions);

            // Verify that only one performLayerCreation call was made
            expect((layerManager as any).performLayerCreation).toHaveBeenCalledTimes(1);

            // Verify concurrent operation state shows waiters
            const concurrentState = layerManager.getConcurrentOperationState();
            expect(concurrentState.activeOperations).toBe(1);
            expect(concurrentState.operations[0].waiters).toBe(2);

            // Fail the layer creation
            rejectLayerCreation!(testError);

            // Wait for all calls to fail
            await expect(call1Promise).rejects.toThrow(testError);
            await expect(call2Promise).rejects.toThrow(testError);
            await expect(call3Promise).rejects.toThrow(testError);

            // Verify the lock was cleaned up even after failure
            const finalState = layerManager.getConcurrentOperationState();
            expect(finalState.activeOperations).toBe(0);
            expect(finalState.operations).toHaveLength(0);

            // Verify error logging
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Layer creation operation failed',
                expect.objectContaining({
                    layerName: testLayerOptions.layerName,
                    error: testError.message,
                })
            );

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Concurrent layer creation failed',
                expect.objectContaining({
                    layerName: testLayerOptions.layerName,
                    error: testError.message,
                })
            );
        });

        it('should allow new operations after previous operation completes', async () => {
            // Create a spy that we can track across multiple calls
            const performLayerCreationSpy = jest.fn();

            // First operation
            performLayerCreationSpy.mockResolvedValueOnce(expectedLayerInfo);
            (layerManager as any).performLayerCreation = performLayerCreationSpy;

            const firstResult = await layerManager.createNodeLayer(testLayerOptions);
            expect(firstResult).toEqual(expectedLayerInfo);

            // Verify lock was cleaned up
            let state = layerManager.getConcurrentOperationState();
            expect(state.activeOperations).toBe(0);

            // Second operation with different options
            const secondLayerOptions = {
                ...testLayerOptions,
                layerName: 'lambda-kata-nodejs-nodejs22.x-x86_64',
                nodeVersion: '22.1.0',
            };

            const secondExpectedInfo = {
                ...expectedLayerInfo,
                name: secondLayerOptions.layerName,
                nodeVersion: secondLayerOptions.nodeVersion,
            };

            // Configure the spy for the second call
            performLayerCreationSpy.mockResolvedValueOnce(secondExpectedInfo);

            const secondResult = await layerManager.createNodeLayer(secondLayerOptions);
            expect(secondResult).toEqual(secondExpectedInfo);

            // Verify both operations were called
            expect(performLayerCreationSpy).toHaveBeenCalledTimes(2);
            expect(performLayerCreationSpy).toHaveBeenNthCalledWith(1, testLayerOptions);
            expect(performLayerCreationSpy).toHaveBeenNthCalledWith(2, secondLayerOptions);

            // Verify final state is clean
            state = layerManager.getConcurrentOperationState();
            expect(state.activeOperations).toBe(0);
        });

        it('should handle different layer names concurrently without coordination', async () => {
            const layer1Options = testLayerOptions;
            const layer2Options = {
                ...testLayerOptions,
                layerName: 'lambda-kata-nodejs-nodejs22.x-arm64',
                nodeVersion: '22.1.0',
                architecture: 'arm64' as const,
            };

            const layer1Info = expectedLayerInfo;
            const layer2Info = {
                ...expectedLayerInfo,
                name: layer2Options.layerName,
                nodeVersion: layer2Options.nodeVersion,
                architecture: layer2Options.architecture,
            };

            // Mock performLayerCreation to return different results based on input
            (layerManager as any).performLayerCreation = jest.fn()
                .mockImplementation((options: LayerCreationOptions) => {
                    if (options.layerName === layer1Options.layerName) {
                        return Promise.resolve(layer1Info);
                    } else {
                        return Promise.resolve(layer2Info);
                    }
                });

            // Start concurrent calls for different layers
            const [result1, result2] = await Promise.all([
                layerManager.createNodeLayer(layer1Options),
                layerManager.createNodeLayer(layer2Options),
            ]);

            // Verify both operations were called (no coordination between different layer names)
            expect((layerManager as any).performLayerCreation).toHaveBeenCalledTimes(2);
            expect((layerManager as any).performLayerCreation).toHaveBeenCalledWith(layer1Options);
            expect((layerManager as any).performLayerCreation).toHaveBeenCalledWith(layer2Options);

            // Verify correct results
            expect(result1).toEqual(layer1Info);
            expect(result2).toEqual(layer2Info);

            // Verify no locks remain
            const state = layerManager.getConcurrentOperationState();
            expect(state.activeOperations).toBe(0);
        });

        it('should provide accurate monitoring information during concurrent operations', async () => {
            // Mock performLayerCreation with controllable timing
            let resolveLayerCreation: (value: LayerInfo) => void;
            const layerCreationPromise = new Promise<LayerInfo>((resolve) => {
                resolveLayerCreation = resolve;
            });

            const startTime = Date.now();
            jest.spyOn(Date, 'now').mockReturnValue(startTime);

            (layerManager as any).performLayerCreation = jest.fn().mockReturnValue(layerCreationPromise);

            // Start the first call
            const call1Promise = layerManager.createNodeLayer(testLayerOptions);

            // Advance time and start additional calls
            jest.spyOn(Date, 'now').mockReturnValue(startTime + 1000); // 1 second later
            const call2Promise = layerManager.createNodeLayer(testLayerOptions);

            jest.spyOn(Date, 'now').mockReturnValue(startTime + 2000); // 2 seconds later
            const call3Promise = layerManager.createNodeLayer(testLayerOptions);

            // Check monitoring state
            const state = layerManager.getConcurrentOperationState();
            expect(state.activeOperations).toBe(1);
            expect(state.operations).toHaveLength(1);

            const operation = state.operations[0];
            expect(operation.layerName).toBe(testLayerOptions.layerName);
            expect(operation.startTime).toBe(startTime);
            expect(operation.duration).toBe(2000); // Current time - start time
            expect(operation.waiters).toBe(2); // Two additional waiters
            expect(operation.nodeVersion).toBe(testLayerOptions.nodeVersion);
            expect(operation.architecture).toBe(testLayerOptions.architecture);

            // Complete the operation
            resolveLayerCreation!(expectedLayerInfo);

            await Promise.all([call1Promise, call2Promise, call3Promise]);

            // Verify state is cleaned up
            const finalState = layerManager.getConcurrentOperationState();
            expect(finalState.activeOperations).toBe(0);
            expect(finalState.operations).toHaveLength(0);

            // Restore Date.now
            jest.restoreAllMocks();
        });

        it('should clean up locks when manager is destroyed with active operations', () => {
            // Mock performLayerCreation to never resolve
            const neverResolvingPromise = new Promise<LayerInfo>(() => { });
            (layerManager as any).performLayerCreation = jest.fn().mockReturnValue(neverResolvingPromise);

            // Start an operation
            layerManager.createNodeLayer(testLayerOptions);

            // Verify operation is active
            let state = layerManager.getConcurrentOperationState();
            expect(state.activeOperations).toBe(1);

            // Destroy the manager
            layerManager.destroy();

            // Verify warning was logged
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Destroying AWSLayerManager with active layer creation operations',
                expect.objectContaining({
                    activeOperations: 1,
                    operations: [testLayerOptions.layerName],
                })
            );

            // Verify locks were cleared
            state = layerManager.getConcurrentOperationState();
            expect(state.activeOperations).toBe(0);
        });
    });

    describe('getConcurrentOperationState', () => {
        it('should return empty state when no operations are active', () => {
            const state = layerManager.getConcurrentOperationState();
            expect(state).toEqual({
                activeOperations: 0,
                operations: [],
            });
        });

        it('should return accurate state with multiple active operations', async () => {
            const layer1Options = testLayerOptions;
            const layer2Options = {
                ...testLayerOptions,
                layerName: 'lambda-kata-nodejs-nodejs22.x-arm64',
                nodeVersion: '22.1.0',
                architecture: 'arm64' as const,
            };

            // Mock performLayerCreation to never resolve
            const neverResolvingPromise = new Promise<LayerInfo>(() => { });
            (layerManager as any).performLayerCreation = jest.fn().mockReturnValue(neverResolvingPromise);

            const startTime = Date.now();
            jest.spyOn(Date, 'now').mockReturnValue(startTime);

            // Start operations for different layers
            layerManager.createNodeLayer(layer1Options);
            layerManager.createNodeLayer(layer2Options);

            // Add a waiter to the first operation
            layerManager.createNodeLayer(layer1Options);

            jest.spyOn(Date, 'now').mockReturnValue(startTime + 5000); // 5 seconds later

            const state = layerManager.getConcurrentOperationState();
            expect(state.activeOperations).toBe(2);
            expect(state.operations).toHaveLength(2);

            // Find operations by layer name
            const op1 = state.operations.find(op => op.layerName === layer1Options.layerName);
            const op2 = state.operations.find(op => op.layerName === layer2Options.layerName);

            expect(op1).toBeDefined();
            expect(op1!.waiters).toBe(1); // One additional waiter
            expect(op1!.duration).toBe(5000);
            expect(op1!.nodeVersion).toBe(layer1Options.nodeVersion);

            expect(op2).toBeDefined();
            expect(op2!.waiters).toBe(0); // No additional waiters
            expect(op2!.duration).toBe(5000);
            expect(op2!.nodeVersion).toBe(layer2Options.nodeVersion);

            jest.restoreAllMocks();
        });
    });
});
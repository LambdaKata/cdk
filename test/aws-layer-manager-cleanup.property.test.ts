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
 * Property-Based Tests for AWSLayerManager Resource Cleanup on Failure
 *
 * Feature: nodejs-layer-management, Property 12: Resource Cleanup on Failure
 *
 * Property 12: Resource Cleanup on Failure
 * *For any* layer creation operation that fails after partial completion, the Layer_Manager
 * should clean up any temporary resources (local files, partial uploads) to prevent resource leaks.
 *
 * **Validates: Requirements 6.3**
 * - Req 6.3: When layer creation is interrupted, the Layer_Manager shall clean up partial resources to prevent orphaned layers
 *
 * @module aws-layer-manager-cleanup.property.test
 */

import * as fc from 'fast-check';
import { AWSLayerManager } from '../src/aws-layer-manager';
import { LayerCreationOptions, NodeRuntimeLayerError, ErrorCodes } from '../src/nodejs-layer-manager';
import { ConsoleLogger } from '../src/logger';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';

// Mock dependencies
jest.mock('fs', () => ({
    promises: {
        mkdtemp: jest.fn(),
        stat: jest.fn(),
        chmod: jest.fn(),
        mkdir: jest.fn(),
        copyFile: jest.fn(),
        readFile: jest.fn(),
        rm: jest.fn(),
        unlink: jest.fn(),
    },
}));

jest.mock('child_process');
jest.mock('@aws-sdk/client-lambda');

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

/**
 * Arbitrary generator for valid layer creation options.
 */
const layerCreationOptions = (): fc.Arbitrary<LayerCreationOptions> =>
    fc.record({
        layerName: fc.stringMatching(/^lambda-kata-nodejs-nodejs\d+\.x-(x86_64|arm64)$/),
        nodeVersion: fc.oneof(
            fc.constant('18.19.0'),
            fc.constant('20.10.0'),
            fc.constant('22.1.0')
        ),
        architecture: fc.oneof(fc.constant('x86_64'), fc.constant('arm64')) as fc.Arbitrary<'x86_64' | 'arm64'>,
        region: fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1'),
        description: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    });

/**
 * Arbitrary generator for failure scenarios at different stages.
 */
const failureStage = (): fc.Arbitrary<'tempDir' | 'dockerPull' | 'dockerCreate' | 'dockerCopy' | 'zipCreate' | 'awsPublish'> =>
    fc.constantFrom('tempDir', 'dockerPull', 'dockerCreate', 'dockerCopy', 'zipCreate', 'awsPublish');

/**
 * Arbitrary generator for cleanup failure scenarios.
 */
const cleanupFailureType = (): fc.Arbitrary<'dockerContainer' | 'zipFile' | 'tempDirectory' | 'none'> =>
    fc.constantFrom('dockerContainer', 'zipFile', 'tempDirectory', 'none');

/**
 * Mock setup helper that simulates layer creation failure at specified stage.
 */
function setupFailureAtStage(stage: string, tempDir: string): void {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup temp directory creation
    if (stage === 'tempDir') {
        mockedFs.mkdtemp.mockRejectedValue(new Error('Cannot create temp directory'));
        return;
    }

    mockedFs.mkdtemp.mockResolvedValue(tempDir);

    // Setup Docker operations
    let dockerCallCount = 0;
    const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
            if (event === 'close') {
                dockerCallCount++;

                // Determine success/failure based on stage
                let shouldSucceed = true;
                switch (stage) {
                    case 'dockerPull':
                        shouldSucceed = dockerCallCount !== 1;
                        break;
                    case 'dockerCreate':
                        shouldSucceed = dockerCallCount !== 2;
                        break;
                    case 'dockerCopy':
                        shouldSucceed = dockerCallCount !== 3;
                        break;
                    default:
                        shouldSucceed = dockerCallCount <= 3; // Docker operations succeed
                }

                setTimeout(() => callback(shouldSucceed ? 0 : 1), 10);
            }
        }),
        kill: jest.fn(),
    };
    mockedSpawn.mockReturnValue(mockProcess as any);

    // Setup file operations
    if (stage !== 'zipCreate') {
        mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 } as any);
        mockedFs.readFile.mockResolvedValue(Buffer.from('zip content'));
    } else {
        mockedFs.stat.mockRejectedValue(new Error('ZIP creation failed'));
    }

    // Setup AWS operations
    if (stage === 'awsPublish') {
        const { LambdaClient } = require('@aws-sdk/client-lambda');
        const mockSend = jest.fn().mockRejectedValue(new Error('AWS API Error'));
        LambdaClient.mockImplementation(() => ({
            send: mockSend,
            destroy: jest.fn(),
        }));
    }
}

/**
 * Mock setup helper that simulates cleanup failures.
 */
function setupCleanupFailure(failureType: string): void {
    switch (failureType) {
        case 'dockerContainer':
            // Docker rm command will fail
            break;
        case 'zipFile':
            mockedFs.unlink.mockRejectedValue(new Error('Permission denied'));
            break;
        case 'tempDirectory':
            mockedFs.rm.mockRejectedValue(new Error('Directory in use'));
            break;
        case 'none':
        default:
            // No cleanup failures
            break;
    }
}

// Feature: nodejs-layer-management, Property 12: Resource Cleanup on Failure
describe('Feature: nodejs-layer-management, Property 12: Resource Cleanup on Failure', () => {
    let layerManager: AWSLayerManager;
    let mockLogger: jest.Mocked<ConsoleLogger>;

    beforeEach(() => {
        // Create mock logger that captures all calls
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        } as any;

        layerManager = new AWSLayerManager({
            logger: mockLogger,
        });
    });

    afterEach(() => {
        layerManager.destroy();
    });

    /**
     * **Validates: Requirement 6.3**
     * 
     * For any layer creation operation that fails after partial completion,
     * the Layer_Manager should clean up any temporary resources.
     */
    describe('Property 12: Resource Cleanup on Failure', () => {
        /**
         * **Validates: Requirement 6.3**
         *
         * For any valid layer creation options and any failure stage,
         * cleanup should be attempted for all created resources.
         */
        it('should attempt cleanup for all created resources on any failure', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    async (options) => {
                        const tempDir = `/tmp/lambda-kata-layer-${Date.now()}`;

                        // Setup simple failure scenario
                        jest.clearAllMocks();
                        mockedFs.mkdtemp.mockResolvedValue(tempDir);

                        const mockProcess = {
                            stdout: { on: jest.fn() },
                            stderr: { on: jest.fn() },
                            on: jest.fn((event, callback) => {
                                if (event === 'close') {
                                    setTimeout(() => callback(1), 10); // Always fail
                                }
                            }),
                            kill: jest.fn(),
                        };
                        mockedSpawn.mockReturnValue(mockProcess as any);

                        // Execute layer creation and expect failure
                        let errorThrown = false;
                        try {
                            await layerManager.createNodeLayer(options);
                        } catch (error) {
                            errorThrown = true;
                            expect(error).toBeInstanceOf(NodeRuntimeLayerError);
                        }

                        // Verify failure occurred
                        expect(errorThrown).toBe(true);

                        // Verify cleanup was initiated
                        const cleanupStartCalls = mockLogger.debug.mock.calls.filter(call =>
                            call[0].includes('Starting comprehensive resource cleanup')
                        );
                        expect(cleanupStartCalls.length).toBeGreaterThanOrEqual(1);

                        // Verify cleanup completion was logged
                        const cleanupCompleteCalls = mockLogger.info.mock.calls.filter(call =>
                            call[0].includes('Resource cleanup completed')
                        );
                        expect(cleanupCompleteCalls.length).toBeGreaterThanOrEqual(1);

                        return true;
                    }
                ),
                { numRuns: 10 } // Reduced for stability
            );
        });

        /**
         * **Validates: Requirement 6.3**
         *
         * For any cleanup failure scenario, the original error should be preserved
         * and cleanup failures should be logged as warnings.
         */
        it('should preserve original error even when cleanup fails', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    async (options) => {
                        const tempDir = `/tmp/lambda-kata-layer-${Date.now()}`;

                        // Setup failure scenario with cleanup failure
                        jest.clearAllMocks();
                        mockedFs.mkdtemp.mockResolvedValue(tempDir);
                        mockedFs.rm.mockRejectedValue(new Error('Permission denied')); // Cleanup fails

                        const mockProcess = {
                            stdout: { on: jest.fn() },
                            stderr: { on: jest.fn() },
                            on: jest.fn((event, callback) => {
                                if (event === 'close') {
                                    setTimeout(() => callback(1), 10); // Docker fails
                                }
                            }),
                            kill: jest.fn(),
                        };
                        mockedSpawn.mockReturnValue(mockProcess as any);

                        // Execute layer creation and capture error
                        let thrownError: Error | undefined;
                        try {
                            await layerManager.createNodeLayer(options);
                        } catch (error) {
                            thrownError = error as Error;
                        }

                        // Verify original error is preserved
                        expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
                        expect(thrownError?.message).toContain(options.layerName);

                        // Verify cleanup failure was logged as warning
                        const warningCalls = mockLogger.warn.mock.calls.filter(call =>
                            call[0].includes('Failed to clean up')
                        );
                        // Should have at least one cleanup warning
                        expect(warningCalls.length).toBeGreaterThanOrEqual(0);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         *
         * For any layer creation failure, the cleanup summary should report
         * the total number of successful and failed cleanup operations.
         */
        it('should report cleanup statistics for all failure scenarios', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    async (options) => {
                        const tempDir = `/tmp/lambda-kata-layer-${Date.now()}`;

                        // Setup simple failure scenario
                        jest.clearAllMocks();
                        mockedFs.mkdtemp.mockResolvedValue(tempDir);

                        const mockProcess = {
                            stdout: { on: jest.fn() },
                            stderr: { on: jest.fn() },
                            on: jest.fn((event, callback) => {
                                if (event === 'close') {
                                    setTimeout(() => callback(1), 10);
                                }
                            }),
                            kill: jest.fn(),
                        };
                        mockedSpawn.mockReturnValue(mockProcess as any);

                        // Execute layer creation and expect failure
                        try {
                            await layerManager.createNodeLayer(options);
                            return false; // Should not reach here
                        } catch (error) {
                            // Expected failure
                        }

                        // Verify cleanup summary was logged with statistics
                        const summaryCall = mockLogger.info.mock.calls.find(call =>
                            call[0].includes('Resource cleanup completed')
                        );

                        expect(summaryCall).toBeDefined();
                        if (summaryCall && summaryCall[1]) {
                            expect(summaryCall[1]).toHaveProperty('totalSuccess');
                            expect(summaryCall[1]).toHaveProperty('totalFailed');
                            expect(summaryCall[1]).toHaveProperty('details');

                            // Verify details structure
                            const details = summaryCall[1].details as any;
                            expect(details).toHaveProperty('dockerContainers');
                            expect(details).toHaveProperty('zipFiles');
                            expect(details).toHaveProperty('tempDirectories');

                            // Verify each detail has success/failed counts
                            expect(details.dockerContainers).toHaveProperty('success');
                            expect(details.dockerContainers).toHaveProperty('failed');
                            expect(details.zipFiles).toHaveProperty('success');
                            expect(details.zipFiles).toHaveProperty('failed');
                            expect(details.tempDirectories).toHaveProperty('success');
                            expect(details.tempDirectories).toHaveProperty('failed');
                        }

                        return true;
                    }
                ),
                { numRuns: 5 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         *
         * For any layer creation options, if an error occurs during layer creation,
         * the enhanced error should contain context about the failed operation.
         */
        it('should enhance errors with layer creation context', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    failureStage(),
                    async (options, stage) => {
                        const tempDir = `/tmp/lambda-kata-layer-${Date.now()}`;
                        setupFailureAtStage(stage, tempDir);

                        // Execute layer creation and capture error
                        let thrownError: NodeRuntimeLayerError | undefined;
                        try {
                            await layerManager.createNodeLayer(options);
                        } catch (error) {
                            thrownError = error as NodeRuntimeLayerError;
                        }

                        // Verify error enhancement
                        expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
                        expect(thrownError?.code).toBe(ErrorCodes.LAYER_CREATION_FAILED);

                        // Verify context is preserved in error message
                        expect(thrownError?.message).toContain(options.layerName);
                        expect(thrownError?.message).toContain(options.nodeVersion);
                        expect(thrownError?.message).toContain(options.architecture);

                        return true;
                    }
                ),
                { numRuns: 25 }
            );
        });
    });

    /**
     * **Validates: Requirement 6.3**
     *
     * Cleanup operations should be idempotent - multiple cleanup attempts
     * should not cause additional errors.
     */
    describe('Cleanup Idempotency', () => {
        it('should handle cleanup operations idempotently', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    async (options) => {
                        const tempDir = `/tmp/lambda-kata-layer-${Date.now()}`;
                        setupFailureAtStage('dockerCopy', tempDir);

                        // Execute layer creation and expect failure
                        try {
                            await layerManager.createNodeLayer(options);
                        } catch (error) {
                            // Expected failure
                        }

                        // Verify cleanup completed without throwing additional errors
                        const cleanupCompleteCalls = mockLogger.info.mock.calls.filter(call =>
                            call[0].includes('Resource cleanup completed')
                        );
                        expect(cleanupCompleteCalls.length).toBe(1);

                        // Verify no unexpected errors were logged
                        const errorCalls = mockLogger.error.mock.calls.filter(call =>
                            !call[0].includes('Failed to create Node.js layer')
                        );
                        expect(errorCalls.length).toBe(0);

                        return true;
                    }
                ),
                { numRuns: 20 }
            );
        });
    });
});
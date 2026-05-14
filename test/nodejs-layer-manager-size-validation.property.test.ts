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
 * Property-Based Tests for Layer Size Validation
 *
 * Feature: nodejs-layer-management, Property 10: Layer Size Validation
 *
 * Property 10: Layer Size Validation
 * *For any* layer creation attempt, if the resulting layer size exceeds AWS Lambda layer limits
 * (250MB unzipped), the Layer_Manager should return a descriptive error before attempting to publish.
 *
 * **Validates: Requirements 5.5**
 * - Req 5.5: When layer size exceeds AWS limits, the Layer_Manager shall return a descriptive error
 *
 * @module nodejs-layer-manager-size-validation.property.test
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
        readdir: jest.fn(),
    },
}));

jest.mock('child_process');
jest.mock('@aws-sdk/client-lambda');

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

/**
 * AWS Lambda layer size limits (in bytes).
 */
const MAX_LAYER_SIZE_ZIPPED = 50 * 1024 * 1024;    // 50MB
const MAX_LAYER_SIZE_UNZIPPED = 250 * 1024 * 1024; // 250MB

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
 * Arbitrary generator for layer sizes that exceed AWS limits.
 */
const oversizedLayerConfig = (): fc.Arbitrary<{
    zipSize: number;
    unzippedSize: number;
    exceedsZipLimit: boolean;
    exceedsUnzippedLimit: boolean;
}> =>
    fc.oneof(
        // ZIP size exceeds limit
        fc.record({
            zipSize: fc.integer({ min: MAX_LAYER_SIZE_ZIPPED + 1, max: MAX_LAYER_SIZE_ZIPPED * 2 }),
            unzippedSize: fc.integer({ min: 1000, max: MAX_LAYER_SIZE_UNZIPPED }),
            exceedsZipLimit: fc.constant(true),
            exceedsUnzippedLimit: fc.constant(false),
        }),
        // Unzipped size exceeds limit
        fc.record({
            zipSize: fc.integer({ min: 1000, max: MAX_LAYER_SIZE_ZIPPED }),
            unzippedSize: fc.integer({ min: MAX_LAYER_SIZE_UNZIPPED + 1, max: MAX_LAYER_SIZE_UNZIPPED * 2 }),
            exceedsZipLimit: fc.constant(false),
            exceedsUnzippedLimit: fc.constant(true),
        }),
        // Both sizes exceed limits
        fc.record({
            zipSize: fc.integer({ min: MAX_LAYER_SIZE_ZIPPED + 1, max: MAX_LAYER_SIZE_ZIPPED * 2 }),
            unzippedSize: fc.integer({ min: MAX_LAYER_SIZE_UNZIPPED + 1, max: MAX_LAYER_SIZE_UNZIPPED * 2 }),
            exceedsZipLimit: fc.constant(true),
            exceedsUnzippedLimit: fc.constant(true),
        })
    );

/**
 * Arbitrary generator for layer sizes within AWS limits.
 */
const validLayerConfig = (): fc.Arbitrary<{
    zipSize: number;
    unzippedSize: number;
}> =>
    fc.record({
        zipSize: fc.integer({ min: 1000, max: MAX_LAYER_SIZE_ZIPPED - 1000 }),
        unzippedSize: fc.integer({ min: 1000, max: MAX_LAYER_SIZE_UNZIPPED - 1000 }),
    });

/**
 * Mock setup helper for layer creation with specific size configuration.
 */
function setupLayerSizeMocks(sizeConfig: { zipSize: number; unzippedSize: number }): void {
    const tempDir = `/tmp/lambda-kata-layer-${Date.now()}`;

    // Reset all mocks
    jest.clearAllMocks();

    // Setup temp directory creation
    mockedFs.mkdtemp.mockResolvedValue(tempDir);

    // Setup successful Docker operations
    const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
            if (event === 'close') {
                setTimeout(() => callback(0), 10);
            }
        }),
        kill: jest.fn(),
    };
    mockedSpawn.mockReturnValue(mockProcess as any);

    // Setup file operations with specific sizes
    mockedFs.stat.mockImplementation((path: any) => {
        if (typeof path === 'string' && path.includes('.zip')) {
            return Promise.resolve({
                isFile: () => true,
                size: sizeConfig.zipSize
            } as any);
        }
        return Promise.resolve({
            isFile: () => true,
            size: 1000
        } as any);
    });

    mockedFs.chmod.mockResolvedValue(undefined);
    mockedFs.mkdir.mockResolvedValue(undefined);
    mockedFs.copyFile.mockResolvedValue(undefined);
    mockedFs.readFile.mockResolvedValue(Buffer.from('zip content'));
    mockedFs.rm.mockResolvedValue(undefined);
    mockedFs.unlink.mockResolvedValue(undefined);
    mockedFs.readdir.mockResolvedValue([]);

    // Mock Python command for unzipped size calculation
    const pythonProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
            if (event === 'close') {
                setTimeout(() => callback(0), 10);
            }
        }),
        kill: jest.fn(),
    };

    // Setup Python output for unzipped size
    pythonProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
            callback(Buffer.from(sizeConfig.unzippedSize.toString()));
        }
    });

    // Mock spawn to return appropriate process based on command
    mockedSpawn.mockImplementation((command: string, args: readonly string[]) => {
        if (command === 'python3' && args.some(arg => arg.includes('zipfile'))) {
            return pythonProcess as any;
        }
        return mockProcess as any;
    });

    // Setup AWS operations (should not be reached for size validation failures)
    const { LambdaClient } = require('@aws-sdk/client-lambda');
    const mockSend = jest.fn().mockResolvedValue({
        LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:test-layer:1',
        Version: 1,
        CreatedDate: '2023-01-01T00:00:00.000Z',
    });
    LambdaClient.mockImplementation(() => ({
        send: mockSend,
        destroy: jest.fn(),
    }));
}

// Feature: nodejs-layer-management, Property 10: Layer Size Validation
describe('Feature: nodejs-layer-management, Property 10: Layer Size Validation', () => {
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
     * **Validates: Requirement 5.5**
     * 
     * For any layer creation attempt with oversized content,
     * the Layer_Manager should return a descriptive error before attempting to publish.
     */
    describe('Property 10: Layer Size Validation', () => {
        /**
         * **Validates: Requirement 5.5**
         *
         * For any layer creation options and any oversized layer configuration,
         * the system should detect size violations and return descriptive errors.
         */
        it('should reject layers that exceed AWS size limits with descriptive errors', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    oversizedLayerConfig(),
                    async (options, sizeConfig) => {
                        setupLayerSizeMocks(sizeConfig);

                        // Execute layer creation and expect failure
                        let thrownError: NodeRuntimeLayerError | undefined;
                        try {
                            await layerManager.createNodeLayer(options);
                        } catch (error) {
                            thrownError = error as NodeRuntimeLayerError;
                        }

                        // Verify error was thrown
                        expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
                        expect(thrownError?.code).toBe(ErrorCodes.LAYER_SIZE_EXCEEDED);

                        // Verify error message contains descriptive information
                        const errorMessage = thrownError?.message || '';
                        expect(errorMessage).toContain('exceeds AWS Lambda limit');
                        expect(errorMessage).toContain('MB');

                        // Verify error message contains specific size information
                        if (sizeConfig.exceedsZipLimit) {
                            expect(errorMessage).toContain('ZIP file size');
                            expect(errorMessage).toContain('50'); // 50MB limit
                        }

                        if (sizeConfig.exceedsUnzippedLimit) {
                            expect(errorMessage).toContain('unzipped size');
                            expect(errorMessage).toContain('250'); // 250MB limit
                        }

                        // Verify error message contains troubleshooting guidance
                        expect(errorMessage).toMatch(/consider|split|optimi/i);

                        // Verify size validation was logged
                        const validationLogs = mockLogger.info.mock.calls.filter(call =>
                            call[0].includes('Starting layer size validation')
                        );
                        expect(validationLogs.length).toBeGreaterThanOrEqual(1);

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });

        /**
         * **Validates: Requirement 5.5**
         *
         * For any layer creation options with valid sizes,
         * the size validation should pass and allow layer creation to proceed.
         */
        it('should allow layers within AWS size limits to proceed', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    validLayerConfig(),
                    async (options, sizeConfig) => {
                        setupLayerSizeMocks(sizeConfig);

                        // Execute layer creation and expect success
                        const result = await layerManager.createNodeLayer(options);

                        // Verify successful creation
                        expect(result).toBeDefined();
                        expect(result.arn).toMatch(/^arn:aws:lambda:/);
                        expect(result.name).toBe(options.layerName);
                        expect(result.nodeVersion).toBe(options.nodeVersion);
                        expect(result.architecture).toBe(options.architecture);

                        // Verify size validation passed
                        const validationLogs = mockLogger.info.mock.calls.filter(call =>
                            call[0].includes('Layer size validation passed')
                        );
                        expect(validationLogs.length).toBeGreaterThanOrEqual(1);

                        // Verify optimization metrics were logged
                        const optimizationLogs = mockLogger.info.mock.calls.filter(call =>
                            call[0].includes('ZIP creation with compression optimization completed')
                        );
                        expect(optimizationLogs.length).toBeGreaterThanOrEqual(1);

                        return true;
                    }
                ),
                { numRuns: 50 } // Reduced for performance
            );
        });

        /**
         * **Validates: Requirement 5.5**
         *
         * For any layer size validation error, the error should contain
         * specific size information and optimization suggestions.
         */
        it('should provide specific size information in error messages', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    oversizedLayerConfig(),
                    async (options, sizeConfig) => {
                        setupLayerSizeMocks(sizeConfig);

                        // Execute layer creation and capture error
                        let thrownError: NodeRuntimeLayerError | undefined;
                        try {
                            await layerManager.createNodeLayer(options);
                        } catch (error) {
                            thrownError = error as NodeRuntimeLayerError;
                        }

                        // Verify error contains specific size information
                        const errorMessage = thrownError?.message || '';

                        // Should contain actual size in bytes
                        expect(errorMessage).toMatch(/\d+ bytes/);

                        // Should contain size in MB for readability
                        expect(errorMessage).toMatch(/\d+\.\d+ MB/);

                        // Should contain the specific limit that was exceeded
                        if (sizeConfig.exceedsZipLimit) {
                            expect(errorMessage).toContain('50 MB'); // ZIP limit
                        }
                        if (sizeConfig.exceedsUnzippedLimit) {
                            expect(errorMessage).toContain('250 MB'); // Unzipped limit
                        }

                        // Should contain optimization suggestions
                        const hasOptimizationSuggestion =
                            errorMessage.includes('optimizing') ||
                            errorMessage.includes('splitting') ||
                            errorMessage.includes('removing unnecessary files');
                        expect(hasOptimizationSuggestion).toBe(true);

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });

        /**
         * **Validates: Requirement 5.5**
         *
         * For any layer size validation, both zipped and unzipped sizes
         * should be checked against their respective limits.
         */
        it('should validate both zipped and unzipped size limits', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    fc.record({
                        zipSize: fc.integer({ min: MAX_LAYER_SIZE_ZIPPED + 1000, max: MAX_LAYER_SIZE_ZIPPED * 2 }),
                        unzippedSize: fc.integer({ min: 1000, max: MAX_LAYER_SIZE_UNZIPPED - 1000 }),
                    }),
                    async (options, sizeConfig) => {
                        // This tests ZIP size limit with valid unzipped size
                        setupLayerSizeMocks(sizeConfig);

                        let thrownError: NodeRuntimeLayerError | undefined;
                        try {
                            await layerManager.createNodeLayer(options);
                        } catch (error) {
                            thrownError = error as NodeRuntimeLayerError;
                        }

                        // Should fail on ZIP size limit
                        expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
                        expect(thrownError?.code).toBe(ErrorCodes.LAYER_SIZE_EXCEEDED);
                        expect(thrownError?.message).toContain('ZIP file size');
                        expect(thrownError?.message).not.toContain('unzipped size');

                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });

        /**
         * **Validates: Requirement 5.5**
         *
         * For any layer size validation failure, the validation should occur
         * before attempting to publish to AWS Lambda.
         */
        it('should validate size before AWS publication attempt', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    oversizedLayerConfig(),
                    async (options, sizeConfig) => {
                        setupLayerSizeMocks(sizeConfig);

                        // Execute layer creation and expect failure
                        let thrownError: NodeRuntimeLayerError | undefined;
                        try {
                            await layerManager.createNodeLayer(options);
                        } catch (error) {
                            thrownError = error as NodeRuntimeLayerError;
                        }

                        // Verify size validation error occurred
                        expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
                        expect(thrownError?.code).toBe(ErrorCodes.LAYER_SIZE_EXCEEDED);

                        // Verify AWS Lambda client was not used for publication
                        const { LambdaClient } = require('@aws-sdk/client-lambda');
                        const mockInstances = LambdaClient.mock.instances;

                        if (mockInstances.length > 0) {
                            const mockSend = mockInstances[0].send;
                            // If client was created, send should not have been called for PublishLayerVersion
                            if (mockSend.mock.calls.length > 0) {
                                const publishCalls = mockSend.mock.calls.filter((call: any) =>
                                    call[0]?.constructor?.name === 'PublishLayerVersionCommand'
                                );
                                expect(publishCalls.length).toBe(0);
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });
    });
});

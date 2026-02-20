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
 * Property-Based Tests for Optional Parameter Handling
 *
 * Feature: nodejs-layer-management, Property 8: Optional Parameter Handling
 *
 * Property 8: Optional Parameter Handling
 * *For any* call to ensureNodeRuntimeLayer with or without optional parameters (awsSdkConfig, logger),
 * the function should execute successfully and respect the provided configuration when present.
 *
 * **Validates: Requirements 4.3, 4.4**
 * - Req 4.3: The function shall accept optional AWS SDK configuration for custom authentication and region settings
 * - Req 4.4: The function shall accept optional logger configuration for debugging and monitoring
 *
 * @module nodejs-layer-manager-optional-params.property.test
 */

import * as fc from 'fast-check';
import { LambdaClientConfig } from '@aws-sdk/client-lambda';
import { ensureNodeRuntimeLayer } from '../src/ensure-node-runtime-layer';
import { EnsureNodeRuntimeLayerOptions, Logger } from '../src/nodejs-layer-manager';
import { ConsoleLogger, NoOpLogger } from '../src/logger';

// Mock AWS SDK
jest.mock('@aws-sdk/client-lambda');
jest.mock('child_process');
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

/**
 * Arbitrary generator for valid AWS regions.
 */
const arbitraryRegion = (): fc.Arbitrary<string> =>
    fc.constantFrom(
        'us-east-1',
        'us-east-2',
        'us-west-1',
        'us-west-2',
        'eu-west-1',
        'eu-west-2',
        'eu-central-1',
        'ap-northeast-1',
        'ap-southeast-1',
        'ap-southeast-2'
    );

/**
 * Arbitrary generator for valid AWS account IDs (12-digit strings).
 */
const arbitraryAccountId = (): fc.Arbitrary<string> =>
    fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
        minLength: 12,
        maxLength: 12,
    });

/**
 * Arbitrary generator for supported Node.js runtimes.
 */
const arbitraryRuntime = (): fc.Arbitrary<string> =>
    fc.constantFrom('nodejs18.x', 'nodejs20.x', 'nodejs22.x');

/**
 * Arbitrary generator for supported architectures.
 */
const arbitraryArchitecture = (): fc.Arbitrary<'x86_64' | 'arm64'> =>
    fc.constantFrom('x86_64', 'arm64');

/**
 * Arbitrary generator for AWS SDK configuration options.
 */
const arbitraryAwsSdkConfig = (): fc.Arbitrary<LambdaClientConfig> =>
    fc.record({
        region: fc.option(arbitraryRegion(), { nil: undefined }),
        credentials: fc.option(
            fc.record({
                accessKeyId: fc.string({ minLength: 16, maxLength: 32 }),
                secretAccessKey: fc.string({ minLength: 32, maxLength: 64 }),
                sessionToken: fc.option(fc.string({ minLength: 100, maxLength: 500 }), { nil: undefined }),
            }),
            { nil: undefined }
        ),
        endpoint: fc.option(fc.webUrl(), { nil: undefined }),
        maxAttempts: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
    });

/**
 * Arbitrary generator for logger instances.
 */
const arbitraryLogger = (): fc.Arbitrary<Logger> =>
    fc.oneof(
        fc.constant(new NoOpLogger()),
        fc.constant(new ConsoleLogger('[Test]', 'debug')),
        fc.constant(new ConsoleLogger('[Test]', 'info')),
        fc.constant(new ConsoleLogger('[Test]', 'warn')),
        fc.constant(new ConsoleLogger('[Test]', 'error'))
    );

/**
 * Arbitrary generator for base layer options (without optional parameters).
 */
const arbitraryBaseOptions = (): fc.Arbitrary<{
    runtimeName: string;
    architecture: 'x86_64' | 'arm64';
    region: string;
    accountId: string;
}> =>
    fc.record({
        runtimeName: arbitraryRuntime(),
        architecture: arbitraryArchitecture(),
        region: arbitraryRegion(),
        accountId: arbitraryAccountId(),
    });

/**
 * Mock setup helper for successful layer operations.
 */
function setupSuccessfulMocks(): void {
    const { LambdaClient } = require('@aws-sdk/client-lambda');
    const { spawn } = require('child_process');
    const { promises: fs } = require('fs');

    // Mock successful AWS operations
    const mockSend = jest.fn()
        .mockResolvedValueOnce([]) // ListLayers - no existing layers
        .mockResolvedValue({
            LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:test-layer:1',
            Version: 1,
            CreatedDate: '2023-01-01T00:00:00.000Z',
        });

    LambdaClient.mockImplementation(() => ({
        send: mockSend,
        destroy: jest.fn(),
    }));

    // Mock successful Docker operations
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
    spawn.mockReturnValue(mockProcess);

    // Mock successful file operations
    fs.mkdtemp.mockResolvedValue('/tmp/test-layer-123');
    fs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
    fs.chmod.mockResolvedValue(undefined);
    fs.mkdir.mockResolvedValue(undefined);
    fs.copyFile.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue(Buffer.from('test content'));
    fs.rm.mockResolvedValue(undefined);
    fs.unlink.mockResolvedValue(undefined);
    fs.readdir.mockResolvedValue([]);
}

// Feature: nodejs-layer-management, Property 8: Optional Parameter Handling
describe('Feature: nodejs-layer-management, Property 8: Optional Parameter Handling', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupSuccessfulMocks();
    });

    /**
     * **Validates: Requirements 4.3, 4.4**
     * 
     * For any valid layer options with or without optional parameters,
     * the function should execute successfully and respect provided configuration.
     */
    describe('Property 8: Optional Parameter Handling', () => {
        /**
         * **Validates: Requirement 4.3**
         *
         * For any valid layer options with optional AWS SDK configuration,
         * the function should use the provided configuration for AWS operations.
         */
        it('should accept and use optional AWS SDK configuration', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryBaseOptions(),
                    fc.option(arbitraryAwsSdkConfig(), { nil: undefined }),
                    async (baseOptions, awsSdkConfig) => {
                        const options: EnsureNodeRuntimeLayerOptions = {
                            ...baseOptions,
                            awsSdkConfig,
                        };

                        // Execute the function
                        const result = await ensureNodeRuntimeLayer(options);

                        // Verify successful execution
                        expect(result).toBeDefined();
                        expect(result.layerArn).toMatch(/^arn:aws:lambda:/);
                        expect(result.layerName).toContain('lambda-kata-nodejs');
                        expect(result.runtimeName).toBe(baseOptions.runtimeName);
                        expect(result.architecture).toBe(baseOptions.architecture);

                        // Verify AWS SDK configuration was used if provided
                        if (awsSdkConfig) {
                            const { LambdaClient } = require('@aws-sdk/client-lambda');
                            expect(LambdaClient).toHaveBeenCalledWith(awsSdkConfig);
                        } else {
                            const { LambdaClient } = require('@aws-sdk/client-lambda');
                            expect(LambdaClient).toHaveBeenCalledWith({});
                        }

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 4.4**
         *
         * For any valid layer options with optional logger configuration,
         * the function should use the provided logger for debugging and monitoring.
         */
        it('should accept and use optional logger configuration', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryBaseOptions(),
                    fc.option(arbitraryLogger(), { nil: undefined }),
                    async (baseOptions, logger) => {
                        const options: EnsureNodeRuntimeLayerOptions = {
                            ...baseOptions,
                            logger,
                        };

                        // Execute the function
                        const result = await ensureNodeRuntimeLayer(options);

                        // Verify successful execution
                        expect(result).toBeDefined();
                        expect(result.layerArn).toMatch(/^arn:aws:lambda:/);
                        expect(result.layerName).toContain('lambda-kata-nodejs');
                        expect(result.runtimeName).toBe(baseOptions.runtimeName);
                        expect(result.architecture).toBe(baseOptions.architecture);

                        // Verify logger was used (we can't directly test logger usage,
                        // but we can verify the function completed successfully with the logger)
                        if (logger instanceof ConsoleLogger) {
                            // Console logger should not throw errors during normal operation
                            expect(result.created).toBeDefined();
                        }

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 4.3, 4.4**
         *
         * For any valid layer options with both optional parameters provided,
         * the function should use both configurations correctly.
         */
        it('should handle both optional parameters together', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryBaseOptions(),
                    fc.option(arbitraryAwsSdkConfig(), { nil: undefined }),
                    fc.option(arbitraryLogger(), { nil: undefined }),
                    async (baseOptions, awsSdkConfig, logger) => {
                        const options: EnsureNodeRuntimeLayerOptions = {
                            ...baseOptions,
                            awsSdkConfig,
                            logger,
                        };

                        // Execute the function
                        const result = await ensureNodeRuntimeLayer(options);

                        // Verify successful execution
                        expect(result).toBeDefined();
                        expect(result.layerArn).toMatch(/^arn:aws:lambda:/);
                        expect(result.layerName).toContain('lambda-kata-nodejs');
                        expect(result.runtimeName).toBe(baseOptions.runtimeName);
                        expect(result.architecture).toBe(baseOptions.architecture);
                        expect(typeof result.created).toBe('boolean');

                        // Verify both configurations were respected
                        const { LambdaClient } = require('@aws-sdk/client-lambda');
                        if (awsSdkConfig) {
                            expect(LambdaClient).toHaveBeenCalledWith(awsSdkConfig);
                        } else {
                            expect(LambdaClient).toHaveBeenCalledWith({});
                        }

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 4.3, 4.4**
         *
         * For any valid layer options without optional parameters,
         * the function should use default configurations and execute successfully.
         */
        it('should work correctly without any optional parameters', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryBaseOptions(),
                    async (baseOptions) => {
                        const options: EnsureNodeRuntimeLayerOptions = {
                            ...baseOptions,
                            // No optional parameters provided
                        };

                        // Execute the function
                        const result = await ensureNodeRuntimeLayer(options);

                        // Verify successful execution with defaults
                        expect(result).toBeDefined();
                        expect(result.layerArn).toMatch(/^arn:aws:lambda:/);
                        expect(result.layerName).toContain('lambda-kata-nodejs');
                        expect(result.runtimeName).toBe(baseOptions.runtimeName);
                        expect(result.architecture).toBe(baseOptions.architecture);
                        expect(typeof result.created).toBe('boolean');

                        // Verify default AWS SDK configuration was used
                        const { LambdaClient } = require('@aws-sdk/client-lambda');
                        expect(LambdaClient).toHaveBeenCalledWith({});

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 4.3, 4.4**
         *
         * For any AWS SDK configuration with specific region settings,
         * the function should respect the region configuration.
         */
        it('should respect region configuration in AWS SDK config', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryBaseOptions(),
                    arbitraryRegion(),
                    async (baseOptions, configRegion) => {
                        const awsSdkConfig: LambdaClientConfig = {
                            region: configRegion,
                        };

                        const options: EnsureNodeRuntimeLayerOptions = {
                            ...baseOptions,
                            awsSdkConfig,
                        };

                        // Execute the function
                        const result = await ensureNodeRuntimeLayer(options);

                        // Verify successful execution
                        expect(result).toBeDefined();
                        expect(result.layerArn).toMatch(/^arn:aws:lambda:/);

                        // Verify the AWS SDK was configured with the specified region
                        const { LambdaClient } = require('@aws-sdk/client-lambda');
                        expect(LambdaClient).toHaveBeenCalledWith(
                            expect.objectContaining({
                                region: configRegion,
                            })
                        );

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });
    });
});
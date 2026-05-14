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
 * Property-Based Tests for Comprehensive Error Reporting
 *
 * Feature: nodejs-layer-management, Property 13: Comprehensive Error Reporting
 *
 * Property 13: Comprehensive Error Reporting
 * *For any* operation failure (Docker, AWS API, authentication), the system should return
 * NodeRuntimeLayerError instances with descriptive messages, appropriate error codes,
 * and actionable troubleshooting guidance.
 *
 * **Validates: Requirements 6.2, 6.4**
 * - Req 6.2: When Docker operations fail, the Layer_Manager shall provide detailed error messages with troubleshooting guidance
 * - Req 6.4: When authentication fails, the Layer_Manager shall return clear error messages indicating required permissions
 *
 * @module nodejs-layer-manager-error-reporting.property.test
 */

import * as fc from 'fast-check';
import { AWSLayerManager } from '../src/aws-layer-manager';
import { DockerRuntimeDetector } from '../src/docker-runtime-detector';
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

// Import the mocked LambdaClient
const { LambdaClient } = require('@aws-sdk/client-lambda');
const MockedLambdaClient = LambdaClient as jest.MockedClass<typeof LambdaClient>;

/**
 * Error scenarios for comprehensive testing.
 */
const ERROR_SCENARIOS = {
    DOCKER_UNAVAILABLE: {
        type: 'docker',
        errorCode: 'ENOENT',
        errorMessage: 'spawn docker ENOENT',
        expectedCode: ErrorCodes.LAYER_CREATION_FAILED,
        expectedGuidance: /Docker operation failed.*Docker is installed/i,
    },
    DOCKER_PERMISSION_DENIED: {
        type: 'docker',
        errorCode: 'EACCES',
        errorMessage: 'permission denied',
        expectedCode: ErrorCodes.LAYER_CREATION_FAILED,
        expectedGuidance: /Docker operation failed.*Docker is installed/i,
    },
    AWS_ACCESS_DENIED: {
        type: 'aws',
        errorName: 'AccessDeniedException',
        errorMessage: 'User is not authorized to perform: lambda:ListLayers',
        expectedCode: ErrorCodes.AWS_API_ERROR,
        expectedGuidance: /AWS access denied.*IAM permissions.*lambda/i,
    },
    AWS_THROTTLING: {
        type: 'aws',
        errorName: 'ThrottlingException',
        errorMessage: 'Rate exceeded',
        expectedCode: ErrorCodes.AWS_API_ERROR,
        expectedGuidance: /AWS API throttling.*exponential backoff/i,
    },
    NETWORK_ERROR: {
        type: 'network',
        errorCode: 'ENOTFOUND',
        errorMessage: 'getaddrinfo ENOTFOUND public.ecr.aws',
        expectedCode: ErrorCodes.LAYER_CREATION_FAILED,
        expectedGuidance: /Docker operation failed.*Docker is installed/i,
    },
    INVALID_RUNTIME: {
        type: 'validation',
        errorMessage: 'Unsupported runtime: nodejs99.x',
        expectedCode: ErrorCodes.RUNTIME_UNSUPPORTED,
        expectedGuidance: /supported.*runtime/i,
    },
} as const;

/**
 * Arbitrary generator for error scenarios.
 */
const arbitraryErrorScenario = (): fc.Arbitrary<keyof typeof ERROR_SCENARIOS> =>
    fc.constantFrom(...Object.keys(ERROR_SCENARIOS) as Array<keyof typeof ERROR_SCENARIOS>);

/**
 * Arbitrary generator for valid layer creation options.
 */
const layerCreationOptions = (): fc.Arbitrary<LayerCreationOptions> =>
    fc.record({
        nodeVersion: fc.oneof(
            fc.constant('18.19.0'),
            fc.constant('20.10.0'),
            fc.constant('22.1.0')
        ),
        architecture: fc.oneof(fc.constant('x86_64'), fc.constant('arm64')) as fc.Arbitrary<'x86_64' | 'arm64'>,
        region: fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1'),
        description: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    }).map(({ nodeVersion, architecture, region, description }) => {
        // Generate valid layer name based on node version
        const majorVersion = nodeVersion.split('.')[0];
        const layerName = `lambda-kata-nodejs-nodejs${majorVersion}.x-${architecture}`;

        return {
            layerName,
            nodeVersion,
            architecture,
            region,
            description,
        };
    });

/**
 * Arbitrary generator for runtime detection options.
 */
const runtimeDetectionOptions = (): fc.Arbitrary<{
    runtimeName: string;
    architecture: 'x86_64' | 'arm64';
}> =>
    fc.record({
        runtimeName: fc.constantFrom('nodejs18.x', 'nodejs20.x', 'nodejs22.x'),
        architecture: fc.oneof(fc.constant('x86_64'), fc.constant('arm64')) as fc.Arbitrary<'x86_64' | 'arm64'>,
    });

/**
 * Mock setup helper for specific error scenarios.
 */
function setupErrorScenario(scenarioKey: keyof typeof ERROR_SCENARIOS): void {
    const scenario = ERROR_SCENARIOS[scenarioKey];

    // Reset all mocks
    jest.clearAllMocks();

    switch (scenario.type) {
        case 'docker':
            setupDockerError(scenario);
            break;
        case 'aws':
            setupAwsError(scenario);
            break;
        case 'network':
            setupNetworkError(scenario);
            break;
        case 'validation':
            // Validation errors are handled by input validation, no mock setup needed
            break;
    }
}

/**
 * Setup Docker-related error scenarios.
 */
function setupDockerError(scenario: any): void {
    const tempDir = `/tmp/lambda-kata-layer-${Date.now()}`;
    mockedFs.mkdtemp.mockResolvedValue(tempDir);

    // Create error based on scenario
    const error = new Error(scenario.errorMessage) as any;
    if (scenario.errorCode) {
        error.code = scenario.errorCode;
    }

    // Mock spawn to throw the error
    mockedSpawn.mockImplementation(() => {
        throw error;
    });

    // Setup other file operations to succeed (they won't be reached)
    mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 } as any);
    mockedFs.chmod.mockResolvedValue(undefined);
    mockedFs.mkdir.mockResolvedValue(undefined);
    mockedFs.copyFile.mockResolvedValue(undefined);
    mockedFs.readFile.mockResolvedValue(Buffer.from('test content'));
    mockedFs.rm.mockResolvedValue(undefined);
    mockedFs.unlink.mockResolvedValue(undefined);
    mockedFs.readdir.mockResolvedValue([]);
}

/**
 * Setup AWS API error scenarios.
 */
function setupAwsError(scenario: any): void {
    const tempDir = `/tmp/lambda-kata-layer-${Date.now()}`;
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

    // Setup successful file operations
    mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 } as any);
    mockedFs.chmod.mockResolvedValue(undefined);
    mockedFs.mkdir.mockResolvedValue(undefined);
    mockedFs.copyFile.mockResolvedValue(undefined);
    mockedFs.readFile.mockResolvedValue(Buffer.from('test content'));
    mockedFs.rm.mockResolvedValue(undefined);
    mockedFs.unlink.mockResolvedValue(undefined);
    mockedFs.readdir.mockResolvedValue([]);

    // Setup AWS error
    const awsError = new Error(scenario.errorMessage) as any;
    awsError.name = scenario.errorName;
    awsError.$metadata = { requestId: 'test-request-id-123' };

    const mockSend = jest.fn().mockRejectedValue(awsError);
    MockedLambdaClient.mockImplementation(() => ({
        send: mockSend,
        destroy: jest.fn(),
    }));
}

/**
 * Setup network error scenarios.
 */
function setupNetworkError(scenario: any): void {
    // Network errors occur during Docker operations
    const error = new Error(scenario.errorMessage) as any;
    error.code = scenario.errorCode;

    const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
            if (event === 'error') {
                setTimeout(() => callback(error), 10);
            }
        }),
        kill: jest.fn(),
    };
    mockedSpawn.mockReturnValue(mockProcess as any);

    // Setup other operations to succeed
    mockedFs.mkdtemp.mockResolvedValue(`/tmp/lambda-kata-layer-${Date.now()}`);
    mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 } as any);
    mockedFs.rm.mockResolvedValue(undefined);
}

// Feature: nodejs-layer-management, Property 13: Comprehensive Error Reporting
describe('Feature: nodejs-layer-management, Property 13: Comprehensive Error Reporting', () => {
    let layerManager: AWSLayerManager;
    let runtimeDetector: DockerRuntimeDetector;
    let mockLogger: jest.Mocked<ConsoleLogger>;

    beforeEach(() => {
        // Create mock logger that captures all calls
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        } as any;

        // Clear all mock calls
        jest.clearAllMocks();

        layerManager = new AWSLayerManager({
            logger: mockLogger,
        });

        runtimeDetector = new DockerRuntimeDetector({
            logger: mockLogger,
        });
    });

    afterEach(() => {
        layerManager.destroy();
    });

    /**
     * **Validates: Requirements 6.2, 6.4**
     * 
     * For any operation failure scenario, the system should return
     * NodeRuntimeLayerError instances with comprehensive error information.
     */
    describe('Property 13: Comprehensive Error Reporting', () => {
        /**
         * **Validates: Requirement 6.2**
         *
         * For any Docker operation failure, the system should provide
         * detailed error messages with troubleshooting guidance.
         */
        it('should provide comprehensive error reporting for Docker failures', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    fc.constantFrom('DOCKER_UNAVAILABLE' as const, 'DOCKER_PERMISSION_DENIED' as const, 'NETWORK_ERROR' as const),
                    async (options, scenarioKey) => {
                        setupErrorScenario(scenarioKey);
                        const scenario = ERROR_SCENARIOS[scenarioKey];

                        // Execute layer creation and expect failure
                        let thrownError: NodeRuntimeLayerError | undefined;
                        try {
                            await layerManager.createNodeLayer(options);
                        } catch (error) {
                            thrownError = error as NodeRuntimeLayerError;
                        }

                        // Verify comprehensive error reporting
                        expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
                        expect(thrownError?.code).toBe(scenario.expectedCode);

                        // Verify error message contains context
                        const errorMessage = thrownError?.message || '';
                        expect(errorMessage).toContain(options.layerName);
                        expect(errorMessage).toContain(options.nodeVersion);
                        expect(errorMessage).toContain(options.architecture);

                        // Verify error has proper cause chain
                        expect(thrownError?.cause).toBeDefined();
                        expect(thrownError?.cause).toBeInstanceOf(Error);

                        // Verify error logging includes troubleshooting context
                        const errorLogs = mockLogger.error.mock.calls.filter(call =>
                            call[0].includes('Failed')
                        );
                        expect(errorLogs.length).toBeGreaterThanOrEqual(1);

                        const errorLogMetadata = errorLogs[0][1] as any;
                        expect(errorLogMetadata).toHaveProperty('troubleshooting');

                        // Verify troubleshooting guidance is in the log metadata, not the error message
                        expect(errorLogMetadata.troubleshooting).toMatch(scenario.expectedGuidance);

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });

        /**
         * **Validates: Requirement 6.4**
         *
         * For any AWS authentication failure, the system should return
         * clear error messages indicating required permissions.
         */
        it('should provide clear error messages for AWS authentication failures', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    fc.constantFrom('AWS_ACCESS_DENIED' as const, 'AWS_THROTTLING' as const),
                    async (options, scenarioKey) => {
                        setupErrorScenario(scenarioKey);
                        const scenario = ERROR_SCENARIOS[scenarioKey];

                        // Execute layer creation and expect failure
                        let thrownError: NodeRuntimeLayerError | undefined;
                        try {
                            await layerManager.createNodeLayer(options);
                        } catch (error) {
                            thrownError = error as NodeRuntimeLayerError;
                        }

                        // Verify AWS-specific error reporting
                        expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
                        expect(thrownError?.code).toBe(ErrorCodes.AWS_API_ERROR);

                        // Verify error message contains AWS context
                        const errorMessage = thrownError?.message || '';
                        expect(errorMessage).toContain('AWS');

                        // Verify AWS request ID is captured if available
                        const errorLogs = mockLogger.error.mock.calls.filter(call =>
                            call[0].includes('Failed')
                        );
                        expect(errorLogs.length).toBeGreaterThanOrEqual(1);

                        const errorLogMetadata = errorLogs[0][1] as any;
                        expect(errorLogMetadata).toHaveProperty('awsRequestId');
                        expect(errorLogMetadata.awsRequestId).toBe('test-request-id-123');

                        // Verify specific guidance for authentication issues
                        if (scenarioKey === 'AWS_ACCESS_DENIED') {
                            expect(errorLogMetadata.troubleshooting).toMatch(/AWS access denied.*IAM permissions.*lambda/i);
                        }

                        // Verify specific guidance for throttling issues
                        if (scenarioKey === 'AWS_THROTTLING') {
                            expect(errorLogMetadata.troubleshooting).toMatch(/AWS API throttling.*exponential backoff/i);
                        }

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });

        /**
         * **Validates: Requirements 6.2, 6.4**
         *
         * For any runtime detection failure, the system should provide
         * comprehensive error information with fallback guidance.
         */
        it('should provide comprehensive error reporting for runtime detection failures', () => {
            return fc.assert(
                fc.asyncProperty(
                    runtimeDetectionOptions(),
                    fc.constantFrom(...(['DOCKER_UNAVAILABLE', 'NETWORK_ERROR'] as const)),
                    async (options, scenarioKey) => {
                        setupErrorScenario(scenarioKey);
                        const scenario = ERROR_SCENARIOS[scenarioKey];

                        // Execute runtime detection and expect failure or fallback
                        let thrownError: NodeRuntimeLayerError | undefined;
                        let result: any;
                        try {
                            result = await runtimeDetector.detectNodeVersion(
                                options.runtimeName,
                                options.architecture
                            );
                        } catch (error) {
                            thrownError = error as NodeRuntimeLayerError;
                        }

                        // For Docker unavailable, should use fallback (not throw)
                        if (scenarioKey === 'DOCKER_UNAVAILABLE') {
                            expect(result).toBeDefined();
                            expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
                            expect(result.runtimeName).toBe(options.runtimeName);

                            // Verify fallback warning was logged
                            const warnLogs = mockLogger.warn.mock.calls.filter(call =>
                                call[0].includes('Using fallback version')
                            );
                            expect(warnLogs.length).toBeGreaterThanOrEqual(1);
                        } else {
                            // For other errors, should throw with comprehensive information
                            expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
                            expect(thrownError?.code).toBe(scenario.expectedCode);

                            const errorMessage = thrownError?.message || '';
                            expect(errorMessage).toContain(options.runtimeName);
                            expect(errorMessage).toContain(options.architecture);

                            // Get error logs to check troubleshooting guidance
                            const errorLogs = mockLogger.error.mock.calls.filter(call =>
                                call[0].includes('Failed')
                            );
                            if (errorLogs.length > 0) {
                                const errorLogMetadata = errorLogs[0][1] as any;
                                expect(errorLogMetadata.troubleshooting).toMatch(scenario.expectedGuidance);
                            }
                        }

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });

        /**
         * **Validates: Requirements 6.2, 6.4**
         *
         * For any validation error, the system should provide
         * clear error messages with supported options.
         */
        it('should provide clear validation error messages', () => {
            return fc.assert(
                fc.asyncProperty(
                    fc.constantFrom('nodejs99.x', 'nodejs15.x', 'python3.9'),
                    fc.constantFrom('x86_64', 'arm64', 'arm32', 'mips'),
                    async (invalidRuntime, architecture) => {
                        // Test invalid runtime
                        if (invalidRuntime.startsWith('nodejs') && !['nodejs18.x', 'nodejs20.x', 'nodejs22.x'].includes(invalidRuntime)) {
                            let thrownError: NodeRuntimeLayerError | undefined;
                            try {
                                await runtimeDetector.detectNodeVersion(invalidRuntime, architecture as any);
                            } catch (error) {
                                thrownError = error as NodeRuntimeLayerError;
                            }

                            expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
                            expect(thrownError?.code).toBe(ErrorCodes.RUNTIME_UNSUPPORTED);

                            const errorMessage = thrownError?.message || '';
                            expect(errorMessage).toContain('Unsupported runtime');
                            expect(errorMessage).toContain(invalidRuntime);
                            expect(errorMessage).toContain('Supported runtimes');
                            expect(errorMessage).toMatch(/nodejs18\.x.*nodejs20\.x.*nodejs22\.x/);
                        }

                        // Test invalid architecture
                        if (!['x86_64', 'arm64'].includes(architecture)) {
                            let thrownError: NodeRuntimeLayerError | undefined;
                            try {
                                await runtimeDetector.detectNodeVersion('nodejs20.x', architecture as any);
                            } catch (error) {
                                thrownError = error as NodeRuntimeLayerError;
                            }

                            expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
                            expect(thrownError?.code).toBe(ErrorCodes.INVALID_ARCHITECTURE);

                            const errorMessage = thrownError?.message || '';
                            expect(errorMessage).toContain('Unsupported architecture');
                            expect(errorMessage).toContain(architecture);
                            expect(errorMessage).toContain('Supported architectures');
                            expect(errorMessage).toMatch(/x86_64.*arm64/);
                        }

                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });

        /**
         * **Validates: Requirements 6.2, 6.4**
         *
         * For any error scenario, the error logging should include
         * comprehensive metadata for debugging and monitoring.
         */
        it('should include comprehensive metadata in error logging', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    fc.constantFrom('DOCKER_UNAVAILABLE' as const, 'DOCKER_PERMISSION_DENIED' as const, 'AWS_ACCESS_DENIED' as const, 'AWS_THROTTLING' as const, 'NETWORK_ERROR' as const),
                    async (options, scenarioKey: 'DOCKER_UNAVAILABLE' | 'DOCKER_PERMISSION_DENIED' | 'AWS_ACCESS_DENIED' | 'AWS_THROTTLING' | 'NETWORK_ERROR') => {
                        setupErrorScenario(scenarioKey);

                        // Execute operation and expect failure
                        let thrownError: Error | undefined;
                        try {
                            await layerManager.createNodeLayer(options);
                        } catch (error) {
                            thrownError = error as Error;
                        }

                        // Verify error was thrown
                        expect(thrownError).toBeDefined();

                        // Verify comprehensive error logging
                        const errorLogs = mockLogger.error.mock.calls.filter(call =>
                            call[0].includes('Failed')
                        );
                        expect(errorLogs.length).toBeGreaterThanOrEqual(1);

                        const errorLogMetadata = errorLogs[0][1] as any;

                        // Verify operation context is included
                        expect(errorLogMetadata).toHaveProperty('operation');
                        expect(errorLogMetadata).toHaveProperty('duration');
                        expect(errorLogMetadata).toHaveProperty('startTime');
                        expect(errorLogMetadata).toHaveProperty('endTime');

                        // Verify error details are included
                        expect(errorLogMetadata).toHaveProperty('error');
                        expect(errorLogMetadata).toHaveProperty('errorName');

                        // Verify troubleshooting guidance is included
                        expect(errorLogMetadata).toHaveProperty('troubleshooting');
                        expect(typeof errorLogMetadata.troubleshooting).toBe('string');
                        expect(errorLogMetadata.troubleshooting.length).toBeGreaterThan(0);

                        // Verify operation-specific metadata is included
                        expect(errorLogMetadata).toHaveProperty('layerName', options.layerName);
                        expect(errorLogMetadata).toHaveProperty('nodeVersion', options.nodeVersion);
                        expect(errorLogMetadata).toHaveProperty('architecture', options.architecture);

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });
    });
});

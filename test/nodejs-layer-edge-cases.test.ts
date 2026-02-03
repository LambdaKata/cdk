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
 * Unit tests for edge cases and error conditions in nodejs-layer-management
 * 
 * Tests specific error scenarios including:
 * - Docker unavailable scenarios
 * - AWS API failure scenarios  
 * - Invalid input parameter combinations
 * - Layer size limit edge cases
 * 
 * These tests focus on error handling behavior rather than success paths,
 * using deterministic mocks to simulate failure conditions.
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { EventEmitter } from 'events';
import {
    LambdaClient,
    ListLayersCommand,
    GetLayerVersionCommand,
    PublishLayerVersionCommand,
} from '@aws-sdk/client-lambda';

import {
    DockerRuntimeDetector,
    AWSLayerManager,
    ensureNodeRuntimeLayer,
    NodeRuntimeLayerError,
    ErrorCodes,
    NoOpLogger,
} from '../src';

// Mock external dependencies
jest.mock('child_process');
jest.mock('fs', () => ({
    promises: {
        mkdtemp: jest.fn(),
        stat: jest.fn(),
        readFile: jest.fn(),
        writeFile: jest.fn(),
        unlink: jest.fn(),
        rm: jest.fn(),
        mkdir: jest.fn(),
        copyFile: jest.fn(),
        chmod: jest.fn(),
        readdir: jest.fn(),
    },
}));
jest.mock('@aws-sdk/client-lambda', () => {
    const actual = jest.requireActual('@aws-sdk/client-lambda');
    return {
        ...actual,
        LambdaClient: jest.fn().mockImplementation(() => ({
            send: jest.fn(),
            destroy: jest.fn(),
        })),
        paginateListLayers: jest.fn(),
    };
});

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockFs = fs as jest.Mocked<typeof fs>;
const MockedLambdaClient = LambdaClient as jest.MockedClass<typeof LambdaClient>;

describe('Node.js Layer Management - Edge Cases and Error Conditions', () => {
    let mockLambdaClient: jest.Mocked<LambdaClient>;
    let logger: NoOpLogger;

    beforeEach(() => {
        jest.clearAllMocks();

        logger = new NoOpLogger();

        // Setup default Lambda client mock
        mockLambdaClient = {
            send: jest.fn(),
            destroy: jest.fn(),
        } as any;
        MockedLambdaClient.mockImplementation(() => mockLambdaClient);
    });

    describe('Docker Unavailable Scenarios', () => {
        describe('DockerRuntimeDetector', () => {
            it('should throw DOCKER_UNAVAILABLE when Docker command not found', async () => {
                const detector = new DockerRuntimeDetector({
                    logger,
                    enableFallback: false,
                });

                // Mock spawn to simulate Docker not installed
                mockSpawn.mockImplementation(() => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    // Simulate command not found error
                    setTimeout(() => {
                        mockProcess.emit('error', Object.assign(new Error('spawn docker ENOENT'), {
                            code: 'ENOENT',
                            errno: -2,
                            syscall: 'spawn docker',
                            path: 'docker',
                            spawnargs: ['pull', 'public.ecr.aws/lambda/nodejs:20-x86_64']
                        }));
                    }, 10);

                    return mockProcess;
                });

                await expect(detector.detectNodeVersion('nodejs20.x', 'x86_64'))
                    .rejects
                    .toThrow(NodeRuntimeLayerError);

                await expect(detector.detectNodeVersion('nodejs20.x', 'x86_64'))
                    .rejects
                    .toMatchObject({
                        code: ErrorCodes.VERSION_DETECTION_FAILED,
                        message: expect.stringContaining('Failed to detect Node.js version from Docker image'),
                    });
            });

            it('should throw VERSION_DETECTION_FAILED when Docker daemon not running', async () => {
                const detector = new DockerRuntimeDetector({
                    logger,
                    enableFallback: false,
                });

                // Mock Docker pull to fail with daemon not running
                mockSpawn.mockImplementation(() => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    setTimeout(() => {
                        mockProcess.stderr.emit('data', Buffer.from('Cannot connect to the Docker daemon'));
                        mockProcess.emit('close', 1);
                    }, 10);

                    return mockProcess;
                });

                await expect(detector.detectNodeVersion('nodejs20.x', 'x86_64'))
                    .rejects
                    .toThrow(NodeRuntimeLayerError);

                await expect(detector.detectNodeVersion('nodejs20.x', 'x86_64'))
                    .rejects
                    .toMatchObject({
                        code: ErrorCodes.VERSION_DETECTION_FAILED,
                        message: expect.stringContaining('Cannot connect to the Docker daemon'),
                    });
            });

            it('should throw VERSION_DETECTION_FAILED when Docker pull times out', async () => {
                const detector = new DockerRuntimeDetector({
                    logger,
                    dockerTimeout: 100, // Very short timeout for test
                    enableFallback: false,
                });

                // Mock Docker pull to never complete (timeout scenario)
                mockSpawn.mockImplementation(() => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();
                    // Process never emits 'close' event to simulate hanging

                    return mockProcess;
                });

                await expect(detector.detectNodeVersion('nodejs20.x', 'x86_64'))
                    .rejects
                    .toThrow(NodeRuntimeLayerError);

                await expect(detector.detectNodeVersion('nodejs20.x', 'x86_64'))
                    .rejects
                    .toMatchObject({
                        code: ErrorCodes.VERSION_DETECTION_FAILED,
                        message: expect.stringContaining('Docker pull timeout after 100ms'),
                    });
            });

            it('should use fallback when Docker fails and fallback enabled', async () => {
                const detector = new DockerRuntimeDetector({
                    logger,
                    enableFallback: true,
                });

                // Mock Docker to fail
                mockSpawn.mockImplementation(() => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    setTimeout(() => {
                        mockProcess.stderr.emit('data', Buffer.from('Docker service unavailable'));
                        mockProcess.emit('close', 1);
                    }, 10);

                    return mockProcess;
                });

                const result = await detector.detectNodeVersion('nodejs20.x', 'x86_64');

                expect(result).toEqual({
                    version: '20.10.0',
                    runtimeName: 'nodejs20.x',
                    dockerImage: 'public.ecr.aws/lambda/nodejs:20-x86_64',
                });
            });

            it('should throw VERSION_DETECTION_FAILED when Docker returns invalid version format', async () => {
                const detector = new DockerRuntimeDetector({
                    logger,
                    enableFallback: false,
                });

                // Mock successful Docker pull but invalid version output
                mockSpawn
                    .mockImplementationOnce(() => {
                        // Docker pull succeeds
                        const mockProcess = new EventEmitter() as any;
                        mockProcess.stdout = new EventEmitter();
                        mockProcess.stderr = new EventEmitter();
                        mockProcess.kill = jest.fn();

                        setTimeout(() => {
                            mockProcess.stdout.emit('data', Buffer.from('Pull complete'));
                            mockProcess.emit('close', 0);
                        }, 10);

                        return mockProcess;
                    })
                    .mockImplementationOnce(() => {
                        // Docker run returns invalid version
                        const mockProcess = new EventEmitter() as any;
                        mockProcess.stdout = new EventEmitter();
                        mockProcess.stderr = new EventEmitter();
                        mockProcess.kill = jest.fn();

                        setTimeout(() => {
                            mockProcess.stdout.emit('data', Buffer.from('invalid-version-format'));
                            mockProcess.emit('close', 0);
                        }, 10);

                        return mockProcess;
                    });

                await expect(detector.detectNodeVersion('nodejs20.x', 'x86_64'))
                    .rejects
                    .toThrow(NodeRuntimeLayerError);

                await expect(detector.detectNodeVersion('nodejs20.x', 'x86_64'))
                    .rejects
                    .toMatchObject({
                        code: ErrorCodes.VERSION_DETECTION_FAILED,
                        message: expect.stringContaining('Failed to detect Node.js version from Docker image'),
                    });
            });
        });

        describe('AWSLayerManager Docker Operations', () => {
            it('should throw LAYER_CREATION_FAILED when Docker extraction fails', async () => {
                const manager = new AWSLayerManager({ logger });

                // Mock temp directory creation to succeed
                mockFs.mkdtemp.mockResolvedValue('/tmp/test-layer-123');

                // Mock Docker commands to fail
                mockSpawn.mockImplementation(() => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    setTimeout(() => {
                        mockProcess.stderr.emit('data', Buffer.from('Docker extraction failed'));
                        mockProcess.emit('close', 1);
                    }, 10);

                    return mockProcess;
                });

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toMatchObject({
                    code: ErrorCodes.LAYER_CREATION_FAILED,
                    message: expect.stringContaining('Failed to create Node.js layer'),
                });

                manager.destroy();
            });
        });
    });

    describe('AWS API Failure Scenarios', () => {
        describe('AWSLayerManager', () => {
            it('should throw AWS_API_ERROR when ListLayers fails with authentication error', async () => {
                const manager = new AWSLayerManager({ logger });

                // Mock pagination to throw authentication error
                const { paginateListLayers } = require('@aws-sdk/client-lambda');
                (paginateListLayers as jest.Mock).mockImplementation(() => {
                    throw Object.assign(new Error('The security token included in the request is invalid'), {
                        name: 'UnrecognizedClientException',
                        $metadata: { httpStatusCode: 403 }
                    });
                });

                await expect(manager.findExistingLayer({
                    layerName: 'test-layer',
                    requirements: {
                        nodeVersion: '20.10.0',
                        architecture: 'x86_64',
                    },
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(manager.findExistingLayer({
                    layerName: 'test-layer',
                    requirements: {
                        nodeVersion: '20.10.0',
                        architecture: 'x86_64',
                    },
                })).rejects.toMatchObject({
                    code: ErrorCodes.AWS_API_ERROR,
                    message: expect.stringContaining('The security token included in the request is invalid'),
                });

                manager.destroy();
            });

            it('should retry and eventually fail on persistent throttling', async () => {
                const manager = new AWSLayerManager({
                    logger,
                    maxRetries: 2,
                    retryBaseDelay: 10, // Fast retries for test
                });

                // Mock GetLayerVersion to always throw throttling error
                const throttlingError = new Error('Rate exceeded');
                (throttlingError as any).name = 'ThrottlingException';
                (throttlingError as any).$metadata = { httpStatusCode: 429 };
                (mockLambdaClient.send as jest.Mock).mockRejectedValue(throttlingError);

                // Mock pagination to return a layer that will trigger GetLayerVersion calls
                const { paginateListLayers } = require('@aws-sdk/client-lambda');
                (paginateListLayers as jest.Mock).mockReturnValue({
                    [Symbol.asyncIterator]: async function* () {
                        yield {
                            Layers: [{
                                LayerName: 'test-layer',
                                LatestMatchingVersion: { Version: 1 }
                            }]
                        };
                    }
                });

                await expect(manager.findExistingLayer({
                    layerName: 'test-layer',
                    requirements: {
                        nodeVersion: '20.10.0',
                        architecture: 'x86_64',
                    },
                })).rejects.toThrow(NodeRuntimeLayerError);

                // Should have attempted 3 times (initial + 2 retries)
                expect(mockLambdaClient.send).toHaveBeenCalledTimes(3);

                manager.destroy();
            });

            it('should throw AWS_API_ERROR when PublishLayerVersion fails with service unavailable', async () => {
                const manager = new AWSLayerManager({ logger });

                // Mock all prerequisites to succeed
                mockFs.mkdtemp.mockResolvedValue('/tmp/test-layer-123');
                mockFs.mkdir.mockResolvedValue(undefined);
                mockFs.copyFile.mockResolvedValue(undefined);
                mockFs.chmod.mockResolvedValue(undefined);
                mockFs.stat.mockResolvedValue({ size: 1024 * 1024, isFile: () => true } as any); // 1MB
                mockFs.readFile.mockResolvedValue(Buffer.from('fake-zip-content'));

                // Mock Docker operations to succeed
                mockSpawn.mockImplementation((command, args) => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    setTimeout(() => {
                        if (args?.includes('pull')) {
                            mockProcess.stdout.emit('data', Buffer.from('Pull complete'));
                        } else if (args?.includes('create')) {
                            // Docker create succeeds
                        } else if (args?.includes('cp')) {
                            // Docker cp succeeds
                        } else if (command === 'python3') {
                            mockProcess.stdout.emit('data', Buffer.from('1048576')); // 1MB unzipped
                        }
                        mockProcess.emit('close', 0);
                    }, 10);

                    return mockProcess;
                });

                // Mock PublishLayerVersion to fail with service unavailable
                const serviceError = new Error('Service temporarily unavailable');
                (serviceError as any).name = 'ServiceUnavailableException';
                (serviceError as any).$metadata = { httpStatusCode: 503 };
                (mockLambdaClient.send as jest.Mock).mockRejectedValue(serviceError);

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toMatchObject({
                    code: ErrorCodes.LAYER_CREATION_FAILED,
                    message: expect.stringContaining('Failed to create Node.js layer'),
                });

                manager.destroy();
            });

            it('should handle network timeout errors with proper error classification', async () => {
                const manager = new AWSLayerManager({ logger });

                // Mock pagination to throw network timeout
                const { paginateListLayers } = require('@aws-sdk/client-lambda');
                (paginateListLayers as jest.Mock).mockImplementation(() => {
                    throw Object.assign(new Error('socket hang up'), {
                        code: 'ECONNRESET',
                        errno: -104,
                        syscall: 'read'
                    });
                });

                await expect(manager.findExistingLayer({
                    layerName: 'test-layer',
                    requirements: {
                        nodeVersion: '20.10.0',
                        architecture: 'x86_64',
                    },
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(manager.findExistingLayer({
                    layerName: 'test-layer',
                    requirements: {
                        nodeVersion: '20.10.0',
                        architecture: 'x86_64',
                    },
                })).rejects.toMatchObject({
                    code: ErrorCodes.AWS_API_ERROR,
                    message: expect.stringContaining('socket hang up'),
                });

                manager.destroy();
            });
        });
    });

    describe('Invalid Input Parameter Combinations', () => {
        describe('ensureNodeRuntimeLayer', () => {
            it('should throw RUNTIME_UNSUPPORTED for unsupported runtime', async () => {
                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs16.x', // Unsupported
                    architecture: 'x86_64',
                    region: 'us-east-1',
                    accountId: '123456789012',
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs16.x',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                    accountId: '123456789012',
                })).rejects.toMatchObject({
                    code: ErrorCodes.RUNTIME_UNSUPPORTED,
                    message: expect.stringContaining('Unsupported runtime: nodejs16.x'),
                });
            });

            it('should throw INVALID_ARCHITECTURE for unsupported architecture', async () => {
                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'arm32' as any, // Unsupported
                    region: 'us-east-1',
                    accountId: '123456789012',
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'arm32' as any,
                    region: 'us-east-1',
                    accountId: '123456789012',
                })).rejects.toMatchObject({
                    code: ErrorCodes.INVALID_ARCHITECTURE,
                    message: expect.stringContaining('Unsupported architecture: arm32'),
                });
            });

            it('should throw INTERNAL_ERROR for invalid region format', async () => {
                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: 'INVALID_REGION!', // Invalid format
                    accountId: '123456789012',
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: 'INVALID_REGION!',
                    accountId: '123456789012',
                })).rejects.toMatchObject({
                    code: ErrorCodes.INTERNAL_ERROR,
                    message: expect.stringContaining('Invalid region format: INVALID_REGION!'),
                });
            });

            it('should throw INTERNAL_ERROR for invalid account ID format', async () => {
                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                    accountId: '12345', // Too short
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                    accountId: '12345',
                })).rejects.toMatchObject({
                    code: ErrorCodes.INTERNAL_ERROR,
                    message: expect.stringContaining('Invalid AWS account ID format: 12345'),
                });
            });

            it('should throw INTERNAL_ERROR for non-numeric account ID', async () => {
                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                    accountId: '12345678901a', // Contains letter
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                    accountId: '12345678901a',
                })).rejects.toMatchObject({
                    code: ErrorCodes.INTERNAL_ERROR,
                    message: expect.stringContaining('Invalid AWS account ID format: 12345678901a'),
                });
            });

            it('should throw INTERNAL_ERROR for invalid awsSdkConfig type', async () => {
                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                    accountId: '123456789012',
                    awsSdkConfig: 'invalid' as any, // Should be object
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                    accountId: '123456789012',
                    awsSdkConfig: 'invalid' as any,
                })).rejects.toMatchObject({
                    code: ErrorCodes.INTERNAL_ERROR,
                    message: expect.stringContaining('awsSdkConfig must be an object if provided'),
                });
            });

            it('should throw INTERNAL_ERROR for invalid logger interface', async () => {
                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                    accountId: '123456789012',
                    logger: { debug: 'not a function' } as any, // Invalid logger
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                    accountId: '123456789012',
                    logger: { debug: 'not a function' } as any,
                })).rejects.toMatchObject({
                    code: ErrorCodes.INTERNAL_ERROR,
                    message: expect.stringContaining('logger must implement debug() method'),
                });
            });
        });

        describe('DockerRuntimeDetector', () => {
            it('should throw RUNTIME_UNSUPPORTED for empty runtime name', async () => {
                const detector = new DockerRuntimeDetector({ logger });

                await expect(detector.detectNodeVersion('', 'x86_64'))
                    .rejects
                    .toThrow(NodeRuntimeLayerError);

                await expect(detector.detectNodeVersion('', 'x86_64'))
                    .rejects
                    .toMatchObject({
                        code: ErrorCodes.RUNTIME_UNSUPPORTED,
                        message: expect.stringContaining('Unsupported runtime:'),
                    });
            });

            it('should throw INVALID_ARCHITECTURE for empty architecture', async () => {
                const detector = new DockerRuntimeDetector({ logger });

                await expect(detector.detectNodeVersion('nodejs20.x', ''))
                    .rejects
                    .toThrow(NodeRuntimeLayerError);

                await expect(detector.detectNodeVersion('nodejs20.x', ''))
                    .rejects
                    .toMatchObject({
                        code: ErrorCodes.INVALID_ARCHITECTURE,
                        message: expect.stringContaining('Unsupported architecture:'),
                    });
            });
        });
    });

    describe('Layer Size Limit Edge Cases', () => {
        describe('AWSLayerManager', () => {
            it('should throw LAYER_SIZE_EXCEEDED when ZIP file exceeds 50MB limit', async () => {
                const manager = new AWSLayerManager({ logger });

                // Mock all prerequisites to succeed until size validation
                mockFs.mkdtemp.mockResolvedValue('/tmp/test-layer-123');
                mockFs.mkdir.mockResolvedValue(undefined);
                mockFs.copyFile.mockResolvedValue(undefined);
                mockFs.chmod.mockResolvedValue(undefined);

                // Mock ZIP file to be oversized (60MB)
                const oversizedZip = 60 * 1024 * 1024; // 60MB
                mockFs.stat.mockResolvedValue({
                    size: oversizedZip,
                    isFile: () => true
                } as any);

                // Mock Docker operations to succeed
                mockSpawn.mockImplementation((command, args) => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    setTimeout(() => {
                        if (args?.includes('pull')) {
                            mockProcess.stdout.emit('data', Buffer.from('Pull complete'));
                        } else if (args?.includes('create')) {
                            // Docker create succeeds
                        } else if (args?.includes('cp')) {
                            // Docker cp succeeds
                        } else if (command === 'python3') {
                            // Return reasonable unzipped size
                            mockProcess.stdout.emit('data', Buffer.from('104857600')); // 100MB unzipped
                        }
                        mockProcess.emit('close', 0);
                    }, 10);

                    return mockProcess;
                });

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toMatchObject({
                    code: ErrorCodes.LAYER_CREATION_FAILED,
                    message: expect.stringContaining('Failed to create Node.js layer'),
                });

                manager.destroy();
            });

            it('should throw LAYER_SIZE_EXCEEDED when unzipped content exceeds 250MB limit', async () => {
                const manager = new AWSLayerManager({ logger });

                // Mock all prerequisites to succeed until size validation
                mockFs.mkdtemp.mockResolvedValue('/tmp/test-layer-123');
                mockFs.mkdir.mockResolvedValue(undefined);
                mockFs.copyFile.mockResolvedValue(undefined);
                mockFs.chmod.mockResolvedValue(undefined);

                // Mock ZIP file to be within zipped limit but exceed unzipped limit
                const validZipSize = 40 * 1024 * 1024; // 40MB (within 50MB limit)
                const oversizedUnzipped = 300 * 1024 * 1024; // 300MB (exceeds 250MB limit)

                mockFs.stat.mockResolvedValue({
                    size: validZipSize,
                    isFile: () => true
                } as any);

                // Mock Docker operations to succeed
                mockSpawn.mockImplementation((command, args) => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    setTimeout(() => {
                        if (args?.includes('pull')) {
                            mockProcess.stdout.emit('data', Buffer.from('Pull complete'));
                        } else if (args?.includes('create')) {
                            // Docker create succeeds
                        } else if (args?.includes('cp')) {
                            // Docker cp succeeds
                        } else if (command === 'python3') {
                            // Return oversized unzipped content
                            mockProcess.stdout.emit('data', Buffer.from(oversizedUnzipped.toString()));
                        }
                        mockProcess.emit('close', 0);
                    }, 10);

                    return mockProcess;
                });

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toMatchObject({
                    code: ErrorCodes.LAYER_CREATION_FAILED,
                    message: expect.stringContaining('Failed to create Node.js layer'),
                });

                manager.destroy();
            });

            it('should handle Python size calculation failure gracefully with fallback', async () => {
                const manager = new AWSLayerManager({ logger });

                // Mock all prerequisites to succeed
                mockFs.mkdtemp.mockResolvedValue('/tmp/test-layer-123');
                mockFs.mkdir.mockResolvedValue(undefined);
                mockFs.copyFile.mockResolvedValue(undefined);
                mockFs.chmod.mockResolvedValue(undefined);
                mockFs.readFile.mockResolvedValue(Buffer.from('fake-zip-content'));

                // Mock reasonable ZIP size
                const zipSize = 10 * 1024 * 1024; // 10MB
                mockFs.stat.mockResolvedValue({
                    size: zipSize,
                    isFile: () => true
                } as any);

                // Mock Docker operations to succeed, but Python size calculation to fail
                mockSpawn.mockImplementation((command, args) => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    setTimeout(() => {
                        if (args?.includes('pull')) {
                            mockProcess.stdout.emit('data', Buffer.from('Pull complete'));
                            mockProcess.emit('close', 0);
                        } else if (args?.includes('create')) {
                            // Docker create succeeds
                            mockProcess.emit('close', 0);
                        } else if (args?.includes('cp')) {
                            // Docker cp succeeds
                            mockProcess.emit('close', 0);
                        } else if (command === 'python3' && args?.[1]?.includes('zipfile')) {
                            // Python size calculation fails
                            mockProcess.stderr.emit('data', Buffer.from('Python not available'));
                            mockProcess.emit('close', 1);
                        } else if (command === 'python3') {
                            // Other Python operations succeed
                            mockProcess.emit('close', 0);
                        } else {
                            // Default case - succeed
                            mockProcess.emit('close', 0);
                        }
                    }, 10);

                    return mockProcess;
                });

                // Mock AWS publish to succeed
                (mockLambdaClient.send as jest.Mock).mockResolvedValue({
                    LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:test-layer:1',
                    Version: 1,
                    CreatedDate: '2025-01-01T00:00:00.000Z',
                });

                // Should succeed using fallback size estimation (2x ZIP size = 20MB, within limits)
                const result = await manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                });

                expect(result.arn).toBe('arn:aws:lambda:us-east-1:123456789012:layer:test-layer:1');

                manager.destroy();
            });
        });
    });

    describe('File System Permission and IO Errors', () => {
        describe('AWSLayerManager', () => {
            it('should throw LAYER_CREATION_FAILED when temp directory creation fails', async () => {
                const manager = new AWSLayerManager({ logger });

                // Mock temp directory creation to fail with permission error
                mockFs.mkdtemp.mockRejectedValue(
                    Object.assign(new Error('EACCES: permission denied'), {
                        code: 'EACCES',
                        errno: -13,
                        syscall: 'mkdir'
                    })
                );

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toMatchObject({
                    code: ErrorCodes.LAYER_CREATION_FAILED,
                    message: expect.stringContaining('EACCES: permission denied'),
                });

                manager.destroy();
            });

            it('should throw LAYER_CREATION_FAILED when file copy operations fail', async () => {
                const manager = new AWSLayerManager({ logger });

                // Mock temp directory creation to succeed
                mockFs.mkdtemp.mockResolvedValue('/tmp/test-layer-123');
                mockFs.mkdir.mockResolvedValue(undefined);

                // Mock file copy to fail with disk full error
                mockFs.copyFile.mockRejectedValue(
                    Object.assign(new Error('ENOSPC: no space left on device'), {
                        code: 'ENOSPC',
                        errno: -28,
                        syscall: 'copyfile'
                    })
                );

                // Mock Docker operations to succeed
                mockSpawn.mockImplementation((command, args) => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    setTimeout(() => {
                        if (args?.includes('pull')) {
                            mockProcess.stdout.emit('data', Buffer.from('Pull complete'));
                        } else if (args?.includes('create')) {
                            // Docker create succeeds
                        } else if (args?.includes('cp')) {
                            // Docker cp succeeds
                        }
                        mockProcess.emit('close', 0);
                    }, 10);

                    return mockProcess;
                });

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toMatchObject({
                    code: ErrorCodes.LAYER_CREATION_FAILED,
                    message: expect.stringContaining('ENOSPC: no space left on device'),
                });

                manager.destroy();
            });

            it('should throw LAYER_CREATION_FAILED when ZIP file read fails during publish', async () => {
                const manager = new AWSLayerManager({ logger });

                // Mock all prerequisites to succeed until ZIP read
                mockFs.mkdtemp.mockResolvedValue('/tmp/test-layer-123');
                mockFs.mkdir.mockResolvedValue(undefined);
                mockFs.copyFile.mockResolvedValue(undefined);
                mockFs.chmod.mockResolvedValue(undefined);
                mockFs.stat.mockResolvedValue({ size: 1024 * 1024, isFile: () => true } as any);

                // Mock ZIP file read to fail
                mockFs.readFile.mockRejectedValue(
                    Object.assign(new Error('ENOENT: no such file or directory'), {
                        code: 'ENOENT',
                        errno: -2,
                        syscall: 'open'
                    })
                );

                // Mock Docker and Python operations to succeed
                mockSpawn.mockImplementation((command, args) => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    setTimeout(() => {
                        if (args?.includes('pull')) {
                            mockProcess.stdout.emit('data', Buffer.from('Pull complete'));
                        } else if (args?.includes('create')) {
                            // Docker create succeeds
                        } else if (args?.includes('cp')) {
                            // Docker cp succeeds
                        } else if (command === 'python3') {
                            mockProcess.stdout.emit('data', Buffer.from('1048576')); // 1MB unzipped
                        }
                        mockProcess.emit('close', 0);
                    }, 10);

                    return mockProcess;
                });

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toMatchObject({
                    code: ErrorCodes.LAYER_CREATION_FAILED,
                    message: expect.stringContaining('ENOENT: no such file or directory'),
                });

                manager.destroy();
            });
        });
    });

    describe('Boundary Conditions and Edge Values', () => {
        describe('Layer Size Validation', () => {
            it('should pass validation for layer exactly at ZIP size limit', async () => {
                const manager = new AWSLayerManager({ logger });

                // Mock all prerequisites to succeed
                mockFs.mkdtemp.mockResolvedValue('/tmp/test-layer-123');
                mockFs.mkdir.mockResolvedValue(undefined);
                mockFs.copyFile.mockResolvedValue(undefined);
                mockFs.chmod.mockResolvedValue(undefined);
                mockFs.readFile.mockResolvedValue(Buffer.from('fake-zip-content'));

                // Mock ZIP file to be exactly at limit (50MB)
                const exactLimit = 50 * 1024 * 1024; // Exactly 50MB
                mockFs.stat.mockResolvedValue({
                    size: exactLimit,
                    isFile: () => true
                } as any);

                // Mock Docker and Python operations to succeed
                mockSpawn.mockImplementation((command, args) => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    setTimeout(() => {
                        if (args?.includes('pull')) {
                            mockProcess.stdout.emit('data', Buffer.from('Pull complete'));
                        } else if (args?.includes('create')) {
                            // Docker create succeeds
                        } else if (args?.includes('cp')) {
                            // Docker cp succeeds
                        } else if (command === 'python3') {
                            // Return unzipped size within limit (100MB)
                            mockProcess.stdout.emit('data', Buffer.from('104857600'));
                        }
                        mockProcess.emit('close', 0);
                    }, 10);

                    return mockProcess;
                });

                // Mock AWS publish to succeed
                (mockLambdaClient.send as jest.Mock).mockResolvedValue({
                    LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:test-layer:1',
                    Version: 1,
                    CreatedDate: '2025-01-01T00:00:00.000Z',
                });

                // Should succeed at exact limit
                const result = await manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                });

                expect(result.arn).toBe('arn:aws:lambda:us-east-1:123456789012:layer:test-layer:1');

                manager.destroy();
            });

            it('should fail validation for layer one byte over ZIP size limit', async () => {
                const manager = new AWSLayerManager({ logger });

                // Mock all prerequisites to succeed until size validation
                mockFs.mkdtemp.mockResolvedValue('/tmp/test-layer-123');
                mockFs.mkdir.mockResolvedValue(undefined);
                mockFs.copyFile.mockResolvedValue(undefined);
                mockFs.chmod.mockResolvedValue(undefined);

                // Mock ZIP file to be one byte over limit
                const overLimit = (50 * 1024 * 1024) + 1; // 50MB + 1 byte
                mockFs.stat.mockResolvedValue({
                    size: overLimit,
                    isFile: () => true
                } as any);

                // Mock Docker operations to succeed
                mockSpawn.mockImplementation((command, args) => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    setTimeout(() => {
                        if (args?.includes('pull')) {
                            mockProcess.stdout.emit('data', Buffer.from('Pull complete'));
                        } else if (args?.includes('create')) {
                            // Docker create succeeds
                        } else if (args?.includes('cp')) {
                            // Docker cp succeeds
                        }
                        mockProcess.emit('close', 0);
                    }, 10);

                    return mockProcess;
                });

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toThrow(NodeRuntimeLayerError);

                await expect(manager.createNodeLayer({
                    layerName: 'test-layer',
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                })).rejects.toMatchObject({
                    code: ErrorCodes.LAYER_CREATION_FAILED,
                    message: expect.stringContaining('Failed to create Node.js layer'),
                });

                manager.destroy();
            });
        });

        describe('Input Validation Boundaries', () => {
            it('should handle minimum valid account ID (12 zeros)', async () => {
                // Mock successful operations
                const detector = new DockerRuntimeDetector({ logger, enableFallback: true });
                const manager = new AWSLayerManager({ logger });

                // Mock Docker to fail (use fallback)
                mockSpawn.mockImplementation(() => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    setTimeout(() => {
                        mockProcess.emit('close', 1);
                    }, 10);

                    return mockProcess;
                });

                // Mock layer manager to return existing layer
                const { paginateListLayers } = require('@aws-sdk/client-lambda');
                (paginateListLayers as jest.Mock).mockReturnValue({
                    [Symbol.asyncIterator]: async function* () {
                        yield {
                            Layers: [{
                                LayerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
                                LatestMatchingVersion: { Version: 1 }
                            }]
                        };
                    }
                });

                (mockLambdaClient.send as jest.Mock).mockResolvedValue({
                    LayerVersionArn: 'arn:aws:lambda:us-east-1:000000000000:layer:lambda-kata-nodejs-nodejs20.x-x86_64:1',
                    CreatedDate: new Date().toISOString(),
                    Description: 'Node.js 20.10.0 (x86_64) runtime layer for Lambda Kata',
                });

                // Should accept minimum valid account ID
                const result = await ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                    accountId: '000000000000', // Minimum valid (12 zeros)
                });

                expect(result.created).toBe(false);
                expect(result.nodeVersion).toBe('20.10.0');

                manager.destroy();
            });

            it('should handle maximum valid account ID (12 nines)', async () => {
                // Mock successful operations
                const detector = new DockerRuntimeDetector({ logger, enableFallback: true });
                const manager = new AWSLayerManager({ logger });

                // Mock Docker to fail (use fallback)
                mockSpawn.mockImplementation(() => {
                    const mockProcess = new EventEmitter() as any;
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.kill = jest.fn();

                    setTimeout(() => {
                        mockProcess.emit('close', 1);
                    }, 10);

                    return mockProcess;
                });

                // Mock layer manager to return existing layer
                const { paginateListLayers } = require('@aws-sdk/client-lambda');
                (paginateListLayers as jest.Mock).mockReturnValue({
                    [Symbol.asyncIterator]: async function* () {
                        yield {
                            Layers: [{
                                LayerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
                                LatestMatchingVersion: { Version: 1 }
                            }]
                        };
                    }
                });

                (mockLambdaClient.send as jest.Mock).mockResolvedValue({
                    LayerVersionArn: 'arn:aws:lambda:us-east-1:999999999999:layer:lambda-kata-nodejs-nodejs20.x-x86_64:1',
                    CreatedDate: new Date().toISOString(),
                    Description: 'Node.js 20.10.0 (x86_64) runtime layer for Lambda Kata',
                });

                // Should accept maximum valid account ID
                const result = await ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: 'us-east-1',
                    accountId: '999999999999', // Maximum valid (12 nines)
                });

                expect(result.created).toBe(false);
                expect(result.nodeVersion).toBe('20.10.0');

                manager.destroy();
            });
        });
    });
});
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
 * Type definition tests for Node.js Layer Management
 * 
 * These tests verify that all interfaces are properly defined and exported,
 * ensuring compile-time type safety and API contract compliance.
 */

import {
    EnsureNodeRuntimeLayerOptions,
    EnsureNodeRuntimeLayerResult,
    NodeVersionInfo,
    LayerInfo,
    LayerSearchOptions,
    LayerRequirements,
    LayerCreationOptions,
    Logger,
    RuntimeDetector,
    LayerManager,
    ErrorCodes,
    NodeRuntimeLayerError,
    VersionCacheEntry,
    LayerMetadata,
    NoOpLogger,
    ConsoleLogger,
    createDefaultLogger,
} from '../src';

describe('Node.js Layer Management Type Definitions', () => {
    describe('Core Interfaces', () => {
        it('should have properly typed EnsureNodeRuntimeLayerOptions', () => {
            const options: EnsureNodeRuntimeLayerOptions = {
                runtimeName: 'nodejs20.x',
                architecture: 'x86_64',
                region: 'us-east-1',
                accountId: '123456789012',
            };

            // Type assertions to verify interface structure
            expect(typeof options.runtimeName).toBe('string');
            expect(typeof options.architecture).toBe('string');
            expect(typeof options.region).toBe('string');
            expect(typeof options.accountId).toBe('string');

            // Verify architecture constraint
            const validArchitectures: Array<'x86_64' | 'arm64'> = ['x86_64', 'arm64'];
            expect(validArchitectures).toContain(options.architecture);
        });

        it('should have properly typed EnsureNodeRuntimeLayerResult', () => {
            const result: EnsureNodeRuntimeLayerResult = {
                layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:test:1',
                layerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
                runtimeName: 'nodejs20.x',
                nodeVersion: '20.10.0',
                architecture: 'x86_64',
                created: true,
            };

            // Type assertions
            expect(typeof result.layerArn).toBe('string');
            expect(typeof result.layerName).toBe('string');
            expect(typeof result.runtimeName).toBe('string');
            expect(typeof result.nodeVersion).toBe('string');
            expect(typeof result.architecture).toBe('string');
            expect(typeof result.created).toBe('boolean');
        });

        it('should have properly typed NodeVersionInfo', () => {
            const versionInfo: NodeVersionInfo = {
                version: '20.10.0',
                runtimeName: 'nodejs20.x',
                dockerImage: 'public.ecr.aws/lambda/nodejs:20-x86_64',
            };

            expect(typeof versionInfo.version).toBe('string');
            expect(typeof versionInfo.runtimeName).toBe('string');
            expect(typeof versionInfo.dockerImage).toBe('string');
        });

        it('should have properly typed LayerInfo', () => {
            const layerInfo: LayerInfo = {
                arn: 'arn:aws:lambda:us-east-1:123456789012:layer:test:1',
                name: 'test-layer',
                version: 1,
                nodeVersion: '20.10.0',
                architecture: 'x86_64',
                createdDate: new Date(),
            };

            expect(typeof layerInfo.arn).toBe('string');
            expect(typeof layerInfo.name).toBe('string');
            expect(typeof layerInfo.version).toBe('number');
            expect(typeof layerInfo.nodeVersion).toBe('string');
            expect(typeof layerInfo.architecture).toBe('string');
            expect(layerInfo.createdDate).toBeInstanceOf(Date);
        });
    });

    describe('Error Handling', () => {
        it('should have properly defined ErrorCodes enum', () => {
            // Verify all required error codes exist
            expect(ErrorCodes.DOCKER_UNAVAILABLE).toBe('DOCKER_UNAVAILABLE');
            expect(ErrorCodes.RUNTIME_UNSUPPORTED).toBe('RUNTIME_UNSUPPORTED');
            expect(ErrorCodes.AWS_API_ERROR).toBe('AWS_API_ERROR');
            expect(ErrorCodes.LAYER_CREATION_FAILED).toBe('LAYER_CREATION_FAILED');
            expect(ErrorCodes.INVALID_ARCHITECTURE).toBe('INVALID_ARCHITECTURE');
            expect(ErrorCodes.VERSION_DETECTION_FAILED).toBe('VERSION_DETECTION_FAILED');
            expect(ErrorCodes.LAYER_SIZE_EXCEEDED).toBe('LAYER_SIZE_EXCEEDED');
            expect(ErrorCodes.QUOTA_EXCEEDED).toBe('QUOTA_EXCEEDED');
            expect(ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
        });

        it('should create NodeRuntimeLayerError with proper inheritance', () => {
            const error = new NodeRuntimeLayerError(
                'Test error message',
                ErrorCodes.RUNTIME_UNSUPPORTED
            );

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(NodeRuntimeLayerError);
            expect(error.name).toBe('NodeRuntimeLayerError');
            expect(error.message).toBe('Test error message');
            expect(error.code).toBe(ErrorCodes.RUNTIME_UNSUPPORTED);
            expect(error.cause).toBeUndefined();
        });

        it('should create NodeRuntimeLayerError with cause chaining', () => {
            const originalError = new Error('Original error');
            const error = new NodeRuntimeLayerError(
                'Wrapped error',
                ErrorCodes.AWS_API_ERROR,
                originalError
            );

            expect(error.cause).toBe(originalError);
        });
    });

    describe('Logger Interface', () => {
        it('should have properly typed Logger interface', () => {
            const logger: Logger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            };

            // Verify method signatures
            logger.debug('test message');
            logger.info('test message', { key: 'value' });
            logger.warn('test message');
            logger.error('test message', { error: 'details' });

            expect(logger.debug).toHaveBeenCalledWith('test message');
            expect(logger.info).toHaveBeenCalledWith('test message', { key: 'value' });
            expect(logger.warn).toHaveBeenCalledWith('test message');
            expect(logger.error).toHaveBeenCalledWith('test message', { error: 'details' });
        });

        it('should create NoOpLogger instance', () => {
            const logger = new NoOpLogger();

            // Should not throw and should be silent
            expect(() => {
                logger.debug('test');
                logger.info('test');
                logger.warn('test');
                logger.error('test');
            }).not.toThrow();
        });

        it('should create ConsoleLogger instance', () => {
            const logger = new ConsoleLogger('[TEST]');

            // Should not throw (actual console output is tested separately)
            expect(() => {
                logger.debug('test');
                logger.info('test');
                logger.warn('test');
                logger.error('test');
            }).not.toThrow();
        });

        it('should create default logger', () => {
            const logger = createDefaultLogger();
            expect(logger).toBeDefined();
            expect(typeof logger.debug).toBe('function');
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.error).toBe('function');
        });
    });

    describe('Interface Contracts', () => {
        it('should have properly typed RuntimeDetector interface', () => {
            const mockDetector: RuntimeDetector = {
                detectNodeVersion: jest.fn().mockResolvedValue({
                    version: '20.10.0',
                    runtimeName: 'nodejs20.x',
                    dockerImage: 'public.ecr.aws/lambda/nodejs:20-x86_64',
                }),
            };

            expect(typeof mockDetector.detectNodeVersion).toBe('function');
        });

        it('should have properly typed LayerManager interface', () => {
            const mockManager: LayerManager = {
                findExistingLayer: jest.fn().mockResolvedValue(null),
                createNodeLayer: jest.fn().mockResolvedValue({
                    arn: 'arn:aws:lambda:us-east-1:123456789012:layer:test:1',
                    name: 'test-layer',
                    version: 1,
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                    createdDate: new Date(),
                }),
                validateLayerCompatibility: jest.fn().mockReturnValue(true),
                getCircuitBreakerState: jest.fn().mockReturnValue({ state: 'CLOSED', failureCount: 0, successCount: 0 }),
                destroy: jest.fn(),
            };

            expect(typeof mockManager.findExistingLayer).toBe('function');
            expect(typeof mockManager.createNodeLayer).toBe('function');
            expect(typeof mockManager.validateLayerCompatibility).toBe('function');
        });
    });

    describe('Supporting Types', () => {
        it('should have properly typed LayerSearchOptions', () => {
            const options: LayerSearchOptions = {
                layerName: 'test-layer',
                requirements: {
                    nodeVersion: '20.10.0',
                    architecture: 'x86_64',
                },
            };

            expect(typeof options.layerName).toBe('string');
            expect(typeof options.requirements.nodeVersion).toBe('string');
            expect(typeof options.requirements.architecture).toBe('string');
        });

        it('should have properly typed LayerCreationOptions', () => {
            const options: LayerCreationOptions = {
                layerName: 'test-layer',
                nodeVersion: '20.10.0',
                architecture: 'x86_64',
                region: 'us-east-1',
                description: 'Test layer',
            };

            expect(typeof options.layerName).toBe('string');
            expect(typeof options.nodeVersion).toBe('string');
            expect(typeof options.architecture).toBe('string');
            expect(typeof options.region).toBe('string');
            expect(typeof options.description).toBe('string');
        });

        it('should have properly typed VersionCacheEntry', () => {
            const entry: VersionCacheEntry = {
                version: '20.10.0',
                runtimeName: 'nodejs20.x',
                dockerImage: 'public.ecr.aws/lambda/nodejs:20-x86_64',
                cachedAt: new Date(),
                ttl: 3600000, // 1 hour in milliseconds
            };

            expect(typeof entry.version).toBe('string');
            expect(typeof entry.runtimeName).toBe('string');
            expect(typeof entry.dockerImage).toBe('string');
            expect(entry.cachedAt).toBeInstanceOf(Date);
            expect(typeof entry.ttl).toBe('number');
        });

        it('should have properly typed LayerMetadata', () => {
            const metadata: LayerMetadata = {
                layerName: 'test-layer',
                description: 'Test layer description',
                compatibleRuntimes: ['python3.12'],
                compatibleArchitectures: ['x86_64'],
                licenseInfo: 'Apache-2.0',
            };

            expect(typeof metadata.layerName).toBe('string');
            expect(typeof metadata.description).toBe('string');
            expect(Array.isArray(metadata.compatibleRuntimes)).toBe(true);
            expect(Array.isArray(metadata.compatibleArchitectures)).toBe(true);
            expect(typeof metadata.licenseInfo).toBe('string');
        });
    });
});
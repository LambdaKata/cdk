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
 * Property-based tests for ensureNodeRuntimeLayer function
 *
 * Tests universal properties that should hold across all valid inputs
 * using fast-check for comprehensive input coverage.
 */

import * as fc from 'fast-check';
import { ensureNodeRuntimeLayer } from '../src/ensure-node-runtime-layer';
import {
    EnsureNodeRuntimeLayerOptions,
    EnsureNodeRuntimeLayerResult,
    NodeRuntimeLayerError,
    ErrorCodes,
    NodeVersionInfo,
    LayerInfo,
} from '../src/nodejs-layer-manager';
import { DockerRuntimeDetector } from '../src/docker-runtime-detector';
import { AWSLayerManager } from '../src/aws-layer-manager';
import { ConsoleLogger } from '../src/logger';

// Mock the dependencies
jest.mock('../src/docker-runtime-detector');
jest.mock('../src/aws-layer-manager');

const MockedDockerRuntimeDetector = DockerRuntimeDetector as jest.MockedClass<typeof DockerRuntimeDetector>;
const MockedAWSLayerManager = AWSLayerManager as jest.MockedClass<typeof AWSLayerManager>;

describe('ensureNodeRuntimeLayer Properties', () => {
    let mockRuntimeDetector: jest.Mocked<DockerRuntimeDetector>;
    let mockLayerManager: jest.Mocked<AWSLayerManager>;

    beforeEach(() => {
        jest.clearAllMocks();

        mockRuntimeDetector = {
            detectNodeVersion: jest.fn(),
        } as any;

        mockLayerManager = {
            findExistingLayer: jest.fn(),
            createNodeLayer: jest.fn(),
            validateLayerCompatibility: jest.fn(),
        } as any;

        MockedDockerRuntimeDetector.mockImplementation(() => mockRuntimeDetector);
        MockedAWSLayerManager.mockImplementation(() => mockLayerManager);
    });

    // Generators for valid inputs
    const validRuntimeArb = fc.oneof(
        fc.constant('nodejs18.x'),
        fc.constant('nodejs20.x'),
        fc.constant('nodejs22.x')
    );

    const validArchitectureArb = fc.oneof(
        fc.constant('x86_64' as const),
        fc.constant('arm64' as const)
    );

    const validRegionArb = fc.oneof(
        fc.constant('us-east-1'),
        fc.constant('us-west-2'),
        fc.constant('eu-west-1'),
        fc.constant('ap-southeast-1')
    );

    const validAccountIdArb = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 12, maxLength: 12 })
        .map(digits => digits.join(''));

    const validOptionsArb = fc.record({
        runtimeName: validRuntimeArb,
        architecture: validArchitectureArb,
        region: validRegionArb,
        accountId: validAccountIdArb,
        awsSdkConfig: fc.option(fc.record({
            region: validRegionArb,
        }), { nil: undefined }),
        logger: fc.option(fc.constant(new ConsoleLogger()), { nil: undefined }),
    });

    // Mock data generators
    const nodeVersionInfoArb = fc.record({
        version: fc.oneof(
            fc.constant('18.19.0'),
            fc.constant('20.10.0'),
            fc.constant('22.1.0')
        ),
        runtimeName: validRuntimeArb,
        dockerImage: fc.oneof(
            fc.constant('public.ecr.aws/lambda/nodejs:18-x86_64'),
            fc.constant('public.ecr.aws/lambda/nodejs:20-x86_64'),
            fc.constant('public.ecr.aws/lambda/nodejs:22-arm64')
        ),
    });

    const layerInfoArb = fc.record({
        arn: fc.oneof(
            fc.constant('arn:aws:lambda:us-east-1:123456789012:layer:test:1'),
            fc.constant('arn:aws:lambda:us-west-2:987654321098:layer:test:2')
        ),
        name: fc.oneof(
            fc.constant('lambda-kata-nodejs-nodejs18.x-x86_64'),
            fc.constant('lambda-kata-nodejs-nodejs20.x-arm64')
        ),
        version: fc.integer({ min: 1, max: 10 }),
        nodeVersion: fc.oneof(
            fc.constant('18.19.0'),
            fc.constant('20.10.0'),
            fc.constant('22.1.0')
        ),
        architecture: validArchitectureArb,
        createdDate: fc.date({ min: new Date('2024-01-01'), max: new Date() }),
    });

    /**
     * Property 7: API Contract Compliance
     * For any valid call to ensureNodeRuntimeLayer, the returned result object
     * should contain all required properties with correct types and valid values
     * **Validates: Requirements 4.2**
     */
    it('Property 7: API Contract Compliance', async () => {
        await fc.assert(
            fc.asyncProperty(
                validOptionsArb,
                nodeVersionInfoArb,
                fc.option(layerInfoArb),
                async (options, versionInfo, existingLayer) => {
                    // Setup mocks
                    mockRuntimeDetector.detectNodeVersion.mockResolvedValue(versionInfo);

                    if (existingLayer) {
                        mockLayerManager.findExistingLayer.mockResolvedValue(existingLayer);
                    } else {
                        mockLayerManager.findExistingLayer.mockResolvedValue(null);
                        const newLayer: LayerInfo = {
                            arn: `arn:aws:lambda:${options.region}:${options.accountId}:layer:test:1`,
                            name: `lambda-kata-nodejs-${options.runtimeName}-${options.architecture}`,
                            version: 1,
                            nodeVersion: versionInfo.version,
                            architecture: options.architecture,
                            createdDate: new Date(),
                        };
                        mockLayerManager.createNodeLayer.mockResolvedValue(newLayer);
                    }

                    const result = await ensureNodeRuntimeLayer(options);

                    // Verify all required properties exist
                    expect(result).toHaveProperty('layerArn');
                    expect(result).toHaveProperty('layerName');
                    expect(result).toHaveProperty('runtimeName');
                    expect(result).toHaveProperty('nodeVersion');
                    expect(result).toHaveProperty('architecture');
                    expect(result).toHaveProperty('created');

                    // Verify property types
                    expect(typeof result.layerArn).toBe('string');
                    expect(typeof result.layerName).toBe('string');
                    expect(typeof result.runtimeName).toBe('string');
                    expect(typeof result.nodeVersion).toBe('string');
                    expect(typeof result.architecture).toBe('string');
                    expect(typeof result.created).toBe('boolean');

                    // Verify property values
                    expect(result.layerArn).toMatch(/^arn:aws:lambda:/);
                    expect(result.layerName).toMatch(/^lambda-kata-nodejs-/);
                    expect(result.runtimeName).toBe(options.runtimeName);
                    expect(result.nodeVersion).toMatch(/^\d+\.\d+\.\d+$/);
                    expect(['x86_64', 'arm64']).toContain(result.architecture);
                    expect(result.architecture).toBe(options.architecture);

                    // Verify created flag consistency
                    if (existingLayer) {
                        expect(result.created).toBe(false);
                    } else {
                        expect(result.created).toBe(true);
                    }
                }
            ),
            { numRuns: 10 }
        );
    });

    /**
     * Property 8: Optional Parameter Handling
     * For any call to ensureNodeRuntimeLayer with or without optional parameters,
     * the function should execute successfully and respect the provided configuration
     * **Validates: Requirements 4.3, 4.4**
     */
    it('Property 8: Optional Parameter Handling', async () => {
        await fc.assert(
            fc.asyncProperty(
                validRuntimeArb,
                validArchitectureArb,
                validRegionArb,
                validAccountIdArb,
                fc.option(fc.record({ region: validRegionArb }), { nil: undefined }),
                fc.option(fc.constant(new ConsoleLogger()), { nil: undefined }),
                nodeVersionInfoArb,
                layerInfoArb,
                async (runtime, arch, region, accountId, awsConfig, logger, versionInfo, layerInfo) => {
                    // Create options with optional parameters
                    const options: EnsureNodeRuntimeLayerOptions = {
                        runtimeName: runtime,
                        architecture: arch,
                        region,
                        accountId,
                        ...(awsConfig && { awsSdkConfig: awsConfig }),
                        ...(logger && { logger }),
                    };

                    // Setup mocks
                    mockRuntimeDetector.detectNodeVersion.mockResolvedValue(versionInfo);
                    mockLayerManager.findExistingLayer.mockResolvedValue(layerInfo);

                    const result = await ensureNodeRuntimeLayer(options);

                    // Verify function executes successfully
                    expect(result).toBeDefined();
                    expect(result.runtimeName).toBe(runtime);
                    expect(result.architecture).toBe(arch);

                    // Verify components were initialized with correct parameters
                    if (awsConfig) {
                        expect(MockedAWSLayerManager).toHaveBeenCalledWith({
                            awsSdkConfig: awsConfig,
                            logger: expect.any(Object),
                        });
                    }

                    if (logger) {
                        expect(MockedDockerRuntimeDetector).toHaveBeenCalledWith({ logger });
                        expect(MockedAWSLayerManager).toHaveBeenCalledWith({
                            awsSdkConfig: awsConfig,
                            logger,
                        });
                    }
                }
            ),
            { numRuns: 10 }
        );
    });

    /**
     * Property 4: Layer Idempotency
     * For any identical set of layer requirements (runtime, architecture, region, account), 
     * multiple calls to ensureNodeRuntimeLayer should return the same Layer ARN without 
     * creating duplicate layers
     * **Validates: Requirements 2.2, 9.1**
     */
    it('Property 4: Layer Idempotency', async () => {
        await fc.assert(
            fc.asyncProperty(
                validOptionsArb,
                nodeVersionInfoArb,
                layerInfoArb,
                async (options, versionInfo, existingLayer) => {
                    // Reset mocks for this property test iteration
                    jest.clearAllMocks();

                    // Test scenario 1: Existing compatible layer found
                    // Setup mocks to simulate finding an existing compatible layer
                    mockRuntimeDetector.detectNodeVersion.mockResolvedValue(versionInfo);
                    mockLayerManager.findExistingLayer.mockResolvedValue(existingLayer);

                    // Make multiple identical calls
                    const result1 = await ensureNodeRuntimeLayer(options);
                    const result2 = await ensureNodeRuntimeLayer(options);
                    const result3 = await ensureNodeRuntimeLayer(options);

                    // Verify all results are identical (idempotency)
                    expect(result1.layerArn).toBe(result2.layerArn);
                    expect(result1.layerArn).toBe(result3.layerArn);
                    expect(result1.layerName).toBe(result2.layerName);
                    expect(result1.layerName).toBe(result3.layerName);
                    expect(result1.runtimeName).toBe(result2.runtimeName);
                    expect(result1.runtimeName).toBe(result3.runtimeName);
                    expect(result1.nodeVersion).toBe(result2.nodeVersion);
                    expect(result1.nodeVersion).toBe(result3.nodeVersion);
                    expect(result1.architecture).toBe(result2.architecture);
                    expect(result1.architecture).toBe(result3.architecture);
                    expect(result1.created).toBe(result2.created);
                    expect(result1.created).toBe(result3.created);

                    // Verify existing layer was reused (created should be false)
                    expect(result1.created).toBe(false);
                    expect(result2.created).toBe(false);
                    expect(result3.created).toBe(false);

                    // Verify layer creation was never called since existing layer was found
                    expect(mockLayerManager.createNodeLayer).not.toHaveBeenCalled();

                    // Verify runtime detection was called for each invocation
                    expect(mockRuntimeDetector.detectNodeVersion).toHaveBeenCalledTimes(3);
                    expect(mockRuntimeDetector.detectNodeVersion).toHaveBeenCalledWith(
                        options.runtimeName,
                        options.architecture
                    );

                    // Verify layer search was called for each invocation
                    expect(mockLayerManager.findExistingLayer).toHaveBeenCalledTimes(3);
                    const expectedLayerName = `lambda-kata-nodejs-${options.runtimeName}-${options.architecture}`;
                    expect(mockLayerManager.findExistingLayer).toHaveBeenCalledWith({
                        layerName: expectedLayerName,
                        requirements: {
                            nodeVersion: versionInfo.version,
                            architecture: options.architecture,
                        },
                    });
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 4b: Layer Idempotency - New Layer Creation Scenario
     * When no existing compatible layer is found, the first call should create a new layer,
     * and subsequent calls should find and reuse that layer
     * **Validates: Requirements 2.2, 9.1**
     */
    it('Property 4b: Layer Idempotency - New Layer Creation Scenario', async () => {
        await fc.assert(
            fc.asyncProperty(
                validOptionsArb,
                nodeVersionInfoArb,
                async (options, versionInfo) => {
                    // Reset mocks for this property test iteration
                    jest.clearAllMocks();

                    // Create a new layer that would be created
                    const newLayer: LayerInfo = {
                        arn: `arn:aws:lambda:${options.region}:${options.accountId}:layer:lambda-kata-nodejs-${options.runtimeName}-${options.architecture}:1`,
                        name: `lambda-kata-nodejs-${options.runtimeName}-${options.architecture}`,
                        version: 1,
                        nodeVersion: versionInfo.version,
                        architecture: options.architecture,
                        createdDate: new Date(),
                    };

                    // Setup mocks for scenario where no existing layer is found initially
                    mockRuntimeDetector.detectNodeVersion.mockResolvedValue(versionInfo);

                    // First call: no existing layer found, create new one
                    mockLayerManager.findExistingLayer
                        .mockResolvedValueOnce(null)  // First call: no existing layer
                        .mockResolvedValue(newLayer); // Subsequent calls: find the created layer

                    mockLayerManager.createNodeLayer.mockResolvedValue(newLayer);

                    // Make multiple calls
                    const result1 = await ensureNodeRuntimeLayer(options);
                    const result2 = await ensureNodeRuntimeLayer(options);
                    const result3 = await ensureNodeRuntimeLayer(options);

                    // Verify all results have the same Layer ARN (idempotency)
                    expect(result1.layerArn).toBe(result2.layerArn);
                    expect(result1.layerArn).toBe(result3.layerArn);
                    expect(result1.layerName).toBe(result2.layerName);
                    expect(result1.layerName).toBe(result3.layerName);

                    // Verify first call created the layer, subsequent calls reused it
                    expect(result1.created).toBe(true);   // First call created new layer
                    expect(result2.created).toBe(false);  // Second call found existing layer
                    expect(result3.created).toBe(false);  // Third call found existing layer

                    // Verify layer creation was called only once
                    expect(mockLayerManager.createNodeLayer).toHaveBeenCalledTimes(1);
                    expect(mockLayerManager.createNodeLayer).toHaveBeenCalledWith({
                        layerName: `lambda-kata-nodejs-${options.runtimeName}-${options.architecture}`,
                        nodeVersion: versionInfo.version,
                        architecture: options.architecture,
                        region: options.region,
                        description: `Node.js ${versionInfo.version} runtime binary for Lambda Kata (${options.architecture})`,
                    });

                    // Verify layer search was called for each invocation
                    expect(mockLayerManager.findExistingLayer).toHaveBeenCalledTimes(3);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Input Validation Consistency
     * For any invalid input, the function should consistently throw NodeRuntimeLayerError
     * with appropriate error codes
     */
    it('Property: Input Validation Consistency', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.oneof(
                    // Invalid runtime names
                    fc.record({
                        runtimeName: fc.oneof(
                            fc.constant('nodejs16.x'),
                            fc.constant('python3.9'),
                            fc.constant('invalid-runtime')
                        ),
                        architecture: validArchitectureArb,
                        region: validRegionArb,
                        accountId: validAccountIdArb,
                    }),
                    // Invalid architectures
                    fc.record({
                        runtimeName: validRuntimeArb,
                        architecture: fc.oneof(
                            fc.constant('invalid-arch'),
                            fc.constant('x86'),
                            fc.constant('aarch64')
                        ).map(s => s as any),
                        region: validRegionArb,
                        accountId: validAccountIdArb,
                    }),
                    // Invalid account IDs
                    fc.record({
                        runtimeName: validRuntimeArb,
                        architecture: validArchitectureArb,
                        region: validRegionArb,
                        accountId: fc.oneof(
                            fc.constant('12345'),
                            fc.constant('1234567890123'),
                            fc.constant('invalid-account')
                        ),
                    }),
                    // Invalid regions
                    fc.record({
                        runtimeName: validRuntimeArb,
                        architecture: validArchitectureArb,
                        region: fc.oneof(
                            fc.constant('INVALID_REGION!'),
                            fc.constant(''),
                            fc.constant('us-east-1!')
                        ),
                        accountId: validAccountIdArb,
                    })
                ),
                async (invalidOptions) => {
                    await expect(ensureNodeRuntimeLayer(invalidOptions))
                        .rejects
                        .toThrow(NodeRuntimeLayerError);
                }
            ),
            { numRuns: 10 }
        );
    });

    /**
     * Property: Layer Name Generation Consistency
     * For any valid runtime and architecture combination, the generated layer name
     * should follow the exact pattern and be deterministic
     */
    it('Property: Layer Name Generation Consistency', async () => {
        await fc.assert(
            fc.asyncProperty(
                validRuntimeArb,
                validArchitectureArb,
                validRegionArb,
                validAccountIdArb,
                nodeVersionInfoArb,
                layerInfoArb,
                async (runtime, arch, region, accountId, versionInfo, layerInfo) => {
                    const options: EnsureNodeRuntimeLayerOptions = {
                        runtimeName: runtime,
                        architecture: arch,
                        region,
                        accountId,
                    };

                    // Setup mocks
                    mockRuntimeDetector.detectNodeVersion.mockResolvedValue(versionInfo);
                    mockLayerManager.findExistingLayer.mockResolvedValue(layerInfo);

                    await ensureNodeRuntimeLayer(options);

                    // Verify layer name follows the expected pattern
                    const expectedLayerName = `lambda-kata-nodejs-${runtime}-${arch}`;

                    expect(mockLayerManager.findExistingLayer).toHaveBeenCalledWith({
                        layerName: expectedLayerName,
                        requirements: expect.any(Object),
                    });
                }
            ),
            { numRuns: 10 }
        );
    });
});

// Feature: nodejs-layer-management, Property 7: API Contract Compliance
// Feature: nodejs-layer-management, Property 8: Optional Parameter Handling  
// Feature: nodejs-layer-management, Property 4: Layer Idempotency
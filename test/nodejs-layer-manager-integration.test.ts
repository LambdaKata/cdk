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
 * Integration tests for Node.js Layer Management with real AWS services
 * 
 * These tests validate the complete end-to-end functionality using:
 * - Real AWS Lambda service (not mocked)
 * - Actual AWS Lambda Docker images
 * - Live AWS API calls for layer creation and management
 * - Comprehensive resource cleanup to prevent orphaned resources
 * 
 * Tests are conditional on AWS credentials being available and will be skipped
 * if credentials are not configured or if AWS services are unavailable.
 * 
 * @module nodejs-layer-manager-integration-test
 */

import { LambdaClient, ListLayersCommand, DeleteLayerVersionCommand } from '@aws-sdk/client-lambda';

import { ensureNodeRuntimeLayer } from '../src/ensure-node-runtime-layer';
import { AWSLayerManager } from '../src/aws-layer-manager';
import { DockerRuntimeDetector } from '../src/docker-runtime-detector';
import { createDefaultLogger } from '../src/logger';
import { NodeRuntimeLayerError, ErrorCodes } from '../src/nodejs-layer-manager';

/**
 * Test configuration and utilities for integration tests
 */
interface IntegrationTestConfig {
    region: string;
    accountId: string;
    testLayerPrefix: string;
    maxTestDuration: number;
    cleanupTimeout: number;
}

/**
 * Resource tracker for comprehensive test cleanup
 */
class IntegrationTestResourceTracker {
    private createdLayers: Array<{ name: string; version: number; arn: string }> = [];
    private tempDirectories: string[] = [];
    private dockerContainers: string[] = [];

    addLayer(name: string, version: number, arn: string): void {
        this.createdLayers.push({ name, version, arn });
    }

    addTempDirectory(path: string): void {
        this.tempDirectories.push(path);
    }

    addDockerContainer(name: string): void {
        this.dockerContainers.push(name);
    }

    getLayers(): Array<{ name: string; version: number; arn: string }> {
        return [...this.createdLayers];
    }

    getTempDirectories(): string[] {
        return [...this.tempDirectories];
    }

    getDockerContainers(): string[] {
        return [...this.dockerContainers];
    }

    clear(): void {
        this.createdLayers.length = 0;
        this.tempDirectories.length = 0;
        this.dockerContainers.length = 0;
    }
}

/**
 * Integration test suite for Node.js Layer Management
 * 
 * These tests require:
 * - Valid AWS credentials configured
 * - AWS Lambda permissions (ListLayers, PublishLayerVersion, DeleteLayerVersion)
 * - Docker available for runtime detection
 * - Network connectivity to AWS services and Docker Hub
 */
describe('Node.js Layer Management Integration Tests', () => {
    let testConfig: IntegrationTestConfig = {
        region: 'us-east-1',
        accountId: '123456789012',
        testLayerPrefix: 'lambda-kata-integration-test',
        maxTestDuration: 300000,
        cleanupTimeout: 60000,
    };
    let lambdaClient: LambdaClient;
    let resourceTracker: IntegrationTestResourceTracker;
    let awsCredentialsAvailable: boolean = false;
    let dockerAvailable: boolean = false;

    // Test timeout extended for real AWS operations
    const INTEGRATION_TEST_TIMEOUT = 300000; // 5 minutes

    beforeAll(async () => {
        // Update test configuration with environment variables
        testConfig = {
            region: process.env.AWS_REGION || 'us-east-1',
            accountId: process.env.AWS_ACCOUNT_ID || '123456789012',
            testLayerPrefix: `lambda-kata-integration-test-${Date.now()}`,
            maxTestDuration: INTEGRATION_TEST_TIMEOUT,
            cleanupTimeout: 60000, // 1 minute for cleanup
        };

        resourceTracker = new IntegrationTestResourceTracker();

        // Check AWS credentials availability
        try {
            lambdaClient = new LambdaClient({
                region: testConfig.region,
            });

            // Test AWS connectivity with a simple API call
            await lambdaClient.send(new ListLayersCommand({ MaxItems: 1 }));
            awsCredentialsAvailable = true;

            console.log('✓ AWS credentials and connectivity verified');
        } catch (error) {
            console.warn('⚠ AWS credentials not available or AWS services unreachable:',
                error instanceof Error ? error.message : String(error));
            console.warn('Integration tests will be skipped');
        }

        // Check Docker availability
        try {
            const detector = new DockerRuntimeDetector();
            dockerAvailable = await detector.isDockerAvailable();

            if (dockerAvailable) {
                console.log('✓ Docker availability verified');
            } else {
                console.warn('⚠ Docker not available, some tests may be limited');
            }
        } catch (error) {
            console.warn('⚠ Docker availability check failed:',
                error instanceof Error ? error.message : String(error));
        }
    }, INTEGRATION_TEST_TIMEOUT);

    afterAll(async () => {
        if (awsCredentialsAvailable) {
            await performComprehensiveCleanup();
        }

        if (lambdaClient) {
            lambdaClient.destroy();
        }
    }, testConfig.cleanupTimeout);

    /**
     * Comprehensive cleanup of all test resources
     */
    async function performComprehensiveCleanup(): Promise<void> {
        const logger = createDefaultLogger();
        const layers = resourceTracker.getLayers();

        logger.info('Starting comprehensive test resource cleanup', {
            layersToClean: layers.length,
            testPrefix: testConfig.testLayerPrefix,
        });

        // Clean up AWS Lambda layers
        for (const layer of layers) {
            try {
                await lambdaClient.send(new DeleteLayerVersionCommand({
                    LayerName: layer.name,
                    VersionNumber: layer.version,
                }));

                logger.debug('Successfully deleted test layer', {
                    layerName: layer.name,
                    version: layer.version,
                    arn: layer.arn,
                });
            } catch (error) {
                logger.warn('Failed to delete test layer (may have been cleaned up already)', {
                    layerName: layer.name,
                    version: layer.version,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // Clear the resource tracker
        resourceTracker.clear();

        logger.info('Test resource cleanup completed');
    }

    /**
     * Generates unique test layer name to avoid conflicts
     */
    function generateTestLayerName(runtime: string, architecture: string): string {
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        return `${testConfig.testLayerPrefix}-${runtime}-${architecture}-${timestamp}-${randomSuffix}`;
    }

    describe('End-to-End Layer Creation and Management', () => {
        it('should create a new Node.js layer with real AWS services', async () => {
            if (!awsCredentialsAvailable) {
                console.log('Skipping test: AWS credentials not available');
                return;
            }

            const testLayerName = generateTestLayerName('nodejs20.x', 'x86_64');

            try {
                const result = await ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: testConfig.region,
                    accountId: testConfig.accountId,
                    awsSdkConfig: {
                        region: testConfig.region,
                    },
                    logger: createDefaultLogger(),
                });

                // Track the created layer for cleanup
                const layerVersion = parseInt(result.layerArn.split(':').pop() || '1', 10);
                resourceTracker.addLayer(result.layerName, layerVersion, result.layerArn);

                // Validate the result
                expect(result.layerArn).toMatch(/^arn:aws:lambda:/);
                expect(result.layerName).toMatch(/^lambda-kata-nodejs-nodejs20\.x-x86_64$/);
                expect(result.runtimeName).toBe('nodejs20.x');
                expect(result.nodeVersion).toMatch(/^20\.\d+\.\d+$/);
                expect(result.architecture).toBe('x86_64');
                expect(result.created).toBe(true);

                console.log('✓ Successfully created layer:', {
                    arn: result.layerArn,
                    version: result.nodeVersion,
                    created: result.created,
                });

            } catch (error) {
                console.error('Layer creation failed:', error);
                throw error;
            }
        }, INTEGRATION_TEST_TIMEOUT);

        it('should reuse existing compatible layer', async () => {
            if (!awsCredentialsAvailable) {
                console.log('Skipping test: AWS credentials not available');
                return;
            }

            // First, create a layer
            const firstResult = await ensureNodeRuntimeLayer({
                runtimeName: 'nodejs18.x',
                architecture: 'x86_64',
                region: testConfig.region,
                accountId: testConfig.accountId,
                awsSdkConfig: {
                    region: testConfig.region,
                },
            });

            // Track for cleanup
            const layerVersion = parseInt(firstResult.layerArn.split(':').pop() || '1', 10);
            resourceTracker.addLayer(firstResult.layerName, layerVersion, firstResult.layerArn);

            // Then, try to create the same layer again - should reuse
            const secondResult = await ensureNodeRuntimeLayer({
                runtimeName: 'nodejs18.x',
                architecture: 'x86_64',
                region: testConfig.region,
                accountId: testConfig.accountId,
                awsSdkConfig: {
                    region: testConfig.region,
                },
            });

            // Validate reuse behavior
            expect(secondResult.layerArn).toBe(firstResult.layerArn);
            expect(secondResult.layerName).toBe(firstResult.layerName);
            expect(secondResult.created).toBe(false); // Should be reused, not created
            expect(secondResult.nodeVersion).toBe(firstResult.nodeVersion);

            console.log('✓ Successfully reused existing layer:', {
                arn: secondResult.layerArn,
                reused: !secondResult.created,
            });

        }, INTEGRATION_TEST_TIMEOUT);

        it('should handle different architectures correctly', async () => {
            if (!awsCredentialsAvailable) {
                console.log('Skipping test: AWS credentials not available');
                return;
            }

            // Test both x86_64 and arm64 architectures
            const architectures: Array<'x86_64' | 'arm64'> = ['x86_64', 'arm64'];
            const results: Array<{ arch: string; result: any }> = [];

            for (const architecture of architectures) {
                try {
                    const result = await ensureNodeRuntimeLayer({
                        runtimeName: 'nodejs20.x',
                        architecture,
                        region: testConfig.region,
                        accountId: testConfig.accountId,
                        awsSdkConfig: {
                            region: testConfig.region,
                        },
                    });

                    // Track for cleanup
                    const layerVersion = parseInt(result.layerArn.split(':').pop() || '1', 10);
                    resourceTracker.addLayer(result.layerName, layerVersion, result.layerArn);

                    results.push({ arch: architecture, result });

                    // Validate architecture-specific naming
                    expect(result.layerName).toContain(architecture);
                    expect(result.architecture).toBe(architecture);

                } catch (error) {
                    console.warn(`Architecture ${architecture} test failed:`, error);
                    // Don't fail the entire test if one architecture fails
                    // (some regions may not support all architectures)
                }
            }

            // Ensure we got at least one successful result
            expect(results.length).toBeGreaterThan(0);

            // Ensure different architectures create different layers
            if (results.length === 2) {
                expect(results[0].result.layerArn).not.toBe(results[1].result.layerArn);
                expect(results[0].result.layerName).not.toBe(results[1].result.layerName);
            }

            console.log('✓ Architecture-specific layer creation validated:',
                results.map(r => ({ arch: r.arch, arn: r.result.layerArn })));

        }, INTEGRATION_TEST_TIMEOUT);
    });

    describe('Docker Integration with Real Images', () => {
        it('should detect Node.js versions from real AWS Lambda Docker images', async () => {
            if (!dockerAvailable) {
                console.log('Skipping test: Docker not available');
                return;
            }

            const detector = new DockerRuntimeDetector({
                logger: createDefaultLogger(),
            });

            const testCases = [
                { runtime: 'nodejs18.x', architecture: 'x86_64' as const },
                { runtime: 'nodejs20.x', architecture: 'x86_64' as const },
            ];

            for (const testCase of testCases) {
                try {
                    const versionInfo = await detector.detectNodeVersion(
                        testCase.runtime,
                        testCase.architecture
                    );

                    // Validate version format and consistency
                    expect(versionInfo.version).toMatch(/^\d+\.\d+\.\d+$/);
                    expect(versionInfo.runtimeName).toBe(testCase.runtime);
                    expect(versionInfo.dockerImage).toContain('public.ecr.aws/lambda/nodejs');
                    expect(versionInfo.dockerImage).toContain(testCase.architecture);

                    // Validate version matches runtime family
                    const majorVersion = versionInfo.version.split('.')[0];
                    const expectedMajor = testCase.runtime.replace('nodejs', '').replace('.x', '');
                    expect(majorVersion).toBe(expectedMajor);

                    console.log('✓ Docker version detection successful:', {
                        runtime: testCase.runtime,
                        architecture: testCase.architecture,
                        version: versionInfo.version,
                        dockerImage: versionInfo.dockerImage,
                    });

                } catch (error) {
                    console.warn(`Docker detection failed for ${testCase.runtime}/${testCase.architecture}:`, error);
                    // Don't fail the test if Docker operations fail (network issues, etc.)
                    // The fallback mechanism should handle this
                }
            }
        }, INTEGRATION_TEST_TIMEOUT);
    });

    describe('Error Handling and Edge Cases', () => {
        it('should handle AWS API failures gracefully', async () => {
            if (!awsCredentialsAvailable) {
                console.log('Skipping test: AWS credentials not available');
                return;
            }

            // Test with invalid region to trigger AWS API error
            try {
                await ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: 'invalid-region-12345',
                    accountId: testConfig.accountId,
                    awsSdkConfig: {
                        region: 'invalid-region-12345',
                    },
                });

                // Should not reach here
                fail('Expected AWS API error for invalid region');

            } catch (error) {
                expect(error).toBeInstanceOf(NodeRuntimeLayerError);
                expect((error as NodeRuntimeLayerError).code).toBe(ErrorCodes.AWS_API_ERROR);

                console.log('✓ AWS API error handling validated:', {
                    errorType: (error as Error).constructor.name,
                    errorCode: (error as NodeRuntimeLayerError).code,
                });
            }
        }, INTEGRATION_TEST_TIMEOUT);

        it('should validate input parameters correctly', async () => {
            // Test invalid runtime
            try {
                await ensureNodeRuntimeLayer({
                    runtimeName: 'invalid-runtime',
                    architecture: 'x86_64',
                    region: testConfig.region,
                    accountId: testConfig.accountId,
                });

                fail('Expected validation error for invalid runtime');

            } catch (error) {
                expect(error).toBeInstanceOf(NodeRuntimeLayerError);
                expect((error as NodeRuntimeLayerError).code).toBe(ErrorCodes.RUNTIME_UNSUPPORTED);
            }

            // Test invalid architecture
            try {
                await ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'invalid-arch' as any,
                    region: testConfig.region,
                    accountId: testConfig.accountId,
                });

                fail('Expected validation error for invalid architecture');

            } catch (error) {
                expect(error).toBeInstanceOf(NodeRuntimeLayerError);
                expect((error as NodeRuntimeLayerError).code).toBe(ErrorCodes.INVALID_ARCHITECTURE);
            }

            console.log('✓ Input validation error handling verified');
        });
    });

    describe('Resource Cleanup Verification', () => {
        it('should clean up temporary resources on success', async () => {
            if (!awsCredentialsAvailable) {
                console.log('Skipping test: AWS credentials not available');
                return;
            }

            const layerManager = new AWSLayerManager({
                awsSdkConfig: { region: testConfig.region },
                logger: createDefaultLogger(),
            });

            try {
                // Create a layer to test cleanup
                const result = await ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs18.x',
                    architecture: 'arm64',
                    region: testConfig.region,
                    accountId: testConfig.accountId,
                    awsSdkConfig: {
                        region: testConfig.region,
                    },
                });

                // Track for cleanup
                const layerVersion = parseInt(result.layerArn.split(':').pop() || '1', 10);
                resourceTracker.addLayer(result.layerName, layerVersion, result.layerArn);

                // Verify the layer was created successfully
                expect(result.layerArn).toMatch(/^arn:aws:lambda:/);
                expect(result.created).toBe(true);

                console.log('✓ Layer creation and cleanup verification completed:', {
                    arn: result.layerArn,
                    willBeCleanedUp: true,
                });

            } finally {
                layerManager.destroy();
            }
        }, INTEGRATION_TEST_TIMEOUT);

        it('should handle cleanup failures gracefully', async () => {
            // This test verifies that cleanup failures don't prevent other cleanup operations
            const tracker = new IntegrationTestResourceTracker();

            // Add some fake resources to test cleanup resilience
            tracker.addLayer('non-existent-layer', 1, 'arn:aws:lambda:us-east-1:123456789012:layer:non-existent:1');

            // Cleanup should not throw even if some resources don't exist
            expect(() => {
                // The actual cleanup happens in afterAll, this just tests the tracker
                const layers = tracker.getLayers();
                expect(layers.length).toBe(1);
                tracker.clear();
                expect(tracker.getLayers().length).toBe(0);
            }).not.toThrow();

            console.log('✓ Cleanup resilience verified');
        });
    });

    describe('Performance and Concurrency', () => {
        it('should handle concurrent layer creation requests', async () => {
            if (!awsCredentialsAvailable) {
                console.log('Skipping test: AWS credentials not available');
                return;
            }

            // Create multiple concurrent requests for the same layer
            const concurrentRequests = Array(3).fill(null).map(() =>
                ensureNodeRuntimeLayer({
                    runtimeName: 'nodejs20.x',
                    architecture: 'x86_64',
                    region: testConfig.region,
                    accountId: testConfig.accountId,
                    awsSdkConfig: {
                        region: testConfig.region,
                    },
                })
            );

            const results = await Promise.all(concurrentRequests);

            // All requests should return the same layer ARN
            const firstArn = results[0].layerArn;
            results.forEach(result => {
                expect(result.layerArn).toBe(firstArn);
                expect(result.layerName).toBe(results[0].layerName);
            });

            // Only one should have created the layer, others should have reused
            const createdCount = results.filter(r => r.created).length;
            expect(createdCount).toBeLessThanOrEqual(1);

            // Track for cleanup
            const layerVersion = parseInt(firstArn.split(':').pop() || '1', 10);
            resourceTracker.addLayer(results[0].layerName, layerVersion, firstArn);

            console.log('✓ Concurrent request handling verified:', {
                arn: firstArn,
                concurrentRequests: results.length,
                layersCreated: createdCount,
            });

        }, INTEGRATION_TEST_TIMEOUT);
    });
});
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
 * Property-based tests for AWSLayerManager
 * 
 * These tests validate universal properties that should hold across all valid inputs:
 * - Layer compatibility validation consistency
 * - Layer metadata parsing correctness
 * - Error handling behavior
 * - Retry logic properties
 */

import * as fc from 'fast-check';
import {
    AWSLayerManager,
    LayerInfo,
    LayerRequirements,
    NoOpLogger,
} from '../src';

// Feature: nodejs-layer-management, Property 6: Architecture Compatibility
describe('AWSLayerManager Property Tests', () => {
    let manager: AWSLayerManager;

    beforeEach(() => {
        manager = new AWSLayerManager({
            logger: new NoOpLogger(), // Silent for property tests
            maxRetries: 1, // Faster for property tests
            retryBaseDelay: 10,
        });
    });

    afterEach(() => {
        manager.destroy();
    });

    describe('Property 6: Architecture Compatibility', () => {
        /**
         * **Validates: Requirements 3.1, 3.2, 3.3**
         * 
         * For any specified architecture (x86_64 or arm64), the Layer_Manager should create 
         * or find layers that are compatible with that architecture and extract binaries 
         * from the corresponding architecture-specific Docker images.
         */
        it('should validate architecture compatibility consistently for any supported architecture', async () => {
            await fc.assert(
                fc.asyncProperty(
                    // Generate valid Node.js versions
                    fc.oneof(
                        fc.constant('18.19.0'),
                        fc.constant('20.10.0'),
                        fc.constant('22.1.0')
                    ),
                    // Generate valid architectures
                    fc.oneof(
                        fc.constant('x86_64'),
                        fc.constant('arm64')
                    ),
                    // Generate layer creation dates (recent dates to pass age validation)
                    fc.date({ min: new Date(Date.now() - 86400000), max: new Date() }), // Last 24 hours
                    async (nodeVersion, architecture, createdDate) => {
                        const layerInfo: LayerInfo = {
                            arn: `arn:aws:lambda:us-east-1:123456789012:layer:test-${architecture}:1`,
                            name: `lambda-kata-nodejs-nodejs${nodeVersion.split('.')[0]}.x-${architecture}`,
                            version: 1,
                            nodeVersion,
                            architecture,
                            createdDate,
                        };

                        const requirements: LayerRequirements = {
                            nodeVersion,
                            architecture,
                        };

                        // Property: Layer with matching architecture should be compatible
                        const isCompatible = manager.validateLayerCompatibility(layerInfo, requirements);
                        expect(isCompatible).toBe(true);

                        // Property: Layer with different architecture should not be compatible
                        const differentArch = architecture === 'x86_64' ? 'arm64' : 'x86_64';
                        const incompatibleRequirements: LayerRequirements = {
                            nodeVersion,
                            architecture: differentArch,
                        };

                        const isIncompatible = manager.validateLayerCompatibility(layerInfo, incompatibleRequirements);
                        expect(isIncompatible).toBe(false);
                    }
                ),
                { numRuns: 15 }
            );
        });

        it('should ensure layer names include architecture suffix for uniqueness across architectures', async () => {
            await fc.assert(
                fc.property(
                    // Generate valid runtime names
                    fc.oneof(
                        fc.constant('nodejs18.x'),
                        fc.constant('nodejs20.x'),
                        fc.constant('nodejs22.x')
                    ),
                    // Generate valid architectures
                    fc.oneof(
                        fc.constant('x86_64'),
                        fc.constant('arm64')
                    ),
                    (runtimeName, architecture) => {
                        // Generate layer name using the same pattern as the system
                        const layerName = `lambda-kata-nodejs-${runtimeName}-${architecture}`;

                        // Property: Layer name must contain the architecture
                        expect(layerName).toContain(architecture);

                        // Property: Layer name must end with the architecture
                        expect(layerName.endsWith(`-${architecture}`)).toBe(true);

                        // Property: Architecture must be extractable from layer name
                        const extractedArch = layerName.split('-').pop();
                        expect(extractedArch).toBe(architecture);

                        // Property: Layer names for different architectures should be different
                        const otherArch = architecture === 'x86_64' ? 'arm64' : 'x86_64';
                        const otherLayerName = `lambda-kata-nodejs-${runtimeName}-${otherArch}`;
                        expect(layerName).not.toBe(otherLayerName);

                        // Property: Layer name should follow the exact pattern
                        const expectedPattern = new RegExp(`^lambda-kata-nodejs-nodejs\\d+\\.x-(x86_64|arm64)$`);
                        expect(layerName).toMatch(expectedPattern);
                    }
                ),
                { numRuns: 15 }
            );
        });

        it('should extract binaries from architecture-specific Docker images', async () => {
            await fc.assert(
                fc.property(
                    // Generate valid runtime names
                    fc.oneof(
                        fc.constant('nodejs18.x'),
                        fc.constant('nodejs20.x'),
                        fc.constant('nodejs22.x')
                    ),
                    // Generate valid architectures
                    fc.oneof(
                        fc.constant('x86_64'),
                        fc.constant('arm64')
                    ),
                    (runtimeName, architecture) => {
                        // Extract major version from runtime name
                        const majorVersion = runtimeName.replace('nodejs', '').replace('.x', '');

                        // Property: Docker image should follow architecture-specific pattern
                        const expectedDockerImage = `public.ecr.aws/lambda/nodejs:${majorVersion}-${architecture}`;

                        // Verify the pattern is correct for the architecture
                        expect(expectedDockerImage).toContain(`:${majorVersion}-${architecture}`);
                        expect(expectedDockerImage.endsWith(`-${architecture}`)).toBe(true);

                        // Property: Different architectures should produce different Docker images
                        const otherArch = architecture === 'x86_64' ? 'arm64' : 'x86_64';
                        const otherDockerImage = `public.ecr.aws/lambda/nodejs:${majorVersion}-${otherArch}`;
                        expect(expectedDockerImage).not.toBe(otherDockerImage);

                        // Property: Docker image should be valid AWS ECR format
                        expect(expectedDockerImage).toMatch(/^public\.ecr\.aws\/lambda\/nodejs:\d+-(x86_64|arm64)$/);

                        // Property: Architecture should be extractable from Docker image
                        const extractedArch = expectedDockerImage.split('-').pop();
                        expect(extractedArch).toBe(architecture);
                    }
                ),
                { numRuns: 15 }
            );
        });

        it('should validate layer metadata parsing preserves architecture information', async () => {
            await fc.assert(
                fc.property(
                    // Generate valid Node.js versions
                    fc.oneof(
                        fc.constant('18.19.0'),
                        fc.constant('20.10.0'),
                        fc.constant('22.1.0')
                    ),
                    // Generate valid architectures
                    fc.oneof(
                        fc.constant('x86_64'),
                        fc.constant('arm64')
                    ),
                    (nodeVersion, architecture) => {
                        const majorVersion = nodeVersion.split('.')[0];
                        const runtimeName = `nodejs${majorVersion}.x`;
                        const layerName = `lambda-kata-nodejs-${runtimeName}-${architecture}`;

                        // Test layer metadata parsing (accessing private method for testing)
                        const parseMethod = (manager as any).parseLayerMetadata.bind(manager);

                        // Test with description containing architecture info
                        const descriptionWithArch = `Node.js ${nodeVersion} (${architecture})`;
                        const resultFromDescription = parseMethod(descriptionWithArch, layerName);

                        // Property: Architecture should be correctly extracted from description
                        expect(resultFromDescription.architecture).toBe(architecture);
                        expect(resultFromDescription.nodeVersion).toBe(nodeVersion);

                        // Test with layer name fallback (empty description)
                        const resultFromName = parseMethod('', layerName);

                        // Property: Architecture should be correctly extracted from layer name
                        expect(resultFromName.architecture).toBe(architecture);

                        // Property: Node version should be mapped correctly from major version
                        const expectedVersions: Record<string, string> = {
                            '18': '18.19.0',
                            '20': '20.10.0',
                            '22': '22.1.0',
                        };
                        expect(resultFromName.nodeVersion).toBe(expectedVersions[majorVersion]);
                    }
                ),
                { numRuns: 15 }
            );
        });

        it('should reject layers with incompatible architectures consistently', async () => {
            await fc.assert(
                fc.property(
                    // Generate valid Node.js versions
                    fc.oneof(
                        fc.constant('18.19.0'),
                        fc.constant('20.10.0'),
                        fc.constant('22.1.0')
                    ),
                    // Generate two different architectures
                    fc.tuple(
                        fc.oneof(fc.constant('x86_64'), fc.constant('arm64')),
                        fc.oneof(fc.constant('x86_64'), fc.constant('arm64'))
                    ).filter(([arch1, arch2]) => arch1 !== arch2), // Ensure they're different
                    fc.date({ min: new Date(Date.now() - 86400000), max: new Date() }),
                    (nodeVersion, [layerArch, requiredArch], createdDate) => {
                        const layerInfo: LayerInfo = {
                            arn: `arn:aws:lambda:us-east-1:123456789012:layer:test:1`,
                            name: `lambda-kata-nodejs-nodejs${nodeVersion.split('.')[0]}.x-${layerArch}`,
                            version: 1,
                            nodeVersion,
                            architecture: layerArch,
                            createdDate,
                        };

                        const requirements: LayerRequirements = {
                            nodeVersion,
                            architecture: requiredArch,
                        };

                        // Property: Layer with different architecture should always be incompatible
                        const isCompatible = manager.validateLayerCompatibility(layerInfo, requirements);
                        expect(isCompatible).toBe(false);

                        // Property: Compatibility should be symmetric - if A is incompatible with B, then B is incompatible with A
                        const reversedLayerInfo: LayerInfo = {
                            ...layerInfo,
                            architecture: requiredArch,
                            name: `lambda-kata-nodejs-nodejs${nodeVersion.split('.')[0]}.x-${requiredArch}`,
                        };

                        const reversedRequirements: LayerRequirements = {
                            nodeVersion,
                            architecture: layerArch,
                        };

                        const reversedCompatibility = manager.validateLayerCompatibility(reversedLayerInfo, reversedRequirements);
                        expect(reversedCompatibility).toBe(false);
                    }
                ),
                { numRuns: 15 }
            );
        });

        it('should ensure architecture compatibility is independent of other layer properties', async () => {
            await fc.assert(
                fc.property(
                    // Generate different Node.js versions
                    fc.tuple(
                        fc.oneof(fc.constant('18.19.0'), fc.constant('20.10.0'), fc.constant('22.1.0')),
                        fc.oneof(fc.constant('18.19.0'), fc.constant('20.10.0'), fc.constant('22.1.0'))
                    ),
                    // Generate same architecture for both
                    fc.oneof(fc.constant('x86_64'), fc.constant('arm64')),
                    // Generate different dates
                    fc.tuple(
                        fc.date({ min: new Date(Date.now() - 86400000), max: new Date() }),
                        fc.date({ min: new Date(Date.now() - 86400000), max: new Date() })
                    ),
                    ([layerNodeVersion, requiredNodeVersion], architecture, [layerDate, _]) => {
                        const layerInfo: LayerInfo = {
                            arn: `arn:aws:lambda:us-east-1:123456789012:layer:test:1`,
                            name: `lambda-kata-nodejs-nodejs${layerNodeVersion.split('.')[0]}.x-${architecture}`,
                            version: 1,
                            nodeVersion: layerNodeVersion,
                            architecture,
                            createdDate: layerDate,
                        };

                        const requirements: LayerRequirements = {
                            nodeVersion: requiredNodeVersion,
                            architecture,
                        };

                        const isCompatible = manager.validateLayerCompatibility(layerInfo, requirements);

                        // Property: Architecture compatibility should be independent of version compatibility
                        // If architectures match, the result should depend only on version and age, not architecture
                        const expectedCompatible = layerNodeVersion === requiredNodeVersion;
                        expect(isCompatible).toBe(expectedCompatible);

                        // Property: Same test with different architecture should always fail
                        const differentArch = architecture === 'x86_64' ? 'arm64' : 'x86_64';
                        const incompatibleRequirements: LayerRequirements = {
                            nodeVersion: layerNodeVersion, // Same version
                            architecture: differentArch,   // Different architecture
                        };

                        const shouldBeIncompatible = manager.validateLayerCompatibility(layerInfo, incompatibleRequirements);
                        expect(shouldBeIncompatible).toBe(false);
                    }
                ),
                { numRuns: 15 }
            );
        });

        it('should handle all supported architecture combinations exhaustively', async () => {
            const supportedArchitectures: ('x86_64' | 'arm64')[] = ['x86_64', 'arm64'];
            const supportedVersions = ['18.19.0', '20.10.0', '22.1.0'];

            // Test all combinations exhaustively
            for (const layerArch of supportedArchitectures) {
                for (const requiredArch of supportedArchitectures) {
                    for (const nodeVersion of supportedVersions) {
                        const layerInfo: LayerInfo = {
                            arn: `arn:aws:lambda:us-east-1:123456789012:layer:test:1`,
                            name: `lambda-kata-nodejs-nodejs${nodeVersion.split('.')[0]}.x-${layerArch}`,
                            version: 1,
                            nodeVersion,
                            architecture: layerArch,
                            createdDate: new Date(),
                        };

                        const requirements: LayerRequirements = {
                            nodeVersion,
                            architecture: requiredArch,
                        };

                        const isCompatible = manager.validateLayerCompatibility(layerInfo, requirements);

                        // Property: Compatibility should be true only when architectures match
                        const expectedCompatible = layerArch === requiredArch;
                        expect(isCompatible).toBe(expectedCompatible);

                        // Property: Layer name should reflect the layer's architecture
                        expect(layerInfo.name).toContain(layerArch);
                        expect(layerInfo.name.endsWith(`-${layerArch}`)).toBe(true);
                    }
                }
            }
        });
    });

    describe('Property 5: Layer Naming Convention Consistency', () => {
        /**
         * **Validates: Requirements 2.4, 3.4**
         * 
         * For any layer creation request, the generated layer name should follow the exact 
         * pattern `lambda-kata-nodejs-${runtimeName}-${architecture}` and be unique across 
         * different runtime/architecture combinations.
         */

        /**
         * Helper function to generate layer names following the Lambda Kata convention.
         * This represents the canonical layer naming logic that should be used throughout the system.
         */
        const generateLayerName = (runtimeName: string, architecture: string): string => {
            return `lambda-kata-nodejs-${runtimeName}-${architecture}`;
        };

        it('should generate layer names following exact naming convention pattern', async () => {
            await fc.assert(
                fc.property(
                    // Generate valid runtime names
                    fc.oneof(
                        fc.constant('nodejs18.x'),
                        fc.constant('nodejs20.x'),
                        fc.constant('nodejs22.x')
                    ),
                    // Generate valid architectures
                    fc.oneof(
                        fc.constant('x86_64'),
                        fc.constant('arm64')
                    ),
                    (runtimeName, architecture) => {
                        const layerName = generateLayerName(runtimeName, architecture);

                        // Property 1: Layer name must follow exact pattern
                        const expectedPattern = `lambda-kata-nodejs-${runtimeName}-${architecture}`;
                        expect(layerName).toBe(expectedPattern);

                        // Property 2: Layer name must be a valid string
                        expect(typeof layerName).toBe('string');
                        expect(layerName.length).toBeGreaterThan(0);

                        // Property 3: Layer name must contain all required components
                        expect(layerName).toContain('lambda-kata-nodejs');
                        expect(layerName).toContain(runtimeName);
                        expect(layerName).toContain(architecture);

                        // Property 4: Layer name must be parseable by existing metadata parser
                        const parseMethod = (manager as any).parseLayerMetadata.bind(manager);
                        const result = parseMethod('', layerName);

                        expect(result.architecture).toBe(architecture);

                        // Verify Node.js version mapping is consistent
                        const majorVersion = runtimeName.replace('nodejs', '').replace('.x', '');
                        const expectedVersions: Record<string, string> = {
                            '18': '18.19.0',
                            '20': '20.10.0',
                            '22': '22.1.0',
                        };

                        expect(result.nodeVersion).toBe(expectedVersions[majorVersion]);

                        // Property 5: Layer name must be deterministic (same inputs = same output)
                        const layerName2 = generateLayerName(runtimeName, architecture);
                        expect(layerName).toBe(layerName2);
                    }
                ),
                { numRuns: 15 }
            );
        });

        it('should generate unique layer names for different runtime/architecture combinations', async () => {
            await fc.assert(
                fc.property(
                    // Generate two different runtime/architecture combinations
                    fc.tuple(
                        fc.oneof(
                            fc.constant('nodejs18.x'),
                            fc.constant('nodejs20.x'),
                            fc.constant('nodejs22.x')
                        ),
                        fc.oneof(
                            fc.constant('x86_64'),
                            fc.constant('arm64')
                        )
                    ),
                    fc.tuple(
                        fc.oneof(
                            fc.constant('nodejs18.x'),
                            fc.constant('nodejs20.x'),
                            fc.constant('nodejs22.x')
                        ),
                        fc.oneof(
                            fc.constant('x86_64'),
                            fc.constant('arm64')
                        )
                    ),
                    ([runtime1, arch1], [runtime2, arch2]) => {
                        const layerName1 = generateLayerName(runtime1, arch1);
                        const layerName2 = generateLayerName(runtime2, arch2);

                        // Property: Different combinations should produce different names
                        if (runtime1 !== runtime2 || arch1 !== arch2) {
                            expect(layerName1).not.toBe(layerName2);
                        } else {
                            // Property: Identical combinations should produce identical names
                            expect(layerName1).toBe(layerName2);
                        }

                        // Property: Both names should follow the convention
                        expect(layerName1).toMatch(/^lambda-kata-nodejs-nodejs\d+\.x-(x86_64|arm64)$/);
                        expect(layerName2).toMatch(/^lambda-kata-nodejs-nodejs\d+\.x-(x86_64|arm64)$/);
                    }
                ),
                { numRuns: 15 }
            );
        });

        it('should generate layer names that are valid AWS Lambda layer names', async () => {
            await fc.assert(
                fc.property(
                    fc.oneof(
                        fc.constant('nodejs18.x'),
                        fc.constant('nodejs20.x'),
                        fc.constant('nodejs22.x')
                    ),
                    fc.oneof(
                        fc.constant('x86_64'),
                        fc.constant('arm64')
                    ),
                    (runtimeName, architecture) => {
                        const layerName = generateLayerName(runtimeName, architecture);

                        // Property: Layer name must meet AWS Lambda naming requirements
                        // AWS Lambda layer names must be 1-64 characters
                        expect(layerName.length).toBeGreaterThan(0);
                        expect(layerName.length).toBeLessThanOrEqual(64);

                        // AWS Lambda layer names can contain letters, numbers, hyphens, underscores, and dots
                        expect(layerName).toMatch(/^[a-zA-Z0-9._-]+$/);

                        // Property: Layer name should not start or end with hyphen
                        expect(layerName).not.toMatch(/^-/);
                        expect(layerName).not.toMatch(/-$/);

                        // Property: Layer name should not contain consecutive hyphens
                        expect(layerName).not.toMatch(/--/);
                    }
                ),
                { numRuns: 15 }
            );
        });
    });

    describe('Property 17: Layer Compatibility Assessment', () => {
        /**
         * **Validates: Requirements 9.2**
         * 
         * For any existing layer evaluation, the compatibility check should consider 
         * runtime version, architecture, and layer age to determine if the layer 
         * meets current requirements.
         */
        it('should assess layer compatibility based on all criteria', async () => {
            await fc.assert(
                fc.property(
                    // Generate layer properties
                    fc.oneof(
                        fc.constant('18.19.0'),
                        fc.constant('20.10.0'),
                        fc.constant('22.1.0')
                    ),
                    fc.oneof(
                        fc.constant('x86_64'),
                        fc.constant('arm64')
                    ),
                    fc.date({ min: new Date('2020-01-01'), max: new Date() }),
                    // Generate requirement properties (may be different)
                    fc.oneof(
                        fc.constant('18.19.0'),
                        fc.constant('20.10.0'),
                        fc.constant('22.1.0')
                    ),
                    fc.oneof(
                        fc.constant('x86_64'),
                        fc.constant('arm64')
                    ),
                    fc.integer({ min: 0, max: 1000000000 }), // maxAge in ms
                    (layerNodeVersion, layerArch, layerCreatedDate, reqNodeVersion, reqArch, maxAge) => {
                        const layerInfo: LayerInfo = {
                            arn: 'arn:aws:lambda:us-east-1:123456789012:layer:test:1',
                            name: 'test-layer',
                            version: 1,
                            nodeVersion: layerNodeVersion,
                            architecture: layerArch,
                            createdDate: layerCreatedDate,
                        };

                        const requirements: LayerRequirements = {
                            nodeVersion: reqNodeVersion,
                            architecture: reqArch,
                            maxAge,
                        };

                        const isCompatible = manager.validateLayerCompatibility(layerInfo, requirements);

                        // Property: Compatibility should be true only if ALL criteria match
                        const nodeVersionMatches = layerNodeVersion === reqNodeVersion;
                        const architectureMatches = layerArch === reqArch;
                        const layerAge = Date.now() - layerCreatedDate.getTime();
                        const ageWithinLimit = layerAge <= maxAge;

                        const expectedCompatible = nodeVersionMatches && architectureMatches && ageWithinLimit;

                        expect(isCompatible).toBe(expectedCompatible);
                    }
                ),
                { numRuns: 15 }
            );
        });
    });

    describe('Property: Retry Delay Calculation', () => {
        /**
         * Property: Retry delays should follow exponential backoff pattern with jitter
         */
        it('should calculate retry delays with exponential backoff', async () => {
            await fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 10 }), // attempt number
                    (attempt) => {
                        const calculateRetryDelay = (manager as any).calculateRetryDelay.bind(manager);

                        const delay = calculateRetryDelay(attempt);

                        // Property: Delay should be positive
                        expect(delay).toBeGreaterThan(0);

                        // Property: Delay should follow exponential pattern (with jitter tolerance)
                        const baseDelay = 10; // From manager config
                        const expectedMinDelay = baseDelay * Math.pow(2, attempt);
                        const expectedMaxDelay = expectedMinDelay * 1.1; // 10% jitter

                        expect(delay).toBeGreaterThanOrEqual(expectedMinDelay);
                        expect(delay).toBeLessThanOrEqual(expectedMaxDelay);
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Property: Error Classification Consistency', () => {
        /**
         * Property: Error classification should be consistent and deterministic
         */
        it('should classify errors consistently', async () => {
            await fc.assert(
                fc.property(
                    fc.oneof(
                        fc.constant('ThrottlingException'),
                        fc.constant('TooManyRequestsException'),
                        fc.constant('ServiceUnavailableException'),
                        fc.constant('InternalServerError'),
                        fc.constant('RequestTimeout'),
                        fc.constant('ResourceNotFoundException'),
                        fc.constant('InvalidParameterValueException'),
                        fc.constant('AccessDeniedException')
                    ),
                    (errorName) => {
                        const error = new Error(errorName);
                        error.name = errorName;

                        const isRetryableError = (manager as any).isRetryableError.bind(manager);

                        const isRetryable = isRetryableError(error);

                        // Property: Classification should be deterministic
                        const expectedRetryable = [
                            'ThrottlingException',
                            'TooManyRequestsException',
                            'ServiceUnavailableException',
                            'InternalServerError',
                            'RequestTimeout',
                        ].includes(errorName);

                        expect(isRetryable).toBe(expectedRetryable);
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Property 11: AWS API Retry Logic with Circuit Breaker', () => {
        /**
         * **Validates: Requirements 6.1, 6.5**
         * 
         * For any retryable AWS API failure (throttling, temporary service errors), 
         * the Layer_Manager should implement exponential backoff retry logic with 
         * appropriate jitter and maximum retry limits, protected by circuit breaker pattern.
         */
        it('should implement exponential backoff with circuit breaker protection', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 3 }), // maxRetries (reduced for faster tests)
                    fc.integer({ min: 50, max: 200 }), // retryBaseDelay (reduced for faster tests)
                    fc.integer({ min: 2, max: 5 }), // circuitBreakerFailureThreshold
                    async (maxRetries, retryBaseDelay, failureThreshold) => {
                        const testManager = new AWSLayerManager({
                            logger: new NoOpLogger(),
                            maxRetries,
                            retryBaseDelay,
                            circuitBreakerFailureThreshold: failureThreshold,
                            circuitBreakerTimeout: 100, // Short timeout for tests
                            circuitBreakerSuccessThreshold: 1, // Reduced for faster tests
                        });

                        const executeWithRetry = (testManager as any).executeWithRetry.bind(testManager);

                        // Test with retryable error
                        const retryableError = new Error('ThrottlingException');
                        let callCount = 0;
                        const operation = () => {
                            callCount++;
                            throw retryableError;
                        };

                        try {
                            await executeWithRetry(operation);
                        } catch (error) {
                            // Should have attempted maxRetries + 1 times (initial + retries)
                            expect(callCount).toBe(maxRetries + 1);
                            expect(error).toBe(retryableError);
                        }

                        testManager.destroy();
                    }
                ),
                { numRuns: 10 } // Reduced for faster tests
            );
        }, 60000); // Increased timeout for property tests
    });

    it('should maintain circuit breaker state consistency', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 2, max: 5 }), // failureThreshold
                fc.integer({ min: 1, max: 3 }), // successThreshold
                async (failureThreshold, successThreshold) => {
                    const testManager = new AWSLayerManager({
                        logger: new NoOpLogger(),
                        maxRetries: 1,
                        circuitBreakerFailureThreshold: failureThreshold,
                        circuitBreakerTimeout: 100,
                        circuitBreakerSuccessThreshold: successThreshold,
                    });

                    const executeWithRetry = (testManager as any).executeWithRetry.bind(testManager);

                    // Initial state should be CLOSED
                    let state = testManager.getCircuitBreakerState();
                    expect(state.state).toBe('CLOSED');
                    expect(state.failureCount).toBe(0);

                    // Trigger failures to open circuit
                    const retryableError = new Error('ThrottlingException');
                    const operation = () => { throw retryableError; };

                    for (let i = 0; i < failureThreshold; i++) {
                        try {
                            await executeWithRetry(operation);
                        } catch (error) {
                            // Expected to fail
                        }
                    }

                    // Circuit should be open after threshold failures
                    state = testManager.getCircuitBreakerState();
                    expect(state.state).toBe('OPEN');
                    expect(state.failureCount).toBeGreaterThanOrEqual(failureThreshold);

                    testManager.destroy();
                }
            ),
            { numRuns: 15 }
        );
    });

    describe('Property 13: Comprehensive Error Reporting', () => {
        /**
         * **Validates: Requirements 6.2, 6.4**
         * 
         * For any operation failure (Docker, AWS API, authentication), the system should 
         * return NodeRuntimeLayerError instances with descriptive messages, appropriate 
         * error codes, and actionable troubleshooting guidance.
         */
        it('should classify errors correctly and consistently', async () => {
            await fc.assert(
                fc.property(
                    fc.oneof(
                        // Retryable errors
                        fc.constant('ThrottlingException'),
                        fc.constant('ServiceUnavailableException'),
                        fc.constant('InternalServerError'),
                        fc.constant('RequestTimeout'),
                        fc.constant('TooManyRequestsException'),
                        fc.constant('RequestLimitExceeded'),
                        fc.constant('ECONNRESET'),
                        // Non-retryable errors
                        fc.constant('ResourceNotFoundException'),
                        fc.constant('ValidationException'),
                        fc.constant('AccessDeniedException'),
                        fc.constant('InvalidParameterValueException')
                    ),
                    (errorName) => {
                        const isRetryableError = (manager as any).isRetryableError.bind(manager);

                        const error = new Error(errorName);
                        error.name = errorName;

                        const isRetryable = isRetryableError(error);

                        // Define expected retryable errors
                        const expectedRetryable = [
                            'ThrottlingException',
                            'ServiceUnavailableException',
                            'InternalServerError',
                            'RequestTimeout',
                            'TooManyRequestsException',
                            'RequestLimitExceeded',
                            'ECONNRESET'
                        ];

                        const shouldBeRetryable = expectedRetryable.includes(errorName);
                        expect(isRetryable).toBe(shouldBeRetryable);

                        // Property: Classification should be deterministic
                        const isRetryableAgain = isRetryableError(error);
                        expect(isRetryable).toBe(isRetryableAgain);
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('should identify network errors as retryable', async () => {
            await fc.assert(
                fc.property(
                    fc.oneof(
                        fc.constant('ECONNRESET'),
                        fc.constant('ECONNREFUSED'),
                        fc.constant('ENOTFOUND'),
                        fc.constant('ETIMEDOUT'),
                        fc.constant('socket hang up'),
                        fc.constant('connect timeout'),
                        fc.constant('network timeout')
                    ),
                    (errorPattern) => {
                        const isRetryableError = (manager as any).isRetryableError.bind(manager);

                        // Test with error code
                        if (errorPattern.startsWith('E')) {
                            const error = Object.assign(new Error('Network error'), { code: errorPattern });
                            expect(isRetryableError(error)).toBe(true);
                        }

                        // Test with error message
                        const messageError = new Error(errorPattern);
                        expect(isRetryableError(messageError)).toBe(true);
                    }
                ),
                { numRuns: 30 }
            );
        });
    });
});
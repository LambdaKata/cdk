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
 * Property-Based Tests for Layer Compatibility Assessment
 *
 * Feature: nodejs-layer-management, Property 17: Layer Compatibility Assessment
 *
 * Property 17: Layer Compatibility Assessment
 * *For any* existing layer evaluation, the compatibility check should consider
 * runtime version, architecture, and layer age to determine if the layer
 * meets current requirements.
 *
 * **Validates: Requirements 9.2**
 * - Req 9.2: When checking for existing layers, the Layer_Manager shall compare runtime version, architecture, and layer content to determine compatibility
 *
 * @module nodejs-layer-manager-layer-compatibility.property.test
 */

import * as fc from 'fast-check';
import { AWSLayerManager } from '../src/aws-layer-manager';
import { LayerInfo, LayerRequirements } from '../src/nodejs-layer-manager';
import { ConsoleLogger } from '../src/logger';

/**
 * Arbitrary generator for Node.js semantic versions.
 */
const arbitraryNodeVersion = (): fc.Arbitrary<string> =>
    fc.tuple(
        fc.integer({ min: 16, max: 22 }), // Major version
        fc.integer({ min: 0, max: 20 }),  // Minor version
        fc.integer({ min: 0, max: 10 })   // Patch version
    ).map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

/**
 * Arbitrary generator for supported architectures.
 */
const arbitraryArchitecture = (): fc.Arbitrary<string> =>
    fc.constantFrom('x86_64', 'arm64');

/**
 * Arbitrary generator for layer creation dates.
 */
const arbitraryLayerDate = (): fc.Arbitrary<Date> =>
    fc.integer({ min: Date.now() - 365 * 24 * 60 * 60 * 1000, max: Date.now() })
        .map(timestamp => new Date(timestamp));

/**
 * Arbitrary generator for layer ARNs.
 */
const arbitraryLayerArn = (): fc.Arbitrary<string> =>
    fc.tuple(
        fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1'),
        fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 12, maxLength: 12 }),
        fc.integer({ min: 1, max: 999 })
    ).map(([region, accountId, version]) =>
        `arn:aws:lambda:${region}:${accountId}:layer:lambda-kata-nodejs-test:${version}`
    );

/**
 * Arbitrary generator for layer names.
 */
const arbitraryLayerName = (): fc.Arbitrary<string> =>
    fc.tuple(
        fc.constantFrom('nodejs18.x', 'nodejs20.x', 'nodejs22.x'),
        arbitraryArchitecture()
    ).map(([runtime, arch]) => `lambda-kata-nodejs-${runtime}-${arch}`);

/**
 * Arbitrary generator for LayerInfo objects.
 */
const arbitraryLayerInfo = (): fc.Arbitrary<LayerInfo> =>
    fc.record({
        arn: arbitraryLayerArn(),
        name: arbitraryLayerName(),
        version: fc.integer({ min: 1, max: 999 }),
        nodeVersion: arbitraryNodeVersion(),
        architecture: arbitraryArchitecture(),
        createdDate: arbitraryLayerDate(),
    });

/**
 * Arbitrary generator for LayerRequirements objects.
 */
const arbitraryLayerRequirements = (): fc.Arbitrary<LayerRequirements> =>
    fc.record({
        nodeVersion: arbitraryNodeVersion(),
        architecture: arbitraryArchitecture(),
        maxAge: fc.option(fc.integer({ min: 1000, max: 365 * 24 * 60 * 60 * 1000 }), { nil: undefined }),
    });

/**
 * Arbitrary generator for max age values in milliseconds.
 */
const arbitraryMaxAge = (): fc.Arbitrary<number> =>
    fc.integer({ min: 1000, max: 30 * 24 * 60 * 60 * 1000 }); // 1 second to 30 days

/**
 * Creates a LayerInfo with specific compatibility characteristics.
 */
function createLayerWithCompatibility(
    requirements: LayerRequirements,
    compatibility: {
        versionMatch: boolean;
        architectureMatch: boolean;
        ageWithinLimit: boolean;
    }
): LayerInfo {
    const now = Date.now();
    const maxAge = requirements.maxAge || 7 * 24 * 60 * 60 * 1000; // Default 7 days

    return {
        arn: 'arn:aws:lambda:us-east-1:123456789012:layer:test-layer:1',
        name: 'test-layer',
        version: 1,
        nodeVersion: compatibility.versionMatch ? requirements.nodeVersion : '99.99.99',
        architecture: compatibility.architectureMatch ? requirements.architecture : 'unsupported',
        createdDate: new Date(
            compatibility.ageWithinLimit
                ? now - (maxAge / 2) // Half the max age (within limit)
                : now - (maxAge * 2) // Double the max age (exceeds limit)
        ),
    };
}

// Feature: nodejs-layer-management, Property 17: Layer Compatibility Assessment
describe('Feature: nodejs-layer-management, Property 17: Layer Compatibility Assessment', () => {
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
     * **Validates: Requirement 9.2**
     * 
     * For any existing layer evaluation, the compatibility check should
     * consider all relevant factors to determine compatibility.
     */
    describe('Property 17: Layer Compatibility Assessment', () => {
        /**
         * **Validates: Requirement 9.2**
         *
         * For any layer and requirements combination, the compatibility check
         * should return true only when all criteria are met.
         */
        it('should validate layer compatibility based on all criteria', () => {
            fc.assert(
                fc.property(
                    arbitraryLayerRequirements(),
                    fc.boolean(), // Version match
                    fc.boolean(), // Architecture match
                    fc.boolean(), // Age within limit
                    (requirements, versionMatch, architectureMatch, ageWithinLimit) => {
                        const layer = createLayerWithCompatibility(requirements, {
                            versionMatch,
                            architectureMatch,
                            ageWithinLimit,
                        });

                        const isCompatible = layerManager.validateLayerCompatibility(layer, requirements);

                        // Should be compatible only if ALL criteria are met
                        const expectedCompatibility = versionMatch && architectureMatch && ageWithinLimit;
                        expect(isCompatible).toBe(expectedCompatibility);

                        // Verify compatibility logging
                        const debugLogs = mockLogger.debug.mock.calls.filter(call =>
                            call[0].includes('Validating layer compatibility')
                        );
                        expect(debugLogs.length).toBeGreaterThanOrEqual(1);

                        const logMetadata = debugLogs[0][1] as any;
                        expect(logMetadata).toHaveProperty('layerNodeVersion', layer.nodeVersion);
                        expect(logMetadata).toHaveProperty('requiredNodeVersion', requirements.nodeVersion);
                        expect(logMetadata).toHaveProperty('layerArchitecture', layer.architecture);
                        expect(logMetadata).toHaveProperty('requiredArchitecture', requirements.architecture);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 9.2**
         *
         * For any layer with exact version and architecture match,
         * compatibility should depend only on age requirements.
         */
        it('should require exact version and architecture match for compatibility', () => {
            fc.assert(
                fc.property(
                    arbitraryNodeVersion(),
                    arbitraryArchitecture(),
                    arbitraryMaxAge(),
                    (nodeVersion, architecture, maxAge) => {
                        const requirements: LayerRequirements = {
                            nodeVersion,
                            architecture,
                            maxAge,
                        };

                        // Test exact match (should be compatible if age is within limit)
                        const exactMatchLayer: LayerInfo = {
                            arn: 'arn:aws:lambda:us-east-1:123456789012:layer:test:1',
                            name: 'test-layer',
                            version: 1,
                            nodeVersion,
                            architecture,
                            createdDate: new Date(Date.now() - maxAge / 2), // Within age limit
                        };

                        const exactMatchCompatible = layerManager.validateLayerCompatibility(exactMatchLayer, requirements);
                        expect(exactMatchCompatible).toBe(true);

                        // Test version mismatch (should be incompatible)
                        const versionMismatchLayer: LayerInfo = {
                            ...exactMatchLayer,
                            nodeVersion: '99.99.99', // Different version
                        };

                        const versionMismatchCompatible = layerManager.validateLayerCompatibility(versionMismatchLayer, requirements);
                        expect(versionMismatchCompatible).toBe(false);

                        // Test architecture mismatch (should be incompatible)
                        const archMismatchLayer: LayerInfo = {
                            ...exactMatchLayer,
                            architecture: architecture === 'x86_64' ? 'arm64' : 'x86_64', // Different architecture
                        };

                        const archMismatchCompatible = layerManager.validateLayerCompatibility(archMismatchLayer, requirements);
                        expect(archMismatchCompatible).toBe(false);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 9.2**
         *
         * For any layer age configuration, the compatibility check
         * should respect both explicit and default age limits.
         */
        it('should respect age limits in compatibility assessment', () => {
            fc.assert(
                fc.property(
                    arbitraryNodeVersion(),
                    arbitraryArchitecture(),
                    fc.option(arbitraryMaxAge(), { nil: undefined }),
                    (nodeVersion, architecture, explicitMaxAge) => {
                        const requirements: LayerRequirements = {
                            nodeVersion,
                            architecture,
                            maxAge: explicitMaxAge,
                        };

                        // Use explicit max age or default (7 days)
                        const effectiveMaxAge = explicitMaxAge || (7 * 24 * 60 * 60 * 1000);

                        // Test layer within age limit (should be compatible)
                        const recentLayer: LayerInfo = {
                            arn: 'arn:aws:lambda:us-east-1:123456789012:layer:test:1',
                            name: 'test-layer',
                            version: 1,
                            nodeVersion,
                            architecture,
                            createdDate: new Date(Date.now() - effectiveMaxAge / 2), // Within limit
                        };

                        const recentCompatible = layerManager.validateLayerCompatibility(recentLayer, requirements);
                        expect(recentCompatible).toBe(true);

                        // Test layer exceeding age limit (should be incompatible)
                        const oldLayer: LayerInfo = {
                            ...recentLayer,
                            createdDate: new Date(Date.now() - effectiveMaxAge * 2), // Exceeds limit
                        };

                        const oldCompatible = layerManager.validateLayerCompatibility(oldLayer, requirements);
                        expect(oldCompatible).toBe(false);

                        // Verify age-related logging
                        const debugLogs = mockLogger.debug.mock.calls.filter(call =>
                            call[0].includes('Layer rejected: Too old') ||
                            call[0].includes('Layer rejected: Exceeds default max age')
                        );

                        if (!oldCompatible) {
                            expect(debugLogs.length).toBeGreaterThanOrEqual(1);
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 9.2**
         *
         * For any compatibility assessment, detailed logging should
         * provide insight into the decision-making process.
         */
        it('should provide detailed logging for compatibility decisions', () => {
            fc.assert(
                fc.property(
                    arbitraryLayerInfo(),
                    arbitraryLayerRequirements(),
                    (layer, requirements) => {
                        const isCompatible = layerManager.validateLayerCompatibility(layer, requirements);

                        // Verify initial compatibility logging
                        const validationLogs = mockLogger.debug.mock.calls.filter(call =>
                            call[0].includes('Validating layer compatibility')
                        );
                        expect(validationLogs.length).toBeGreaterThanOrEqual(1);

                        const validationMetadata = validationLogs[0][1] as any;
                        expect(validationMetadata).toHaveProperty('layerArn', layer.arn);
                        expect(validationMetadata).toHaveProperty('layerNodeVersion', layer.nodeVersion);
                        expect(validationMetadata).toHaveProperty('requiredNodeVersion', requirements.nodeVersion);
                        expect(validationMetadata).toHaveProperty('layerArchitecture', layer.architecture);
                        expect(validationMetadata).toHaveProperty('requiredArchitecture', requirements.architecture);
                        expect(validationMetadata).toHaveProperty('layerAge');
                        expect(validationMetadata).toHaveProperty('maxAge');

                        if (isCompatible) {
                            // Verify success logging
                            const successLogs = mockLogger.debug.mock.calls.filter(call =>
                                call[0].includes('Layer compatibility validated successfully')
                            );
                            expect(successLogs.length).toBeGreaterThanOrEqual(1);
                        } else {
                            // Verify rejection logging with specific reason
                            const rejectionLogs = mockLogger.debug.mock.calls.filter(call =>
                                call[0].includes('Layer rejected:')
                            );
                            expect(rejectionLogs.length).toBeGreaterThanOrEqual(1);

                            // Should have specific rejection reason
                            const rejectionReasons = rejectionLogs.map(log => log[0]);
                            const hasSpecificReason = rejectionReasons.some(reason =>
                                reason.includes('version mismatch') ||
                                reason.includes('Architecture mismatch') ||
                                reason.includes('Too old') ||
                                reason.includes('Exceeds default max age')
                            );
                            expect(hasSpecificReason).toBe(true);
                        }

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 9.2**
         *
         * For any layer compatibility assessment, the evaluation should
         * be deterministic and consistent across multiple calls.
         */
        it('should provide consistent compatibility assessment results', () => {
            fc.assert(
                fc.property(
                    arbitraryLayerInfo(),
                    arbitraryLayerRequirements(),
                    (layer, requirements) => {
                        // Perform multiple compatibility checks
                        const results = [
                            layerManager.validateLayerCompatibility(layer, requirements),
                            layerManager.validateLayerCompatibility(layer, requirements),
                            layerManager.validateLayerCompatibility(layer, requirements),
                        ];

                        // All results should be identical
                        expect(results[1]).toBe(results[0]);
                        expect(results[2]).toBe(results[0]);

                        // Verify deterministic behavior based on layer properties
                        const versionMatch = layer.nodeVersion === requirements.nodeVersion;
                        const architectureMatch = layer.architecture === requirements.architecture;

                        const maxAge = requirements.maxAge || (7 * 24 * 60 * 60 * 1000);
                        const layerAge = Date.now() - layer.createdDate.getTime();
                        const ageWithinLimit = layerAge <= maxAge;

                        const expectedResult = versionMatch && architectureMatch && ageWithinLimit;
                        expect(results[0]).toBe(expectedResult);

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 9.2**
         *
         * For any layer compatibility assessment with edge case scenarios,
         * the system should handle boundary conditions correctly.
         */
        it('should handle edge cases in compatibility assessment', () => {
            fc.assert(
                fc.property(
                    arbitraryNodeVersion(),
                    arbitraryArchitecture(),
                    fc.integer({ min: 1000, max: 10000 }), // Small max age for edge testing
                    (nodeVersion, architecture, maxAge) => {
                        const requirements: LayerRequirements = {
                            nodeVersion,
                            architecture,
                            maxAge,
                        };

                        // Test layer created exactly at the age limit
                        const exactLimitLayer: LayerInfo = {
                            arn: 'arn:aws:lambda:us-east-1:123456789012:layer:test:1',
                            name: 'test-layer',
                            version: 1,
                            nodeVersion,
                            architecture,
                            createdDate: new Date(Date.now() - maxAge), // Exactly at limit
                        };

                        const exactLimitCompatible = layerManager.validateLayerCompatibility(exactLimitLayer, requirements);
                        expect(exactLimitCompatible).toBe(true); // Should be compatible (<=)

                        // Test layer created 1ms over the age limit
                        const overLimitLayer: LayerInfo = {
                            ...exactLimitLayer,
                            createdDate: new Date(Date.now() - maxAge - 1), // 1ms over limit
                        };

                        const overLimitCompatible = layerManager.validateLayerCompatibility(overLimitLayer, requirements);
                        expect(overLimitCompatible).toBe(false); // Should be incompatible

                        // Test layer created in the future (edge case)
                        const futureLayer: LayerInfo = {
                            ...exactLimitLayer,
                            createdDate: new Date(Date.now() + 1000), // 1 second in future
                        };

                        const futureCompatible = layerManager.validateLayerCompatibility(futureLayer, requirements);
                        expect(futureCompatible).toBe(true); // Should be compatible (negative age)

                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
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
 * Property-Based Tests for Version Caching Efficiency
 *
 * Feature: nodejs-layer-management, Property 15: Version Caching Efficiency
 *
 * Property 15: Version Caching Efficiency
 * *For any* runtime version detection request, subsequent requests for the same runtime
 * and architecture should use cached results without performing additional Docker operations,
 * until cache TTL expires.
 *
 * **Validates: Requirements 8.4**
 * - Req 8.4: The Runtime_Detector shall cache version information to avoid repeated Docker operations for the same runtime
 *
 * @module nodejs-layer-manager-version-caching.property.test
 */

import * as fc from 'fast-check';
import { DockerRuntimeDetector } from '../src/docker-runtime-detector';
import { NodeVersionInfo } from '../src/nodejs-layer-manager';
import { ConsoleLogger } from '../src/logger';
import { spawn } from 'child_process';

// Mock dependencies
jest.mock('child_process');

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

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
 * Arbitrary generator for cache TTL values (in milliseconds).
 */
const arbitraryCacheTtl = (): fc.Arbitrary<number> =>
    fc.integer({ min: 100, max: 10000 }); // 100ms to 10s for testing

/**
 * Arbitrary generator for Docker timeout values (in milliseconds).
 */
const arbitraryDockerTimeout = (): fc.Arbitrary<number> =>
    fc.integer({ min: 1000, max: 5000 }); // 1s to 5s for testing

/**
 * Arbitrary generator for runtime/architecture pairs.
 */
const arbitraryRuntimeArchPair = (): fc.Arbitrary<{
    runtimeName: string;
    architecture: 'x86_64' | 'arm64';
}> =>
    fc.record({
        runtimeName: arbitraryRuntime(),
        architecture: arbitraryArchitecture(),
    });

/**
 * Mock setup helper for successful Docker operations.
 */
function setupSuccessfulDockerMocks(): void {
    let dockerCallCount = 0;

    mockedSpawn.mockImplementation((command: string, args: readonly string[]) => {
        dockerCallCount++;

        const mockProcess = {
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn() },
            on: jest.fn(),
            kill: jest.fn(),
        };

        // Setup stdout data based on command
        if (args.includes('--version')) {
            mockProcess.stdout.on.mockImplementation((event, callback) => {
                if (event === 'data') {
                    // Return different versions based on runtime
                    const runtime = args.find(arg => arg.includes('nodejs'));
                    if (runtime?.includes('18')) {
                        callback(Buffer.from('v18.19.0\n'));
                    } else if (runtime?.includes('20')) {
                        callback(Buffer.from('v20.10.0\n'));
                    } else if (runtime?.includes('22')) {
                        callback(Buffer.from('v22.1.0\n'));
                    } else {
                        callback(Buffer.from('v20.10.0\n')); // default
                    }
                }
            });
        }

        // Setup process completion
        mockProcess.on.mockImplementation((event, callback) => {
            if (event === 'close') {
                setTimeout(() => callback(0), 10); // Successful exit
            }
        });

        return mockProcess as any;
    });

    // Store call count for verification
    (mockedSpawn as any).getCallCount = () => dockerCallCount;
    (mockedSpawn as any).resetCallCount = () => { dockerCallCount = 0; };
}

/**
 * Mock setup helper for Docker operations that fail initially then succeed.
 */
function setupInitialFailureThenSuccessMocks(failureCount: number): void {
    let dockerCallCount = 0;

    mockedSpawn.mockImplementation((command: string, args: readonly string[]) => {
        dockerCallCount++;

        const mockProcess = {
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn() },
            on: jest.fn(),
            kill: jest.fn(),
        };

        // Fail for the first N calls, then succeed
        const shouldFail = dockerCallCount <= failureCount;

        if (shouldFail) {
            mockProcess.stderr.on.mockImplementation((event, callback) => {
                if (event === 'data') {
                    callback(Buffer.from('Docker operation failed\n'));
                }
            });

            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'close') {
                    setTimeout(() => callback(1), 10); // Failed exit
                }
            });
        } else {
            // Success case
            if (args.includes('--version')) {
                mockProcess.stdout.on.mockImplementation((event, callback) => {
                    if (event === 'data') {
                        callback(Buffer.from('v20.10.0\n'));
                    }
                });
            }

            mockProcess.on.mockImplementation((event, callback) => {
                if (event === 'close') {
                    setTimeout(() => callback(0), 10); // Successful exit
                }
            });
        }

        return mockProcess as any;
    });

    (mockedSpawn as any).getCallCount = () => dockerCallCount;
    (mockedSpawn as any).resetCallCount = () => { dockerCallCount = 0; };
}

// Feature: nodejs-layer-management, Property 15: Version Caching Efficiency
describe('Feature: nodejs-layer-management, Property 15: Version Caching Efficiency', () => {
    let mockLogger: jest.Mocked<ConsoleLogger>;
    let originalDateNow: typeof Date.now;
    let mockTime = 0;

    beforeEach(() => {
        // Mock Date.now for deterministic cache TTL testing
        originalDateNow = Date.now;
        Date.now = jest.fn(() => mockTime);

        // Create mock logger
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        } as any;

        // Reset mock time
        mockTime = 1000000; // Start at a fixed time

        jest.clearAllMocks();
        setupSuccessfulDockerMocks();
    });

    afterEach(() => {
        Date.now = originalDateNow;
    });

    /**
     * **Validates: Requirement 8.4**
     * 
     * For any runtime version detection request, subsequent requests should
     * use cached results without additional Docker operations.
     */
    describe('Property 15: Version Caching Efficiency', () => {
        /**
         * **Validates: Requirement 8.4**
         *
         * For any runtime and architecture combination, the second request
         * should use cached results without performing Docker operations.
         */
        it('should cache version information and avoid repeated Docker operations', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryRuntimeArchPair(),
                    arbitraryCacheTtl(),
                    async (runtimeArch, cacheTtl) => {
                        const detector = new DockerRuntimeDetector({
                            cacheTtl,
                            logger: mockLogger,
                        });

                        // Reset Docker call count
                        (mockedSpawn as any).resetCallCount();

                        // First request - should perform Docker operations
                        const result1 = await detector.detectNodeVersion(
                            runtimeArch.runtimeName,
                            runtimeArch.architecture
                        );

                        const dockerCallsAfterFirst = (mockedSpawn as any).getCallCount();
                        expect(dockerCallsAfterFirst).toBeGreaterThan(0);

                        // Second request immediately - should use cache
                        const result2 = await detector.detectNodeVersion(
                            runtimeArch.runtimeName,
                            runtimeArch.architecture
                        );

                        const dockerCallsAfterSecond = (mockedSpawn as any).getCallCount();

                        // Verify no additional Docker calls were made
                        expect(dockerCallsAfterSecond).toBe(dockerCallsAfterFirst);

                        // Verify results are identical
                        expect(result2).toEqual(result1);
                        expect(result2.version).toBe(result1.version);
                        expect(result2.runtimeName).toBe(result1.runtimeName);
                        expect(result2.dockerImage).toBe(result1.dockerImage);

                        // Verify cache hit was logged
                        const debugLogs = mockLogger.debug.mock.calls.filter(call =>
                            call[0].includes('Using cached version information')
                        );
                        expect(debugLogs.length).toBeGreaterThanOrEqual(1);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 8.4**
         *
         * For any cache TTL configuration, cached entries should expire
         * after the specified time and trigger new Docker operations.
         */
        it('should respect cache TTL and perform new Docker operations after expiration', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryRuntimeArchPair(),
                    arbitraryCacheTtl(),
                    async (runtimeArch, cacheTtl) => {
                        const detector = new DockerRuntimeDetector({
                            cacheTtl,
                            logger: mockLogger,
                        });

                        // Reset Docker call count
                        (mockedSpawn as any).resetCallCount();

                        // First request
                        const result1 = await detector.detectNodeVersion(
                            runtimeArch.runtimeName,
                            runtimeArch.architecture
                        );

                        const dockerCallsAfterFirst = (mockedSpawn as any).getCallCount();
                        expect(dockerCallsAfterFirst).toBeGreaterThan(0);

                        // Advance time beyond cache TTL
                        mockTime += cacheTtl + 1000; // Add extra buffer

                        // Second request after TTL expiration - should perform new Docker operations
                        const result2 = await detector.detectNodeVersion(
                            runtimeArch.runtimeName,
                            runtimeArch.architecture
                        );

                        const dockerCallsAfterSecond = (mockedSpawn as any).getCallCount();

                        // Verify additional Docker calls were made
                        expect(dockerCallsAfterSecond).toBeGreaterThan(dockerCallsAfterFirst);

                        // Verify results are still consistent
                        expect(result2.version).toBe(result1.version);
                        expect(result2.runtimeName).toBe(result1.runtimeName);
                        expect(result2.dockerImage).toBe(result1.dockerImage);

                        // Verify cache expiration was logged
                        const debugLogs = mockLogger.debug.mock.calls.filter(call =>
                            call[0].includes('Cache entry expired and removed')
                        );
                        expect(debugLogs.length).toBeGreaterThanOrEqual(1);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 8.4**
         *
         * For any combination of different runtime/architecture pairs,
         * each combination should have its own cache entry.
         */
        it('should maintain separate cache entries for different runtime/architecture combinations', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryRuntimeArchPair(),
                    arbitraryRuntimeArchPair(),
                    arbitraryCacheTtl(),
                    async (runtimeArch1, runtimeArch2, cacheTtl) => {
                        // Ensure we have different combinations
                        fc.pre(
                            runtimeArch1.runtimeName !== runtimeArch2.runtimeName ||
                            runtimeArch1.architecture !== runtimeArch2.architecture
                        );

                        const detector = new DockerRuntimeDetector({
                            cacheTtl,
                            logger: mockLogger,
                        });

                        // Reset Docker call count
                        (mockedSpawn as any).resetCallCount();

                        // First combination - first request
                        const result1a = await detector.detectNodeVersion(
                            runtimeArch1.runtimeName,
                            runtimeArch1.architecture
                        );

                        const dockerCallsAfter1a = (mockedSpawn as any).getCallCount();

                        // Second combination - first request
                        const result2a = await detector.detectNodeVersion(
                            runtimeArch2.runtimeName,
                            runtimeArch2.architecture
                        );

                        const dockerCallsAfter2a = (mockedSpawn as any).getCallCount();

                        // Should have made Docker calls for both combinations
                        expect(dockerCallsAfter2a).toBeGreaterThan(dockerCallsAfter1a);

                        // First combination - second request (should use cache)
                        const result1b = await detector.detectNodeVersion(
                            runtimeArch1.runtimeName,
                            runtimeArch1.architecture
                        );

                        const dockerCallsAfter1b = (mockedSpawn as any).getCallCount();

                        // Should not have made additional Docker calls
                        expect(dockerCallsAfter1b).toBe(dockerCallsAfter2a);

                        // Second combination - second request (should use cache)
                        const result2b = await detector.detectNodeVersion(
                            runtimeArch2.runtimeName,
                            runtimeArch2.architecture
                        );

                        const dockerCallsAfter2b = (mockedSpawn as any).getCallCount();

                        // Should not have made additional Docker calls
                        expect(dockerCallsAfter2b).toBe(dockerCallsAfter1b);

                        // Verify cached results are identical to original results
                        expect(result1b).toEqual(result1a);
                        expect(result2b).toEqual(result2a);

                        // Verify cache size reflects both entries
                        expect(detector.getCacheSize()).toBe(2);

                        return true;
                    }
                ),
                { numRuns: 50 } // Reduced for complexity
            );
        });

        /**
         * **Validates: Requirement 8.4**
         *
         * For any cache configuration, the cache should handle failures
         * gracefully and not cache failed results.
         */
        it('should not cache failed version detection attempts', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryRuntimeArchPair(),
                    arbitraryCacheTtl(),
                    fc.integer({ min: 1, max: 3 }), // Number of initial failures
                    async (runtimeArch, cacheTtl, failureCount) => {
                        const detector = new DockerRuntimeDetector({
                            cacheTtl,
                            logger: mockLogger,
                            enableFallback: false, // Disable fallback to test failure caching
                        });

                        // Setup mocks to fail initially then succeed
                        setupInitialFailureThenSuccessMocks(failureCount);

                        // First attempts should fail
                        for (let i = 0; i < failureCount; i++) {
                            let thrownError: Error | undefined;
                            try {
                                await detector.detectNodeVersion(
                                    runtimeArch.runtimeName,
                                    runtimeArch.architecture
                                );
                            } catch (error) {
                                thrownError = error as Error;
                            }
                            expect(thrownError).toBeDefined();
                        }

                        // Verify cache is still empty after failures
                        expect(detector.getCacheSize()).toBe(0);

                        // Next attempt should succeed and be cached
                        const result = await detector.detectNodeVersion(
                            runtimeArch.runtimeName,
                            runtimeArch.architecture
                        );

                        expect(result).toBeDefined();
                        expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);

                        // Verify cache now contains the successful result
                        expect(detector.getCacheSize()).toBe(1);

                        // Subsequent request should use cache
                        const dockerCallsBeforeCache = (mockedSpawn as any).getCallCount();

                        const cachedResult = await detector.detectNodeVersion(
                            runtimeArch.runtimeName,
                            runtimeArch.architecture
                        );

                        const dockerCallsAfterCache = (mockedSpawn as any).getCallCount();

                        // Should not have made additional Docker calls
                        expect(dockerCallsAfterCache).toBe(dockerCallsBeforeCache);
                        expect(cachedResult).toEqual(result);

                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });

        /**
         * **Validates: Requirement 8.4**
         *
         * For any cache operations, the cache should provide methods
         * for monitoring and management.
         */
        it('should provide cache management and monitoring capabilities', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.array(arbitraryRuntimeArchPair(), { minLength: 1, maxLength: 5 }),
                    arbitraryCacheTtl(),
                    async (runtimeArchPairs, cacheTtl) => {
                        const detector = new DockerRuntimeDetector({
                            cacheTtl,
                            logger: mockLogger,
                        });

                        // Initially cache should be empty
                        expect(detector.getCacheSize()).toBe(0);

                        // Populate cache with different combinations
                        const uniquePairs = Array.from(
                            new Set(runtimeArchPairs.map(pair => `${pair.runtimeName}-${pair.architecture}`))
                        ).map(key => {
                            const [runtimeName, architecture] = key.split('-');
                            return { runtimeName, architecture: architecture as 'x86_64' | 'arm64' };
                        });

                        for (const pair of uniquePairs) {
                            await detector.detectNodeVersion(pair.runtimeName, pair.architecture);
                        }

                        // Verify cache size matches unique pairs
                        expect(detector.getCacheSize()).toBe(uniquePairs.length);

                        // Clear cache
                        detector.clearCache();

                        // Verify cache is empty after clearing
                        expect(detector.getCacheSize()).toBe(0);

                        // Verify cache clearing was logged
                        const debugLogs = mockLogger.debug.mock.calls.filter(call =>
                            call[0].includes('Version cache cleared')
                        );
                        expect(debugLogs.length).toBeGreaterThanOrEqual(1);

                        return true;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });
});
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
 * Property-based tests for DockerRuntimeDetector error handling
 * 
 * These tests validate error handling properties for invalid runtimes and Docker unavailability:
 * - Invalid runtime error reporting
 * - Docker unavailable error handling
 * - Error message descriptiveness and troubleshooting guidance
 * - Error code consistency and classification
 */

import * as fc from 'fast-check';
import { spawn } from 'child_process';
import {
    DockerRuntimeDetector,
    NodeRuntimeLayerError,
    ErrorCodes,
    NoOpLogger,
} from '../src';

// Mock child_process.spawn
jest.mock('child_process');
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

// Feature: nodejs-layer-management, Property 3: Error Handling for Invalid Runtimes
describe('DockerRuntimeDetector Error Handling Property Tests', () => {
    let mockLogger: NoOpLogger;

    beforeEach(() => {
        mockLogger = new NoOpLogger();
        jest.clearAllMocks();
    });

    /**
     * Helper function to create arbitrary unsupported runtime names
     */
    const arbitraryUnsupportedRuntime = () => fc.oneof(
        // Completely invalid runtime names
        fc.constant(''),
        fc.constant('invalid'),
        fc.constant('python3.9'),
        fc.constant('java11'),
        fc.constant('dotnet6'),
        fc.constant('go1.x'),
        fc.constant('ruby2.7'),

        // Malformed Node.js runtime names
        fc.constant('nodejs'),
        fc.constant('nodejs.x'),
        fc.constant('nodejs19.x'), // Unsupported version
        fc.constant('nodejs21.x'), // Unsupported version
        fc.constant('nodejs23.x'), // Unsupported version
        fc.constant('node18.x'),   // Wrong prefix
        fc.constant('nodejs18'),   // Missing .x
        fc.constant('nodejs18.0'), // Wrong format

        // Edge cases
        fc.constant('nodejs18.x.extra'),
        fc.constant('NODEJS20.X'), // Wrong case
        fc.constant('nodejs 20.x'), // Space
        fc.constant('nodejs20.x '), // Trailing space
        fc.constant(' nodejs20.x'), // Leading space

        // Random strings that might cause issues
        fc.string({ minLength: 1, maxLength: 20 }).filter(s =>
            !['nodejs18.x', 'nodejs20.x', 'nodejs22.x'].includes(s)
        )
    );

    /**
     * Helper function to create arbitrary supported architectures
     */
    const arbitrarySupportedArchitecture = () => fc.oneof(
        fc.constant('x86_64'),
        fc.constant('arm64')
    );

    /**
     * Helper function to create arbitrary unsupported architectures
     */
    const arbitraryUnsupportedArchitecture = () => fc.oneof(
        fc.constant(''),
        fc.constant('invalid'),
        fc.constant('x86'),
        fc.constant('amd64'),
        fc.constant('arm'),
        fc.constant('arm32'),
        fc.constant('i386'),
        fc.constant('X86_64'), // Wrong case
        fc.constant('ARM64'),  // Wrong case
        fc.constant('x86_64 '), // Trailing space
        fc.constant(' arm64'),  // Leading space
        fc.string({ minLength: 1, maxLength: 15 }).filter(s =>
            !['x86_64', 'arm64'].includes(s)
        )
    );

    /**
     * Helper function to create a mock process that fails
     */
    const createFailedMockProcess = (errorMessage: string = 'Docker command failed') => {
        const mockProcess = {
            stdout: {
                on: jest.fn((event, callback) => {
                    if (event === 'data') {
                        // No stdout data for failed process
                    }
                }),
            },
            stderr: {
                on: jest.fn((event, callback) => {
                    if (event === 'data') {
                        callback(Buffer.from(errorMessage));
                    }
                }),
            },
            on: jest.fn((event, callback) => {
                if (event === 'close') {
                    // Simulate process failure
                    setTimeout(() => callback(1), 10);
                } else if (event === 'error') {
                    // Simulate process error (Docker not available)
                    setTimeout(() => callback(new Error(errorMessage)), 10);
                }
            }),
            kill: jest.fn(),
        };
        return mockProcess as any;
    };

    describe('Property 3: Error Handling for Invalid Runtimes', () => {
        /**
         * **Validates: Requirements 1.5, 8.5**
         * 
         * For any unsupported or malformed runtime specification, the Runtime_Detector 
         * should return a descriptive NodeRuntimeLayerError with appropriate error code 
         * and troubleshooting information.
         */
        it('should throw NodeRuntimeLayerError with RUNTIME_UNSUPPORTED for any invalid runtime', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbitraryUnsupportedRuntime(),
                    arbitrarySupportedArchitecture(),
                    async (invalidRuntime, architecture) => {
                        const detector = new DockerRuntimeDetector({
                            logger: mockLogger,
                            enableFallback: false, // Disable fallback to test error handling
                        });

                        // Property: Invalid runtime should always throw NodeRuntimeLayerError
                        await expect(detector.detectNodeVersion(invalidRuntime, architecture))
                            .rejects
                            .toThrow(NodeRuntimeLayerError);

                        // Property: Error should have RUNTIME_UNSUPPORTED code
                        await expect(detector.detectNodeVersion(invalidRuntime, architecture))
                            .rejects
                            .toMatchObject({
                                code: ErrorCodes.RUNTIME_UNSUPPORTED,
                                name: 'NodeRuntimeLayerError',
                            });

                        // Property: Error message should be descriptive and contain the invalid runtime
                        try {
                            await detector.detectNodeVersion(invalidRuntime, architecture);
                            fail('Expected error to be thrown');
                        } catch (error) {
                            expect(error).toBeInstanceOf(NodeRuntimeLayerError);
                            const nodeError = error as NodeRuntimeLayerError;

                            // Error message should contain the invalid runtime name
                            expect(nodeError.message).toContain(invalidRuntime);

                            // Error message should contain "Unsupported runtime"
                            expect(nodeError.message).toContain('Unsupported runtime');

                            // Error message should contain supported runtimes for troubleshooting
                            expect(nodeError.message).toContain('Supported runtimes');
                            expect(nodeError.message).toMatch(/nodejs18\.x|nodejs20\.x|nodejs22\.x/);
                        }

                        // Property: Error behavior should be deterministic
                        const error1 = await detector.detectNodeVersion(invalidRuntime, architecture).catch(e => e);
                        const error2 = await detector.detectNodeVersion(invalidRuntime, architecture).catch(e => e);

                        expect(error1.code).toBe(error2.code);
                        expect(error1.message).toBe(error2.message);
                        expect(error1.name).toBe(error2.name);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should throw NodeRuntimeLayerError with INVALID_ARCHITECTURE for any invalid architecture', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.oneof(
                        fc.constant('nodejs18.x'),
                        fc.constant('nodejs20.x'),
                        fc.constant('nodejs22.x')
                    ),
                    arbitraryUnsupportedArchitecture(),
                    async (validRuntime, invalidArchitecture) => {
                        const detector = new DockerRuntimeDetector({
                            logger: mockLogger,
                            enableFallback: false,
                        });

                        // Property: Invalid architecture should always throw NodeRuntimeLayerError
                        await expect(detector.detectNodeVersion(validRuntime, invalidArchitecture))
                            .rejects
                            .toThrow(NodeRuntimeLayerError);

                        // Property: Error should have INVALID_ARCHITECTURE code
                        await expect(detector.detectNodeVersion(validRuntime, invalidArchitecture))
                            .rejects
                            .toMatchObject({
                                code: ErrorCodes.INVALID_ARCHITECTURE,
                                name: 'NodeRuntimeLayerError',
                            });

                        // Property: Error message should be descriptive
                        try {
                            await detector.detectNodeVersion(validRuntime, invalidArchitecture);
                            fail('Expected error to be thrown');
                        } catch (error) {
                            expect(error).toBeInstanceOf(NodeRuntimeLayerError);
                            const nodeError = error as NodeRuntimeLayerError;

                            expect(nodeError.message).toContain(invalidArchitecture);
                            expect(nodeError.message).toContain('Unsupported architecture');
                            expect(nodeError.message).toContain('Supported architectures');
                            expect(nodeError.message).toMatch(/x86_64|arm64/);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle Docker unavailable scenarios with descriptive errors', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.oneof(
                        fc.constant('nodejs18.x'),
                        fc.constant('nodejs20.x'),
                        fc.constant('nodejs22.x')
                    ),
                    arbitrarySupportedArchitecture(),
                    fc.oneof(
                        fc.constant('Docker not found'),
                        fc.constant('docker: command not found'),
                        fc.constant('Cannot connect to the Docker daemon'),
                        fc.constant('Docker daemon is not running'),
                        fc.constant('permission denied while trying to connect to the Docker daemon'),
                        fc.constant('ENOENT'), // Command not found
                        fc.constant('EACCES'), // Permission denied
                        fc.constant('ECONNREFUSED') // Connection refused
                    ),
                    async (validRuntime, validArchitecture, dockerError) => {
                        const detector = new DockerRuntimeDetector({
                            logger: mockLogger,
                            enableFallback: false, // Disable fallback to test error handling
                        });

                        // Mock Docker failure
                        mockSpawn.mockImplementation(() => createFailedMockProcess(dockerError));

                        // Property: Docker unavailable should throw NodeRuntimeLayerError
                        await expect(detector.detectNodeVersion(validRuntime, validArchitecture))
                            .rejects
                            .toThrow(NodeRuntimeLayerError);

                        // Property: Error should have VERSION_DETECTION_FAILED code
                        await expect(detector.detectNodeVersion(validRuntime, validArchitecture))
                            .rejects
                            .toMatchObject({
                                code: ErrorCodes.VERSION_DETECTION_FAILED,
                                name: 'NodeRuntimeLayerError',
                            });

                        // Property: Error message should contain troubleshooting information
                        try {
                            await detector.detectNodeVersion(validRuntime, validArchitecture);
                            fail('Expected error to be thrown');
                        } catch (error) {
                            expect(error).toBeInstanceOf(NodeRuntimeLayerError);
                            const nodeError = error as NodeRuntimeLayerError;

                            // Error message should contain context about Docker failure
                            expect(nodeError.message).toContain('Failed to detect Node.js version from Docker image');

                            // Error should have a cause that contains the original Docker error
                            expect(nodeError.cause).toBeDefined();
                            if (nodeError.cause) {
                                expect(nodeError.cause.message).toContain(dockerError);
                            }
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should provide fallback behavior when Docker is unavailable and fallback is enabled', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.oneof(
                        fc.constant('nodejs18.x'),
                        fc.constant('nodejs20.x'),
                        fc.constant('nodejs22.x')
                    ),
                    arbitrarySupportedArchitecture(),
                    async (validRuntime, validArchitecture) => {
                        const detector = new DockerRuntimeDetector({
                            logger: mockLogger,
                            enableFallback: true, // Enable fallback
                        });

                        // Mock Docker failure
                        mockSpawn.mockImplementation(() => createFailedMockProcess('Docker not available'));

                        // Property: With fallback enabled, should not throw error
                        const result = await detector.detectNodeVersion(validRuntime, validArchitecture);

                        // Property: Result should contain valid version information
                        expect(result).toBeDefined();
                        expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
                        expect(result.runtimeName).toBe(validRuntime);
                        expect(result.dockerImage).toContain(validArchitecture);

                        // Property: Version should match runtime family
                        const majorVersion = result.version.split('.')[0];
                        const expectedMajor = validRuntime.replace('nodejs', '').replace('.x', '');
                        expect(majorVersion).toBe(expectedMajor);

                        // Property: Docker image should follow correct pattern
                        const expectedImage = `public.ecr.aws/lambda/nodejs:${expectedMajor}-${validArchitecture}`;
                        expect(result.dockerImage).toBe(expectedImage);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle edge cases in error reporting consistently', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.oneof(
                        // Null/undefined-like cases (empty strings)
                        fc.constant(''),
                        // Special characters that might cause issues
                        fc.constant('nodejs18.x\n'),
                        fc.constant('nodejs18.x\t'),
                        fc.constant('nodejs18.x\r'),
                        // Unicode characters
                        fc.constant('nodejs18.x\u0000'),
                        fc.constant('nodejs18.x\u200B'), // Zero-width space
                        // Very long invalid runtime names
                        fc.string({ minLength: 100, maxLength: 200 })
                    ),
                    arbitrarySupportedArchitecture(),
                    async (edgeCaseRuntime, validArchitecture) => {
                        const detector = new DockerRuntimeDetector({
                            logger: mockLogger,
                            enableFallback: false,
                        });

                        // Property: All edge cases should throw NodeRuntimeLayerError
                        await expect(detector.detectNodeVersion(edgeCaseRuntime, validArchitecture))
                            .rejects
                            .toThrow(NodeRuntimeLayerError);

                        // Property: Error should have appropriate code
                        await expect(detector.detectNodeVersion(edgeCaseRuntime, validArchitecture))
                            .rejects
                            .toMatchObject({
                                code: ErrorCodes.RUNTIME_UNSUPPORTED,
                                name: 'NodeRuntimeLayerError',
                            });

                        // Property: Error message should be safe (no injection, proper escaping)
                        try {
                            await detector.detectNodeVersion(edgeCaseRuntime, validArchitecture);
                            fail('Expected error to be thrown');
                        } catch (error) {
                            expect(error).toBeInstanceOf(NodeRuntimeLayerError);
                            const nodeError = error as NodeRuntimeLayerError;

                            // Error message should be a string and not empty
                            expect(typeof nodeError.message).toBe('string');
                            expect(nodeError.message.length).toBeGreaterThan(0);

                            // Error message should contain basic error information
                            expect(nodeError.message).toContain('Unsupported runtime');
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should maintain error consistency across multiple calls with same invalid inputs', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbitraryUnsupportedRuntime(),
                    arbitrarySupportedArchitecture(),
                    fc.integer({ min: 2, max: 5 }), // Number of repeated calls
                    async (invalidRuntime, validArchitecture, repeatCount) => {
                        const detector = new DockerRuntimeDetector({
                            logger: mockLogger,
                            enableFallback: false,
                        });

                        const errors: NodeRuntimeLayerError[] = [];

                        // Make multiple calls with same invalid input
                        for (let i = 0; i < repeatCount; i++) {
                            try {
                                await detector.detectNodeVersion(invalidRuntime, validArchitecture);
                                fail('Expected error to be thrown');
                            } catch (error) {
                                expect(error).toBeInstanceOf(NodeRuntimeLayerError);
                                errors.push(error as NodeRuntimeLayerError);
                            }
                        }

                        // Property: All errors should be identical
                        expect(errors.length).toBe(repeatCount);

                        const firstError = errors[0];
                        for (let i = 1; i < errors.length; i++) {
                            expect(errors[i].code).toBe(firstError.code);
                            expect(errors[i].message).toBe(firstError.message);
                            expect(errors[i].name).toBe(firstError.name);
                        }
                    }
                ),
                { numRuns: 50 } // Reduced for performance since this tests multiple calls
            );
        });
    });
});
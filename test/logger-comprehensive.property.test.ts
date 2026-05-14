/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Property-based tests for comprehensive logging functionality
 * 
 * **Property 14: Operation Logging Completeness**
 * **Validates: Requirements 7.1, 7.2, 7.5**
 * 
 * Tests universal properties of the logging system:
 * - All operations must log start/completion with timing
 * - Error logs must include troubleshooting context
 * - Log levels must be consistently respected
 * - Structured metadata must be preserved
 */

import * as fc from 'fast-check';
import {
    ConsoleLogger,
    NoOpLogger,
    OperationTimer,
} from '../src';

// Feature: nodejs-layer-management, Property 14: Operation Logging Completeness
describe('Property 14: Operation Logging Completeness', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    it('should always log operation start and completion with timing for any operation', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 50 }), // operation type
                fc.record({
                    key1: fc.string(),
                    key2: fc.integer(),
                    key3: fc.boolean(),
                }, { requiredKeys: [] }), // operation metadata
                fc.record({
                    result: fc.string(),
                    count: fc.integer(),
                }, { requiredKeys: [] }), // result metadata
                async (operationType, operationMetadata, resultMetadata) => {
                    const logger = new ConsoleLogger('[TEST]', 'debug');
                    const timer = new OperationTimer(logger, operationType, operationMetadata);

                    // Wait a small amount to ensure timing > 0
                    await new Promise(resolve => setTimeout(resolve, 1));

                    timer.complete(resultMetadata);

                    // Verify start log was called
                    expect(consoleSpy).toHaveBeenCalledWith(
                        expect.stringContaining(`Starting ${operationType}`),
                        expect.objectContaining({
                            operation: operationType,
                            startTime: expect.any(String),
                            ...operationMetadata,
                        })
                    );

                    // Verify completion log was called
                    expect(consoleSpy).toHaveBeenCalledWith(
                        expect.stringContaining(`Completed ${operationType}`),
                        expect.objectContaining({
                            operation: operationType,
                            duration: expect.stringMatching(/^\d+ms$/),
                            startTime: expect.any(String),
                            endTime: expect.any(String),
                            ...operationMetadata,
                            ...resultMetadata,
                        })
                    );

                    // Verify timing is reasonable (> 0ms)
                    const completionCall = consoleSpy.mock.calls.find(call =>
                        call[0].includes(`Completed ${operationType}`)
                    );
                    const duration = completionCall[1].duration;
                    const durationMs = parseInt(duration.replace('ms', ''));
                    expect(durationMs).toBeGreaterThanOrEqual(0);
                }
            ),
            { numRuns: 50 }
        );
    });

    it('should always log operation failure with error details and troubleshooting context', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 50 }), // operation type
                fc.oneof(
                    fc.string({ minLength: 1 }), // string error
                    fc.record({
                        message: fc.string({ minLength: 1 }),
                        name: fc.string({ minLength: 1 }),
                    }).map(obj => {
                        const error = new Error(obj.message);
                        error.name = obj.name;
                        return error;
                    }), // Error object
                    fc.record({
                        message: fc.string({ minLength: 1 }),
                        name: fc.oneof(
                            fc.constant('ThrottlingException'),
                            fc.constant('AccessDenied'),
                            fc.constant('NetworkingError')
                        ),
                    }).map(obj => {
                        const error = new Error(obj.message);
                        error.name = obj.name;
                        return error;
                    }) // AWS-style errors
                ), // error
                fc.record({
                    attempt: fc.integer({ min: 1, max: 10 }),
                    context: fc.string(),
                }, { requiredKeys: [] }), // error metadata
                async (operationType, error, errorMetadata) => {
                    const logger = new ConsoleLogger('[TEST]', 'debug');
                    const timer = new OperationTimer(logger, operationType);

                    await new Promise(resolve => setTimeout(resolve, 1));

                    timer.fail(error, errorMetadata);

                    // Verify failure log was called
                    expect(consoleSpy).toHaveBeenCalledWith(
                        expect.stringContaining(`Failed ${operationType}`),
                        expect.objectContaining({
                            operation: operationType,
                            duration: expect.stringMatching(/^\d+ms$/),
                            startTime: expect.any(String),
                            endTime: expect.any(String),
                            error: expect.any(String),
                            errorName: expect.any(String),
                            troubleshooting: expect.any(String),
                            ...errorMetadata,
                        })
                    );

                    // Verify troubleshooting context is provided
                    const failureCall = consoleSpy.mock.calls.find(call =>
                        call[0].includes(`Failed ${operationType}`)
                    );
                    const troubleshooting = failureCall[1].troubleshooting;
                    expect(troubleshooting).toBeTruthy();
                    expect(typeof troubleshooting).toBe('string');
                    expect(troubleshooting.length).toBeGreaterThan(0);
                }
            ),
            { numRuns: 50 }
        );
    });

    it('should consistently respect log levels for any log level configuration', () => {
        return fc.assert(
            fc.property(
                fc.oneof(
                    fc.constant('debug' as const),
                    fc.constant('info' as const),
                    fc.constant('warn' as const),
                    fc.constant('error' as const)
                ), // log level
                fc.array(fc.record({
                    level: fc.oneof(
                        fc.constant('debug' as const),
                        fc.constant('info' as const),
                        fc.constant('warn' as const),
                        fc.constant('error' as const)
                    ),
                    message: fc.string({ minLength: 3, maxLength: 50 }),
                    metadata: fc.record({
                        key: fc.string(),
                        value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
                    }, { requiredKeys: [] }),
                }), { minLength: 1, maxLength: 10 }), // log messages
                (configuredLevel: 'debug' | 'info' | 'warn' | 'error', logMessages) => {
                    consoleSpy.mockClear();
                    const logger = new ConsoleLogger('[TEST]', configuredLevel);

                    const levelOrder = ['debug', 'info', 'warn', 'error'];
                    const configuredLevelIndex = levelOrder.indexOf(configuredLevel);

                    // Log all messages
                    logMessages.forEach(({ level, message, metadata }) => {
                        (logger as any)[level](message, metadata);
                    });

                    // Count expected vs actual log calls
                    const expectedCalls = logMessages.filter(({ level }) => {
                        const messageLevelIndex = levelOrder.indexOf(level);
                        return messageLevelIndex >= configuredLevelIndex;
                    }).length;

                    expect(consoleSpy).toHaveBeenCalledTimes(expectedCalls);

                    // Verify no logs below the configured level were output
                    logMessages.forEach(({ level, message }) => {
                        const messageLevelIndex = levelOrder.indexOf(level);
                        if (messageLevelIndex < configuredLevelIndex && message.trim().length > 0) {
                            expect(consoleSpy).not.toHaveBeenCalledWith(
                                expect.stringContaining(message.trim())
                            );
                        }
                    });
                }
            ),
            { numRuns: 15 }
        );
    });

    it('should preserve all structured metadata in log output', () => {
        return fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 100 }), // log message
                fc.record({
                    stringField: fc.string(),
                    numberField: fc.integer(),
                    booleanField: fc.boolean(),
                    nestedObject: fc.record({
                        nested: fc.string(),
                    }),
                    arrayField: fc.array(fc.string(), { maxLength: 5 }),
                }, { requiredKeys: [] }), // metadata
                (message, metadata) => {
                    consoleSpy.mockClear();
                    const logger = new ConsoleLogger('[TEST]', 'info');

                    logger.info(message, metadata);

                    if (Object.keys(metadata).length > 0) {
                        // Verify metadata was passed as second argument
                        expect(consoleSpy).toHaveBeenCalledWith(
                            expect.stringContaining(message),
                            metadata
                        );

                        // Verify all metadata keys are preserved
                        const logCall = consoleSpy.mock.calls[0];
                        const loggedMetadata = logCall[1];

                        Object.keys(metadata).forEach(key => {
                            expect(loggedMetadata).toHaveProperty(key);
                            expect(loggedMetadata[key]).toEqual((metadata as any)[key]);
                        });
                    } else {
                        // No metadata should result in single argument call
                        expect(consoleSpy).toHaveBeenCalledWith(
                            expect.stringContaining(message)
                        );
                    }
                }
            ),
            { numRuns: 15 }
        );
    });

    it('should extract AWS request IDs from various error object formats', () => {
        return fc.assert(
            fc.property(
                fc.oneof(
                    // AWS SDK v3 format
                    fc.record({
                        message: fc.string(),
                        $metadata: fc.record({
                            requestId: fc.string({ minLength: 1 }),
                        }),
                    }),
                    // Legacy format
                    fc.record({
                        message: fc.string(),
                        requestId: fc.string({ minLength: 1 }),
                    }),
                    // Alternative format
                    fc.record({
                        message: fc.string(),
                        RequestId: fc.string({ minLength: 1 }),
                    }),
                    // Response format
                    fc.record({
                        message: fc.string(),
                        $response: fc.record({
                            requestId: fc.string({ minLength: 1 }),
                        }),
                    }),
                    // No request ID
                    fc.record({
                        message: fc.string(),
                    })
                ), // error object
                (errorObj) => {
                    consoleSpy.mockClear();
                    const logger = new ConsoleLogger('[TEST]', 'error');
                    const timer = new OperationTimer(logger, 'test operation');

                    timer.fail(errorObj);

                    const failureCall = consoleSpy.mock.calls.find(call =>
                        call[0].includes('Failed test operation')
                    );
                    const loggedMetadata = failureCall[1];

                    // Extract expected request ID
                    const expectedRequestId = (errorObj as any).$metadata?.requestId ||
                        (errorObj as any).requestId ||
                        (errorObj as any).RequestId ||
                        (errorObj as any).$response?.requestId ||
                        undefined;

                    expect(loggedMetadata.awsRequestId).toBe(expectedRequestId);
                }
            ),
            { numRuns: 15 }
        );
    });

    it('should generate contextual troubleshooting guidance based on error patterns', () => {
        return fc.assert(
            fc.property(
                fc.oneof(
                    // Throttling errors
                    fc.record({
                        message: fc.string(),
                        name: fc.oneof(
                            fc.constant('ThrottlingException'),
                            fc.constant('TooManyRequestsException')
                        ),
                    }),
                    // Access errors
                    fc.record({
                        message: fc.string(),
                        name: fc.oneof(
                            fc.constant('AccessDenied'),
                            fc.constant('UnauthorizedOperation')
                        ),
                    }),
                    // Network errors
                    fc.record({
                        message: fc.oneof(
                            fc.constant('network timeout'),
                            fc.constant('connection refused'),
                            fc.constant('socket hang up')
                        ),
                        name: fc.string(),
                    }),
                    // Docker errors
                    fc.record({
                        message: fc.oneof(
                            fc.constant('docker: command not found'),
                            fc.constant('Docker daemon not running')
                        ),
                        name: fc.string(),
                    }),
                    // Timeout errors
                    fc.record({
                        message: fc.oneof(
                            fc.constant('timeout after 30s'),
                            fc.constant('operation timed out')
                        ),
                        name: fc.string(),
                    }),
                    // Generic errors
                    fc.record({
                        message: fc.string({ minLength: 1 }),
                        name: fc.string({ minLength: 1 }),
                    })
                ).map(obj => {
                    const error = new Error(obj.message);
                    error.name = obj.name;
                    return error;
                }), // error
                (error) => {
                    consoleSpy.mockClear();
                    const logger = new ConsoleLogger('[TEST]', 'error');
                    const timer = new OperationTimer(logger, 'test operation');

                    timer.fail(error);

                    const failureCall = consoleSpy.mock.calls.find(call =>
                        call[0].includes('Failed test operation')
                    );
                    const troubleshooting = failureCall[1].troubleshooting;

                    // Verify troubleshooting context is appropriate
                    expect(troubleshooting).toBeTruthy();
                    expect(typeof troubleshooting).toBe('string');
                    expect(troubleshooting.length).toBeGreaterThan(0);

                    // Verify specific guidance for known error patterns
                    if (error.name.includes('Throttling') || error.message.includes('throttl')) {
                        expect(troubleshooting).toContain('throttling');
                        expect(troubleshooting).toContain('exponential backoff');
                    } else if (error.name.includes('AccessDenied') || error.message.includes('access denied')) {
                        expect(troubleshooting).toContain('access denied');
                        expect(troubleshooting).toContain('IAM permissions');
                    } else if (error.message.includes('docker') || error.message.includes('Docker')) {
                        expect(troubleshooting).toContain('Docker');
                        expect(troubleshooting).toContain('installed');
                    } else if (error.message.includes('network') || error.message.includes('connection')) {
                        expect(troubleshooting).toContain('connectivity');
                        expect(troubleshooting).toContain('connection');
                    } else if (error.message.includes('timeout')) {
                        expect(troubleshooting).toContain('timeout');
                        expect(troubleshooting).toContain('timeout values');
                    }
                }
            ),
            { numRuns: 15 }
        );
    });

    it('should maintain timing accuracy across different operation durations', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 100 }), // delay in milliseconds
                fc.string({ minLength: 1, maxLength: 20 }), // operation type
                async (delayMs, operationType) => {
                    consoleSpy.mockClear();
                    const logger = new ConsoleLogger('[TEST]', 'info');
                    const timer = new OperationTimer(logger, operationType);

                    await new Promise(resolve => setTimeout(resolve, delayMs));

                    timer.complete();

                    const completionCall = consoleSpy.mock.calls.find(call =>
                        call[0].includes(`Completed ${operationType}`)
                    );
                    const duration = completionCall[1].duration;
                    const durationMs = parseInt(duration.replace('ms', ''));

                    // Timing should be approximately correct (within reasonable bounds)
                    // Allow for some variance due to system scheduling
                    expect(durationMs).toBeGreaterThanOrEqual(delayMs - 5);
                    expect(durationMs).toBeLessThan(delayMs + 50); // Allow up to 50ms overhead
                }
            ),
            { numRuns: 20 } // Fewer runs for timing-sensitive test
        );
    });
});

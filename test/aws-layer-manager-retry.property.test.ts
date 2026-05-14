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
 * Property-Based Tests for AWS API Retry Logic
 *
 * Feature: nodejs-layer-management, Property 11: AWS API Retry Logic
 *
 * Property 11: AWS API Retry Logic
 * *For any* retryable AWS API failure (throttling, temporary service errors), the Layer_Manager
 * should implement exponential backoff retry logic with appropriate jitter and maximum retry limits.
 *
 * **Validates: Requirements 6.1, 6.5**
 * - Req 6.1: When AWS API calls fail with retryable errors, the Layer_Manager shall implement exponential backoff retry logic
 * - Req 6.5: When rate limits are exceeded, the Layer_Manager shall respect AWS API throttling and retry appropriately
 *
 * @module aws-layer-manager-retry.property.test
 */

import * as fc from 'fast-check';
import { AWSLayerManager } from '../src/aws-layer-manager';
import { NodeRuntimeLayerError, ErrorCodes } from '../src/nodejs-layer-manager';
import { ConsoleLogger } from '../src/logger';

// Mock AWS SDK
jest.mock('@aws-sdk/client-lambda');

/**
 * Retryable AWS error types that should trigger exponential backoff.
 */
const RETRYABLE_ERROR_TYPES = [
    'ThrottlingException',
    'TooManyRequestsException',
    'RequestLimitExceeded',
    'Throttling',
    'ServiceUnavailableException',
    'ServiceUnavailable',
    'InternalServerError',
    'InternalError',
    'InternalFailure',
    'RequestTimeout',
    'TimeoutError',
    'NetworkingError',
    'ConnectionError',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    'ProvisionedThroughputExceededException',
    'RequestTimeoutException',
    'PriorRequestNotComplete',
    'SlowDown',
] as const;

/**
 * Non-retryable AWS error types that should fail immediately.
 */
const NON_RETRYABLE_ERROR_TYPES = [
    'ValidationException',
    'InvalidParameterValueException',
    'ResourceNotFoundException',
    'AccessDeniedException',
    'UnauthorizedOperation',
    'InvalidUserID.NotFound',
    'AuthFailure',
    'SignatureDoesNotMatch',
    'TokenRefreshRequired',
    'ExpiredToken',
    'InvalidAccessKeyId',
    'InvalidSecurityToken',
] as const;

/**
 * Network error codes that should be retryable.
 */
const NETWORK_ERROR_CODES = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EPIPE',
    'EHOSTUNREACH',
    'ENETUNREACH',
] as const;

/**
 * Arbitrary generator for retryable AWS errors.
 */
const retryableError = (): fc.Arbitrary<Error> =>
    fc.oneof(
        // Standard AWS service errors
        fc.constantFrom(...RETRYABLE_ERROR_TYPES).map(name => {
            const error = new Error(`AWS service temporarily unavailable: ${name}`);
            error.name = name;
            return error;
        }),

        // Network errors with error codes
        fc.constantFrom(...NETWORK_ERROR_CODES).map(code => {
            const error = new Error(`Network connection failed`) as any;
            error.code = code;
            return error;
        })
    );

/**
 * Arbitrary generator for non-retryable AWS errors.
 */
const nonRetryableError = (): fc.Arbitrary<Error> =>
    fc.constantFrom(...NON_RETRYABLE_ERROR_TYPES).map(name => {
        const error = new Error(`Access denied or invalid parameter`);
        error.name = name;
        return error;
    });

/**
 * Arbitrary generator for retry configuration options.
 */
const retryConfig = (): fc.Arbitrary<{
    maxRetries: number;
    retryBaseDelay: number;
    circuitBreakerFailureThreshold: number;
    circuitBreakerTimeout: number;
    circuitBreakerSuccessThreshold: number;
}> =>
    fc.record({
        maxRetries: fc.integer({ min: 1, max: 5 }),
        retryBaseDelay: fc.integer({ min: 100, max: 2000 }),
        circuitBreakerFailureThreshold: fc.integer({ min: 2, max: 10 }),
        circuitBreakerTimeout: fc.integer({ min: 1000, max: 10000 }),
        circuitBreakerSuccessThreshold: fc.integer({ min: 1, max: 5 }),
    });

/**
 * Mock operation that can be configured to succeed or fail.
 */
class MockOperation {
    private callCount = 0;
    private readonly failurePattern: boolean[];
    private readonly errors: Error[];

    constructor(failurePattern: boolean[], errors: Error[]) {
        this.failurePattern = failurePattern;
        this.errors = errors;
    }

    async execute(): Promise<string> {
        const shouldFail = this.failurePattern[this.callCount] ?? false;
        const error = this.errors[this.callCount] ?? new Error('Unknown error');

        this.callCount++;

        if (shouldFail) {
            throw error;
        }

        return `success-${this.callCount}`;
    }

    getCallCount(): number {
        return this.callCount;
    }

    reset(): void {
        this.callCount = 0;
    }
}

/**
 * Test helper to capture timing information for delay validation.
 */
class TimingCapture {
    private timestamps: number[] = [];

    captureTime(): void {
        this.timestamps.push(Date.now());
    }

    getDelays(): number[] {
        const delays: number[] = [];
        for (let i = 1; i < this.timestamps.length; i++) {
            delays.push(this.timestamps[i] - this.timestamps[i - 1]);
        }
        return delays;
    }

    reset(): void {
        this.timestamps = [];
    }
}

// Feature: nodejs-layer-management, Property 11: AWS API Retry Logic
describe('Feature: nodejs-layer-management, Property 11: AWS API Retry Logic', () => {
    let layerManager: AWSLayerManager;
    let mockLogger: jest.Mocked<ConsoleLogger>;
    let originalDateNow: typeof Date.now;
    let mockTime = 0;

    beforeEach(() => {
        // Mock Date.now for deterministic timing tests
        originalDateNow = Date.now;
        Date.now = jest.fn(() => mockTime);

        // Mock setTimeout to avoid actual delays in tests
        jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
            // Immediately execute callback to avoid delays
            if (typeof callback === 'function') {
                callback();
            }
            return {} as any;
        });

        // Create mock logger
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        } as any;

        // Reset all mocks before each test
        jest.clearAllMocks();
    });

    afterEach(() => {
        Date.now = originalDateNow;
        jest.restoreAllMocks();
        if (layerManager) {
            layerManager.destroy();
        }
    });

    /**
     * **Property 11: AWS API Retry Logic**
     * **Validates: Requirements 6.1, 6.5**
     * 
     * For any retryable AWS API error, the system should implement exponential backoff
     * retry logic with proper jitter and respect rate limiting.
     */
    describe('Property 11: AWS API Retry Logic', () => {
        /**
         * **Validates: Requirement 6.1**
         *
         * For any retryable error and retry configuration, the system should
         * attempt retries up to maxRetries with exponential backoff delays.
         */
        it('should implement exponential backoff for retryable errors', () => {
            return fc.assert(
                fc.asyncProperty(
                    retryableError(),
                    retryConfig(),
                    fc.integer({ min: 1, max: 4 }), // failure count
                    async (error, config, failureCount) => {
                        // Create fresh mock logger for this test iteration
                        const testLogger = {
                            debug: jest.fn(),
                            info: jest.fn(),
                            warn: jest.fn(),
                            error: jest.fn(),
                        } as any;

                        layerManager = new AWSLayerManager({
                            ...config,
                            logger: testLogger,
                        });

                        // Create failure pattern: fail N times, then succeed
                        const failurePattern = Array(failureCount).fill(true).concat([false]);
                        const errors = Array(failureCount).fill(error);
                        const mockOp = new MockOperation(failurePattern, errors);

                        // Execute operation with retry logic
                        const result = await (layerManager as any).executeWithRetry(() => mockOp.execute());

                        // Verify success after retries
                        expect(result).toMatch(/^success-\d+$/);
                        expect(mockOp.getCallCount()).toBe(failureCount + 1);

                        // Verify retry warnings were logged
                        const retryWarnings = testLogger.warn.mock.calls.filter((call: any) =>
                            call[0].includes('AWS API operation failed, retrying')
                        );
                        expect(retryWarnings.length).toBe(failureCount);

                        // Verify each retry warning contains proper metadata
                        retryWarnings.forEach((call: any, index: number) => {
                            const metadata = call[1] as any;
                            expect(metadata).toHaveProperty('attempt', index + 1);
                            expect(metadata).toHaveProperty('maxRetries', config.maxRetries);
                            expect(metadata).toHaveProperty('delay');
                            expect(metadata).toHaveProperty('isRetryable', true);
                        });

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });

        /**
         * **Validates: Requirement 6.5**
         *
         * For any rate limiting error (throttling), the system should respect
         * AWS API throttling and implement appropriate backoff.
         */
        it('should respect rate limiting with appropriate backoff', () => {
            return fc.assert(
                fc.asyncProperty(
                    fc.constantFrom('ThrottlingException', 'TooManyRequestsException', 'RequestLimitExceeded'),
                    retryConfig(),
                    fc.integer({ min: 1, max: 3 }), // throttling occurrences
                    async (throttlingErrorName, config, throttleCount) => {
                        // Create fresh mock logger for this test iteration
                        const testLogger = {
                            debug: jest.fn(),
                            info: jest.fn(),
                            warn: jest.fn(),
                            error: jest.fn(),
                        } as any;

                        layerManager = new AWSLayerManager({
                            ...config,
                            logger: testLogger,
                        });

                        // Create throttling error with proper name - this ensures we test actual throttling
                        const throttlingError = new Error('Rate limit exceeded');
                        throttlingError.name = throttlingErrorName;

                        // Ensure throttle count doesn't exceed max retries for successful completion
                        const effectiveThrottleCount = Math.min(throttleCount, config.maxRetries);

                        // Create pattern: throttle N times, then succeed
                        const failurePattern = Array(effectiveThrottleCount).fill(true).concat([false]);
                        const errors = Array(effectiveThrottleCount).fill(throttlingError);
                        const mockOp = new MockOperation(failurePattern, errors);

                        // Execute operation
                        const result = await (layerManager as any).executeWithRetry(() => mockOp.execute());

                        // Verify success after throttling
                        expect(result).toMatch(/^success-\d+$/);
                        expect(mockOp.getCallCount()).toBe(effectiveThrottleCount + 1);

                        // Verify throttling was handled as retryable
                        const retryWarnings = testLogger.warn.mock.calls.filter((call: any) =>
                            call[0].includes('AWS API operation failed, retrying')
                        );
                        expect(retryWarnings.length).toBe(effectiveThrottleCount);

                        // Verify each retry indicates it's retryable and has correct error name
                        retryWarnings.forEach((call: any) => {
                            const metadata = call[1] as any;
                            expect(metadata.isRetryable).toBe(true);
                            expect(metadata.errorName).toBe(throttlingErrorName);
                        });

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });

        /**
         * **Validates: Requirements 6.1, 6.5**
         *
         * For any retry configuration, when maximum retries are exceeded,
         * the system should fail with the last error.
         */
        it('should fail after exhausting maximum retries', () => {
            return fc.assert(
                fc.asyncProperty(
                    retryableError(),
                    retryConfig(),
                    async (error, config) => {
                        // Create fresh mock logger for this test iteration
                        const testLogger = {
                            debug: jest.fn(),
                            info: jest.fn(),
                            warn: jest.fn(),
                            error: jest.fn(),
                        } as any;

                        layerManager = new AWSLayerManager({
                            ...config,
                            logger: testLogger,
                        });

                        // Create pattern that always fails (more than maxRetries)
                        const failurePattern = Array(config.maxRetries + 2).fill(true);
                        const errors = Array(config.maxRetries + 2).fill(error);
                        const mockOp = new MockOperation(failurePattern, errors);

                        // Execute operation and expect failure
                        let thrownError: Error | undefined;
                        try {
                            await (layerManager as any).executeWithRetry(() => mockOp.execute());
                        } catch (e) {
                            thrownError = e as Error;
                        }

                        // Verify failure with last error
                        expect(thrownError).toBe(error);
                        expect(mockOp.getCallCount()).toBe(config.maxRetries + 1);

                        // Verify correct number of retry attempts
                        const retryWarnings = testLogger.warn.mock.calls.filter((call: any) =>
                            call[0].includes('AWS API operation failed, retrying')
                        );
                        expect(retryWarnings.length).toBe(config.maxRetries);

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });

        /**
         * **Validates: Requirements 6.1, 6.5**
         *
         * For any circuit breaker configuration, the circuit should track
         * failures and maintain proper state information.
         */
        it('should implement circuit breaker pattern correctly', () => {
            return fc.assert(
                fc.asyncProperty(
                    retryableError(),
                    retryConfig(),
                    async (error, config) => {
                        // Create fresh mock logger for this test iteration
                        const testLogger = {
                            debug: jest.fn(),
                            info: jest.fn(),
                            warn: jest.fn(),
                            error: jest.fn(),
                        } as any;

                        layerManager = new AWSLayerManager({
                            ...config,
                            logger: testLogger,
                        });

                        // Get initial circuit breaker state
                        const initialState = layerManager.getCircuitBreakerState();
                        expect(initialState.state).toBe('CLOSED');

                        // Test circuit breaker failure tracking - run operations until circuit opens
                        let totalOperations = 0;
                        let circuitBreakerErrors = 0;

                        // Run operations until circuit breaker opens or we exceed reasonable limit
                        while (totalOperations < config.circuitBreakerFailureThreshold * 2) {
                            const failurePattern = Array(config.maxRetries + 1).fill(true);
                            const errors = Array(config.maxRetries + 1).fill(error);
                            const mockOp = new MockOperation(failurePattern, errors);

                            try {
                                await (layerManager as any).executeWithRetry(() => mockOp.execute());
                                // Unexpected success
                                break;
                            } catch (e) {
                                totalOperations++;

                                // Check if this is a circuit breaker error (fail-fast)
                                if (e instanceof Error && e.message.includes('Circuit breaker is OPEN')) {
                                    circuitBreakerErrors++;
                                    break; // Circuit breaker opened, stop testing
                                }
                                // Otherwise it's a normal retry exhaustion error
                            }
                        }

                        // Verify circuit breaker state after operations
                        const finalState = layerManager.getCircuitBreakerState();

                        // Circuit breaker should have tracked failures
                        expect(finalState.failureCount).toBeGreaterThan(initialState.failureCount);

                        // Test that circuit breaker tracks state correctly
                        expect(['CLOSED', 'OPEN', 'HALF_OPEN']).toContain(finalState.state);

                        // If circuit breaker opened, verify it's preventing operations
                        if (circuitBreakerErrors > 0) {
                            expect(finalState.state).toBe('OPEN');
                        }

                        return true;
                    }
                ),
                { numRuns: 50 } // Reduced for circuit breaker complexity
            );
        });

        /**
         * **Validates: Requirements 6.1, 6.5**
         *
         * For any exponential backoff configuration, delays should increase
         * exponentially with each retry attempt.
         */
        it('should calculate exponential backoff delays correctly', () => {
            return fc.assert(
                fc.property(
                    retryConfig(),
                    fc.integer({ min: 0, max: 4 }), // attempt number
                    (config, attempt) => {
                        layerManager = new AWSLayerManager({
                            ...config,
                            logger: mockLogger,
                        });

                        // Access private method for testing delay calculation
                        const delay = (layerManager as any).calculateRetryDelay(attempt);

                        // Verify exponential growth pattern
                        const expectedBaseDelay = config.retryBaseDelay * Math.pow(2, attempt);

                        // Delay should be within jitter range (90% to 110% of base)
                        const minDelay = expectedBaseDelay * 0.9;
                        const maxDelay = expectedBaseDelay * 1.1;

                        expect(delay).toBeGreaterThanOrEqual(Math.floor(minDelay));
                        expect(delay).toBeLessThanOrEqual(Math.ceil(maxDelay));

                        // Verify delay is reasonable (not negative, not excessive)
                        expect(delay).toBeGreaterThan(0);
                        expect(delay).toBeLessThan(config.retryBaseDelay * Math.pow(2, attempt + 1));

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });

        /**
         * **Validates: Requirements 6.1, 6.5**
         *
         * For any error type, the retry logic should correctly classify
         * errors as retryable or non-retryable.
         */
        it('should correctly classify error types for retry decisions', () => {
            return fc.assert(
                fc.property(
                    fc.oneof(retryableError(), nonRetryableError()),
                    retryConfig(),
                    (error, config) => {
                        layerManager = new AWSLayerManager({
                            ...config,
                            logger: mockLogger,
                        });

                        // Access private method for testing error classification
                        const isRetryable = (layerManager as any).isRetryableError(error);

                        // Determine expected result based on error characteristics
                        const errorName = error.name || '';
                        const errorMessage = error.message || '';
                        const errorCode = (error as any).code;

                        const shouldBeRetryable =
                            RETRYABLE_ERROR_TYPES.some(type =>
                                errorName.includes(type) || errorMessage.includes(type)
                            ) ||
                            NETWORK_ERROR_CODES.some(code =>
                                errorCode === code
                            ) ||
                            ['socket hang up', 'connect timeout', 'network timeout', 'dns lookup failed', 'connection refused']
                                .some(pattern => errorMessage.toLowerCase().includes(pattern));

                        expect(isRetryable).toBe(shouldBeRetryable);

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });
    });
});

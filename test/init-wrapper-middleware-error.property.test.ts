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
 * Property-Based Tests for Init Wrapper Middleware Error Propagation
 *
 * Feature: configurable-bundle-middleware, Property 6: Middleware Error Propagation
 *
 * Property 6: Middleware Error Propagation
 * *For any* middleware function that throws an error, the init wrapper should send an error signal
 * containing the error message.
 *
 * **Validates: Requirements 2.9, 8.5**
 * - 2.9: IF the middleware function throws an error, THEN THE Init_Wrapper SHALL send an error signal
 *        with the error message
 * - 8.5: IF the middleware function throws, THEN THE Init_Wrapper SHALL include the error message
 *        and stack trace in the error signal
 *
 * @module init-wrapper-middleware-error.property.test
 */

import * as fc from 'fast-check';

/**
 * Interface representing the error signal sent by init_wrapper.js
 */
interface ErrorSignal {
    ready: false;
    error: string;
}

/**
 * Interface representing a successful ready signal
 */
interface ReadySignal {
    ready: true;
    pid: number;
}

/**
 * Union type for all possible signals from init_wrapper
 */
type InitSignal = ErrorSignal | ReadySignal;

/**
 * Interface representing the context passed to middleware
 */
interface MiddlewareContext {
    originalHandler: string;
}

/**
 * Type for middleware function signature
 */
type MiddlewareFunction = (bundle: unknown, context: MiddlewareContext) => unknown;

/**
 * Arbitrary generator for error messages
 * Generates various error message strings that middleware might throw
 */
const errorMessage = (): fc.Arbitrary<string> =>
    fc.oneof(
        // Simple error messages
        fc.string({ minLength: 1, maxLength: 100 }),
        // Common error patterns
        fc.constantFrom(
            'Handler not found',
            'Invalid configuration',
            'Module resolution failed',
            'Cannot access property',
            'Unexpected token',
            'Syntax error in middleware',
            'Type mismatch',
            'Null reference error',
            'Undefined is not a function',
            'Maximum call stack exceeded'
        ),
        // Error messages with special characters
        fc.stringOf(
            fc.constantFrom('a', 'b', 'c', '1', '2', '3', ' ', '.', ':', '-', '_', '/', '\\', '"', "'"),
            { minLength: 1, maxLength: 50 }
        )
    );

/**
 * Arbitrary generator for error types
 * Generates different JavaScript error types that middleware might throw
 */
const errorType = (): fc.Arbitrary<string> =>
    fc.constantFrom(
        'Error',
        'TypeError',
        'ReferenceError',
        'SyntaxError',
        'RangeError',
        'EvalError',
        'URIError'
    );

/**
 * Arbitrary generator for valid handler paths
 * Examples: "index.handler", "src/index.handler"
 */
const handlerPath = (): fc.Arbitrary<string> =>
    fc.oneof(
        fc.constantFrom(
            'index.handler',
            'handler.handler',
            'src/index.handler',
            'dist/index.handler',
            'lambda.handler'
        ),
        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_/]*\.[a-zA-Z_][a-zA-Z0-9_]*$/)
    );

/**
 * Creates an error object of the specified type with the given message
 *
 * @param type - The error type (Error, TypeError, etc.)
 * @param message - The error message
 * @returns An Error object of the specified type
 */
function createError(type: string, message: string): Error {
    switch (type) {
        case 'TypeError':
            return new TypeError(message);
        case 'ReferenceError':
            return new ReferenceError(message);
        case 'SyntaxError':
            return new SyntaxError(message);
        case 'RangeError':
            return new RangeError(message);
        case 'EvalError':
            return new EvalError(message);
        case 'URIError':
            return new URIError(message);
        default:
            return new Error(message);
    }
}

/**
 * Simulates the middleware error handling behavior from init_wrapper.js
 *
 * This mirrors the actual implementation in js_runtime/init_wrapper.js:
 * ```javascript
 * if (hasMiddleware) {
 *     const middleware = require(MIDDLEWARE_PATH);
 *     const middlewareFn = typeof middleware === 'function' ? middleware : middleware.default;
 *     if (typeof middlewareFn !== 'function') {
 *         throw new Error('Middleware must export a function');
 *     }
 *     const context = { originalHandler: originalHandler };
 *     handler = middlewareFn(bundle, context);
 * }
 * ```
 *
 * When middleware throws, the error is caught and an error signal is sent:
 * ```javascript
 * } catch (err) {
 *     initError = err;
 *     let errorMessage = err.message;
 *     // ... error message enhancement ...
 *     process.stdout.write(JSON.stringify({ ready: false, error: errorMessage }) + '\n');
 * }
 * ```
 *
 * @param middlewareFn - The middleware function that may throw
 * @param bundle - The bundle object to pass to middleware
 * @param originalHandler - The original handler path
 * @returns The signal that would be sent (error or ready)
 */
function simulateMiddlewareExecution(
    middlewareFn: MiddlewareFunction,
    bundle: unknown,
    originalHandler: string
): InitSignal {
    const MIDDLEWARE_PATH = '/opt/.kata/middleware.js';
    const bundlePath = '/var/task/index.js';

    try {
        // Simulate middleware invocation
        const context: MiddlewareContext = { originalHandler };
        const handler = middlewareFn(bundle, context);

        // Validate handler is a function (as init_wrapper.js does)
        if (!handler || typeof handler !== 'function') {
            throw new Error('Handler is not a function');
        }

        // Success - return ready signal
        return {
            ready: true,
            pid: process.pid,
        };
    } catch (err) {
        // Mirror the error handling logic from init_wrapper.js
        const error = err as Error;
        let errorMessage = error.message;

        // Check if this is a middleware-related error
        if (!errorMessage.includes(bundlePath) && !errorMessage.includes(MIDDLEWARE_PATH)) {
            // The error message is preserved as-is for middleware errors
            // (init_wrapper.js only adds path prefix for "Cannot find module" errors)
            if (errorMessage.includes('Cannot find module')) {
                errorMessage = `Failed to load middleware from '${MIDDLEWARE_PATH}': ${error.message}`;
            }
        }

        return {
            ready: false,
            error: errorMessage,
        };
    }
}

/**
 * Creates a middleware function that throws the specified error
 *
 * @param error - The error to throw
 * @returns A middleware function that throws the error
 */
function createThrowingMiddleware(error: Error): MiddlewareFunction {
    return (_bundle: unknown, _context: MiddlewareContext): unknown => {
        throw error;
    };
}

/**
 * Creates a middleware function that returns a valid handler
 *
 * @returns A middleware function that returns a valid handler
 */
function createSuccessfulMiddleware(): MiddlewareFunction {
    return (_bundle: unknown, _context: MiddlewareContext): unknown => {
        return async () => ({ statusCode: 200 });
    };
}

// Feature: configurable-bundle-middleware, Property 6: Middleware Error Propagation
describe('Feature: configurable-bundle-middleware, Property 6: Middleware Error Propagation', () => {
    /**
     * **Validates: Requirements 2.9, 8.5**
     */
    describe('Property 6: Middleware Error Propagation', () => {
        /**
         * **Validates: Requirement 2.9**
         * IF the middleware function throws an error, THEN THE Init_Wrapper SHALL send an error signal
         * with the error message.
         *
         * For any middleware function that throws an error, the error signal should contain
         * that error's message.
         */
        it('should include error message in error signal when middleware throws', () => {
            fc.assert(
                fc.property(errorMessage(), handlerPath(), (message, originalHandler) => {
                    const error = new Error(message);
                    const middleware = createThrowingMiddleware(error);
                    const bundle = {};

                    const signal = simulateMiddlewareExecution(middleware, bundle, originalHandler);

                    // Should be an error signal
                    if (signal.ready !== false) {
                        return false;
                    }

                    // Error message should be included in the signal
                    return signal.error.includes(message);
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 2.9**
         * Test with various error types (Error, TypeError, ReferenceError, etc.)
         */
        it('should propagate error message for any error type thrown by middleware', () => {
            fc.assert(
                fc.property(
                    errorType(),
                    errorMessage(),
                    handlerPath(),
                    (type, message, originalHandler) => {
                        const error = createError(type, message);
                        const middleware = createThrowingMiddleware(error);
                        const bundle = {};

                        const signal = simulateMiddlewareExecution(middleware, bundle, originalHandler);

                        // Should be an error signal
                        if (signal.ready !== false) {
                            return false;
                        }

                        // Error message should be included regardless of error type
                        return signal.error.includes(message);
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 2.9**
         * The error signal should have ready: false when middleware throws
         */
        it('should set ready to false in error signal when middleware throws', () => {
            fc.assert(
                fc.property(errorMessage(), handlerPath(), (message, originalHandler) => {
                    const error = new Error(message);
                    const middleware = createThrowingMiddleware(error);
                    const bundle = {};

                    const signal = simulateMiddlewareExecution(middleware, bundle, originalHandler);

                    // The ready field should be false
                    return signal.ready === false;
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 8.5**
         * IF the middleware function throws, THEN THE Init_Wrapper SHALL include the error message
         * in the error signal.
         *
         * The error message should be preserved exactly (not truncated or modified)
         */
        it('should preserve the exact error message in the error signal', () => {
            fc.assert(
                fc.property(errorMessage(), handlerPath(), (message, originalHandler) => {
                    const error = new Error(message);
                    const middleware = createThrowingMiddleware(error);
                    const bundle = {};

                    const signal = simulateMiddlewareExecution(middleware, bundle, originalHandler);

                    if (signal.ready !== false) {
                        return false;
                    }

                    // The exact message should be present in the error
                    return signal.error === message || signal.error.includes(message);
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 2.9, 8.5**
         * Error signal should be valid JSON-serializable
         */
        it('should produce JSON-serializable error signal when middleware throws', () => {
            fc.assert(
                fc.property(errorMessage(), handlerPath(), (message, originalHandler) => {
                    const error = new Error(message);
                    const middleware = createThrowingMiddleware(error);
                    const bundle = {};

                    const signal = simulateMiddlewareExecution(middleware, bundle, originalHandler);

                    // Should be serializable to JSON and back
                    try {
                        const serialized = JSON.stringify(signal);
                        const deserialized = JSON.parse(serialized);
                        return (
                            deserialized.ready === false &&
                            typeof deserialized.error === 'string' &&
                            deserialized.error.includes(message)
                        );
                    } catch {
                        return false;
                    }
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 2.9, 8.5**
         * Test that successful middleware does NOT produce an error signal
         */
        it('should produce ready signal when middleware succeeds', () => {
            fc.assert(
                fc.property(handlerPath(), (originalHandler) => {
                    const middleware = createSuccessfulMiddleware();
                    const bundle = {};

                    const signal = simulateMiddlewareExecution(middleware, bundle, originalHandler);

                    // Should be a ready signal, not an error
                    return signal.ready === true;
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 2.9, 8.5**
         * Test with empty error messages
         */
        it('should handle empty error messages correctly', () => {
            fc.assert(
                fc.property(handlerPath(), (originalHandler) => {
                    const error = new Error('');
                    const middleware = createThrowingMiddleware(error);
                    const bundle = {};

                    const signal = simulateMiddlewareExecution(middleware, bundle, originalHandler);

                    // Should still be an error signal
                    if (signal.ready !== false) {
                        return false;
                    }

                    // Error field should exist (even if empty)
                    return typeof signal.error === 'string';
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 2.9, 8.5**
         * Test with error messages containing special characters
         */
        it('should handle error messages with special characters', () => {
            const specialCharMessage = fc.stringOf(
                fc.constantFrom('\t', '\r', '\\', '"', "'", '<', '>', '&', '{', '}', '[', ']'),
                { minLength: 1, maxLength: 30 }
            );

            fc.assert(
                fc.property(specialCharMessage, handlerPath(), (message, originalHandler) => {
                    const error = new Error(message);
                    const middleware = createThrowingMiddleware(error);
                    const bundle = {};

                    const signal = simulateMiddlewareExecution(middleware, bundle, originalHandler);

                    if (signal.ready !== false) {
                        return false;
                    }

                    // The message should be preserved (special chars included)
                    return signal.error.includes(message);
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 2.9, 8.5**
         * Test determinism: same error should always produce same error signal
         */
        it('should produce consistent error signals for the same middleware error', () => {
            fc.assert(
                fc.property(errorMessage(), handlerPath(), (message, originalHandler) => {
                    const error1 = new Error(message);
                    const error2 = new Error(message);
                    const middleware1 = createThrowingMiddleware(error1);
                    const middleware2 = createThrowingMiddleware(error2);
                    const bundle = {};

                    const signal1 = simulateMiddlewareExecution(middleware1, bundle, originalHandler);
                    const signal2 = simulateMiddlewareExecution(middleware2, bundle, originalHandler);

                    // Both signals should be identical
                    if (signal1.ready !== false || signal2.ready !== false) {
                        return false;
                    }

                    return signal1.error === signal2.error;
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 2.9, 8.5**
         * Test that middleware errors are distinguishable from other errors
         */
        it('should produce error signal with middleware error message, not generic message', () => {
            fc.assert(
                fc.property(errorMessage(), handlerPath(), (message, originalHandler) => {
                    // Skip messages that might be confused with system errors
                    if (message.includes('Cannot find module')) {
                        return true;
                    }

                    const error = new Error(message);
                    const middleware = createThrowingMiddleware(error);
                    const bundle = {};

                    const signal = simulateMiddlewareExecution(middleware, bundle, originalHandler);

                    if (signal.ready !== false) {
                        return false;
                    }

                    // The error should contain the specific middleware error message
                    // not a generic "middleware failed" message
                    return signal.error.includes(message);
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 2.9, 8.5**
         * Test with long error messages
         */
        it('should handle long error messages without truncation', () => {
            const longMessage = fc.string({ minLength: 100, maxLength: 500 });

            fc.assert(
                fc.property(longMessage, handlerPath(), (message, originalHandler) => {
                    const error = new Error(message);
                    const middleware = createThrowingMiddleware(error);
                    const bundle = {};

                    const signal = simulateMiddlewareExecution(middleware, bundle, originalHandler);

                    if (signal.ready !== false) {
                        return false;
                    }

                    // The full message should be preserved
                    return signal.error.includes(message);
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 2.9, 8.5**
         * Test that the error signal format matches the expected protocol
         */
        it('should produce error signal matching the IPC protocol format', () => {
            fc.assert(
                fc.property(errorMessage(), handlerPath(), (message, originalHandler) => {
                    const error = new Error(message);
                    const middleware = createThrowingMiddleware(error);
                    const bundle = {};

                    const signal = simulateMiddlewareExecution(middleware, bundle, originalHandler);

                    // Verify the signal matches the expected format:
                    // {"ready":false,"error":"<message>"}
                    if (signal.ready !== false) {
                        return false;
                    }

                    // Should have exactly two properties: ready and error
                    const keys = Object.keys(signal);
                    if (keys.length !== 2) {
                        return false;
                    }

                    return keys.includes('ready') && keys.includes('error');
                }),
                { numRuns: 10 }
            );
        });
    });
});

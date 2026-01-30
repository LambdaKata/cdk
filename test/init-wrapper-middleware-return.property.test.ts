/*
 * MIT
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the MIT; see the LICENSE file
 * or https://choosealicense.com/licenses/mit/ for details.
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * Property-Based Tests for Init Wrapper Non-Function Middleware Return
 *
 * Feature: configurable-bundle-middleware, Property 11: Non-Function Middleware Return Produces Error
 *
 * Property 11: Non-Function Middleware Return Produces Error
 * *For any* middleware function that returns a non-function value (null, undefined, object, string, number),
 * the init wrapper should send an error signal indicating the handler is not a function.
 *
 * **Validates: Requirements 2.10**
 * - 2.10: IF the middleware function returns a non-function value, THEN THE Init_Wrapper SHALL send an error signal
 *
 * @module init-wrapper-middleware-return.property.test
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
 * Arbitrary generator for non-function values that middleware might return
 * These are all values that should trigger an error signal
 */
const nonFunctionValue = (): fc.Arbitrary<unknown> =>
    fc.oneof(
        // Null and undefined
        fc.constant(null),
        fc.constant(undefined),
        // Strings
        fc.string(),
        fc.constantFrom('', 'handler', 'function', 'async'),
        // Numbers
        fc.integer(),
        fc.float(),
        fc.constantFrom(0, 1, -1, NaN, Infinity, -Infinity),
        // Objects (not functions)
        fc.object(),
        fc.constantFrom({}, { handler: 'not a function' }, { name: 'test' }),
        // Arrays
        fc.array(fc.anything()),
        fc.constantFrom([], [1, 2, 3], ['handler']),
        // Booleans
        fc.boolean(),
        // Symbols
        fc.constant(Symbol('test')),
        fc.constant(Symbol.for('handler'))
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
 * Simulates the middleware return value validation behavior from init_wrapper.js
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
 *
 * // HANDLER VALIDATION
 * if (!handler || typeof handler !== 'function') {
 *     throw new Error('Handler is not a function');
 * }
 * ```
 *
 * @param middlewareFn - The middleware function that returns a value
 * @param bundle - The bundle object to pass to middleware
 * @param originalHandler - The original handler path
 * @returns The signal that would be sent (error or ready)
 */
function simulateMiddlewareReturnValidation(
    middlewareFn: MiddlewareFunction,
    bundle: unknown,
    originalHandler: string
): InitSignal {
    const bundlePath = '/var/task/index.js';

    try {
        // Simulate middleware invocation
        const context: MiddlewareContext = { originalHandler };
        const handler = middlewareFn(bundle, context);

        // Validate handler is a function (as init_wrapper.js does)
        // This is the key validation from init_wrapper.js
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

        // Add bundle path context if not already present
        if (!errorMessage.includes(bundlePath)) {
            errorMessage = `Failed to load bundle from '${bundlePath}': ${error.message}`;
        }

        return {
            ready: false,
            error: errorMessage,
        };
    }
}

/**
 * Creates a middleware function that returns the specified value
 *
 * @param returnValue - The value to return from middleware
 * @returns A middleware function that returns the specified value
 */
function createMiddlewareReturning(returnValue: unknown): MiddlewareFunction {
    return (_bundle: unknown, _context: MiddlewareContext): unknown => {
        return returnValue;
    };
}

/**
 * Creates a middleware function that returns a valid handler function
 *
 * @returns A middleware function that returns a valid handler
 */
function createValidMiddleware(): MiddlewareFunction {
    return (_bundle: unknown, _context: MiddlewareContext): unknown => {
        return async () => ({ statusCode: 200 });
    };
}

/**
 * Helper to get a human-readable type description for test output
 */
function getTypeDescription(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'symbol') return 'symbol';
    return typeof value;
}

// Feature: configurable-bundle-middleware, Property 11: Non-Function Middleware Return Produces Error
describe('Feature: configurable-bundle-middleware, Property 11: Non-Function Middleware Return Produces Error', () => {
    /**
     * **Validates: Requirements 2.10**
     */
    describe('Property 11: Non-Function Middleware Return Produces Error', () => {
        /**
         * **Validates: Requirement 2.10**
         * IF the middleware function returns a non-function value, THEN THE Init_Wrapper SHALL send an error signal.
         *
         * For any non-function return value from middleware, an error signal should be produced.
         */
        it('should produce error signal when middleware returns a non-function value', () => {
            fc.assert(
                fc.property(nonFunctionValue(), handlerPath(), (returnValue, originalHandler) => {
                    const middleware = createMiddlewareReturning(returnValue);
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    // Should be an error signal (ready: false)
                    return signal.ready === false;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * The error message should indicate that the handler is not a function.
         */
        it('should include "Handler is not a function" in error message for non-function returns', () => {
            fc.assert(
                fc.property(nonFunctionValue(), handlerPath(), (returnValue, originalHandler) => {
                    const middleware = createMiddlewareReturning(returnValue);
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    if (signal.ready !== false) {
                        return false;
                    }

                    // Error message should contain the specific error
                    return signal.error.includes('Handler is not a function');
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test specifically with null return value
         */
        it('should produce error signal when middleware returns null', () => {
            fc.assert(
                fc.property(handlerPath(), (originalHandler) => {
                    const middleware = createMiddlewareReturning(null);
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    return signal.ready === false && signal.error.includes('Handler is not a function');
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test specifically with undefined return value
         */
        it('should produce error signal when middleware returns undefined', () => {
            fc.assert(
                fc.property(handlerPath(), (originalHandler) => {
                    const middleware = createMiddlewareReturning(undefined);
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    return signal.ready === false && signal.error.includes('Handler is not a function');
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test with string return values
         */
        it('should produce error signal when middleware returns a string', () => {
            fc.assert(
                fc.property(fc.string(), handlerPath(), (stringValue, originalHandler) => {
                    const middleware = createMiddlewareReturning(stringValue);
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    return signal.ready === false && signal.error.includes('Handler is not a function');
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test with number return values (including edge cases)
         */
        it('should produce error signal when middleware returns a number', () => {
            const numberValue = fc.oneof(
                fc.integer(),
                fc.float(),
                fc.constantFrom(0, 1, -1, NaN, Infinity, -Infinity)
            );

            fc.assert(
                fc.property(numberValue, handlerPath(), (numValue, originalHandler) => {
                    const middleware = createMiddlewareReturning(numValue);
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    return signal.ready === false && signal.error.includes('Handler is not a function');
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test with object return values (non-function objects)
         */
        it('should produce error signal when middleware returns an object', () => {
            fc.assert(
                fc.property(fc.object(), handlerPath(), (objValue, originalHandler) => {
                    const middleware = createMiddlewareReturning(objValue);
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    return signal.ready === false && signal.error.includes('Handler is not a function');
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test with array return values
         */
        it('should produce error signal when middleware returns an array', () => {
            fc.assert(
                fc.property(fc.array(fc.anything()), handlerPath(), (arrValue, originalHandler) => {
                    const middleware = createMiddlewareReturning(arrValue);
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    return signal.ready === false && signal.error.includes('Handler is not a function');
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test with boolean return values
         */
        it('should produce error signal when middleware returns a boolean', () => {
            fc.assert(
                fc.property(fc.boolean(), handlerPath(), (boolValue, originalHandler) => {
                    const middleware = createMiddlewareReturning(boolValue);
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    return signal.ready === false && signal.error.includes('Handler is not a function');
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Contrast test: valid function return should produce ready signal
         */
        it('should produce ready signal when middleware returns a valid function', () => {
            fc.assert(
                fc.property(handlerPath(), (originalHandler) => {
                    const middleware = createValidMiddleware();
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    // Should be a ready signal, not an error
                    return signal.ready === true;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test that error signal is JSON-serializable
         */
        it('should produce JSON-serializable error signal for non-function returns', () => {
            fc.assert(
                fc.property(nonFunctionValue(), handlerPath(), (returnValue, originalHandler) => {
                    const middleware = createMiddlewareReturning(returnValue);
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    // Should be serializable to JSON and back
                    try {
                        const serialized = JSON.stringify(signal);
                        const deserialized = JSON.parse(serialized);
                        return (
                            deserialized.ready === false &&
                            typeof deserialized.error === 'string' &&
                            deserialized.error.includes('Handler is not a function')
                        );
                    } catch {
                        return false;
                    }
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test that error signal format matches IPC protocol
         */
        it('should produce error signal matching the IPC protocol format', () => {
            fc.assert(
                fc.property(nonFunctionValue(), handlerPath(), (returnValue, originalHandler) => {
                    const middleware = createMiddlewareReturning(returnValue);
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

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
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test determinism: same non-function return should always produce same error
         */
        it('should produce consistent error signals for the same non-function return', () => {
            fc.assert(
                fc.property(nonFunctionValue(), handlerPath(), (returnValue, originalHandler) => {
                    const middleware1 = createMiddlewareReturning(returnValue);
                    const middleware2 = createMiddlewareReturning(returnValue);
                    const bundle = {};

                    const signal1 = simulateMiddlewareReturnValidation(
                        middleware1,
                        bundle,
                        originalHandler
                    );
                    const signal2 = simulateMiddlewareReturnValidation(
                        middleware2,
                        bundle,
                        originalHandler
                    );

                    // Both signals should be identical
                    if (signal1.ready !== false || signal2.ready !== false) {
                        return false;
                    }

                    return signal1.error === signal2.error;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test with various bundle objects - the bundle content shouldn't affect the error
         */
        it('should produce error signal regardless of bundle content when middleware returns non-function', () => {
            fc.assert(
                fc.property(
                    nonFunctionValue(),
                    fc.object(),
                    handlerPath(),
                    (returnValue, bundleObj, originalHandler) => {
                        const middleware = createMiddlewareReturning(returnValue);

                        const signal = simulateMiddlewareReturnValidation(
                            middleware,
                            bundleObj,
                            originalHandler
                        );

                        return (
                            signal.ready === false && signal.error.includes('Handler is not a function')
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test that async functions are accepted as valid handlers
         */
        it('should accept async functions as valid handler returns', () => {
            fc.assert(
                fc.property(handlerPath(), (originalHandler) => {
                    const middleware: MiddlewareFunction = () => {
                        return async (event: unknown) => ({ statusCode: 200, body: event });
                    };
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    return signal.ready === true;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test that regular functions are accepted as valid handler returns
         */
        it('should accept regular functions as valid handler returns', () => {
            fc.assert(
                fc.property(handlerPath(), (originalHandler) => {
                    const middleware: MiddlewareFunction = () => {
                        return function handler() {
                            return { statusCode: 200 };
                        };
                    };
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    return signal.ready === true;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.10**
         * Test that arrow functions are accepted as valid handler returns
         */
        it('should accept arrow functions as valid handler returns', () => {
            fc.assert(
                fc.property(handlerPath(), (originalHandler) => {
                    const middleware: MiddlewareFunction = () => {
                        return () => ({ statusCode: 200 });
                    };
                    const bundle = {};

                    const signal = simulateMiddlewareReturnValidation(
                        middleware,
                        bundle,
                        originalHandler
                    );

                    return signal.ready === true;
                }),
                { numRuns: 100 }
            );
        });
    });
});

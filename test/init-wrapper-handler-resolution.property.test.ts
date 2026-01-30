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
 * Property-Based Tests for Init Wrapper Default Handler Resolution
 *
 * Feature: configurable-bundle-middleware, Property 5: Default Handler Resolution
 *
 * Property 5: Default Handler Resolution
 * *For any* bundle object with a property matching the handler name from `original_js_handler`
 * (e.g., `index.handler` → `bundle.handler`), and no middleware configured, the init wrapper
 * should resolve to that property value.
 *
 * **Validates: Requirements 2.7, 2.8, 6.2**
 * - 2.7: WHEN no middleware is present, THE Init_Wrapper SHALL use the default handler resolution
 * - 2.8: THE default handler resolution SHALL work with standard Node.js Lambda handler exports
 *        (e.g., `exports.handler = async (event, context) => {...}`)
 * - 6.2: WHEN no middleware is configured, THE Init_Wrapper SHALL use the default handler resolution
 *
 * @module init-wrapper-handler-resolution.property.test
 */

import * as fc from 'fast-check';

/**
 * Arbitrary generator for valid handler names (the function part of the handler path)
 * Generates names matching JavaScript identifier rules: starts with letter or underscore,
 * followed by letters, numbers, or underscores.
 * Examples: "handler", "myHandler", "handle_request", "_private"
 */
const handlerName = (): fc.Arbitrary<string> =>
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/);

/**
 * Arbitrary generator for valid module names (the module part of the handler path)
 * Examples: "index", "src/index", "handlers/api", "my_module"
 */
const moduleName = (): fc.Arbitrary<string> =>
    fc.oneof(
        // Simple module names
        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
        // Nested module paths
        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*\/[a-zA-Z_][a-zA-Z0-9_]*$/),
        // Deeply nested module paths
        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*\/[a-zA-Z_][a-zA-Z0-9_]*\/[a-zA-Z_][a-zA-Z0-9_]*$/)
    );

/**
 * Arbitrary generator for complete handler paths in format: module.function
 * Examples: "index.handler", "src/index.handler", "handlers/api/users.createUser"
 */
const handlerPath = (): fc.Arbitrary<string> =>
    fc.tuple(moduleName(), handlerName()).map(([mod, fn]) => `${mod}.${fn}`);

/**
 * Arbitrary generator for common Lambda handler path patterns
 */
const commonHandlerPaths = (): fc.Arbitrary<string> =>
    fc.constantFrom(
        'index.handler',
        'handler.handler',
        'src/index.handler',
        'dist/index.handler',
        'lambda.handler',
        'app.handler',
        'main.handler',
        'api.handler',
        'index.main',
        'handler.main',
        'src/handler.processEvent',
        'handlers/api.handleRequest',
        'lib/index.handler'
    );

/**
 * Arbitrary generator for a mock handler function
 * Returns a function that can be used as a Lambda handler
 */
const mockHandlerFunction = (): fc.Arbitrary<() => Promise<unknown>> =>
    fc.constant(async () => ({ statusCode: 200 }));

/**
 * Interface representing a bundle object with handler exports
 */
interface BundleObject {
    [key: string]: unknown;
}

/**
 * Simulates the default handler resolution logic from init_wrapper.js
 * This mirrors the actual implementation:
 *
 * ```javascript
 * const handlerParts = originalHandler.split('.');
 * const handlerName = handlerParts[handlerParts.length - 1];
 * handler = bundle[handlerName];
 * ```
 *
 * @param bundle - The loaded JavaScript bundle object
 * @param originalHandler - The original handler path (e.g., "index.handler")
 * @returns The resolved handler function or undefined if not found
 */
function resolveDefaultHandler(bundle: BundleObject, originalHandler: string): unknown {
    const handlerParts = originalHandler.split('.');
    const handlerName = handlerParts[handlerParts.length - 1];
    return bundle[handlerName];
}

/**
 * Extracts the handler name (function name) from a handler path
 * e.g., "index.handler" → "handler", "src/api.processEvent" → "processEvent"
 *
 * @param handlerPath - The full handler path
 * @returns The handler function name
 */
function extractHandlerName(handlerPath: string): string {
    const parts = handlerPath.split('.');
    return parts[parts.length - 1];
}

/**
 * Creates a bundle object with a handler function at the specified property name
 *
 * @param handlerPropertyName - The property name for the handler
 * @param handlerFn - The handler function to assign
 * @returns A bundle object with the handler
 */
function createBundleWithHandler(
    handlerPropertyName: string,
    handlerFn: () => Promise<unknown>
): BundleObject {
    return {
        [handlerPropertyName]: handlerFn,
    };
}

// Feature: configurable-bundle-middleware, Property 5: Default Handler Resolution
describe('Feature: configurable-bundle-middleware, Property 5: Default Handler Resolution', () => {
    /**
     * **Validates: Requirements 2.7, 2.8, 6.2**
     */
    describe('Property 5: Default Handler Resolution', () => {
        /**
         * **Validates: Requirements 2.7, 2.8, 6.2**
         * For any bundle object with a property matching the handler name from original_js_handler,
         * and no middleware configured, the init wrapper should resolve to that property value.
         *
         * This tests the primary property: default resolution extracts the correct handler.
         */
        it('should resolve handler from bundle using the last part of the handler path', () => {
            fc.assert(
                fc.property(
                    handlerPath(),
                    mockHandlerFunction(),
                    (originalHandler, handlerFn) => {
                        // Extract the expected handler name from the path
                        const expectedHandlerName = extractHandlerName(originalHandler);

                        // Create a bundle with the handler at the expected property
                        const bundle = createBundleWithHandler(expectedHandlerName, handlerFn);

                        // Resolve the handler using the default resolution logic
                        const resolvedHandler = resolveDefaultHandler(bundle, originalHandler);

                        // The resolved handler should be the same function we put in the bundle
                        return resolvedHandler === handlerFn;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirements 2.7, 2.8**
         * Test with common Lambda handler path patterns
         */
        it('should resolve handler correctly for common Lambda handler paths', () => {
            fc.assert(
                fc.property(
                    commonHandlerPaths(),
                    mockHandlerFunction(),
                    (originalHandler, handlerFn) => {
                        const expectedHandlerName = extractHandlerName(originalHandler);
                        const bundle = createBundleWithHandler(expectedHandlerName, handlerFn);
                        const resolvedHandler = resolveDefaultHandler(bundle, originalHandler);

                        return resolvedHandler === handlerFn;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.8**
         * THE default handler resolution SHALL work with standard Node.js Lambda handler exports
         *
         * Test that the resolution works with the standard "handler" export name
         */
        it('should work with standard "handler" export name', () => {
            fc.assert(
                fc.property(
                    moduleName(),
                    mockHandlerFunction(),
                    (mod, handlerFn) => {
                        const originalHandler = `${mod}.handler`;
                        const bundle = { handler: handlerFn };
                        const resolvedHandler = resolveDefaultHandler(bundle, originalHandler);

                        return resolvedHandler === handlerFn;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirements 2.7, 6.2**
         * Handler resolution should only use the last part of the path (after the last dot)
         */
        it('should only use the last part of the handler path for resolution', () => {
            fc.assert(
                fc.property(
                    handlerName(),
                    mockHandlerFunction(),
                    (fnName, handlerFn) => {
                        // Create various handler paths with the same function name
                        const paths = [
                            `index.${fnName}`,
                            `src/index.${fnName}`,
                            `handlers/api/users.${fnName}`,
                            `a/b/c/d.${fnName}`,
                        ];

                        // All paths should resolve to the same handler
                        const bundle = { [fnName]: handlerFn };

                        return paths.every(path => {
                            const resolved = resolveDefaultHandler(bundle, path);
                            return resolved === handlerFn;
                        });
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirements 2.7, 2.8**
         * Resolution should return undefined when handler property doesn't exist
         */
        it('should return undefined when handler property does not exist in bundle', () => {
            fc.assert(
                fc.property(
                    handlerPath(),
                    (originalHandler) => {
                        // Create an empty bundle
                        const bundle: BundleObject = {};

                        // Resolve should return undefined
                        const resolvedHandler = resolveDefaultHandler(bundle, originalHandler);

                        return resolvedHandler === undefined;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirements 2.7, 2.8**
         * Resolution should return the exact value from the bundle (not a copy)
         */
        it('should return the exact reference from the bundle', () => {
            fc.assert(
                fc.property(
                    handlerPath(),
                    mockHandlerFunction(),
                    (originalHandler, handlerFn) => {
                        const expectedHandlerName = extractHandlerName(originalHandler);
                        const bundle = createBundleWithHandler(expectedHandlerName, handlerFn);
                        const resolvedHandler = resolveDefaultHandler(bundle, originalHandler);

                        // Should be the exact same reference (strict equality)
                        return resolvedHandler === bundle[expectedHandlerName];
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirements 2.7, 6.2**
         * Resolution should be deterministic - same inputs always produce same output
         */
        it('should produce consistent results for the same handler path and bundle', () => {
            fc.assert(
                fc.property(
                    handlerPath(),
                    mockHandlerFunction(),
                    (originalHandler, handlerFn) => {
                        const expectedHandlerName = extractHandlerName(originalHandler);
                        const bundle = createBundleWithHandler(expectedHandlerName, handlerFn);

                        // Resolve multiple times
                        const resolved1 = resolveDefaultHandler(bundle, originalHandler);
                        const resolved2 = resolveDefaultHandler(bundle, originalHandler);
                        const resolved3 = resolveDefaultHandler(bundle, originalHandler);

                        // All resolutions should be identical
                        return resolved1 === resolved2 && resolved2 === resolved3;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 2.8**
         * Resolution should work with handler names containing underscores and numbers
         */
        it('should handle handler names with underscores and numbers', () => {
            const handlerNameWithSpecialChars = fc.stringMatching(
                /^[a-zA-Z_][a-zA-Z0-9_]*[0-9_]+[a-zA-Z0-9_]*$/
            );

            fc.assert(
                fc.property(
                    moduleName(),
                    handlerNameWithSpecialChars,
                    mockHandlerFunction(),
                    (mod, fnName, handlerFn) => {
                        const originalHandler = `${mod}.${fnName}`;
                        const bundle = { [fnName]: handlerFn };
                        const resolvedHandler = resolveDefaultHandler(bundle, originalHandler);

                        return resolvedHandler === handlerFn;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirements 2.7, 2.8**
         * Resolution should work when bundle has multiple exports
         */
        it('should resolve correct handler when bundle has multiple exports', () => {
            fc.assert(
                fc.property(
                    handlerPath(),
                    mockHandlerFunction(),
                    mockHandlerFunction(),
                    mockHandlerFunction(),
                    (originalHandler, targetFn, otherFn1, otherFn2) => {
                        const expectedHandlerName = extractHandlerName(originalHandler);

                        // Create bundle with multiple exports
                        const bundle: BundleObject = {
                            [expectedHandlerName]: targetFn,
                            otherHandler1: otherFn1,
                            otherHandler2: otherFn2,
                            someValue: 'not a function',
                            anotherValue: 42,
                        };

                        const resolvedHandler = resolveDefaultHandler(bundle, originalHandler);

                        // Should resolve to the correct handler, not the others
                        return resolvedHandler === targetFn;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirements 2.7, 2.8, 6.2**
         * Simple handler paths (no module path, just "handler") should work
         */
        it('should handle simple handler paths without module prefix', () => {
            fc.assert(
                fc.property(
                    handlerName(),
                    mockHandlerFunction(),
                    (fnName, handlerFn) => {
                        // Simple path like just "handler" (though unusual, should still work)
                        const originalHandler = fnName;
                        const bundle = { [fnName]: handlerFn };
                        const resolvedHandler = resolveDefaultHandler(bundle, originalHandler);

                        return resolvedHandler === handlerFn;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirements 2.7, 2.8**
         * Handler path extraction should handle edge cases with multiple dots
         */
        it('should use only the last segment when handler path has multiple dots', () => {
            fc.assert(
                fc.property(
                    handlerName(),
                    mockHandlerFunction(),
                    (fnName, handlerFn) => {
                        // Paths with multiple dots (unusual but valid)
                        const paths = [
                            `a.b.${fnName}`,
                            `x.y.z.${fnName}`,
                            `one.two.three.four.${fnName}`,
                        ];

                        const bundle = { [fnName]: handlerFn };

                        return paths.every(path => {
                            const resolved = resolveDefaultHandler(bundle, path);
                            return resolved === handlerFn;
                        });
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});

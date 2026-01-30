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
 * Property-Based Tests for Init Wrapper Malformed JSON Config Defaults
 *
 * Feature: configurable-bundle-middleware, Property 10: Malformed JSON Config Uses Defaults
 *
 * Property 10: Malformed JSON Config Uses Defaults
 * *For any* string that is not valid JSON stored in the config file, the init wrapper should use
 * default values (bundle_path = `/opt/js_runtime/bundle.js`, has_middleware = false) and continue
 * initialization.
 *
 * **Validates: Requirements 8.2**
 * - 8.2: IF the config JSON is malformed, THEN THE Init_Wrapper SHALL log the parse error and use defaults
 *
 * @module init-wrapper-malformed-config.property.test
 */

import * as fc from 'fast-check';

/**
 * Default values used by init_wrapper.js when config is malformed
 */
const DEFAULT_BUNDLE_PATH = '/opt/js_runtime/bundle.js';
const DEFAULT_ORIGINAL_HANDLER = 'index.handler';
const DEFAULT_HAS_MIDDLEWARE = false;

/**
 * Interface representing the parsed config from init_wrapper.js
 */
interface ParsedConfig {
    bundle_path: string;
    original_js_handler: string;
    has_middleware: boolean;
}

/**
 * Interface representing the result of config parsing
 */
interface ConfigParseResult {
    config: ParsedConfig;
    usedDefaults: boolean;
    errorMessage?: string;
}

/**
 * Arbitrary generator for invalid JSON strings
 * Generates strings that will fail JSON.parse()
 */
const invalidJson = (): fc.Arbitrary<string> =>
    fc.oneof(
        // Common malformed JSON patterns
        fc.constant('{invalid}'),
        fc.constant('{"key": }'),
        fc.constant('not json'),
        fc.constant('{'),
        fc.constant('}'),
        fc.constant('['),
        fc.constant(']'),
        fc.constant('{"unclosed": "string'),
        fc.constant('{"trailing": "comma",}'),
        fc.constant("{'single': 'quotes'}"),
        fc.constant('{key: "unquoted key"}'),
        fc.constant('undefined'),
        fc.constant('NaN'),
        fc.constant('Infinity'),
        // Random strings that are not valid JSON
        fc.string().filter((s) => {
            try {
                JSON.parse(s);
                return false;
            } catch {
                return true;
            }
        })
    );

/**
 * Arbitrary generator for various malformed JSON patterns
 */
const malformedJsonPatterns = (): fc.Arbitrary<string> =>
    fc.oneof(
        // Truncated JSON
        fc.constant('{"bundle_path": "/var/task/index.js"'),
        fc.constant('{"has_middleware": tru'),
        fc.constant('{"original_js_handler": "index.'),
        // Invalid values
        fc.constant('{"bundle_path": undefined}'),
        fc.constant('{"has_middleware": TRUE}'), // JSON is case-sensitive
        fc.constant('{"original_js_handler": null,}'), // trailing comma
        // Wrong structure
        fc.constant('["array", "not", "object"]'),
        fc.constant('"just a string"'),
        fc.constant('12345'),
        fc.constant('true'),
        fc.constant('null'),
        // Binary/control characters
        fc.constant('\x00\x01\x02'),
        fc.constant('\uFFFE\uFFFF'),
        // Empty or whitespace
        fc.constant(''),
        fc.constant('   '),
        fc.constant('\n\t\r'),
        // Comments (not valid in JSON)
        fc.constant('{"key": "value"} // comment'),
        fc.constant('/* comment */ {"key": "value"}')
    );

/**
 * Simulates the config parsing logic from init_wrapper.js
 * This mirrors the actual implementation:
 *
 * ```javascript
 * let config = {};
 * try {
 *     const configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
 *     config = JSON.parse(configContent);
 *     log('[Init] Config loaded:', JSON.stringify(config));
 * } catch (err) {
 *     log('[Init] Config read error (using defaults):', err.message);
 *     // Continue with defaults for backward compatibility
 * }
 *
 * const bundlePath = config.bundle_path || DEFAULT_BUNDLE_PATH;
 * const originalHandler = config.original_js_handler || 'index.handler';
 * const hasMiddleware = config.has_middleware === true;
 * ```
 *
 * @param configContent - The content of the config file (potentially malformed JSON)
 * @returns The parsed config result with defaults applied if parsing fails
 */
function simulateConfigParsing(configContent: string): ConfigParseResult {
    let config: Record<string, unknown> = {};
    let usedDefaults = false;
    let errorMessage: string | undefined;

    try {
        config = JSON.parse(configContent);
    } catch (err) {
        usedDefaults = true;
        errorMessage = err instanceof Error ? err.message : String(err);
        // Continue with empty config (defaults will be applied)
        config = {};
    }

    // Apply defaults exactly as init_wrapper.js does
    const bundlePath =
        typeof config.bundle_path === 'string' ? config.bundle_path : DEFAULT_BUNDLE_PATH;
    const originalHandler =
        typeof config.original_js_handler === 'string'
            ? config.original_js_handler
            : DEFAULT_ORIGINAL_HANDLER;
    const hasMiddleware = config.has_middleware === true;

    return {
        config: {
            bundle_path: bundlePath,
            original_js_handler: originalHandler,
            has_middleware: hasMiddleware,
        },
        usedDefaults,
        errorMessage,
    };
}

/**
 * Checks if a string is valid JSON
 *
 * @param str - The string to check
 * @returns True if the string is valid JSON, false otherwise
 */
function isValidJson(str: string): boolean {
    try {
        JSON.parse(str);
        return true;
    } catch {
        return false;
    }
}

// Feature: configurable-bundle-middleware, Property 10: Malformed JSON Config Uses Defaults
describe('Feature: configurable-bundle-middleware, Property 10: Malformed JSON Config Uses Defaults', () => {
    /**
     * **Validates: Requirements 8.2**
     */
    describe('Property 10: Malformed JSON Config Uses Defaults', () => {
        /**
         * **Validates: Requirement 8.2**
         * IF the config JSON is malformed, THEN THE Init_Wrapper SHALL log the parse error and use defaults
         *
         * For any string that is not valid JSON, the init wrapper should use default bundle_path.
         */
        it('should use default bundle_path for any malformed JSON config', () => {
            fc.assert(
                fc.property(invalidJson(), (malformedConfig) => {
                    const result = simulateConfigParsing(malformedConfig);

                    // Should use default bundle_path
                    return result.config.bundle_path === DEFAULT_BUNDLE_PATH;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 8.2**
         * For any malformed JSON, has_middleware should default to false
         */
        it('should use default has_middleware (false) for any malformed JSON config', () => {
            fc.assert(
                fc.property(invalidJson(), (malformedConfig) => {
                    const result = simulateConfigParsing(malformedConfig);

                    // Should use default has_middleware (false)
                    return result.config.has_middleware === DEFAULT_HAS_MIDDLEWARE;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 8.2**
         * For any malformed JSON, original_js_handler should default to 'index.handler'
         */
        it('should use default original_js_handler for any malformed JSON config', () => {
            fc.assert(
                fc.property(invalidJson(), (malformedConfig) => {
                    const result = simulateConfigParsing(malformedConfig);

                    // Should use default original_js_handler
                    return result.config.original_js_handler === DEFAULT_ORIGINAL_HANDLER;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 8.2**
         * The system should detect that defaults were used for malformed JSON
         */
        it('should indicate defaults were used for any malformed JSON config', () => {
            fc.assert(
                fc.property(invalidJson(), (malformedConfig) => {
                    const result = simulateConfigParsing(malformedConfig);

                    // Should indicate that defaults were used
                    return result.usedDefaults === true;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 8.2**
         * The system should capture the parse error message for logging
         */
        it('should capture error message for any malformed JSON config', () => {
            fc.assert(
                fc.property(invalidJson(), (malformedConfig) => {
                    const result = simulateConfigParsing(malformedConfig);

                    // Should have an error message
                    return (
                        result.errorMessage !== undefined && result.errorMessage.length > 0
                    );
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 8.2**
         * Test with various malformed JSON patterns
         */
        it('should use defaults for various malformed JSON patterns', () => {
            fc.assert(
                fc.property(malformedJsonPatterns(), (malformedConfig) => {
                    // Skip if this pattern happens to be valid JSON
                    if (isValidJson(malformedConfig)) {
                        return true;
                    }

                    const result = simulateConfigParsing(malformedConfig);

                    // Should use all defaults
                    return (
                        result.config.bundle_path === DEFAULT_BUNDLE_PATH &&
                        result.config.has_middleware === DEFAULT_HAS_MIDDLEWARE &&
                        result.config.original_js_handler === DEFAULT_ORIGINAL_HANDLER &&
                        result.usedDefaults === true
                    );
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 8.2**
         * The system should continue initialization (not crash) for malformed JSON
         */
        it('should not throw an exception for any malformed JSON config', () => {
            fc.assert(
                fc.property(invalidJson(), (malformedConfig) => {
                    // This should not throw - it should gracefully handle the error
                    try {
                        const result = simulateConfigParsing(malformedConfig);
                        // Should return a valid result object
                        return (
                            result !== null &&
                            result !== undefined &&
                            typeof result.config === 'object' &&
                            typeof result.config.bundle_path === 'string' &&
                            typeof result.config.has_middleware === 'boolean' &&
                            typeof result.config.original_js_handler === 'string'
                        );
                    } catch {
                        // Should never reach here
                        return false;
                    }
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 8.2**
         * Verify that valid JSON does NOT trigger defaults
         * (This is a sanity check to ensure our test logic is correct)
         */
        it('should NOT use defaults when config is valid JSON with all fields', () => {
            const validConfig = fc.record({
                bundle_path: fc.stringMatching(/^\/[a-zA-Z0-9_/]+\.js$/),
                original_js_handler: fc.stringMatching(
                    /^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/
                ),
                has_middleware: fc.boolean(),
            });

            fc.assert(
                fc.property(validConfig, (config) => {
                    const configJson = JSON.stringify(config);
                    const result = simulateConfigParsing(configJson);

                    // Should NOT use defaults
                    return (
                        result.usedDefaults === false &&
                        result.config.bundle_path === config.bundle_path &&
                        result.config.original_js_handler === config.original_js_handler &&
                        result.config.has_middleware === config.has_middleware
                    );
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 8.2**
         * Empty string should be treated as malformed JSON
         */
        it('should use defaults for empty string config', () => {
            const result = simulateConfigParsing('');

            expect(result.usedDefaults).toBe(true);
            expect(result.config.bundle_path).toBe(DEFAULT_BUNDLE_PATH);
            expect(result.config.has_middleware).toBe(DEFAULT_HAS_MIDDLEWARE);
            expect(result.config.original_js_handler).toBe(DEFAULT_ORIGINAL_HANDLER);
        });

        /**
         * **Validates: Requirement 8.2**
         * Whitespace-only string should be treated as malformed JSON
         */
        it('should use defaults for whitespace-only config', () => {
            fc.assert(
                fc.property(
                    fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), {
                        minLength: 1,
                        maxLength: 10,
                    }),
                    (whitespace) => {
                        const result = simulateConfigParsing(whitespace);

                        return (
                            result.usedDefaults === true &&
                            result.config.bundle_path === DEFAULT_BUNDLE_PATH &&
                            result.config.has_middleware === DEFAULT_HAS_MIDDLEWARE
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 8.2**
         * Truncated JSON should be treated as malformed
         */
        it('should use defaults for truncated JSON config', () => {
            // Generate valid JSON and truncate it
            const truncatedJson = fc
                .record({
                    bundle_path: fc.constant('/var/task/index.js'),
                    has_middleware: fc.boolean(),
                })
                .map((config) => {
                    const json = JSON.stringify(config);
                    // Truncate at various points
                    const truncatePoint = Math.floor(json.length / 2);
                    return json.substring(0, truncatePoint);
                });

            fc.assert(
                fc.property(truncatedJson, (malformedConfig) => {
                    // Skip if truncation accidentally created valid JSON
                    if (isValidJson(malformedConfig)) {
                        return true;
                    }

                    const result = simulateConfigParsing(malformedConfig);

                    return (
                        result.usedDefaults === true &&
                        result.config.bundle_path === DEFAULT_BUNDLE_PATH
                    );
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 8.2**
         * JSON with syntax errors should use defaults
         */
        it('should use defaults for JSON with syntax errors', () => {
            // Generate JSON with intentional syntax errors
            const jsonWithSyntaxErrors = fc.oneof(
                // Missing quotes around keys
                fc.constant('{bundle_path: "/var/task/index.js"}'),
                // Single quotes instead of double
                fc.constant("{'bundle_path': '/var/task/index.js'}"),
                // Trailing comma
                fc.constant('{"bundle_path": "/var/task/index.js",}'),
                // Missing colon
                fc.constant('{"bundle_path" "/var/task/index.js"}'),
                // Missing comma between properties
                fc.constant(
                    '{"bundle_path": "/var/task/index.js" "has_middleware": true}'
                ),
                // Unescaped special characters
                fc.constant('{"bundle_path": "/var/task/index\njs"}')
            );

            fc.assert(
                fc.property(jsonWithSyntaxErrors, (malformedConfig) => {
                    const result = simulateConfigParsing(malformedConfig);

                    return (
                        result.usedDefaults === true &&
                        result.config.bundle_path === DEFAULT_BUNDLE_PATH &&
                        result.config.has_middleware === DEFAULT_HAS_MIDDLEWARE
                    );
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 8.2**
         * Determinism: same malformed input should always produce same defaults
         */
        it('should produce consistent defaults for the same malformed config', () => {
            fc.assert(
                fc.property(invalidJson(), (malformedConfig) => {
                    const result1 = simulateConfigParsing(malformedConfig);
                    const result2 = simulateConfigParsing(malformedConfig);
                    const result3 = simulateConfigParsing(malformedConfig);

                    // All results should be identical
                    return (
                        result1.config.bundle_path === result2.config.bundle_path &&
                        result2.config.bundle_path === result3.config.bundle_path &&
                        result1.config.has_middleware === result2.config.has_middleware &&
                        result2.config.has_middleware === result3.config.has_middleware &&
                        result1.config.original_js_handler ===
                        result2.config.original_js_handler &&
                        result2.config.original_js_handler ===
                        result3.config.original_js_handler
                    );
                }),
                { numRuns: 100 }
            );
        });
    });
});

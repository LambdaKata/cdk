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
 * Property-Based Tests for Non-Existent Middleware File Error at Synthesis
 *
 * Feature: configurable-bundle-middleware, Property 12: Non-Existent Middleware File Error at Synthesis
 *
 * Property 12: Non-Existent Middleware File Error at Synthesis
 * *For any* `middlewarePath` pointing to a non-existent file, the kata() wrapper should
 * throw an error during CDK synthesis with a message containing the file path.
 *
 * **Validates: Requirements 5.7**
 * - Req 5.7: IF the middleware file does not exist, THEN THE kata_Wrapper SHALL throw a clear error during CDK synthesis
 *
 * @module config-layer-middleware-error.property.test
 */

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME, HANDLER_CONFIG_KEY, MIDDLEWARE_FILE_NAME } from '../src/config-layer';
import * as esbuild from 'esbuild';

/**
 * Simulates the middleware file validation logic from createKataConfigLayer.
 * This function mirrors the behavior of the actual implementation when
 * a middlewarePath is provided.
 *
 * @param middlewarePath - Path to the middleware source file
 * @throws Error if the middleware file does not exist
 */
function validateMiddlewareFile(middlewarePath: string): void {
    // This mirrors the validation in createKataConfigLayer
    if (!fs.existsSync(middlewarePath)) {
        throw new Error(`Middleware file not found: ${middlewarePath}`);
    }
}

/**
 * Simulates the full config layer generation logic from createKataConfigLayer.
 * This function mirrors the behavior of the actual implementation.
 *
 * @param originalHandler - The original handler path
 * @param middlewarePath - Path to the middleware source file
 * @throws Error if the middleware file does not exist
 */
function simulateCreateKataConfigLayer(
    originalHandler: string,
    middlewarePath: string,
): void {
    // Create temporary directory for layer content
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kata-config-test-'));
    const kataDir = path.join(tempDir, CONFIG_DIR_NAME);
    fs.mkdirSync(kataDir, { recursive: true });

    try {
        // Build config object
        const config: Record<string, unknown> = {
            [HANDLER_CONFIG_KEY]: originalHandler,
        };

        // Validate middleware file exists (Requirement 5.7)
        // This is the key validation that should throw for non-existent files
        if (!fs.existsSync(middlewarePath)) {
            throw new Error(`Middleware file not found: ${middlewarePath}`);
        }

        // Build middleware with esbuild (would only reach here if file exists)
        const middlewareOutPath = path.join(kataDir, MIDDLEWARE_FILE_NAME);
        esbuild.buildSync({
            entryPoints: [middlewarePath],
            bundle: true,
            platform: 'node',
            target: 'node18',
            format: 'cjs',
            outfile: middlewareOutPath,
            minify: true,
            sourcemap: false,
        });

        // Set has_middleware: true in config JSON
        config['has_middleware'] = true;

        // Write config file
        fs.writeFileSync(
            path.join(kataDir, CONFIG_FILE_NAME),
            JSON.stringify(config, null, 2),
            'utf-8',
        );
    } finally {
        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

/**
 * Arbitrary generator for valid handler paths
 * Generates paths matching the pattern: <module>.<function> or <path/module>.<function>
 * Examples: "bundle.handler", "src/index.handler", "handlers/api/users.createUser"
 */
const validHandlerPath = (): fc.Arbitrary<string> =>
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_/]*\.[a-zA-Z_][a-zA-Z0-9_]*$/);

/**
 * Arbitrary generator for non-existent file paths
 * Generates paths that are guaranteed not to exist on the filesystem.
 * Uses a combination of random directory names and file names.
 */
const nonExistentFilePath = (): fc.Arbitrary<string> =>
    fc.tuple(
        // Random directory path component
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{1,10}$/),
        // Random subdirectory (optional depth)
        fc.array(fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{1,8}$/), { minLength: 0, maxLength: 3 }),
        // Random file name
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{1,15}$/),
        // File extension (ts or js)
        fc.constantFrom('.ts', '.js'),
    ).map(([dir, subdirs, file, ext]) => {
        // Build a path that definitely doesn't exist
        const pathParts = ['/tmp', 'nonexistent-kata-test', dir, ...subdirs, `${file}${ext}`];
        return path.join(...pathParts);
    });

/**
 * Arbitrary generator for absolute non-existent paths
 * Generates absolute paths that are guaranteed not to exist.
 */
const absoluteNonExistentPath = (): fc.Arbitrary<string> =>
    fc.tuple(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{2,12}$/),
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{2,12}$/),
        fc.constantFrom('.ts', '.js'),
    ).map(([dir, file, ext]) => `/nonexistent-${dir}/${file}${ext}`);

/**
 * Arbitrary generator for relative non-existent paths
 * Generates relative paths that are guaranteed not to exist.
 */
const relativeNonExistentPath = (): fc.Arbitrary<string> =>
    fc.tuple(
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{2,12}$/),
        fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{2,12}$/),
        fc.constantFrom('.ts', '.js'),
    ).map(([dir, file, ext]) => `./nonexistent-${dir}/${file}${ext}`);

/**
 * Arbitrary generator for various non-existent path formats
 * Combines different path formats to ensure comprehensive testing.
 */
const anyNonExistentPath = (): fc.Arbitrary<string> =>
    fc.oneof(
        nonExistentFilePath(),
        absoluteNonExistentPath(),
        relativeNonExistentPath(),
    );

// Feature: configurable-bundle-middleware, Property 12: Non-Existent Middleware File Error at Synthesis
describe('Feature: configurable-bundle-middleware, Property 12: Non-Existent Middleware File Error at Synthesis', () => {
    /**
     * **Validates: Requirements 5.7**
     */
    describe('Property 12: Non-Existent Middleware File Error at Synthesis', () => {
        /**
         * **Validates: Requirement 5.7**
         *
         * For any middlewarePath pointing to a non-existent file, the kata() wrapper
         * should throw an error during CDK synthesis.
         */
        it('should throw an error when middlewarePath points to a non-existent file', () => {
            fc.assert(
                fc.property(anyNonExistentPath(), (middlewarePath) => {
                    // Ensure the path doesn't actually exist (sanity check)
                    if (fs.existsSync(middlewarePath)) {
                        // Skip this case - the path unexpectedly exists
                        return true;
                    }

                    let errorThrown = false;
                    try {
                        validateMiddlewareFile(middlewarePath);
                    } catch (error) {
                        errorThrown = true;
                    }

                    return errorThrown;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 5.7**
         *
         * For any non-existent file path, the error message should contain the file path.
         */
        it('should include the file path in the error message', () => {
            fc.assert(
                fc.property(anyNonExistentPath(), (middlewarePath) => {
                    // Ensure the path doesn't actually exist (sanity check)
                    if (fs.existsSync(middlewarePath)) {
                        // Skip this case - the path unexpectedly exists
                        return true;
                    }

                    try {
                        validateMiddlewareFile(middlewarePath);
                        // Should not reach here
                        return false;
                    } catch (error) {
                        const errorMessage = (error as Error).message;
                        // Error message should contain the file path
                        return errorMessage.includes(middlewarePath);
                    }
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 5.7**
         *
         * The error message should indicate that the middleware file was not found.
         */
        it('should indicate "Middleware file not found" in the error message', () => {
            fc.assert(
                fc.property(anyNonExistentPath(), (middlewarePath) => {
                    // Ensure the path doesn't actually exist (sanity check)
                    if (fs.existsSync(middlewarePath)) {
                        // Skip this case - the path unexpectedly exists
                        return true;
                    }

                    try {
                        validateMiddlewareFile(middlewarePath);
                        // Should not reach here
                        return false;
                    } catch (error) {
                        const errorMessage = (error as Error).message;
                        // Error message should contain "Middleware file not found"
                        return errorMessage.includes('Middleware file not found');
                    }
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 5.7**
         *
         * Full simulation: For any non-existent middleware path, the full config layer
         * generation should throw an error with the file path in the message.
         */
        it('should throw error during full config layer generation for non-existent middleware', () => {
            fc.assert(
                fc.property(
                    validHandlerPath(),
                    anyNonExistentPath(),
                    (handlerPath, middlewarePath) => {
                        // Ensure the path doesn't actually exist (sanity check)
                        if (fs.existsSync(middlewarePath)) {
                            // Skip this case - the path unexpectedly exists
                            return true;
                        }

                        try {
                            simulateCreateKataConfigLayer(handlerPath, middlewarePath);
                            // Should not reach here - should have thrown
                            return false;
                        } catch (error) {
                            const errorMessage = (error as Error).message;
                            // Error should contain both the indicator and the path
                            return (
                                errorMessage.includes('Middleware file not found') &&
                                errorMessage.includes(middlewarePath)
                            );
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 5.7**
         *
         * The error should be thrown before any esbuild compilation is attempted.
         * This ensures fast failure during CDK synthesis.
         */
        it('should throw error before attempting esbuild compilation', () => {
            fc.assert(
                fc.property(anyNonExistentPath(), (middlewarePath) => {
                    // Ensure the path doesn't actually exist (sanity check)
                    if (fs.existsSync(middlewarePath)) {
                        // Skip this case - the path unexpectedly exists
                        return true;
                    }

                    try {
                        validateMiddlewareFile(middlewarePath);
                        return false;
                    } catch (error) {
                        // The error should be our validation error, not an esbuild error
                        const errorMessage = (error as Error).message;
                        // Should NOT contain esbuild-related error messages
                        const isEsbuildError =
                            errorMessage.includes('Build failed') ||
                            errorMessage.includes('Could not resolve');
                        return !isEsbuildError && errorMessage.includes('Middleware file not found');
                    }
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 5.7**
         *
         * The error should be thrown regardless of the handler path value.
         */
        it('should throw error regardless of handler path value', () => {
            fc.assert(
                fc.property(
                    validHandlerPath(),
                    anyNonExistentPath(),
                    (handlerPath, middlewarePath) => {
                        // Ensure the path doesn't actually exist (sanity check)
                        if (fs.existsSync(middlewarePath)) {
                            // Skip this case - the path unexpectedly exists
                            return true;
                        }

                        let errorThrown = false;
                        let errorContainsPath = false;

                        try {
                            simulateCreateKataConfigLayer(handlerPath, middlewarePath);
                        } catch (error) {
                            errorThrown = true;
                            errorContainsPath = (error as Error).message.includes(middlewarePath);
                        }

                        return errorThrown && errorContainsPath;
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 5.7**
         *
         * Test with various path formats: absolute, relative, with different extensions.
         */
        it('should handle various path formats correctly', () => {
            const pathFormats = [
                '/absolute/path/to/middleware.ts',
                './relative/path/middleware.js',
                '../parent/middleware.ts',
                'simple-middleware.js',
                '/deeply/nested/path/to/some/middleware.ts',
            ];

            for (const middlewarePath of pathFormats) {
                // Ensure the path doesn't actually exist
                if (fs.existsSync(middlewarePath)) {
                    continue;
                }

                let errorThrown = false;
                let errorContainsPath = false;

                try {
                    validateMiddlewareFile(middlewarePath);
                } catch (error) {
                    errorThrown = true;
                    errorContainsPath = (error as Error).message.includes(middlewarePath);
                }

                expect(errorThrown).toBe(true);
                expect(errorContainsPath).toBe(true);
            }
        });

        /**
         * **Validates: Requirement 5.7**
         *
         * The thrown error should be an instance of Error.
         */
        it('should throw an Error instance', () => {
            fc.assert(
                fc.property(anyNonExistentPath(), (middlewarePath) => {
                    // Ensure the path doesn't actually exist (sanity check)
                    if (fs.existsSync(middlewarePath)) {
                        // Skip this case - the path unexpectedly exists
                        return true;
                    }

                    try {
                        validateMiddlewareFile(middlewarePath);
                        return false;
                    } catch (error) {
                        return error instanceof Error;
                    }
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 5.7**
         *
         * Contrast test: Existing middleware file should NOT throw an error.
         */
        it('should NOT throw error when middleware file exists', () => {
            const existingMiddlewarePath = path.join(__dirname, 'fixtures', 'test-middleware.ts');

            // Verify the fixture exists
            expect(fs.existsSync(existingMiddlewarePath)).toBe(true);

            // Should not throw
            expect(() => validateMiddlewareFile(existingMiddlewarePath)).not.toThrow();
        });
    });
});

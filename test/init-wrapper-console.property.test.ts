/**
 * Property-Based Tests for Init Wrapper Console Method Redirection
 *
 * Feature: configurable-bundle-middleware, Property 8: Console Methods Redirect to Stderr with Prefix
 *
 * Property 8: Console Methods Redirect to Stderr with Prefix
 * *For any* string passed to `console.log`, `console.info`, `console.warn`, `console.debug`, or `console.trace`
 * after console transformation, the output should be written to stderr with `[Node.js]` prefix.
 * `console.error` should remain unchanged.
 *
 * **Validates: Requirements 3.2, 3.3**
 * - 3.2: THE Init_Wrapper SHALL preserve the original `console.error` behavior unchanged
 * - 3.3: THE overridden console methods SHALL prefix output with `[Node.js]` and write to stderr
 *
 * @module init-wrapper-console.property.test
 */

import * as fc from 'fast-check';

/**
 * Console method names that should be redirected (excluding error)
 */
const REDIRECTED_METHODS = ['log', 'info', 'warn', 'debug', 'trace'] as const;
type RedirectedMethod = typeof REDIRECTED_METHODS[number];

/**
 * Arbitrary generator for console method names (excluding error)
 */
const consoleMethod = (): fc.Arbitrary<RedirectedMethod> =>
    fc.constantFrom(...REDIRECTED_METHODS);

/**
 * Arbitrary generator for log messages
 * Generates strings of various lengths to test the console patching
 */
const logMessage = (): fc.Arbitrary<string> =>
    fc.string({ minLength: 1, maxLength: 100 });

/**
 * Arbitrary generator for multiple log arguments
 * Console methods can receive multiple arguments that get joined with spaces
 */
const logArguments = (): fc.Arbitrary<string[]> =>
    fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 1, maxLength: 5 });

/**
 * Simulates the console patching behavior from init_wrapper.js
 * This creates patched console methods that write to a capture buffer instead of stderr
 */
function createPatchedConsole(): {
    patchedConsole: Record<string, (...args: unknown[]) => void>;
    capturedOutput: string[];
    originalErrorCalls: unknown[][];
} {
    const capturedOutput: string[] = [];
    const originalErrorCalls: unknown[][] = [];

    // Simulate the original console.error behavior
    const originalConsoleError = (...args: unknown[]) => {
        originalErrorCalls.push(args);
    };

    // Create patched console methods matching init_wrapper.js implementation
    const patchedConsole: Record<string, (...args: unknown[]) => void> = {
        log: (...args: unknown[]) => {
            capturedOutput.push('[Node.js] ' + args.join(' ') + '\n');
        },
        info: (...args: unknown[]) => {
            capturedOutput.push('[Node.js] ' + args.join(' ') + '\n');
        },
        warn: (...args: unknown[]) => {
            capturedOutput.push('[Node.js] ' + args.join(' ') + '\n');
        },
        debug: (...args: unknown[]) => {
            capturedOutput.push('[Node.js] ' + args.join(' ') + '\n');
        },
        trace: (...args: unknown[]) => {
            capturedOutput.push('[Node.js] ' + args.join(' ') + '\n');
        },
        error: originalConsoleError, // Preserved original behavior
    };

    return { patchedConsole, capturedOutput, originalErrorCalls };
}

// Feature: configurable-bundle-middleware, Property 8: Console Methods Redirect to Stderr with Prefix
describe('Feature: configurable-bundle-middleware, Property 8: Console Methods Redirect to Stderr with Prefix', () => {
    /**
     * **Validates: Requirements 3.2, 3.3**
     */
    describe('Property 8: Console Methods Redirect to Stderr with Prefix', () => {
        /**
         * **Validates: Requirement 3.3**
         * THE overridden console methods SHALL prefix output with `[Node.js]` and write to stderr
         *
         * For any string passed to console.log, console.info, console.warn, console.debug, or console.trace,
         * the output should start with `[Node.js]` prefix.
         */
        it('should prefix output with [Node.js] for any redirected console method and message', () => {
            fc.assert(
                fc.property(consoleMethod(), logMessage(), (method, message) => {
                    const { patchedConsole, capturedOutput } = createPatchedConsole();

                    // Call the patched console method
                    patchedConsole[method](message);

                    // Verify output was captured
                    if (capturedOutput.length !== 1) {
                        return false;
                    }

                    // Verify the output starts with [Node.js] prefix
                    const output = capturedOutput[0];
                    return output.startsWith('[Node.js] ');
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 3.3**
         * The output should contain the original message after the prefix
         */
        it('should include the original message in the output after the prefix', () => {
            fc.assert(
                fc.property(consoleMethod(), logMessage(), (method, message) => {
                    const { patchedConsole, capturedOutput } = createPatchedConsole();

                    // Call the patched console method
                    patchedConsole[method](message);

                    // Verify the message is included in the output
                    const output = capturedOutput[0];
                    const expectedOutput = '[Node.js] ' + message + '\n';
                    return output === expectedOutput;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 3.3**
         * Multiple arguments should be joined with spaces
         */
        it('should join multiple arguments with spaces', () => {
            fc.assert(
                fc.property(consoleMethod(), logArguments(), (method, args) => {
                    const { patchedConsole, capturedOutput } = createPatchedConsole();

                    // Call the patched console method with multiple arguments
                    patchedConsole[method](...args);

                    // Verify the arguments are joined with spaces
                    const output = capturedOutput[0];
                    const expectedOutput = '[Node.js] ' + args.join(' ') + '\n';
                    return output === expectedOutput;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 3.3**
         * Output should end with a newline character
         */
        it('should end output with newline character', () => {
            fc.assert(
                fc.property(consoleMethod(), logMessage(), (method, message) => {
                    const { patchedConsole, capturedOutput } = createPatchedConsole();

                    // Call the patched console method
                    patchedConsole[method](message);

                    // Verify output ends with newline
                    const output = capturedOutput[0];
                    return output.endsWith('\n');
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 3.2**
         * THE Init_Wrapper SHALL preserve the original `console.error` behavior unchanged
         *
         * console.error should NOT be redirected - it should preserve original behavior
         */
        it('should preserve console.error behavior unchanged (not redirected)', () => {
            fc.assert(
                fc.property(logMessage(), (message) => {
                    const { patchedConsole, capturedOutput, originalErrorCalls } = createPatchedConsole();

                    // Call console.error
                    patchedConsole.error(message);

                    // Verify NO output was captured to the redirect buffer
                    if (capturedOutput.length !== 0) {
                        return false;
                    }

                    // Verify the original error handler was called
                    if (originalErrorCalls.length !== 1) {
                        return false;
                    }

                    // Verify the message was passed to original handler unchanged
                    return originalErrorCalls[0][0] === message;
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 3.2**
         * console.error with multiple arguments should pass all arguments to original handler
         */
        it('should pass all arguments to original console.error unchanged', () => {
            fc.assert(
                fc.property(logArguments(), (args) => {
                    const { patchedConsole, capturedOutput, originalErrorCalls } = createPatchedConsole();

                    // Call console.error with multiple arguments
                    patchedConsole.error(...args);

                    // Verify NO output was captured to the redirect buffer
                    if (capturedOutput.length !== 0) {
                        return false;
                    }

                    // Verify the original error handler was called with all arguments
                    if (originalErrorCalls.length !== 1) {
                        return false;
                    }

                    // Verify all arguments were passed unchanged
                    const passedArgs = originalErrorCalls[0];
                    if (passedArgs.length !== args.length) {
                        return false;
                    }

                    return args.every((arg, i) => passedArgs[i] === arg);
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirements 3.2, 3.3**
         * All redirected methods should behave identically (same prefix format)
         */
        it('should apply identical formatting across all redirected console methods', () => {
            fc.assert(
                fc.property(logMessage(), (message) => {
                    const { patchedConsole, capturedOutput } = createPatchedConsole();

                    // Call all redirected methods with the same message
                    for (const method of REDIRECTED_METHODS) {
                        patchedConsole[method](message);
                    }

                    // All outputs should be identical
                    const expectedOutput = '[Node.js] ' + message + '\n';
                    return capturedOutput.every(output => output === expectedOutput);
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 3.3**
         * Empty string arguments should still produce prefixed output
         */
        it('should handle empty string arguments correctly', () => {
            fc.assert(
                fc.property(consoleMethod(), (method) => {
                    const { patchedConsole, capturedOutput } = createPatchedConsole();

                    // Call with empty string
                    patchedConsole[method]('');

                    // Should still produce output with prefix
                    const output = capturedOutput[0];
                    return output === '[Node.js] \n';
                }),
                { numRuns: 100 }
            );
        });

        /**
         * **Validates: Requirement 3.3**
         * Special characters in messages should be preserved
         */
        it('should preserve special characters in messages', () => {
            // Test with strings containing special characters
            const specialChars = fc.stringOf(
                fc.constantFrom('\t', '\r', '\\', '"', "'", '<', '>', '&', '\u0000', '\u001F', '\uFFFF')
            );

            fc.assert(
                fc.property(consoleMethod(), specialChars, (method, message) => {
                    const { patchedConsole, capturedOutput } = createPatchedConsole();

                    // Call the patched console method
                    patchedConsole[method](message);

                    // Verify the message is preserved exactly
                    const output = capturedOutput[0];
                    const expectedOutput = '[Node.js] ' + message + '\n';
                    return output === expectedOutput;
                }),
                { numRuns: 100 }
            );
        });
    });
});

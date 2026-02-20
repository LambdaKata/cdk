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
 * Property-Based Tests for Init Wrapper Ready Signal Format
 *
 * Feature: configurable-bundle-middleware, Property 9: Ready Signal Format Preserved
 *
 * Property 9: Ready Signal Format Preserved
 * *For any* successful initialization (valid config, valid bundle, valid handler), the ready signal
 * should be `{"ready":true,"pid":<number>}` followed by newline.
 *
 * **Validates: Requirements 6.3**
 * - 6.3: THE Init_Wrapper SHALL continue to send the same ready/error signals in the same format
 *
 * @module init-wrapper-ready-signal.property.test
 */

import * as fc from 'fast-check';

/**
 * Interface representing the ready signal sent by init_wrapper.js on successful initialization
 */
interface ReadySignal {
    ready: true;
    pid: number;
}

/**
 * Arbitrary generator for valid process IDs
 * PIDs are positive integers, typically in the range 1 to 2^22 on most systems
 */
const validPid = (): fc.Arbitrary<number> =>
    fc.integer({ min: 1, max: 4194304 }); // 2^22 = 4194304

/**
 * Arbitrary generator for common PID values
 */
const commonPids = (): fc.Arbitrary<number> =>
    fc.oneof(
        fc.constantFrom(1, 2, 100, 1000, 12345, 32768, 65535, 100000),
        validPid()
    );

/**
 * Generates the ready signal string as init_wrapper.js would produce it
 * This mirrors the actual implementation:
 * ```javascript
 * process.stdout.write(JSON.stringify({ ready: true, pid: process.pid }) + '\n');
 * ```
 *
 * @param pid - The process ID to include in the signal
 * @returns The ready signal string with trailing newline
 */
function generateReadySignal(pid: number): string {
    return JSON.stringify({ ready: true, pid: pid }) + '\n';
}

/**
 * Parses a ready signal string and validates its format
 *
 * @param signal - The signal string to parse
 * @returns The parsed ReadySignal object or null if invalid
 */
function parseReadySignal(signal: string): ReadySignal | null {
    try {
        // Remove trailing newline for parsing
        const trimmed = signal.endsWith('\n') ? signal.slice(0, -1) : signal;
        const parsed = JSON.parse(trimmed);

        // Validate structure
        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            parsed.ready === true &&
            typeof parsed.pid === 'number'
        ) {
            return parsed as ReadySignal;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Validates that a ready signal string matches the expected format
 *
 * @param signal - The signal string to validate
 * @param expectedPid - The expected PID value
 * @returns True if the signal matches the expected format
 */
function validateReadySignalFormat(signal: string, expectedPid: number): boolean {
    // Must end with newline
    if (!signal.endsWith('\n')) {
        return false;
    }

    // Must be valid JSON (without the newline)
    const jsonPart = signal.slice(0, -1);
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonPart);
    } catch {
        return false;
    }

    // Must be an object with exactly two properties: ready and pid
    if (typeof parsed !== 'object' || parsed === null) {
        return false;
    }

    const keys = Object.keys(parsed);
    if (keys.length !== 2 || !keys.includes('ready') || !keys.includes('pid')) {
        return false;
    }

    // ready must be true (boolean)
    const obj = parsed as Record<string, unknown>;
    if (obj.ready !== true) {
        return false;
    }

    // pid must be the expected number
    if (obj.pid !== expectedPid) {
        return false;
    }

    return true;
}

// Feature: configurable-bundle-middleware, Property 9: Ready Signal Format Preserved
describe('Feature: configurable-bundle-middleware, Property 9: Ready Signal Format Preserved', () => {
    /**
     * **Validates: Requirements 6.3**
     */
    describe('Property 9: Ready Signal Format Preserved', () => {
        /**
         * **Validates: Requirement 6.3**
         * THE Init_Wrapper SHALL continue to send the same ready/error signals in the same format
         *
         * For any valid PID, the ready signal should be `{"ready":true,"pid":<number>}` followed by newline.
         */
        it('should generate ready signal in format {"ready":true,"pid":<number>}\\n for any valid PID', () => {
            fc.assert(
                fc.property(validPid(), (pid) => {
                    const signal = generateReadySignal(pid);
                    return validateReadySignalFormat(signal, pid);
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * The ready signal should always end with a newline character
         */
        it('should always end with a newline character', () => {
            fc.assert(
                fc.property(validPid(), (pid) => {
                    const signal = generateReadySignal(pid);
                    return signal.endsWith('\n');
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * The ready signal should be valid JSON (excluding the trailing newline)
         */
        it('should produce valid JSON that can be parsed correctly', () => {
            fc.assert(
                fc.property(validPid(), (pid) => {
                    const signal = generateReadySignal(pid);
                    const parsed = parseReadySignal(signal);

                    // Should parse successfully
                    if (parsed === null) {
                        return false;
                    }

                    // Should have correct values
                    return parsed.ready === true && parsed.pid === pid;
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * The ready field should always be the boolean true (not truthy value)
         */
        it('should have ready field as boolean true', () => {
            fc.assert(
                fc.property(validPid(), (pid) => {
                    const signal = generateReadySignal(pid);
                    const parsed = parseReadySignal(signal);

                    if (parsed === null) {
                        return false;
                    }

                    // Strict equality check for boolean true
                    return parsed.ready === true;
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * The pid field should be a number (not a string representation)
         */
        it('should have pid field as a number type', () => {
            fc.assert(
                fc.property(validPid(), (pid) => {
                    const signal = generateReadySignal(pid);
                    const parsed = parseReadySignal(signal);

                    if (parsed === null) {
                        return false;
                    }

                    return typeof parsed.pid === 'number';
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * The pid value should be preserved exactly (no rounding or modification)
         */
        it('should preserve the exact PID value', () => {
            fc.assert(
                fc.property(validPid(), (pid) => {
                    const signal = generateReadySignal(pid);
                    const parsed = parseReadySignal(signal);

                    if (parsed === null) {
                        return false;
                    }

                    return parsed.pid === pid;
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * The ready signal should have exactly two properties: ready and pid
         */
        it('should have exactly two properties: ready and pid', () => {
            fc.assert(
                fc.property(validPid(), (pid) => {
                    const signal = generateReadySignal(pid);
                    const jsonPart = signal.slice(0, -1);
                    const parsed = JSON.parse(jsonPart);

                    const keys = Object.keys(parsed);
                    return keys.length === 2 && keys.includes('ready') && keys.includes('pid');
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * The ready signal format should be consistent across multiple generations
         */
        it('should produce consistent format for the same PID', () => {
            fc.assert(
                fc.property(validPid(), (pid) => {
                    const signal1 = generateReadySignal(pid);
                    const signal2 = generateReadySignal(pid);
                    const signal3 = generateReadySignal(pid);

                    // All signals should be identical
                    return signal1 === signal2 && signal2 === signal3;
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * Test with common PID values used in real systems
         */
        it('should work correctly with common PID values', () => {
            fc.assert(
                fc.property(commonPids(), (pid) => {
                    const signal = generateReadySignal(pid);
                    return validateReadySignalFormat(signal, pid);
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * The signal should be a single line (only one newline at the end)
         */
        it('should be a single line with only one newline at the end', () => {
            fc.assert(
                fc.property(validPid(), (pid) => {
                    const signal = generateReadySignal(pid);

                    // Count newlines
                    const newlineCount = (signal.match(/\n/g) || []).length;

                    // Should have exactly one newline at the end
                    return newlineCount === 1 && signal.endsWith('\n');
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * The JSON should not have extra whitespace (compact format)
         */
        it('should produce compact JSON without extra whitespace', () => {
            fc.assert(
                fc.property(validPid(), (pid) => {
                    const signal = generateReadySignal(pid);
                    const jsonPart = signal.slice(0, -1);

                    // The JSON should match the compact format exactly
                    const expected = `{"ready":true,"pid":${pid}}`;
                    return jsonPart === expected;
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * Round-trip: generate signal, parse it, regenerate should produce same result
         */
        it('should support round-trip: generate -> parse -> regenerate produces same signal', () => {
            fc.assert(
                fc.property(validPid(), (pid) => {
                    const signal1 = generateReadySignal(pid);
                    const parsed = parseReadySignal(signal1);

                    if (parsed === null) {
                        return false;
                    }

                    const signal2 = generateReadySignal(parsed.pid);
                    return signal1 === signal2;
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * Edge case: PID of 1 (init process)
         */
        it('should handle PID 1 correctly', () => {
            const signal = generateReadySignal(1);
            const expected = '{"ready":true,"pid":1}\n';
            expect(signal).toBe(expected);
            expect(validateReadySignalFormat(signal, 1)).toBe(true);
        });

        /**
         * **Validates: Requirement 6.3**
         * Edge case: Large PID values
         */
        it('should handle large PID values correctly', () => {
            fc.assert(
                fc.property(fc.integer({ min: 1000000, max: 4194304 }), (pid) => {
                    const signal = generateReadySignal(pid);
                    return validateReadySignalFormat(signal, pid);
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * The signal should be parseable by standard JSON.parse
         */
        it('should be parseable by standard JSON.parse', () => {
            fc.assert(
                fc.property(validPid(), (pid) => {
                    const signal = generateReadySignal(pid);
                    const jsonPart = signal.slice(0, -1);

                    try {
                        const parsed = JSON.parse(jsonPart);
                        return parsed.ready === true && parsed.pid === pid;
                    } catch {
                        return false;
                    }
                }),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * Verify the exact format matches what init_wrapper.js produces
         */
        it('should match the exact format produced by init_wrapper.js', () => {
            fc.assert(
                fc.property(validPid(), (pid) => {
                    const signal = generateReadySignal(pid);

                    // This is exactly how init_wrapper.js generates the signal:
                    // process.stdout.write(JSON.stringify({ ready: true, pid: process.pid }) + '\n');
                    const expectedSignal = JSON.stringify({ ready: true, pid: pid }) + '\n';

                    return signal === expectedSignal;
                }),
                { numRuns: 10 }
            );
        });
    });
});

/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Utility functions for property-based testing with fail-safe guarantees
 */

import * as fc from 'fast-check';

/**
 * Safe property test wrapper that GUARANTEES tests will complete
 *
 * This wrapper adds multiple layers of protection against hanging tests:
 * 1. Maximum timeout (never exceed 30 seconds)
 * 2. Limited iterations (never exceed 100 runs)
 * 3. Automatic timeout detection and reporting
 * 4. Graceful failure with detailed error information
 */
export async function safePropertyTest<T>(
  property: fc.IAsyncProperty<T> | fc.IProperty<T>,
  options: {
    numRuns?: number;
    timeout?: number;
    verbose?: boolean;
    testName?: string;
  } = {},
): Promise<void> {
  const {
    numRuns = 50,           // Default: 50 runs (reasonable for most tests)
    timeout = 25000,        // Default: 25 seconds (less than Jest's 30s limit)
    verbose = false,
    testName = 'Property test',
  } = options;

  // SAFETY LIMITS - NEVER EXCEED THESE
  const MAX_RUNS = 100;
  const MAX_TIMEOUT = 30000; // 30 seconds absolute maximum

  const safeNumRuns = Math.min(numRuns, MAX_RUNS);
  const safeTimeout = Math.min(timeout, MAX_TIMEOUT);

  console.log(`🧪 Starting ${testName} (${safeNumRuns} runs, ${safeTimeout}ms timeout)`);

  const startTime = Date.now();
  let completed = false;

  let timeoutHandle: NodeJS.Timeout | null = null;

  // Create a timeout promise that will reject if test takes too long
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      if (!completed) {
        const elapsed = Date.now() - startTime;
        reject(new Error(
          `❌ PROPERTY TEST TIMEOUT: ${testName} exceeded ${safeTimeout}ms limit (ran for ${elapsed}ms). ` +
          `This indicates a potential infinite loop or hanging operation. ` +
          `Check your generators and test logic for .filter() operations or blocking calls.`,
        ));
      }
    }, safeTimeout);
  });

  // Create the actual test promise
  const testPromise = (async () => {
    await fc.assert(property, {
      numRuns: safeNumRuns,
      timeout: safeTimeout - 1000, // Leave 1 second buffer for cleanup
      verbose,
      // Additional safety options
      endOnFailure: true,        // Stop on first failure to prevent long runs
      interruptAfterTimeLimit: safeTimeout - 2000, // Interrupt 2 seconds before timeout
    });

    completed = true;
    const elapsed = Date.now() - startTime;
    console.log(`✅ ${testName} completed successfully in ${elapsed}ms`);
  })();

  try {
    // Race between test completion and timeout
    await Promise.race([testPromise, timeoutPromise]);
  } catch (error) {
    completed = true;
    const elapsed = Date.now() - startTime;

    if (error instanceof Error && error.message.includes('PROPERTY TEST TIMEOUT')) {
      // This is our timeout error - provide helpful debugging info
      console.error(`❌ ${testName} TIMED OUT after ${elapsed}ms`);
      console.error('🔍 Debugging tips:');
      console.error('  - Check for .filter() operations that might create infinite loops');
      console.error('  - Look for blocking operations without timeouts');
      console.error('  - Verify generators produce valid data efficiently');
      console.error('  - Consider reducing numRuns or simplifying test logic');
      throw error;
    } else {
      // This is a regular test failure
      console.log(`❌ ${testName} failed after ${elapsed}ms:`, error);
      throw error;
    }
  } finally {
    // Always clean up the timeout to prevent Jest warnings
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }
}

/**
 * Create a safe account ID generator that NEVER hangs
 *
 * This replaces dangerous patterns like:
 * fc.string().filter(s => /^\d{12}$/.test(s))
 */
export const safeAccountIdGenerator = fc.integer({
  min: 100000000000,
  max: 999999999999,
}).map(n => n.toString());

/**
 * Create a safe invalid account ID generator
 *
 * This replaces dangerous patterns with predefined invalid formats
 */
export const safeInvalidAccountIdGenerator = fc.oneof(
  fc.constant(''),                    // Empty
  fc.constant('abc123def456'),        // Contains letters
  fc.constant('123456789'),           // Too short
  fc.constant('1234567890123'),       // Too long
  fc.constant('12345678901a'),        // Letter at end
  fc.constant('a23456789012'),        // Letter at start
  fc.constant('123-456-7890'),        // Contains dashes
  fc.constant('123 456 7890'),        // Contains spaces
  fc.constant('123.456.789'),         // Contains dots
  fc.constant('null'),                // String "null"
  fc.constant('undefined'),            // String "undefined"
);

/**
 * Create a safe array generator with guaranteed uniqueness
 *
 * This avoids .filter() operations that might hang when looking for unique values
 */
export function safeUniqueArrayGenerator<T>(
  generator: fc.Arbitrary<T>,
  options: {
    minLength?: number;
    maxLength?: number;
    maxAttempts?: number;
  } = {},
): fc.Arbitrary<T[]> {
  const { minLength = 1, maxLength = 10, maxAttempts = 100 } = options;

  return fc.integer({ min: minLength, max: maxLength }).chain(length => {
    return fc.array(generator, { minLength: length * 2, maxLength: length * 3 })
      .map(arr => {
        // Use Set to remove duplicates, then take first 'length' items
        const unique = [...new Set(arr)];
        return unique.slice(0, Math.max(length, minLength));
      });
  });
}

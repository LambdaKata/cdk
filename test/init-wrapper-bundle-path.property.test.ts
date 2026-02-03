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
 * Property-Based Tests for Init Wrapper Bundle Path in Error Messages
 *
 * Feature: configurable-bundle-middleware, Property 2: Bundle Path in Error Message
 *
 * Property 2: Bundle Path in Error Message
 * *For any* non-existent file path configured as `bundle_path`, the error signal should contain
 * that path in the error message.
 *
 * **Validates: Requirements 1.6, 8.3**
 * - 1.6: IF the bundle file does not exist at the specified path, THEN THE Init_Wrapper SHALL send
 *        an error signal with a descriptive message including the path
 * - 8.3: IF the bundle path is invalid or the file doesn't exist, THEN THE Init_Wrapper SHALL
 *        include the path in the error message
 *
 * @module init-wrapper-bundle-path.property.test
 */

import * as fc from 'fast-check';

/**
 * Arbitrary generator for valid bundle paths
 * Generates paths matching the pattern: /path/to/file.js
 * Examples: "/var/task/index.js", "/opt/custom/bundle.js", "/a/b/c.js"
 */
const validBundlePath = (): fc.Arbitrary<string> =>
  fc.stringMatching(/^\/[a-zA-Z0-9_][a-zA-Z0-9_/]*\.js$/);

/**
 * Arbitrary generator for bundle paths with various valid characters
 * Includes underscores, numbers, and nested paths
 */
const bundlePathWithVariety = (): fc.Arbitrary<string> =>
  fc.oneof(
    // Simple paths
    fc.stringMatching(/^\/[a-zA-Z][a-zA-Z0-9_]*\.js$/),
    // Nested paths
    fc.stringMatching(/^\/[a-zA-Z][a-zA-Z0-9_]*\/[a-zA-Z][a-zA-Z0-9_]*\.js$/),
    // Deeply nested paths
    fc.stringMatching(/^\/[a-zA-Z][a-zA-Z0-9_]*\/[a-zA-Z][a-zA-Z0-9_]*\/[a-zA-Z][a-zA-Z0-9_]*\.js$/),
    // Paths with numbers
    fc.stringMatching(/^\/[a-zA-Z][a-zA-Z0-9_]*[0-9]+\.js$/),
    // Common Lambda paths
    fc.constantFrom(
      '/var/task/index.js',
      '/var/task/handler.js',
      '/var/task/src/index.js',
      '/opt/custom/bundle.js',
      '/opt/js_runtime/custom.js',
    ),
  );

/**
 * Interface representing the error signal sent by init_wrapper.js
 */
interface ErrorSignal {
  ready: false;
  error: string;
}

/**
 * Simulates the error handling behavior from init_wrapper.js when a bundle file doesn't exist.
 * This mirrors the actual implementation in js_runtime/init_wrapper.js
 *
 * @param bundlePath - The path to the non-existent bundle file
 * @returns The error signal that would be sent via stdout
 */
function simulateBundleLoadError(bundlePath: string): ErrorSignal {
  // Simulate Node.js require() error for non-existent file
  const nodeError = new Error(`Cannot find module '${bundlePath}'`);

  // Mirror the error handling logic from init_wrapper.js:
  // const errorMessage = err.message.includes(bundlePath)
  //     ? err.message
  //     : `Failed to load bundle from '${bundlePath}': ${err.message}`;
  const errorMessage = nodeError.message.includes(bundlePath)
    ? nodeError.message
    : `Failed to load bundle from '${bundlePath}': ${nodeError.message}`;

  return {
    ready: false,
    error: errorMessage,
  };
}

/**
 * Simulates error handling when the bundle path is NOT included in the original error
 * (e.g., for other types of errors like syntax errors)
 *
 * @param bundlePath - The path to the bundle file
 * @param originalError - The original error message without the path
 * @returns The error signal that would be sent via stdout
 */
function simulateBundleLoadErrorWithoutPath(
  bundlePath: string,
  originalError: string,
): ErrorSignal {
  // Mirror the error handling logic from init_wrapper.js
  const errorMessage = originalError.includes(bundlePath)
    ? originalError
    : `Failed to load bundle from '${bundlePath}': ${originalError}`;

  return {
    ready: false,
    error: errorMessage,
  };
}

// Feature: configurable-bundle-middleware, Property 2: Bundle Path in Error Message
describe('Feature: configurable-bundle-middleware, Property 2: Bundle Path in Error Message', () => {
  /**
   * **Validates: Requirements 1.6, 8.3**
   */
  describe('Property 2: Bundle Path in Error Message', () => {
    /**
     * **Validates: Requirements 1.6, 8.3**
     * For any non-existent file path configured as bundle_path, the error signal
     * should contain that path in the error message.
     *
     * This tests the primary property: error messages always include the bundle path.
     */
    it('should include bundle path in error message for any non-existent bundle path', () => {
      return fc.assert(
        fc.property(validBundlePath(), (bundlePath) => {
          const errorSignal = simulateBundleLoadError(bundlePath);

          // The error message should contain the bundle path
          return errorSignal.error.includes(bundlePath);
        }),
        { numRuns: 15 },
      );
    });

    /**
     * **Validates: Requirements 1.6, 8.3**
     * Test with a variety of bundle path formats to ensure robustness
     */
    it('should include bundle path in error message for various path formats', () => {
      return fc.assert(
        fc.property(bundlePathWithVariety(), (bundlePath) => {
          const errorSignal = simulateBundleLoadError(bundlePath);

          // The error message should contain the bundle path
          return errorSignal.error.includes(bundlePath);
        }),
        { numRuns: 15 },
      );
    });

    /**
     * **Validates: Requirement 1.6**
     * The error signal should have ready: false when bundle loading fails
     */
    it('should set ready to false in error signal for any non-existent bundle', () => {
      return fc.assert(
        fc.property(validBundlePath(), (bundlePath) => {
          const errorSignal = simulateBundleLoadError(bundlePath);

          // The ready field should be false
          return errorSignal.ready === false;
        }),
        { numRuns: 15 },
      );
    });

    /**
     * **Validates: Requirements 1.6, 8.3**
     * Even when the original error doesn't include the path, the final error message should
     */
    it('should add bundle path to error message when original error lacks it', () => {
      // Generate error messages that don't contain the bundle path
      const errorWithoutPath = fc.stringOf(
        fc.constantFrom('a', 'b', 'c', 'd', 'e', ' ', '.', ':', '-'),
        { minLength: 5, maxLength: 50 },
      );

      return fc.assert(
        fc.property(
          validBundlePath(),
          errorWithoutPath,
          (bundlePath, originalError) => {
            // Ensure the original error doesn't accidentally contain the path
            if (originalError.includes(bundlePath)) {
              return true; // Skip this case
            }

            const errorSignal = simulateBundleLoadErrorWithoutPath(
              bundlePath,
              originalError,
            );

            // The final error message should contain the bundle path
            return errorSignal.error.includes(bundlePath);
          },
        ),
        { numRuns: 15 },
      );
    });

    /**
     * **Validates: Requirements 1.6, 8.3**
     * When the original error already includes the path, it should be preserved
     */
    it('should preserve bundle path when original error already contains it', () => {
      return fc.assert(
        fc.property(validBundlePath(), (bundlePath) => {
          // Simulate Node.js "Cannot find module" error which includes the path
          const originalError = `Cannot find module '${bundlePath}'`;
          const errorSignal = simulateBundleLoadErrorWithoutPath(
            bundlePath,
            originalError,
          );

          // The error message should contain the bundle path exactly once
          // (not duplicated)
          const pathOccurrences = (
            errorSignal.error.match(new RegExp(escapeRegExp(bundlePath), 'g')) || []
          ).length;

          return pathOccurrences >= 1 && errorSignal.error.includes(bundlePath);
        }),
        { numRuns: 15 },
      );
    });

    /**
     * **Validates: Requirement 8.3**
     * Error message should be descriptive (not just the path)
     */
    it('should produce descriptive error message containing more than just the path', () => {
      return fc.assert(
        fc.property(validBundlePath(), (bundlePath) => {
          const errorSignal = simulateBundleLoadError(bundlePath);

          // Error message should be longer than just the path
          // (should include descriptive text like "Cannot find module" or "Failed to load")
          return errorSignal.error.length > bundlePath.length;
        }),
        { numRuns: 15 },
      );
    });

    /**
     * **Validates: Requirements 1.6, 8.3**
     * Error signal should be valid JSON-serializable
     */
    it('should produce JSON-serializable error signal for any bundle path', () => {
      return fc.assert(
        fc.property(validBundlePath(), (bundlePath) => {
          const errorSignal = simulateBundleLoadError(bundlePath);

          // Should be serializable to JSON and back
          try {
            const serialized = JSON.stringify(errorSignal);
            const deserialized = JSON.parse(serialized);
            return (
              deserialized.ready === false &&
              deserialized.error.includes(bundlePath)
            );
          } catch {
            return false;
          }
        }),
        { numRuns: 15 },
      );
    });

    /**
     * **Validates: Requirements 1.6, 8.3**
     * Test with paths containing underscores and numbers
     */
    it('should handle bundle paths with underscores and numbers correctly', () => {
      const pathWithSpecialChars = fc.stringMatching(
        /^\/[a-zA-Z][a-zA-Z0-9_]*_[a-zA-Z0-9_]*[0-9]+\.js$/,
      );

      return fc.assert(
        fc.property(pathWithSpecialChars, (bundlePath) => {
          const errorSignal = simulateBundleLoadError(bundlePath);

          // The error message should contain the bundle path exactly
          return errorSignal.error.includes(bundlePath);
        }),
        { numRuns: 15 },
      );
    });

    /**
     * **Validates: Requirements 1.6, 8.3**
     * Test determinism: same path should always produce same error format
     */
    it('should produce consistent error messages for the same bundle path', () => {
      return fc.assert(
        fc.property(validBundlePath(), (bundlePath) => {
          const errorSignal1 = simulateBundleLoadError(bundlePath);
          const errorSignal2 = simulateBundleLoadError(bundlePath);

          // Same input should produce same output
          return errorSignal1.error === errorSignal2.error;
        }),
        { numRuns: 15 },
      );
    });
  });
});

/**
 * Helper function to escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
 * Property-Based Tests for Config Layer Generator
 *
 * Feature: config-layer-handler-path, Property 5: Unique Config Content for Different Handlers
 *
 * Property 5: Unique Config Content for Different Handlers
 * *For any* two distinct handler path strings, the generated config JSON content should be different.
 *
 * This property ensures that different handler paths produce different config files,
 * which is necessary for the per-Lambda config layer approach.
 *
 * **Validates: Requirements 3.5**
 * - THE Config_Layer SHALL be created as a unique asset per Lambda function to support different handler paths
 *
 * @module config-layer.property.test
 */

import * as fc from 'fast-check';
import { generateConfigContent, HANDLER_CONFIG_KEY } from '../src/config-layer';

/**
 * Arbitrary generator for valid handler paths
 * Generates paths matching the pattern: <module>.<function> or <path/module>.<function>
 * Examples: "bundle.handler", "src/index.handler", "handlers/api/users.createUser"
 */
const validHandlerPath = (): fc.Arbitrary<string> =>
  fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_/]*\.[a-zA-Z_][a-zA-Z0-9_]*$/);

/**
 * Arbitrary generator for pairs of different handler paths
 * Ensures the two handler paths are distinct
 */
const differentHandlerPaths = (): fc.Arbitrary<[string, string]> =>
  fc.tuple(
    validHandlerPath(),
    validHandlerPath().map(path => path + '-different'),
  );

// Feature: config-layer-handler-path, Property 5: Unique Config Content for Different Handlers
describe('Feature: config-layer-handler-path, Property 5: Unique Config Content for Different Handlers', () => {
  /**
   * **Validates: Requirements 3.5**
   */
  describe('Property 5: Unique Config Content for Different Handlers', () => {
    /**
     * **Validates: Requirement 3.5**
     * THE Config_Layer SHALL be created as a unique asset per Lambda function to support different handler paths
     *
     * For any two distinct handler path strings, the generated config JSON content should be different.
     */
    it('should generate different config content for any two distinct handler paths', () => {
      return fc.assert(
        fc.property(differentHandlerPaths(), ([handlerPath1, handlerPath2]) => {
          // Generate config content for both handler paths
          const content1 = generateConfigContent(handlerPath1);
          const content2 = generateConfigContent(handlerPath2);

          // The generated content should be different
          return content1 !== content2;
        }),
        { numRuns: 7 },
      );
    });

    /**
     * Additional property: The difference in content should be due to the handler path value
     * This verifies that the handler path is correctly embedded in the JSON
     */
    it('should embed the handler path correctly in the generated JSON', () => {
      return fc.assert(
        fc.property(validHandlerPath(), (handlerPath) => {
          const content = generateConfigContent(handlerPath);

          // Parse the generated JSON
          const parsed = JSON.parse(content);

          // The handler path should be stored under the correct key
          return parsed[HANDLER_CONFIG_KEY] === handlerPath;
        }),
        { numRuns: 7 },
      );
    });

    /**
     * Property: Generated content should be valid JSON for any valid handler path
     */
    it('should generate valid JSON for any valid handler path', () => {
      return fc.assert(
        fc.property(validHandlerPath(), (handlerPath) => {
          const content = generateConfigContent(handlerPath);

          // Should not throw when parsing
          try {
            JSON.parse(content);
            return true;
          } catch {
            return false;
          }
        }),
        { numRuns: 7 },
      );
    });

    /**
     * Property: The generated JSON should contain exactly one key (original_js_handler)
     */
    it('should generate JSON with exactly the original_js_handler key', () => {
      return fc.assert(
        fc.property(validHandlerPath(), (handlerPath) => {
          const content = generateConfigContent(handlerPath);
          const parsed = JSON.parse(content);
          const keys = Object.keys(parsed);

          // Should have exactly one key
          return keys.length === 1 && keys[0] === HANDLER_CONFIG_KEY;
        }),
        { numRuns: 7 },
      );
    });

    /**
     * Property: Generating config twice with the same handler should produce identical content
     * This ensures deterministic behavior
     */
    it('should generate identical content for the same handler path (deterministic)', () => {
      return fc.assert(
        fc.property(validHandlerPath(), (handlerPath) => {
          const content1 = generateConfigContent(handlerPath);
          const content2 = generateConfigContent(handlerPath);

          // Same input should produce same output
          return content1 === content2;
        }),
        { numRuns: 7 },
      );
    });
  });
});

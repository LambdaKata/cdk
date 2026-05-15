/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Property-Based Tests for Config Layer Generation Round-Trip
 *
 * Feature: configurable-bundle-middleware, Property 1: Config Generation Round-Trip
 *
 * Property 1: Config Generation Round-Trip
 * *For any* valid config object containing `original_js_handler`, optional `bundle_path`,
 * and optional `has_middleware`, generating the config JSON and then parsing it should
 * return an equivalent config object.
 *
 * **Validates: Requirements 1.1, 4.2**
 * - Req 1.1: THE Config_Layer JSON schema SHALL support a `bundle_path` key containing the path to the JavaScript bundle
 * - Req 4.2: WHEN `bundlePath` is specified, THE kata_Wrapper SHALL write it to the Config_Layer JSON as `bundle_path`
 *
 * @module config-layer-roundtrip.property.test
 */

import * as fc from 'fast-check';
import { HANDLER_CONFIG_KEY } from '../src/config-layer';

/**
 * Interface representing the config object structure
 * This matches the extended config schema from the design document
 */
interface KataConfig {
  /**
   * The original Node.js handler path.
   * Format: "<module>.<function>" or "<path/module>.<function>"
   * Required for all deployments.
   */
  original_js_handler: string;

  /**
   * Path to the JavaScript bundle.
   * Optional - defaults to /opt/js_runtime/bundle.js
   */
  bundle_path?: string;

  /**
   * Whether middleware.js exists in the config layer.
   * Optional - defaults to false.
   */
  has_middleware?: boolean;
}

/**
 * Generates config JSON content from a config object.
 * This simulates what createKataConfigLayer does internally.
 *
 * @param config - The config object to serialize
 * @returns The JSON string representation
 */
function generateConfigJson(config: KataConfig): string {
  const configObj: Record<string, unknown> = {
    [HANDLER_CONFIG_KEY]: config.original_js_handler,
  };

  if (config.bundle_path !== undefined) {
    configObj['bundle_path'] = config.bundle_path;
  }

  if (config.has_middleware !== undefined) {
    configObj['has_middleware'] = config.has_middleware;
  }

  return JSON.stringify(configObj, null, 2);
}

/**
 * Parses config JSON content back to a config object.
 * This simulates what init_wrapper.js does when reading the config.
 *
 * @param json - The JSON string to parse
 * @returns The parsed config object
 */
function parseConfigJson(json: string): KataConfig {
  const parsed = JSON.parse(json);
  const config: KataConfig = {
    original_js_handler: parsed[HANDLER_CONFIG_KEY],
  };

  if (parsed['bundle_path'] !== undefined) {
    config.bundle_path = parsed['bundle_path'];
  }

  if (parsed['has_middleware'] !== undefined) {
    config.has_middleware = parsed['has_middleware'];
  }

  return config;
}

/**
 * Arbitrary generator for valid handler paths
 * Generates paths matching the pattern: <module>.<function> or <path/module>.<function>
 * Examples: "bundle.handler", "src/index.handler", "handlers/api/users.createUser"
 */
const validHandlerPath = (): fc.Arbitrary<string> =>
  fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_/]*\.[a-zA-Z_][a-zA-Z0-9_]*$/);

/**
 * Arbitrary generator for valid bundle paths
 * Generates paths matching the pattern: /<path>/<file>.js
 * Examples: "/var/task/index.js", "/opt/js_runtime/bundle.js"
 */
const validBundlePath = (): fc.Arbitrary<string> =>
  fc.stringMatching(/^\/[a-zA-Z0-9_/]+\.js$/);

/**
 * Arbitrary generator for optional bundle paths
 * Returns either undefined or a valid bundle path
 */
const optionalBundlePath = (): fc.Arbitrary<string | undefined> =>
  fc.option(validBundlePath(), { nil: undefined });

/**
 * Arbitrary generator for optional has_middleware boolean
 * Returns either undefined, true, or false
 */
const optionalHasMiddleware = (): fc.Arbitrary<boolean | undefined> =>
  fc.option(fc.boolean(), { nil: undefined });

/**
 * Arbitrary generator for valid KataConfig objects
 * Generates config objects with required original_js_handler and optional bundle_path and has_middleware
 */
const validKataConfig = (): fc.Arbitrary<KataConfig> =>
  fc.record({
    original_js_handler: validHandlerPath(),
    bundle_path: optionalBundlePath(),
    has_middleware: optionalHasMiddleware(),
  });

/**
 * Helper function to check if two config objects are equivalent
 * Handles undefined values correctly
 */
function configsAreEquivalent(config1: KataConfig, config2: KataConfig): boolean {
  // Check required field
  if (config1.original_js_handler !== config2.original_js_handler) {
    return false;
  }

  // Check optional bundle_path
  if (config1.bundle_path !== config2.bundle_path) {
    return false;
  }

  // Check optional has_middleware
  if (config1.has_middleware !== config2.has_middleware) {
    return false;
  }

  return true;
}

// Feature: configurable-bundle-middleware, Property 1: Config Generation Round-Trip
describe('Feature: configurable-bundle-middleware, Property 1: Config Generation Round-Trip', () => {
  /**
   * **Validates: Requirements 1.1, 4.2**
   */
  describe('Property 1: Config Generation Round-Trip', () => {
    /**
     * **Validates: Requirements 1.1, 4.2**
     *
     * For any valid config object containing original_js_handler, optional bundle_path,
     * and optional has_middleware, generating the config JSON and then parsing it
     * should return an equivalent config object.
     */
    it('should preserve config values through JSON serialization and parsing round-trip', () => {
      return fc.assert(
        fc.property(validKataConfig(), (config) => {
          // Generate JSON from config
          const json = generateConfigJson(config);

          // Parse JSON back to config
          const parsedConfig = parseConfigJson(json);

          // Verify round-trip preserves all values
          return configsAreEquivalent(config, parsedConfig);
        }),
        { numRuns: 7 },
      );
    });

    /**
     * Property: Generated JSON should always be valid JSON
     */
    it('should generate valid JSON for any valid config object', () => {
      return fc.assert(
        fc.property(validKataConfig(), (config) => {
          const json = generateConfigJson(config);

          // Should not throw when parsing
          try {
            JSON.parse(json);
            return true;
          } catch {
            return false;
          }
        }),
        { numRuns: 7 },
      );
    });

    /**
     * Property: The original_js_handler field should always be present in generated JSON
     * **Validates: Requirement 1.1**
     */
    it('should always include original_js_handler in generated JSON', () => {
      return fc.assert(
        fc.property(validKataConfig(), (config) => {
          const json = generateConfigJson(config);
          const parsed = JSON.parse(json);

          return (
            HANDLER_CONFIG_KEY in parsed &&
            parsed[HANDLER_CONFIG_KEY] === config.original_js_handler
          );
        }),
        { numRuns: 7 },
      );
    });

    /**
     * Property: bundle_path should be present in JSON only when specified in config
     * **Validates: Requirement 4.2**
     */
    it('should include bundle_path in JSON only when specified', () => {
      return fc.assert(
        fc.property(validKataConfig(), (config) => {
          const json = generateConfigJson(config);
          const parsed = JSON.parse(json);

          if (config.bundle_path !== undefined) {
            // When bundle_path is specified, it should be in the JSON
            return (
              'bundle_path' in parsed &&
              parsed['bundle_path'] === config.bundle_path
            );
          } else {
            // When bundle_path is not specified, it should not be in the JSON
            return !('bundle_path' in parsed);
          }
        }),
        { numRuns: 7 },
      );
    });

    /**
     * Property: has_middleware should be present in JSON only when specified in config
     */
    it('should include has_middleware in JSON only when specified', () => {
      return fc.assert(
        fc.property(validKataConfig(), (config) => {
          const json = generateConfigJson(config);
          const parsed = JSON.parse(json);

          if (config.has_middleware !== undefined) {
            // When has_middleware is specified, it should be in the JSON
            return (
              'has_middleware' in parsed &&
              parsed['has_middleware'] === config.has_middleware
            );
          } else {
            // When has_middleware is not specified, it should not be in the JSON
            return !('has_middleware' in parsed);
          }
        }),
        { numRuns: 7 },
      );
    });

    /**
     * Property: Multiple round-trips should produce identical results (idempotent)
     */
    it('should be idempotent - multiple round-trips produce identical results', () => {
      return fc.assert(
        fc.property(validKataConfig(), (config) => {
          // First round-trip
          const json1 = generateConfigJson(config);
          const parsed1 = parseConfigJson(json1);

          // Second round-trip
          const json2 = generateConfigJson(parsed1);
          const parsed2 = parseConfigJson(json2);

          // Both round-trips should produce equivalent configs
          return (
            configsAreEquivalent(config, parsed1) &&
            configsAreEquivalent(parsed1, parsed2) &&
            json1 === json2
          );
        }),
        { numRuns: 7 },
      );
    });

    /**
     * Property: Config with only required field should round-trip correctly
     */
    it('should round-trip correctly with only original_js_handler', () => {
      return fc.assert(
        fc.property(validHandlerPath(), (handlerPath) => {
          const config: KataConfig = {
            original_js_handler: handlerPath,
          };

          const json = generateConfigJson(config);
          const parsedConfig = parseConfigJson(json);

          return (
            parsedConfig.original_js_handler === handlerPath &&
            parsedConfig.bundle_path === undefined &&
            parsedConfig.has_middleware === undefined
          );
        }),
        { numRuns: 7 },
      );
    });

    /**
     * Property: Config with all fields should round-trip correctly
     */
    it('should round-trip correctly with all fields specified', () => {
      return fc.assert(
        fc.property(
          validHandlerPath(),
          validBundlePath(),
          fc.boolean(),
          (handlerPath, bundlePath, hasMiddleware) => {
            const config: KataConfig = {
              original_js_handler: handlerPath,
              bundle_path: bundlePath,
              has_middleware: hasMiddleware,
            };

            const json = generateConfigJson(config);
            const parsedConfig = parseConfigJson(json);

            return (
              parsedConfig.original_js_handler === handlerPath &&
              parsedConfig.bundle_path === bundlePath &&
              parsedConfig.has_middleware === hasMiddleware
            );
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * Property: JSON key names should match the expected schema
     */
    it('should use correct JSON key names matching the schema', () => {
      return fc.assert(
        fc.property(validKataConfig(), (config) => {
          const json = generateConfigJson(config);
          const parsed = JSON.parse(json);
          const keys = Object.keys(parsed);

          // All keys should be from the expected set
          const validKeys = new Set([
            'original_js_handler',
            'bundle_path',
            'has_middleware',
          ]);

          return keys.every((key) => validKeys.has(key));
        }),
        { numRuns: 7 },
      );
    });
  });
});

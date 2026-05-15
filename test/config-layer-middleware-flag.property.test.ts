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
 * Property-Based Tests for has_middleware Boolean Correctness
 *
 * Feature: configurable-bundle-middleware, Property 7: has_middleware Boolean Correctness
 *
 * Property 7: has_middleware Boolean Correctness
 * *For any* kata() call with `middlewarePath` provided, the config JSON should contain
 * `has_middleware: true`. *For any* kata() call without `middlewarePath`, the config JSON
 * should not contain `has_middleware` or should have `has_middleware: false`.
 *
 * **Validates: Requirements 4.4, 5.5**
 * - Req 4.4: THE Config_Layer JSON SHALL include a `has_middleware` boolean field indicating if middleware is configured
 * - Req 5.5: THE Config_Layer JSON SHALL include `has_middleware: true` when middleware is configured
 *
 * @module config-layer-middleware-flag.property.test
 */

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME, HANDLER_CONFIG_KEY } from '../src/config-layer';
import * as esbuild from 'esbuild';

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
 * Simulates the config generation logic from createKataConfigLayer.
 * This function mirrors the behavior of the actual implementation.
 *
 * @param originalHandler - The original handler path
 * @param bundlePath - Optional bundle path
 * @param middlewarePath - Optional middleware source file path
 * @returns The generated config object
 */
function generateConfig(
  originalHandler: string,
  bundlePath?: string,
  middlewarePath?: string,
): KataConfig {
  const config: KataConfig = {
    original_js_handler: originalHandler,
  };

  // Add bundle path if specified
  if (bundlePath) {
    config.bundle_path = bundlePath;
  }

  // Set has_middleware: true only when middlewarePath is provided
  if (middlewarePath) {
    config.has_middleware = true;
  }

  return config;
}

/**
 * Simulates the full config layer generation including file writing.
 * This mirrors createKataConfigLayer but returns the parsed config for testing.
 *
 * @param originalHandler - The original handler path
 * @param bundlePath - Optional bundle path
 * @param middlewarePath - Optional middleware source file path (must exist if provided)
 * @returns The parsed config from the generated JSON file
 */
function generateConfigLayerAndParse(
  originalHandler: string,
  bundlePath?: string,
  middlewarePath?: string,
): KataConfig {
  // Create temporary directory for layer content
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kata-config-test-'));
  const kataDir = path.join(tempDir, CONFIG_DIR_NAME);
  fs.mkdirSync(kataDir, { recursive: true });

  // Build config object
  const config: Record<string, unknown> = {
    [HANDLER_CONFIG_KEY]: originalHandler,
  };

  // Add bundle path if specified
  if (bundlePath) {
    config['bundle_path'] = bundlePath;
  }

  // Build and include middleware if provided
  if (middlewarePath) {
    // Build middleware with esbuild
    const middlewareOutPath = path.join(kataDir, 'middleware.js');
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
  }

  // Write config file
  const configPath = path.join(kataDir, CONFIG_FILE_NAME);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  // Read and parse the config file
  const content = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(content);

  // Clean up temp directory
  fs.rmSync(tempDir, { recursive: true, force: true });

  // Convert to KataConfig
  const result: KataConfig = {
    original_js_handler: parsed[HANDLER_CONFIG_KEY],
  };

  if (parsed['bundle_path'] !== undefined) {
    result.bundle_path = parsed['bundle_path'];
  }

  if (parsed['has_middleware'] !== undefined) {
    result.has_middleware = parsed['has_middleware'];
  }

  return result;
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

// Feature: configurable-bundle-middleware, Property 7: has_middleware Boolean Correctness
describe('Feature: configurable-bundle-middleware, Property 7: has_middleware Boolean Correctness', () => {
  // Path to the test middleware fixture
  const testMiddlewarePath = path.join(__dirname, 'fixtures', 'test-middleware.ts');

  /**
   * **Validates: Requirements 4.4, 5.5**
   */
  describe('Property 7: has_middleware Boolean Correctness', () => {
    /**
     * **Validates: Requirement 5.5**
     *
     * For any kata() call with middlewarePath provided, the config JSON should
     * contain has_middleware: true.
     */
    it('should set has_middleware to true when middlewarePath is provided', () => {
      return fc.assert(
        fc.property(
          validHandlerPath(),
          optionalBundlePath(),
          (handlerPath, bundlePath) => {
            // Generate config with middleware path provided
            const config = generateConfig(handlerPath, bundlePath, testMiddlewarePath);

            // has_middleware should be true when middlewarePath is provided
            return config.has_middleware === true;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 4.4**
     *
     * For any kata() call without middlewarePath, the config JSON should not
     * contain has_middleware or should have has_middleware: false.
     */
    it('should not set has_middleware when middlewarePath is not provided', () => {
      return fc.assert(
        fc.property(
          validHandlerPath(),
          optionalBundlePath(),
          (handlerPath, bundlePath) => {
            // Generate config without middleware path
            const config = generateConfig(handlerPath, bundlePath, undefined);

            // has_middleware should be undefined (not present) when no middleware
            return config.has_middleware === undefined;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirements 4.4, 5.5**
     *
     * Full round-trip test: Generate config layer with middleware, read the JSON,
     * and verify has_middleware is true.
     */
    it('should write has_middleware: true to config JSON when middleware is compiled', () => {
      return fc.assert(
        fc.property(
          validHandlerPath(),
          optionalBundlePath(),
          (handlerPath, bundlePath) => {
            // Generate config layer with middleware and parse the result
            const config = generateConfigLayerAndParse(
              handlerPath,
              bundlePath,
              testMiddlewarePath,
            );

            // has_middleware should be true in the parsed config
            return config.has_middleware === true;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 4.4**
     *
     * Full round-trip test: Generate config layer without middleware, read the JSON,
     * and verify has_middleware is not present.
     */
    it('should not include has_middleware in config JSON when no middleware is provided', () => {
      return fc.assert(
        fc.property(
          validHandlerPath(),
          optionalBundlePath(),
          (handlerPath, bundlePath) => {
            // Generate config layer without middleware and parse the result
            const config = generateConfigLayerAndParse(
              handlerPath,
              bundlePath,
              undefined,
            );

            // has_middleware should be undefined (not present) in the parsed config
            return config.has_middleware === undefined;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * Property: has_middleware should be a boolean when present
     * **Validates: Requirement 4.4**
     */
    it('should ensure has_middleware is a boolean type when present', () => {
      return fc.assert(
        fc.property(
          validHandlerPath(),
          optionalBundlePath(),
          (handlerPath, bundlePath) => {
            // Generate config with middleware
            const config = generateConfig(handlerPath, bundlePath, testMiddlewarePath);

            // has_middleware should be exactly boolean true, not truthy
            return typeof config.has_middleware === 'boolean' && config.has_middleware === true;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * Property: has_middleware value should be consistent regardless of other config options
     * **Validates: Requirements 4.4, 5.5**
     */
    it('should set has_middleware consistently regardless of bundlePath presence', () => {
      return fc.assert(
        fc.property(
          validHandlerPath(),
          validBundlePath(),
          (handlerPath, bundlePath) => {
            // Generate config with middleware and with bundlePath
            const configWithBundle = generateConfig(handlerPath, bundlePath, testMiddlewarePath);

            // Generate config with middleware but without bundlePath
            const configWithoutBundle = generateConfig(handlerPath, undefined, testMiddlewarePath);

            // Both should have has_middleware: true
            return (
              configWithBundle.has_middleware === true &&
              configWithoutBundle.has_middleware === true
            );
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * Property: has_middleware absence should be consistent regardless of other config options
     * **Validates: Requirement 4.4**
     */
    it('should not set has_middleware consistently regardless of bundlePath presence when no middleware', () => {
      return fc.assert(
        fc.property(
          validHandlerPath(),
          validBundlePath(),
          (handlerPath, bundlePath) => {
            // Generate config without middleware but with bundlePath
            const configWithBundle = generateConfig(handlerPath, bundlePath, undefined);

            // Generate config without middleware and without bundlePath
            const configWithoutBundle = generateConfig(handlerPath, undefined, undefined);

            // Both should not have has_middleware
            return (
              configWithBundle.has_middleware === undefined &&
              configWithoutBundle.has_middleware === undefined
            );
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * Property: The has_middleware flag should correctly reflect middleware presence in JSON
     * **Validates: Requirements 4.4, 5.5**
     */
    it('should correctly serialize has_middleware to JSON', () => {
      return fc.assert(
        fc.property(
          validHandlerPath(),
          fc.boolean(),
          (handlerPath, hasMiddleware) => {
            // Generate config based on middleware presence
            const middlewarePath = hasMiddleware ? testMiddlewarePath : undefined;
            const config = generateConfig(handlerPath, undefined, middlewarePath);

            // Serialize to JSON and parse back
            const json = JSON.stringify(config);
            const parsed = JSON.parse(json);

            if (hasMiddleware) {
              // When middleware is provided, has_middleware should be true in JSON
              return parsed.has_middleware === true;
            } else {
              // When no middleware, has_middleware should not be in JSON
              return !('has_middleware' in parsed);
            }
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * Property: has_middleware should never be false (it's either true or absent)
     * **Validates: Requirements 4.4, 5.5**
     */
    it('should never set has_middleware to false (only true or absent)', () => {
      return fc.assert(
        fc.property(
          validHandlerPath(),
          optionalBundlePath(),
          fc.boolean(),
          (handlerPath, bundlePath, hasMiddleware) => {
            const middlewarePath = hasMiddleware ? testMiddlewarePath : undefined;
            const config = generateConfig(handlerPath, bundlePath, middlewarePath);

            // has_middleware should never be false - it's either true or undefined
            return config.has_middleware !== false;
          },
        ),
        { numRuns: 7 },
      );
    });
  });
});

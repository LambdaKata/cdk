/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * Config Layer Generator for Lambda Kata CDK Integration
 *
 * This module provides functionality to create a Lambda Layer containing
 * the kata configuration. The configuration includes the original Node.js
 * handler path, which the Lambda Kata runtime reads during initialization.
 *
 * The config layer replaces the JS_HANDLER_PATH environment variable approach,
 * providing cleaner separation between runtime configuration and environment variables.
 *
 * @module config-layer
 */

import { Construct } from 'constructs';
import { LayerVersion, Code, Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as esbuild from 'esbuild';

/**
 * Configuration for the kata config layer.
 *
 * @example
 * ```typescript
 * const props: KataConfigLayerProps = {
 *   originalHandler: 'bundle.handler'
 * };
 * ```
 *
 * @example
 * ```typescript
 * // With custom bundle path and middleware
 * const props: KataConfigLayerProps = {
 *   originalHandler: 'index.handler',
 *   bundlePath: '/var/task/index.js',
 *   middlewarePath: './middleware.ts'
 * };
 * ```
 */
export interface KataConfigLayerProps {
  /**
   * The original Node.js handler path (e.g., "bundle.handler").
   *
   * This value will be stored in the config layer and read by the
   * Lambda Kata runtime during initialization.
   *
   * Format: "<module>.<function>" or "<path/module>.<function>"
   * Examples: "bundle.handler", "src/index.handler", "dist/main.handler"
   */
  originalHandler: string;

  /**
   * Path to the JavaScript bundle.
   *
   * When specified, the Lambda Kata runtime will load the bundle from this path
   * instead of the default location. This allows using custom project layouts
   * where the bundle is located in a different directory.
   *
   * If not specified, defaults to /opt/js_runtime/bundle.js
   *
   * @example "/var/task/index.js"
   * @example "/var/task/dist/bundle.js"
   *
   * @remarks
   * Validates: Requirement 4.1
   */
  bundlePath?: string;

  /**
   * Path to the middleware TypeScript/JavaScript source file.
   *
   * When specified, the middleware file will be compiled with esbuild and
   * included in the config layer at /opt/.kata/middleware.js. The middleware
   * module must export a function with signature: (bundle, context) => handler
   *
   * The context parameter includes:
   * - originalHandler: The handler path (e.g., "index.handler")
   *
   * @example "./middleware.ts"
   * @example "./src/custom-resolver.js"
   *
   * @remarks
   * Validates: Requirement 5.1
   */
  middlewarePath?: string;

  /**
   * Inline handler resolver function.
   *
   * When specified, this function will be serialized to a temporary TypeScript file,
   * compiled with esbuild, and included in the config layer at /opt/.kata/middleware.js.
   *
   * The function receives the loaded bundle and context with originalHandler,
   * and must return the handler function.
   *
   * Note: The function must be pure (no closures over external variables)
   * because it will be serialized via .toString()
   *
   * Cannot be used together with middlewarePath.
   *
   * @example
   * ```typescript
   * handlerResolver: (bundle, ctx) => {
   *   const handlerName = ctx.originalHandler.split('.').pop();
   *   return bundle[handlerName];
   * }
   * ```
   */
  handlerResolver?: (bundle: unknown, context: { originalHandler: string }) => Function;
}

/**
 * The path where the config file will be located in the Lambda Layer.
 * When the layer is attached to a Lambda, this file will be at /opt/.kata/original_handler.json
 */
export const CONFIG_DIR_NAME = '.kata';

/**
 * The name of the config file within the .kata directory.
 */
export const CONFIG_FILE_NAME = 'original_handler.json';

/**
 * The key used in the JSON config file to store the handler path.
 */
export const HANDLER_CONFIG_KEY = 'original_js_handler';

/**
 * The name of the compiled middleware file within the .kata directory.
 */
export const MIDDLEWARE_FILE_NAME = 'middleware.js';

/**
 * Creates a Lambda Layer containing the kata configuration.
 *
 * The layer contains a single JSON file at /opt/.kata/original_handler.json
 * with the original handler path. This file is read by the Lambda Kata
 * runtime during initialization to determine which JavaScript handler to invoke.
 *
 * @param scope - The CDK construct scope
 * @param id - The unique identifier for this layer within the scope
 * @param props - Configuration properties including the original handler path
 * @returns A LayerVersion construct containing the configuration
 *
 * @example
 * ```typescript
 * import { createKataConfigLayer } from './config-layer';
 *
 * const configLayer = createKataConfigLayer(this, 'KataConfigLayer', {
 *   originalHandler: 'bundle.handler'
 * });
 *
 * myFunction.addLayers(configLayer);
 * ```
 *
 * @remarks
 * Validates: Requirements 1.1, 1.2, 1.3, 3.1, 3.2, 3.5
 */
export function createKataConfigLayer(
  scope: Construct,
  id: string,
  props: KataConfigLayerProps,
): LayerVersion {
  // Create temporary directory for layer content
  // Each call creates a unique temp directory to support different handler paths (Requirement 3.5)
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kata-config-'));
  const kataDir = path.join(tempDir, CONFIG_DIR_NAME);
  fs.mkdirSync(kataDir, {recursive: true});

  // Build config object (Requirement 1.2)
  const config: Record<string, unknown> = {
    [HANDLER_CONFIG_KEY]: props.originalHandler,
  };

  // Add bundle path if specified (Requirements 4.2, 4.3)
  // When bundlePath is not specified, we don't include it in the config (using default)
  if (props.bundlePath) {
    config['bundle_path'] = props.bundlePath;
  }

  // Build and include middleware if provided (Requirements 2.1, 2.2, 2.3, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7)
  if (props.middlewarePath && props.handlerResolver) {
    throw new Error('Cannot specify both middlewarePath and handlerResolver. Use one or the other.');
  }

  if (props.middlewarePath) {
    // Validate middleware file exists (Requirement 5.7)
    if (!fs.existsSync(props.middlewarePath)) {
      throw new Error(`Middleware file not found: ${props.middlewarePath}`);
    }

    // Build middleware with esbuild (Requirements 5.2, 5.3)
    const middlewareOutPath = path.join(kataDir, MIDDLEWARE_FILE_NAME);
    esbuild.buildSync({
      entryPoints: [props.middlewarePath],
      bundle: true,
      platform: 'node',
      target: 'node18', // @todo: complete with current Node,js Lambda env coordination
      format: 'cjs',
      outfile: middlewareOutPath,
      minify: true,
      sourcemap: false,
    });

    // Set has_middleware: true in config JSON (Requirement 5.5)
    config['has_middleware'] = true;
  }

  if (props.handlerResolver) {
    // Serialize inline function to temporary TypeScript file
    const fnString = props.handlerResolver.toString();
    const tempTsContent = `export default ${fnString};\n`;
    const tempTsPath = path.join(tempDir, 'handler-resolver.ts');
    fs.writeFileSync(tempTsPath, tempTsContent, 'utf-8');

    // Build with esbuild (same as middlewarePath)
    const middlewareOutPath = path.join(kataDir, MIDDLEWARE_FILE_NAME);
    esbuild.buildSync({
      entryPoints: [tempTsPath],
      bundle: true,
      platform: 'node',
      target: 'node18', // @todo: complete with current Node,js Lambda env coordination
      format: 'cjs',
      outfile: middlewareOutPath,
      minify: true,
      sourcemap: false,
    });

    // Set has_middleware: true in config JSON
    config['has_middleware'] = true;
  }

  // Generate the config content
  const configContent = JSON.stringify(config, null, 2);

  // Write config file with UTF-8 encoding (Requirement 1.3)
  fs.writeFileSync(
    path.join(kataDir, CONFIG_FILE_NAME),
    configContent,
    'utf-8',
  );

  // Create layer from directory (Requirement 1.1)
  // When attached to a Lambda, files will be at /opt/.kata/original_handler.json
  // Note: We don't specify compatibleRuntimes because:
  // 1. The config layer contains only a JSON file, which is runtime-agnostic
  // 2. The Lambda's runtime is changed via CfnFunction escape hatch BEFORE this layer is attached,
  //    but CDK's addLayers validation uses the construct's internal runtime property which isn't updated
  // 3. Omitting compatibleRuntimes skips the validation, which is safe for a JSON-only layer
  return new LayerVersion(scope, id, {
    code: Code.fromAsset(tempDir),
    description: `Lambda Kata config layer for handler: ${props.originalHandler}`,
  });
}

/**
 * Generates the JSON configuration content for the config layer.
 *
 * This function creates a properly formatted JSON string containing
 * the original handler path. The output is formatted with 2-space
 * indentation for readability.
 *
 * @param originalHandler - The original Node.js handler path
 * @returns The JSON configuration content as a string
 *
 * @example
 * ```typescript
 * const content = generateConfigContent('bundle.handler');
 * // Returns: '{\n  "original_js_handler": "bundle.handler"\n}'
 * ```
 *
 * @remarks
 * Validates: Requirements 1.2, 3.2
 */
export function generateConfigContent(originalHandler: string): string {
  return JSON.stringify(
    {
      [HANDLER_CONFIG_KEY]: originalHandler,
    },
    null,
    2,
  );
}

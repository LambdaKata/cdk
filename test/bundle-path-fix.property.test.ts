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
 * Property-Based Tests for bundlePath Bug Fix
 *
 * Feature: bundle-path-ignored-fix
 *
 * Property 1: Fault Condition - User-provided bundlePath is used
 * *For any* call to `kata()` where `bundlePath` is specified and is not an empty string,
 * the fixed function SHALL write the specified value to the Lambda Layer config as `bundle_path`.
 *
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.2**
 * - 1.1: WHEN user passes `bundlePath` in `kata()` options THEN the system ignores the passed value (BUG)
 * - 1.2: WHEN `bundlePath` equals `/var/task/index.mjs` THEN the Lambda Layer config contains wrong value (BUG)
 * - 2.1: WHEN user passes `bundlePath` in `kata()` options THEN the system SHALL use the passed value
 * - 2.2: WHEN `bundlePath` equals `/var/task/index.mjs` THEN the system SHALL write that exact value
 *
 * This is a BUG EXPLORATION test:
 * - EXPECTED TO FAIL on unfixed code (failure confirms bug exists)
 * - When test fails, it proves the bug exists and documents counterexamples
 * - DO NOT attempt to fix the test or code when it fails
 *
 * @module bundle-path-fix.property.test
 */

// Mock the native licensing module BEFORE any imports
jest.mock('@lambda-kata/licensing', () => ({
  NativeLicensingService: jest.fn().mockImplementation(() => ({
    checkEntitlementSync: jest.fn().mockReturnValue({
      entitled: true,
      layerVersionArn: 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1',
    }),
  })),
}));

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { App, Stack } from 'aws-cdk-lib';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { getKataPromise, kata } from '../src/kata-wrapper';
import { NativeLicensingService } from '@lambda-kata/licensing';
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME } from '../src/config-layer';

// Get typed mock for NativeLicensingService
const mockNativeLicensingService = NativeLicensingService as jest.Mock;

/**
 * Helper to configure the mock for entitled accounts
 */
function configureMockEntitled(layerArn: string): void {
  mockNativeLicensingService.mockImplementation(() => ({
    checkEntitlementSync: jest.fn().mockReturnValue({
      entitled: true,
      layerVersionArn: layerArn,
    }),
  }));
}

/**
 * Arbitrary generator for valid AWS account IDs (12-digit strings)
 */
const arbitraryAccountId = (): fc.Arbitrary<string> =>
  fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
    minLength: 12,
    maxLength: 12,
  });

/**
 * Arbitrary generator for valid AWS regions
 */
const arbitraryRegion = (): fc.Arbitrary<string> =>
  fc.constantFrom(
    'us-east-1',
    'us-east-2',
    'us-west-1',
    'us-west-2',
    'eu-west-1',
    'eu-west-2',
    'eu-central-1',
    'ap-northeast-1',
    'ap-southeast-1',
    'ap-southeast-2',
  );

/**
 * Arbitrary generator for valid Lambda Layer ARNs
 */
const arbitraryLayerArn = (): fc.Arbitrary<string> =>
  fc.tuple(arbitraryRegion(), arbitraryAccountId(), fc.integer({ min: 1, max: 999 })).map(
    ([region, accountId, version]) =>
      `arn:aws:lambda:${region}:${accountId}:layer:LambdaKata:${version}`,
  );

/**
 * Arbitrary generator for valid Lambda handler paths
 * Generates paths like: "index.handler", "src/handler.main"
 */
const arbitraryHandlerPath = (): fc.Arbitrary<string> => {
  const identifier = fc
    .tuple(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
      fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
        { minLength: 0, maxLength: 10 },
      ),
    )
    .map(([first, rest]) => first + rest);

  return fc
    .tuple(identifier, identifier)
    .map(([file, func]) => `${file}.${func}`);
};

/**
 * Arbitrary generator for non-empty bundlePath values
 * These are the paths that trigger the bug condition
 *
 * Generates paths like:
 * - /var/task/index.mjs
 * - /var/task/dist/bundle.js
 * - /opt/custom/bundle.js
 */
const arbitraryNonEmptyBundlePath = (): fc.Arbitrary<string> =>
  fc.oneof(
    // Absolute paths with /var/task prefix (common case)
    fc.tuple(
      fc.constantFrom('index', 'bundle', 'main', 'handler', 'app'),
      fc.constantFrom('.js', '.mjs', '.cjs'),
    ).map(([name, ext]) => `/var/task/${name}${ext}`),
    // Absolute paths with subdirectory
    fc.tuple(
      fc.constantFrom('dist', 'build', 'out', 'lib'),
      fc.constantFrom('index', 'bundle', 'main'),
      fc.constantFrom('.js', '.mjs'),
    ).map(([dir, name, ext]) => `/var/task/${dir}/${name}${ext}`),
    // Custom paths
    fc.tuple(
      fc.constantFrom('/opt/custom', '/opt/layer', '/var/runtime'),
      fc.constantFrom('bundle', 'handler', 'index'),
      fc.constantFrom('.js', '.mjs'),
    ).map(([prefix, name, ext]) => `${prefix}/${name}${ext}`),
  );

/**
 * Helper to create a test stack with account ID
 */
function createTestStack(accountId: string): { app: App; stack: Stack } {
  const app = new App({
    context: { 'aws:cdk:account': accountId },
  });
  const stack = new Stack(app, 'TestStack', {
    env: { account: accountId, region: 'us-east-1' },
  });
  return { app, stack };
}

/**
 * Helper to create a test Lambda function
 */
function createTestLambda(stack: Stack, id: string, handler: string): LambdaFunction {
  return new LambdaFunction(stack, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: handler,
    code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
  });
}

/**
 * Extracts the bundle_path from the config layer asset.
 *
 * The config layer is created as a Lambda Layer with a JSON file at
 * /opt/.kata/original_handler.json containing the configuration.
 *
 * This function finds the config layer asset directory and reads the JSON file.
 */
function extractBundlePathFromConfigLayer(stack: Stack): string | undefined {
  // Get the assembly output directory
  // CDK creates asset staging directories in cdk.out/asset.<hash>/
  // We can find the config layer by looking for the .kata/original_handler.json file
  const assembly = stack.node.root as App;
  const outdir = assembly.outdir;

  // Find all asset directories
  if (fs.existsSync(outdir)) {
    const entries = fs.readdirSync(outdir);
    for (const entry of entries) {
      if (entry.startsWith('asset.')) {
        const assetDir = path.join(outdir, entry);
        const configPath = path.join(assetDir, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
        if (fs.existsSync(configPath)) {
          const content = fs.readFileSync(configPath, 'utf-8');
          const config = JSON.parse(content);
          return config.bundle_path;
        }
      }
    }
  }

  return undefined;
}

/**
 * Computes the expected bundle_path from a handler string.
 *
 * This mirrors the logic of extractBundlePathFromHandler() in kata-wrapper.ts
 * to verify that the preservation behavior is correct.
 *
 * Handler format: "<module>.<function>" or "<path/module>.<function>"
 * The last dot separates the module path from the function name.
 *
 * @param handler - The Lambda handler string (e.g., "index.handler", "src/app.myHandler")
 * @returns The expected bundle path (e.g., "index.js", "src/app.js")
 */
function computeExpectedBundlePath(handler: string): string {
  if (!handler || handler.trim() === '') {
    return 'index.js';
  }

  // Handler format: "<module>.<function>" or "<path/module>.<function>"
  // The last dot separates the module path from the function name
  const lastDotIndex = handler.lastIndexOf('.');

  if (lastDotIndex === -1) {
    // No dot found - treat entire string as module name
    return `${handler}.js`;
  }

  // Extract module path (everything before the last dot)
  const modulePath = handler.substring(0, lastDotIndex);

  if (modulePath === '') {
    // Handler starts with dot (e.g., ".handler") - invalid, use default
    return 'index.js';
  }

  return `${modulePath}.js`;
}

// Feature: bundle-path-ignored-fix
describe('Feature: bundle-path-ignored-fix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Property 2: Preservation - Default bundlePath computation
   *
   * **Validates: Requirements 3.1, 3.5**
   *
   * For any call to kata() where bundlePath is NOT specified (undefined) or is an empty string,
   * the function SHALL compute bundle_path from originalHandler via extractBundlePathFromHandler(),
   * preserving existing behavior.
   *
   * PRESERVATION TEST:
   * - These tests should PASS on UNFIXED code (confirms baseline behavior)
   * - These tests should PASS on FIXED code (confirms no regressions)
   */
  describe('Property 2: Preservation - Default bundlePath computation', () => {
    /**
     * **Validates: Requirements 3.1, 3.5**
     *
     * Property test: for any handler, without bundlePath, bundle_path equals
     * extractBundlePathFromHandler(handler)
     */
    it('should compute bundle_path from originalHandler when bundlePath is not specified', () => {
      fc.assert(
        fc.asyncProperty(
          arbitraryHandlerPath(),
          arbitraryAccountId(),
          arbitraryLayerArn(),
          async (handler, accountId, layerArn) => {
            // Setup
            const { app, stack } = createTestStack(accountId);
            const lambda = createTestLambda(stack, 'TestFunction', handler);

            // Configure mock for entitled account
            configureMockEntitled(layerArn);

            // Apply transformation WITHOUT bundlePath option
            kata(lambda);
            const result = await getKataPromise(lambda);

            // Verify transformation was applied
            expect(result?.transformed).toBe(true);

            // Synthesize the stack to create asset directories
            app.synth();

            // Extract the bundle_path from the config layer
            const configBundlePath = extractBundlePathFromConfigLayer(stack);

            // Compute expected bundle_path using extractBundlePathFromHandler
            const expectedBundlePath = computeExpectedBundlePath(handler);

            // PRESERVATION ASSERTION: bundle_path should equal computed value
            expect(configBundlePath).toBe(expectedBundlePath);

            return true;
          },
        ),
        { numRuns: 20 },
      );
    });

    /**
     * **Validates: Requirements 3.1**
     *
     * When bundlePath is undefined, should use computed value from handler
     */
    it('should use computed value when bundlePath is undefined', async () => {
      const accountId = '123456789012';
      const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
      const handler = 'index.handler';

      const { app, stack } = createTestStack(accountId);
      const lambda = createTestLambda(stack, 'TestFunction', handler);

      configureMockEntitled(layerArn);

      // Call kata() with bundlePath: undefined explicitly
      kata(lambda, { bundlePath: undefined });
      const result = await getKataPromise(lambda);

      expect(result?.transformed).toBe(true);

      // Synthesize the stack
      app.synth();

      // Extract and verify
      const configBundlePath = extractBundlePathFromConfigLayer(stack);

      // With bundlePath: undefined, should use computed default: 'index.js'
      expect(configBundlePath).toBe('index.js');
    });

    /**
     * **Validates: Requirements 3.1**
     *
     * When bundlePath is empty string, should use computed value from handler
     *
     * Note: Current implementation in config-layer.ts only adds bundle_path to config
     * if props.bundlePath is truthy. Empty string is falsy, so bundle_path is not added.
     * The kata-wrapper.ts uses `config.bundlePath ?? extractBundlePathFromHandler()`
     * which treats empty string as truthy (not undefined), so it passes '' to config-layer.
     * But config-layer.ts then skips adding bundle_path because '' is falsy.
     *
     * This test documents the CURRENT behavior: empty string results in no bundle_path in config.
     */
    it('should use computed value when bundlePath is empty string', async () => {
      const accountId = '123456789012';
      const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
      const handler = 'index.handler';

      const { app, stack } = createTestStack(accountId);
      const lambda = createTestLambda(stack, 'TestFunction', handler);

      configureMockEntitled(layerArn);

      // Call kata() with bundlePath: '' (empty string)
      kata(lambda, { bundlePath: '' });
      const result = await getKataPromise(lambda);

      expect(result?.transformed).toBe(true);

      // Synthesize the stack
      app.synth();

      // Extract and verify
      const configBundlePath = extractBundlePathFromConfigLayer(stack);

      // Current behavior: bundlePath: '' is passed through ?? operator (not undefined),
      // but config-layer.ts skips adding bundle_path because '' is falsy.
      // Result: bundle_path is undefined in config.
      // This documents current behavior - the fix may change this.
      expect(configBundlePath).toBeUndefined();
    });

    /**
     * **Validates: Requirements 3.5**
     *
     * Complex handler path: src/handlers/myHandler.processEvent
     * Should compute bundle_path as 'src/handlers/myHandler.js'
     */
    it('should correctly compute bundle_path for complex handler paths', async () => {
      const accountId = '123456789012';
      const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
      const handler = 'src/handlers/myHandler.processEvent';

      const { app, stack } = createTestStack(accountId);
      const lambda = createTestLambda(stack, 'TestFunction', handler);

      configureMockEntitled(layerArn);

      // Call kata() WITHOUT bundlePath
      kata(lambda);
      const result = await getKataPromise(lambda);

      expect(result?.transformed).toBe(true);

      // Synthesize the stack
      app.synth();

      // Extract and verify
      const configBundlePath = extractBundlePathFromConfigLayer(stack);

      // For handler 'src/handlers/myHandler.processEvent', computed bundle_path should be
      // 'src/handlers/myHandler.js' (module path + .js extension)
      expect(configBundlePath).toBe('src/handlers/myHandler.js');
    });

    /**
     * **Validates: Requirements 3.5**
     *
     * Property test: for various handler formats, bundle_path is correctly computed
     */
    it('should correctly compute bundle_path for various handler formats', () => {
      // Test specific handler formats and their expected bundle_path values
      const testCases = [
        { handler: 'index.handler', expected: 'index.js' },
        { handler: 'app.main', expected: 'app.js' },
        { handler: 'src/index.handler', expected: 'src/index.js' },
        { handler: 'dist/bundle.handler', expected: 'dist/bundle.js' },
        { handler: 'src/handlers/api.processRequest', expected: 'src/handlers/api.js' },
        { handler: 'lib/utils/helper.doSomething', expected: 'lib/utils/helper.js' },
      ];

      fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...testCases),
          arbitraryAccountId(),
          arbitraryLayerArn(),
          async (testCase, accountId, layerArn) => {
            // Setup
            const { app, stack } = createTestStack(accountId);
            const lambda = createTestLambda(stack, 'TestFunction', testCase.handler);

            // Configure mock for entitled account
            configureMockEntitled(layerArn);

            // Apply transformation WITHOUT bundlePath option
            kata(lambda);
            const result = await getKataPromise(lambda);

            // Verify transformation was applied
            expect(result?.transformed).toBe(true);

            // Synthesize the stack to create asset directories
            app.synth();

            // Extract the bundle_path from the config layer
            const configBundlePath = extractBundlePathFromConfigLayer(stack);

            // PRESERVATION ASSERTION: bundle_path should equal expected computed value
            expect(configBundlePath).toBe(testCase.expected);

            return true;
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  /**
   * Property 1: Fault Condition - User-provided bundlePath is used
   *
   * **Validates: Requirements 1.1, 1.2, 2.1, 2.2**
   *
   * This test is EXPECTED TO FAIL on unfixed code.
   * Failure confirms the bug exists.
   */
  describe('Property 1: Fault Condition - User-provided bundlePath is used', () => {
    /**
     * **Validates: Requirements 2.1, 2.2**
     *
     * For any non-empty bundlePath, calling kata() should write this value
     * to Lambda Layer config as bundle_path.
     *
     * BUG EXPLORATION TEST:
     * - This test encodes the EXPECTED behavior
     * - On UNFIXED code, this test will FAIL (proving the bug exists)
     * - On FIXED code, this test will PASS (proving the fix works)
     */
    it('should write user-provided bundlePath to config layer as bundle_path', () => {
      fc.assert(
        fc.asyncProperty(
          arbitraryHandlerPath(),
          arbitraryAccountId(),
          arbitraryLayerArn(),
          arbitraryNonEmptyBundlePath(),
          async (handler, accountId, layerArn, bundlePath) => {
            // Setup
            const { app, stack } = createTestStack(accountId);
            const lambda = createTestLambda(stack, 'TestFunction', handler);

            // Configure mock for entitled account
            configureMockEntitled(layerArn);

            // Apply transformation with user-specified bundlePath
            kata(lambda, { bundlePath });
            const result = await getKataPromise(lambda);

            // Verify transformation was applied
            expect(result?.transformed).toBe(true);

            // Synthesize the stack to create asset directories
            app.synth();

            // Extract the bundle_path from the config layer
            const configBundlePath = extractBundlePathFromConfigLayer(stack);

            // CRITICAL ASSERTION: The config layer should contain the user-specified bundlePath
            // This is the bug condition - on unfixed code, this will fail because
            // the config layer contains a computed value instead of the user-specified one
            expect(configBundlePath).toBe(bundlePath);

            return true;
          },
        ),
        { numRuns: 20 },
      );
    });

    /**
     * Specific test case from bug report:
     * bundlePath: '/var/task/index.mjs' should be written as-is
     *
     * **Validates: Requirements 1.2, 2.2**
     */
    it('should write /var/task/index.mjs exactly as specified', async () => {
      const accountId = '123456789012';
      const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
      const bundlePath = '/var/task/index.mjs';

      const { app, stack } = createTestStack(accountId);
      const lambda = createTestLambda(stack, 'TestFunction', 'index.handler');

      configureMockEntitled(layerArn);

      kata(lambda, { bundlePath });
      const result = await getKataPromise(lambda);

      expect(result?.transformed).toBe(true);

      // Synthesize the stack
      app.synth();

      // Extract and verify
      const configBundlePath = extractBundlePathFromConfigLayer(stack);

      // BUG: On unfixed code, this will be "index.js" instead of "/var/task/index.mjs"
      expect(configBundlePath).toBe('/var/task/index.mjs');
    });

    /**
     * Additional specific test case:
     * bundlePath: '/opt/custom/bundle.js' should be written as-is
     */
    it('should write /opt/custom/bundle.js exactly as specified', async () => {
      const accountId = '123456789012';
      const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
      const bundlePath = '/opt/custom/bundle.js';

      const { app, stack } = createTestStack(accountId);
      const lambda = createTestLambda(stack, 'TestFunction', 'index.handler');

      configureMockEntitled(layerArn);

      kata(lambda, { bundlePath });
      const result = await getKataPromise(lambda);

      expect(result?.transformed).toBe(true);

      // Synthesize the stack
      app.synth();

      // Extract and verify
      const configBundlePath = extractBundlePathFromConfigLayer(stack);

      // BUG: On unfixed code, this will be "index.js" instead of "/opt/custom/bundle.js"
      expect(configBundlePath).toBe('/opt/custom/bundle.js');
    });

    /**
     * Production scenario test:
     * Verify the exact scenario from the bug report
     *
     * Scenario 1: Without bundlePath - should use default computed from handler
     * Scenario 2: With bundlePath: 'index.mjs' - should use exactly this value
     */
    describe('Production scenario verification', () => {
      /**
       * Scenario 1: Without bundlePath
       * When bundlePath is NOT specified, the config layer should contain
       * the default value computed from originalHandler via extractBundlePathFromHandler()
       *
       * For handler 'index.handler', the computed bundle_path should be 'index.js'
       */
      it('Scenario 1: Without bundlePath - should use default computed from handler', async () => {
        const accountId = '123456789012';
        const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';

        const { app, stack } = createTestStack(accountId);
        // Create Lambda with handler 'index.handler'
        const lambda = createTestLambda(stack, 'TestFunction', 'index.handler');

        configureMockEntitled(layerArn);

        // Call kata() WITHOUT bundlePath option
        kata(lambda);
        const result = await getKataPromise(lambda);

        expect(result?.transformed).toBe(true);

        // Synthesize the stack
        app.synth();

        // Extract and verify
        const configBundlePath = extractBundlePathFromConfigLayer(stack);

        // Without bundlePath, should use computed default: 'index.js' (from 'index.handler')
        expect(configBundlePath).toBe('index.js');
      });

      /**
       * Scenario 2: With bundlePath: 'index.mjs'
       * When bundlePath IS specified as 'index.mjs', the config layer should contain
       * exactly 'index.mjs' - NOT the computed default 'index.js'
       *
       * This is the exact production scenario from the bug report.
       */
      it('Scenario 2: With bundlePath: index.mjs - should use exactly this value', async () => {
        const accountId = '123456789012';
        const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';

        const { app, stack } = createTestStack(accountId);
        // Create Lambda with handler 'index.handler'
        const lambda = createTestLambda(stack, 'TestFunction', 'index.handler');

        configureMockEntitled(layerArn);

        // Call kata() WITH bundlePath: 'index.mjs' (production scenario)
        kata(lambda, { bundlePath: 'index.mjs' });
        const result = await getKataPromise(lambda);

        expect(result?.transformed).toBe(true);

        // Synthesize the stack
        app.synth();

        // Extract and verify
        const configBundlePath = extractBundlePathFromConfigLayer(stack);

        // With bundlePath: 'index.mjs', should use exactly 'index.mjs'
        // BUG: If bug exists, this would be 'index.js' (computed default) instead of 'index.mjs'
        expect(configBundlePath).toBe('index.mjs');
      });

      /**
       * Scenario 3: With bundlePath: '/var/task/index.mjs' (absolute path)
       * Same as Scenario 2 but with absolute path as in the original bug report
       */
      it('Scenario 3: With bundlePath: /var/task/index.mjs - should use exactly this value', async () => {
        const accountId = '123456789012';
        const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';

        const { app, stack } = createTestStack(accountId);
        const lambda = createTestLambda(stack, 'TestFunction', 'index.handler');

        configureMockEntitled(layerArn);

        // Call kata() WITH bundlePath: '/var/task/index.mjs' (from bug report)
        kata(lambda, { bundlePath: '/var/task/index.mjs' });
        const result = await getKataPromise(lambda);

        expect(result?.transformed).toBe(true);

        // Synthesize the stack
        app.synth();

        // Extract and verify
        const configBundlePath = extractBundlePathFromConfigLayer(stack);

        // With bundlePath: '/var/task/index.mjs', should use exactly '/var/task/index.mjs'
        // BUG: If bug exists, this would be 'index.js' instead of '/var/task/index.mjs'
        expect(configBundlePath).toBe('/var/task/index.mjs');
      });
    });
  });
});

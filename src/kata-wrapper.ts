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
 * Kata Wrapper for Lambda Kata CDK Integration
 *
 * This module provides the main `kata()` function that transforms Node.js Lambda
 * functions to run via the Lambda Kata runtime. The transformation includes:
 * - Changing the runtime to Python 3.12
 * - Setting the handler to the Lambda Kata handler
 * - Attaching the customer-specific Lambda Layer
 * - Preserving the original handler path in a config layer
 *
 * Licensing is validated at CDK synthesis/deploy time only—no runtime network calls.
 *
 * @module kata-wrapper
 */

import { Construct } from 'constructs';
import { Annotations, Stack, Token } from 'aws-cdk-lib';
import { CfnFunction, Function as LambdaFunction, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

import { promises as fs } from 'fs';
import * as path from 'path';

import { KataProps, LicensingResponse, TransformationConfig } from './types';
import { createLicensingService, LicensingService } from './licensing';
import { resolveAccountId } from './account-resolver';
import { resolveAccountIdSync, resolveRegionSync } from './sync-account-resolver';
import { createKataConfigLayer } from './config-layer';

// Import native licensing service for synchronous validation
import { LicensingService as NativeLicensingServiceInterface, NativeLicensingService } from '@lambda-kata/licensing';

/**
 * Default handler path for the Lambda Kata runtime.
 * This handler is provided by the Lambda Kata Layer.
 */
const LAMBDA_KATA_HANDLER = 'lambdakata.optimized_handler.lambda_handler';

/**
 * Supported Node.js runtimes that require Node.js runtime layers.
 * These runtimes will trigger automatic Node.js layer management.
 */
const NODEJS_RUNTIMES = new Set([
  'nodejs18.x',
  'nodejs20.x',
  'nodejs22.x',
  'nodejs24.x',
]);

/**
 * Warning message for unlicensed accounts.
 */
const UNLICENSED_WARNING = 'Lambda Kata not enabled: AWS account is not entitled. Subscribe via AWS Marketplace to enable.';

/**
 * Error message for unlicensed accounts when unlicensedBehavior is 'fail'.
 */
const UNLICENSED_ERROR = 'Lambda Kata licensing validation failed: AWS account is not entitled. Subscribe via AWS Marketplace to enable.';

/**
 * Options for the kata wrapper, extending KataProps with internal options.
 */
export interface KataWrapperOptions extends KataProps {
  /**
   * Optional: Custom licensing service for testing.
   * If not provided, the default HTTP licensing service will be used.
   * @internal
   */
  licensingService?: LicensingService;

  /**
   * Optional: Custom synchronous licensing service for testing.
   * Must implement checkEntitlementSync(accountId: string): LicensingResponse
   * @internal
   */
  syncLicensingService?: NativeLicensingServiceInterface;

  /**
   * Custom bundle path.
   * If not specified, uses the default /opt/js_runtime/bundle.js
   */
  bundlePath?: string;

  /**
   * Path to middleware TypeScript/JavaScript file.
   * The file will be compiled with esbuild and included in the config layer.
   * The middleware must export a function: (bundle, context) => handler
   */
  middlewarePath?: string;

  /**
   * Inline handler resolver function.
   * This TypeScript function will be serialized, compiled with esbuild,
   * and included in the config layer as middleware.js
   *
   * The function receives the loaded bundle and context with originalHandler,
   * and must return the handler function.
   *
   * Note: The function must be pure (no closures over external variables)
   * because it will be serialized via .toString()
   *
   * @example
   * ```typescript
   * kata(myFunction, {
   *   handlerResolver: (bundle, ctx) => {
   *     const handlerName = ctx.originalHandler.split('.').pop();
   *     return bundle[handlerName];
   *   }
   * });
   * ```
   */
  handlerResolver?: (bundle: unknown, context: { originalHandler: string }) => Function;

  /**
   * Skip Node.js runtime layer deployment.
   * When true, only the core transformation is applied without deploying
   * the Node.js runtime layer. Useful for faster synthesis when the layer
   * is already deployed or not needed.
   *
   * Default: false
   */
  skipNodejsLayer?: boolean;
}

/**
 * Result of the kata transformation.
 */
export interface KataResult {
  /**
   * Whether the Lambda was transformed.
   */
  transformed: boolean;

  /**
   * The licensing response from the licensing service.
   */
  licensingResponse: LicensingResponse;

  /**
   * The resolved AWS account ID.
   */
  accountId: string;
}

/**
 * Internal state for tracking transformation.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface _TransformationState {
  originalHandler: string;
  originalRuntime: string;
  transformed: boolean;
}

/**
 * Transforms a Node.js Lambda function to run via the Lambda Kata runtime.
 *
 * This function performs the following steps SYNCHRONOUSLY:
 * 1. Resolves the target AWS account ID
 * 2. Calls the licensing service to validate entitlement
 * 3. If entitled, applies transformations (runtime, handler, layer, env vars)
 * 4. If not entitled, handles according to unlicensedBehavior option
 *
 * IMPORTANT: This function is SYNCHRONOUS to work correctly with CDK synthesis.
 * All licensing checks and transformations are applied immediately before returning.
 *
 * @param lambda - The Node.js Lambda function to transform (NodejsFunction or Function)
 * @param props - Optional configuration for the transformation
 * @returns The same Lambda construct (modified if licensed)
 *
 * @example
 * ```typescript
 * import { kata } from '@lambda-kata/cdk';
 * import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
 *
 * const myFunction = new NodejsFunction(this, 'MyFunction', {
 *   entry: 'src/handler.ts',
 * });
 *
 * // Transform to use Lambda Kata runtime
 * kata(myFunction);
 *
 * // With options
 * kata(myFunction, {
 *   unlicensedBehavior: 'fail',
 * });
 * ```
 *
 * @remarks
 * Validates: Requirements 2.1, 3.2
 * - 2.1: WHEN a developer wraps a Node.js Lambda with `kata(lambda)`, THE kata_Wrapper SHALL return a modified Lambda construct
 * - 3.2: THE kata_Wrapper SHALL call the Licensing_Service to validate the account's entitlement
 */
export function kata<T extends NodejsFunction | LambdaFunction>(
  lambda: T,
  props?: KataWrapperOptions,
): T {
  // Validate input
  validateLambdaInput(lambda);

  // Get the scope for annotations and account resolution
  const scope = lambda.node.scope as Construct;

  // Perform SYNCHRONOUS transformation
  const result = performKataTransformationSync(lambda, scope, props);

  // Store the result for inspection (wrapped in resolved Promise for backward compatibility)
  (lambda as unknown as { _kataPromise?: Promise<KataResult> })._kataPromise = Promise.resolve(result);
  (lambda as unknown as { _kataResult?: KataResult })._kataResult = result;

  // Return the lambda - transformations have already been applied synchronously
  // if we can resolve the account ID synchronously, or we'll need to handle
  // the async case appropriately
  return lambda;
}

/**
 * Synchronous version of kata for use when account ID is already known.
 *
 * This is useful for testing or when the account ID can be determined
 * without async operations.
 *
 * @param lambda - The Node.js Lambda function to transform
 * @param accountId - The AWS account ID to use for licensing check
 * @param region - The AWS region for deployment (from Stack.of(lambda).region)
 * @param props - Optional configuration for the transformation
 * @returns Promise resolving to the transformation result
 *
 * @internal
 */
export async function kataWithAccountId<T extends NodejsFunction | LambdaFunction>(
  lambda: T,
  accountId: string,
  region: string,
  props?: KataWrapperOptions,
): Promise<KataResult> {
  // Validate input
  validateLambdaInput(lambda);

  // Get the licensing service
  const licensingService = props?.licensingService ?? createLicensingService(props?.licensingEndpoint);

  // Check entitlement
  const licensingResponse = await licensingService.checkEntitlement(accountId);

  // Handle the licensing response
  if (licensingResponse.entitled && licensingResponse.layerArn) {
    // Apply transformation for entitled accounts with Node.js layer support
    // Use the provided region parameter (from Stack.of(lambda).region)
    await applyTransformationWithNodeSupport(lambda, {
      originalHandler: getOriginalHandler(lambda),
      targetRuntime: Runtime.PYTHON_3_12,
      targetHandler: LAMBDA_KATA_HANDLER,
      layerArn: licensingResponse.layerArn,
      bundlePath: props?.bundlePath,
      middlewarePath: props?.middlewarePath,
      handlerResolver: props?.handlerResolver,
    }, accountId, region);

    return {
      transformed: true,
      licensingResponse,
      accountId,
    };
  } else {
    // Handle unlicensed accounts
    handleUnlicensed(lambda, props, licensingResponse);

    return {
      transformed: false,
      licensingResponse,
      accountId,
    };
  }
}

/**
 * Performs the kata transformation SYNCHRONOUSLY.
 *
 * This is the primary transformation function used by kata().
 * It uses the native C licensing module for synchronous validation.
 * The native module contains all licensing logic including endpoint,
 * security, and validation - no HTTP fallback is used.
 *
 * @param lambda - The Lambda function to transform
 * @param scope - The CDK construct scope
 * @param props - Optional configuration
 * @returns The transformation result (synchronous)
 *
 * @internal
 */
function performKataTransformationSync<T extends NodejsFunction | LambdaFunction>(
  lambda: T,
  scope: Construct,
  props?: KataWrapperOptions,
): KataResult {
  // Resolve the account ID SYNCHRONOUSLY
  let accountId: string;
  try {
    accountId = resolveAccountIdSync(scope);
  } catch (error) {
    // If we can't resolve the account ID, treat as unlicensed
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const licensingResponse: LicensingResponse = {
      entitled: false,
      message: `Unable to determine AWS account ID: ${errorMessage}`,
    };

    handleUnlicensed(lambda, props, licensingResponse);

    return {
      transformed: false,
      licensingResponse,
      accountId: 'unknown',
    };
  }

  // Resolve region SYNCHRONOUSLY
  const deploymentRegion = resolveRegionSync(scope);

  // Check entitlement SYNCHRONOUSLY using native C-module
  let licensingResponse: LicensingResponse;

  if (props?.syncLicensingService?.checkEntitlementSync) {
    // Use provided sync licensing service (for testing)
    licensingResponse = props.syncLicensingService.checkEntitlementSync(accountId);
  } else {
    // Use native licensing module - this is the ONLY production path
    // The native C-module contains all licensing logic (endpoint, security, validation)
    try {
      const nativeService = new NativeLicensingService();
      licensingResponse = nativeService.checkEntitlementSync(accountId);
    } catch (nativeError) {
      // Native module not available - fail closed (no HTTP fallback)
      const errorMessage = nativeError instanceof Error ? nativeError.message : 'Unknown error';
      console.error(`[Lambda Kata] Native licensing module error: ${errorMessage}`);

      licensingResponse = {
        entitled: false,
        message: `Native licensing module unavailable: ${errorMessage}. Please ensure the native module is built.`,
      };
    }
  }

  // Handle the licensing response
  if (licensingResponse.entitled && licensingResponse.layerArn) {
    // Apply transformation for entitled accounts
    // Note: Node.js layer deployment is skipped in sync mode (can be done separately)
    applyTransformation(lambda, {
      originalHandler: getOriginalHandler(lambda),
      targetRuntime: Runtime.PYTHON_3_12,
      targetHandler: LAMBDA_KATA_HANDLER,
      layerArn: licensingResponse.layerArn,
      bundlePath: props?.bundlePath,
      middlewarePath: props?.middlewarePath,
      handlerResolver: props?.handlerResolver,
    });

    // Log success
    console.log(`[Lambda Kata] Transformed Lambda to use Lambda Kata runtime (account: ${accountId}, region: ${deploymentRegion})`);

    return {
      transformed: true,
      licensingResponse,
      accountId,
    };
  } else {
    // Handle unlicensed accounts
    handleUnlicensed(lambda, props, licensingResponse);

    return {
      transformed: false,
      licensingResponse,
      accountId,
    };
  }
}

/**
 * Performs the kata transformation asynchronously.
 *
 * @param lambda - The Lambda function to transform
 * @param scope - The CDK construct scope
 * @param props - Optional configuration
 * @returns Promise resolving to the transformation result
 *
 * @deprecated async mode is deprecated and will be removed in a future release.
 *
 * @internal
 */
async function __performKataTransformation<T extends NodejsFunction | LambdaFunction>(
  lambda: T,
  scope: Construct,
  props?: KataWrapperOptions,
): Promise<KataResult> {
  // Resolve the account ID
  let accountId: string;
  try {
    accountId = await resolveAccountId(scope);
  } catch (error) {
    // If we can't resolve the account ID, treat as unlicensed
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const licensingResponse: LicensingResponse = {
      entitled: false,
      message: `Unable to determine AWS account ID: ${errorMessage}`,
    };

    handleUnlicensed(lambda, props, licensingResponse);

    return {
      transformed: false,
      licensingResponse,
      accountId: 'unknown',
    };
  }

  // Perform the transformation with the resolved account ID
  // CRITICAL: Extract deployment region from Stack, handling CDK tokens
  const { Stack, Token } = await import('aws-cdk-lib');
  const stack = Stack.of(lambda);

  // Stack.region may be a CDK Token (unresolved) during synthesis
  // We need a concrete region value for AWS SDK operations
  let deploymentRegion: string;

  if (Token.isUnresolved(stack.region)) {
    // Region is a token - try to get explicit region from context or env
    const contextRegion = stack.node.tryGetContext('aws:cdk:region') as string | undefined;

    if (contextRegion && typeof contextRegion === 'string') {
      deploymentRegion = contextRegion;
    } else {
      // Cannot determine region - this will cause layer deployment to use AWS default region
      // Log warning and use a placeholder that will fail explicitly
      Annotations.of(lambda).addWarning(
        'Cannot determine deployment region for Node.js layer. ' +
        'Stack region is unresolved (CDK token). ' +
        'Please specify region explicitly in Stack env: ' +
        'new Stack(app, "MyStack", { env: { region: "us-east-1" } })'
      );
      // Use stack.region anyway - it will be resolved during CloudFormation deployment
      // but AWS SDK calls during synthesis will use default credentials region
      deploymentRegion = stack.region;
    }
  } else {
    // Region is resolved - use it directly
    deploymentRegion = stack.region;
  }

  return kataWithAccountId(lambda, accountId, deploymentRegion, props);
}

/**
 * Validates that the input is a valid Lambda function.
 *
 * @param lambda - The input to validate
 * @throws Error if the input is not a valid Lambda function
 *
 * @internal
 */
function validateLambdaInput(lambda: unknown): asserts lambda is NodejsFunction | LambdaFunction {
  if (!lambda) {
    throw new Error('kata() requires a valid Lambda Function construct. Received: undefined or null');
  }

  // Check if it's a CDK construct with the expected properties
  if (typeof lambda !== 'object') {
    throw new Error('kata() requires a valid Lambda Function construct. Received: non-object');
  }

  const fn = lambda as Record<string, unknown>;

  // Check for Lambda function characteristics
  if (!fn.node || typeof fn.node !== 'object') {
    throw new Error('kata() requires a valid Lambda Function construct. Received: object without CDK node');
  }

  // Check for function-specific properties
  if (typeof fn.addEnvironment !== 'function') {
    throw new Error('kata() requires a valid Lambda Function construct. Received: construct without addEnvironment method');
  }
}

/**
 * Gets the original handler path from a Lambda function.
 *
 * @param lambda - The Lambda function
 * @returns The original handler path
 *
 * @internal
 */
function getOriginalHandler(lambda: NodejsFunction | LambdaFunction): string {
  // Access the underlying CloudFormation resource to get the handler
  const cfnFunction = lambda.node.defaultChild as CfnFunction;
  return cfnFunction.handler ?? 'index.handler';
}

/**
 * Gets the original runtime from a Lambda function before transformation.
 *
 * @param lambda - The Lambda function
 * @returns The original runtime name (e.g., "nodejs20.x")
 *
 * @internal
 */
export function getOriginalRuntime(lambda: NodejsFunction | LambdaFunction): string {
  // Access the underlying CloudFormation resource to get the runtime
  const cfnFunction = lambda.node.defaultChild as CfnFunction;
  return cfnFunction.runtime ?? 'nodejs18.x';
}

/**
 * Detects if a Lambda function uses a Node.js runtime.
 *
 * @param lambda - The Lambda function to check
 * @returns true if the function uses a supported Node.js runtime
 *
 * @internal
 */
export function isNodejsRuntime(lambda: NodejsFunction | LambdaFunction): boolean {
  const runtime = getOriginalRuntime(lambda);
  console.log('runtime: ', runtime, JSON.stringify(runtime));
  return NODEJS_RUNTIMES.has(runtime);
}

/**
 * Gets the architecture of a Lambda function.
 *
 * @param lambda - The Lambda function
 * @returns The architecture ("x86_64" or "arm64")
 *
 * @internal
 */
export function getLambdaArchitecture(lambda: NodejsFunction | LambdaFunction): 'x86_64' | 'arm64' {
  // Access the underlying CloudFormation resource to get the architecture
  const cfnFunction = lambda.node.defaultChild as CfnFunction;
  const architectures = cfnFunction.architectures;

  // Default to x86_64 if not specified (AWS Lambda default)
  if (!architectures || architectures.length === 0) {
    return 'x86_64';
  }

  // Return the first architecture, converting AWS format to our format
  const arch = architectures[0];
  return arch === 'arm64' ? 'arm64' : 'x86_64';
}

/**
 * Applies the Lambda Kata transformation to a Lambda function.
 *
 * This function modifies the Lambda construct in-place to:
 * 1. Create and attach a config layer with the original handler path
 * 2. Change the runtime to Python 3.12
 * 3. Set the handler to the Lambda Kata handler
 * 4. Attach the customer-specific Lambda Layer
 * 5. Add additional environment variables for the Lambda Kata runtime
 *
 * @param lambda - The Lambda function to transform
 * @param config - The transformation configuration
 *
 * @remarks
 * Validates: Requirements 2.2, 2.3, 2.4, 3.3, 3.4, 4.1, 4.2, 5.4
 * - 2.2: THE kata_Wrapper SHALL change the Lambda runtime from Node.js to Python 3.12
 * - 2.3: THE kata_Wrapper SHALL set the Lambda handler to `lambdakata.optimized_handler.lambda_handler`
 * - 2.4: THE kata_Wrapper SHALL attach the customer-specific Lambda_Layer ARN to the Lambda
 * - 3.3: THE kata_Wrapper SHALL attach the Config_Layer to the transformed Lambda
 * - 3.4: THE kata_Wrapper SHALL NOT set the `JS_HANDLER_PATH` environment variable
 * - 4.1: THE kata_Wrapper SHALL NOT add the `JS_HANDLER_PATH` environment variable to transformed Lambdas
 * - 4.2: WHEN `bundlePath` is specified, THE kata_Wrapper SHALL write it to the Config_Layer JSON as `bundle_path`
 * - 5.4: THE compiled middleware SHALL be included in the Config_Layer at `/opt/.kata/middleware.js`
 *
 * @internal
 */
export function applyTransformation(
  lambda: NodejsFunction | LambdaFunction,
  config: TransformationConfig,
): void {
  // 1. Use CDK escape hatch to modify runtime and handler FIRST
  // Runtime and handler are immutable after construction, so we need to
  // access the underlying CloudFormation resource
  // This must happen BEFORE attaching Python-compatible layers
  const cfnFunction = lambda.node.defaultChild as CfnFunction;

  // 2. Change runtime to Python 3.12 (Requirement 2.2)
  cfnFunction.runtime = config.targetRuntime.name;

  // 3. Set handler to Lambda Kata handler (Requirement 2.3)
  cfnFunction.handler = config.targetHandler;

  // 4. Create and attach config layer with original handler path (Requirements 3.3, 3.4, 4.1, 4.2, 5.4)
  // This replaces the JS_HANDLER_PATH environment variable approach
  // Also includes bundlePath and middlewarePath when provided
  const configLayer = createKataConfigLayer(lambda, 'KataConfigLayer', {
    originalHandler: config.originalHandler,
    bundlePath: config.bundlePath,
    middlewarePath: config.middlewarePath,
    handlerResolver: config.handlerResolver,
  });
  lambda.addLayers(configLayer);

  // 5. Attach the Lambda Kata Layer (Requirement 2.4)
  const layer = LayerVersion.fromLayerVersionArn(
    lambda,
    'LambdaKataLayer',
    config.layerArn,
  );
  lambda.addLayers(layer);

  // Note: No environment variables are added by kata()
  // - JS_HANDLER_PATH: Stored in config layer
  // - JS_BUNDLE_PATH: Stored in config layer (bundle_path)
  // - USE_CTYPES_BRIDGE: Removed - ctypes bridge is always used
}

/**
 * Checks if Node.js layer ZIP files exist for the specified architecture.
 *
 * This function implements the same search logic as AWSLayerManager.findLayerZipFile()
 * but performs only synchronous file existence checks without attempting deployment.
 * Used to determine if Node.js layer deployment should be attempted.
 *
 * @param architecture - Target architecture ('arm64' or 'x86_64')
 * @param baseDirectory - Directory to search for ZIP files
 * @returns Promise resolving to true if ZIP files exist, false otherwise
 *
 * @internal
 */
async function hasNodejsLayerZipFiles(architecture: 'arm64' | 'x86_64', baseDirectory: string): Promise<boolean> {
  // Define search patterns based on architecture (matching AWSLayerManager logic)
  const candidates = architecture === 'arm64'
    ? [
      'nodejs-layer-arm64-minimal.zip',
      'nodejs-layer-arm64.zip',
    ]
    : [
      'nodejs-layer-x86_64-minimal.zip',
      'nodejs-layer-x86_64.zip',
      'nodejs-layer-x86-minimal.zip',
      'nodejs-layer-x86.zip',
    ];

  // Check if any candidate files exist
  for (const candidate of candidates) {
    const filePath = path.join(baseDirectory, candidate);
    try {
      const stats = await fs.stat(filePath);
      if (stats.isFile()) {
        return true;
      }
    } catch (error) {
      // File doesn't exist, continue checking other candidates
      continue;
    }
  }

  return false;
}

/**
 * Applies the Lambda Kata transformation with Node.js runtime layer support.
 *
 * This is an enhanced version of applyTransformation that includes automatic
 * Node.js runtime layer management for Node.js Lambda functions using the
 * new deployment functionality that bypasses Docker binary extraction.
 *
 * This method deploys pre-built Node.js layer ZIP files directly to AWS Lambda,
 * avoiding the 80MB binary size issue that occurs with Docker extraction.
 *
 * @param lambda - The Lambda function to transform
 * @param config - The transformation configuration
 * @param accountId - The AWS account ID for Node.js layer management
 * @param region - The AWS region for Node.js layer management
 *
 * @internal
 */
async function applyTransformationWithNodeSupport(
  lambda: NodejsFunction | LambdaFunction,
  config: TransformationConfig,
  accountId: string,
  region: string,
): Promise<void> {
  // Store original runtime before transformation for Node.js layer detection
  const originalRuntime = getOriginalRuntime(lambda);
  const isNodejs = NODEJS_RUNTIMES.has(originalRuntime);

  // For Node.js functions: Try to attach Node.js runtime layer
  // Strategy: Try pre-built ZIP deployment first, fallback to Docker extraction if needed
  if (isNodejs) {
    const architecture = getLambdaArchitecture(lambda);

    try {
      // STRATEGY 1: Try to deploy from pre-built ZIP files (fast, avoids Docker issues)
      const { AWSLayerManager } = await import('./aws-layer-manager');

      const layerManager = new AWSLayerManager({
        enableS3Support: true,
        awsSdkConfig: { region },
        logger: {
          debug: () => { },
          info: () => { },
          warn: () => { },
          error: () => { },
        },
      });

      try {
        const deployResult = await layerManager.deployNodejsLayer({
          region,
          architecture,
          baseDirectory: process.cwd(),
        });

        const nodeLayer = LayerVersion.fromLayerVersionArn(
          lambda,
          'NodeRuntimeLayer',
          deployResult.layerVersionArn,
        );
        lambda.addLayers(nodeLayer);

        console.log(
          `[Lambda Kata] Node.js layer attached: ${deployResult.layerVersionArn} ` +
          `(${(deployResult.layerSize / (1024 * 1024)).toFixed(2)}MB)`
        );

        return; // Success - exit early

      } finally {
        layerManager.destroy();
      }

    } catch (zipError) {
      // ZIP deployment failed - try fallback to Docker extraction
      const zipErrorMsg = zipError instanceof Error ? zipError.message : String(zipError);

      // Only try Docker fallback if ZIP files were not found
      if (zipErrorMsg.includes('No layer ZIP found')) {
        console.log('[Lambda Kata] Pre-built ZIP not found, trying Docker extraction...');

        try {
          // STRATEGY 2: Fallback to Docker extraction (original method)
          const { ensureNodeRuntimeLayer } = await import('./ensure-node-runtime-layer');

          const layerResult = await ensureNodeRuntimeLayer({
            runtimeName: originalRuntime,
            architecture,
            region,
            accountId,
            logger: {
              debug: () => { },
              info: () => { },
              warn: () => { },
              error: () => { },
            },
          });

          const nodeLayer = LayerVersion.fromLayerVersionArn(
            lambda,
            'NodeRuntimeLayer',
            layerResult.layerArn,
          );
          lambda.addLayers(nodeLayer);

          console.log(`[Lambda Kata] Node.js layer created from Docker: ${layerResult.layerArn}`);
          return; // Success

        } catch (dockerError) {
          // Both strategies failed - log comprehensive error
          const dockerErrorMsg = dockerError instanceof Error ? dockerError.message : String(dockerError);

          Annotations.of(lambda).addWarning(
            `Failed to attach Node.js runtime layer. Tried:\n` +
            `1. Pre-built ZIP deployment: ${zipErrorMsg}\n` +
            `2. Docker extraction: ${dockerErrorMsg}\n\n` +
            `The Lambda will be transformed to Lambda Kata runtime, but Node.js binaries may not be available.\n\n` +
            `To fix: Either provide pre-built layer ZIP files (nodejs-layer-${architecture}.zip) ` +
            `or ensure Docker is available for binary extraction.`
          );
        }
      } else {
        // ZIP deployment failed for other reasons (not missing files)
        Annotations.of(lambda).addWarning(
          `Failed to deploy Node.js layer from ZIP: ${zipErrorMsg}. ` +
          `The Lambda will be transformed but Node.js binaries may not be available.`
        );
      }
    }
  }

  // Apply the standard kata transformation
  applyTransformation(lambda, config);
}

/**
 * Handles the case when an account is not licensed.
 *
 * Depending on the unlicensedBehavior option:
 * - 'warn' (default): Emit a warning and keep the original Lambda unchanged
 * - 'fail': Throw an error to fail CDK synthesis
 *
 * @param lambda - The Lambda function
 * @param props - The kata wrapper options
 * @param licensingResponse - The licensing response
 *
 * @remarks
 * Validates: Requirements 3.5, 3.6, 6.1, 6.2, 6.3, 6.4
 * - 3.5: IF the account is NOT entitled, THEN THE kata_Wrapper SHALL NOT apply any transformations
 * - 3.6: IF the account is NOT entitled, THEN THE kata_Wrapper SHALL emit a clear warning message
 * - 6.1: IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL keep the original Node.js runtime unchanged
 * - 6.2: IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL keep the original handler unchanged
 * - 6.3: IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL NOT attach any Lambda_Layer
 * - 6.4: IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL emit a warning message
 *
 * @internal
 */
export function handleUnlicensed(
  lambda: NodejsFunction | LambdaFunction,
  props: KataWrapperOptions | undefined,
  licensingResponse: LicensingResponse,
): void {
  const behavior = props?.unlicensedBehavior ?? 'warn';

  if (behavior === 'fail') {
    // Throw error to fail synthesis
    throw new Error(licensingResponse.message ?? UNLICENSED_ERROR);
  }

  // Default behavior: emit warning and keep original Lambda unchanged
  // The Lambda is not modified - runtime, handler, and layers remain as-is
  const warningMessage = licensingResponse.message ?? UNLICENSED_WARNING;
  Annotations.of(lambda).addWarning(warningMessage);
}

/**
 * Checks if a Lambda function has been transformed by kata().
 *
 * @param lambda - The Lambda function to check
 * @returns true if the Lambda has been transformed
 *
 * @example
 * ```typescript
 * const myFunction = new NodejsFunction(this, 'MyFunction', { ... });
 * kata(myFunction);
 *
 * if (isKataTransformed(myFunction)) {
 *   console.log('Function is using Lambda Kata runtime');
 * }
 * ```
 */
export function isKataTransformed(lambda: NodejsFunction | LambdaFunction): boolean {
  const cfnFunction = lambda.node.defaultChild as CfnFunction;
  return cfnFunction.handler === LAMBDA_KATA_HANDLER;
}

/**
 * Gets the kata transformation promise for a Lambda function.
 *
 * This is useful for testing or when you need to await the transformation result.
 *
 * @param lambda - The Lambda function
 * @returns The transformation promise, or undefined if kata() was not called
 *
 * @example
 * ```typescript
 * const myFunction = new NodejsFunction(this, 'MyFunction', { ... });
 * kata(myFunction);
 *
 * const result = await getKataPromise(myFunction);
 * if (result?.transformed) {
 *   console.log(`Transformed with layer: ${result.licensingResponse.layerArn}`);
 * }
 * ```
 */
export function getKataPromise(lambda: NodejsFunction | LambdaFunction): Promise<KataResult> | undefined {
  return (lambda as unknown as { _kataPromise?: Promise<KataResult> })._kataPromise;
}

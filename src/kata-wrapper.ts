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
import { Annotations } from 'aws-cdk-lib';
import { Function as LambdaFunction, Runtime, CfnFunction, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

import { KataProps, LicensingResponse, TransformationConfig } from './types';
import { LicensingService, createLicensingService } from './licensing';
import { resolveAccountId } from './account-resolver';
import { createKataConfigLayer } from './config-layer';

/**
 * Default handler path for the Lambda Kata runtime.
 * This handler is provided by the Lambda Kata Layer.
 */
const LAMBDA_KATA_HANDLER = 'lambdakata.optimized_handler.lambda_handler';

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
 * This function performs the following steps:
 * 1. Resolves the target AWS account ID
 * 2. Calls the licensing service to validate entitlement
 * 3. If entitled, applies transformations (runtime, handler, layer, env vars)
 * 4. If not entitled, handles according to unlicensedBehavior option
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

  // Create a promise to handle the async licensing check
  // CDK synthesis is synchronous, so we need to handle this carefully
  const kataPromise = performKataTransformation(lambda, scope, props);

  // Store the promise on the construct for later resolution
  // This allows tests and integration code to await the result
  (lambda as unknown as { _kataPromise?: Promise<KataResult> })._kataPromise = kataPromise;

  // Return the lambda immediately - transformations will be applied synchronously
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
 * @param props - Optional configuration for the transformation
 * @returns Promise resolving to the transformation result
 *
 * @internal
 */
export async function kataWithAccountId<T extends NodejsFunction | LambdaFunction>(
  lambda: T,
  accountId: string,
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
    // Apply transformation for entitled accounts
    applyTransformation(lambda, {
      originalHandler: getOriginalHandler(lambda),
      targetRuntime: Runtime.PYTHON_3_12,
      targetHandler: LAMBDA_KATA_HANDLER,
      layerArn: licensingResponse.layerArn,
      bundlePath: props?.bundlePath,
      middlewarePath: props?.middlewarePath,
      handlerResolver: props?.handlerResolver,
    });

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
 * @internal
 */
async function performKataTransformation<T extends NodejsFunction | LambdaFunction>(
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
  return kataWithAccountId(lambda, accountId, props);
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

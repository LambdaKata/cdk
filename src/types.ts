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
 * Type definitions for @lambdakata/cdk
 *
 * These interfaces define the core data structures used by the kata() wrapper
 * for transforming Node.js Lambda functions to use the Lambda Kata runtime.
 */

import { Runtime } from 'aws-cdk-lib/aws-lambda';

/**
 * Configuration options for the kata() wrapper function.
 *
 * @example
 * ```typescript
 * kata(myFunction, {
 *   unlicensedBehavior: 'fail',
 *   licensingEndpoint: 'https://custom-endpoint.example.com'
 * });
 * ```
 */
export interface KataProps {
  /**
   * Optional: Override the licensing service endpoint
   * Default: Lambda Kata production licensing endpoint
   */
  licensingEndpoint?: string;

  /**
   * Optional: Behavior when account is not licensed
   * 'warn' - Keep original Lambda, emit warning (default)
   * 'fail' - Throw error and fail synthesis
   */
  unlicensedBehavior?: 'warn' | 'fail';
}

/**
 * Response from the Lambda Kata licensing service.
 *
 * This interface represents the response returned when checking
 * an AWS account's entitlement to use Lambda Kata.
 */
export interface LicensingResponse {
  /**
   * Whether the AWS account is entitled to use Lambda Kata
   */
  entitled: boolean;

  /**
   * Base Lambda Layer ARN (without version number).
   * Only present if the account is entitled.
   * @deprecated Use layerVersionArn for attaching to Lambda functions
   */
  layerArn?: string;

  /**
   * Full Lambda Layer Version ARN (with version number).
   * This is the ARN that should be used when attaching layers to Lambda functions.
   * Only present if the account is entitled.
   *
   * Format: lambda-kata-node{version}-{arch}-{regionCode}
   * @example "arn:aws:lambda:eu-central-1:113258654684:layer:lambda-kata-node20-x86_64-euc:1"
   */
  layerVersionArn?: string;

  /**
   * Human-readable status message
   */
  message?: string;

  /**
   * Entitlement expiration date in ISO 8601 format.
   * Only present if the account is entitled.
   */
  expiresAt?: string;

  /**
   * Node.js version used for the layer.
   * Echoed back from the request or defaults to "20".
   * @example "20", "22", "24"
   */
  nodeVersion?: string;

  /**
   * Architecture used for the layer.
   * Echoed back from the request or defaults to "x86_64".
   * @example "x86_64", "arm64"
   */
  architecture?: string;
}

/**
 * Configuration for transforming a Lambda function to use Lambda Kata.
 *
 * This interface defines the transformation parameters applied to
 * an entitled Lambda function.
 */
export interface TransformationConfig {
  /**
   * The original Node.js handler path (e.g., "index.handler")
   * This will be stored in the config layer.
   */
  originalHandler: string;

  /**
   * The original Node.js runtime (e.g., "nodejs20.x").
   * Used to create the appropriate Node.js runtime layer.
   */
  originalRuntime?: string;

  /**
   * The target runtime for the transformed Lambda.
   * Always Runtime.PYTHON_3_12 for Lambda Kata.
   */
  targetRuntime: Runtime;

  /**
   * The handler path for the Lambda Kata runtime.
   * Always "handler.lambda_handler"
   */
  targetHandler: string;

  /**
   * Customer-specific Lambda Layer ARN containing the Lambda Kata runtime.
   * Retrieved from the licensing service.
   */
  layerArn: string;

  /**
   * Custom bundle path.
   * If not specified, uses the default /opt/js_runtime/bundle.js
   *
   * @remarks
   * Validates: Requirement 4.2
   */
  bundlePath?: string;

  /**
   * Path to middleware TypeScript/JavaScript file.
   * The file will be compiled with esbuild and included in the config layer.
   * The middleware must export a function: (bundle, context) => handler
   *
   * @remarks
   * Validates: Requirement 5.4
   */
  middlewarePath?: string;

  /**
   * Inline handler resolver function.
   * This TypeScript function will be serialized, compiled with esbuild,
   * and included in the config layer as middleware.js
   *
   * @remarks
   * Validates: Requirement for inline handler resolution
   */
  handlerResolver?: (bundle: unknown, context: { originalHandler: string }) => Function;
}

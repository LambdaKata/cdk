/*
 * MIT
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the MIT; see the LICENSE file
 * or https://choosealicense.com/licenses/mit/ for details.
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * Type definitions for @lambda-kata/cdk
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
     * Customer-specific Lambda Layer ARN containing the Lambda Kata runtime.
     * Only present if the account is entitled.
     */
    layerArn?: string;

    /**
     * Human-readable status message
     */
    message?: string;

    /**
     * Entitlement expiration date in ISO 8601 format.
     * Only present if the account is entitled.
     */
    expiresAt?: string;
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
     * The target runtime for the transformed Lambda.
     * Always Runtime.PYTHON_3_12 for Lambda Kata.
     */
    targetRuntime: Runtime;

    /**
     * The handler path for the Lambda Kata runtime.
     * Always "lambdakata.optimized_handler.lambda_handler"
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

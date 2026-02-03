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
 * Main API function for Node.js runtime layer management
 *
 * This module provides the primary entry point for ensuring Node.js runtime layers
 * exist in AWS Lambda. It coordinates between runtime detection and layer management
 * components to provide a seamless experience for CDK integration.
 *
 * @module ensure-node-runtime-layer
 */

import {
  EnsureNodeRuntimeLayerOptions,
  EnsureNodeRuntimeLayerResult,
  ErrorCodes,
  LayerRequirements,
  NodeRuntimeLayerError,
} from './nodejs-layer-manager';
import { DockerRuntimeDetector } from './docker-runtime-detector';
import { AWSLayerManager } from './aws-layer-manager';
import { createDefaultLogger, OperationTimer } from './logger';

/**
 * Supported AWS Lambda Node.js runtimes.
 * These are the runtime identifiers that AWS Lambda supports.
 */
const SUPPORTED_RUNTIMES = new Set([
  'nodejs18.x',
  'nodejs20.x',
  'nodejs22.x',
]);

/**
 * Supported Lambda function architectures.
 * These correspond to AWS Lambda's supported architectures.
 */
const SUPPORTED_ARCHITECTURES = new Set<'x86_64' | 'arm64'>([
  'x86_64',
  'arm64',
]);

/**
 * Ensures a Node.js runtime layer exists for the specified configuration.
 *
 * This is the main API function that coordinates runtime detection and layer management
 * to ensure the correct Node.js binaries are available for Lambda Kata execution.
 *
 * The function performs the following operations:
 * 1. Validates all input parameters
 * 2. Detects the exact Node.js version for the runtime
 * 3. Searches for existing compatible layers
 * 4. Creates a new layer if none exists or is compatible
 * 5. Returns comprehensive result information
 *
 * @param options - Configuration options for layer management
 * @returns Promise resolving to layer information and metadata
 * @throws NodeRuntimeLayerError for validation failures or operational errors
 *
 * @example
 * ```typescript
 * const result = await ensureNodeRuntimeLayer({
 *   runtimeName: 'nodejs20.x',
 *   architecture: 'x86_64',
 *   region: 'us-east-1',
 *   accountId: '123456789012'
 * });
 *
 * console.log(`Layer ARN: ${result.layerArn}`);
 * console.log(`Node.js version: ${result.nodeVersion}`);
 * console.log(`Created new layer: ${result.created}`);
 * ```
 */
export async function ensureNodeRuntimeLayer(
  options: EnsureNodeRuntimeLayerOptions,
): Promise<EnsureNodeRuntimeLayerResult> {
  let timer: OperationTimer | undefined;

  try {
    // Step 1: Validate all input parameters first
    validateInputParameters(options);

    // Use provided logger or create default (after validation)
    const logger = options.logger ?? createDefaultLogger();

    timer = new OperationTimer(logger, 'Node.js runtime layer management', {
      runtimeName: options.runtimeName,
      architecture: options.architecture,
      region: options.region,
      accountId: options.accountId,
    });

    // Step 2: Initialize components
    const runtimeDetector = new DockerRuntimeDetector({ logger });
    const layerManager = new AWSLayerManager({
      awsSdkConfig: options.awsSdkConfig,
      logger,
    });

    // Step 3: Detect exact Node.js version
    logger.debug('Detecting Node.js version', {
      runtimeName: options.runtimeName,
      architecture: options.architecture,
    });

    const versionInfo = await runtimeDetector.detectNodeVersion(
      options.runtimeName,
      options.architecture,
    );

    logger.info('Node.js version detected', {
      runtimeName: versionInfo.runtimeName,
      nodeVersion: versionInfo.version,
      dockerImage: versionInfo.dockerImage,
    });

    // Step 4: Generate layer name following naming convention
    const layerName = generateLayerName(options.runtimeName, options.architecture);

    // Step 5: Search for existing compatible layer
    logger.debug('Searching for existing compatible layer', { layerName });

    const requirements: LayerRequirements = {
      nodeVersion: versionInfo.version,
      architecture: options.architecture,
    };

    const existingLayer = await layerManager.findExistingLayer({
      layerName,
      requirements,
    });

    let layerInfo;
    let created = false;

    if (existingLayer) {
      // Step 6a: Use existing compatible layer
      logger.info('Found existing compatible layer', {
        layerArn: existingLayer.arn,
        layerName: existingLayer.name,
        version: existingLayer.version,
        nodeVersion: existingLayer.nodeVersion,
      });

      layerInfo = existingLayer;
    } else {
      // Step 6b: Create new layer
      logger.info('No compatible layer found, creating new layer', {
        layerName,
        nodeVersion: versionInfo.version,
        architecture: options.architecture,
      });

      layerInfo = await layerManager.createNodeLayer({
        layerName,
        nodeVersion: versionInfo.version,
        architecture: options.architecture,
        region: options.region,
        description: `Node.js ${versionInfo.version} runtime binary for Lambda Kata (${options.architecture})`,
      });

      created = true;

      logger.info('Successfully created new layer', {
        layerArn: layerInfo.arn,
        layerName: layerInfo.name,
        version: layerInfo.version,
      });
    }

    // Step 7: Construct and return result
    const result: EnsureNodeRuntimeLayerResult = {
      layerArn: layerInfo.arn,
      layerName: layerInfo.name,
      runtimeName: options.runtimeName,
      nodeVersion: versionInfo.version,
      architecture: options.architecture,
      created,
    };

    try {
      timer.complete({
        layerArn: result.layerArn,
        created: result.created,
        nodeVersion: result.nodeVersion,
      });
    } catch (timerError) {
      // Timer error shouldn't prevent successful completion
      const logger = options.logger ?? createDefaultLogger();
      logger.warn('Failed to log completion', { error: timerError instanceof Error ? timerError.message : String(timerError) });
    }

    return result;

  } catch (error) {
    // Try to log failure if timer exists
    try {
      if (timer) {
        timer.fail(error, {
          runtimeName: options?.runtimeName,
          architecture: options?.architecture,
          region: options?.region,
        });
      } else {
        // Handle validation errors that occur before timer creation
        const safeLogger = createDefaultLogger();
        safeLogger.error('Node.js runtime layer management failed during validation', {
          runtimeName: options?.runtimeName,
          architecture: options?.architecture,
          region: options?.region,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (timerError) {
      // Timer error shouldn't mask the original error
    }

    // Re-throw NodeRuntimeLayerError as-is, wrap others
    if (error instanceof NodeRuntimeLayerError) {
      throw error;
    }

    throw new NodeRuntimeLayerError(
      `Failed to ensure Node.js runtime layer: ${error instanceof Error ? error.message : String(error)}`,
      ErrorCodes.INTERNAL_ERROR,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/**
 * Validates all input parameters for the ensureNodeRuntimeLayer function.
 *
 * Performs comprehensive validation of required and optional parameters,
 * throwing descriptive errors for any validation failures.
 *
 * @param options - The options to validate
 * @throws NodeRuntimeLayerError for any validation failure
 */
function validateInputParameters(options: EnsureNodeRuntimeLayerOptions): void {
  // Validate required parameters exist
  if (!options) {
    throw new NodeRuntimeLayerError(
      'Options parameter is required',
      ErrorCodes.INTERNAL_ERROR,
    );
  }

  // Validate runtimeName
  if (!options.runtimeName || typeof options.runtimeName !== 'string') {
    throw new NodeRuntimeLayerError(
      'runtimeName is required and must be a non-empty string',
      ErrorCodes.RUNTIME_UNSUPPORTED,
    );
  }

  if (!SUPPORTED_RUNTIMES.has(options.runtimeName)) {
    throw new NodeRuntimeLayerError(
      `Unsupported runtime: ${options.runtimeName}. Supported runtimes: ${Array.from(SUPPORTED_RUNTIMES).join(', ')}`,
      ErrorCodes.RUNTIME_UNSUPPORTED,
    );
  }

  // Validate architecture
  if (!options.architecture || typeof options.architecture !== 'string') {
    throw new NodeRuntimeLayerError(
      'architecture is required and must be a non-empty string',
      ErrorCodes.INVALID_ARCHITECTURE,
    );
  }

  if (!SUPPORTED_ARCHITECTURES.has(options.architecture)) {
    throw new NodeRuntimeLayerError(
      `Unsupported architecture: ${options.architecture}. Supported architectures: ${Array.from(SUPPORTED_ARCHITECTURES).join(', ')}`,
      ErrorCodes.INVALID_ARCHITECTURE,
    );
  }

  // Validate region
  if (!options.region || typeof options.region !== 'string') {
    throw new NodeRuntimeLayerError(
      'region is required and must be a non-empty string',
      ErrorCodes.INTERNAL_ERROR,
    );
  }

  // Basic AWS region format validation (not exhaustive, but catches obvious errors)
  if (!/^[a-z0-9-]+$/.test(options.region)) {
    throw new NodeRuntimeLayerError(
      `Invalid region format: ${options.region}. Region must contain only lowercase letters, numbers, and hyphens`,
      ErrorCodes.INTERNAL_ERROR,
    );
  }

  // Validate accountId
  if (!options.accountId || typeof options.accountId !== 'string') {
    throw new NodeRuntimeLayerError(
      'accountId is required and must be a non-empty string',
      ErrorCodes.INTERNAL_ERROR,
    );
  }

  // AWS account ID must be exactly 12 digits
  if (!/^\d{12}$/.test(options.accountId)) {
    throw new NodeRuntimeLayerError(
      `Invalid AWS account ID format: ${options.accountId}. Account ID must be exactly 12 digits`,
      ErrorCodes.INTERNAL_ERROR,
    );
  }

  // Optional parameters validation (if provided)
  if (options.awsSdkConfig !== undefined && typeof options.awsSdkConfig !== 'object') {
    throw new NodeRuntimeLayerError(
      'awsSdkConfig must be an object if provided',
      ErrorCodes.INTERNAL_ERROR,
    );
  }

  if (options.logger !== undefined && typeof options.logger !== 'object') {
    throw new NodeRuntimeLayerError(
      'logger must be an object implementing the Logger interface if provided',
      ErrorCodes.INTERNAL_ERROR,
    );
  }

  // Validate logger interface if provided
  if (options.logger) {
    const requiredMethods = ['debug', 'info', 'warn', 'error'];
    for (const method of requiredMethods) {
      if (typeof (options.logger as any)[method] !== 'function') {
        throw new NodeRuntimeLayerError(
          `logger must implement ${method}() method`,
          ErrorCodes.INTERNAL_ERROR,
        );
      }
    }
  }
}

/**
 * Generates a standardized layer name following the naming convention.
 *
 * Layer names follow the pattern: lambda-kata-nodejs-${runtimeName}-${architecture}
 * This ensures uniqueness across different runtime and architecture combinations.
 *
 * AWS Lambda layer names must match pattern: [a-zA-Z0-9-_]+
 * This function sanitizes the runtime name by replacing dots with dashes.
 *
 * @param runtimeName - The AWS Lambda runtime name (e.g., "nodejs18.x")
 * @param architecture - The target architecture
 * @returns Standardized layer name (e.g., "lambda-kata-nodejs-nodejs18-x-x86_64")
 */
function generateLayerName(runtimeName: string, architecture: string): string {
  // Replace dots with dashes to comply with AWS layer name pattern
  const sanitizedRuntime = runtimeName.replace(/\./g, '-');
  return `lambda-kata-nodejs-${sanitizedRuntime}-${architecture}`;
}

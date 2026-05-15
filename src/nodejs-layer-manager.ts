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
 * Node.js Runtime-Aware Lambda Layer Management
 *
 * This module provides TypeScript-only orchestration for detecting Node.js Lambda
 * runtime versions and managing corresponding Node.js Lambda Layers. The system
 * automatically ensures the correct Node.js binaries are available at execution time
 * by creating or reusing Lambda Layers that contain Node.js runtime binaries matching
 * the exact versions used in AWS Lambda runtime images.
 *
 * Key features:
 * - Detects exact Node.js versions from AWS Lambda Docker images
 * - Creates minimal Lambda Layers with only Node.js binaries
 * - Supports both x86_64 and arm64 architectures
 * - Implements idempotent operations with layer reuse
 * - Provides comprehensive error handling and logging
 *
 * @module nodejs-layer-manager
 */

import { LambdaClientConfig } from '@aws-sdk/client-lambda';

/**
 * Configuration options for ensuring a Node.js runtime layer exists.
 *
 * @example
 * ```typescript
 * const options: EnsureNodeRuntimeLayerOptions = {
 *   runtimeName: 'nodejs20.x',
 *   architecture: 'x86_64',
 *   region: 'us-east-1',
 *   accountId: '123456789012'
 * };
 * ```
 */
export interface EnsureNodeRuntimeLayerOptions {
    /**
     * The AWS Lambda runtime name (e.g., "nodejs18.x", "nodejs20.x", "nodejs22.x").
     * This determines which Node.js major version to use.
     */
    runtimeName: string;

    /**
     * The target architecture for the Lambda function and layer.
     * Must be either "x86_64" or "arm64".
     */
    architecture: 'x86_64' | 'arm64';

    /**
     * The AWS region where the layer should be created or found.
     */
    region: string;

    /**
     * The AWS account ID where the layer should be created or found.
     */
    accountId: string;

    /**
     * Optional AWS SDK configuration for custom authentication, region, or endpoint settings.
     * If not provided, the default AWS SDK configuration will be used.
     */
    awsSdkConfig?: LambdaClientConfig;

    /**
     * Optional logger for debugging and monitoring layer operations.
     * If not provided, a no-op logger will be used.
     */
    logger?: Logger;
}

/**
 * Result of ensuring a Node.js runtime layer exists.
 *
 * Contains all information about the layer that was created or found,
 * including metadata for debugging and monitoring.
 */
export interface EnsureNodeRuntimeLayerResult {
    /**
     * The ARN of the Lambda Layer that contains the Node.js runtime.
     * This ARN can be attached to Lambda functions.
     */
    layerArn: string;

    /**
     * The name of the Lambda Layer.
     * Follows the pattern: lambda-kata-nodejs-${runtimeName}-${architecture}
     */
    layerName: string;

    /**
     * The original runtime name that was requested.
     */
    runtimeName: string;

    /**
     * The exact Node.js version detected from the AWS Lambda runtime image.
     * Format: semantic version string (e.g., "20.10.0")
     */
    nodeVersion: string;

    /**
     * The architecture of the layer and Node.js binary.
     */
    architecture: 'x86_64' | 'arm64';

    /**
     * Whether a new layer was created (true) or an existing layer was reused (false).
     * Useful for monitoring and debugging layer management operations.
     */
    created: boolean;
}

/**
 * Information about a detected Node.js version from AWS Lambda runtime images.
 *
 * This interface represents the result of querying AWS Lambda Docker images
 * to determine the exact Node.js version used by a specific runtime.
 */
export interface NodeVersionInfo {
    /**
     * The exact Node.js version string (e.g., "20.10.0").
     * Extracted from `node --version` within the AWS Lambda runtime Docker image.
     */
    version: string;

    /**
     * The original runtime name that was queried.
     */
    runtimeName: string;

    /**
     * The Docker image that was used to detect the version.
     * Format: public.ecr.aws/lambda/nodejs:{majorVersion}-{architecture}
     */
    dockerImage: string;
}

/**
 * Information about a Lambda Layer containing Node.js runtime.
 *
 * This interface represents metadata about existing or newly created
 * Node.js Lambda Layers for compatibility checking and management.
 */
export interface LayerInfo {
    /**
     * The full ARN of the Lambda Layer version.
     */
    arn: string;

    /**
     * The name of the Lambda Layer.
     */
    name: string;

    /**
     * The version number of the Lambda Layer.
     */
    version: number;

    /**
     * The Node.js version contained in this layer.
     */
    nodeVersion: string;

    /**
     * The architecture this layer is compatible with.
     */
    architecture: string;

    /**
     * When this layer version was created.
     */
    createdDate: Date;
}

/**
 * Options for searching existing Lambda Layers.
 *
 * Used internally by LayerManager to find compatible existing layers.
 */
export interface LayerSearchOptions {
    /**
     * The expected layer name to search for.
     */
    layerName: string;

    /**
     * Requirements that the layer must meet to be considered compatible.
     */
    requirements: LayerRequirements;
}

/**
 * Requirements that a Lambda Layer must meet to be considered compatible.
 *
 * Used for validating whether an existing layer can be reused.
 */
export interface LayerRequirements {
    /**
     * The required Node.js version.
     */
    nodeVersion: string;

    /**
     * The required architecture.
     */
    architecture: string;

    /**
     * Maximum age for the layer to be considered fresh.
     * Layers older than this may be recreated.
     */
    maxAge?: number;
}

/**
 * Options for creating a new Lambda Layer.
 *
 * Contains all information needed to build and publish a Node.js layer.
 */
export interface LayerCreationOptions {
    /**
     * The name for the new layer.
     */
    layerName: string;

    /**
     * The Node.js version to include in the layer.
     */
    nodeVersion: string;

    /**
     * The target architecture.
     */
    architecture: 'x86_64' | 'arm64';

    /**
     * The AWS region where the layer should be created.
     */
    region: string;

    /**
     * Optional description for the layer.
     */
    description?: string;
}

/**
 * Logger interface for debugging and monitoring layer operations.
 *
 * Provides structured logging with different severity levels and optional metadata.
 */
export interface Logger {
    /**
     * Log debug information for detailed troubleshooting.
     */
    debug(message: string, meta?: Record<string, unknown>): void;

    /**
     * Log informational messages about normal operations.
     */
    info(message: string, meta?: Record<string, unknown>): void;

    /**
     * Log warning messages about potential issues.
     */
    warn(message: string, meta?: Record<string, unknown>): void;

    /**
     * Log error messages about failures and exceptions.
     */
    error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Interface for detecting Node.js versions from AWS Lambda runtime images.
 *
 * Implementations should use Docker to pull AWS Lambda runtime images
 * and extract the exact Node.js version using `node --version`.
 */
export interface RuntimeDetector {
    /**
     * Detects the exact Node.js version for a given runtime and architecture.
     *
     * @param runtimeName - The AWS Lambda runtime (e.g., "nodejs20.x")
     * @param architecture - The target architecture ("x86_64" or "arm64")
     * @returns Promise resolving to Node.js version information
     * @throws NodeRuntimeLayerError if detection fails
     */
    detectNodeVersion(runtimeName: string, architecture: string): Promise<NodeVersionInfo>;
}

/**
 * Interface for managing Lambda Layers containing Node.js runtime.
 *
 * Implementations should handle layer creation, searching, and compatibility validation
 * using AWS SDK v3 Lambda client operations.
 */
export interface LayerManager {
    /**
     * Searches for an existing compatible Node.js layer.
     *
     * @param options - Search criteria and requirements
     * @returns Promise resolving to layer info if found, null otherwise
     * @throws NodeRuntimeLayerError if search fails
     */
    findExistingLayer(options: LayerSearchOptions): Promise<LayerInfo | null>;

    /**
     * Creates a new Node.js Lambda Layer.
     *
     * @param options - Layer creation configuration
     * @returns Promise resolving to information about the created layer
     * @throws NodeRuntimeLayerError if creation fails
     */
    createNodeLayer(options: LayerCreationOptions): Promise<LayerInfo>;

    /**
     * Deploys a pre-built Node.js Lambda Layer from ZIP file.
     *
     * This method bypasses Docker binary extraction and deploys existing
     * layer ZIP files directly to AWS Lambda. Handles large layers via S3.
     *
     * @param options - Deployment configuration
     * @returns Promise resolving to deployment result
     * @throws NodeRuntimeLayerError if deployment fails
     */
    deployNodejsLayer(options: NodejsLayerDeploymentOptions): Promise<NodejsLayerDeploymentResult>;

    /**
     * Deploys Node.js layers for all supported architectures.
     *
     * Attempts to deploy layers for both arm64 and x86_64 architectures,
     * continuing on individual failures to maximize successful deployments.
     *
     * @param options - Base deployment configuration (architecture will be overridden)
     * @returns Promise resolving to multi-architecture deployment results
     */
    deployAllArchitectures(options: Omit<NodejsLayerDeploymentOptions, 'architecture'>): Promise<MultiArchitectureDeploymentResult>;

    /**
     * Validates whether a layer meets the specified requirements.
     *
     * @param layer - The layer to validate
     * @param requirements - The requirements to check against
     * @returns true if the layer is compatible, false otherwise
     */
    validateLayerCompatibility(layer: LayerInfo, requirements: LayerRequirements): boolean;

    /**
     * Gets the current circuit breaker state for monitoring and debugging.
     *
     * @returns Object containing circuit breaker state information
     */
    getCircuitBreakerState(): { state: string; failureCount: number; successCount: number };

    /**
     * Destroys the layer manager and cleans up resources.
     *
     * Should be called when the manager is no longer needed to prevent
     * resource leaks.
     */
    destroy(): void;
}

/**
 * Error codes for Node.js runtime layer management operations.
 *
 * These codes provide structured error classification for different failure scenarios.
 */
export enum ErrorCodes {
    /**
     * Docker is not available or cannot be executed.
     */
    DOCKER_UNAVAILABLE = 'DOCKER_UNAVAILABLE',

    /**
     * The specified runtime is not supported.
     */
    RUNTIME_UNSUPPORTED = 'RUNTIME_UNSUPPORTED',

    /**
     * AWS API operation failed.
     */
    AWS_API_ERROR = 'AWS_API_ERROR',

    /**
     * Layer creation operation failed.
     */
    LAYER_CREATION_FAILED = 'LAYER_CREATION_FAILED',

    /**
     * The specified architecture is not supported.
     */
    INVALID_ARCHITECTURE = 'INVALID_ARCHITECTURE',

    /**
     * Node.js version detection failed.
     */
    VERSION_DETECTION_FAILED = 'VERSION_DETECTION_FAILED',

    /**
     * Layer size exceeds AWS limits.
     */
    LAYER_SIZE_EXCEEDED = 'LAYER_SIZE_EXCEEDED',

    /**
     * AWS account quota exceeded.
     */
    QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',

    /**
     * Internal error or unexpected failure.
     */
    INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * Specialized error class for Node.js runtime layer management operations.
 *
 * Provides structured error information with error codes, descriptive messages,
 * and optional cause chaining for debugging.
 */
export class NodeRuntimeLayerError extends Error {
    /**
     * Creates a new NodeRuntimeLayerError.
     *
     * @param message - Human-readable error message
     * @param code - Structured error code for programmatic handling
     * @param cause - Optional underlying error that caused this error
     */
    constructor(
        message: string,
        public readonly code: ErrorCodes,
        public readonly cause?: Error,
    ) {
        super(message);
        this.name = 'NodeRuntimeLayerError';

        // Maintain proper stack trace for V8
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, NodeRuntimeLayerError);
        }
    }
}

/**
 * Cache entry for storing detected Node.js version information.
 *
 * Used internally to avoid repeated Docker operations for the same runtime.
 */
export interface VersionCacheEntry {
    /**
     * The detected Node.js version.
     */
    version: string;

    /**
     * The runtime name that was queried.
     */
    runtimeName: string;

    /**
     * The Docker image that was used.
     */
    dockerImage: string;

    /**
     * When this entry was cached.
     */
    cachedAt: Date;

    /**
     * Time-to-live in milliseconds.
     */
    ttl: number;
}

/**
 * Metadata for Lambda Layer creation and management.
 *
 * Contains information needed for AWS Lambda Layer operations.
 */
export interface LayerMetadata {
    /**
     * The name of the Lambda Layer.
     */
    layerName: string;

    /**
     * Human-readable description of the layer.
     */
    description: string;

    /**
     * Compatible Lambda runtimes.
     * For Lambda Kata, this is typically ["python3.12"].
     */
    compatibleRuntimes: string[];

    /**
     * Compatible architectures.
     */
    compatibleArchitectures: string[];

    /**
     * Optional license information.
     */
    licenseInfo?: string;
}

/**
 * Configuration options for deploying pre-built Node.js Lambda Layers.
 *
 * Used to deploy existing layer ZIP files instead of creating layers from Docker images.
 * This bypasses the binary extraction process that can fail with large Node.js binaries.
 */
export interface NodejsLayerDeploymentOptions {
    /**
     * The AWS region where the layer should be deployed.
     */
    region: string;

    /**
     * Optional AWS profile name for authentication.
     * If not provided, uses default AWS credentials.
     */
    profile?: string;

    /**
     * The target architecture for deployment.
     * If not specified, defaults to 'arm64'.
     */
    architecture?: 'arm64' | 'x86_64';

    /**
     * Base directory to search for layer ZIP files.
     * Defaults to current working directory.
     */
    baseDirectory?: string;

    /**
     * Custom layer name override.
     * If not provided, uses standard naming: nodejs-18-{architecture}
     */
    layerName?: string;

    /**
     * Custom layer description.
     * If not provided, generates standard description.
     */
    description?: string;
}

/**
 * Result of Node.js layer deployment operation.
 *
 * Contains information about the deployed layer and deployment metadata.
 */
export interface NodejsLayerDeploymentResult {
    /**
     * The full ARN of the deployed layer version.
     */
    layerVersionArn: string;

    /**
     * The base ARN of the layer (without version).
     */
    layerArn: string;

    /**
     * The name of the deployed layer.
     */
    layerName: string;

    /**
     * The version number of the deployed layer.
     */
    version: number;

    /**
     * The architecture of the deployed layer.
     */
    architecture: 'arm64' | 'x86_64';

    /**
     * The size of the deployed layer ZIP file in bytes.
     */
    layerSize: number;

    /**
     * The path to the ZIP file that was deployed.
     */
    zipFilePath: string;

    /**
     * Whether the layer was uploaded via S3 (true) or direct upload (false).
     */
    uploadedViaS3: boolean;
}

/**
 * Result of deploying layers for all architectures.
 *
 * Contains deployment results for each architecture attempted.
 */
export interface MultiArchitectureDeploymentResult {
    /**
     * Deployment results by architecture.
     * Key is architecture name, value is result or null if deployment failed.
     */
    results: Record<'arm64' | 'x86_64', NodejsLayerDeploymentResult | null>;

    /**
     * Overall success status.
     * True if at least one architecture deployed successfully.
     */
    success: boolean;

    /**
     * Summary of successful deployments.
     */
    successful: Array<{
        architecture: 'arm64' | 'x86_64';
        layerVersionArn: string;
    }>;

    /**
     * Summary of failed deployments.
     */
    failed: Array<{
        architecture: 'arm64' | 'x86_64';
        error: string;
    }>;
}

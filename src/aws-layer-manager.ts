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
 * AWS Lambda Layer Manager with SDK v3 Integration
 *
 * This module provides AWS Lambda Layer management functionality using AWS SDK v3.
 * It handles layer creation, searching, and compatibility validation for Node.js
 * runtime layers used by Lambda Kata.
 *
 * Key features:
 * - AWS SDK v3 Lambda client integration with configurable options
 * - Automatic pagination handling for layer listing operations
 * - Layer compatibility validation based on Node.js version and architecture
 * - Comprehensive error handling with retry logic
 * - Idempotent operations to prevent duplicate layer creation
 *
 * @module aws-layer-manager
 */

import {
  GetLayerVersionCommand,
  LambdaClient,
  LambdaClientConfig,
  LayersListItem,
  ListLayerVersionsCommand,
  paginateListLayers,
  PublishLayerVersionCommand,
} from '@aws-sdk/client-lambda';
import {
  BucketLocationConstraint,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';

import {
  ErrorCodes,
  LayerCreationOptions,
  LayerInfo,
  LayerManager,
  LayerRequirements,
  LayerSearchOptions,
  Logger,
  MultiArchitectureDeploymentResult,
  NodejsLayerDeploymentOptions,
  NodejsLayerDeploymentResult,
  NodeRuntimeLayerError,
} from './nodejs-layer-manager';
import { createDefaultLogger, OperationTimer } from './logger';

/**
 * Resource tracker for comprehensive cleanup during layer creation.
 * Tracks all resources created during the layer creation process to ensure
 * proper cleanup on both success and failure scenarios.
 */
class LayerCreationResourceTracker {
  private tempDirectories: Set<string> = new Set();
  private zipFiles: Set<string> = new Set();
  private dockerContainers: Set<string> = new Set();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Adds a temporary directory to track for cleanup.
   * @param path - Path to the temporary directory
   */
  addTempDirectory(path: string): void {
    this.tempDirectories.add(path);
    this.logger.debug('Tracking temp directory for cleanup', { path });
  }

  /**
   * Adds a ZIP file to track for cleanup.
   * @param path - Path to the ZIP file
   */
  addZipFile(path: string): void {
    this.zipFiles.add(path);
    this.logger.debug('Tracking ZIP file for cleanup', { path });
  }

  /**
   * Adds a Docker container to track for cleanup.
   * @param containerName - Name of the Docker container
   */
  addDockerContainer(containerName: string): void {
    this.dockerContainers.add(containerName);
    this.logger.debug('Tracking Docker container for cleanup', { containerName });
  }

  /**
   * Gets all tracked resources for cleanup operations.
   * @returns Object containing all tracked resources
   */
  getAllResources(): {
    tempDirectories: string[];
    zipFiles: string[];
    dockerContainers: string[];
  } {
    return {
      tempDirectories: Array.from(this.tempDirectories),
      zipFiles: Array.from(this.zipFiles),
      dockerContainers: Array.from(this.dockerContainers),
    };
  }

  /**
   * Clears all tracked resources (called after successful cleanup).
   */
  clear(): void {
    const resourceCount = this.tempDirectories.size + this.zipFiles.size + this.dockerContainers.size;
    this.tempDirectories.clear();
    this.zipFiles.clear();
    this.dockerContainers.clear();
    this.logger.debug('Cleared resource tracker', { resourceCount });
  }
}

/**
 * Configuration options for AWSLayerManager.
 */
export interface AWSLayerManagerOptions {
  /**
   * AWS SDK configuration for Lambda client.
   * If not provided, uses default AWS SDK configuration.
   */
  awsSdkConfig?: LambdaClientConfig;

  /**
   * AWS SDK configuration for S3 client.
   * If not provided, uses the same configuration as Lambda client.
   */
  s3SdkConfig?: S3ClientConfig;

  /**
   * Logger for debugging and monitoring.
   * If not provided, uses createDefaultLogger().
   */
  logger?: Logger;

  /**
   * Maximum age in milliseconds for layers to be considered fresh.
   * Layers older than this may be recreated.
   * Default: 7 days (604800000ms)
   */
  maxLayerAge?: number;

  /**
   * Maximum number of retries for AWS API operations.
   * Default: 3
   */
  maxRetries?: number;

  /**
   * Base delay in milliseconds for exponential backoff.
   * Default: 1000ms (1 second)
   */
  retryBaseDelay?: number;

  /**
   * Circuit breaker failure threshold.
   * Number of consecutive failures before opening the circuit.
   * Default: 5
   */
  circuitBreakerFailureThreshold?: number;

  /**
   * Circuit breaker timeout in milliseconds.
   * How long to wait before transitioning from OPEN to HALF_OPEN.
   * Default: 60000ms (1 minute)
   */
  circuitBreakerTimeout?: number;

  /**
   * Circuit breaker success threshold for HALF_OPEN state.
   * Number of consecutive successes needed to close the circuit.
   * Default: 2
   */
  circuitBreakerSuccessThreshold?: number;

  /**
   * Enable S3 support for large layer uploads.
   * If true, creates S3Client for handling layers >50MB.
   * Default: true
   */
  enableS3Support?: boolean;
}

/**
 * Circuit breaker states for AWS API operations.
 */
enum CircuitBreakerState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Failing fast, not allowing requests
  HALF_OPEN = 'HALF_OPEN' // Testing if service has recovered
}

/**
 * Circuit breaker implementation for AWS API operations.
 * Prevents cascading failures by failing fast when AWS services are unavailable.
 */
class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly failureThreshold: number,
    private readonly timeout: number,
    private readonly successThreshold: number,
    private readonly logger: Logger,
  ) {
  }

  /**
   * Executes an operation with circuit breaker protection.
   *
   * @param operation - The operation to execute
   * @returns Promise resolving to operation result
   * @throws Error if circuit is open or operation fails
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (Date.now() - this.lastFailureTime < this.timeout) {
        throw new Error('Circuit breaker is OPEN - failing fast to prevent cascading failures');
      } else {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.successCount = 0;
        this.logger.info('Circuit breaker transitioning to HALF_OPEN', {
          previousState: 'OPEN',
          timeout: this.timeout,
        });
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handles successful operation execution.
   */
  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = CircuitBreakerState.CLOSED;
        this.logger.info('Circuit breaker CLOSED after successful recovery', {
          successCount: this.successCount,
          successThreshold: this.successThreshold,
        });
      }
    }
  }

  /**
   * Handles failed operation execution.
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.OPEN;
      this.logger.warn('Circuit breaker OPEN after failure in HALF_OPEN state', {
        failureCount: this.failureCount,
      });
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitBreakerState.OPEN;
      this.logger.warn('Circuit breaker OPEN after exceeding failure threshold', {
        failureCount: this.failureCount,
        failureThreshold: this.failureThreshold,
      });
    }
  }

  /**
   * Gets current circuit breaker state for monitoring.
   */
  getState(): { state: CircuitBreakerState; failureCount: number; successCount: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
    };
  }
}

/**
 * Information about an in-progress layer creation operation.
 * Used for concurrent operation coordination.
 */
interface LayerCreationOperation {
  /** Promise that resolves when the layer creation completes */
  promise: Promise<LayerInfo>;
  /** Timestamp when the operation started */
  startTime: number;
  /** Layer creation options for this operation */
  options: LayerCreationOptions;
  /** Number of concurrent callers waiting for this operation */
  waiters: number;
}

/**
 * AWS Lambda Layer Manager implementation using AWS SDK v3.
 *
 * Provides comprehensive layer management functionality including:
 * - Layer searching with pagination support
 * - Layer compatibility validation
 * - Layer creation with proper metadata
 * - Error handling with exponential backoff retry logic
 * - Circuit breaker pattern for AWS API resilience
 * - Concurrent operation coordination to prevent duplicate layer creation
 *
 * @example
 * ```typescript
 * const manager = new AWSLayerManager({
 *   awsSdkConfig: { region: 'us-east-1' },
 *   logger: new ConsoleLogger()
 * });
 *
 * const layer = await manager.findExistingLayer({
 *   layerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
 *   requirements: {
 *     nodeVersion: '20.10.0',
 *     architecture: 'x86_64'
 *   }
 * });
 * ```
 */
export class AWSLayerManager implements LayerManager {
  private readonly lambdaClient: LambdaClient;
  private readonly s3Client: S3Client | null;
  private readonly logger: Logger;
  private readonly maxLayerAge: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelay: number;
  private readonly circuitBreaker: CircuitBreaker;

  /**
   * Map of layer names to in-progress creation operations.
   * Used to coordinate concurrent calls and prevent duplicate layer creation.
   */
  private readonly layerCreationLocks = new Map<string, LayerCreationOperation>();

  /**
   * AWS Lambda Layer size limits (in bytes).
   * These are AWS service limits that cannot be exceeded.
   */
  private static readonly MAX_LAYER_SIZE_UNZIPPED = 250 * 1024 * 1024; // 250MB
  private static readonly MAX_LAYER_SIZE_ZIPPED = 250 * 1024 * 1024;    // 50MB

  /**
   * Docker operation timeout in milliseconds.
   */
  private static readonly DOCKER_TIMEOUT = 300000; // 5 minutes

  constructor(options: AWSLayerManagerOptions = {}) {
    this.lambdaClient = new LambdaClient(options.awsSdkConfig ?? {});

    // Initialize S3 client if S3 support is enabled (default: true)
    const enableS3 = options.enableS3Support !== false;
    this.s3Client = enableS3 ? new S3Client(options.s3SdkConfig ?? {}) : null;

    this.logger = options.logger ?? createDefaultLogger();
    this.maxLayerAge = options.maxLayerAge ?? 604800000; // 7 days default
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelay = options.retryBaseDelay ?? 1000; // 1 second default

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker(
      options.circuitBreakerFailureThreshold ?? 5,
      options.circuitBreakerTimeout ?? 60000, // 1 minute
      options.circuitBreakerSuccessThreshold ?? 2,
      this.logger,
    );

    this.logger.debug('AWSLayerManager initialized', {
      region: options.awsSdkConfig?.region,
      maxLayerAge: this.maxLayerAge,
      maxRetries: this.maxRetries,
      retryBaseDelay: this.retryBaseDelay,
      s3SupportEnabled: enableS3,
      circuitBreakerFailureThreshold: options.circuitBreakerFailureThreshold ?? 5,
      circuitBreakerTimeout: options.circuitBreakerTimeout ?? 60000,
      circuitBreakerSuccessThreshold: options.circuitBreakerSuccessThreshold ?? 2,
    });
  }

  /**
   * Searches for an existing compatible Node.js layer.
   *
   * Uses AWS SDK v3 pagination to efficiently search through all layers
   * in the account and region. Validates compatibility based on layer
   * metadata and requirements.
   *
   * @param options - Search criteria and requirements
   * @returns Promise resolving to layer info if found, null otherwise
   * @throws NodeRuntimeLayerError if search fails
   */
  async findExistingLayer(options: LayerSearchOptions): Promise<LayerInfo | null> {
    const timer = new OperationTimer(this.logger, 'layer search', {
      layerName: options.layerName,
      requirements: options.requirements,
    });

    try {
      // First, try to find layers by name using pagination
      const layers = await this.listLayersByName(options.layerName);

      if (layers.length === 0) {
        this.logger.debug('No layers found with matching name', {
          layerName: options.layerName,
        });
        timer.complete({ result: 'no_layers_found' });
        return null;
      }

      // Check each layer for compatibility
      for (const layer of layers) {
        try {
          const layerInfo = await this.getLayerInfo(layer.LayerName!, layer.LatestMatchingVersion!.Version!);

          if (this.validateLayerCompatibility(layerInfo, options.requirements)) {
            this.logger.info('Found compatible existing layer', {
              layerArn: layerInfo.arn,
              layerName: layerInfo.name,
              version: layerInfo.version,
              nodeVersion: layerInfo.nodeVersion,
              architecture: layerInfo.architecture,
            });
            timer.complete({
              result: 'compatible_layer_found',
              layerArn: layerInfo.arn,
              layerVersion: layerInfo.version,
            });
            return layerInfo;
          }
        } catch (error) {
          this.logger.warn('Failed to get layer info, skipping layer', {
            layerName: layer.LayerName,
            version: layer.LatestMatchingVersion?.Version,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }

      this.logger.debug('No compatible layers found', {
        layerName: options.layerName,
        layersChecked: layers.length,
      });

      timer.complete({
        result: 'no_compatible_layers',
        layersChecked: layers.length,
      });
      return null;
    } catch (error) {
      timer.fail(error, { layerName: options.layerName });
      throw new NodeRuntimeLayerError(
        `Failed to search for existing layer: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCodes.AWS_API_ERROR,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Creates a new Node.js Lambda Layer with concurrent operation coordination.
   *
   * This method extracts the Node.js binary from the corresponding AWS Lambda
   * Docker image, packages it in the proper Lambda Layer directory structure,
   * and publishes it to AWS Lambda with appropriate metadata.
   *
   * Enhanced with concurrent operation coordination to prevent duplicate layer
   * creation when multiple calls are made with identical parameters. If a layer
   * creation is already in progress for the same layer name, subsequent calls
   * will wait for the existing operation to complete rather than starting a
   * duplicate operation.
   *
   * Process:
   * 1. Check for existing in-progress layer creation operation
   * 2. If operation exists, wait for its completion
   * 3. If no operation exists, start new layer creation with lock
   * 4. Create temporary directory for layer contents
   * 5. Extract Node.js binary from Docker container
   * 6. Create proper Lambda Layer directory structure (/opt/nodejs/bin/)
   * 7. Create ZIP archive with correct permissions
   * 8. Validate size limits
   * 9. Publish to AWS Lambda
   * 10. Clean up temporary files and release lock
   *
   * Enhanced with comprehensive resource cleanup on failure to prevent orphaned resources.
   *
   * @param options - Layer creation configuration
   * @returns Promise resolving to information about the created layer
   * @throws NodeRuntimeLayerError if creation fails
   */
  async createNodeLayer(options: LayerCreationOptions): Promise<LayerInfo> {
    const layerName = options.layerName;

    // Check for existing in-progress operation
    const existingOperation = this.layerCreationLocks.get(layerName);
    if (existingOperation) {
      this.logger.info('Layer creation already in progress, waiting for completion', {
        layerName,
        waiters: existingOperation.waiters + 1,
        operationStartTime: existingOperation.startTime,
        waitTime: Date.now() - existingOperation.startTime,
      });

      // Increment waiter count
      existingOperation.waiters++;

      try {
        // Wait for the existing operation to complete
        const result = await existingOperation.promise;

        this.logger.info('Concurrent layer creation completed successfully', {
          layerName,
          layerArn: result.arn,
          layerVersion: result.version,
          totalWaitTime: Date.now() - existingOperation.startTime,
          waiters: existingOperation.waiters,
        });

        return result;
      } catch (error) {
        this.logger.error('Concurrent layer creation failed', {
          layerName,
          waiters: existingOperation.waiters,
          totalWaitTime: Date.now() - existingOperation.startTime,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        // Decrement waiter count
        existingOperation.waiters--;
      }
    }

    // No existing operation, start a new one with lock
    this.logger.info('Starting new layer creation operation with lock', {
      layerName,
      nodeVersion: options.nodeVersion,
      architecture: options.architecture,
      region: options.region,
    });

    // Create the operation promise and register it
    const operationPromise = this.performLayerCreation(options);
    const operation: LayerCreationOperation = {
      promise: operationPromise,
      startTime: Date.now(),
      options,
      waiters: 0,
    };

    this.layerCreationLocks.set(layerName, operation);

    try {
      const result = await operationPromise;

      this.logger.info('Layer creation operation completed successfully', {
        layerName,
        layerArn: result.arn,
        layerVersion: result.version,
        operationDuration: Date.now() - operation.startTime,
        totalWaiters: operation.waiters,
      });

      return result;
    } catch (error) {
      this.logger.error('Layer creation operation failed', {
        layerName,
        operationDuration: Date.now() - operation.startTime,
        totalWaiters: operation.waiters,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      // Always clean up the lock, regardless of success or failure
      this.layerCreationLocks.delete(layerName);

      this.logger.debug('Released layer creation lock', {
        layerName,
        operationDuration: Date.now() - operation.startTime,
        finalWaiters: operation.waiters,
      });
    }
  }

  /**
   * Performs the actual layer creation operation without concurrent coordination.
   *
   * This is the core layer creation logic extracted from the original createNodeLayer
   * method to separate concerns between concurrent coordination and actual creation.
   *
   * @param options - Layer creation configuration
   * @returns Promise resolving to information about the created layer
   * @throws NodeRuntimeLayerError if creation fails
   */
  private async performLayerCreation(options: LayerCreationOptions): Promise<LayerInfo> {
    const timer = new OperationTimer(this.logger, 'Node.js layer creation', {
      layerName: options.layerName,
      nodeVersion: options.nodeVersion,
      architecture: options.architecture,
      region: options.region,
    });

    // Track all resources for comprehensive cleanup
    const resourceTracker = new LayerCreationResourceTracker(this.logger);

    try {
      // Create temporary directory for layer contents
      const tempDir = await this.createTempDirectory();
      resourceTracker.addTempDirectory(tempDir);
      this.logger.debug('Created temporary directory', { tempDir });

      // Extract Node.js binary from Docker container
      const nodeBinaryPath = await this.extractNodeBinaryFromDockerWithTracking(
        options.nodeVersion,
        options.architecture,
        tempDir,
        resourceTracker,
      );

      // Create Lambda Layer directory structure
      const layerDir = await this.createLayerDirectoryStructure(tempDir, nodeBinaryPath);

      // OPTIMIZATION: Pre-validate content size before ZIP creation
      await this.preValidateLayerContent(layerDir);

      // Create ZIP archive
      const zipFilePath = await this.createLayerZipArchive(layerDir, options.layerName);
      resourceTracker.addZipFile(zipFilePath);

      // Validate size limits (final check)
      await this.validateLayerSize(zipFilePath);

      // Publish layer to AWS Lambda
      const layerInfo = await this.publishLayerToAWS(options, zipFilePath);

      timer.complete({
        layerArn: layerInfo.arn,
        layerVersion: layerInfo.version,
        nodeVersion: layerInfo.nodeVersion,
        architecture: layerInfo.architecture,
      });

      return layerInfo;

    } catch (error) {
      timer.fail(error, {
        layerName: options.layerName,
        nodeVersion: options.nodeVersion,
        architecture: options.architecture,
      });

      // Enhanced error with cleanup context
      const enhancedError = this.createEnhancedError(error, options);
      throw enhancedError;

    } finally {
      // Comprehensive resource cleanup with detailed logging
      await this.performComprehensiveCleanup(resourceTracker);
    }
  }

  /**
   * Deploys a pre-built Node.js Lambda Layer from ZIP file.
   *
   * This method bypasses Docker binary extraction and deploys existing
   * layer ZIP files directly to AWS Lambda. Handles large layers via S3
   * temporary bucket upload with automatic cleanup.
   *
   * Process:
   * 1. Validate input parameters and architecture
   * 2. Search for existing layer ZIP files with fallback naming patterns
   * 3. Read and validate layer ZIP file size
   * 4. Deploy via direct upload (<50MB) or S3 upload (≥50MB)
   * 5. Clean up temporary S3 resources if used
   * 6. Return deployment result with layer ARN and metadata
   *
   * @param options - Deployment configuration
   * @returns Promise resolving to deployment result
   * @throws NodeRuntimeLayerError if deployment fails
   */
  async deployNodejsLayer(options: NodejsLayerDeploymentOptions): Promise<NodejsLayerDeploymentResult> {
    const timer = new OperationTimer(this.logger, 'Node.js layer deployment', {
      region: options.region,
      architecture: options.architecture ?? 'arm64',
      profile: options.profile,
    });

    try {
      // Validate architecture
      const architecture = options.architecture ?? 'arm64';
      if (!['arm64', 'x86_64'].includes(architecture)) {
        throw new NodeRuntimeLayerError(
          `Invalid architecture '${architecture}'. Must be 'arm64' or 'x86_64'`,
          ErrorCodes.INVALID_ARCHITECTURE,
        );
      }

      // Determine layer name and search for ZIP file
      const layerName = options.layerName ?? this.generateLayerName(architecture);
      const baseDirectory = options.baseDirectory ?? process.cwd();

      const zipFilePath = await this.findLayerZipFile(architecture, baseDirectory);
      if (!zipFilePath) {
        throw new NodeRuntimeLayerError(
          `No layer ZIP found for ${architecture} in ${baseDirectory}`,
          ErrorCodes.LAYER_CREATION_FAILED,
        );
      }

      // Read and validate layer content
      const layerContent = await fs.readFile(zipFilePath);
      const layerSizeMB = layerContent.length / (1024 * 1024);

      this.logger.info('Found layer ZIP file for deployment', {
        zipFilePath,
        layerName,
        architecture,
        size: layerContent.length,
        sizeMB: layerSizeMB.toFixed(2),
      });

      // Validate size limits - only reject if exceeds absolute AWS limits
      const AWS_LAMBDA_MAX_LAYER_SIZE = 250 * 1024 * 1024; // 250MB unzipped limit
      if (layerContent.length > AWS_LAMBDA_MAX_LAYER_SIZE) {
        throw new NodeRuntimeLayerError(
          `Layer ZIP size (${layerSizeMB.toFixed(2)}MB) exceeds AWS absolute limit (250MB)`,
          ErrorCodes.LAYER_SIZE_EXCEEDED,
        );
      }

      // Deploy layer based on size
      let deploymentResult: NodejsLayerDeploymentResult;

      if (layerSizeMB > 50) {
        // Use S3 for large layers
        if (!this.s3Client) {
          throw new NodeRuntimeLayerError(
            'S3 support is disabled but required for large layer deployment',
            ErrorCodes.LAYER_CREATION_FAILED,
          );
        }
        deploymentResult = await this.deployLargeLayerViaS3(
          layerName,
          layerContent,
          architecture,
          options.region,
          options.description,
          zipFilePath,
        );
      } else {
        // Direct upload for smaller layers
        deploymentResult = await this.deployLayerDirect(
          layerName,
          layerContent,
          architecture,
          options.description,
          zipFilePath,
        );
      }

      timer.complete({
        layerVersionArn: deploymentResult.layerVersionArn,
        layerName: deploymentResult.layerName,
        architecture: deploymentResult.architecture,
        layerSize: deploymentResult.layerSize,
        uploadMethod: deploymentResult.uploadedViaS3 ? 's3' : 'direct',
      });

      return deploymentResult;

    } catch (error) {
      timer.fail(error, {
        region: options.region,
        architecture: options.architecture ?? 'arm64',
      });

      if (error instanceof NodeRuntimeLayerError) {
        throw error;
      }

      throw new NodeRuntimeLayerError(
        `Failed to deploy Node.js layer: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCodes.LAYER_CREATION_FAILED,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Deploys Node.js layers for all supported architectures.
   *
   * Attempts to deploy layers for both arm64 and x86_64 architectures,
   * continuing on individual failures to maximize successful deployments.
   * This matches the behavior of the Python deployment script.
   *
   * @param options - Base deployment configuration (architecture will be overridden)
   * @returns Promise resolving to multi-architecture deployment results
   */
  async deployAllArchitectures(options: Omit<NodejsLayerDeploymentOptions, 'architecture'>): Promise<MultiArchitectureDeploymentResult> {
    const timer = new OperationTimer(this.logger, 'multi-architecture layer deployment', {
      region: options.region,
      profile: options.profile,
    });

    const results: Record<'arm64' | 'x86_64', NodejsLayerDeploymentResult | null> = {
      arm64: null,
      x86_64: null,
    };

    const successful: Array<{ architecture: 'arm64' | 'x86_64'; layerVersionArn: string }> = [];
    const failed: Array<{ architecture: 'arm64' | 'x86_64'; error: string }> = [];

    // Deploy for each architecture
    for (const architecture of ['arm64', 'x86_64'] as const) {
      this.logger.info(`Deploying ${architecture} layer...`, { architecture });

      try {
        const result = await this.deployNodejsLayer({
          ...options,
          architecture,
        });

        results[architecture] = result;
        successful.push({
          architecture,
          layerVersionArn: result.layerVersionArn,
        });

        this.logger.info(`✓ ${architecture} layer deployed successfully`, {
          architecture,
          layerVersionArn: result.layerVersionArn,
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results[architecture] = null;
        failed.push({
          architecture,
          error: errorMessage,
        });

        this.logger.error(`✗ ${architecture} layer deployment failed`, {
          architecture,
          error: errorMessage,
        });
      }
    }

    const deploymentResult: MultiArchitectureDeploymentResult = {
      results,
      success: successful.length > 0,
      successful,
      failed,
    };

    // Log summary
    this.logger.info('Multi-architecture deployment completed', {
      totalSuccessful: successful.length,
      totalFailed: failed.length,
      successful: successful.map(s => `${s.architecture}: ${s.layerVersionArn}`),
      failed: failed.map(f => `${f.architecture}: ${f.error}`),
    });

    timer.complete({
      totalSuccessful: successful.length,
      totalFailed: failed.length,
      overallSuccess: deploymentResult.success,
    });

    return deploymentResult;
  }

  /**
   * Generates a standard layer name for the given architecture.
   *
   * @param architecture - Target architecture
   * @returns Standard layer name following the pattern: nodejs-18-{architecture}
   */
  private generateLayerName(architecture: 'arm64' | 'x86_64'): string {
    return `nodejs-18-${architecture}`;
  }

  /**
   * Searches for layer ZIP files with fallback naming patterns.
   *
   * Implements the same search logic as the Python script with multiple
   * naming conventions for maximum compatibility.
   *
   * @param architecture - Target architecture
   * @param baseDirectory - Directory to search in
   * @returns Promise resolving to ZIP file path or null if not found
   */
  private async findLayerZipFile(architecture: 'arm64' | 'x86_64', baseDirectory: string): Promise<string | null> {
    // Define search patterns based on architecture (matching Python script)
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

    this.logger.debug('Searching for layer ZIP files', {
      architecture,
      baseDirectory,
      candidates,
    });

    // Search for existing files
    for (const candidate of candidates) {
      const filePath = path.join(baseDirectory, candidate);

      try {
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          this.logger.debug('Found layer ZIP file', {
            filePath,
            size: stats.size,
            sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
          });
          return filePath;
        }
      } catch (error) {
        // File doesn't exist, continue searching
        continue;
      }
    }

    this.logger.warn('No layer ZIP files found', {
      architecture,
      baseDirectory,
      searchedFiles: candidates,
    });

    return null;
  }

  /**
   * Deploys a large layer (>50MB) via S3 temporary bucket.
   *
   * Creates a temporary S3 bucket, uploads the layer, publishes from S3,
   * and cleans up the bucket. Implements the same logic as the Python script.
   *
   * @param layerName - Name of the layer
   * @param layerContent - ZIP file content
   * @param architecture - Target architecture
   * @param region - AWS region
   * @param description - Optional layer description
   * @param zipFilePath - Original ZIP file path for metadata
   * @returns Promise resolving to deployment result
   */
  private async deployLargeLayerViaS3(
    layerName: string,
    layerContent: Buffer,
    architecture: 'arm64' | 'x86_64',
    region: string,
    description?: string,
    zipFilePath?: string,
  ): Promise<NodejsLayerDeploymentResult> {
    if (!this.s3Client) {
      throw new NodeRuntimeLayerError(
        'S3 client not available for large layer deployment',
        ErrorCodes.LAYER_CREATION_FAILED,
      );
    }

    // Generate unique bucket name
    const bucketName = `lambda-layer-temp-${randomBytes(4).toString('hex')}`;
    const keyName = `nodejs-layer-${architecture}.zip`;

    this.logger.info('Deploying large layer via S3', {
      layerName,
      bucketName,
      keyName,
      layerSize: layerContent.length,
      layerSizeMB: (layerContent.length / (1024 * 1024)).toFixed(2),
    });

    try {
      // Create S3 bucket
      await this.createS3Bucket(bucketName, region);
      this.logger.debug('Created temporary S3 bucket', { bucketName });

      // Upload layer to S3
      await this.uploadLayerToS3(bucketName, keyName, layerContent);
      this.logger.debug('Uploaded layer to S3', { bucketName, keyName });

      // Publish layer from S3
      const layerDescription = description ||
        `Node.js 18.x runtime for ${architecture} Lambda functions`;

      const publishCommand = new PublishLayerVersionCommand({
        LayerName: layerName,
        Description: layerDescription,
        Content: {
          S3Bucket: bucketName,
          S3Key: keyName,
        },
        CompatibleRuntimes: ['python3.12'], // Lambda Kata uses Python runtime
        CompatibleArchitectures: [architecture],
        LicenseInfo: 'MIT',
      });

      const response = await this.executeWithRetry(() => this.lambdaClient.send(publishCommand));

      if (!response.LayerVersionArn || !response.LayerArn || !response.Version) {
        throw new Error('Invalid response from PublishLayerVersion: missing required fields');
      }

      const result: NodejsLayerDeploymentResult = {
        layerVersionArn: response.LayerVersionArn,
        layerArn: response.LayerArn,
        layerName,
        version: response.Version,
        architecture,
        layerSize: layerContent.length,
        zipFilePath: zipFilePath || 'unknown',
        uploadedViaS3: true,
      };

      this.logger.info('Large layer deployed successfully via S3', {
        layerVersionArn: result.layerVersionArn,
        version: result.version,
        architecture: result.architecture,
      });

      return result;

    } finally {
      // Always clean up S3 resources
      await this.cleanupS3Resources(bucketName, keyName);
    }
  }

  /**
   * Deploys a layer directly to Lambda (for layers <50MB).
   *
   * @param layerName - Name of the layer
   * @param layerContent - ZIP file content
   * @param architecture - Target architecture
   * @param description - Optional layer description
   * @param zipFilePath - Original ZIP file path for metadata
   * @returns Promise resolving to deployment result
   */
  private async deployLayerDirect(
    layerName: string,
    layerContent: Buffer,
    architecture: 'arm64' | 'x86_64',
    description?: string,
    zipFilePath?: string,
  ): Promise<NodejsLayerDeploymentResult> {
    this.logger.info('Deploying layer directly to Lambda', {
      layerName,
      layerSize: layerContent.length,
      layerSizeMB: (layerContent.length / (1024 * 1024)).toFixed(2),
      architecture,
    });

    const layerDescription = description ||
      `Node.js 18.x runtime for ${architecture} Lambda functions`;

    const publishCommand = new PublishLayerVersionCommand({
      LayerName: layerName,
      Description: layerDescription,
      Content: {
        ZipFile: layerContent,
      },
      CompatibleRuntimes: ['python3.12'], // Lambda Kata uses Python runtime
      CompatibleArchitectures: [architecture],
      LicenseInfo: 'MIT',
    });

    const response = await this.executeWithRetry(() => this.lambdaClient.send(publishCommand));

    if (!response.LayerVersionArn || !response.LayerArn || !response.Version) {
      throw new Error('Invalid response from PublishLayerVersion: missing required fields');
    }

    const result: NodejsLayerDeploymentResult = {
      layerVersionArn: response.LayerVersionArn,
      layerArn: response.LayerArn,
      layerName,
      version: response.Version,
      architecture,
      layerSize: layerContent.length,
      zipFilePath: zipFilePath || 'unknown',
      uploadedViaS3: false,
    };

    this.logger.info('Layer deployed successfully via direct upload', {
      layerVersionArn: result.layerVersionArn,
      version: result.version,
      architecture: result.architecture,
    });

    return result;
  }

  /**
   * Creates an S3 bucket for temporary layer storage.
   *
   * @param bucketName - Name of the bucket to create
   * @param region - AWS region
   */
  private async createS3Bucket(bucketName: string, region: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not available');
    }

    const createBucketCommand = region === 'us-east-1'
      ? new CreateBucketCommand({ Bucket: bucketName })
      : new CreateBucketCommand({
        Bucket: bucketName,
        CreateBucketConfiguration: {
          LocationConstraint: region as BucketLocationConstraint,
        },
      });

    await this.executeWithRetry(() => this.s3Client!.send(createBucketCommand));
  }

  /**
   * Uploads layer content to S3.
   *
   * @param bucketName - S3 bucket name
   * @param keyName - S3 object key
   * @param layerContent - Layer ZIP content
   */
  private async uploadLayerToS3(bucketName: string, keyName: string, layerContent: Buffer): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3 client not available');
    }

    const putObjectCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: keyName,
      Body: layerContent,
    });

    await this.executeWithRetry(() => this.s3Client!.send(putObjectCommand));
  }

  /**
   * Cleans up S3 resources (bucket and objects).
   *
   * @param bucketName - S3 bucket name
   * @param keyName - S3 object key
   */
  private async cleanupS3Resources(bucketName: string, keyName: string): Promise<void> {
    if (!this.s3Client) {
      return; // Nothing to clean up
    }

    try {
      // Delete object first
      const deleteObjectCommand = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: keyName,
      });
      await this.s3Client.send(deleteObjectCommand);
      this.logger.debug('Deleted S3 object', { bucketName, keyName });

      // Delete bucket
      const deleteBucketCommand = new DeleteBucketCommand({
        Bucket: bucketName,
      });
      await this.s3Client.send(deleteBucketCommand);
      this.logger.debug('Deleted S3 bucket', { bucketName });

    } catch (error) {
      this.logger.warn('Failed to cleanup S3 resources', {
        bucketName,
        keyName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Validates whether a layer meets the specified requirements.
   *
   * Checks layer compatibility based on:
   * - Node.js version exact match
   * - Architecture compatibility
   * - Layer age (if maxAge is specified in requirements)
   *
   * @param layer - The layer to validate
   * @param requirements - The requirements to check against
   * @returns true if the layer is compatible, false otherwise
   */
  validateLayerCompatibility(layer: LayerInfo, requirements: LayerRequirements): boolean {
    this.logger.debug('Validating layer compatibility', {
      layerArn: layer.arn,
      layerNodeVersion: layer.nodeVersion,
      requiredNodeVersion: requirements.nodeVersion,
      layerArchitecture: layer.architecture,
      requiredArchitecture: requirements.architecture,
      layerAge: Date.now() - layer.createdDate.getTime(),
      maxAge: requirements.maxAge,
    });

    // Check Node.js version exact match
    if (layer.nodeVersion !== requirements.nodeVersion) {
      this.logger.debug('Layer rejected: Node.js version mismatch', {
        layerVersion: layer.nodeVersion,
        requiredVersion: requirements.nodeVersion,
      });
      return false;
    }

    // Check architecture compatibility
    if (layer.architecture !== requirements.architecture) {
      this.logger.debug('Layer rejected: Architecture mismatch', {
        layerArchitecture: layer.architecture,
        requiredArchitecture: requirements.architecture,
      });
      return false;
    }

    // Check layer age if specified
    if (requirements.maxAge !== undefined) {
      const layerAge = Date.now() - layer.createdDate.getTime();
      if (layerAge > requirements.maxAge) {
        this.logger.debug('Layer rejected: Too old', {
          layerAge,
          maxAge: requirements.maxAge,
          layerCreatedDate: layer.createdDate,
        });
        return false;
      }
    } else {
      // Use default max age if not specified in requirements
      const layerAge = Date.now() - layer.createdDate.getTime();
      if (layerAge > this.maxLayerAge) {
        this.logger.debug('Layer rejected: Exceeds default max age', {
          layerAge,
          defaultMaxAge: this.maxLayerAge,
          layerCreatedDate: layer.createdDate,
        });
        return false;
      }
    }

    this.logger.debug('Layer compatibility validated successfully', {
      layerArn: layer.arn,
    });

    return true;
  }

  /**
   * Lists layers by name using AWS SDK v3 pagination with retry logic.
   *
   * Efficiently searches through all layers in the account and region
   * to find layers matching the specified name pattern. Uses retry logic
   * to handle transient pagination failures.
   *
   * @param layerName - The layer name to search for
   * @returns Promise resolving to array of matching layers
   * @throws Error if AWS API operations fail
   */
  private async listLayersByName(layerName: string): Promise<LayersListItem[]> {
    const timer = new OperationTimer(this.logger, 'layer listing', { layerName });

    const matchingLayers: LayersListItem[] = [];

    try {
      // Use executeWithRetry to wrap the entire pagination operation
      await this.executeWithRetry(async () => {
        // Clear any previous results on retry
        matchingLayers.length = 0;

        // OPTIMIZATION: Try direct layer lookup first (much faster)
        try {
          const directResult = await this.lambdaClient.send(new ListLayerVersionsCommand({
            LayerName: layerName,
            MaxItems: 10, // Only need recent versions
          }));

          if (directResult.LayerVersions && directResult.LayerVersions.length > 0) {
            // Found the layer directly - much faster!
            const latestVersion = directResult.LayerVersions[0];
            matchingLayers.push({
              LayerName: layerName,
              LatestMatchingVersion: {
                LayerVersionArn: latestVersion.LayerVersionArn,
                Version: latestVersion.Version,
                CreatedDate: latestVersion.CreatedDate,
                CompatibleRuntimes: latestVersion.CompatibleRuntimes,
                CompatibleArchitectures: latestVersion.CompatibleArchitectures,
              },
            });
            return null; // Success
          }
        } catch (error) {
          // Layer doesn't exist, fall back to pagination
          this.logger.debug('Direct layer lookup failed, using pagination', {
            layerName,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // Fallback: Use pagination only if direct lookup failed
        const paginator = paginateListLayers(
          { client: this.lambdaClient },
          { MaxItems: 50 }, // Limit pagination size
        );

        for await (const page of paginator) {
          if (page.Layers) {
            for (const layer of page.Layers) {
              if (layer.LayerName === layerName) {
                matchingLayers.push(layer);
                break; // Found it, no need to continue
              }
            }
          }
          // Early exit if found
          if (matchingLayers.length > 0) break;
        }

        return null;
        return true;
      });

      timer.complete({
        layerName,
        matchingLayersCount: matchingLayers.length,
      });

      return matchingLayers;
    } catch (error) {
      timer.fail(error, { layerName });
      throw error;
    }
  }

  /**
   * Gets detailed information about a specific layer version.
   *
   * Retrieves layer metadata and extracts Node.js version and architecture
   * information from the layer description or other metadata.
   *
   * @param layerName - The name of the layer
   * @param version - The version number of the layer
   * @returns Promise resolving to LayerInfo
   * @throws Error if layer information cannot be retrieved
   */
  private async getLayerInfo(layerName: string, version: number): Promise<LayerInfo> {
    const timer = new OperationTimer(this.logger, 'layer info retrieval', { layerName, version });

    try {
      const command = new GetLayerVersionCommand({
        LayerName: layerName,
        VersionNumber: version,
      });

      const response = await this.executeWithRetry(() => this.lambdaClient.send(command));

      if (!response.LayerVersionArn || !response.CreatedDate) {
        throw new Error('Invalid layer response: missing required fields');
      }

      // Extract Node.js version and architecture from layer description
      const { nodeVersion, architecture } = this.parseLayerMetadata(
        response.Description || '',
        layerName,
      );

      const layerInfo: LayerInfo = {
        arn: response.LayerVersionArn,
        name: layerName,
        version,
        nodeVersion,
        architecture,
        createdDate: new Date(response.CreatedDate),
      };

      timer.complete({
        layerArn: layerInfo.arn,
        nodeVersion: layerInfo.nodeVersion,
        architecture: layerInfo.architecture,
        createdDate: layerInfo.createdDate,
      });

      return layerInfo;
    } catch (error) {
      timer.fail(error, { layerName, version });
      throw error;
    }
  }

  /**
   * Parses layer metadata to extract Node.js version and architecture.
   *
   * Attempts to extract information from layer description or falls back
   * to parsing the layer name if description doesn't contain the required data.
   *
   * @param description - The layer description
   * @param layerName - The layer name as fallback
   * @returns Object containing nodeVersion and architecture
   */
  private parseLayerMetadata(description: string, layerName: string): { nodeVersion: string; architecture: string } {
    this.logger.debug('Parsing layer metadata', { description, layerName });

    // Try to extract from description first
    const descriptionMatch = description.match(/Node\.js\s+(\d+\.\d+\.\d+)\s+\((\w+)\)/);
    if (descriptionMatch) {
      return {
        nodeVersion: descriptionMatch[1],
        architecture: descriptionMatch[2],
      };
    }

    // Fall back to parsing layer name
    // Supports both formats:
    // - Old: lambda-kata-nodejs-nodejs20.x-x86_64 (with dot)
    // - New: lambda-kata-nodejs-nodejs20-x-x86_64 (with dash)
    const nameMatch = layerName.match(/lambda-kata-nodejs-nodejs(\d+)[.-]x-(\w+)/);
    if (nameMatch) {
      const majorVersion = nameMatch[1];
      const architecture = nameMatch[2];

      // Map major version to likely full version (this is a fallback)
      const versionMap: Record<string, string> = {
        '18': '18.19.0',
        '20': '20.10.0',
        '22': '22.1.0',
      };

      const nodeVersion = versionMap[majorVersion] || `${majorVersion}.0.0`;

      this.logger.debug('Parsed metadata from layer name', {
        layerName,
        nodeVersion,
        architecture,
      });

      return { nodeVersion, architecture };
    }

    // If we can't parse, throw an error
    throw new Error(`Unable to parse Node.js version and architecture from layer metadata. Description: "${description}", LayerName: "${layerName}"`);
  }

  /**
   * Executes an AWS API operation with exponential backoff retry logic and circuit breaker protection.
   *
   * Implements retry logic for transient AWS API failures with exponential
   * backoff and jitter to avoid thundering herd problems. Uses circuit breaker
   * pattern to prevent cascading failures during AWS service outages.
   *
   * @param operation - The async operation to execute
   * @returns Promise resolving to the operation result
   * @throws Error if all retries are exhausted or circuit breaker is open
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    return this.circuitBreaker.execute(async () => {
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          return await operation();
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // Check if error is retryable
          if (!this.isRetryableError(lastError) || attempt === this.maxRetries) {
            throw lastError;
          }

          // Calculate delay with exponential backoff and jitter
          const delay = this.calculateRetryDelay(attempt);

          this.logger.warn('AWS API operation failed, retrying', {
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            delay,
            error: lastError.message,
            errorName: lastError.name,
            isRetryable: this.isRetryableError(lastError),
          });

          await this.sleep(delay);
        }
      }

      throw lastError || new Error('Unexpected retry loop exit');
    });
  }

  /**
   * Determines if an error is retryable.
   *
   * @param error - The error to check
   * @returns true if the error is retryable, false otherwise
   */
  private isRetryableError(error: Error): boolean {
    const retryableErrors = [
      // AWS throttling and rate limiting
      'ThrottlingException',
      'TooManyRequestsException',
      'RequestLimitExceeded',
      'Throttling',

      // AWS service availability issues
      'ServiceUnavailableException',
      'ServiceUnavailable',
      'InternalServerError',
      'InternalError',
      'InternalFailure',

      // Network and timeout issues
      'RequestTimeout',
      'TimeoutError',
      'NetworkingError',
      'ConnectionError',
      'ECONNRESET',
      'ENOTFOUND',
      'ETIMEDOUT',

      // AWS temporary failures
      'ProvisionedThroughputExceededException',
      'RequestTimeoutException',
      'PriorRequestNotComplete',
      'SlowDown',
    ];

    // Check error name and message for retryable patterns
    const errorName = error.name || '';
    const errorMessage = error.message || '';

    return retryableErrors.some(retryableError =>
      errorName.includes(retryableError) ||
      errorMessage.includes(retryableError),
    ) || this.isNetworkError(error);
  }

  /**
   * Checks if an error is a network-related error that should be retried.
   *
   * @param error - The error to check
   * @returns true if it's a retryable network error
   */
  private isNetworkError(error: Error): boolean {
    const networkErrorCodes = [
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'EPIPE',
      'EHOSTUNREACH',
      'ENETUNREACH',
    ];

    // Check if error has a code property (common in Node.js network errors)
    const errorCode = (error as any).code;
    if (errorCode && networkErrorCodes.includes(errorCode)) {
      return true;
    }

    // Check error message for network-related patterns
    const networkPatterns = [
      'socket hang up',
      'connect timeout',
      'network timeout',
      'dns lookup failed',
      'connection refused',
    ];

    const errorMessage = error.message.toLowerCase();
    return networkPatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Calculates retry delay with exponential backoff and jitter.
   *
   * @param attempt - The current attempt number (0-based)
   * @returns Delay in milliseconds
   */
  private calculateRetryDelay(attempt: number): number {
    const exponentialDelay = this.retryBaseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    return Math.floor(exponentialDelay + jitter);
  }

  /**
   * Sleeps for the specified number of milliseconds.
   *
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after the delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gets the current circuit breaker state for monitoring and debugging.
   *
   * @returns Object containing circuit breaker state information
   */
  public getCircuitBreakerState(): { state: string; failureCount: number; successCount: number } {
    return this.circuitBreaker.getState();
  }

  /**
   * Gets the current concurrent operation state for monitoring and debugging.
   *
   * @returns Object containing information about in-progress layer creation operations
   */
  public getConcurrentOperationState(): {
    activeOperations: number;
    operations: Array<{
      layerName: string;
      startTime: number;
      duration: number;
      waiters: number;
      nodeVersion: string;
      architecture: string;
    }>;
  } {
    const operations = Array.from(this.layerCreationLocks.entries()).map(([layerName, operation]) => ({
      layerName,
      startTime: operation.startTime,
      duration: Date.now() - operation.startTime,
      waiters: operation.waiters,
      nodeVersion: operation.options.nodeVersion,
      architecture: operation.options.architecture,
    }));

    return {
      activeOperations: this.layerCreationLocks.size,
      operations,
    };
  }

  /**
   * Destroys the AWS Lambda client and cleans up resources.
   *
   * Should be called when the manager is no longer needed to prevent
   * resource leaks. Also cleans up any remaining concurrent operation locks.
   */
  public destroy(): void {
    // Log any remaining operations before cleanup
    if (this.layerCreationLocks.size > 0) {
      this.logger.warn('Destroying AWSLayerManager with active layer creation operations', {
        activeOperations: this.layerCreationLocks.size,
        operations: Array.from(this.layerCreationLocks.keys()),
      });
    }

    // Clear all locks (this will not cancel in-progress operations, but prevents new waiters)
    this.layerCreationLocks.clear();

    this.lambdaClient.destroy();

    // Clean up S3 client if available
    if (this.s3Client) {
      this.s3Client.destroy();
    }

    this.logger.debug('AWSLayerManager destroyed', {
      circuitBreakerState: this.circuitBreaker.getState(),
      clearedLocks: true,
      s3ClientDestroyed: this.s3Client !== null,
    });
  }

  /**
   * Creates a temporary directory for layer creation operations.
   *
   * @returns Promise resolving to the temporary directory path
   * @throws Error if directory creation fails
   */
  private async createTempDirectory(): Promise<string> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lambda-kata-layer-'));
    this.logger.debug('Created temporary directory', { tempDir });
    return tempDir;
  }

  /**
   * Extracts Node.js binary from AWS Lambda Docker image with resource tracking.
   *
   * Uses ONLY AWS Lambda Docker images to extract the Node.js binary from the
   * official Lambda runtime environment. This ensures compatibility with the
   * Lambda execution environment while extracting only the minimal binary needed.
   *
   * CRITICAL: Uses ONLY AWS Lambda Docker images as required by user specifications.
   * Docker image format: public.ecr.aws/lambda/nodejs:{version}-{arch}
   * Extracts ONLY: /var/lang/bin/node
   *
   * @param nodeVersion - The Node.js version (e.g., "20.10.0")
   * @param architecture - The target architecture
   * @param tempDir - Temporary directory for extraction
   * @param resourceTracker - Resource tracker for cleanup
   * @returns Promise resolving to the path of the extracted binary
   * @throws NodeRuntimeLayerError if extraction fails
   */
  private async extractNodeBinaryFromDockerWithTracking(
    nodeVersion: string,
    architecture: string,
    tempDir: string,
    resourceTracker: LayerCreationResourceTracker,
  ): Promise<string> {
    this.logger.debug('Extracting Node.js binary from AWS Lambda Docker image', {
      nodeVersion,
      architecture,
      tempDir,
    });

    // !!!! IMPORTANT !!!! –––>> DO NOT CHANGE THIS PART OF CODE ––> THIS IS VALID AWS DOCKER INSTANCE ///
    // Map Node.js version to Lambda runtime version
    const majorVersion = nodeVersion.split('.')[0].replace('nodejs', '');
    // const lambdaRuntime = `nodejs${majorVersion}.x`;
    const lambdaRuntime = `${majorVersion}`;

    // Map AWS Lambda architecture to Docker architecture
    // const dockerArch = architecture === 'x86_64' ? 'amd64' : 'arm64';
    const dockerArch = architecture === 'x86_64' ? 'x86_64' : 'arm64';

    // Build AWS Lambda Docker image name
    // const dockerImage = `public.ecr.aws/lambda/nodejs:${lambdaRuntime}-${dockerArch}`;
    // const dockerImage = `amazon/aws-lambda-nodejs:${lambdaRuntime}-${dockerArch}`;
    const containerName = `lambda-kata-extract-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const binaryPath = path.join(tempDir, 'node');

    // Track container for cleanup
    // resourceTracker.addDockerContainer(containerName);

    // Build AWS Lambda Docker image name
    // const dockerImage = `public.ecr.aws/lambda/nodejs:${lambdaRuntime}-${dockerArch}`;
    const dockerImage = `amazon/aws-lambda-nodejs:${lambdaRuntime}-${dockerArch}`;
    resourceTracker.addDockerContainer(containerName);
    // end of --- !!!! IMPORTANT !!!! –––>> DO NOT CHANGE THIS PART OF CODE ––> THIS IS VALID AWS DOCKER INSTANCE ///

    try {
      this.logger.info('Extracting Node.js binary from AWS Lambda Docker image', {
        nodeVersion,
        lambdaRuntime,
        dockerImage,
        containerName,
        architecture: dockerArch,
        extractionPath: '/var/lang/bin/node',
      });

      // Pull the AWS Lambda Docker image
      this.logger.debug('Pulling AWS Lambda Docker image', { dockerImage });
      await this.executeDockerCommand(['pull', dockerImage]);

      // Create container (don't run it, just create for file extraction)
      this.logger.debug('Creating Docker container for binary extraction', { containerName });
      await this.executeDockerCommand(['create', '--name', containerName, dockerImage]);

      // Extract ONLY the Node.js binary from /var/lang/bin/node
      this.logger.debug('Extracting Node.js binary from container', {
        containerName,
        sourcePath: '/var/lang/bin/node',
        targetPath: binaryPath,
      });
      await this.executeDockerCommand(['cp', `${containerName}:/var/lang/bin/node`, binaryPath]);

      // Verify the binary was extracted correctly
      const binaryStats = await fs.stat(binaryPath);
      if (!binaryStats.isFile()) {
        throw new Error('Failed to extract Node.js binary from Docker container');
      }

      this.logger.info('Node.js binary extracted successfully from AWS Lambda Docker image', {
        originalSize: binaryStats.size,
        originalSizeMB: (binaryStats.size / (1024 * 1024)).toFixed(2),
        binaryPath,
        extractionMethod: 'aws_lambda_docker_image',
        dockerImage,
        sourcePath: '/var/lang/bin/node',
      });

      // CRITICAL: Check if extracted binary is already too large
      if (binaryStats.size > 100 * 1024 * 1024) { // 100MB threshold for warning
        this.logger.warn('Extracted Node.js binary is very large, applying aggressive optimization', {
          originalSize: binaryStats.size,
          originalSizeMB: (binaryStats.size / (1024 * 1024)).toFixed(2),
          threshold: '100MB',
          dockerImage,
        });
      }

      // Apply optimization to reduce size further
      let optimizedBinaryPath = await this.optimizeNodeBinary(binaryPath, tempDir);

      // CRITICAL: If strip didn't work well enough, try compression
      const afterStripStats = await fs.stat(optimizedBinaryPath);
      if (afterStripStats.size > 40 * 1024 * 1024) { // Still > 40MB
        this.logger.warn('Binary still large after strip, applying compression', {
          currentSize: afterStripStats.size,
          currentSizeMB: (afterStripStats.size / (1024 * 1024)).toFixed(2),
        });

        // Compress the binary with maximum compression
        const compressedPath = path.join(tempDir, 'node.gz');

        // Use shell redirection for gzip output
        await this.executeCommand('sh', [
          '-c',
          `gzip -9 -c "${optimizedBinaryPath}" > "${compressedPath}"`,
        ]);

        const compressedStats = await fs.stat(compressedPath);
        const compressionRatio = ((afterStripStats.size - compressedStats.size) / afterStripStats.size * 100).toFixed(1);

        this.logger.info('Binary compressed successfully', {
          originalSize: afterStripStats.size,
          compressedSize: compressedStats.size,
          compressionRatio: compressionRatio + '%',
          originalSizeMB: (afterStripStats.size / (1024 * 1024)).toFixed(2),
          compressedSizeMB: (compressedStats.size / (1024 * 1024)).toFixed(2),
        });

        optimizedBinaryPath = compressedPath;
      }

      // Verify optimized binary
      const optimizedStats = await fs.stat(optimizedBinaryPath);
      const sizeReduction = binaryStats.size - optimizedStats.size;
      const reductionPercent = ((sizeReduction / binaryStats.size) * 100).toFixed(1);

      // Make sure the binary is executable
      await fs.chmod(optimizedBinaryPath, 0o755);

      this.logger.info('Node.js binary optimization completed', {
        originalSize: binaryStats.size,
        optimizedSize: optimizedStats.size,
        sizeReduction,
        reductionPercent: reductionPercent + '%',
        originalSizeMB: (binaryStats.size / (1024 * 1024)).toFixed(2),
        optimizedSizeMB: (optimizedStats.size / (1024 * 1024)).toFixed(2),
        extractionMethod: 'aws_lambda_docker_image',
        dockerImage,
      });

      return optimizedBinaryPath;

    } catch (error) {
      throw new NodeRuntimeLayerError(
        `Failed to extract Node.js binary from AWS Lambda Docker image ${dockerImage}: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCodes.LAYER_CREATION_FAILED,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    // Note: Cleanup is handled by the resource tracker in the finally block
  }


  /**
   * Optimizes Node.js binary to reduce size while preserving functionality.
   *
   * Multi-stage optimization approach:
   * 1. Strip debug symbols using 'strip' command (30-50% reduction)
   * 2. UPX compression if still >50MB (50-70% additional reduction)
   * 3. System Node.js replacement if still >60MB
   * 4. Verify binary functionality after each stage
   * 5. Fallback to original if within 250MB limit
   *
   * @param originalBinaryPath - Path to the original Node.js binary
   * @param tempDir - Temporary directory for optimization work
   * @returns Promise resolving to path of optimized binary
   * @throws Error if optimization fails and original exceeds 250MB limit
   */
  private async optimizeNodeBinary(originalBinaryPath: string, tempDir: string): Promise<string> {
    const timer = new OperationTimer(this.logger, 'Node.js binary optimization', {
      originalBinaryPath,
    });

    const LAMBDA_LAYER_LIMIT = 250 * 1024 * 1024; // 250MB hard limit (AWS Lambda Layer limit)
    const UPX_THRESHOLD = 50 * 1024 * 1024;       // 50MB threshold for UPX
    const SYSTEM_THRESHOLD = 60 * 1024 * 1024;    // 60MB threshold for system replacement

    try {
      const originalStats = await fs.stat(originalBinaryPath);

      this.logger.debug('Starting multi-stage binary optimization', {
        originalSize: originalStats.size,
        originalSizeMB: (originalStats.size / (1024 * 1024)).toFixed(2),
        targetSizeMB: '15-25MB',
        hardLimitMB: '250MB',
      });

      // STAGE 1: Strip optimization
      let currentBinaryPath = await this.tryStripOptimization(originalBinaryPath, tempDir);
      let currentStats = await fs.stat(currentBinaryPath);

      // STAGE 2: UPX compression if still too large
      if (currentStats.size > UPX_THRESHOLD) {
        this.logger.info('Binary exceeds UPX threshold, attempting compression', {
          currentSize: currentStats.size,
          currentSizeMB: (currentStats.size / (1024 * 1024)).toFixed(2),
          threshold: '50MB',
        });

        const upxOptimizedPath = await this.tryUPXOptimization(currentBinaryPath, tempDir);
        if (upxOptimizedPath) {
          currentBinaryPath = upxOptimizedPath;
          currentStats = await fs.stat(currentBinaryPath);
        }
      }

      // STAGE 3: System Node.js replacement if still too large
      if (currentStats.size > SYSTEM_THRESHOLD) {
        this.logger.info('Binary exceeds system replacement threshold, trying alternative', {
          currentSize: currentStats.size,
          currentSizeMB: (currentStats.size / (1024 * 1024)).toFixed(2),
          threshold: '60MB',
        });

        const systemNodePath = await this.trySystemNodeReplacement(tempDir);
        if (systemNodePath) {
          currentBinaryPath = systemNodePath;
          currentStats = await fs.stat(currentBinaryPath);
        }
      }

      // Final verification and size check (with graceful fallback)
      const verificationResult = await this.verifyNodeBinaryWithFallback(currentBinaryPath);

      if (!verificationResult.success) {
        this.logger.warn('Binary verification failed, but continuing with deployment', {
          binaryPath: currentBinaryPath,
          error: verificationResult.error,
          binarySize: currentStats.size,
          binarySizeMB: (currentStats.size / (1024 * 1024)).toFixed(2),
        });
      }

      const finalReduction = originalStats.size - currentStats.size;
      const reductionPercent = ((finalReduction / originalStats.size) * 100).toFixed(1);

      this.logger.info('Binary optimization completed', {
        originalSize: originalStats.size,
        optimizedSize: currentStats.size,
        reduction: finalReduction,
        reductionPercent: reductionPercent + '%',
        originalSizeMB: (originalStats.size / (1024 * 1024)).toFixed(2),
        optimizedSizeMB: (currentStats.size / (1024 * 1024)).toFixed(2),
        withinLimits: currentStats.size <= LAMBDA_LAYER_LIMIT,
        verified: verificationResult.success,
      });

      // Enforce hard limit
      if (currentStats.size > LAMBDA_LAYER_LIMIT) {
        throw new Error(
          `Optimized binary size (${(currentStats.size / (1024 * 1024)).toFixed(2)}MB) exceeds AWS Lambda layer limit (250MB). ` +
          `Original: ${(originalStats.size / (1024 * 1024)).toFixed(2)}MB, Reduction: ${reductionPercent}%. ` +
          `Consider using a different Node.js version or architecture.`,
        );
      }

      timer.complete({
        originalSize: originalStats.size,
        optimizedSize: currentStats.size,
        reduction: finalReduction,
        optimizationMethod: 'multi_stage_optimization',
      });

      return currentBinaryPath;

    } catch (error) {
      timer.fail(error, { originalBinaryPath });

      // Check if original binary is within limits as fallback
      const originalStats = await fs.stat(originalBinaryPath);
      if (originalStats.size <= LAMBDA_LAYER_LIMIT) {
        this.logger.warn('Optimization failed but original binary is within limits, using unoptimized binary', {
          error: error instanceof Error ? error.message : String(error),
          originalSizeMB: (originalStats.size / (1024 * 1024)).toFixed(2),
          limitMB: '250MB',
          recommendation: 'Consider installing strip/upx tools for better optimization',
        });
        return originalBinaryPath;
      }

      // Both optimization and fallback failed
      throw new Error(
        `Binary optimization failed and original binary (${(originalStats.size / (1024 * 1024)).toFixed(2)}MB) exceeds 250MB limit. ` +
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Attempts strip-based optimization with progressive aggressiveness.
   *
   * @param originalBinaryPath - Path to original binary
   * @param tempDir - Working directory
   * @returns Path to stripped binary or original if stripping fails
   */
  private async tryStripOptimization(originalBinaryPath: string, tempDir: string): Promise<string> {
    const optimizedBinaryPath = path.join(tempDir, 'node-optimized');
    const originalStats = await fs.stat(originalBinaryPath);

    try {
      // Copy original for modification
      await fs.copyFile(originalBinaryPath, optimizedBinaryPath);

      // Try debug symbol stripping first (safer)
      await this.executeCommand('strip', ['--strip-debug', optimizedBinaryPath]);

      const debugStrippedStats = await fs.stat(optimizedBinaryPath);
      const debugReduction = originalStats.size - debugStrippedStats.size;

      this.logger.debug('Debug symbols stripped', {
        originalSize: originalStats.size,
        strippedSize: debugStrippedStats.size,
        reduction: debugReduction,
        reductionPercent: ((debugReduction / originalStats.size) * 100).toFixed(1) + '%',
      });

      // If still large, try aggressive stripping
      if (debugStrippedStats.size > 40 * 1024 * 1024) { // 40MB threshold
        const aggressivePath = path.join(tempDir, 'node-aggressive');
        await fs.copyFile(originalBinaryPath, aggressivePath);
        await this.executeCommand('strip', ['--strip-all', aggressivePath]);

        const aggressiveStats = await fs.stat(aggressivePath);

        // Use aggressive version if significantly better
        if (aggressiveStats.size < debugStrippedStats.size * 0.9) {
          await fs.copyFile(aggressivePath, optimizedBinaryPath);

          this.logger.info('Aggressive stripping applied', {
            debugStrippedSize: debugStrippedStats.size,
            aggressiveSize: aggressiveStats.size,
            additionalReduction: debugStrippedStats.size - aggressiveStats.size,
          });
        }
      }

      return optimizedBinaryPath;

    } catch (stripError) {
      this.logger.warn('Strip optimization failed, using original binary', {
        error: stripError instanceof Error ? stripError.message : String(stripError),
      });
      return originalBinaryPath;
    }
  }

  /**
   * Attempts UPX compression optimization.
   *
   * @param binaryPath - Path to binary to compress
   * @param tempDir - Working directory
   * @returns Path to compressed binary or null if UPX unavailable/fails
   */
  private async tryUPXOptimization(binaryPath: string, tempDir: string): Promise<string | null> {
    try {
      // Verify UPX availability
      await this.executeCommand('upx', ['--version']);

      const upxPath = path.join(tempDir, 'node-upx');
      await fs.copyFile(binaryPath, upxPath);

      const beforeStats = await fs.stat(upxPath);

      // Apply maximum UPX compression
      await this.executeCommand('upx', ['--best', '--lzma', upxPath]);

      const afterStats = await fs.stat(upxPath);
      const reduction = beforeStats.size - afterStats.size;
      const reductionPercent = ((reduction / beforeStats.size) * 100).toFixed(1);

      this.logger.info('UPX compression successful', {
        beforeSize: beforeStats.size,
        afterSize: afterStats.size,
        reduction,
        reductionPercent: reductionPercent + '%',
        beforeSizeMB: (beforeStats.size / (1024 * 1024)).toFixed(2),
        afterSizeMB: (afterStats.size / (1024 * 1024)).toFixed(2),
      });

      // Verify compressed binary functionality (with fallback)
      const verificationResult = await this.verifyNodeBinaryWithFallback(upxPath);

      if (!verificationResult.success) {
        this.logger.warn('UPX compressed binary failed verification, discarding', {
          error: verificationResult.error,
        });
        return null;
      }

      return upxPath;

    } catch (upxError) {
      this.logger.debug('UPX optimization unavailable or failed', {
        error: upxError instanceof Error ? upxError.message : String(upxError),
      });
      return null;
    }
  }

  /**
   * Attempts to use system Node.js binary as replacement.
   *
   * @param tempDir - Working directory
   * @returns Path to system Node.js copy or null if unavailable/unsuitable
   */
  private async trySystemNodeReplacement(tempDir: string): Promise<string | null> {
    try {
      // Locate system Node.js binary
      const nodeWhichResult = await this.executeCommandWithOutput('which', ['node']);
      const systemNodePath = nodeWhichResult.stdout.trim();

      if (!systemNodePath) {
        this.logger.debug('System Node.js not found');
        return null;
      }

      // Check system Node.js properties
      const versionResult = await this.executeCommandWithOutput(systemNodePath, ['--version']);
      const systemVersion = versionResult.stdout.trim();
      const systemStats = await fs.stat(systemNodePath);

      this.logger.info('Found system Node.js binary', {
        path: systemNodePath,
        version: systemVersion,
        size: systemStats.size,
        sizeMB: (systemStats.size / (1024 * 1024)).toFixed(2),
      });

      // Only use if significantly smaller than threshold
      if (systemStats.size < 60 * 1024 * 1024) { // 60MB threshold
        const systemCopyPath = path.join(tempDir, 'node-system');
        await fs.copyFile(systemNodePath, systemCopyPath);
        await fs.chmod(systemCopyPath, 0o755);

        // Verify functionality (with fallback)
        const verificationResult = await this.verifyNodeBinaryWithFallback(systemCopyPath);

        if (!verificationResult.success) {
          this.logger.warn('System Node.js binary failed verification', {
            error: verificationResult.error,
          });
          return null;
        }

        this.logger.info('System Node.js binary suitable as replacement', {
          systemVersion,
          systemSize: systemStats.size,
          systemSizeMB: (systemStats.size / (1024 * 1024)).toFixed(2),
        });

        return systemCopyPath;
      } else {
        this.logger.debug('System Node.js binary too large', {
          systemSize: systemStats.size,
          systemSizeMB: (systemStats.size / (1024 * 1024)).toFixed(2),
          threshold: '60MB',
        });
        return null;
      }

    } catch (systemError) {
      this.logger.debug('System Node.js replacement unavailable', {
        error: systemError instanceof Error ? systemError.message : String(systemError),
      });
      return null;
    }
  }

  /**
   * Verifies that a Node.js binary is functional after optimization.
   *
   * Runs basic Node.js commands to ensure the binary works correctly.
   * This prevents shipping broken binaries after optimization.
   *
   * @param binaryPath - Path to the Node.js binary to verify
   * @throws Error if verification fails
   */
  private async verifyNodeBinary(binaryPath: string): Promise<void> {
    this.logger.debug('Verifying Node.js binary functionality', { binaryPath });

    try {
      // Test 1: Check version (basic functionality)
      const versionResult = await this.executeCommandWithOutput(binaryPath, ['--version']);

      if (!versionResult.stdout.trim().startsWith('v')) {
        throw new Error(`Invalid version output: ${versionResult.stdout}`);
      }

      // Test 2: Execute simple JavaScript (runtime functionality)
      const jsResult = await this.executeCommandWithOutput(binaryPath, ['-e', 'console.log("test")']);

      if (jsResult.stdout.trim() !== 'test') {
        throw new Error(`JavaScript execution failed: ${jsResult.stdout}`);
      }

      this.logger.debug('Node.js binary verification successful', {
        version: versionResult.stdout.trim(),
        jsExecution: 'passed',
      });

    } catch (error) {
      throw new Error(`Node.js binary verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Verifies Node.js binary with graceful fallback for spawn errors.
   *
   * This method attempts full verification but falls back to basic checks
   * if spawn fails (e.g., error -8). This prevents blocking deployment for
   * binaries that are valid but fail verification due to system issues.
   *
   * @param binaryPath - Path to the Node.js binary to verify
   * @returns Promise resolving to verification result with success flag and optional error
   */
  private async verifyNodeBinaryWithFallback(binaryPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Attempt full verification
      await this.verifyNodeBinary(binaryPath);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if this is a spawn error (error -8 or similar)
      if (errorMessage.includes('spawn') || errorMessage.includes('error -8')) {
        this.logger.warn('Binary verification failed with spawn error, performing fallback checks', {
          binaryPath,
          error: errorMessage,
        });

        try {
          // Fallback: Check if binary exists and has reasonable size
          const stats = await fs.stat(binaryPath);

          if (!stats.isFile()) {
            return { success: false, error: 'Binary is not a file' };
          }

          if (stats.size < 1024 * 1024) { // Less than 1MB is suspicious
            return { success: false, error: `Binary too small: ${stats.size} bytes` };
          }

          if (stats.size > 250 * 1024 * 1024) { // More than 250MB exceeds limit
            return { success: false, error: `Binary too large: ${(stats.size / (1024 * 1024)).toFixed(2)}MB` };
          }

          // Binary exists and has reasonable size - accept it
          this.logger.info('Binary passed fallback verification (size check)', {
            binaryPath,
            size: stats.size,
            sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
          });

          return { success: true };
        } catch (fallbackError) {
          return {
            success: false,
            error: `Fallback verification failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
          };
        }
      }

      // Non-spawn error - return failure
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Creates the proper Lambda Layer directory structure.
   *
   * Lambda Layers for Node.js binary should use minimal structure:
   * - bin/node (uncompressed binary)
   * - bin/node.gz (compressed binary with decompression script)
   *
   * @param tempDir - Base temporary directory
   * @param nodeBinaryPath - Path to the Node.js binary (may be compressed)
   * @returns Promise resolving to the layer directory path
   * @throws Error if directory creation fails
   */
  private async createLayerDirectoryStructure(tempDir: string, nodeBinaryPath: string): Promise<string> {
    this.logger.debug('Creating minimal Lambda Layer directory structure', {
      tempDir,
      nodeBinaryPath,
    });

    // Create minimal layer directory structure: bin/node (not /opt/nodejs/bin/)
    const layerDir = path.join(tempDir, 'layer');
    const binDir = path.join(layerDir, 'bin');

    await fs.mkdir(binDir, { recursive: true });

    // Check if binary is compressed
    const isCompressed = nodeBinaryPath.endsWith('.gz');

    if (isCompressed) {
      // For compressed binary: decompress and place as 'node'
      const targetBinaryPath = path.join(binDir, 'node');

      // Decompress using shell redirection
      await this.executeCommand('sh', [
        '-c',
        `gunzip -c "${nodeBinaryPath}" > "${targetBinaryPath}"`,
      ]);

      // Alternative: use shell redirection
      await this.executeCommand('sh', [
        '-c',
        `gunzip -c "${nodeBinaryPath}" > "${targetBinaryPath}"`,
      ]);

      // Ensure the binary is executable
      await fs.chmod(targetBinaryPath, 0o755);

      this.logger.debug('Decompressed binary for layer structure', {
        compressedPath: nodeBinaryPath,
        targetPath: targetBinaryPath,
        structure: 'bin/node (decompressed)',
      });
    } else {
      // For uncompressed binary: copy directly
      const targetBinaryPath = path.join(binDir, 'node');
      await fs.copyFile(nodeBinaryPath, targetBinaryPath);

      // Ensure the binary is executable
      await fs.chmod(targetBinaryPath, 0o755);

      this.logger.debug('Copied uncompressed binary for layer structure', {
        sourcePath: nodeBinaryPath,
        targetPath: targetBinaryPath,
        structure: 'bin/node (direct copy)',
      });
    }

    return layerDir;
  }

  /**
   * Creates a ZIP archive of the layer contents with compression optimization.
   *
   * Uses Python's zipfile module to create a properly compressed ZIP file with
   * file permissions preserved for the Node.js binary. Implements compression
   * optimization to minimize storage and transfer costs.
   *
   * @param layerDir - Directory containing the layer contents
   * @param layerName - Name of the layer (used for ZIP filename)
   * @returns Promise resolving to the ZIP file path
   * @throws Error if ZIP creation fails
   */
  private async createLayerZipArchive(layerDir: string, layerName: string): Promise<string> {
    const timer = new OperationTimer(this.logger, 'layer ZIP creation with optimization', {
      layerDir,
      layerName,
    });

    const zipFilePath = path.join(path.dirname(layerDir), `${layerName}.zip`);

    try {
      this.logger.info('Starting optimized ZIP creation', {
        layerDir,
        layerName,
        zipFilePath,
      });

      // Calculate original directory size for optimization metrics
      const originalSize = await this.calculateDirectorySize(layerDir);

      // Use Python's zipfile module with streaming for large files
      await this.executeCommand('python3', [
        '-c',
        `
import zipfile
import os
import sys
import time

def create_optimized_zip(source_dir, zip_path):
    start_time = time.time()
    total_original_size = 0
    file_count = 0
    
    # Use maximum compression level with streaming
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zipf:
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                file_path = os.path.join(root, file)
                arc_name = os.path.relpath(file_path, source_dir)
                
                # Get file size for metrics
                stat_info = os.stat(file_path)
                total_original_size += stat_info.st_size
                
                # Use write() instead of writestr() for streaming large files
                # This avoids loading entire file into memory
                zipf.write(file_path, arc_name, compress_type=zipfile.ZIP_DEFLATED)
                file_count += 1
                
                # Print progress for large files
                if stat_info.st_size > 10 * 1024 * 1024:  # >10MB
                    print(f"Compressed: {arc_name} ({stat_info.st_size / (1024*1024):.1f}MB)", file=sys.stderr)
    
    # Calculate final compressed size
    final_size = os.path.getsize(zip_path)
    compression_ratio = ((total_original_size - final_size) / total_original_size * 100) if total_original_size > 0 else 0
    duration = time.time() - start_time
    
    print(f"OPTIMIZATION_METRICS:")
    print(f"original_size={total_original_size}")
    print(f"compressed_size={final_size}")
    print(f"compression_ratio={compression_ratio:.1f}")
    print(f"file_count={file_count}")
    print(f"duration={duration:.2f}")

create_optimized_zip('${layerDir}', '${zipFilePath}')
                `.trim(),
      ]);

      // Parse optimization metrics from Python output
      const stats = await fs.stat(zipFilePath);
      const finalSize = stats.size;

      // Log compression results
      const compressionRatio = originalSize > 0 ? ((originalSize - finalSize) / originalSize * 100) : 0;

      this.logger.info('ZIP creation with compression optimization completed', {
        zipFilePath,
        originalSize,
        compressedSize: finalSize,
        compressionRatio: compressionRatio.toFixed(1) + '%',
        spaceSaved: originalSize - finalSize,
        spaceSavedMB: ((originalSize - finalSize) / (1024 * 1024)).toFixed(2),
        finalSizeMB: (finalSize / (1024 * 1024)).toFixed(2),
      });

      timer.complete({
        zipFilePath,
        originalSize,
        compressedSize: finalSize,
        compressionRatio: compressionRatio.toFixed(1) + '%',
        optimizationSuccess: true,
      });

      return zipFilePath;

    } catch (error) {
      timer.fail(error, { layerDir, layerName });

      // Fallback to simpler approach if Python optimization fails
      this.logger.warn('Optimized ZIP creation failed, trying fallback approach', {
        error: error instanceof Error ? error.message : String(error),
      });

      return this.createZipFallback(layerDir, zipFilePath);
    }
  }

  /**
   * Calculates the total size of all files in a directory.
   *
   * @param dirPath - Directory path to analyze
   * @returns Promise resolving to total size in bytes
   */
  private async calculateDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });

      for (const item of items) {
        const itemPath = path.join(dirPath, item.name);

        if (item.isFile()) {
          const stats = await fs.stat(itemPath);
          totalSize += stats.size;
        } else if (item.isDirectory()) {
          totalSize += await this.calculateDirectorySize(itemPath);
        }
      }
    } catch (error) {
      this.logger.warn('Failed to calculate directory size', {
        dirPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return totalSize;
  }

  /**
   * Fallback ZIP creation using system zip command with streaming.
   *
   * This method uses the system 'zip' command which handles large files
   * efficiently without loading them into memory.
   *
   * @param layerDir - Directory containing the layer contents
   * @param zipFilePath - Target ZIP file path
   * @returns Promise resolving to the ZIP file path
   * @throws Error if ZIP creation fails
   */
  private async createZipFallback(layerDir: string, zipFilePath: string): Promise<string> {
    this.logger.info('Using fallback ZIP creation with system zip command', {
      layerDir,
      zipFilePath,
    });

    try {
      // Use system zip command with maximum compression
      // -r: recursive, -9: maximum compression, -q: quiet
      await this.executeCommand('zip', [
        '-r',
        '-9', // Maximum compression
        '-q', // Quiet mode
        zipFilePath,
        '.',
      ], { cwd: layerDir });

      const stats = await fs.stat(zipFilePath);
      this.logger.info('Created ZIP archive with fallback method', {
        zipFilePath,
        size: stats.size,
        sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
      });

      return zipFilePath;

    } catch (error) {
      throw new Error(
        `Failed to create ZIP archive with both Python and system zip methods: ` +
        `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validates that the layer ZIP file meets AWS size limits.
   *
   * AWS Lambda has strict size limits for layers:
   * - 50MB for zipped layer
   * - 250MB for unzipped layer
   *
   * Enhanced to check both zipped and unzipped sizes with comprehensive
   * error reporting and optimization suggestions.
   *
   * @param zipFilePath - Path to the ZIP file
   * @throws NodeRuntimeLayerError if size limits are exceeded
   */
  private async preValidateLayerContent(layerDir: string): Promise<void> {
    const timer = new OperationTimer(this.logger, 'layer content pre-validation', { layerDir });

    try {
      const totalSize = await this.calculateDirectorySize(layerDir);

      // AWS Lambda Layer limits
      const conservativeLimit = 50 * 1024 * 1024;  // 50MB uncompressed (optimal for optimized binaries)
      const awsAbsoluteLimit = 250 * 1024 * 1024;  // 250MB absolute AWS limit for uncompressed layers

      if (totalSize > awsAbsoluteLimit) {
        timer.fail(new Error('Layer content exceeds AWS absolute limit'), { totalSize, awsAbsoluteLimit });
        throw new NodeRuntimeLayerError(
          `Layer content size (${Math.round(totalSize / 1024 / 1024)}MB) exceeds AWS Lambda layer limit (250MB). ` +
          'This indicates Node.js binary optimization failed completely. ' +
          'Expected optimized Node.js binary size: 15-25MB. ' +
          'Current size suggests debug symbols were not stripped properly. ' +
          'Please verify strip command is available and Docker image is correct.',
          ErrorCodes.LAYER_SIZE_EXCEEDED,
        );
      }

      if (totalSize > conservativeLimit) {
        this.logger.warn('Layer content size exceeds optimal size but within AWS limits', {
          totalSize,
          totalSizeMB: Math.round(totalSize / 1024 / 1024),
          conservativeLimitMB: Math.round(conservativeLimit / 1024 / 1024),
          awsAbsoluteLimitMB: Math.round(awsAbsoluteLimit / 1024 / 1024),
          warning: 'Binary optimization may not be optimal - expected ~15-25MB for optimized Node.js binary',
          recommendation: 'Check if strip command worked correctly. Layer will still deploy but may be slower.',
        });
      }

      timer.complete({
        totalSize,
        status: totalSize > conservativeLimit ? 'warning_large_size' : 'within_limits',
        sizeMB: Math.round(totalSize / 1024 / 1024),
      });

      this.logger.debug('Layer content pre-validation completed', {
        totalSize,
        totalSizeMB: Math.round(totalSize / 1024 / 1024),
        conservativeLimitMB: Math.round(conservativeLimit / 1024 / 1024),
        awsAbsoluteLimitMB: Math.round(awsAbsoluteLimit / 1024 / 1024),
        status: totalSize > conservativeLimit ? 'large_but_acceptable' : 'optimal_size',
      });

    } catch (error) {
      if (error instanceof NodeRuntimeLayerError) {
        throw error;
      }
      timer.fail(error, { layerDir });
      throw new NodeRuntimeLayerError(
        `Failed to pre-validate layer content: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCodes.LAYER_CREATION_FAILED,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Validates layer size limits after ZIP creation.
   *
   * @param zipFilePath - Path to the ZIP file
   * @throws NodeRuntimeLayerError if size limits are exceeded
   */
  private async validateLayerSize(zipFilePath: string): Promise<void> {
    const timer = new OperationTimer(this.logger, 'layer size validation', { zipFilePath });

    try {
      const stats = await fs.stat(zipFilePath);
      const zipSize = stats.size;

      this.logger.info('Starting layer size validation', {
        zipFilePath,
        zipSize,
        zipSizeMB: (zipSize / (1024 * 1024)).toFixed(2),
        maxZipSize: AWSLayerManager.MAX_LAYER_SIZE_ZIPPED,
        maxZipSizeMB: (AWSLayerManager.MAX_LAYER_SIZE_ZIPPED / (1024 * 1024)).toFixed(2),
      });

      // Check zipped size first
      if (zipSize > AWSLayerManager.MAX_LAYER_SIZE_ZIPPED) {
        const sizeMB = (zipSize / (1024 * 1024)).toFixed(2);
        const limitMB = (AWSLayerManager.MAX_LAYER_SIZE_ZIPPED / (1024 * 1024)).toFixed(2);

        throw new NodeRuntimeLayerError(
          `Layer ZIP file size (${sizeMB} MB) exceeds AWS Lambda limit (${limitMB} MB). ` +
          `Consider optimizing the layer contents or splitting into multiple layers. ` +
          `Current size: ${zipSize} bytes, Limit: ${AWSLayerManager.MAX_LAYER_SIZE_ZIPPED} bytes.`,
          ErrorCodes.LAYER_SIZE_EXCEEDED,
        );
      }

      // Check unzipped size by examining ZIP contents
      const unzippedSize = await this.calculateUnzippedSize(zipFilePath);

      this.logger.debug('Layer size analysis', {
        zipSize,
        unzippedSize,
        compressionRatio: ((1 - zipSize / unzippedSize) * 100).toFixed(1) + '%',
        zipSizeMB: (zipSize / (1024 * 1024)).toFixed(2),
        unzippedSizeMB: (unzippedSize / (1024 * 1024)).toFixed(2),
      });

      if (unzippedSize > AWSLayerManager.MAX_LAYER_SIZE_UNZIPPED) {
        const sizeMB = (unzippedSize / (1024 * 1024)).toFixed(2);
        const limitMB = (AWSLayerManager.MAX_LAYER_SIZE_UNZIPPED / (1024 * 1024)).toFixed(2);

        throw new NodeRuntimeLayerError(
          `Layer unzipped size (${sizeMB} MB) exceeds AWS Lambda limit (${limitMB} MB). ` +
          `The layer contents are too large when extracted. Consider removing unnecessary files ` +
          `or splitting functionality across multiple layers. ` +
          `Current unzipped size: ${unzippedSize} bytes, Limit: ${AWSLayerManager.MAX_LAYER_SIZE_UNZIPPED} bytes.`,
          ErrorCodes.LAYER_SIZE_EXCEEDED,
        );
      }

      // Log success with optimization metrics
      const compressionRatio = ((1 - zipSize / unzippedSize) * 100).toFixed(1);
      this.logger.info('Layer size validation passed', {
        zipSize,
        unzippedSize,
        compressionRatio: compressionRatio + '%',
        zipUtilization: ((zipSize / AWSLayerManager.MAX_LAYER_SIZE_ZIPPED) * 100).toFixed(1) + '%',
        unzippedUtilization: ((unzippedSize / AWSLayerManager.MAX_LAYER_SIZE_UNZIPPED) * 100).toFixed(1) + '%',
      });

      timer.complete({
        zipSize,
        unzippedSize,
        compressionRatio,
        validationPassed: true,
      });

    } catch (error) {
      timer.fail(error, { zipFilePath });
      throw error;
    }
  }

  /**
   * Calculates the unzipped size of a ZIP file by examining its contents.
   *
   * Uses Python's zipfile module to read ZIP metadata and calculate
   * the total uncompressed size without extracting files.
   *
   * @param zipFilePath - Path to the ZIP file
   * @returns Promise resolving to unzipped size in bytes
   * @throws Error if size calculation fails
   */
  private async calculateUnzippedSize(zipFilePath: string): Promise<number> {
    try {
      // Use Python to calculate unzipped size efficiently
      const result = await this.executeCommandWithOutput('python3', [
        '-c',
        `
import zipfile
import sys

try:
    total_size = 0
    with zipfile.ZipFile('${zipFilePath}', 'r') as zipf:
        for info in zipf.infolist():
            if not info.is_dir():
                total_size += info.file_size
    print(total_size)
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
                `.trim(),
      ]);

      const unzippedSize = parseInt(result.stdout.trim(), 10);
      if (isNaN(unzippedSize)) {
        throw new Error(`Invalid unzipped size calculation result: ${result.stdout}`);
      }

      return unzippedSize;

    } catch (error) {
      this.logger.warn('Failed to calculate unzipped size with Python, using fallback estimation', {
        zipFilePath,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback: estimate based on typical compression ratios for binaries
      const stats = await fs.stat(zipFilePath);
      const estimatedUnzippedSize = stats.size * 2; // Conservative estimate for binary compression

      this.logger.debug('Using fallback unzipped size estimation', {
        zipSize: stats.size,
        estimatedUnzippedSize,
        estimationMethod: 'conservative_binary_ratio',
      });

      return estimatedUnzippedSize;
    }
  }

  /**
   * Publishes the layer to AWS Lambda.
   *
   * Uses the AWS SDK v3 Lambda client to publish the layer with proper
   * metadata including compatible runtimes and architectures.
   *
   * @param options - Layer creation options
   * @param zipFilePath - Path to the ZIP file
   * @returns Promise resolving to LayerInfo
   * @throws NodeRuntimeLayerError if publishing fails
   */
  private async publishLayerToAWS(options: LayerCreationOptions, zipFilePath: string): Promise<LayerInfo> {
    this.logger.debug('Publishing layer to AWS Lambda', {
      layerName: options.layerName,
      zipFilePath,
    });

    try {
      // Read the ZIP file
      const zipContent = await fs.readFile(zipFilePath);

      // Create layer description
      const description = options.description ||
        `Node.js ${options.nodeVersion} runtime binary for Lambda Kata (${options.architecture})`;

      // Publish the layer
      const command = new PublishLayerVersionCommand({
        LayerName: options.layerName,
        Description: description,
        Content: {
          ZipFile: zipContent,
        },
        CompatibleRuntimes: ['python3.12'], // Lambda Kata uses Python runtime
        CompatibleArchitectures: [options.architecture],
        LicenseInfo: 'Apache-2.0',
      });

      const response = await this.executeWithRetry(() => this.lambdaClient.send(command));

      if (!response.LayerVersionArn || !response.Version || !response.CreatedDate) {
        throw new Error('Invalid response from PublishLayerVersion: missing required fields');
      }

      const layerInfo: LayerInfo = {
        arn: response.LayerVersionArn,
        name: options.layerName,
        version: response.Version,
        nodeVersion: options.nodeVersion,
        architecture: options.architecture,
        createdDate: new Date(response.CreatedDate),
      };

      this.logger.info('Successfully published layer to AWS', {
        layerArn: layerInfo.arn,
        version: layerInfo.version,
        size: zipContent.length,
      });

      return layerInfo;

    } catch (error) {
      throw new NodeRuntimeLayerError(
        `Failed to publish layer to AWS: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCodes.AWS_API_ERROR,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Executes a Docker command with timeout and error handling.
   *
   * @param args - Docker command arguments
   * @returns Promise that resolves when command completes successfully
   * @throws Error if command fails
   */
  private async executeDockerCommand(args: string[]): Promise<void> {
    return this.executeCommand('docker', args);
  }

  /**
   * Executes a system command with timeout and error handling, capturing output.
   *
   * @param command - Command to execute
   * @param args - Command arguments
   * @param options - Execution options including working directory
   * @returns Promise resolving to command output (stdout and stderr)
   * @throws Error if command fails
   */
  private async executeCommandWithOutput(command: string, args: string[], options?: { cwd?: string }): Promise<{
    stdout: string;
    stderr: string
  }> {
    this.logger.debug('Executing command with output capture', { command, args, options });

    return new Promise((resolve, reject) => {
      const process = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: options?.cwd,
      });

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        process.kill('SIGTERM');
        reject(new Error(`Command timeout after ${AWSLayerManager.DOCKER_TIMEOUT}ms: ${command} ${args.join(' ')}`));
      }, AWSLayerManager.DOCKER_TIMEOUT);

      process.on('close', (code) => {
        clearTimeout(timeout);

        if (code === 0) {
          this.logger.debug('Command executed successfully with output', {
            command,
            args,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          });
          resolve({ stdout, stderr });
        } else {
          const errorMessage = stderr.trim() || stdout.trim() || `Command failed with exit code ${code}`;
          this.logger.error('Command execution failed', {
            command,
            args,
            exitCode: code,
            stderr: stderr.trim(),
            stdout: stdout.trim(),
          });
          reject(new Error(errorMessage));
        }
      });

      process.on('error', (error) => {
        clearTimeout(timeout);
        this.logger.error('Command process error', {
          command,
          args,
          error: error.message,
        });
        reject(error);
      });
    });
  }

  /**
   * Executes a system command with timeout and error handling.
   *
   * Enhanced with EPIPE error handling to prevent broken pipe errors
   * when child process terminates unexpectedly.
   *
   * @param command - Command to execute
   * @param args - Command arguments
   * @param options - Execution options including working directory
   * @returns Promise that resolves when command completes successfully
   * @throws Error if command fails
   */
  private async executeCommand(command: string, args: string[], options?: { cwd?: string }): Promise<void> {
    this.logger.debug('Executing command', { command, args, options });

    return new Promise((resolve, reject) => {
      const childProcess = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: options?.cwd,
      });

      let stdout = '';
      let stderr = '';
      let processExited = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      // Handle EPIPE errors on stdout/stderr streams
      const handleStreamError = (streamName: string) => (error: Error) => {
        // EPIPE is expected when process exits early - don't treat as fatal
        if ((error as any).code === 'EPIPE') {
          this.logger.debug(`${streamName} stream closed (EPIPE) - process likely exited`, {
            command,
            processExited,
          });
          return; // Ignore EPIPE - wait for 'close' event
        }

        // Other stream errors are unexpected
        this.logger.warn(`${streamName} stream error`, {
          command,
          error: error.message,
          code: (error as any).code,
        });
      };

      // Attach error handlers to prevent unhandled EPIPE
      if (childProcess.stdout) {
        childProcess.stdout.on('error', handleStreamError('stdout'));
        childProcess.stdout.on('data', (data) => {
          if (!processExited) {
            stdout += data.toString();
          }
        });
      }

      if (childProcess.stderr) {
        childProcess.stderr.on('error', handleStreamError('stderr'));
        childProcess.stderr.on('data', (data) => {
          if (!processExited) {
            stderr += data.toString();
          }
        });
      }

      // Set timeout for long-running commands
      timeoutHandle = setTimeout(() => {
        if (!processExited) {
          processExited = true;
          childProcess.kill('SIGTERM');

          // Give process 2 seconds to terminate gracefully
          setTimeout(() => {
            if (!childProcess.killed) {
              childProcess.kill('SIGKILL');
            }
          }, 2000);

          reject(new Error(
            `Command timeout after ${AWSLayerManager.DOCKER_TIMEOUT}ms: ${command} ${args.join(' ')}\n` +
            `stdout: ${stdout.trim()}\nstderr: ${stderr.trim()}`
          ));
        }
      }, AWSLayerManager.DOCKER_TIMEOUT);

      // Handle process completion
      childProcess.on('close', (code, signal) => {
        if (processExited) return; // Already handled by timeout or error
        processExited = true;

        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        if (code === 0) {
          this.logger.debug('Command executed successfully', {
            command,
            args,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          });
          resolve();
        } else {
          const errorMessage = stderr.trim() || stdout.trim() ||
            `Command failed with exit code ${code}${signal ? ` (signal: ${signal})` : ''}`;

          this.logger.error('Command execution failed', {
            command,
            args,
            exitCode: code,
            signal,
            stderr: stderr.trim().substring(0, 500), // Limit log size
            stdout: stdout.trim().substring(0, 500),
          });

          reject(new Error(errorMessage));
        }
      });

      // Handle process spawn errors
      childProcess.on('error', (error) => {
        if (processExited) return;
        processExited = true;

        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        this.logger.error('Command process error', {
          command,
          args,
          error: error.message,
          code: (error as any).code,
        });

        reject(error);
      });
    });
  }

  /**
   * Legacy cleanup method for backward compatibility.
   *
   * @deprecated Use performComprehensiveCleanup with ResourceTracker instead
   * @param tempDir - Temporary directory to remove (if exists)
   * @param zipFilePath - ZIP file to remove (if exists)
   */
  private async cleanupTempResources(tempDir: string | null, zipFilePath: string | null): Promise<void> {
    const resourceTracker = new LayerCreationResourceTracker(this.logger);

    if (tempDir) {
      resourceTracker.addTempDirectory(tempDir);
    }
    if (zipFilePath) {
      resourceTracker.addZipFile(zipFilePath);
    }

    await this.performComprehensiveCleanup(resourceTracker);
  }

  /**
   * Legacy Docker extraction method for backward compatibility.
   *
   * @deprecated Use extractNodeBinaryFromDockerWithTracking instead
   */
  private async extractNodeBinaryFromDocker(
    nodeVersion: string,
    architecture: string,
    tempDir: string,
  ): Promise<string> {
    const resourceTracker = new LayerCreationResourceTracker(this.logger);
    return this.extractNodeBinaryFromDockerWithTracking(nodeVersion, architecture, tempDir, resourceTracker);
  }

  /**
   * Creates an enhanced error with cleanup context preservation.
   *
   * Preserves the original error while adding context about the layer creation
   * operation that failed. This maintains debugging capability while providing
   * additional context for troubleshooting.
   *
   * @param originalError - The original error that occurred
   * @param options - Layer creation options for context
   * @returns Enhanced NodeRuntimeLayerError with preserved context
   */
  private createEnhancedError(originalError: unknown, options: LayerCreationOptions): NodeRuntimeLayerError {
    const errorMessage = originalError instanceof Error ? originalError.message : String(originalError);
    const errorCause = originalError instanceof Error ? originalError : new Error(String(originalError));

    // Always enhance with layer context, even if it's already a NodeRuntimeLayerError
    const enhancedMessage = `Failed to create Node.js layer '${options.layerName}' (${options.nodeVersion}, ${options.architecture}): ${errorMessage}`;

    return new NodeRuntimeLayerError(
      enhancedMessage,
      ErrorCodes.LAYER_CREATION_FAILED,
      errorCause,
    );
  }

  /**
   * Performs comprehensive cleanup of all tracked resources.
   *
   * Cleans up Docker containers, temporary directories, and ZIP files.
   * Cleanup failures are logged as warnings but do not prevent the cleanup
   * of other resources or mask the original error.
   *
   * @param resourceTracker - Tracker containing all resources to clean up
   */
  private async performComprehensiveCleanup(resourceTracker: LayerCreationResourceTracker): Promise<void> {
    const resources = resourceTracker.getAllResources();
    const cleanupResults = {
      dockerContainers: { success: 0, failed: 0 },
      tempDirectories: { success: 0, failed: 0 },
      zipFiles: { success: 0, failed: 0 },
    };

    this.logger.debug('Starting comprehensive resource cleanup', {
      dockerContainers: resources.dockerContainers.length,
      tempDirectories: resources.tempDirectories.length,
      zipFiles: resources.zipFiles.length,
    });

    // Clean up Docker containers first (they may hold file locks)
    for (const containerName of resources.dockerContainers) {
      try {
        await this.executeDockerCommand(['rm', '-f', containerName]);
        cleanupResults.dockerContainers.success++;
        this.logger.debug('Successfully cleaned up Docker container', { containerName });
      } catch (error) {
        cleanupResults.dockerContainers.failed++;
        this.logger.warn('Failed to clean up Docker container', {
          containerName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Clean up ZIP files
    for (const zipFilePath of resources.zipFiles) {
      try {
        await fs.unlink(zipFilePath);
        cleanupResults.zipFiles.success++;
        this.logger.debug('Successfully cleaned up ZIP file', { zipFilePath });
      } catch (error) {
        cleanupResults.zipFiles.failed++;
        this.logger.warn('Failed to clean up ZIP file', {
          zipFilePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Clean up temporary directories last (they may contain other resources)
    for (const tempDir of resources.tempDirectories) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        cleanupResults.tempDirectories.success++;
        this.logger.debug('Successfully cleaned up temp directory', { tempDir });
      } catch (error) {
        cleanupResults.tempDirectories.failed++;
        this.logger.warn('Failed to clean up temp directory', {
          tempDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Log cleanup summary
    const totalSuccess = cleanupResults.dockerContainers.success +
      cleanupResults.tempDirectories.success +
      cleanupResults.zipFiles.success;
    const totalFailed = cleanupResults.dockerContainers.failed +
      cleanupResults.tempDirectories.failed +
      cleanupResults.zipFiles.failed;

    this.logger.info('Resource cleanup completed', {
      totalSuccess,
      totalFailed,
      details: cleanupResults,
    });

    // Clear the resource tracker
    resourceTracker.clear();
  }
}

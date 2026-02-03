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
    LambdaClient,
    LambdaClientConfig,
    ListLayersCommand,
    ListLayerVersionsCommand,
    PublishLayerVersionCommand,
    GetLayerVersionCommand,
    LayerVersionsListItem,
    LayersListItem,
    paginateListLayers,
    paginateListLayerVersions,
} from '@aws-sdk/client-lambda';
import { spawn } from 'child_process';
import { createWriteStream, createReadStream, promises as fs } from 'fs';
import { join, dirname } from 'path';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import * as os from 'os';
import * as path from 'path';

import {
    LayerManager,
    LayerInfo,
    LayerSearchOptions,
    LayerRequirements,
    LayerCreationOptions,
    NodeRuntimeLayerError,
    ErrorCodes,
    Logger,
    LayerMetadata,
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
        private readonly logger: Logger
    ) { }

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
                    timeout: this.timeout
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
                    successThreshold: this.successThreshold
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
                failureCount: this.failureCount
            });
        } else if (this.failureCount >= this.failureThreshold) {
            this.state = CircuitBreakerState.OPEN;
            this.logger.warn('Circuit breaker OPEN after exceeding failure threshold', {
                failureCount: this.failureCount,
                failureThreshold: this.failureThreshold
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
            successCount: this.successCount
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
    private static readonly MAX_LAYER_SIZE_ZIPPED = 50 * 1024 * 1024;    // 50MB

    /**
     * Docker operation timeout in milliseconds.
     */
    private static readonly DOCKER_TIMEOUT = 300000; // 5 minutes

    constructor(options: AWSLayerManagerOptions = {}) {
        this.lambdaClient = new LambdaClient(options.awsSdkConfig ?? {});
        this.logger = options.logger ?? createDefaultLogger();
        this.maxLayerAge = options.maxLayerAge ?? 604800000; // 7 days default
        this.maxRetries = options.maxRetries ?? 3;
        this.retryBaseDelay = options.retryBaseDelay ?? 1000; // 1 second default

        // Initialize circuit breaker
        this.circuitBreaker = new CircuitBreaker(
            options.circuitBreakerFailureThreshold ?? 5,
            options.circuitBreakerTimeout ?? 60000, // 1 minute
            options.circuitBreakerSuccessThreshold ?? 2,
            this.logger
        );

        this.logger.debug('AWSLayerManager initialized', {
            region: options.awsSdkConfig?.region,
            maxLayerAge: this.maxLayerAge,
            maxRetries: this.maxRetries,
            retryBaseDelay: this.retryBaseDelay,
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
                            layerVersion: layerInfo.version
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
                layersChecked: layers.length
            });
            return null;
        } catch (error) {
            timer.fail(error, { layerName: options.layerName });
            throw new NodeRuntimeLayerError(
                `Failed to search for existing layer: ${error instanceof Error ? error.message : String(error)}`,
                ErrorCodes.AWS_API_ERROR,
                error instanceof Error ? error : new Error(String(error))
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
                resourceTracker
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
                            }
                        });
                        return null; // Success
                    }
                } catch (error) {
                    // Layer doesn't exist, fall back to pagination
                    this.logger.debug('Direct layer lookup failed, using pagination', {
                        layerName,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }

                // Fallback: Use pagination only if direct lookup failed
                const paginator = paginateListLayers(
                    { client: this.lambdaClient },
                    { MaxItems: 50 } // Limit pagination size
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
                layerName
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
        // Expected format: lambda-kata-nodejs-nodejs20.x-x86_64
        const nameMatch = layerName.match(/lambda-kata-nodejs-nodejs(\d+)\.x-(\w+)/);
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
            errorMessage.includes(retryableError)
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
            'ENETUNREACH'
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
            'connection refused'
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
        this.logger.debug('AWSLayerManager destroyed', {
            circuitBreakerState: this.circuitBreaker.getState(),
            clearedLocks: true,
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
     * Extracts Node.js binary from AWS Lambda Docker container with resource tracking.
     *
     * Enhanced version that tracks Docker containers for cleanup on failure.
     * Uses Docker to run the AWS Lambda runtime image and copy the Node.js
     * binary to the local filesystem for packaging in the layer.
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
        resourceTracker: LayerCreationResourceTracker
    ): Promise<string> {
        this.logger.debug('Extracting Node.js binary from Docker with tracking', {
            nodeVersion,
            architecture,
            tempDir,
        });

        // Build Docker image name
        const majorVersion = nodeVersion.split('.')[0];
        const dockerImage = `public.ecr.aws/lambda/nodejs:${majorVersion}-${architecture}`;

        // Create container and copy binary
        const containerName = `lambda-kata-extract-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const binaryPath = path.join(tempDir, 'node');

        try {
            // Pull the Docker image first
            await this.executeDockerCommand(['pull', dockerImage]);

            // Create container (don't start it, just create)
            await this.executeDockerCommand(['create', '--name', containerName, dockerImage]);

            // Track the container for cleanup
            resourceTracker.addDockerContainer(containerName);

            // Copy Node.js binary from container to local filesystem
            await this.executeDockerCommand(['cp', `${containerName}:/var/lang/bin/node`, binaryPath]);

            // Verify the binary was extracted and is executable
            const stats = await fs.stat(binaryPath);
            if (!stats.isFile()) {
                throw new Error('Extracted Node.js binary is not a file');
            }

            // Make sure the binary is executable
            await fs.chmod(binaryPath, 0o755);

            this.logger.debug('Successfully extracted Node.js binary', {
                binaryPath,
                size: stats.size,
                dockerImage,
                containerName,
            });

            return binaryPath;

        } catch (error) {
            throw new NodeRuntimeLayerError(
                `Failed to extract Node.js binary from Docker image ${dockerImage}: ${error instanceof Error ? error.message : String(error)}`,
                ErrorCodes.LAYER_CREATION_FAILED,
                error instanceof Error ? error : new Error(String(error))
            );
        }
        // Note: Container cleanup is handled by the resource tracker in the finally block
    }

    /**
     * Creates the proper Lambda Layer directory structure.
     *
     * Lambda Layers must follow a specific directory structure:
     * - /opt/nodejs/bin/ for Node.js binaries
     *
     * @param tempDir - Base temporary directory
     * @param nodeBinaryPath - Path to the Node.js binary
     * @returns Promise resolving to the layer directory path
     * @throws Error if directory creation fails
     */
    private async createLayerDirectoryStructure(tempDir: string, nodeBinaryPath: string): Promise<string> {
        this.logger.debug('Creating Lambda Layer directory structure', {
            tempDir,
            nodeBinaryPath,
        });

        // Create the layer directory structure: /opt/nodejs/bin/
        const layerDir = path.join(tempDir, 'layer');
        const optDir = path.join(layerDir, 'opt');
        const nodejsDir = path.join(optDir, 'nodejs');
        const binDir = path.join(nodejsDir, 'bin');

        await fs.mkdir(binDir, { recursive: true });

        // Copy Node.js binary to the correct location
        const targetBinaryPath = path.join(binDir, 'node');
        await fs.copyFile(nodeBinaryPath, targetBinaryPath);

        // Ensure the binary is executable
        await fs.chmod(targetBinaryPath, 0o755);

        this.logger.debug('Created Lambda Layer directory structure', {
            layerDir,
            targetBinaryPath,
        });

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

            // Use Python's zipfile module with maximum compression
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
    total_compressed_size = 0
    file_count = 0
    
    # Use maximum compression level
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zipf:
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                file_path = os.path.join(root, file)
                arc_name = os.path.relpath(file_path, source_dir)
                
                # Get file info and preserve permissions
                file_info = zipfile.ZipInfo(arc_name)
                stat_info = os.stat(file_path)
                file_info.external_attr = stat_info.st_mode << 16
                
                # Read and compress file content
                with open(file_path, 'rb') as f:
                    file_data = f.read()
                    total_original_size += len(file_data)
                    
                zipf.writestr(file_info, file_data)
                file_count += 1
    
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
                `.trim()
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
     * Fallback ZIP creation using system zip command.
     *
     * @param layerDir - Directory containing the layer contents
     * @param zipFilePath - Target ZIP file path
     * @returns Promise resolving to the ZIP file path
     * @throws Error if ZIP creation fails
     */
    private async createZipFallback(layerDir: string, zipFilePath: string): Promise<string> {
        this.logger.debug('Using fallback ZIP creation', {
            layerDir,
            zipFilePath,
        });

        try {
            // Use system zip command if available
            await this.executeCommand('zip', [
                '-r',
                zipFilePath,
                '.',
            ], { cwd: layerDir });

            const stats = await fs.stat(zipFilePath);
            this.logger.debug('Created ZIP archive with fallback method', {
                zipFilePath,
                size: stats.size,
            });

            return zipFilePath;

        } catch (error) {
            throw new Error(`Failed to create ZIP archive with both primary and fallback methods: ${error instanceof Error ? error.message : String(error)}`);
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

            // Conservative check: if uncompressed size > 200MB, likely to exceed ZIP limit
            const conservativeLimit = 200 * 1024 * 1024; // 200MB

            if (totalSize > conservativeLimit) {
                timer.fail(new Error('Layer content too large'), { totalSize, conservativeLimit });
                throw new NodeRuntimeLayerError(
                    `Layer content size (${Math.round(totalSize / 1024 / 1024)}MB) exceeds conservative limit (${Math.round(conservativeLimit / 1024 / 1024)}MB). ` +
                    'This will likely exceed AWS Lambda layer size limits after compression.',
                    ErrorCodes.LAYER_SIZE_EXCEEDED
                );
            }

            timer.complete({ totalSize, status: 'within_limits' });

            this.logger.debug('Layer content pre-validation passed', {
                totalSize,
                totalSizeMB: Math.round(totalSize / 1024 / 1024),
                conservativeLimitMB: Math.round(conservativeLimit / 1024 / 1024),
            });

        } catch (error) {
            if (error instanceof NodeRuntimeLayerError) {
                throw error;
            }
            timer.fail(error, { layerDir });
            throw new NodeRuntimeLayerError(
                `Failed to pre-validate layer content: ${error instanceof Error ? error.message : String(error)}`,
                ErrorCodes.LAYER_CREATION_FAILED,
                error instanceof Error ? error : new Error(String(error))
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
                    ErrorCodes.LAYER_SIZE_EXCEEDED
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
                    ErrorCodes.LAYER_SIZE_EXCEEDED
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
                `.trim()
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
                error instanceof Error ? error : new Error(String(error))
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
    private async executeCommandWithOutput(command: string, args: string[], options?: { cwd?: string }): Promise<{ stdout: string; stderr: string }> {
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
     * @param command - Command to execute
     * @param args - Command arguments
     * @param options - Execution options including working directory
     * @returns Promise that resolves when command completes successfully
     * @throws Error if command fails
     */
    private async executeCommand(command: string, args: string[], options?: { cwd?: string }): Promise<void> {
        this.logger.debug('Executing command', { command, args, options });

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
                    this.logger.debug('Command executed successfully', {
                        command,
                        args,
                        stdout: stdout.trim(),
                    });
                    resolve();
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
        tempDir: string
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
            errorCause
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
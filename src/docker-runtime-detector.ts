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
 * Docker-based Node.js runtime version detection
 *
 * This module implements Node.js version detection by pulling official AWS Lambda
 * runtime Docker images and executing `node --version` within containers.
 * Provides caching to avoid repeated Docker operations and fallback mappings
 * when Docker is unavailable.
 *
 * @module docker-runtime-detector
 */

import { spawn } from 'child_process';
import {
    RuntimeDetector,
    NodeVersionInfo,
    VersionCacheEntry,
    NodeRuntimeLayerError,
    ErrorCodes,
    Logger,
} from './nodejs-layer-manager';
import { createDefaultLogger, OperationTimer } from './logger';

/**
 * Configuration options for DockerRuntimeDetector.
 */
export interface DockerRuntimeDetectorOptions {
    /**
     * Cache TTL in milliseconds. Default: 1 hour (3600000ms)
     */
    cacheTtl?: number;

    /**
     * Docker command timeout in milliseconds. Default: 60 seconds (60000ms)
     */
    dockerTimeout?: number;

    /**
     * Logger for debugging and monitoring. Default: createDefaultLogger()
     */
    logger?: Logger;

    /**
     * Whether to enable fallback to known version mappings when Docker fails.
     * Default: true
     */
    enableFallback?: boolean;
}

/**
 * Docker-based implementation of RuntimeDetector.
 *
 * Uses official AWS Lambda runtime Docker images to detect exact Node.js versions.
 * Implements caching to avoid repeated Docker operations and provides fallback
 * version mappings when Docker is unavailable.
 *
 * @example
 * ```typescript
 * const detector = new DockerRuntimeDetector();
 * const versionInfo = await detector.detectNodeVersion('nodejs20.x', 'x86_64');
 * console.log(`Node.js version: ${versionInfo.version}`);
 * ```
 */
export class DockerRuntimeDetector implements RuntimeDetector {
    private readonly versionCache = new Map<string, VersionCacheEntry>();
    private readonly cacheTtl: number;
    private readonly dockerTimeout: number;
    private readonly logger: Logger;
    private readonly enableFallback: boolean;

    /**
     * Known fallback version mappings for when Docker is unavailable.
     * These are based on AWS Lambda runtime documentation and should be
     * updated when AWS releases new runtime versions.
     */
    private static readonly FALLBACK_VERSIONS: Record<string, Record<string, string>> = {
        'nodejs18.x': {
            'x86_64': '18.19.0',
            'arm64': '18.19.0',
        },
        'nodejs20.x': {
            'x86_64': '20.10.0',
            'arm64': '20.10.0',
        },
        'nodejs22.x': {
            'x86_64': '22.1.0',
            'arm64': '22.1.0',
        },
    };

    /**
     * Supported AWS Lambda Node.js runtimes.
     */
    private static readonly SUPPORTED_RUNTIMES = new Set([
        'nodejs18.x',
        'nodejs20.x',
        'nodejs22.x',
    ]);

    /**
     * Supported architectures.
     */
    private static readonly SUPPORTED_ARCHITECTURES = new Set([
        'x86_64',
        'arm64',
    ]);

    constructor(options: DockerRuntimeDetectorOptions = {}) {
        this.cacheTtl = options.cacheTtl ?? 3600000; // 1 hour default
        this.dockerTimeout = options.dockerTimeout ?? 60000; // 60 seconds default
        this.logger = options.logger ?? createDefaultLogger();
        this.enableFallback = options.enableFallback ?? true;
    }

    /**
     * Detects the exact Node.js version for a given runtime and architecture.
     *
     * First checks the cache for existing version information. If not cached or expired,
     * attempts to detect the version using Docker. Falls back to known version mappings
     * if Docker operations fail and fallback is enabled.
     *
     * @param runtimeName - The AWS Lambda runtime (e.g., "nodejs20.x")
     * @param architecture - The target architecture ("x86_64" or "arm64")
     * @returns Promise resolving to Node.js version information
     * @throws NodeRuntimeLayerError if detection fails
     */
    async detectNodeVersion(runtimeName: string, architecture: string): Promise<NodeVersionInfo> {
        const timer = new OperationTimer(this.logger, 'Node.js version detection', {
            runtimeName,
            architecture,
        });

        try {
            // Validate inputs
            this.validateInputs(runtimeName, architecture);

            // Check cache first
            const cacheKey = `${runtimeName}-${architecture}`;
            const cachedEntry = this.getCachedVersion(cacheKey);
            if (cachedEntry) {
                this.logger.debug('Using cached version information', {
                    runtimeName,
                    architecture,
                    version: cachedEntry.version,
                    cachedAt: cachedEntry.cachedAt,
                });

                timer.complete({
                    result: 'cache_hit',
                    version: cachedEntry.version,
                    dockerImage: cachedEntry.dockerImage,
                });

                return {
                    version: cachedEntry.version,
                    runtimeName: cachedEntry.runtimeName,
                    dockerImage: cachedEntry.dockerImage,
                };
            }

            try {
                // Attempt Docker-based detection
                const versionInfo = await this.detectVersionFromDocker(runtimeName, architecture);

                // Cache the result
                this.cacheVersion(cacheKey, versionInfo);

                timer.complete({
                    result: 'docker_detection_success',
                    version: versionInfo.version,
                    dockerImage: versionInfo.dockerImage,
                });

                return versionInfo;
            } catch (error) {
                this.logger.warn('Docker-based version detection failed', {
                    runtimeName,
                    architecture,
                    error: error instanceof Error ? error.message : String(error),
                });

                // Attempt fallback if enabled
                if (this.enableFallback) {
                    const fallbackInfo = this.getFallbackVersion(runtimeName, architecture);
                    timer.complete({
                        result: 'fallback_used',
                        version: fallbackInfo.version,
                        dockerImage: fallbackInfo.dockerImage,
                        fallbackReason: error instanceof Error ? error.message : String(error),
                    });
                    return fallbackInfo;
                }

                // Re-throw the original error if fallback is disabled
                throw error;
            }
        } catch (error) {
            timer.fail(error, { runtimeName, architecture });
            throw error;
        }
    }

    /**
     * Validates input parameters for runtime name and architecture.
     *
     * @param runtimeName - The runtime name to validate
     * @param architecture - The architecture to validate
     * @throws NodeRuntimeLayerError if inputs are invalid
     */
    private validateInputs(runtimeName: string, architecture: string): void {
        if (!DockerRuntimeDetector.SUPPORTED_RUNTIMES.has(runtimeName)) {
            throw new NodeRuntimeLayerError(
                `Unsupported runtime: ${runtimeName}. Supported runtimes: ${Array.from(DockerRuntimeDetector.SUPPORTED_RUNTIMES).join(', ')}`,
                ErrorCodes.RUNTIME_UNSUPPORTED
            );
        }

        if (!DockerRuntimeDetector.SUPPORTED_ARCHITECTURES.has(architecture)) {
            throw new NodeRuntimeLayerError(
                `Unsupported architecture: ${architecture}. Supported architectures: ${Array.from(DockerRuntimeDetector.SUPPORTED_ARCHITECTURES).join(', ')}`,
                ErrorCodes.INVALID_ARCHITECTURE
            );
        }
    }

    /**
     * Retrieves cached version information if available and not expired.
     *
     * @param cacheKey - The cache key to look up
     * @returns Cached version entry if valid, null otherwise
     */
    private getCachedVersion(cacheKey: string): VersionCacheEntry | null {
        const entry = this.versionCache.get(cacheKey);
        if (!entry) {
            return null;
        }

        const now = Date.now();
        const expiresAt = entry.cachedAt.getTime() + entry.ttl;

        if (now > expiresAt) {
            // Entry has expired, remove it
            this.versionCache.delete(cacheKey);
            this.logger.debug('Cache entry expired and removed', {
                cacheKey,
                cachedAt: entry.cachedAt,
                ttl: entry.ttl,
                now: new Date(now),
            });
            return null;
        }

        return entry;
    }

    /**
     * Caches version information with TTL.
     *
     * @param cacheKey - The cache key to store under
     * @param versionInfo - The version information to cache
     */
    private cacheVersion(cacheKey: string, versionInfo: NodeVersionInfo): void {
        const entry: VersionCacheEntry = {
            version: versionInfo.version,
            runtimeName: versionInfo.runtimeName,
            dockerImage: versionInfo.dockerImage,
            cachedAt: new Date(),
            ttl: this.cacheTtl,
        };

        this.versionCache.set(cacheKey, entry);

        this.logger.debug('Cached version information', {
            cacheKey,
            version: entry.version,
            ttl: entry.ttl,
        });
    }

    /**
     * Detects Node.js version using Docker by pulling AWS Lambda runtime image
     * and executing `node --version` within a container.
     *
     * @param runtimeName - The AWS Lambda runtime name
     * @param architecture - The target architecture
     * @returns Promise resolving to version information
     * @throws NodeRuntimeLayerError if Docker operations fail
     */
    private async detectVersionFromDocker(runtimeName: string, architecture: string): Promise<NodeVersionInfo> {
        const dockerImage = this.buildDockerImageName(runtimeName, architecture);

        const timer = new OperationTimer(this.logger, 'Docker-based version detection', {
            runtimeName,
            architecture,
            dockerImage,
        });

        try {
            // First, pull the Docker image
            await this.pullDockerImage(dockerImage);

            // Then, run node --version in the container
            const version = await this.extractNodeVersionFromContainer(dockerImage);

            const versionInfo = {
                version,
                runtimeName,
                dockerImage,
            };

            timer.complete({
                version,
                dockerImage,
            });

            return versionInfo;
        } catch (error) {
            timer.fail(error, { dockerImage });
            throw new NodeRuntimeLayerError(
                `Failed to detect Node.js version from Docker image ${dockerImage}: ${error instanceof Error ? error.message : String(error)}`,
                ErrorCodes.VERSION_DETECTION_FAILED,
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    /**
     * Builds the Docker image name for AWS Lambda runtime.
     *
     * @param runtimeName - The AWS Lambda runtime name (e.g., "nodejs20.x")
     * @param architecture - The target architecture
     * @returns Docker image name (e.g., "public.ecr.aws/lambda/nodejs:20-x86_64")
     */
    private buildDockerImageName(runtimeName: string, architecture: string): string {
        // Extract major version from runtime name (e.g., "nodejs20.x" -> "20")
        const majorVersion = runtimeName.replace('nodejs', '').replace('.x', '');

        return `public.ecr.aws/lambda/nodejs:${majorVersion}-${architecture}`;
    }

    /**
     * Pulls a Docker image using the docker pull command.
     *
     * @param dockerImage - The Docker image to pull
     * @returns Promise that resolves when the image is pulled
     * @throws Error if docker pull fails
     */
    private async pullDockerImage(dockerImage: string): Promise<void> {
        const timer = new OperationTimer(this.logger, 'Docker image pull', { dockerImage });

        return new Promise((resolve, reject) => {
            const pullProcess = spawn('docker', ['pull', dockerImage], {
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';

            pullProcess.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            pullProcess.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            const timeout = setTimeout(() => {
                pullProcess.kill('SIGTERM');
                const timeoutError = new Error(`Docker pull timeout after ${this.dockerTimeout}ms`);
                timer.fail(timeoutError, { dockerImage, timeout: this.dockerTimeout });
                reject(timeoutError);
            }, this.dockerTimeout);

            pullProcess.on('close', (code) => {
                clearTimeout(timeout);

                if (code === 0) {
                    timer.complete({
                        dockerImage,
                        stdout: stdout.trim(),
                    });
                    resolve();
                } else {
                    const errorMessage = stderr.trim() || stdout.trim() || `Docker pull failed with exit code ${code}`;
                    const pullError = new Error(errorMessage);
                    timer.fail(pullError, {
                        dockerImage,
                        exitCode: code,
                        stderr: stderr.trim(),
                        stdout: stdout.trim(),
                    });
                    reject(pullError);
                }
            });

            pullProcess.on('error', (error) => {
                clearTimeout(timeout);
                timer.fail(error, { dockerImage });
                reject(error);
            });
        });
    }

    /**
     * Extracts Node.js version by running `node --version` in a Docker container.
     *
     * @param dockerImage - The Docker image to run
     * @returns Promise resolving to the Node.js version string
     * @throws Error if container execution fails
     */
    private async extractNodeVersionFromContainer(dockerImage: string): Promise<string> {
        const timer = new OperationTimer(this.logger, 'Node.js version extraction', { dockerImage });

        return new Promise((resolve, reject) => {
            const runProcess = spawn('docker', ['run', '--rm', dockerImage, 'node', '--version'], {
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';

            runProcess.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            runProcess.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            const timeout = setTimeout(() => {
                runProcess.kill('SIGTERM');
                const timeoutError = new Error(`Docker run timeout after ${this.dockerTimeout}ms`);
                timer.fail(timeoutError, { dockerImage, timeout: this.dockerTimeout });
                reject(timeoutError);
            }, this.dockerTimeout);

            runProcess.on('close', (code) => {
                clearTimeout(timeout);

                if (code === 0) {
                    const version = stdout.trim().replace(/^v/, ''); // Remove 'v' prefix if present

                    if (!this.isValidSemanticVersion(version)) {
                        const versionError = new Error(`Invalid version format received: ${version}`);
                        timer.fail(versionError, {
                            dockerImage,
                            rawOutput: stdout.trim(),
                            version,
                        });
                        reject(versionError);
                        return;
                    }

                    timer.complete({
                        dockerImage,
                        version,
                        rawOutput: stdout.trim(),
                    });

                    resolve(version);
                } else {
                    const errorMessage = stderr.trim() || stdout.trim() || `Docker run failed with exit code ${code}`;
                    const runError = new Error(errorMessage);
                    timer.fail(runError, {
                        dockerImage,
                        exitCode: code,
                        stderr: stderr.trim(),
                        stdout: stdout.trim(),
                    });
                    reject(runError);
                }
            });

            runProcess.on('error', (error) => {
                clearTimeout(timeout);
                timer.fail(error, { dockerImage });
                reject(error);
            });
        });
    }

    /**
     * Validates that a version string follows semantic versioning format.
     *
     * @param version - The version string to validate
     * @returns true if the version is valid, false otherwise
     */
    private isValidSemanticVersion(version: string): boolean {
        const semverRegex = /^\d+\.\d+\.\d+$/;
        return semverRegex.test(version);
    }

    /**
     * Provides fallback version information when Docker detection fails.
     *
     * @param runtimeName - The AWS Lambda runtime name
     * @param architecture - The target architecture
     * @returns NodeVersionInfo with fallback version
     * @throws NodeRuntimeLayerError if no fallback is available
     */
    private getFallbackVersion(runtimeName: string, architecture: string): NodeVersionInfo {
        const runtimeVersions = DockerRuntimeDetector.FALLBACK_VERSIONS[runtimeName];
        if (!runtimeVersions) {
            throw new NodeRuntimeLayerError(
                `No fallback version available for runtime: ${runtimeName}`,
                ErrorCodes.VERSION_DETECTION_FAILED
            );
        }

        const version = runtimeVersions[architecture];
        if (!version) {
            throw new NodeRuntimeLayerError(
                `No fallback version available for runtime ${runtimeName} on architecture ${architecture}`,
                ErrorCodes.VERSION_DETECTION_FAILED
            );
        }

        const dockerImage = this.buildDockerImageName(runtimeName, architecture);

        this.logger.warn('Using fallback version information', {
            runtimeName,
            architecture,
            version,
            dockerImage,
            reason: 'Docker detection failed',
        });

        return {
            version,
            runtimeName,
            dockerImage,
        };
    }

    /**
     * Clears the version cache.
     * Useful for testing or when cache invalidation is needed.
     */
    public clearCache(): void {
        this.versionCache.clear();
        this.logger.debug('Version cache cleared');
    }

    /**
     * Gets the current cache size.
     * Useful for monitoring and debugging.
     */
    public getCacheSize(): number {
        return this.versionCache.size;
    }

    /**
     * Checks if Docker is available on the system.
     *
     * @returns Promise resolving to true if Docker is available, false otherwise
     */
    public async isDockerAvailable(): Promise<boolean> {
        try {
            await new Promise<void>((resolve, reject) => {
                const process = spawn('docker', ['--version'], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                });

                const timeout = setTimeout(() => {
                    process.kill('SIGTERM');
                    reject(new Error('Docker version check timeout'));
                }, 5000); // 5 second timeout

                process.on('close', (code) => {
                    clearTimeout(timeout);
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Docker version check failed with exit code ${code}`));
                    }
                });

                process.on('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });

            return true;
        } catch (error) {
            this.logger.debug('Docker availability check failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }
}
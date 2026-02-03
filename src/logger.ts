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
 * Logger implementations for Node.js Layer Management
 *
 * Provides different logger implementations for various use cases:
 * - NoOpLogger: Silent logger for production use
 * - ConsoleLogger: Console-based logger for development and debugging
 *
 * @module logger
 */

import { Logger } from './nodejs-layer-manager';

/**
 * No-operation logger that silently discards all log messages.
 *
 * This is the default logger used when no custom logger is provided.
 * Useful for production environments where logging overhead should be minimized.
 */
export class NoOpLogger implements Logger {
    debug(_message: string, _meta?: Record<string, unknown>): void {
        // No-op
    }

    info(_message: string, _meta?: Record<string, unknown>): void {
        // No-op
    }

    warn(_message: string, _meta?: Record<string, unknown>): void {
        // No-op
    }

    error(_message: string, _meta?: Record<string, unknown>): void {
        // No-op
    }
}

/**
 * Console-based logger for development and debugging.
 *
 * Outputs structured log messages to the console with timestamps and metadata.
 * Useful for development environments and troubleshooting.
 */
export class ConsoleLogger implements Logger {
    constructor(
        private readonly prefix: string = '[NodeLayerManager]',
        private readonly logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info'
    ) { }

    debug(message: string, meta?: Record<string, unknown>): void {
        if (this.shouldLog('debug')) {
            this.log('DEBUG', message, meta);
        }
    }

    info(message: string, meta?: Record<string, unknown>): void {
        if (this.shouldLog('info')) {
            this.log('INFO', message, meta);
        }
    }

    warn(message: string, meta?: Record<string, unknown>): void {
        if (this.shouldLog('warn')) {
            this.log('WARN', message, meta);
        }
    }

    error(message: string, meta?: Record<string, unknown>): void {
        if (this.shouldLog('error')) {
            this.log('ERROR', message, meta);
        }
    }

    private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
        const levels = ['debug', 'info', 'warn', 'error'];
        const currentLevelIndex = levels.indexOf(this.logLevel);
        const messageLevelIndex = levels.indexOf(level);
        return messageLevelIndex >= currentLevelIndex;
    }

    private log(level: string, message: string, meta?: Record<string, unknown>): void {
        const timestamp = new Date().toISOString();
        const logMessage = `${timestamp} ${this.prefix} [${level}] ${message}`;

        if (meta && Object.keys(meta).length > 0) {
            console.log(logMessage, meta);
        } else {
            console.log(logMessage);
        }
    }
}

/**
 * Creates a default logger instance.
 *
 * Returns a NoOpLogger by default, but can be configured to return
 * a ConsoleLogger based on environment variables or other configuration.
 *
 * @returns A logger instance
 */
export function createDefaultLogger(): Logger {
    // Check if debug logging is enabled via environment variable
    if (process.env.LAMBDA_KATA_DEBUG === 'true' || process.env.NODE_ENV === 'development') {
        const logLevel = (process.env.LAMBDA_KATA_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info';
        return new ConsoleLogger('[NodeLayerManager]', logLevel);
    }

    return new NoOpLogger();
}

/**
 * Utility class for measuring operation timing with structured logging.
 * 
 * Provides consistent timing measurement and logging across all operations.
 * Ensures operation start/completion logging with timing information.
 */
export class OperationTimer {
    private readonly startTime: number;
    private readonly logger: Logger;
    private readonly operationType: string;
    private readonly operationMetadata: Record<string, unknown>;

    constructor(
        logger: Logger,
        operationType: string,
        operationMetadata: Record<string, unknown> = {}
    ) {
        this.startTime = Date.now();
        this.logger = logger;
        this.operationType = operationType;
        this.operationMetadata = operationMetadata;

        // Log operation start
        this.logger.info(`Starting ${operationType}`, {
            operation: operationType,
            startTime: new Date(this.startTime).toISOString(),
            ...operationMetadata,
        });
    }

    /**
     * Completes the operation timing and logs success.
     * 
     * @param resultMetadata - Additional metadata about the operation result
     */
    complete(resultMetadata: Record<string, unknown> = {}): void {
        const endTime = Date.now();
        const duration = endTime - this.startTime;

        this.logger.info(`Completed ${this.operationType}`, {
            operation: this.operationType,
            duration: `${duration}ms`,
            startTime: new Date(this.startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            ...this.operationMetadata,
            ...resultMetadata,
        });
    }

    /**
     * Completes the operation timing and logs failure.
     * 
     * @param error - The error that caused the operation to fail
     * @param errorMetadata - Additional metadata about the error
     */
    fail(error: unknown, errorMetadata: Record<string, unknown> = {}): void {
        const endTime = Date.now();
        const duration = endTime - this.startTime;

        // Extract AWS request ID if available
        const awsRequestId = this.extractAwsRequestId(error);

        this.logger.error(`Failed ${this.operationType}`, {
            operation: this.operationType,
            duration: `${duration}ms`,
            startTime: new Date(this.startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            error: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : 'Unknown',
            awsRequestId,
            troubleshooting: this.generateTroubleshootingContext(error),
            ...this.operationMetadata,
            ...errorMetadata,
        });
    }

    /**
     * Extracts AWS request ID from error objects.
     * 
     * @param error - The error to extract request ID from
     * @returns AWS request ID if found, undefined otherwise
     */
    private extractAwsRequestId(error: unknown): string | undefined {
        if (!error || typeof error !== 'object') {
            return undefined;
        }

        const errorObj = error as any;

        // Check common AWS SDK error properties
        return errorObj.$metadata?.requestId ||
            errorObj.requestId ||
            errorObj.RequestId ||
            errorObj.$response?.requestId ||
            undefined;
    }

    /**
     * Generates troubleshooting context based on error type.
     * 
     * @param error - The error to generate context for
     * @returns Troubleshooting guidance
     */
    private generateTroubleshootingContext(error: unknown): string {
        if (!error) {
            return 'Unknown error occurred';
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.name : 'Unknown';

        // Provide specific troubleshooting guidance based on error patterns
        if (errorName.includes('Throttling') || errorMessage.includes('throttl')) {
            return 'AWS API throttling detected. Consider implementing exponential backoff or reducing request rate.';
        }

        if (errorName.includes('AccessDenied') || errorMessage.includes('access denied')) {
            return 'AWS access denied. Check IAM permissions for Lambda layer operations (lambda:ListLayers, lambda:GetLayerVersion, lambda:PublishLayerVersion).';
        }

        if (errorMessage.includes('docker') || errorMessage.includes('Docker')) {
            return 'Docker operation failed. Ensure Docker is installed and running, and that the AWS Lambda runtime images are accessible.';
        }

        if (errorName.includes('NetworkingError') || errorMessage.includes('network') || errorMessage.includes('connection')) {
            return 'Network connectivity issue. Check internet connection and AWS service availability.';
        }

        if (errorMessage.includes('timeout')) {
            return 'Operation timed out. Consider increasing timeout values or checking system resources.';
        }

        return `${errorName}: ${errorMessage}`;
    }
}
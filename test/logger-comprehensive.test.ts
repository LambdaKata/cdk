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
 * Unit tests for comprehensive logging functionality
 *
 * Tests the enhanced logging features including:
 * - Configurable log levels
 * - Operation timing with OperationTimer
 * - AWS request ID extraction
 * - Troubleshooting context generation
 * - Structured metadata logging
 */

import { ConsoleLogger, createDefaultLogger, NoOpLogger, OperationTimer } from '../src';

describe('Enhanced Logger Functionality', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('ConsoleLogger with configurable log levels', () => {
    it('should respect debug log level and log all messages', () => {
      const logger = new ConsoleLogger('[TEST]', 'debug');

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleSpy).toHaveBeenCalledTimes(4);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[DEBUG] Debug message'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] Info message'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN] Warn message'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] Error message'));
    });

    it('should respect info log level and filter debug messages', () => {
      const logger = new ConsoleLogger('[TEST]', 'info');

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleSpy).toHaveBeenCalledTimes(3);
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('[DEBUG]'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] Info message'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN] Warn message'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] Error message'));
    });

    it('should respect warn log level and filter debug/info messages', () => {
      const logger = new ConsoleLogger('[TEST]', 'warn');

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleSpy).toHaveBeenCalledTimes(2);
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('[DEBUG]'));
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('[INFO]'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN] Warn message'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] Error message'));
    });

    it('should respect error log level and only log error messages', () => {
      const logger = new ConsoleLogger('[TEST]', 'error');

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] Error message'));
    });

    it('should include structured metadata in log output', () => {
      const logger = new ConsoleLogger('[TEST]', 'info');
      const metadata = { operation: 'test', duration: '100ms', success: true };

      logger.info('Operation completed', metadata);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Operation completed'),
        metadata,
      );
    });
  });

  describe('createDefaultLogger with environment variables', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return NoOpLogger by default', () => {
      process.env = { ...originalEnv };
      delete process.env.LAMBDA_KATA_DEBUG;
      delete process.env.NODE_ENV;

      const logger = createDefaultLogger();
      expect(logger).toBeInstanceOf(NoOpLogger);
    });

    it('should return ConsoleLogger when LAMBDA_KATA_DEBUG is true', () => {
      process.env = { ...originalEnv, LAMBDA_KATA_DEBUG: 'true' };

      const logger = createDefaultLogger();
      expect(logger).toBeInstanceOf(ConsoleLogger);
    });

    it('should return ConsoleLogger when NODE_ENV is development', () => {
      process.env = { ...originalEnv, NODE_ENV: 'development' };

      const logger = createDefaultLogger();
      expect(logger).toBeInstanceOf(ConsoleLogger);
    });

    it('should respect LAMBDA_KATA_LOG_LEVEL environment variable', () => {
      process.env = {
        ...originalEnv,
        LAMBDA_KATA_DEBUG: 'true',
        LAMBDA_KATA_LOG_LEVEL: 'warn',
      };

      const logger = createDefaultLogger() as ConsoleLogger;

      // Test that debug and info are filtered
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[WARN] Warn message'));
    });
  });

  describe('OperationTimer', () => {
    let mockLogger: jest.Mocked<ConsoleLogger>;

    beforeEach(() => {
      mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as any;
    });

    it('should log operation start with metadata', () => {
      const metadata = { layerName: 'test-layer', architecture: 'x86_64' };
      new OperationTimer(mockLogger, 'layer creation', metadata);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Starting layer creation',
        expect.objectContaining({
          operation: 'layer creation',
          startTime: expect.any(String),
          ...metadata,
        }),
      );
    });

    it('should log operation completion with timing', async () => {
      const timer = new OperationTimer(mockLogger, 'test operation');

      // Wait a small amount to ensure timing > 0
      await new Promise(resolve => setTimeout(resolve, 10));

      const resultMetadata = { result: 'success', itemsProcessed: 5 };
      timer.complete(resultMetadata);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Completed test operation',
        expect.objectContaining({
          operation: 'test operation',
          duration: expect.stringMatching(/^\d+ms$/),
          startTime: expect.any(String),
          endTime: expect.any(String),
          ...resultMetadata,
        }),
      );
    });

    it('should log operation failure with error details and timing', async () => {
      const timer = new OperationTimer(mockLogger, 'test operation');

      await new Promise(resolve => setTimeout(resolve, 10));

      const error = new Error('Test error');
      const errorMetadata = { attemptNumber: 2 };
      timer.fail(error, errorMetadata);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed test operation',
        expect.objectContaining({
          operation: 'test operation',
          duration: expect.stringMatching(/^\d+ms$/),
          startTime: expect.any(String),
          endTime: expect.any(String),
          error: 'Test error',
          errorName: 'Error',
          awsRequestId: undefined,
          troubleshooting: 'Error: Test error',
          ...errorMetadata,
        }),
      );
    });

    it('should extract AWS request ID from error objects', () => {
      const timer = new OperationTimer(mockLogger, 'aws operation');

      // Test various AWS error formats
      const awsError1 = {
        message: 'AWS error',
        name: 'ServiceException',
        $metadata: { requestId: 'req-123' },
      };

      timer.fail(awsError1);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed aws operation',
        expect.objectContaining({
          awsRequestId: 'req-123',
        }),
      );
    });

    it('should generate appropriate troubleshooting context for throttling errors', () => {
      const timer = new OperationTimer(mockLogger, 'aws operation');

      const throttlingError = new Error('ThrottlingException: Rate exceeded');
      throttlingError.name = 'ThrottlingException';

      timer.fail(throttlingError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed aws operation',
        expect.objectContaining({
          troubleshooting: 'AWS API throttling detected. Consider implementing exponential backoff or reducing request rate.',
        }),
      );
    });

    it('should generate appropriate troubleshooting context for access denied errors', () => {
      const timer = new OperationTimer(mockLogger, 'aws operation');

      const accessError = new Error('Access denied to resource');
      accessError.name = 'AccessDenied';

      timer.fail(accessError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed aws operation',
        expect.objectContaining({
          troubleshooting: 'AWS access denied. Check IAM permissions for Lambda layer operations (lambda:ListLayers, lambda:GetLayerVersion, lambda:PublishLayerVersion).',
        }),
      );
    });

    it('should generate appropriate troubleshooting context for Docker errors', () => {
      const timer = new OperationTimer(mockLogger, 'docker operation');

      const dockerError = new Error('docker: command not found');

      timer.fail(dockerError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed docker operation',
        expect.objectContaining({
          troubleshooting: 'Docker operation failed. Ensure Docker is installed and running, and that the AWS Lambda runtime images are accessible.',
        }),
      );
    });

    it('should generate appropriate troubleshooting context for network errors', () => {
      const timer = new OperationTimer(mockLogger, 'network operation');

      const networkError = new Error('Network timeout occurred');
      networkError.name = 'NetworkingError';

      timer.fail(networkError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed network operation',
        expect.objectContaining({
          troubleshooting: 'Network connectivity issue. Check internet connection and AWS service availability.',
        }),
      );
    });

    it('should generate appropriate troubleshooting context for timeout errors', () => {
      const timer = new OperationTimer(mockLogger, 'timeout operation');

      const timeoutError = new Error('Operation timeout after 30s');

      timer.fail(timeoutError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed timeout operation',
        expect.objectContaining({
          troubleshooting: 'Operation timed out. Consider increasing timeout values or checking system resources.',
        }),
      );
    });

    it('should handle non-Error objects gracefully', () => {
      const timer = new OperationTimer(mockLogger, 'test operation');

      timer.fail('String error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed test operation',
        expect.objectContaining({
          error: 'String error',
          errorName: 'Unknown',
          troubleshooting: 'Unknown: String error',
        }),
      );
    });

    it('should handle null/undefined errors gracefully', () => {
      const timer = new OperationTimer(mockLogger, 'test operation');

      timer.fail(null);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed test operation',
        expect.objectContaining({
          error: 'null',
          errorName: 'Unknown',
          troubleshooting: 'Unknown error occurred',
        }),
      );
    });
  });

  describe('NoOpLogger behavior', () => {
    it('should not produce any output', () => {
      const logger = new NoOpLogger();

      logger.debug('Debug message', { key: 'value' });
      logger.info('Info message', { key: 'value' });
      logger.warn('Warn message', { key: 'value' });
      logger.error('Error message', { key: 'value' });

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});

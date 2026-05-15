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
 * Unit tests for AWSLayerManager
 *
 * Tests the AWS Lambda Layer management functionality including:
 * - Layer searching with pagination
 * - Layer compatibility validation
 * - Error handling and retry logic
 * - AWS SDK v3 integration
 */

import { GetLayerVersionCommand, LambdaClient, LayersListItem, LayerVersionsListItem } from '@aws-sdk/client-lambda';
import { promises as fs } from 'fs';

import {
  AWSLayerManager,
  AWSLayerManagerOptions,
  ConsoleLogger,
  ErrorCodes,
  LayerCreationOptions,
  LayerInfo,
  LayerRequirements,
  LayerSearchOptions,
  NodeRuntimeLayerError,
  NoOpLogger,
} from '../src';

// Mock AWS SDK v3
jest.mock('@aws-sdk/client-lambda', () => {
  const actual = jest.requireActual('@aws-sdk/client-lambda');
  return {
    ...actual,
    LambdaClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
      destroy: jest.fn(),
    })),
    paginateListLayers: jest.fn(),
  };
});

// Mock child_process for command execution tests
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

const MockedLambdaClient = LambdaClient as jest.MockedClass<typeof LambdaClient>;

describe('AWSLayerManager', () => {
  let mockLambdaClient: jest.Mocked<LambdaClient>;
  let manager: AWSLayerManager;
  let consoleLogger: ConsoleLogger;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mocked Lambda client
    mockLambdaClient = {
      send: jest.fn(),
      destroy: jest.fn(),
    } as any;

    MockedLambdaClient.mockImplementation(() => mockLambdaClient);

    consoleLogger = new ConsoleLogger('[TEST]');

    manager = new AWSLayerManager({
      awsSdkConfig: { region: 'us-east-1' },
      logger: consoleLogger,
      maxLayerAge: 604800000, // 7 days
      maxRetries: 2,
      retryBaseDelay: 100, // Faster for tests
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    manager.destroy();
  });

  describe('Constructor', () => {
    it('should initialize with default options', () => {
      const defaultManager = new AWSLayerManager();
      expect(defaultManager).toBeInstanceOf(AWSLayerManager);
      defaultManager.destroy();
    });

    it('should initialize with custom options', () => {
      const customOptions: AWSLayerManagerOptions = {
        awsSdkConfig: { region: 'eu-west-1' },
        logger: new NoOpLogger(),
        maxLayerAge: 86400000, // 1 day
        maxRetries: 5,
        retryBaseDelay: 2000,
      };

      const customManager = new AWSLayerManager(customOptions);
      expect(customManager).toBeInstanceOf(AWSLayerManager);
      customManager.destroy();
    });

    it('should create Lambda client with provided config', () => {
      expect(MockedLambdaClient).toHaveBeenCalledWith({ region: 'us-east-1' });
    });
  });

  describe('findExistingLayer', () => {
    const searchOptions: LayerSearchOptions = {
      layerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
      requirements: {
        nodeVersion: '20.10.0',
        architecture: 'x86_64',
      },
    };

    it('should return null when no layers found', async () => {
      // Mock empty pagination response
      const mockAsyncIterator = {
        [Symbol.asyncIterator]: async function* () {
          yield { Layers: [] };
        },
      };

      // Mock the paginateListLayers function
      const { paginateListLayers } = require('@aws-sdk/client-lambda');
      (paginateListLayers as jest.Mock).mockReturnValue(mockAsyncIterator);

      const result = await manager.findExistingLayer(searchOptions);
      expect(result).toBeNull();
    });

    it('should return compatible layer when found', async () => {
      const mockLayer: LayersListItem = {
        LayerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
        LatestMatchingVersion: {
          Version: 1,
          CreatedDate: '2024-01-01T00:00:00.000Z',
        } as LayerVersionsListItem,
      };

      // Mock pagination response
      const mockAsyncIterator = {
        [Symbol.asyncIterator]: async function* () {
          yield { Layers: [mockLayer] };
        },
      };

      // Mock GetLayerVersion response
      const mockGetLayerResponse = {
        LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:lambda-kata-nodejs-nodejs20.x-x86_64:1',
        CreatedDate: new Date().toISOString(), // Use current date
        Description: 'Node.js 20.10.0 (x86_64) runtime layer for Lambda Kata',
      };

      (mockLambdaClient.send as jest.Mock).mockResolvedValue(mockGetLayerResponse);

      // Mock the pagination
      const { paginateListLayers } = require('@aws-sdk/client-lambda');
      (paginateListLayers as jest.Mock).mockReturnValue(mockAsyncIterator);

      const result = await manager.findExistingLayer(searchOptions);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('lambda-kata-nodejs-nodejs20.x-x86_64');
      expect(result!.nodeVersion).toBe('20.10.0');
      expect(result!.architecture).toBe('x86_64');
      expect(result!.version).toBe(1);
    });

    it('should skip layers with invalid metadata', async () => {
      const mockLayer: LayersListItem = {
        LayerName: 'invalid-layer-name',
        LatestMatchingVersion: {
          Version: 1,
        } as LayerVersionsListItem,
      };

      const mockAsyncIterator = {
        [Symbol.asyncIterator]: async function* () {
          yield { Layers: [mockLayer] };
        },
      };

      // Mock GetLayerVersion to throw error
      (mockLambdaClient.send as jest.Mock).mockRejectedValue(new Error('Layer not found'));

      const { paginateListLayers } = require('@aws-sdk/client-lambda');
      (paginateListLayers as jest.Mock).mockReturnValue(mockAsyncIterator);

      const result = await manager.findExistingLayer(searchOptions);
      expect(result).toBeNull();
    });

    it('should throw NodeRuntimeLayerError on AWS API failure', async () => {
      // Mock pagination to throw error
      const { paginateListLayers } = require('@aws-sdk/client-lambda');
      (paginateListLayers as jest.Mock).mockImplementation(() => {
        throw new Error('AWS API Error');
      });

      await expect(manager.findExistingLayer(searchOptions))
        .rejects
        .toThrow(NodeRuntimeLayerError);
    });
  });

  describe('validateLayerCompatibility', () => {
    const baseLayerInfo: LayerInfo = {
      arn: 'arn:aws:lambda:us-east-1:123456789012:layer:test:1',
      name: 'test-layer',
      version: 1,
      nodeVersion: '20.10.0',
      architecture: 'x86_64',
      createdDate: new Date(), // Use current date
    };

    const baseRequirements: LayerRequirements = {
      nodeVersion: '20.10.0',
      architecture: 'x86_64',
    };

    it('should return true for compatible layer', () => {
      const result = manager.validateLayerCompatibility(baseLayerInfo, baseRequirements);
      expect(result).toBe(true);
    });

    it('should return false for Node.js version mismatch', () => {
      const requirements: LayerRequirements = {
        ...baseRequirements,
        nodeVersion: '18.19.0',
      };

      const result = manager.validateLayerCompatibility(baseLayerInfo, requirements);
      expect(result).toBe(false);
    });

    it('should return false for architecture mismatch', () => {
      const requirements: LayerRequirements = {
        ...baseRequirements,
        architecture: 'arm64',
      };

      const result = manager.validateLayerCompatibility(baseLayerInfo, requirements);
      expect(result).toBe(false);
    });

    it('should return false for layer too old (custom maxAge)', () => {
      const oldLayerInfo: LayerInfo = {
        ...baseLayerInfo,
        createdDate: new Date('2020-01-01T00:00:00.000Z'), // Very old
      };

      const requirements: LayerRequirements = {
        ...baseRequirements,
        maxAge: 86400000, // 1 day
      };

      const result = manager.validateLayerCompatibility(oldLayerInfo, requirements);
      expect(result).toBe(false);
    });

    it('should return false for layer too old (default maxAge)', () => {
      const oldLayerInfo: LayerInfo = {
        ...baseLayerInfo,
        createdDate: new Date('2020-01-01T00:00:00.000Z'), // Very old
      };

      const result = manager.validateLayerCompatibility(oldLayerInfo, baseRequirements);
      expect(result).toBe(false);
    });

    it('should return true for recent layer within maxAge', () => {
      const recentLayerInfo: LayerInfo = {
        ...baseLayerInfo,
        createdDate: new Date(), // Current time
      };

      const result = manager.validateLayerCompatibility(recentLayerInfo, baseRequirements);
      expect(result).toBe(true);
    });
  });

  describe('createNodeLayer', () => {
    it('should handle Docker operation failures gracefully', async () => {
      const options: LayerCreationOptions = {
        layerName: 'test-layer',
        nodeVersion: '20.10.0',
        architecture: 'x86_64',
        region: 'us-east-1',
      };

      // This test verifies that Docker failures are handled gracefully
      // In a real test environment, Docker operations will likely fail
      // The important thing is that it fails with proper error handling
      await expect(manager.createNodeLayer(options))
        .rejects
        .toThrow(NodeRuntimeLayerError);
    }, 10000); // Shorter timeout since we expect it to fail quickly
  });

  describe('parseLayerMetadata', () => {
    it('should parse metadata from description', () => {
      // Access private method for testing
      const parseMethod = (manager as any).parseLayerMetadata.bind(manager);

      const description = 'Node.js 20.10.0 (x86_64) runtime layer for Lambda Kata';
      const layerName = 'lambda-kata-nodejs-nodejs20.x-x86_64';

      const result = parseMethod(description, layerName);

      expect(result.nodeVersion).toBe('20.10.0');
      expect(result.architecture).toBe('x86_64');
    });

    it('should parse metadata from layer name when description fails', () => {
      const parseMethod = (manager as any).parseLayerMetadata.bind(manager);

      const description = 'Generic layer description';
      const layerName = 'lambda-kata-nodejs-nodejs20.x-x86_64';

      const result = parseMethod(description, layerName);

      expect(result.nodeVersion).toBe('20.10.0');
      expect(result.architecture).toBe('x86_64');
    });

    it('should handle different Node.js versions from layer name', () => {
      const parseMethod = (manager as any).parseLayerMetadata.bind(manager);

      const testCases = [
        { layerName: 'lambda-kata-nodejs-nodejs18.x-arm64', expectedVersion: '18.19.0', expectedArch: 'arm64' },
        { layerName: 'lambda-kata-nodejs-nodejs22.x-x86_64', expectedVersion: '22.1.0', expectedArch: 'x86_64' },
      ];

      testCases.forEach(({ layerName, expectedVersion, expectedArch }) => {
        const result = parseMethod('', layerName);
        expect(result.nodeVersion).toBe(expectedVersion);
        expect(result.architecture).toBe(expectedArch);
      });
    });

    it('should throw error for unparseable metadata', () => {
      const parseMethod = (manager as any).parseLayerMetadata.bind(manager);

      const description = 'Invalid description';
      const layerName = 'invalid-layer-name';

      expect(() => parseMethod(description, layerName))
        .toThrow('Unable to parse Node.js version and architecture');
    });
  });

  describe('retry logic', () => {
    it('should retry retryable errors', async () => {
      const retryableError = new Error('ThrottlingException');
      const successResponse = {
        LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:test:1',
        CreatedDate: '2024-01-01T00:00:00.000Z',
        Description: 'Node.js 20.10.0 (x86_64)',
      };

      (mockLambdaClient.send as jest.Mock)
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValueOnce(successResponse);

      // Access private method for testing
      const executeWithRetry = (manager as any).executeWithRetry.bind(manager);

      const operation = () => mockLambdaClient.send(new GetLayerVersionCommand({
        LayerName: 'test',
        VersionNumber: 1,
      }));

      const result = await executeWithRetry(operation);
      expect(result).toBe(successResponse);
      expect(mockLambdaClient.send).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const nonRetryableError = new Error('ResourceNotFoundException');
      (mockLambdaClient.send as jest.Mock).mockRejectedValue(nonRetryableError);

      const executeWithRetry = (manager as any).executeWithRetry.bind(manager);

      const operation = () => mockLambdaClient.send(new GetLayerVersionCommand({
        LayerName: 'test',
        VersionNumber: 1,
      }));

      await expect(executeWithRetry(operation)).rejects.toThrow(nonRetryableError);
      expect(mockLambdaClient.send).toHaveBeenCalledTimes(1);
    });

    it('should exhaust retries and throw last error', async () => {
      const retryableError = new Error('ThrottlingException');
      (mockLambdaClient.send as jest.Mock).mockRejectedValue(retryableError);

      const executeWithRetry = (manager as any).executeWithRetry.bind(manager);

      const operation = () => mockLambdaClient.send(new GetLayerVersionCommand({
        LayerName: 'test',
        VersionNumber: 1,
      }));

      await expect(executeWithRetry(operation)).rejects.toThrow(retryableError);
      expect(mockLambdaClient.send).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe('error classification', () => {
    it('should identify retryable errors', () => {
      const isRetryableError = (manager as any).isRetryableError.bind(manager);

      const retryableErrors = [
        new Error('ThrottlingException'),
        new Error('TooManyRequestsException'),
        new Error('ServiceUnavailableException'),
        new Error('InternalServerError'),
        new Error('RequestTimeout'),
      ];

      retryableErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('should identify non-retryable errors', () => {
      const isRetryableError = (manager as any).isRetryableError.bind(manager);

      const nonRetryableErrors = [
        new Error('ResourceNotFoundException'),
        new Error('InvalidParameterValueException'),
        new Error('AccessDeniedException'),
      ];

      nonRetryableErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(false);
      });
    });
  });

  describe('circuit breaker functionality', () => {
    it('should allow operations when circuit is closed', async () => {
      const successResponse = { LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:test:1' };
      (mockLambdaClient.send as jest.Mock).mockResolvedValue(successResponse);

      const executeWithRetry = (manager as any).executeWithRetry.bind(manager);
      const operation = () => mockLambdaClient.send(new GetLayerVersionCommand({
        LayerName: 'test',
        VersionNumber: 1,
      }));

      const result = await executeWithRetry(operation);
      expect(result).toBe(successResponse);
      expect(mockLambdaClient.send).toHaveBeenCalledTimes(1);
    });

    it('should open circuit after failure threshold is exceeded', async () => {
      const retryableError = new Error('ThrottlingException');
      (mockLambdaClient.send as jest.Mock).mockRejectedValue(retryableError);

      const executeWithRetry = (manager as any).executeWithRetry.bind(manager);
      const operation = () => mockLambdaClient.send(new GetLayerVersionCommand({
        LayerName: 'test',
        VersionNumber: 1,
      }));

      // First operation should exhaust retries and fail
      await expect(executeWithRetry(operation)).rejects.toThrow(retryableError);

      // Continue failing to trigger circuit breaker
      for (let i = 0; i < 4; i++) {
        await expect(executeWithRetry(operation)).rejects.toThrow();
      }

      // Circuit should now be open - next call should fail fast
      const startTime = Date.now();
      await expect(executeWithRetry(operation)).rejects.toThrow('Circuit breaker is OPEN');
      const endTime = Date.now();

      // Should fail fast (less than 100ms)
      expect(endTime - startTime).toBeLessThan(100);
    });

    it('should transition to half-open after timeout', async () => {
      // Create manager with short circuit breaker timeout for testing
      const testManager = new AWSLayerManager({
        logger: new NoOpLogger(),
        maxRetries: 1,
        circuitBreakerFailureThreshold: 2,
        circuitBreakerTimeout: 50, // 50ms timeout
        circuitBreakerSuccessThreshold: 1,
      });

      const retryableError = new Error('ThrottlingException');
      (mockLambdaClient.send as jest.Mock).mockRejectedValue(retryableError);

      const executeWithRetry = (testManager as any).executeWithRetry.bind(testManager);
      const operation = () => mockLambdaClient.send(new GetLayerVersionCommand({
        LayerName: 'test',
        VersionNumber: 1,
      }));

      // Trigger circuit breaker to open
      await expect(executeWithRetry(operation)).rejects.toThrow();
      await expect(executeWithRetry(operation)).rejects.toThrow();

      // Circuit should be open
      await expect(executeWithRetry(operation)).rejects.toThrow('Circuit breaker is OPEN');

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 60));

      // Now mock success
      const successResponse = { LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:test:1' };
      (mockLambdaClient.send as jest.Mock).mockResolvedValue(successResponse);

      // Should succeed and close circuit
      const result = await executeWithRetry(operation);
      expect(result).toBe(successResponse);

      testManager.destroy();
    });

    it('should provide circuit breaker state for monitoring', () => {
      const state = manager.getCircuitBreakerState();
      expect(state).toHaveProperty('state');
      expect(state).toHaveProperty('failureCount');
      expect(state).toHaveProperty('successCount');
      expect(typeof state.state).toBe('string');
      expect(typeof state.failureCount).toBe('number');
      expect(typeof state.successCount).toBe('number');
    });
  });

  describe('enhanced error classification', () => {
    it('should identify AWS throttling errors as retryable', () => {
      const isRetryableError = (manager as any).isRetryableError.bind(manager);

      const throttlingErrors = [
        new Error('ThrottlingException'),
        new Error('TooManyRequestsException'),
        new Error('RequestLimitExceeded'),
        new Error('Throttling'),
      ];

      throttlingErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('should identify AWS service errors as retryable', () => {
      const isRetryableError = (manager as any).isRetryableError.bind(manager);

      const serviceErrors = [
        new Error('ServiceUnavailableException'),
        new Error('InternalServerError'),
        new Error('InternalError'),
        new Error('InternalFailure'),
      ];

      serviceErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('should identify network errors as retryable', () => {
      const isRetryableError = (manager as any).isRetryableError.bind(manager);

      const networkErrors = [
        Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' }),
        Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error('DNS lookup failed'), { code: 'ENOTFOUND' }),
        new Error('socket hang up'),
        new Error('connect timeout'),
      ];

      networkErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(true);
      });
    });

    it('should identify non-retryable errors correctly', () => {
      const isRetryableError = (manager as any).isRetryableError.bind(manager);

      const nonRetryableErrors = [
        new Error('ResourceNotFoundException'),
        new Error('ValidationException'),
        new Error('AccessDeniedException'),
        new Error('InvalidParameterValueException'),
      ];

      nonRetryableErrors.forEach(error => {
        expect(isRetryableError(error)).toBe(false);
      });
    });
  });

  describe('pagination with retry logic', () => {
    it('should retry pagination operations on failure', async () => {
      const searchOptions: LayerSearchOptions = {
        layerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
        requirements: {
          nodeVersion: '20.10.0',
          architecture: 'x86_64',
        },
      };

      // Create empty mock async iterator for successful retry
      const mockAsyncIterator = {
        [Symbol.asyncIterator]: async function* () {
          yield { Layers: [] };
        },
      };

      // Mock pagination to fail first, then succeed
      const { paginateListLayers } = require('@aws-sdk/client-lambda');
      let callCount = 0;
      (paginateListLayers as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('ThrottlingException');
        }
        return mockAsyncIterator;
      });

      const result = await manager.findExistingLayer(searchOptions);
      expect(result).toBeNull();
      expect(paginateListLayers).toHaveBeenCalledTimes(2); // Initial call + retry
    });

    it('should clear results on pagination retry', async () => {
      const searchOptions: LayerSearchOptions = {
        layerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
        requirements: {
          nodeVersion: '20.10.0',
          architecture: 'x86_64',
        },
      };

      // Create empty mock async iterator for retry
      const mockAsyncIterator = {
        [Symbol.asyncIterator]: async function* () {
          yield { Layers: [] };
        },
      };

      // Mock pagination to return partial results on first call, then fail and retry
      const { paginateListLayers } = require('@aws-sdk/client-lambda');
      let callCount = 0;
      (paginateListLayers as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Return non-matching results then throw to force a retry
          return {
            async* [Symbol.asyncIterator]() {
              yield {
                Layers: [{
                  LayerName: 'lambda-kata-nodejs-nodejs18.x-x86_64',
                  LatestMatchingVersion: { Version: 1 },
                }],
              };
              throw new Error('ThrottlingException');
            },
          };
        } else {
          // Return empty results on retry
          return mockAsyncIterator;
        }
      });

      const result = await manager.findExistingLayer(searchOptions);
      expect(result).toBeNull();
      expect(paginateListLayers).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry delay calculation', () => {
    it('should calculate exponential backoff with jitter', () => {
      const calculateRetryDelay = (manager as any).calculateRetryDelay.bind(manager);

      const delay0 = calculateRetryDelay(0);
      const delay1 = calculateRetryDelay(1);
      const delay2 = calculateRetryDelay(2);

      // Base delay is 100ms for tests
      expect(delay0).toBeGreaterThanOrEqual(100);
      expect(delay0).toBeLessThan(110); // 100 + 10% jitter

      expect(delay1).toBeGreaterThanOrEqual(200);
      expect(delay1).toBeLessThan(220); // 200 + 10% jitter

      expect(delay2).toBeGreaterThanOrEqual(400);
      expect(delay2).toBeLessThan(440); // 400 + 10% jitter
    });
  });

  describe('enhanced layer size validation and compression optimization', () => {
    const mockTempDir = '/tmp/test-layer-123';
    const mockZipPath = '/tmp/test-layer-123.zip';

    describe('validateLayerSize', () => {
      it('should pass validation for layers within size limits', async () => {
        jest.spyOn(fs, 'stat').mockResolvedValue({ size: 10 * 1024 * 1024 } as any);

        // Mock calculateUnzippedSize to return reasonable size
        const calculateUnzippedSize = jest.fn().mockResolvedValue(50 * 1024 * 1024); // 50MB
        (manager as any).calculateUnzippedSize = calculateUnzippedSize;

        // Access private method for testing
        const validateLayerSize = (manager as any).validateLayerSize.bind(manager);

        await expect(validateLayerSize(mockZipPath)).resolves.not.toThrow();
        expect(calculateUnzippedSize).toHaveBeenCalledWith(mockZipPath);
      });

      it('should throw LAYER_SIZE_EXCEEDED for oversized ZIP', async () => {
        jest.spyOn(fs, 'stat').mockResolvedValue({ size: 60 * 1024 * 1024 } as any);

        const validateLayerSize = (manager as any).validateLayerSize.bind(manager);

        await expect(validateLayerSize(mockZipPath))
          .rejects
          .toThrow(NodeRuntimeLayerError);

        await expect(validateLayerSize(mockZipPath))
          .rejects
          .toMatchObject({
            code: ErrorCodes.LAYER_SIZE_EXCEEDED,
            message: expect.stringContaining('60.00 MB) exceeds AWS Lambda limit (50.00 MB)'),
          });
      });

      it('should throw LAYER_SIZE_EXCEEDED for oversized unzipped content', async () => {
        jest.spyOn(fs, 'stat').mockResolvedValue({ size: 10 * 1024 * 1024 } as any);

        // Mock calculateUnzippedSize to return size exceeding limit
        const calculateUnzippedSize = jest.fn().mockResolvedValue(300 * 1024 * 1024); // 300MB
        (manager as any).calculateUnzippedSize = calculateUnzippedSize;

        const validateLayerSize = (manager as any).validateLayerSize.bind(manager);

        await expect(validateLayerSize(mockZipPath))
          .rejects
          .toThrow(NodeRuntimeLayerError);

        await expect(validateLayerSize(mockZipPath))
          .rejects
          .toMatchObject({
            code: ErrorCodes.LAYER_SIZE_EXCEEDED,
            message: expect.stringContaining('300.00 MB) exceeds AWS Lambda limit (250.00 MB)'),
          });
      });

      it('should provide detailed error messages with optimization suggestions', async () => {
        jest.spyOn(fs, 'stat').mockResolvedValue({ size: 60 * 1024 * 1024 } as any);

        const validateLayerSize = (manager as any).validateLayerSize.bind(manager);

        await expect(validateLayerSize(mockZipPath))
          .rejects
          .toThrow('Consider optimizing the layer contents');
      });

      it('should log comprehensive size analysis metrics', async () => {
        jest.spyOn(fs, 'stat').mockResolvedValue({ size: 10 * 1024 * 1024 } as any);

        const calculateUnzippedSize = jest.fn().mockResolvedValue(50 * 1024 * 1024); // 50MB
        (manager as any).calculateUnzippedSize = calculateUnzippedSize;

        const validateLayerSize = (manager as any).validateLayerSize.bind(manager);

        // Spy on logger to verify metrics are logged
        const loggerSpy = jest.spyOn(consoleLogger, 'info');

        await validateLayerSize(mockZipPath);

        expect(loggerSpy).toHaveBeenCalledWith(
          'Layer size validation passed',
          expect.objectContaining({
            zipSize: 10 * 1024 * 1024,
            unzippedSize: 50 * 1024 * 1024,
            compressionRatio: expect.stringContaining('%'),
            zipUtilization: expect.stringContaining('%'),
            unzippedUtilization: expect.stringContaining('%'),
          }),
        );
      });
    });

    describe('calculateUnzippedSize', () => {
      it('should calculate unzipped size using Python zipfile', async () => {
        // Mock executeCommandWithOutput to return size
        const mockOutput = { stdout: '52428800\n', stderr: '' }; // 50MB
        const executeCommandWithOutput = jest.fn().mockResolvedValue(mockOutput);
        (manager as any).executeCommandWithOutput = executeCommandWithOutput;

        const calculateUnzippedSize = (manager as any).calculateUnzippedSize.bind(manager);

        const result = await calculateUnzippedSize(mockZipPath);

        expect(result).toBe(52428800);
        expect(executeCommandWithOutput).toHaveBeenCalledWith('python3', expect.arrayContaining(['-c']));
      });

      it('should use fallback estimation when Python fails', async () => {
        jest.spyOn(fs, 'stat').mockResolvedValue({ size: 10 * 1024 * 1024 } as any);

        // Mock executeCommandWithOutput to fail
        const executeCommandWithOutput = jest.fn().mockRejectedValue(new Error('Python not available'));
        (manager as any).executeCommandWithOutput = executeCommandWithOutput;

        const calculateUnzippedSize = (manager as any).calculateUnzippedSize.bind(manager);

        const result = await calculateUnzippedSize(mockZipPath);

        // Should return 2x the ZIP size as conservative estimate
        expect(result).toBe(20 * 1024 * 1024);
      });

      it('should handle invalid Python output gracefully', async () => {
        jest.spyOn(fs, 'stat').mockResolvedValue({ size: 10 * 1024 * 1024 } as any);

        // Mock executeCommandWithOutput to return invalid output
        const mockOutput = { stdout: 'invalid_number\n', stderr: '' };
        const executeCommandWithOutput = jest.fn().mockResolvedValue(mockOutput);
        (manager as any).executeCommandWithOutput = executeCommandWithOutput;

        const calculateUnzippedSize = (manager as any).calculateUnzippedSize.bind(manager);

        const result = await calculateUnzippedSize(mockZipPath);

        // Should fall back to estimation
        expect(result).toBe(20 * 1024 * 1024);
      });
    });

    describe('createLayerZipArchive with optimization', () => {
      it('should create optimized ZIP with compression metrics', async () => {
        jest.spyOn(fs, 'stat').mockResolvedValue({ size: 5 * 1024 * 1024 } as any);

        // Mock calculateDirectorySize
        const calculateDirectorySize = jest.fn().mockResolvedValue(20 * 1024 * 1024); // 20MB original
        (manager as any).calculateDirectorySize = calculateDirectorySize;

        // Mock executeCommand to succeed
        const executeCommand = jest.fn().mockResolvedValue(undefined);
        (manager as any).executeCommand = executeCommand;

        const createLayerZipArchive = (manager as any).createLayerZipArchive.bind(manager);

        const result = await createLayerZipArchive(mockTempDir, 'test-layer');

        expect(result).toBe('/tmp/test-layer.zip'); // Note: different path structure
        expect(calculateDirectorySize).toHaveBeenCalledWith(mockTempDir);
        expect(executeCommand).toHaveBeenCalledWith('python3', expect.arrayContaining(['-c']));
      });

      it('should log detailed compression optimization metrics', async () => {
        jest.spyOn(fs, 'stat').mockResolvedValue({ size: 5 * 1024 * 1024 } as any);

        const calculateDirectorySize = jest.fn().mockResolvedValue(20 * 1024 * 1024); // 20MB original
        (manager as any).calculateDirectorySize = calculateDirectorySize;

        const executeCommand = jest.fn().mockResolvedValue(undefined);
        (manager as any).executeCommand = executeCommand;

        const createLayerZipArchive = (manager as any).createLayerZipArchive.bind(manager);

        // Spy on logger to verify optimization metrics are logged
        const loggerSpy = jest.spyOn(consoleLogger, 'info');

        await createLayerZipArchive(mockTempDir, 'test-layer');

        expect(loggerSpy).toHaveBeenCalledWith(
          'ZIP creation with compression optimization completed',
          expect.objectContaining({
            originalSize: 20 * 1024 * 1024,
            compressedSize: 5 * 1024 * 1024,
            compressionRatio: '75.0%',
            spaceSaved: 15 * 1024 * 1024,
            spaceSavedMB: '15.00',
            finalSizeMB: '5.00',
          }),
        );
      });

      it('should fall back to simple ZIP creation when optimization fails', async () => {
        // Mock executeCommand to fail for optimization
        const executeCommand = jest.fn().mockRejectedValue(new Error('Python optimization failed'));
        (manager as any).executeCommand = executeCommand;

        // Mock createZipFallback to succeed
        const createZipFallback = jest.fn().mockResolvedValue(mockZipPath);
        (manager as any).createZipFallback = createZipFallback;

        const createLayerZipArchive = (manager as any).createLayerZipArchive.bind(manager);

        const result = await createLayerZipArchive(mockTempDir, 'test-layer');

        expect(result).toBe(mockZipPath);
        expect(createZipFallback).toHaveBeenCalledWith(mockTempDir, '/tmp/test-layer.zip');
      });
    });

    describe('calculateDirectorySize', () => {
      it('should calculate total size of all files in directory', async () => {
        // Mock directory structure
        const mockDirents = [
          { name: 'file1.txt', isFile: () => true, isDirectory: () => false },
          { name: 'file2.bin', isFile: () => true, isDirectory: () => false },
          { name: 'subdir', isFile: () => false, isDirectory: () => true },
        ];

        jest.spyOn(fs, 'readdir').mockImplementation(async (dirPath: any) => {
          if (dirPath === mockTempDir) {
            return mockDirents as any;
          }
          return [] as any;
        });

        jest.spyOn(fs, 'stat').mockImplementation(async (itemPath: any) => {
          if (String(itemPath).endsWith('file1.txt')) {
            return { size: 1024 } as any;
          }
          if (String(itemPath).endsWith('file2.bin')) {
            return { size: 2048 } as any;
          }
          return { size: 512 } as any;
        });

        const calculateDirectorySize = (manager as any).calculateDirectorySize.bind(manager);
        const result = await calculateDirectorySize(mockTempDir);

        expect(result).toBe(3072);
      });

      it('should handle directory read errors gracefully', async () => {
        jest.spyOn(fs, 'readdir').mockRejectedValue(new Error('Permission denied'));

        const calculateDirectorySize = (manager as any).calculateDirectorySize.bind(manager);

        const result = await calculateDirectorySize(mockTempDir);

        expect(result).toBe(0);
      });
    });

    describe('executeCommandWithOutput', () => {
      it('should capture and return command output', async () => {
        const executeCommandWithOutput = (manager as any).executeCommandWithOutput.bind(manager);

        // Mock spawn to simulate successful command execution
        const mockProcess = {
          stdout: {
            on: jest.fn((event, callback) => {
              if (event === 'data') {
                setTimeout(() => callback(Buffer.from('test output\n')), 10);
              }
            }),
          },
          stderr: {
            on: jest.fn((event, callback) => {
              if (event === 'data') {
                setTimeout(() => callback(Buffer.from('test error\n')), 10);
              }
            }),
          },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              setTimeout(() => callback(0), 20); // Exit code 0
            }
          }),
        };

        const { spawn } = require('child_process');
        spawn.mockReturnValue(mockProcess);

        const result = await executeCommandWithOutput('echo', ['test']);

        expect(result.stdout).toBe('test output\n');
        expect(result.stderr).toBe('test error\n');
      });

      it('should reject on command failure', async () => {
        const executeCommandWithOutput = (manager as any).executeCommandWithOutput.bind(manager);

        // Mock spawn to simulate failed command execution
        const mockProcess = {
          stdout: { on: jest.fn() },
          stderr: {
            on: jest.fn((event, callback) => {
              if (event === 'data') {
                setTimeout(() => callback(Buffer.from('command failed\n')), 10);
              }
            }),
          },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              setTimeout(() => callback(1), 20); // Exit code 1
            }
          }),
        };

        const { spawn } = require('child_process');
        spawn.mockReturnValue(mockProcess);

        await expect(executeCommandWithOutput('false', []))
          .rejects
          .toThrow('command failed');
      });

      it('should handle command timeout', async () => {
        const executeCommandWithOutput = (manager as any).executeCommandWithOutput.bind(manager);

        // Mock spawn to simulate hanging command
        const mockProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn(), // Never calls close callback
          kill: jest.fn(),
        };

        const { spawn } = require('child_process');
        spawn.mockReturnValue(mockProcess);

        // Use shorter timeout for test
        const originalTimeout = (manager as any).constructor.DOCKER_TIMEOUT;
        (manager as any).constructor.DOCKER_TIMEOUT = 100;

        await expect(executeCommandWithOutput('sleep', ['10']))
          .rejects
          .toThrow('Command timeout after 100ms');

        expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

        // Restore original timeout
        (manager as any).constructor.DOCKER_TIMEOUT = originalTimeout;
      }, 1000);
    });
  });

  describe('destroy', () => {
    it('should destroy Lambda client', () => {
      manager.destroy();
      expect(mockLambdaClient.destroy).toHaveBeenCalledTimes(1);
    });
  });
});

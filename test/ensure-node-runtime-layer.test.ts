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
 * Unit tests for ensureNodeRuntimeLayer function
 *
 * Tests the main API function for parameter validation, component integration,
 * and result construction. Uses mocks to isolate the function logic from
 * external dependencies.
 */

import { ensureNodeRuntimeLayer } from '../src/ensure-node-runtime-layer';
import {
  EnsureNodeRuntimeLayerOptions,
  ErrorCodes,
  LayerInfo,
  NodeRuntimeLayerError,
  NodeVersionInfo,
} from '../src/nodejs-layer-manager';
import { DockerRuntimeDetector } from '../src/docker-runtime-detector';
import { AWSLayerManager } from '../src/aws-layer-manager';
import { ConsoleLogger } from '../src/logger';

// Mock the dependencies
jest.mock('../src/docker-runtime-detector');
jest.mock('../src/aws-layer-manager');

const MockedDockerRuntimeDetector = DockerRuntimeDetector as jest.MockedClass<typeof DockerRuntimeDetector>;
const MockedAWSLayerManager = AWSLayerManager as jest.MockedClass<typeof AWSLayerManager>;

describe('ensureNodeRuntimeLayer', () => {
  let mockRuntimeDetector: jest.Mocked<DockerRuntimeDetector>;
  let mockLayerManager: jest.Mocked<AWSLayerManager>;

  const validOptions: EnsureNodeRuntimeLayerOptions = {
    runtimeName: 'nodejs20.x',
    architecture: 'x86_64',
    region: 'us-east-1',
    accountId: '123456789012',
  };

  const mockVersionInfo: NodeVersionInfo = {
    version: '20.10.0',
    runtimeName: 'nodejs20.x',
    dockerImage: 'public.ecr.aws/lambda/nodejs:20-x86_64',
  };

  const mockLayerInfo: LayerInfo = {
    arn: 'arn:aws:lambda:us-east-1:123456789012:layer:lambda-kata-nodejs-nodejs20.x-x86_64:1',
    name: 'lambda-kata-nodejs-nodejs20.x-x86_64',
    version: 1,
    nodeVersion: '20.10.0',
    architecture: 'x86_64',
    createdDate: new Date('2025-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock instances
    mockRuntimeDetector = {
      detectNodeVersion: jest.fn(),
    } as any;

    mockLayerManager = {
      findExistingLayer: jest.fn(),
      createNodeLayer: jest.fn(),
      validateLayerCompatibility: jest.fn(),
    } as any;

    // Configure constructor mocks
    MockedDockerRuntimeDetector.mockImplementation(() => mockRuntimeDetector);
    MockedAWSLayerManager.mockImplementation(() => mockLayerManager);
  });

  describe('Parameter Validation', () => {
    it('should throw error for missing options', async () => {
      await expect(ensureNodeRuntimeLayer(null as any))
        .rejects
        .toThrow('Options parameter is required');
    });

    it('should throw error for missing runtimeName', async () => {
      const options = { ...validOptions };
      delete (options as any).runtimeName;

      await expect(ensureNodeRuntimeLayer(options))
        .rejects
        .toThrow(new NodeRuntimeLayerError(
          'runtimeName is required and must be a non-empty string',
          ErrorCodes.RUNTIME_UNSUPPORTED,
        ));
    });

    it('should throw error for unsupported runtime', async () => {
      const options = { ...validOptions, runtimeName: 'nodejs16.x' };

      await expect(ensureNodeRuntimeLayer(options))
        .rejects
        .toThrow(new NodeRuntimeLayerError(
          'Unsupported runtime: nodejs16.x. Supported runtimes: nodejs18.x, nodejs20.x, nodejs22.x',
          ErrorCodes.RUNTIME_UNSUPPORTED,
        ));
    });

    it('should throw error for missing architecture', async () => {
      const options = { ...validOptions };
      delete (options as any).architecture;

      await expect(ensureNodeRuntimeLayer(options))
        .rejects
        .toThrow(new NodeRuntimeLayerError(
          'architecture is required and must be a non-empty string',
          ErrorCodes.INVALID_ARCHITECTURE,
        ));
    });

    it('should throw error for unsupported architecture', async () => {
      const options = { ...validOptions, architecture: 'unsupported' as any };

      await expect(ensureNodeRuntimeLayer(options))
        .rejects
        .toThrow(new NodeRuntimeLayerError(
          'Unsupported architecture: unsupported. Supported architectures: x86_64, arm64',
          ErrorCodes.INVALID_ARCHITECTURE,
        ));
    });

    it('should throw error for missing region', async () => {
      const options = { ...validOptions };
      delete (options as any).region;

      await expect(ensureNodeRuntimeLayer(options))
        .rejects
        .toThrow(new NodeRuntimeLayerError(
          'region is required and must be a non-empty string',
          ErrorCodes.INTERNAL_ERROR,
        ));
    });

    it('should throw error for invalid region format', async () => {
      const options = { ...validOptions, region: 'INVALID_REGION!' };

      await expect(ensureNodeRuntimeLayer(options))
        .rejects
        .toThrow(new NodeRuntimeLayerError(
          'Invalid region format: INVALID_REGION!. Region must contain only lowercase letters, numbers, and hyphens',
          ErrorCodes.INTERNAL_ERROR,
        ));
    });

    it('should throw error for missing accountId', async () => {
      const options = { ...validOptions };
      delete (options as any).accountId;

      await expect(ensureNodeRuntimeLayer(options))
        .rejects
        .toThrow(new NodeRuntimeLayerError(
          'accountId is required and must be a non-empty string',
          ErrorCodes.INTERNAL_ERROR,
        ));
    });

    it('should throw error for invalid accountId format', async () => {
      const options = { ...validOptions, accountId: '12345' };

      await expect(ensureNodeRuntimeLayer(options))
        .rejects
        .toThrow(new NodeRuntimeLayerError(
          'Invalid AWS account ID format: 12345. Account ID must be exactly 12 digits',
          ErrorCodes.INTERNAL_ERROR,
        ));
    });

    it('should throw error for invalid awsSdkConfig type', async () => {
      const options = { ...validOptions, awsSdkConfig: 'invalid' as any };

      await expect(ensureNodeRuntimeLayer(options))
        .rejects
        .toThrow(new NodeRuntimeLayerError(
          'awsSdkConfig must be an object if provided',
          ErrorCodes.INTERNAL_ERROR,
        ));
    });

    it('should throw error for invalid logger type', async () => {
      const options = { ...validOptions, logger: 'invalid' as any };

      await expect(ensureNodeRuntimeLayer(options))
        .rejects
        .toThrow('logger must be an object implementing the Logger interface if provided');
    });

    it('should throw error for logger missing required methods', async () => {
      const options = { ...validOptions, logger: { debug: 'not a function' } as any };

      await expect(ensureNodeRuntimeLayer(options))
        .rejects
        .toThrow('logger must implement debug() method');
    });

    it('should accept valid parameters', async () => {
      // Setup mocks for successful execution
      mockRuntimeDetector.detectNodeVersion.mockResolvedValue(mockVersionInfo);
      mockLayerManager.findExistingLayer.mockResolvedValue(mockLayerInfo);

      const options = {
        ...validOptions,
        awsSdkConfig: { region: 'us-west-2' },
        logger: new ConsoleLogger(),
      };

      const result = await ensureNodeRuntimeLayer(options);

      expect(result).toBeDefined();
      expect(result.runtimeName).toBe('nodejs20.x');
    });
  });

  describe('Component Integration', () => {
    beforeEach(() => {
      mockRuntimeDetector.detectNodeVersion.mockResolvedValue(mockVersionInfo);
    });

    it('should use existing layer when compatible layer found', async () => {
      mockLayerManager.findExistingLayer.mockResolvedValue(mockLayerInfo);

      const result = await ensureNodeRuntimeLayer(validOptions);

      expect(mockRuntimeDetector.detectNodeVersion).toHaveBeenCalledWith('nodejs20.x', 'x86_64');
      expect(mockLayerManager.findExistingLayer).toHaveBeenCalledWith({
        layerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
        requirements: {
          nodeVersion: '20.10.0',
          architecture: 'x86_64',
        },
      });
      expect(mockLayerManager.createNodeLayer).not.toHaveBeenCalled();

      expect(result).toEqual({
        layerArn: mockLayerInfo.arn,
        layerName: mockLayerInfo.name,
        runtimeName: 'nodejs20.x',
        nodeVersion: '20.10.0',
        architecture: 'x86_64',
        created: false,
      });
    });

    it('should create new layer when no compatible layer found', async () => {
      mockLayerManager.findExistingLayer.mockResolvedValue(null);
      mockLayerManager.createNodeLayer.mockResolvedValue(mockLayerInfo);

      const result = await ensureNodeRuntimeLayer(validOptions);

      expect(mockLayerManager.findExistingLayer).toHaveBeenCalled();
      expect(mockLayerManager.createNodeLayer).toHaveBeenCalledWith({
        layerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
        nodeVersion: '20.10.0',
        architecture: 'x86_64',
        region: 'us-east-1',
        description: 'Node.js 20.10.0 runtime binary for Lambda Kata (x86_64)',
      });

      expect(result).toEqual({
        layerArn: mockLayerInfo.arn,
        layerName: mockLayerInfo.name,
        runtimeName: 'nodejs20.x',
        nodeVersion: '20.10.0',
        architecture: 'x86_64',
        created: true,
      });
    });

    it('should pass AWS SDK config to layer manager', async () => {
      const awsSdkConfig = { region: 'us-west-2' };
      const options = { ...validOptions, awsSdkConfig };

      mockLayerManager.findExistingLayer.mockResolvedValue(mockLayerInfo);

      await ensureNodeRuntimeLayer(options);

      expect(MockedAWSLayerManager).toHaveBeenCalledWith({
        awsSdkConfig,
        logger: expect.any(Object),
      });
    });

    it('should pass logger to components', async () => {
      const logger = new ConsoleLogger();
      const options = { ...validOptions, logger };

      mockLayerManager.findExistingLayer.mockResolvedValue(mockLayerInfo);

      await ensureNodeRuntimeLayer(options);

      expect(MockedDockerRuntimeDetector).toHaveBeenCalledWith({ logger });
      expect(MockedAWSLayerManager).toHaveBeenCalledWith({
        awsSdkConfig: undefined,
        logger,
      });
    });
  });

  describe('Error Handling', () => {
    it('should propagate NodeRuntimeLayerError from runtime detector', async () => {
      const error = new NodeRuntimeLayerError(
        'Docker not available',
        ErrorCodes.DOCKER_UNAVAILABLE,
      );
      mockRuntimeDetector.detectNodeVersion.mockRejectedValue(error);

      await expect(ensureNodeRuntimeLayer(validOptions))
        .rejects
        .toThrow(error);
    });

    it('should propagate NodeRuntimeLayerError from layer manager', async () => {
      mockRuntimeDetector.detectNodeVersion.mockResolvedValue(mockVersionInfo);

      const error = new NodeRuntimeLayerError(
        'AWS API error',
        ErrorCodes.AWS_API_ERROR,
      );
      mockLayerManager.findExistingLayer.mockRejectedValue(error);

      await expect(ensureNodeRuntimeLayer(validOptions))
        .rejects
        .toThrow(error);
    });

    it('should wrap generic errors in NodeRuntimeLayerError', async () => {
      mockRuntimeDetector.detectNodeVersion.mockRejectedValue(new Error('Generic error'));

      await expect(ensureNodeRuntimeLayer(validOptions))
        .rejects
        .toThrow('Failed to ensure Node.js runtime layer: Generic error');
    });

    it('should wrap non-Error objects in NodeRuntimeLayerError', async () => {
      mockRuntimeDetector.detectNodeVersion.mockRejectedValue('String error');

      await expect(ensureNodeRuntimeLayer(validOptions))
        .rejects
        .toThrow('Failed to ensure Node.js runtime layer: String error');
    });
  });

  describe('Layer Name Generation', () => {
    beforeEach(() => {
      mockRuntimeDetector.detectNodeVersion.mockResolvedValue(mockVersionInfo);
      mockLayerManager.findExistingLayer.mockResolvedValue(mockLayerInfo);
    });

    it('should generate correct layer name for nodejs18.x x86_64', async () => {
      const options = { ...validOptions, runtimeName: 'nodejs18.x' };

      await ensureNodeRuntimeLayer(options);

      expect(mockLayerManager.findExistingLayer).toHaveBeenCalledWith({
        layerName: 'lambda-kata-nodejs-nodejs18.x-x86_64',
        requirements: expect.any(Object),
      });
    });

    it('should generate correct layer name for nodejs22.x arm64', async () => {
      const options = { ...validOptions, runtimeName: 'nodejs22.x', architecture: 'arm64' as const };

      await ensureNodeRuntimeLayer(options);

      expect(mockLayerManager.findExistingLayer).toHaveBeenCalledWith({
        layerName: 'lambda-kata-nodejs-nodejs22.x-arm64',
        requirements: expect.any(Object),
      });
    });
  });

  describe('Result Construction', () => {
    it('should construct correct result for existing layer', async () => {
      mockRuntimeDetector.detectNodeVersion.mockResolvedValue(mockVersionInfo);
      mockLayerManager.findExistingLayer.mockResolvedValue(mockLayerInfo);

      const result = await ensureNodeRuntimeLayer(validOptions);

      expect(result).toEqual({
        layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:lambda-kata-nodejs-nodejs20.x-x86_64:1',
        layerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
        runtimeName: 'nodejs20.x',
        nodeVersion: '20.10.0',
        architecture: 'x86_64',
        created: false,
      });
    });

    it('should construct correct result for new layer', async () => {
      mockRuntimeDetector.detectNodeVersion.mockResolvedValue(mockVersionInfo);
      mockLayerManager.findExistingLayer.mockResolvedValue(null);
      mockLayerManager.createNodeLayer.mockResolvedValue(mockLayerInfo);

      const result = await ensureNodeRuntimeLayer(validOptions);

      expect(result).toEqual({
        layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:lambda-kata-nodejs-nodejs20.x-x86_64:1',
        layerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
        runtimeName: 'nodejs20.x',
        nodeVersion: '20.10.0',
        architecture: 'x86_64',
        created: true,
      });
    });
  });
});

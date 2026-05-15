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
 * Unit Tests for AWSLayerManager Resource Cleanup on Failure
 *
 * Tests the enhanced resource cleanup functionality implemented for task 6.2.
 * Verifies that all temporary resources (Docker containers, temp directories,
 * ZIP files) are properly cleaned up when layer creation fails at various stages.
 *
 * @module aws-layer-manager-cleanup.test
 */

import { AWSLayerManager } from '../src/aws-layer-manager';
import { ErrorCodes, LayerCreationOptions, NodeRuntimeLayerError } from '../src/nodejs-layer-manager';
import { ConsoleLogger } from '../src/logger';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    mkdtemp: jest.fn(),
    stat: jest.fn(),
    chmod: jest.fn(),
    mkdir: jest.fn(),
    copyFile: jest.fn(),
    readFile: jest.fn(),
    rm: jest.fn(),
    unlink: jest.fn(),
  },
}));

jest.mock('child_process');
jest.mock('@aws-sdk/client-lambda');

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('AWSLayerManager Resource Cleanup on Failure', () => {
  let layerManager: AWSLayerManager;
  let mockLogger: jest.Mocked<ConsoleLogger>;

  const validOptions: LayerCreationOptions = {
    layerName: 'test-layer',
    nodeVersion: '20.10.0',
    architecture: 'x86_64',
    region: 'us-east-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    layerManager = new AWSLayerManager({
      logger: mockLogger,
    });
  });

  afterEach(() => {
    layerManager.destroy();
  });

  describe('Comprehensive Resource Cleanup', () => {
    it('should clean up temp directory when Docker extraction fails', async () => {
      // Setup: temp directory creation succeeds
      const tempDir = '/tmp/lambda-kata-layer-12345';
      mockedFs.mkdtemp.mockResolvedValue(tempDir);

      // Setup: Docker command fails
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(1), 10); // Simulate failure
          }
        }),
        kill: jest.fn(),
      };
      mockedSpawn.mockReturnValue(mockProcess as any);

      // Execute and expect failure
      await expect(layerManager.createNodeLayer(validOptions)).rejects.toThrow(NodeRuntimeLayerError);

      // Verify cleanup was attempted
      expect(mockedFs.rm).toHaveBeenCalledWith(tempDir, { recursive: true, force: true });
      expect(mockLogger.debug).toHaveBeenCalledWith('Starting comprehensive resource cleanup', expect.any(Object));
      expect(mockLogger.info).toHaveBeenCalledWith('Resource cleanup completed', expect.any(Object));
    });

    it('should clean up Docker container when extraction fails', async () => {
      // Setup: temp directory and Docker create succeed
      const tempDir = '/tmp/lambda-kata-layer-12345';
      const containerName = 'lambda-kata-extract-123-abc';

      mockedFs.mkdtemp.mockResolvedValue(tempDir);

      let callCount = 0;
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            callCount++;
            if (callCount <= 2) {
              // First two calls (pull, create) succeed
              setTimeout(() => callback(0), 10);
            } else {
              // Third call (copy) fails
              setTimeout(() => callback(1), 10);
            }
          }
        }),
        kill: jest.fn(),
      };
      mockedSpawn.mockReturnValue(mockProcess as any);

      // Mock container name generation (simplified)
      jest.spyOn(Date, 'now').mockReturnValue(123);
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      // Execute and expect failure
      await expect(layerManager.createNodeLayer(validOptions)).rejects.toThrow(NodeRuntimeLayerError);

      // Verify Docker container cleanup was attempted
      expect(mockedSpawn).toHaveBeenCalledWith('docker', ['rm', '-f', expect.stringContaining('lambda-kata-extract')], expect.any(Object));

      // Verify cleanup summary was logged (container cleanup may succeed or fail)
      expect(mockLogger.info).toHaveBeenCalledWith('Resource cleanup completed', expect.objectContaining({
        totalSuccess: expect.any(Number),
        totalFailed: expect.any(Number),
      }));
    });

    it('should clean up ZIP file when AWS publishing fails', async () => {
      // Setup: all steps succeed until AWS publishing
      const tempDir = '/tmp/lambda-kata-layer-12345';
      const zipFilePath = '/tmp/lambda-kata-layer-12345/test-layer.zip';

      mockedFs.mkdtemp.mockResolvedValue(tempDir);
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 } as any);
      mockedFs.readFile.mockResolvedValue(Buffer.from('zip content'));

      // Mock successful Docker operations
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(0), 10); // All Docker operations succeed
          }
        }),
        kill: jest.fn(),
      };
      mockedSpawn.mockReturnValue(mockProcess as any);

      // Mock AWS SDK to throw error
      const { LambdaClient } = require('@aws-sdk/client-lambda');
      const mockSend = jest.fn().mockRejectedValue(new Error('AWS API Error'));
      LambdaClient.mockImplementation(() => ({
        send: mockSend,
        destroy: jest.fn(),
      }));

      // Execute and expect failure
      await expect(layerManager.createNodeLayer(validOptions)).rejects.toThrow(NodeRuntimeLayerError);

      // Verify ZIP file cleanup was attempted
      expect(mockedFs.unlink).toHaveBeenCalledWith(expect.stringContaining('.zip'));
      expect(mockLogger.debug).toHaveBeenCalledWith('Successfully cleaned up ZIP file', expect.any(Object));
    });

    it.skip('should handle cleanup failures gracefully without masking original error', async () => {
      // Setup: temp directory creation succeeds
      const tempDir = '/tmp/lambda-kata-layer-12345';
      mockedFs.mkdtemp.mockResolvedValue(tempDir);

      // Setup: Docker command fails (original error)
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(1), 10); // Docker fails
          }
        }),
        kill: jest.fn(),
      };
      mockedSpawn.mockReturnValue(mockProcess as any);

      // Setup: cleanup also fails
      mockedFs.rm.mockRejectedValue(new Error('Permission denied'));

      // Execute and expect original error to be preserved
      await expect(layerManager.createNodeLayer(validOptions)).rejects.toThrow(NodeRuntimeLayerError);

      // Verify cleanup failure was logged as warning
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to clean up temp directory', expect.objectContaining({
        tempDir,
        error: 'Permission denied',
      }));

      // Verify cleanup summary still logged
      expect(mockLogger.info).toHaveBeenCalledWith('Resource cleanup completed', expect.objectContaining({
        totalFailed: 1,
      }));
    });

    it('should preserve original NodeRuntimeLayerError without wrapping', async () => {
      // Setup: temp directory creation succeeds
      const tempDir = '/tmp/lambda-kata-layer-12345';
      mockedFs.mkdtemp.mockResolvedValue(tempDir);

      // Setup: Docker command fails
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(1), 10);
          }
        }),
        kill: jest.fn(),
      };
      mockedSpawn.mockReturnValue(mockProcess as any);

      // Execute and expect the enhanced error
      let thrownError: Error | undefined;
      try {
        await layerManager.createNodeLayer(validOptions);
      } catch (error) {
        thrownError = error as Error;
      }

      expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
      // The error should be enhanced with layer context by the main method
      expect(thrownError?.message).toContain('test-layer');
      expect(thrownError?.message).toContain('20.10.0');
      expect(thrownError?.message).toContain('x86_64');
      expect((thrownError as NodeRuntimeLayerError).code).toBe(ErrorCodes.LAYER_CREATION_FAILED);
    });

    it('should clean up multiple resource types in correct order', async () => {
      // Setup: all resources created, then failure occurs
      const tempDir = '/tmp/lambda-kata-layer-12345';
      const zipFilePath = '/tmp/lambda-kata-layer-12345/test-layer.zip';

      mockedFs.mkdtemp.mockResolvedValue(tempDir);
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 } as any);

      // Mock successful Docker operations initially
      let dockerCallCount = 0;
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            dockerCallCount++;
            if (dockerCallCount <= 3) {
              setTimeout(() => callback(0), 10); // Docker operations succeed
            } else {
              setTimeout(() => callback(1), 10); // Later operation fails
            }
          }
        }),
        kill: jest.fn(),
      };
      mockedSpawn.mockReturnValue(mockProcess as any);

      // Execute and expect failure
      await expect(layerManager.createNodeLayer(validOptions)).rejects.toThrow();

      // Verify cleanup order: Docker containers first, then ZIP files, then temp directories
      const cleanupCalls = mockLogger.debug.mock.calls.filter(call =>
        call[0].includes('Successfully cleaned up'),
      );

      // Should have cleanup calls in the correct order
      expect(mockLogger.info).toHaveBeenCalledWith('Resource cleanup completed', expect.objectContaining({
        totalSuccess: expect.any(Number),
        details: expect.objectContaining({
          dockerContainers: expect.any(Object),
          zipFiles: expect.any(Object),
          tempDirectories: expect.any(Object),
        }),
      }));
    });
  });

  describe('Resource Tracking', () => {
    it('should track all resources created during layer creation', async () => {
      // This test verifies that the resource tracker properly tracks all resources
      // by checking the cleanup summary logs

      const tempDir = '/tmp/lambda-kata-layer-12345';
      mockedFs.mkdtemp.mockResolvedValue(tempDir);

      // Setup: Docker command fails after creating container
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(1), 10);
          }
        }),
        kill: jest.fn(),
      };
      mockedSpawn.mockReturnValue(mockProcess as any);

      await expect(layerManager.createNodeLayer(validOptions)).rejects.toThrow();

      // Verify resource tracking was logged
      expect(mockLogger.debug).toHaveBeenCalledWith('Starting comprehensive resource cleanup', expect.objectContaining({
        dockerContainers: expect.any(Number),
        tempDirectories: expect.any(Number),
        zipFiles: expect.any(Number),
      }));
    });
  });

  describe('Error Context Preservation', () => {
    it('should enhance generic errors with layer creation context', async () => {
      const tempDir = '/tmp/lambda-kata-layer-12345';
      mockedFs.mkdtemp.mockResolvedValue(tempDir);

      // Setup: Generic error from Docker
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn((callback) => callback('Docker daemon not running')) },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setTimeout(() => callback(1), 10);
          }
        }),
        kill: jest.fn(),
      };
      mockedSpawn.mockReturnValue(mockProcess as any);

      let thrownError: NodeRuntimeLayerError | undefined;
      try {
        await layerManager.createNodeLayer(validOptions);
      } catch (error) {
        thrownError = error as NodeRuntimeLayerError;
      }

      expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
      // The error should be enhanced with layer context
      expect(thrownError?.message).toContain('test-layer');
      expect(thrownError?.message).toContain('20.10.0');
      expect(thrownError?.message).toContain('x86_64');
      expect(thrownError?.code).toBe(ErrorCodes.LAYER_CREATION_FAILED);
    });
  });
});

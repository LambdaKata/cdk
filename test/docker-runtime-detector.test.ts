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
 * Unit tests for DockerRuntimeDetector
 *
 * Tests the Docker-based Node.js runtime version detection functionality,
 * including caching, fallback behavior, and error handling.
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import {
  DockerRuntimeDetector,
  DockerRuntimeDetectorOptions,
  ErrorCodes,
  Logger,
  NodeRuntimeLayerError,
} from '../src';

// Mock child_process.spawn
jest.mock('child_process');
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('DockerRuntimeDetector', () => {
  let detector: DockerRuntimeDetector;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    detector = new DockerRuntimeDetector({
      logger: mockLogger,
      cacheTtl: 1000, // 1 second for testing
      dockerTimeout: 5000, // 5 seconds for testing
    });
  });

  describe('Constructor and Configuration', () => {
    it('should create detector with default options', () => {
      const defaultDetector = new DockerRuntimeDetector();
      expect(defaultDetector).toBeInstanceOf(DockerRuntimeDetector);
      expect(defaultDetector.getCacheSize()).toBe(0);
    });

    it('should create detector with custom options', () => {
      const options: DockerRuntimeDetectorOptions = {
        cacheTtl: 5000,
        dockerTimeout: 10000,
        logger: mockLogger,
        enableFallback: false,
      };

      const customDetector = new DockerRuntimeDetector(options);
      expect(customDetector).toBeInstanceOf(DockerRuntimeDetector);
    });
  });

  describe('Input Validation', () => {
    it('should reject unsupported runtime names', async () => {
      await expect(detector.detectNodeVersion('nodejs16.x', 'x86_64'))
        .rejects
        .toThrow(NodeRuntimeLayerError);

      await expect(detector.detectNodeVersion('nodejs16.x', 'x86_64'))
        .rejects
        .toMatchObject({
          code: ErrorCodes.RUNTIME_UNSUPPORTED,
          message: expect.stringContaining('Unsupported runtime: nodejs16.x'),
        });
    });

    it('should reject unsupported architectures', async () => {
      await expect(detector.detectNodeVersion('nodejs20.x', 'arm32'))
        .rejects
        .toThrow(NodeRuntimeLayerError);

      await expect(detector.detectNodeVersion('nodejs20.x', 'arm32'))
        .rejects
        .toMatchObject({
          code: ErrorCodes.INVALID_ARCHITECTURE,
          message: expect.stringContaining('Unsupported architecture: arm32'),
        });
    });

    it('should accept supported runtime and architecture combinations', async () => {
      // Mock successful Docker operations
      mockSuccessfulDockerOperations('20.10.0');

      const result = await detector.detectNodeVersion('nodejs20.x', 'x86_64');
      expect(result.runtimeName).toBe('nodejs20.x');
      expect(result.version).toBe('20.10.0');
    });
  });

  describe('Docker Image Name Generation', () => {
    it('should generate correct Docker image names', async () => {
      mockSuccessfulDockerOperations('20.10.0');

      await detector.detectNodeVersion('nodejs20.x', 'x86_64');

      // Verify docker pull was called with correct image
      expect(mockSpawn).toHaveBeenCalledWith('docker', ['pull', 'public.ecr.aws/lambda/nodejs:20-x86_64'], expect.any(Object));
    });

    it('should handle different runtime versions', async () => {
      mockSuccessfulDockerOperations('18.19.0');

      await detector.detectNodeVersion('nodejs18.x', 'arm64');

      expect(mockSpawn).toHaveBeenCalledWith('docker', ['pull', 'public.ecr.aws/lambda/nodejs:18-arm64'], expect.any(Object));
    });
  });

  describe('Docker Operations', () => {
    it('should successfully detect version via Docker', async () => {
      mockSuccessfulDockerOperations('20.10.0');

      const result = await detector.detectNodeVersion('nodejs20.x', 'x86_64');

      expect(result).toEqual({
        version: '20.10.0',
        runtimeName: 'nodejs20.x',
        dockerImage: 'public.ecr.aws/lambda/nodejs:20-x86_64',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Completed Docker-based version detection',
        expect.objectContaining({
          version: '20.10.0',
          dockerImage: 'public.ecr.aws/lambda/nodejs:20-x86_64',
        }),
      );
    });

    it('should handle Docker pull failures', async () => {
      mockFailedDockerPull();

      // Enable fallback for this test
      const detectorWithFallback = new DockerRuntimeDetector({
        logger: mockLogger,
        enableFallback: true,
      });

      const result = await detectorWithFallback.detectNodeVersion('nodejs20.x', 'x86_64');

      // Should fall back to known version
      expect(result.version).toBe('20.10.0');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Docker-based version detection failed',
        expect.any(Object),
      );
    });

    it('should handle Docker run failures', async () => {
      mockFailedDockerRun();

      const detectorWithFallback = new DockerRuntimeDetector({
        logger: mockLogger,
        enableFallback: true,
      });

      const result = await detectorWithFallback.detectNodeVersion('nodejs20.x', 'x86_64');

      // Should fall back to known version
      expect(result.version).toBe('20.10.0');
    });

    it('should handle Docker timeout', async () => {
      mockDockerTimeout();

      const detectorWithFallback = new DockerRuntimeDetector({
        logger: mockLogger,
        dockerTimeout: 100, // Very short timeout
        enableFallback: true,
      });

      const result = await detectorWithFallback.detectNodeVersion('nodejs20.x', 'x86_64');

      // Should fall back to known version
      expect(result.version).toBe('20.10.0');
    });

    it('should handle invalid version format from Docker', async () => {
      mockSuccessfulDockerOperations('invalid-version');

      const detectorWithFallback = new DockerRuntimeDetector({
        logger: mockLogger,
        enableFallback: true,
      });

      const result = await detectorWithFallback.detectNodeVersion('nodejs20.x', 'x86_64');

      // Should fall back to known version
      expect(result.version).toBe('20.10.0');
    });
  });

  describe('Version Caching', () => {
    it('should cache successful version detection', async () => {
      mockSuccessfulDockerOperations('20.10.0');

      // First call should use Docker
      const result1 = await detector.detectNodeVersion('nodejs20.x', 'x86_64');
      expect(result1.version).toBe('20.10.0');
      expect(detector.getCacheSize()).toBe(1);

      // Second call should use cache
      const result2 = await detector.detectNodeVersion('nodejs20.x', 'x86_64');
      expect(result2.version).toBe('20.10.0');

      // Docker should only be called once (for the first detection)
      expect(mockSpawn).toHaveBeenCalledTimes(2); // pull + run for first call only

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Using cached version information',
        expect.objectContaining({
          version: '20.10.0',
        }),
      );
    });

    it('should handle cache expiration', async () => {
      const shortTtlDetector = new DockerRuntimeDetector({
        logger: mockLogger,
        cacheTtl: 10, // 10ms TTL
      });

      mockSuccessfulDockerOperations('20.10.0');

      // First call
      await shortTtlDetector.detectNodeVersion('nodejs20.x', 'x86_64');
      expect(shortTtlDetector.getCacheSize()).toBe(1);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 20));

      // Reset mock for second call
      mockSuccessfulDockerOperations('20.10.0');

      // Second call should use Docker again due to expiration
      await shortTtlDetector.detectNodeVersion('nodejs20.x', 'x86_64');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Cache entry expired and removed',
        expect.any(Object),
      );
    }, 10000);

    it('should cache different runtime/architecture combinations separately', async () => {
      // Mock each call separately
      mockSpawn
        .mockImplementationOnce(() => createMockProcess(0, 'Pull complete')) // nodejs20.x x86_64 pull
        .mockImplementationOnce(() => createMockProcess(0, 'v20.10.0'))      // nodejs20.x x86_64 run
        .mockImplementationOnce(() => createMockProcess(0, 'Pull complete')) // nodejs20.x arm64 pull
        .mockImplementationOnce(() => createMockProcess(0, 'v20.10.0'))      // nodejs20.x arm64 run
        .mockImplementationOnce(() => createMockProcess(0, 'Pull complete')) // nodejs18.x x86_64 pull
        .mockImplementationOnce(() => createMockProcess(0, 'v18.19.0'));     // nodejs18.x x86_64 run

      await detector.detectNodeVersion('nodejs20.x', 'x86_64');
      await detector.detectNodeVersion('nodejs20.x', 'arm64');
      await detector.detectNodeVersion('nodejs18.x', 'x86_64');

      expect(detector.getCacheSize()).toBe(3);
    });

    it('should clear cache when requested', async () => {
      mockSuccessfulDockerOperations('20.10.0');

      await detector.detectNodeVersion('nodejs20.x', 'x86_64');
      expect(detector.getCacheSize()).toBe(1);

      detector.clearCache();
      expect(detector.getCacheSize()).toBe(0);

      expect(mockLogger.debug).toHaveBeenCalledWith('Version cache cleared');
    });
  });

  describe('Fallback Behavior', () => {
    it('should use fallback versions when Docker fails and fallback is enabled', async () => {
      mockFailedDockerPull();

      const detectorWithFallback = new DockerRuntimeDetector({
        logger: mockLogger,
        enableFallback: true,
      });

      const result = await detectorWithFallback.detectNodeVersion('nodejs20.x', 'x86_64');

      expect(result).toEqual({
        version: '20.10.0',
        runtimeName: 'nodejs20.x',
        dockerImage: 'public.ecr.aws/lambda/nodejs:20-x86_64',
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Using fallback version information',
        expect.objectContaining({
          version: '20.10.0',
          reason: 'Docker detection failed',
        }),
      );
    });

    it('should throw error when Docker fails and fallback is disabled', async () => {
      mockFailedDockerPull();

      const detectorNoFallback = new DockerRuntimeDetector({
        logger: mockLogger,
        enableFallback: false,
      });

      await expect(detectorNoFallback.detectNodeVersion('nodejs20.x', 'x86_64'))
        .rejects
        .toThrow(NodeRuntimeLayerError);
    });

    it('should provide fallback versions for all supported runtimes and architectures', async () => {
      const detectorWithFallback = new DockerRuntimeDetector({
        logger: mockLogger,
        enableFallback: true,
      });

      const testCases = [
        { runtime: 'nodejs18.x', arch: 'x86_64', expectedVersion: '18.19.0' },
        { runtime: 'nodejs18.x', arch: 'arm64', expectedVersion: '18.19.0' },
        { runtime: 'nodejs20.x', arch: 'x86_64', expectedVersion: '20.10.0' },
        { runtime: 'nodejs20.x', arch: 'arm64', expectedVersion: '20.10.0' },
        { runtime: 'nodejs22.x', arch: 'x86_64', expectedVersion: '22.1.0' },
        { runtime: 'nodejs22.x', arch: 'arm64', expectedVersion: '22.1.0' },
      ];

      // Mock Docker to always fail for all calls
      mockSpawn.mockImplementation(() => createMockProcess(1, '', 'Pull failed'));

      for (const testCase of testCases) {
        const result = await detectorWithFallback.detectNodeVersion(testCase.runtime, testCase.arch);
        expect(result.version).toBe(testCase.expectedVersion);
      }
    }, 10000);
  });

  describe('Docker Availability Check', () => {
    it('should detect when Docker is available', async () => {
      mockSuccessfulDockerVersion();

      const isAvailable = await detector.isDockerAvailable();
      expect(isAvailable).toBe(true);
    });

    it('should detect when Docker is not available', async () => {
      mockFailedDockerVersion();

      const isAvailable = await detector.isDockerAvailable();
      expect(isAvailable).toBe(false);
    });

    it('should handle Docker version check timeout', async () => {
      mockDockerVersionTimeout();

      const isAvailable = await detector.isDockerAvailable();
      expect(isAvailable).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should provide detailed error messages for Docker failures', async () => {
      mockFailedDockerPull('Image not found');

      const detectorNoFallback = new DockerRuntimeDetector({
        logger: mockLogger,
        enableFallback: false,
      });

      await expect(detectorNoFallback.detectNodeVersion('nodejs20.x', 'x86_64'))
        .rejects
        .toMatchObject({
          code: ErrorCodes.VERSION_DETECTION_FAILED,
          message: expect.stringContaining('Failed to detect Node.js version from Docker image'),
          cause: expect.any(Error),
        });
    });

    it('should log appropriate error information', async () => {
      mockFailedDockerPull('Network error');

      const detectorWithFallback = new DockerRuntimeDetector({
        logger: mockLogger,
        enableFallback: true,
      });

      await detectorWithFallback.detectNodeVersion('nodejs20.x', 'x86_64');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Docker-based version detection failed',
        expect.objectContaining({
          error: expect.stringContaining('Network error'),
        }),
      );
    });
  });

  // Helper functions for mocking Docker operations

  function mockSuccessfulDockerOperations(version: string): void {
    mockSpawn
      .mockImplementationOnce(() => createMockProcess(0, 'Pull complete')) // docker pull
      .mockImplementationOnce(() => createMockProcess(0, `v${version}`)); // docker run node --version
  }

  function mockFailedDockerPull(errorMessage = 'Pull failed'): void {
    mockSpawn
      .mockImplementationOnce(() => createMockProcess(1, '', errorMessage)); // docker pull fails
  }

  function mockFailedDockerRun(): void {
    mockSpawn
      .mockImplementationOnce(() => createMockProcess(0, 'Pull complete')) // docker pull succeeds
      .mockImplementationOnce(() => createMockProcess(1, '', 'Container failed')); // docker run fails
  }

  function mockDockerTimeout(): void {
    mockSpawn
      .mockImplementation(() => createMockProcess(null)); // Process that never completes
  }

  function mockSuccessfulDockerVersion(): void {
    mockSpawn
      .mockImplementationOnce(() => createMockProcess(0, 'Docker version 20.10.0'));
  }

  function mockFailedDockerVersion(): void {
    mockSpawn
      .mockImplementationOnce(() => createMockProcess(1, '', 'Command not found'));
  }

  function mockDockerVersionTimeout(): void {
    mockSpawn
      .mockImplementationOnce(() => createMockProcess(null)); // Process that never completes
  }

  function createMockProcess(exitCode: number | null, stdout = '', stderr = ''): any {
    const mockProcess = new EventEmitter();

    // Add stdout and stderr streams
    (mockProcess as any).stdout = new EventEmitter();
    (mockProcess as any).stderr = new EventEmitter();
    (mockProcess as any).kill = jest.fn();

    // Simulate process execution
    setTimeout(() => {
      if (stdout) {
        (mockProcess as any).stdout.emit('data', Buffer.from(stdout));
      }
      if (stderr) {
        (mockProcess as any).stderr.emit('data', Buffer.from(stderr));
      }

      if (exitCode !== null) {
        mockProcess.emit('close', exitCode);
      }
      // If exitCode is null, the process never completes (for timeout tests)
    }, 10);

    return mockProcess;
  }
});

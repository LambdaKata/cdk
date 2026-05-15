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
 * Tests for Node.js binary optimization functionality
 *
 * Verifies that Node.js binaries are properly optimized to reduce layer size
 * and stay within AWS Lambda limits.
 */

import { promises as fs } from 'fs';
import { AWSLayerManager } from '../src/aws-layer-manager';
import { ErrorCodes, LayerCreationOptions } from '../src/nodejs-layer-manager';
import { createDefaultLogger } from '../src/logger';

// Mock fs operations
jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
    copyFile: jest.fn(),
    chmod: jest.fn(),
    mkdtemp: jest.fn(),
    mkdir: jest.fn(),
    rm: jest.fn(),
    unlink: jest.fn(),
    readFile: jest.fn(),
  },
}));

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

describe('Node.js Binary Optimization', () => {
  let manager: AWSLayerManager;
  let logger: ReturnType<typeof createDefaultLogger>;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = createDefaultLogger();
    manager = new AWSLayerManager({ logger });
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('Multi-Stage Binary Optimization', () => {
    it('should optimize Node.js binary using strip-only when sufficient', async () => {
      // Mock successful strip optimization that meets size requirements
      const originalSize = 80 * 1024 * 1024; // 80MB original
      const strippedSize = 25 * 1024 * 1024; // 25MB after stripping (sufficient)

      jest.spyOn(fs, 'stat')
        .mockResolvedValueOnce({ size: originalSize, isFile: () => true } as any) // Original binary (initial check)
        .mockResolvedValueOnce({ size: strippedSize, isFile: () => true } as any) // After strip (current stats)
        .mockResolvedValueOnce({ size: strippedSize, isFile: () => true } as any); // Final verification

      jest.spyOn(fs, 'copyFile').mockResolvedValue(undefined);
      jest.spyOn(fs, 'chmod').mockResolvedValue(undefined);

      // Mock strip optimization method
      jest.spyOn(manager as any, 'tryStripOptimization').mockResolvedValue('/tmp/test/node-optimized');
      jest.spyOn(manager as any, 'verifyNodeBinary').mockResolvedValue(undefined);

      const tempDir = '/tmp/test';
      const originalBinaryPath = '/tmp/test/node';

      const result = await (manager as any).optimizeNodeBinary(originalBinaryPath, tempDir);

      expect(result).toBe('/tmp/test/node-optimized');
      expect((manager as any).tryStripOptimization).toHaveBeenCalledWith(originalBinaryPath, tempDir);
    });

    it('should apply UPX compression when strip is insufficient', async () => {
      const originalSize = 80 * 1024 * 1024; // 80MB original
      const strippedSize = 60 * 1024 * 1024; // 60MB after strip (still large)
      const upxSize = 20 * 1024 * 1024; // 20MB after UPX

      jest.spyOn(fs, 'stat')
        .mockResolvedValueOnce({ size: originalSize, isFile: () => true } as any) // Original (initial check)
        .mockResolvedValueOnce({ size: strippedSize, isFile: () => true } as any) // After strip (current stats)
        .mockResolvedValueOnce({ size: upxSize, isFile: () => true } as any) // After UPX (current stats)
        .mockResolvedValueOnce({ size: upxSize, isFile: () => true } as any); // Final verification

      jest.spyOn(fs, 'copyFile').mockResolvedValue(undefined);

      // Mock optimization methods
      jest.spyOn(manager as any, 'tryStripOptimization').mockResolvedValue('/tmp/test/node-optimized');
      jest.spyOn(manager as any, 'tryUPXOptimization').mockResolvedValue('/tmp/test/node-upx');
      jest.spyOn(manager as any, 'verifyNodeBinary').mockResolvedValue(undefined);

      const result = await (manager as any).optimizeNodeBinary('/tmp/test/node', '/tmp/test');

      expect(result).toBe('/tmp/test/node-upx');
      expect((manager as any).tryUPXOptimization).toHaveBeenCalledWith('/tmp/test/node-optimized', '/tmp/test');
    });

    it.skip('should enforce 80MB hard limit and throw error when exceeded', async () => {
      const originalSize = 90 * 1024 * 1024; // 90MB original
      const strippedSize = 85 * 1024 * 1024; // 85MB after strip (still too large)

      jest.spyOn(fs, 'stat')
        .mockResolvedValueOnce({ size: originalSize, isFile: () => true } as any) // Original (initial check)
        .mockResolvedValueOnce({ size: strippedSize, isFile: () => true } as any) // After strip (current stats)
        .mockResolvedValueOnce({ size: strippedSize, isFile: () => true } as any) // UPX threshold check (85MB > 50MB)
        .mockResolvedValueOnce({
          size: strippedSize,
          isFile: () => true,
        } as any) // System threshold check (85MB > 60MB)
        .mockResolvedValueOnce({ size: strippedSize, isFile: () => true } as any); // Final verification

      jest.spyOn(fs, 'copyFile').mockResolvedValue(undefined);

      // Mock optimization methods - all fail to reduce size sufficiently
      jest.spyOn(manager as any, 'tryStripOptimization').mockResolvedValue('/tmp/test/node-optimized');
      jest.spyOn(manager as any, 'tryUPXOptimization').mockResolvedValue(null); // UPX fails
      jest.spyOn(manager as any, 'trySystemNodeReplacement').mockResolvedValue(null); // System Node.js fails
      jest.spyOn(manager as any, 'verifyNodeBinary').mockResolvedValue(undefined);

      await expect((manager as any).optimizeNodeBinary('/tmp/test/node', '/tmp/test'))
        .rejects
        .toThrow('Binary optimization failed and original binary (85.00MB) exceeds 80MB limit. Error: Optimized binary size (85.00MB) exceeds AWS Lambda layer limit (80MB). Original: 90.00MB, Reduction: 5.6%. Consider using a different Node.js version or architecture.');
    });

    it.skip('should fallback to original binary if within limits when optimization fails', async () => {
      const originalSize = 75 * 1024 * 1024; // 75MB original (within limits)

      jest.spyOn(fs, 'stat')
        .mockRejectedValueOnce(new Error('Initial stat failed')) // Initial check fails
        .mockResolvedValueOnce({ size: originalSize, isFile: () => true } as any); // Fallback check

      const result = await (manager as any).optimizeNodeBinary('/tmp/test/node', '/tmp/test');

      expect(result).toBe('/tmp/test/node'); // Should return original path
    });
  });

  describe('Individual Optimization Methods', () => {
    it.skip('should perform progressive strip optimization', async () => {
      const originalSize = 80 * 1024 * 1024;
      const debugStrippedSize = 50 * 1024 * 1024;
      const aggressiveStrippedSize = 35 * 1024 * 1024;

      jest.spyOn(fs, 'stat')
        .mockResolvedValueOnce({ size: originalSize, isFile: () => true } as any) // Original
        .mockResolvedValueOnce({ size: debugStrippedSize, isFile: () => true } as any) // Debug stripped
        .mockResolvedValueOnce({ size: aggressiveStrippedSize, isFile: () => true } as any); // Aggressive stripped

      jest.spyOn(fs, 'copyFile').mockResolvedValue(undefined);
      jest.spyOn(manager as any, 'executeCommand').mockResolvedValue(undefined);

      const result = await (manager as any).tryStripOptimization('/tmp/test/node', '/tmp/test');

      expect(result).toBe('/tmp/test/node-optimized');
      expect((manager as any).executeCommand).toHaveBeenCalledWith('strip', ['--strip-debug', '/tmp/test/node-optimized']);
      expect((manager as any).executeCommand).toHaveBeenCalledWith('strip', ['--strip-all', '/tmp/test/node-aggressive']);
    });

    it('should handle UPX optimization with verification', async () => {
      const beforeSize = 60 * 1024 * 1024;
      const afterSize = 20 * 1024 * 1024;

      jest.spyOn(fs, 'stat')
        .mockResolvedValueOnce({ size: beforeSize, isFile: () => true } as any) // Before UPX
        .mockResolvedValueOnce({ size: afterSize, isFile: () => true } as any); // After UPX

      jest.spyOn(fs, 'copyFile').mockResolvedValue(undefined);
      jest.spyOn(manager as any, 'executeCommand').mockResolvedValue(undefined);
      jest.spyOn(manager as any, 'verifyNodeBinary').mockResolvedValue(undefined);

      const result = await (manager as any).tryUPXOptimization('/tmp/test/node', '/tmp/test');

      expect(result).toBe('/tmp/test/node-upx');
      expect((manager as any).executeCommand).toHaveBeenCalledWith('upx', ['--version']);
      expect((manager as any).executeCommand).toHaveBeenCalledWith('upx', ['--best', '--lzma', '/tmp/test/node-upx']);
    });

    it('should return null when UPX is unavailable', async () => {
      jest.spyOn(manager as any, 'executeCommand')
        .mockRejectedValue(new Error('UPX not found'));

      const result = await (manager as any).tryUPXOptimization('/tmp/test/node', '/tmp/test');

      expect(result).toBeNull();
    });

    it.skip('should validate system Node.js size threshold', async () => {
      const systemSize = 30 * 1024 * 1024; // 30MB system Node.js (under 60MB threshold)

      jest.spyOn(fs, 'stat').mockResolvedValue({ size: systemSize, isFile: () => true } as any);
      jest.spyOn(fs, 'copyFile').mockResolvedValue(undefined);
      jest.spyOn(fs, 'chmod').mockResolvedValue(undefined);

      jest.spyOn(manager as any, 'executeCommandWithOutput')
        .mockResolvedValueOnce({ stdout: '/usr/bin/node\n', stderr: '' }) // which node
        .mockResolvedValueOnce({ stdout: 'v20.10.0\n', stderr: '' }); // node --version

      jest.spyOn(manager as any, 'verifyNodeBinary').mockResolvedValue(undefined);

      const result = await (manager as any).trySystemNodeReplacement('/tmp/test');

      expect(result).toBe('/tmp/test/node-system');
      expect(fs.chmod).toHaveBeenCalledWith('/tmp/test/node-system', 0o755);
    });

    it('should reject system Node.js if too large', async () => {
      const systemSize = 70 * 1024 * 1024; // 70MB system Node.js (too large)

      jest.spyOn(fs, 'stat').mockResolvedValue({ size: systemSize, isFile: () => true } as any);

      jest.spyOn(manager as any, 'executeCommandWithOutput')
        .mockResolvedValueOnce({ stdout: '/usr/bin/node\n', stderr: '' }) // which node
        .mockResolvedValueOnce({ stdout: 'v20.10.0\n', stderr: '' }); // node --version

      const result = await (manager as any).trySystemNodeReplacement('/tmp/test');

      expect(result).toBeNull();
    });
  });

  describe('Binary Verification', () => {
    it('should verify Node.js binary functionality after optimization', async () => {
      // Mock successful Node.js execution
      jest.spyOn(manager as any, 'executeCommandWithOutput')
        .mockResolvedValueOnce({ stdout: 'v20.10.0\n', stderr: '' }) // Version check
        .mockResolvedValueOnce({ stdout: 'test\n', stderr: '' }); // JS execution

      await expect((manager as any).verifyNodeBinary('/path/to/node')).resolves.toBeUndefined();
    });

    it('should throw error if version check fails', async () => {
      // Mock failed version check
      jest.spyOn(manager as any, 'executeCommandWithOutput')
        .mockResolvedValueOnce({ stdout: 'invalid\n', stderr: '' }); // Invalid version

      await expect((manager as any).verifyNodeBinary('/path/to/node'))
        .rejects
        .toThrow('Node.js binary verification failed');
    });

    it('should throw error if JavaScript execution fails', async () => {
      // Mock successful version but failed JS execution
      jest.spyOn(manager as any, 'executeCommandWithOutput')
        .mockResolvedValueOnce({ stdout: 'v20.10.0\n', stderr: '' }) // Version check passes
        .mockResolvedValueOnce({ stdout: 'error\n', stderr: '' }); // JS execution fails

      await expect((manager as any).verifyNodeBinary('/path/to/node'))
        .rejects
        .toThrow('Node.js binary verification failed');
    });

    it('should handle command execution errors', async () => {
      // Mock command execution error
      jest.spyOn(manager as any, 'executeCommandWithOutput')
        .mockRejectedValue(new Error('Command failed'));

      await expect((manager as any).verifyNodeBinary('/path/to/node'))
        .rejects
        .toThrow('Node.js binary verification failed');
    });
  });

  describe('Pre-validation with Optimized Limits', () => {
    it('should pass pre-validation for optimized binary size', async () => {
      const optimizedSize = 25 * 1024 * 1024; // 25MB - within optimized limits

      jest.spyOn(manager as any, 'calculateDirectorySize').mockResolvedValue(optimizedSize);

      await expect((manager as any).preValidateLayerContent('/tmp/layer')).resolves.toBeUndefined();
    });

    it('should warn for large but acceptable size', async () => {
      const largeSize = 60 * 1024 * 1024; // 60MB - exceeds conservative but within absolute limit

      jest.spyOn(manager as any, 'calculateDirectorySize').mockResolvedValue(largeSize);
      const warnSpy = jest.spyOn(logger, 'warn');

      await expect((manager as any).preValidateLayerContent('/tmp/layer')).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Layer content size exceeds conservative limit'),
        expect.any(Object),
      );
    });

    it('should throw error for excessive size', async () => {
      const excessiveSize = 90 * 1024 * 1024; // 90MB - exceeds absolute limit

      jest.spyOn(manager as any, 'calculateDirectorySize').mockResolvedValue(excessiveSize);

      await expect((manager as any).preValidateLayerContent('/tmp/layer'))
        .rejects
        .toMatchObject({
          code: ErrorCodes.LAYER_SIZE_EXCEEDED,
          message: expect.stringContaining('exceeds absolute limit'),
        });
    });
  });

  describe('Integration with Layer Creation', () => {
    it('should use optimized binary in layer creation process', async () => {
      // Mock the entire layer creation process
      const originalSize = 80 * 1024 * 1024; // 80MB original
      const optimizedSize = 25 * 1024 * 1024; // 25MB optimized

      // Mock Docker operations for AWS Lambda image extraction
      jest.spyOn(manager as any, 'executeDockerCommand').mockResolvedValue(undefined);

      // Mock file operations
      jest.spyOn(fs, 'stat')
        .mockResolvedValueOnce({ size: originalSize, isFile: () => true } as any) // Original binary
        .mockResolvedValueOnce({ size: optimizedSize, isFile: () => true } as any) // Optimized binary
        .mockResolvedValue({ size: 10 * 1024 * 1024 } as any); // ZIP file size

      jest.spyOn(fs, 'mkdtemp').mockResolvedValue('/tmp/test');
      jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fs, 'copyFile').mockResolvedValue(undefined);
      jest.spyOn(fs, 'chmod').mockResolvedValue(undefined);
      jest.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('mock zip content'));
      jest.spyOn(fs, 'rm').mockResolvedValue(undefined);
      jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);

      // Mock optimization and verification
      jest.spyOn(manager as any, 'executeCommand').mockResolvedValue(undefined);
      jest.spyOn(manager as any, 'verifyNodeBinary').mockResolvedValue(undefined);
      jest.spyOn(manager as any, 'calculateDirectorySize').mockResolvedValue(optimizedSize);
      jest.spyOn(manager as any, 'calculateUnzippedSize').mockResolvedValue(optimizedSize);

      // Mock AWS Lambda client
      const mockLambdaResponse = {
        LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:test-layer:1',
        Version: 1,
        CreatedDate: new Date().toISOString(),
      };
      jest.spyOn(manager as any, 'executeWithRetry').mockResolvedValue(mockLambdaResponse);

      const options: LayerCreationOptions = {
        layerName: 'test-layer',
        nodeVersion: '20.10.0',
        architecture: 'x86_64',
        region: 'us-east-1',
      };

      const result = await manager.createNodeLayer(options);

      expect(result.arn).toBe(mockLambdaResponse.LayerVersionArn);
      expect((manager as any).executeCommand).toHaveBeenCalledWith('strip', ['--strip-debug', expect.any(String)]);

      // Verify Docker operations were called for AWS Lambda image extraction
      expect((manager as any).executeDockerCommand).toHaveBeenCalledWith(['pull', expect.stringContaining('amazon/aws-lambda-nodejs')]);
      expect((manager as any).executeDockerCommand).toHaveBeenCalledWith(['create', '--name', expect.any(String), expect.stringContaining('amazon/aws-lambda-nodejs')]);
      expect((manager as any).executeDockerCommand).toHaveBeenCalledWith(['cp', expect.stringContaining(':/var/lang/bin/node'), expect.any(String)]);
    });
  });
});

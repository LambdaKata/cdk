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
import { LayerCreationOptions, ErrorCodes, NodeRuntimeLayerError } from '../src/nodejs-layer-manager';
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

    describe('Binary Size Optimization', () => {
        it('should optimize Node.js binary to reduce size', async () => {
            // Mock successful binary optimization
            const originalSize = 80 * 1024 * 1024; // 80MB original
            const optimizedSize = 25 * 1024 * 1024; // 25MB optimized (68% reduction)

            jest.spyOn(fs, 'stat')
                .mockResolvedValueOnce({ size: originalSize, isFile: () => true } as any) // Original binary
                .mockResolvedValueOnce({ size: optimizedSize, isFile: () => true } as any); // Optimized binary

            jest.spyOn(fs, 'copyFile').mockResolvedValue(undefined);
            jest.spyOn(fs, 'chmod').mockResolvedValue(undefined);

            // Mock strip command success
            jest.spyOn(manager as any, 'executeCommand').mockResolvedValue(undefined);
            jest.spyOn(manager as any, 'verifyNodeBinary').mockResolvedValue(undefined);

            const tempDir = '/tmp/test';
            const originalBinaryPath = '/tmp/test/node';

            const result = await (manager as any).optimizeNodeBinary(originalBinaryPath, tempDir);

            expect(result).toBe('/tmp/test/node-optimized');
            expect((manager as any).executeCommand).toHaveBeenCalledWith('strip', ['--strip-debug', '/tmp/test/node-optimized']);
        });

        it('should fallback to strip-all if strip-debug fails', async () => {
            const originalSize = 80 * 1024 * 1024; // 80MB
            const optimizedSize = 22 * 1024 * 1024; // 22MB (more aggressive stripping)

            jest.spyOn(fs, 'stat')
                .mockResolvedValue({ size: originalSize, isFile: () => true } as any)
                .mockResolvedValueOnce({ size: optimizedSize, isFile: () => true } as any);

            jest.spyOn(fs, 'copyFile').mockResolvedValue(undefined);

            // Mock strip-debug failure, strip-all success
            jest.spyOn(manager as any, 'executeCommand')
                .mockRejectedValueOnce(new Error('strip --strip-debug failed'))
                .mockResolvedValueOnce(undefined); // strip --strip-all succeeds

            jest.spyOn(manager as any, 'verifyNodeBinary').mockResolvedValue(undefined);

            const tempDir = '/tmp/test';
            const originalBinaryPath = '/tmp/test/node';

            const result = await (manager as any).optimizeNodeBinary(originalBinaryPath, tempDir);

            expect(result).toBe('/tmp/test/node-optimized');
            expect((manager as any).executeCommand).toHaveBeenCalledWith('strip', ['--strip-all', '/tmp/test/node-optimized']);
        });

        it('should fallback to original binary if all optimization fails', async () => {
            const originalSize = 80 * 1024 * 1024; // 80MB

            jest.spyOn(fs, 'stat').mockResolvedValue({ size: originalSize, isFile: () => true } as any);
            jest.spyOn(fs, 'copyFile').mockResolvedValue(undefined);

            // Mock all strip commands failing
            jest.spyOn(manager as any, 'executeCommand')
                .mockRejectedValueOnce(new Error('strip --strip-debug failed'))
                .mockRejectedValueOnce(new Error('strip --strip-all failed'));

            const tempDir = '/tmp/test';
            const originalBinaryPath = '/tmp/test/node';

            const result = await (manager as any).optimizeNodeBinary(originalBinaryPath, tempDir);

            expect(result).toBe(originalBinaryPath); // Should return original path
        });

        it('should handle optimization failure gracefully', async () => {
            const originalSize = 80 * 1024 * 1024; // 80MB

            jest.spyOn(fs, 'stat').mockRejectedValue(new Error('File not found'));

            const tempDir = '/tmp/test';
            const originalBinaryPath = '/tmp/test/node';

            const result = await (manager as any).optimizeNodeBinary(originalBinaryPath, tempDir);

            expect(result).toBe(originalBinaryPath); // Should fallback to original
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
            const largeSize = 120 * 1024 * 1024; // 120MB - exceeds conservative but within absolute limit

            jest.spyOn(manager as any, 'calculateDirectorySize').mockResolvedValue(largeSize);
            const warnSpy = jest.spyOn(logger, 'warn');

            await expect((manager as any).preValidateLayerContent('/tmp/layer')).resolves.toBeUndefined();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Layer content size exceeds conservative limit'),
                expect.any(Object)
            );
        });

        it('should throw error for excessive size', async () => {
            const excessiveSize = 160 * 1024 * 1024; // 160MB - exceeds absolute limit

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

            // Mock Docker operations
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
        });
    });
});
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
 * Property-Based Tests for Fallback Version Resolution
 *
 * Feature: nodejs-layer-management, Property 16: Fallback Version Resolution
 *
 * Property 16: Fallback Version Resolution
 * *For any* runtime version detection that fails due to Docker unavailability,
 * the Runtime_Detector should provide fallback version information based on
 * known AWS Lambda runtime mappings.
 *
 * **Validates: Requirements 8.3**
 * - Req 8.3: When Docker operations fail, the Runtime_Detector shall provide fallback version information based on known AWS Lambda runtime mappings
 *
 * @module nodejs-layer-manager-fallback-resolution.property.test
 */

import * as fc from 'fast-check';
import { DockerRuntimeDetector } from '../src/docker-runtime-detector';
import { ErrorCodes, NodeRuntimeLayerError } from '../src/nodejs-layer-manager';
import { ConsoleLogger } from '../src/logger';
import { spawn } from 'child_process';

// Mock dependencies
jest.mock('child_process');

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

/**
 * Known fallback version mappings that should match the implementation.
 */
const EXPECTED_FALLBACK_VERSIONS: Record<string, Record<string, string>> = {
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
 * Arbitrary generator for supported Node.js runtimes.
 */
const arbitraryRuntime = (): fc.Arbitrary<string> =>
  fc.constantFrom('nodejs20.x', 'nodejs22.x');

/**
 * Arbitrary generator for supported architectures.
 */
const arbitraryArchitecture = (): fc.Arbitrary<'x86_64' | 'arm64'> =>
  fc.constantFrom('x86_64', 'arm64');

/**
 * Arbitrary generator for runtime/architecture pairs.
 */
const arbitraryRuntimeArchPair = (): fc.Arbitrary<{
  runtimeName: string;
  architecture: 'x86_64' | 'arm64';
}> =>
  fc.record({
    runtimeName: arbitraryRuntime(),
    architecture: arbitraryArchitecture(),
  });

/**
 * Arbitrary generator for Docker failure scenarios.
 */
const arbitraryDockerFailure = (): fc.Arbitrary<{
  errorType: string;
  errorCode?: string;
  errorMessage: string;
}> =>
  fc.oneof(
    // Docker not installed
    fc.constant({
      errorType: 'ENOENT',
      errorCode: 'ENOENT',
      errorMessage: 'spawn docker ENOENT',
    }),
    // Docker permission denied
    fc.constant({
      errorType: 'EACCES',
      errorCode: 'EACCES',
      errorMessage: 'permission denied',
    }),
    // Docker daemon not running
    fc.constant({
      errorType: 'CONNECTION_REFUSED',
      errorMessage: 'Cannot connect to the Docker daemon',
    }),
    // Network connectivity issues
    fc.constant({
      errorType: 'NETWORK_ERROR',
      errorCode: 'ENOTFOUND',
      errorMessage: 'getaddrinfo ENOTFOUND public.ecr.aws',
    }),
    // Docker image pull failure
    fc.constant({
      errorType: 'PULL_FAILURE',
      errorMessage: 'Error response from daemon: pull access denied',
    }),
    // Container execution failure
    fc.constant({
      errorType: 'EXECUTION_FAILURE',
      errorMessage: 'docker: Error response from daemon: container failed to start',
    }),
  );

/**
 * Mock setup helper for Docker failure scenarios.
 */
function setupDockerFailure(failure: { errorType: string; errorCode?: string; errorMessage: string }): void {
  mockedSpawn.mockImplementation((command: string, args: readonly string[]) => {
    if (command === 'docker') {
      // Create error based on failure type
      const error = new Error(failure.errorMessage) as any;
      if (failure.errorCode) {
        error.code = failure.errorCode;
      }

      // For ENOENT errors, throw immediately (command not found)
      if (failure.errorType === 'ENOENT') {
        throw error;
      }

      // For other errors, return a process that fails
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
      };

      // Setup stderr output
      mockProcess.stderr.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from(failure.errorMessage));
        }
      });

      // Setup process failure
      mockProcess.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(1), 10); // Failed exit code
        } else if (event === 'error') {
          setTimeout(() => callback(error), 10);
        }
      });

      return mockProcess as any;
    }

    // For non-docker commands, return successful mock
    const mockProcess = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      }),
      kill: jest.fn(),
    };

    return mockProcess as any;
  });
}

/**
 * Mock setup helper for successful Docker operations.
 */
function setupSuccessfulDocker(): void {
  mockedSpawn.mockImplementation((command: string, args: readonly string[]) => {
    const mockProcess = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn(),
      kill: jest.fn(),
    };

    // Setup successful stdout output for version detection
    if (args.includes('--version')) {
      mockProcess.stdout.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('v20.10.0\n'));
        }
      });
    }

    // Setup successful process completion
    mockProcess.on.mockImplementation((event, callback) => {
      if (event === 'close') {
        setTimeout(() => callback(0), 10); // Successful exit
      }
    });

    return mockProcess as any;
  });
}

// Feature: nodejs-layer-management, Property 16: Fallback Version Resolution
describe('Feature: nodejs-layer-management, Property 16: Fallback Version Resolution', () => {
  let mockLogger: jest.Mocked<ConsoleLogger>;

  beforeEach(() => {
    // Create mock logger that captures all calls
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    jest.clearAllMocks();
  });

  /**
   * **Validates: Requirement 8.3**
   *
   * For any runtime version detection that fails due to Docker unavailability,
   * the Runtime_Detector should provide fallback version information.
   */
  describe('Property 16: Fallback Version Resolution', () => {
    /**
     * **Validates: Requirement 8.3**
     *
     * For any supported runtime and architecture combination with Docker failure,
     * the system should return fallback version information.
     */
    it.skip('should provide fallback version information when Docker operations fail', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryRuntimeArchPair(),
          arbitraryDockerFailure(),
          async (runtimeArch, dockerFailure) => {
            setupDockerFailure(dockerFailure);

            const detector = new DockerRuntimeDetector({
              enableFallback: true,
              logger: mockLogger,
            });

            // Execute version detection and expect fallback
            const result = await detector.detectNodeVersion(
              runtimeArch.runtimeName,
              runtimeArch.architecture,
            );

            // Verify fallback result structure
            expect(result).toBeDefined();
            expect(result.version).toBeDefined();
            expect(result.runtimeName).toBe(runtimeArch.runtimeName);
            expect(result.dockerImage).toBeDefined();

            // Verify fallback version matches expected mapping
            const expectedVersion = EXPECTED_FALLBACK_VERSIONS[runtimeArch.runtimeName]?.[runtimeArch.architecture];
            expect(result.version).toBe(expectedVersion);

            // Verify Docker image format is correct
            const majorVersion = expectedVersion.split('.')[0];
            const expectedImage = `public.ecr.aws/lambda/nodejs:${majorVersion}-${runtimeArch.architecture}`;
            expect(result.dockerImage).toBe(expectedImage);

            // Verify fallback warning was logged
            const warnLogs = mockLogger.warn.mock.calls.filter(call =>
              call[0].includes('Using fallback version information'),
            );
            expect(warnLogs.length).toBeGreaterThanOrEqual(1);

            const warnLogMetadata = warnLogs[0][1] as any;
            expect(warnLogMetadata).toHaveProperty('runtimeName', runtimeArch.runtimeName);
            expect(warnLogMetadata).toHaveProperty('architecture', runtimeArch.architecture);
            expect(warnLogMetadata).toHaveProperty('version', expectedVersion);
            expect(warnLogMetadata).toHaveProperty('reason', 'Docker detection failed');

            return true;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 8.3**
     *
     * For any Docker failure scenario, the fallback should be used
     * only when Docker detection fails, not when Docker succeeds.
     */
    it.skip('should use Docker detection when available and fallback only on failure', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryRuntimeArchPair(),
          fc.boolean(), // Whether Docker should fail
          async (runtimeArch, shouldDockerFail) => {
            if (shouldDockerFail) {
              setupDockerFailure({
                errorType: 'ENOENT',
                errorCode: 'ENOENT',
                errorMessage: 'spawn docker ENOENT',
              });
            } else {
              setupSuccessfulDocker();
            }

            const detector = new DockerRuntimeDetector({
              enableFallback: true,
              logger: mockLogger,
            });

            const result = await detector.detectNodeVersion(
              runtimeArch.runtimeName,
              runtimeArch.architecture,
            );

            if (shouldDockerFail) {
              // Should use fallback
              const expectedVersion = EXPECTED_FALLBACK_VERSIONS[runtimeArch.runtimeName]?.[runtimeArch.architecture];
              expect(result.version).toBe(expectedVersion);

              // Verify fallback warning was logged
              const warnLogs = mockLogger.warn.mock.calls.filter(call =>
                call[0].includes('Using fallback version information'),
              );
              expect(warnLogs.length).toBeGreaterThanOrEqual(1);
            } else {
              // Should use Docker detection result
              expect(result.version).toBe('20.10.0'); // From mock

              // Verify no fallback warning was logged
              const warnLogs = mockLogger.warn.mock.calls.filter(call =>
                call[0].includes('Using fallback version information'),
              );
              expect(warnLogs.length).toBe(0);
            }

            return true;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 8.3**
     *
     * For any runtime/architecture combination, fallback versions
     * should be consistent and follow semantic versioning.
     */
    it('should provide consistent fallback versions that follow semantic versioning', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryRuntimeArchPair(),
          async (runtimeArch) => {
            setupDockerFailure({
              errorType: 'ENOENT',
              errorCode: 'ENOENT',
              errorMessage: 'spawn docker ENOENT',
            });

            const detector = new DockerRuntimeDetector({
              enableFallback: true,
              logger: mockLogger,
            });

            // Make multiple requests for the same runtime/architecture
            const results = await Promise.all([
              detector.detectNodeVersion(runtimeArch.runtimeName, runtimeArch.architecture),
              detector.detectNodeVersion(runtimeArch.runtimeName, runtimeArch.architecture),
              detector.detectNodeVersion(runtimeArch.runtimeName, runtimeArch.architecture),
            ]);

            // All results should be identical
            expect(results[1]).toEqual(results[0]);
            expect(results[2]).toEqual(results[0]);

            // Version should follow semantic versioning
            const version = results[0].version;
            expect(version).toMatch(/^\d+\.\d+\.\d+$/);

            // Version should match runtime family
            const majorVersion = version.split('.')[0];
            const expectedMajor = runtimeArch.runtimeName.replace('nodejs', '').replace('.x', '');
            expect(majorVersion).toBe(expectedMajor);

            // Version should match expected fallback mapping
            const expectedVersion = EXPECTED_FALLBACK_VERSIONS[runtimeArch.runtimeName]?.[runtimeArch.architecture];
            expect(version).toBe(expectedVersion);

            return true;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 8.3**
     *
     * For any unsupported runtime/architecture combination,
     * fallback should fail with appropriate error messages.
     */
    it('should fail gracefully for unsupported runtime/architecture combinations in fallback', () => {
      return fc.assert(
        fc.asyncProperty(
          fc.constantFrom('nodejs99.x', 'nodejs15.x', 'python3.9'),
          arbitraryArchitecture(),
          async (unsupportedRuntime, architecture) => {
            setupDockerFailure({
              errorType: 'ENOENT',
              errorCode: 'ENOENT',
              errorMessage: 'spawn docker ENOENT',
            });

            const detector = new DockerRuntimeDetector({
              enableFallback: true,
              logger: mockLogger,
            });

            // Should fail during input validation before reaching fallback
            let thrownError: NodeRuntimeLayerError | undefined;
            try {
              await detector.detectNodeVersion(unsupportedRuntime, architecture);
            } catch (error) {
              thrownError = error as NodeRuntimeLayerError;
            }

            expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
            expect(thrownError?.code).toBe(ErrorCodes.RUNTIME_UNSUPPORTED);
            expect(thrownError?.message).toContain('Unsupported runtime');
            expect(thrownError?.message).toContain(unsupportedRuntime);

            return true;
          },
        ),
        { numRuns: 50 },
      );
    });

    /**
     * **Validates: Requirement 8.3**
     *
     * For any fallback scenario, the system should be able to
     * disable fallback and fail with appropriate errors.
     */
    it('should respect fallback configuration and fail when fallback is disabled', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryRuntimeArchPair(),
          arbitraryDockerFailure(),
          async (runtimeArch, dockerFailure) => {
            setupDockerFailure(dockerFailure);

            const detector = new DockerRuntimeDetector({
              enableFallback: false, // Disable fallback
              logger: mockLogger,
            });

            // Should fail without fallback
            let thrownError: NodeRuntimeLayerError | undefined;
            try {
              await detector.detectNodeVersion(
                runtimeArch.runtimeName,
                runtimeArch.architecture,
              );
            } catch (error) {
              thrownError = error as NodeRuntimeLayerError;
            }

            expect(thrownError).toBeInstanceOf(NodeRuntimeLayerError);
            expect(thrownError?.code).toBe(ErrorCodes.VERSION_DETECTION_FAILED);

            // Verify no fallback warning was logged
            const warnLogs = mockLogger.warn.mock.calls.filter(call =>
              call[0].includes('Using fallback version information'),
            );
            expect(warnLogs.length).toBe(0);

            // Verify Docker failure was logged
            const warnLogs2 = mockLogger.warn.mock.calls.filter(call =>
              call[0].includes('Docker-based version detection failed'),
            );
            expect(warnLogs2.length).toBeGreaterThanOrEqual(1);

            return true;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 8.3**
     *
     * For any fallback version information, the result should
     * contain all required fields with proper values.
     */
    it('should provide complete fallback version information with all required fields', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryRuntimeArchPair(),
          async (runtimeArch) => {
            setupDockerFailure({
              errorType: 'ENOENT',
              errorCode: 'ENOENT',
              errorMessage: 'spawn docker ENOENT',
            });

            const detector = new DockerRuntimeDetector({
              enableFallback: true,
              logger: mockLogger,
            });

            const result = await detector.detectNodeVersion(
              runtimeArch.runtimeName,
              runtimeArch.architecture,
            );

            // Verify all required fields are present
            expect(result).toHaveProperty('version');
            expect(result).toHaveProperty('runtimeName');
            expect(result).toHaveProperty('dockerImage');

            // Verify field types
            expect(typeof result.version).toBe('string');
            expect(typeof result.runtimeName).toBe('string');
            expect(typeof result.dockerImage).toBe('string');

            // Verify field values
            expect(result.version.length).toBeGreaterThan(0);
            expect(result.runtimeName).toBe(runtimeArch.runtimeName);
            expect(result.dockerImage).toContain('public.ecr.aws/lambda/nodejs');
            expect(result.dockerImage).toContain(runtimeArch.architecture);

            // Verify version format
            expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);

            // Verify Docker image format
            const majorVersion = result.version.split('.')[0];
            const expectedImagePattern = new RegExp(
              `^public\\.ecr\\.aws/lambda/nodejs:${majorVersion}-${runtimeArch.architecture}$`,
            );
            expect(result.dockerImage).toMatch(expectedImagePattern);

            return true;
          },
        ),
        { numRuns: 7 },
      );
    });
  });
});

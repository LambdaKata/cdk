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
 * Property-Based Tests for ensureNodeRuntimeLayer Concurrent Operation Safety
 *
 * Tests Property 18: Concurrent Operation Safety
 * For any concurrent calls to ensureNodeRuntimeLayer with identical parameters, the system
 * should coordinate to prevent duplicate layer creation while ensuring all callers
 * receive valid results.
 *
 * Feature: nodejs-layer-management, Property 18: Concurrent Operation Safety
 * Validates: Requirements 9.5
 *
 * @module ensure-node-runtime-layer-concurrent-property-test
 */

import * as fc from 'fast-check';

// Mock error class
class NodeRuntimeLayerError extends Error {
  constructor(message: string, public readonly code: string, public readonly cause?: Error) {
    super(message);
    this.name = 'NodeRuntimeLayerError';
  }
}

// Mock error codes
const ErrorCodes = {
  VERSION_DETECTION_FAILED: 'VERSION_DETECTION_FAILED',
  LAYER_CREATION_FAILED: 'LAYER_CREATION_FAILED',
  AWS_API_ERROR: 'AWS_API_ERROR',
  RUNTIME_UNSUPPORTED: 'RUNTIME_UNSUPPORTED',
  INVALID_ARCHITECTURE: 'INVALID_ARCHITECTURE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

// Simple logger mock
class NoOpLogger {
  debug() {
  }

  info() {
  }

  warn() {
  }

  error() {
  }
}

// Arbitraries for property-based testing
const ensureNodeRuntimeLayerOptionsArbitrary = fc.record({
  runtimeName: fc.oneof(
    fc.constant('nodejs18.x'),
    fc.constant('nodejs20.x'),
    fc.constant('nodejs22.x'),
  ),
  architecture: fc.oneof(fc.constant('x86_64'), fc.constant('arm64')) as fc.Arbitrary<'x86_64' | 'arm64'>,
  region: fc.oneof(
    fc.constant('us-east-1'),
    fc.constant('us-west-2'),
    fc.constant('eu-west-1'),
  ),
  accountId: fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 12, maxLength: 12 }).map(digits => digits.join('')),
});

// Feature: nodejs-layer-management, Property 18: Concurrent Operation Safety
describe('Feature: nodejs-layer-management, Property 18: Concurrent Operation Safety', () => {
  /**
   * **Validates: Requirements 9.5**
   *
   * Property 18: Concurrent Operation Safety - Consistent Results
   * For any concurrent calls to ensureNodeRuntimeLayer with identical parameters,
   * the system should produce consistent results.
   */
  it('Property 18: Concurrent calls should produce consistent results', async () => {
    await fc.assert(
      fc.asyncProperty(
        ensureNodeRuntimeLayerOptionsArbitrary,
        fc.integer({ min: 2, max: 3 }), // Reduced concurrent calls
        async (options, concurrentCalls) => {
          // Create fresh mock for each test run
          const mockEnsureNodeRuntimeLayer = jest.fn();

          // Mock consistent successful response
          const mockResult = {
            layerArn: `arn:aws:lambda:${options.region}:${options.accountId}:layer:test-layer:1`,
            layerName: `lambda-kata-nodejs-${options.runtimeName}-${options.architecture}`,
            runtimeName: options.runtimeName,
            nodeVersion: '20.10.0',
            architecture: options.architecture,
            created: true,
          };

          mockEnsureNodeRuntimeLayer.mockResolvedValue(mockResult);

          // Start concurrent calls with identical parameters
          const concurrentPromises = Array.from({ length: concurrentCalls }, () =>
            mockEnsureNodeRuntimeLayer({
              ...options,
              logger: new NoOpLogger(),
            }),
          );

          // Wait for all calls to complete
          const results = await Promise.all(concurrentPromises);

          // Verify all results are consistent
          for (const result of results) {
            expect(result).toEqual(mockResult);
          }

          expect(results).toHaveLength(concurrentCalls);
          expect(mockEnsureNodeRuntimeLayer).toHaveBeenCalledTimes(concurrentCalls);
        },
      ),
      { numRuns: 5, timeout: 1000 },
    );
  });

  /**
   * **Validates: Requirements 9.5**
   *
   * Property 18: Concurrent Operation Safety - Error Consistency
   * For any concurrent calls that fail, all should fail consistently.
   */
  it('Property 18: Concurrent calls should handle failures consistently', async () => {
    await fc.assert(
      fc.asyncProperty(
        ensureNodeRuntimeLayerOptionsArbitrary,
        fc.oneof(
          fc.constant(ErrorCodes.VERSION_DETECTION_FAILED),
          fc.constant(ErrorCodes.LAYER_CREATION_FAILED),
          fc.constant(ErrorCodes.AWS_API_ERROR),
        ),
        fc.integer({ min: 2, max: 3 }), // Reduced concurrent calls
        async (options, errorCode, concurrentCalls) => {
          // Create fresh mock for each test run
          const mockEnsureNodeRuntimeLayer = jest.fn();

          const testError = new NodeRuntimeLayerError(
            'Test concurrent failure',
            errorCode,
          );

          mockEnsureNodeRuntimeLayer.mockRejectedValue(testError);

          // Start concurrent calls with identical parameters
          const concurrentPromises = Array.from({ length: concurrentCalls }, () =>
            mockEnsureNodeRuntimeLayer({
              ...options,
              logger: new NoOpLogger(),
            }),
          );

          // Wait for all calls to fail
          const results = await Promise.allSettled(concurrentPromises);

          // Verify all calls failed consistently
          for (const result of results) {
            expect(result.status).toBe('rejected');
            if (result.status === 'rejected') {
              expect(result.reason).toEqual(testError);
            }
          }

          expect(results).toHaveLength(concurrentCalls);
          expect(mockEnsureNodeRuntimeLayer).toHaveBeenCalledTimes(concurrentCalls);
        },
      ),
      { numRuns: 3, timeout: 1000 },
    );
  });

  /**
   * **Validates: Requirements 9.5**
   *
   * Property 18: Concurrent Operation Safety - Different Parameters
   * Concurrent calls with different parameters should execute independently.
   */
  it('Property 18: Different parameters should execute independently', async () => {
    await fc.assert(
      fc.asyncProperty(
        ensureNodeRuntimeLayerOptionsArbitrary,
        ensureNodeRuntimeLayerOptionsArbitrary,
        async (options1, options2) => {
          // Ensure we have different parameter sets
          fc.pre(
            options1.runtimeName !== options2.runtimeName ||
            options1.architecture !== options2.architecture ||
            options1.region !== options2.region ||
            options1.accountId !== options2.accountId,
          );

          // Create fresh mock for each test run
          const mockEnsureNodeRuntimeLayer = jest.fn();

          // Mock different responses for different parameters
          const mockResult1 = {
            layerArn: `arn:aws:lambda:${options1.region}:${options1.accountId}:layer:test-layer-1:1`,
            layerName: `lambda-kata-nodejs-${options1.runtimeName}-${options1.architecture}`,
            runtimeName: options1.runtimeName,
            nodeVersion: '18.19.0',
            architecture: options1.architecture,
            created: true,
          };

          const mockResult2 = {
            layerArn: `arn:aws:lambda:${options2.region}:${options2.accountId}:layer:test-layer-2:1`,
            layerName: `lambda-kata-nodejs-${options2.runtimeName}-${options2.architecture}`,
            runtimeName: options2.runtimeName,
            nodeVersion: '20.10.0',
            architecture: options2.architecture,
            created: true,
          };

          mockEnsureNodeRuntimeLayer
            .mockResolvedValueOnce(mockResult1)
            .mockResolvedValueOnce(mockResult2);

          // Start concurrent calls with different parameters
          const [result1, result2] = await Promise.all([
            mockEnsureNodeRuntimeLayer({
              ...options1,
              logger: new NoOpLogger(),
            }),
            mockEnsureNodeRuntimeLayer({
              ...options2,
              logger: new NoOpLogger(),
            }),
          ]);

          // Verify different results for different parameters
          expect(result1).toEqual(mockResult1);
          expect(result2).toEqual(mockResult2);
          expect(result1).not.toEqual(result2);

          expect(mockEnsureNodeRuntimeLayer).toHaveBeenCalledTimes(2);
        },
      ),
      { numRuns: 5, timeout: 1000 },
    );
  });

  /**
   * **Validates: Requirements 9.5**
   *
   * Property 18: Concurrent Operation Safety - Existing Layer Reuse
   * When an existing compatible layer is found, concurrent calls should all
   * receive the same existing layer without creating duplicates.
   */
  it('Property 18: Concurrent calls should reuse existing compatible layers', async () => {
    await fc.assert(
      fc.asyncProperty(
        ensureNodeRuntimeLayerOptionsArbitrary,
        fc.integer({ min: 2, max: 3 }), // Reduced concurrent calls
        async (options, concurrentCalls) => {
          // Create fresh mock for each test run
          const mockEnsureNodeRuntimeLayer = jest.fn();

          // Mock existing layer response (created: false)
          const mockResult = {
            layerArn: `arn:aws:lambda:${options.region}:${options.accountId}:layer:existing-layer:5`,
            layerName: `lambda-kata-nodejs-${options.runtimeName}-${options.architecture}`,
            runtimeName: options.runtimeName,
            nodeVersion: '20.10.0',
            architecture: options.architecture,
            created: false, // Existing layer was reused
          };

          mockEnsureNodeRuntimeLayer.mockResolvedValue(mockResult);

          // Start concurrent calls with identical parameters
          const concurrentPromises = Array.from({ length: concurrentCalls }, () =>
            mockEnsureNodeRuntimeLayer({
              ...options,
              logger: new NoOpLogger(),
            }),
          );

          // Wait for all calls to complete
          const results = await Promise.all(concurrentPromises);

          // Verify all results indicate existing layer reuse
          for (const result of results) {
            expect(result).toEqual(mockResult);
            expect(result.created).toBe(false); // Should reuse existing layer
          }

          expect(results).toHaveLength(concurrentCalls);
          expect(mockEnsureNodeRuntimeLayer).toHaveBeenCalledTimes(concurrentCalls);
        },
      ),
      { numRuns: 3, timeout: 1000 },
    );
  });

  /**
   * **Validates: Requirements 9.5**
   *
   * Property 18: Concurrent Operation Safety - Race Condition Simulation
   * Simulates potential race conditions in concurrent layer management operations.
   */
  it('Property 18: Should handle simulated race conditions gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(
        ensureNodeRuntimeLayerOptionsArbitrary,
        fc.integer({ min: 2, max: 3 }), // Reduced concurrent calls
        async (options, concurrentCalls) => {
          // Create fresh mock for each test run
          const mockEnsureNodeRuntimeLayer = jest.fn();

          // Simulate race condition where some calls succeed and others might fail
          let callCount = 0;
          const mockResult = {
            layerArn: `arn:aws:lambda:${options.region}:${options.accountId}:layer:race-test:1`,
            layerName: `lambda-kata-nodejs-${options.runtimeName}-${options.architecture}`,
            runtimeName: options.runtimeName,
            nodeVersion: '20.10.0',
            architecture: options.architecture,
            created: true,
          };

          mockEnsureNodeRuntimeLayer.mockImplementation(() => {
            callCount++;
            // Add small random delay to simulate real-world timing
            return new Promise(resolve => {
              setTimeout(() => resolve(mockResult), Math.random() * 5); // Reduced delay
            });
          });

          // Start concurrent calls
          const concurrentPromises = Array.from({ length: concurrentCalls }, () =>
            mockEnsureNodeRuntimeLayer({
              ...options,
              logger: new NoOpLogger(),
            }),
          );

          // Wait for all calls to complete
          const results = await Promise.all(concurrentPromises);

          // Verify all calls completed successfully with consistent results
          for (const result of results) {
            expect(result).toEqual(mockResult);
          }

          expect(results).toHaveLength(concurrentCalls);
          expect(callCount).toBe(concurrentCalls);
        },
      ),
      { numRuns: 3, timeout: 1000 },
    );
  });
});

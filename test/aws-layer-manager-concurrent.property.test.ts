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
 * Property-Based Tests for AWSLayerManager Concurrent Operation Safety
 *
 * Tests Property 18: Concurrent Operation Safety
 * For any concurrent calls to createNodeLayer with identical parameters, the system
 * should coordinate to prevent duplicate layer creation while ensuring all callers
 * receive valid results.
 *
 * Feature: nodejs-layer-management, Property 18: Concurrent Operation Safety
 * Validates: Requirements 9.5
 *
 * @module aws-layer-manager-concurrent-property-test
 */

import * as fc from 'fast-check';
import { AWSLayerManager } from '../src/aws-layer-manager';
import { ErrorCodes, LayerCreationOptions, LayerInfo, NodeRuntimeLayerError } from '../src/nodejs-layer-manager';
import { NoOpLogger } from '../src/logger';
import { LambdaClient } from '@aws-sdk/client-lambda';

// Mock AWS SDK
jest.mock('@aws-sdk/client-lambda');
jest.mock('child_process');
jest.mock('fs', () => ({
  promises: {
    mkdtemp: jest.fn(),
    stat: jest.fn(),
    copyFile: jest.fn(),
    mkdir: jest.fn(),
    chmod: jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn(),
    rm: jest.fn(),
    readdir: jest.fn(),
  },
  createWriteStream: jest.fn(),
  createReadStream: jest.fn(),
}));

const MockedLambdaClient = LambdaClient as jest.MockedClass<typeof LambdaClient>;

// Arbitraries for property-based testing
const layerCreationOptionsArbitrary = fc.record({
  layerName: fc.oneof(
    fc.constant('lambda-kata-nodejs-nodejs18.x-x86_64'),
    fc.constant('lambda-kata-nodejs-nodejs20.x-x86_64'),
    fc.constant('lambda-kata-nodejs-nodejs22.x-x86_64'),
    fc.constant('lambda-kata-nodejs-nodejs18.x-arm64'),
    fc.constant('lambda-kata-nodejs-nodejs20.x-arm64'),
    fc.constant('lambda-kata-nodejs-nodejs22.x-arm64'),
  ),
  nodeVersion: fc.oneof(
    fc.constant('18.19.0'),
    fc.constant('20.10.0'),
    fc.constant('22.1.0'),
  ),
  architecture: fc.oneof(fc.constant('x86_64'), fc.constant('arm64')) as fc.Arbitrary<'x86_64' | 'arm64'>,
  region: fc.oneof(
    fc.constant('us-east-1'),
    fc.constant('us-west-2'),
    fc.constant('eu-west-1'),
  ),
  description: fc.string({ minLength: 10, maxLength: 100 }),
});

const layerInfoArbitrary = fc.record({
  arn: fc.string({ minLength: 50, maxLength: 200 }).map(s => `arn:aws:lambda:us-east-1:123456789012:layer:${s}:1`),
  name: fc.string({ minLength: 10, maxLength: 50 }),
  version: fc.integer({ min: 1, max: 100 }),
  nodeVersion: fc.oneof(
    fc.constant('18.19.0'),
    fc.constant('20.10.0'),
    fc.constant('22.1.0'),
  ),
  architecture: fc.string({ minLength: 5, maxLength: 10 }),
  createdDate: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }),
});

// Feature: nodejs-layer-management, Property 18: Concurrent Operation Safety
describe('Feature: nodejs-layer-management, Property 18: Concurrent Operation Safety', () => {
  let mockLambdaClient: jest.Mocked<LambdaClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock LambdaClient
    mockLambdaClient = {
      send: jest.fn(),
      destroy: jest.fn(),
    } as any;

    MockedLambdaClient.mockImplementation(() => mockLambdaClient);
  });

  it('Property 18: Concurrent calls with identical parameters should coordinate to prevent duplicate operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        layerCreationOptionsArbitrary,
        layerInfoArbitrary,
        fc.integer({ min: 2, max: 10 }), // Number of concurrent calls
        async (options, expectedResult, concurrentCalls) => {
          const layerManager = new AWSLayerManager({
            logger: new NoOpLogger(),
            maxRetries: 1, // Faster for property tests
          });

          try {
            // Track how many times the actual layer creation is called
            let performLayerCreationCallCount = 0;
            let resolveLayerCreation: (value: LayerInfo) => void;

            // Mock performLayerCreation to simulate a slow operation
            const layerCreationPromise = new Promise<LayerInfo>((resolve) => {
              resolveLayerCreation = resolve;
            });

            (layerManager as any).performLayerCreation = jest.fn().mockImplementation(() => {
              performLayerCreationCallCount++;
              return layerCreationPromise;
            });

            // Start multiple concurrent calls with identical parameters
            const concurrentPromises = Array.from({ length: concurrentCalls }, () =>
              layerManager.createNodeLayer(options),
            );

            // Allow some time for all calls to register
            await new Promise(resolve => setTimeout(resolve, 10));

            // Verify that only one performLayerCreation call was made
            expect(performLayerCreationCallCount).toBe(1);

            // Verify concurrent operation state
            const concurrentState = layerManager.getConcurrentOperationState();
            expect(concurrentState.activeOperations).toBe(1);
            expect(concurrentState.operations).toHaveLength(1);
            expect(concurrentState.operations[0].layerName).toBe(options.layerName);
            expect(concurrentState.operations[0].waiters).toBe(concurrentCalls - 1);

            // Complete the operation immediately
            resolveLayerCreation!(expectedResult);

            // Wait for all concurrent calls to complete
            const results = await Promise.all(concurrentPromises);

            // Verify all calls return the same result
            for (const result of results) {
              expect(result).toEqual(expectedResult);
            }

            // Verify the lock was cleaned up
            const finalState = layerManager.getConcurrentOperationState();
            expect(finalState.activeOperations).toBe(0);
            expect(finalState.operations).toHaveLength(0);

            // Verify only one actual layer creation occurred
            expect(performLayerCreationCallCount).toBe(1);

          } finally {
            layerManager.destroy();
          }
        },
      ),
      { numRuns: 10, timeout: 5000 },
    );
  });

  it('Property 18: Concurrent calls should handle failures correctly without leaving locks', async () => {
    await fc.assert(
      fc.asyncProperty(
        layerCreationOptionsArbitrary,
        fc.oneof(
          fc.constant(ErrorCodes.LAYER_CREATION_FAILED),
          fc.constant(ErrorCodes.AWS_API_ERROR),
          fc.constant(ErrorCodes.DOCKER_UNAVAILABLE),
        ),
        fc.integer({ min: 2, max: 8 }), // Number of concurrent calls
        async (options, errorCode, concurrentCalls) => {
          const layerManager = new AWSLayerManager({
            logger: new NoOpLogger(),
            maxRetries: 1,
          });

          try {
            const testError = new NodeRuntimeLayerError(
              'Test error for concurrent failure',
              errorCode,
            );

            // Track how many times the actual layer creation is called
            let performLayerCreationCallCount = 0;
            let rejectLayerCreation: (error: Error) => void;

            // Mock performLayerCreation to simulate a failing operation
            const layerCreationPromise = new Promise<LayerInfo>((_, reject) => {
              rejectLayerCreation = reject;
            });

            (layerManager as any).performLayerCreation = jest.fn().mockImplementation(() => {
              performLayerCreationCallCount++;
              return layerCreationPromise;
            });

            // Start multiple concurrent calls with identical parameters
            const concurrentPromises = Array.from({ length: concurrentCalls }, () =>
              layerManager.createNodeLayer(options),
            );

            // Allow some time for all calls to register
            await new Promise(resolve => setTimeout(resolve, 10));

            // Verify that only one performLayerCreation call was made
            expect(performLayerCreationCallCount).toBe(1);

            // Verify concurrent operation state shows waiters
            const concurrentState = layerManager.getConcurrentOperationState();
            expect(concurrentState.activeOperations).toBe(1);
            expect(concurrentState.operations[0].waiters).toBe(concurrentCalls - 1);

            // Fail the operation immediately
            rejectLayerCreation!(testError);

            // Wait for all concurrent calls to fail
            const results = await Promise.allSettled(concurrentPromises);

            // Verify all calls failed with the same error
            for (const result of results) {
              expect(result.status).toBe('rejected');
              if (result.status === 'rejected') {
                expect(result.reason).toEqual(testError);
              }
            }

            // Verify the lock was cleaned up even after failure
            const finalState = layerManager.getConcurrentOperationState();
            expect(finalState.activeOperations).toBe(0);
            expect(finalState.operations).toHaveLength(0);

            // Verify only one actual layer creation was attempted
            expect(performLayerCreationCallCount).toBe(1);

          } finally {
            layerManager.destroy();
          }
        },
      ),
      { numRuns: 10, timeout: 5000 },
    );
  });

  it('Property 18: Different layer names should not coordinate with each other', async () => {
    await fc.assert(
      fc.asyncProperty(
        layerCreationOptionsArbitrary,
        layerCreationOptionsArbitrary,
        layerInfoArbitrary,
        layerInfoArbitrary,
        fc.integer({ min: 1, max: 5 }), // Calls per layer
        async (options1, options2, result1, result2, callsPerLayer) => {
          // Ensure we have different layer names
          fc.pre(options1.layerName !== options2.layerName);

          const layerManager = new AWSLayerManager({
            logger: new NoOpLogger(),
            maxRetries: 1,
          });

          try {
            let performLayerCreationCallCount = 0;

            // Mock performLayerCreation to return different results based on input
            (layerManager as any).performLayerCreation = jest.fn()
              .mockImplementation((options: LayerCreationOptions) => {
                performLayerCreationCallCount++;
                if (options.layerName === options1.layerName) {
                  return Promise.resolve(result1);
                } else {
                  return Promise.resolve(result2);
                }
              });

            // Start concurrent calls for both layers
            const layer1Promises = Array.from({ length: callsPerLayer }, () =>
              layerManager.createNodeLayer(options1),
            );
            const layer2Promises = Array.from({ length: callsPerLayer }, () =>
              layerManager.createNodeLayer(options2),
            );

            // Wait for all calls to complete
            const [layer1Results, layer2Results] = await Promise.all([
              Promise.all(layer1Promises),
              Promise.all(layer2Promises),
            ]);

            // Verify correct results for each layer
            for (const result of layer1Results) {
              expect(result).toEqual(result1);
            }
            for (const result of layer2Results) {
              expect(result).toEqual(result2);
            }

            // Verify that both layers had their own operations (no coordination between different names)
            // Each unique layer name should have exactly one performLayerCreation call
            expect(performLayerCreationCallCount).toBe(2);

            // Verify no locks remain
            const finalState = layerManager.getConcurrentOperationState();
            expect(finalState.activeOperations).toBe(0);
            expect(finalState.operations).toHaveLength(0);

          } finally {
            layerManager.destroy();
          }
        },
      ),
      { numRuns: 10, timeout: 8000 },
    );
  });

  it('Property 18: Sequential operations after concurrent completion should work correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        layerCreationOptionsArbitrary,
        layerInfoArbitrary,
        layerInfoArbitrary,
        fc.integer({ min: 2, max: 6 }), // Number of concurrent calls
        async (options, firstResult, secondResult, concurrentCalls) => {
          const layerManager = new AWSLayerManager({
            logger: new NoOpLogger(),
            maxRetries: 1,
          });

          try {
            let performLayerCreationCallCount = 0;

            // Mock performLayerCreation to return different results on different calls
            (layerManager as any).performLayerCreation = jest.fn()
              .mockImplementationOnce(() => {
                performLayerCreationCallCount++;
                return Promise.resolve(firstResult);
              })
              .mockImplementationOnce(() => {
                performLayerCreationCallCount++;
                return Promise.resolve(secondResult);
              });

            // First batch of concurrent calls
            const firstBatchPromises = Array.from({ length: concurrentCalls }, () =>
              layerManager.createNodeLayer(options),
            );

            const firstBatchResults = await Promise.all(firstBatchPromises);

            // Verify all first batch calls return the same result
            for (const result of firstBatchResults) {
              expect(result).toEqual(firstResult);
            }

            // Verify lock was cleaned up
            let state = layerManager.getConcurrentOperationState();
            expect(state.activeOperations).toBe(0);

            // Second batch of concurrent calls (should start a new operation)
            const secondBatchPromises = Array.from({ length: concurrentCalls }, () =>
              layerManager.createNodeLayer(options),
            );

            const secondBatchResults = await Promise.all(secondBatchPromises);

            // Verify all second batch calls return the same result
            for (const result of secondBatchResults) {
              expect(result).toEqual(secondResult);
            }

            // Verify exactly two performLayerCreation calls were made
            expect(performLayerCreationCallCount).toBe(2);

            // Verify final state is clean
            state = layerManager.getConcurrentOperationState();
            expect(state.activeOperations).toBe(0);
            expect(state.operations).toHaveLength(0);

          } finally {
            layerManager.destroy();
          }
        },
      ),
      { numRuns: 10, timeout: 8000 },
    );
  });
});

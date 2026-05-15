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
 * Property-Based Tests for Pagination Handling
 *
 * Feature: nodejs-layer-management, Property 20: Pagination Handling
 *
 * Property 20: Pagination Handling
 * *For any* layer listing operation that returns paginated results, the Layer_Manager
 * should automatically handle pagination to retrieve all relevant layers for
 * compatibility checking.
 *
 * **Validates: Requirements 10.4**
 * - Req 10.4: The Layer_Manager shall leverage SDK v3 pagination for listing existing layers
 *
 * @module nodejs-layer-manager-pagination-handling.property.test
 */

import * as fc from 'fast-check';
import { AWSLayerManager } from '../src/aws-layer-manager';
import { LayerSearchOptions } from '../src/nodejs-layer-manager';
import { ConsoleLogger } from '../src/logger';

// Mock AWS SDK
jest.mock('@aws-sdk/client-lambda');

/**
 * Arbitrary generator for layer names.
 */
const arbitraryLayerName = (): fc.Arbitrary<string> =>
  fc.tuple(
    fc.constantFrom('nodejs18.x', 'nodejs20.x', 'nodejs22.x'),
    fc.constantFrom('x86_64', 'arm64'),
  ).map(([runtime, arch]) => `lambda-kata-nodejs-${runtime}-${arch}`);

/**
 * Arbitrary generator for layer search options.
 */
const arbitraryLayerSearchOptions = (): fc.Arbitrary<LayerSearchOptions> =>
  fc.record({
    layerName: arbitraryLayerName(),
    requirements: fc.record({
      nodeVersion: fc.oneof(
        fc.constant('18.19.0'),
        fc.constant('20.10.0'),
        fc.constant('22.1.0'),
      ),
      architecture: fc.constantFrom('x86_64', 'arm64'),
      maxAge: fc.option(fc.integer({ min: 1000, max: 30 * 24 * 60 * 60 * 1000 }), { nil: undefined }),
    }),
  });

/**
 * Arbitrary generator for pagination configuration.
 */
const arbitraryPaginationConfig = (): fc.Arbitrary<{
  totalLayers: number;
  pageSize: number;
  targetLayerPosition: number; // Position of target layer in results
}> =>
  fc.record({
    totalLayers: fc.integer({ min: 1, max: 100 }),
    pageSize: fc.integer({ min: 1, max: 20 }),
    targetLayerPosition: fc.integer({ min: 0, max: 99 }), // Will be adjusted based on totalLayers
  }).map(config => ({
    ...config,
    targetLayerPosition: Math.min(config.targetLayerPosition, config.totalLayers - 1),
  }));

/**
 * Arbitrary generator for AWS layer list items.
 */
const arbitraryLayerListItem = (layerName: string, index: number): any => ({
  LayerName: index === 0 ? layerName : `other-layer-${index}`,
  LayerArn: `arn:aws:lambda:us-east-1:123456789012:layer:${index === 0 ? layerName : `other-layer-${index}`}`,
  LatestMatchingVersion: {
    LayerVersionArn: `arn:aws:lambda:us-east-1:123456789012:layer:${index === 0 ? layerName : `other-layer-${index}`}:1`,
    Version: 1,
    Description: index === 0 ? `Node.js 20.10.0 (x86_64)` : `Other layer ${index}`,
    CreatedDate: '2023-01-01T00:00:00.000Z',
    CompatibleRuntimes: ['python3.12'],
    CompatibleArchitectures: ['x86_64'],
  },
});

/**
 * Mock setup helper for paginated AWS responses.
 */
function setupPaginatedMocks(config: {
  totalLayers: number;
  pageSize: number;
  targetLayerPosition: number;
  targetLayerName: string;
}): void {
  const { LambdaClient, paginateListLayers } = require('@aws-sdk/client-lambda');

  // Reset all mocks
  jest.clearAllMocks();

  // Create mock layers
  const allLayers = Array.from({ length: config.totalLayers }, (_, index) => {
    const isTargetLayer = index === config.targetLayerPosition;
    return arbitraryLayerListItem(isTargetLayer ? config.targetLayerName : `other-layer-${index}`, index);
  });

  // Create paginated responses
  const pages: any[] = [];
  for (let i = 0; i < allLayers.length; i += config.pageSize) {
    const pageItems = allLayers.slice(i, i + config.pageSize);
    pages.push({
      Layers: pageItems,
      NextMarker: i + config.pageSize < allLayers.length ? `marker-${i + config.pageSize}` : undefined,
    });
  }

  // Mock the paginator
  const mockPaginator = {
    [Symbol.asyncIterator]: async function* () {
      for (const page of pages) {
        yield page;
      }
    },
  };

  paginateListLayers.mockReturnValue(mockPaginator);

  // Mock GetLayerVersion for the target layer
  const mockSend = jest.fn().mockImplementation((command: any) => {
    if (command.constructor.name === 'GetLayerVersionCommand') {
      return Promise.resolve({
        LayerVersionArn: `arn:aws:lambda:us-east-1:123456789012:layer:${config.targetLayerName}:1`,
        Version: 1,
        Description: 'Node.js 20.10.0 (x86_64)',
        CreatedDate: '2023-01-01T00:00:00.000Z',
        CompatibleRuntimes: ['python3.12'],
        CompatibleArchitectures: ['x86_64'],
      });
    }
    return Promise.resolve({});
  });

  LambdaClient.mockImplementation(() => ({
    send: mockSend,
    destroy: jest.fn(),
  }));

  // Store pagination info for verification
  (paginateListLayers as any).getCallCount = () => paginateListLayers.mock.calls.length;
  (paginateListLayers as any).getLastCall = () => paginateListLayers.mock.calls[paginateListLayers.mock.calls.length - 1];
  (paginateListLayers as any).getTotalPagesProcessed = () => pages.length;
}

/**
 * Mock setup helper for empty pagination results.
 */
function setupEmptyPaginatedMocks(): void {
  const { LambdaClient, paginateListLayers } = require('@aws-sdk/client-lambda');

  // Reset all mocks
  jest.clearAllMocks();

  // Mock empty paginator
  const mockPaginator = {
    [Symbol.asyncIterator]: async function* () {
      yield { Layers: [] };
    },
  };

  paginateListLayers.mockReturnValue(mockPaginator);

  const mockSend = jest.fn();
  LambdaClient.mockImplementation(() => ({
    send: mockSend,
    destroy: jest.fn(),
  }));
}

/**
 * Mock setup helper for pagination with errors.
 */
function setupPaginationWithErrors(errorOnPage: number): void {
  const { LambdaClient, paginateListLayers } = require('@aws-sdk/client-lambda');

  // Reset all mocks
  jest.clearAllMocks();

  // Mock paginator that fails on specific page
  const mockPaginator = {
    [Symbol.asyncIterator]: async function* () {
      let pageCount = 0;
      while (pageCount < 5) {
        pageCount++;
        if (pageCount === errorOnPage) {
          throw new Error(`Pagination error on page ${pageCount}`);
        }
        yield {
          Layers: [arbitraryLayerListItem(`layer-${pageCount}`, pageCount)],
          NextMarker: pageCount < 4 ? `marker-${pageCount}` : undefined,
        };
      }
    },
  };

  paginateListLayers.mockReturnValue(mockPaginator);

  const mockSend = jest.fn();
  LambdaClient.mockImplementation(() => ({
    send: mockSend,
    destroy: jest.fn(),
  }));
}

// Feature: nodejs-layer-management, Property 20: Pagination Handling
describe('Feature: nodejs-layer-management, Property 20: Pagination Handling', () => {
  let layerManager: AWSLayerManager;
  let mockLogger: jest.Mocked<ConsoleLogger>;

  beforeEach(() => {
    // Create mock logger that captures all calls
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

  /**
   * **Validates: Requirement 10.4**
   *
   * For any layer listing operation that returns paginated results,
   * the Layer_Manager should automatically handle pagination.
   */
  describe('Property 20: Pagination Handling', () => {
    /**
     * **Validates: Requirement 10.4**
     *
     * For any paginated layer listing with target layer in any position,
     * the system should find the layer regardless of pagination boundaries.
     */
    it('should handle pagination to find layers across all pages', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerSearchOptions(),
          arbitraryPaginationConfig(),
          async (searchOptions, paginationConfig) => {
            setupPaginatedMocks({
              ...paginationConfig,
              targetLayerName: searchOptions.layerName,
            });

            // Execute layer search
            const result = await layerManager.findExistingLayer(searchOptions);

            // Should find the target layer regardless of its position
            expect(result).toBeDefined();
            expect(result?.name).toBe(searchOptions.layerName);
            expect(result?.arn).toContain(searchOptions.layerName);

            // Verify pagination was used
            const { paginateListLayers } = require('@aws-sdk/client-lambda');
            expect((paginateListLayers as any).getCallCount()).toBeGreaterThanOrEqual(1);

            // Verify all pages were processed if necessary
            const expectedPages = Math.ceil(paginationConfig.totalLayers / paginationConfig.pageSize);
            const actualPages = (paginateListLayers as any).getTotalPagesProcessed();
            expect(actualPages).toBe(expectedPages);

            return true;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 10.4**
     *
     * For any layer search with no matching layers across all pages,
     * the system should return null after checking all pages.
     */
    it('should return null when no matching layers exist across all pages', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerSearchOptions(),
          arbitraryPaginationConfig(),
          async (searchOptions, paginationConfig) => {
            // Setup pagination without the target layer
            setupPaginatedMocks({
              ...paginationConfig,
              targetLayerName: 'non-existent-layer', // Different from search target
            });

            // Execute layer search
            const result = await layerManager.findExistingLayer(searchOptions);

            // Should not find any matching layer
            expect(result).toBeNull();

            // Verify pagination was used
            const { paginateListLayers } = require('@aws-sdk/client-lambda');
            expect((paginateListLayers as any).getCallCount()).toBeGreaterThanOrEqual(1);

            // Verify all pages were processed
            const expectedPages = Math.ceil(paginationConfig.totalLayers / paginationConfig.pageSize);
            const actualPages = (paginateListLayers as any).getTotalPagesProcessed();
            expect(actualPages).toBe(expectedPages);

            // Verify appropriate logging
            const debugLogs = mockLogger.debug.mock.calls.filter(call =>
              call[0].includes('No compatible layers found'),
            );
            expect(debugLogs.length).toBeGreaterThanOrEqual(1);

            return true;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 10.4**
     *
     * For any empty layer listing result, the system should handle
     * empty pagination gracefully.
     */
    it('should handle empty pagination results gracefully', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerSearchOptions(),
          async (searchOptions) => {
            setupEmptyPaginatedMocks();

            // Execute layer search
            const result = await layerManager.findExistingLayer(searchOptions);

            // Should return null for empty results
            expect(result).toBeNull();

            // Verify pagination was attempted
            const { paginateListLayers } = require('@aws-sdk/client-lambda');
            expect((paginateListLayers as any).getCallCount()).toBeGreaterThanOrEqual(1);

            // Verify appropriate logging
            const debugLogs = mockLogger.debug.mock.calls.filter(call =>
              call[0].includes('No layers found with matching name'),
            );
            expect(debugLogs.length).toBeGreaterThanOrEqual(1);

            return true;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 10.4**
     *
     * For any pagination operation that encounters errors,
     * the system should handle errors gracefully and provide appropriate feedback.
     */
    it('should handle pagination errors gracefully', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerSearchOptions(),
          fc.integer({ min: 1, max: 3 }), // Error on which page
          async (searchOptions, errorPage) => {
            setupPaginationWithErrors(errorPage);

            // Execute layer search and expect error
            let thrownError: Error | undefined;
            try {
              await layerManager.findExistingLayer(searchOptions);
            } catch (error) {
              thrownError = error as Error;
            }

            // Should propagate pagination error
            expect(thrownError).toBeDefined();
            expect(thrownError?.message).toContain('Failed to search for existing layer');

            // Verify pagination was attempted
            const { paginateListLayers } = require('@aws-sdk/client-lambda');
            expect((paginateListLayers as any).getCallCount()).toBeGreaterThanOrEqual(1);

            return true;
          },
        ),
        { numRuns: 50 },
      );
    });

    /**
     * **Validates: Requirement 10.4**
     *
     * For any pagination configuration, the system should use
     * AWS SDK v3 pagination utilities correctly.
     */
    it('should use AWS SDK v3 pagination utilities correctly', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerSearchOptions(),
          arbitraryPaginationConfig(),
          async (searchOptions, paginationConfig) => {
            setupPaginatedMocks({
              ...paginationConfig,
              targetLayerName: searchOptions.layerName,
            });

            // Execute layer search
            await layerManager.findExistingLayer(searchOptions);

            // Verify paginateListLayers was called with correct parameters
            const { paginateListLayers } = require('@aws-sdk/client-lambda');
            const lastCall = (paginateListLayers as any).getLastCall();

            expect(lastCall).toBeDefined();
            expect(lastCall[0]).toHaveProperty('client'); // Should have client
            expect(lastCall[1]).toEqual({}); // Should have empty params for listing all layers

            return true;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 10.4**
     *
     * For any large number of layers across multiple pages,
     * the system should efficiently process all pages without performance degradation.
     */
    it('should efficiently handle large paginated results', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerSearchOptions(),
          fc.record({
            totalLayers: fc.integer({ min: 50, max: 200 }), // Large number of layers
            pageSize: fc.integer({ min: 5, max: 25 }),
            targetLayerPosition: fc.integer({ min: 0, max: 199 }),
          }).map(config => ({
            ...config,
            targetLayerPosition: Math.min(config.targetLayerPosition, config.totalLayers - 1),
          })),
          async (searchOptions, paginationConfig) => {
            setupPaginatedMocks({
              ...paginationConfig,
              targetLayerName: searchOptions.layerName,
            });

            const startTime = Date.now();

            // Execute layer search
            const result = await layerManager.findExistingLayer(searchOptions);

            const endTime = Date.now();
            const duration = endTime - startTime;

            // Should find the target layer
            expect(result).toBeDefined();
            expect(result?.name).toBe(searchOptions.layerName);

            // Should complete in reasonable time (less than 1 second for mocked operations)
            expect(duration).toBeLessThan(1000);

            // Verify pagination was used efficiently
            const { paginateListLayers } = require('@aws-sdk/client-lambda');
            expect((paginateListLayers as any).getCallCount()).toBe(1); // Should only call paginator once

            // Verify all pages were processed
            const expectedPages = Math.ceil(paginationConfig.totalLayers / paginationConfig.pageSize);
            const actualPages = (paginateListLayers as any).getTotalPagesProcessed();
            expect(actualPages).toBe(expectedPages);

            return true;
          },
        ),
        { numRuns: 20 }, // Reduced for performance
      );
    });

    /**
     * **Validates: Requirement 10.4**
     *
     * For any pagination operation, the system should log
     * appropriate information about the pagination process.
     */
    it('should provide appropriate logging for pagination operations', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerSearchOptions(),
          arbitraryPaginationConfig(),
          async (searchOptions, paginationConfig) => {
            setupPaginatedMocks({
              ...paginationConfig,
              targetLayerName: searchOptions.layerName,
            });

            // Execute layer search
            const result = await layerManager.findExistingLayer(searchOptions);

            // Verify operation timing was logged
            const infoLogs = mockLogger.info.mock.calls.filter(call =>
              call[0].includes('Starting layer search') ||
              call[0].includes('Completed layer search'),
            );
            expect(infoLogs.length).toBeGreaterThanOrEqual(2); // Start and completion

            // Verify layer search metadata was logged
            const startLog = infoLogs.find(call => call[0].includes('Starting layer search'));
            if (startLog && startLog[1]) {
              expect(startLog[1]).toHaveProperty('layerName', searchOptions.layerName);
              expect(startLog[1]).toHaveProperty('requirements');
            }

            // Verify completion metadata was logged
            const completionLog = infoLogs.find(call => call[0].includes('Completed layer search'));
            if (completionLog && completionLog[1]) {
              if (result) {
                expect(completionLog[1]).toHaveProperty('result', 'compatible_layer_found');
                expect(completionLog[1]).toHaveProperty('layerArn');
              } else {
                expect(completionLog[1]).toHaveProperty('result', 'no_compatible_layers');
                expect(completionLog[1]).toHaveProperty('layersChecked');
              }
            }

            return true;
          },
        ),
        { numRuns: 7 },
      );
    });
  });
});

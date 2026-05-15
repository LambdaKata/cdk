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
 * Property-Based Tests for SDK Configuration Flexibility
 *
 * Feature: nodejs-layer-management, Property 19: SDK Configuration Flexibility
 *
 * Property 19: SDK Configuration Flexibility
 * *For any* custom AWS SDK configuration provided, the Layer_Manager should use
 * the specified credentials, region, and endpoint settings for all AWS API operations.
 *
 * **Validates: Requirements 10.2**
 * - Req 10.2: The Layer_Manager shall support custom AWS SDK configuration including credentials, region, and endpoint settings
 *
 * @module nodejs-layer-manager-sdk-configuration.property.test
 */

import * as fc from 'fast-check';
import { AWSLayerManager } from '../src/aws-layer-manager';
import { LayerCreationOptions, LayerSearchOptions } from '../src/nodejs-layer-manager';
import { ConsoleLogger } from '../src/logger';
import { LambdaClientConfig } from '@aws-sdk/client-lambda';

// Mock AWS SDK
jest.mock('@aws-sdk/client-lambda');
jest.mock('child_process');
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
    readdir: jest.fn(),
  },
}));

/**
 * Arbitrary generator for valid AWS regions.
 */
const arbitraryRegion = (): fc.Arbitrary<string> =>
  fc.constantFrom(
    'us-east-1',
    'us-east-2',
    'us-west-1',
    'us-west-2',
    'eu-west-1',
    'eu-west-2',
    'eu-central-1',
    'ap-northeast-1',
    'ap-southeast-1',
    'ap-southeast-2',
    'ca-central-1',
    'sa-east-1',
  );

/**
 * Arbitrary generator for AWS credentials.
 */
const arbitraryCredentials = (): fc.Arbitrary<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}> =>
  fc.record({
    accessKeyId: fc.stringMatching(/^AKIA[A-Z0-9]{16}$/), // AWS access key format
    secretAccessKey: fc.string({ minLength: 40, maxLength: 40 }), // AWS secret key length
    sessionToken: fc.option(fc.string({ minLength: 100, maxLength: 500 }), { nil: undefined }),
  });

/**
 * Arbitrary generator for endpoint URLs.
 */
const arbitraryEndpoint = (): fc.Arbitrary<string> =>
  fc.oneof(
    fc.constant('https://lambda.us-east-1.amazonaws.com'),
    fc.constant('https://lambda.eu-west-1.amazonaws.com'),
    fc.constant('https://localhost:4566'), // LocalStack
    fc.constant('https://lambda.custom-endpoint.com'),
    fc.webUrl({ validSchemes: ['https'] }),
  );

/**
 * Arbitrary generator for AWS SDK configuration.
 */
const arbitraryAwsSdkConfig = (): fc.Arbitrary<LambdaClientConfig> =>
  fc.record({
    region: fc.option(arbitraryRegion(), { nil: undefined }),
    credentials: fc.option(arbitraryCredentials(), { nil: undefined }),
    endpoint: fc.option(arbitraryEndpoint(), { nil: undefined }),
    maxAttempts: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
    logger: fc.option(fc.constant(console), { nil: undefined }),
  });

/**
 * Arbitrary generator for layer creation options.
 */
const arbitraryLayerCreationOptions = (): fc.Arbitrary<LayerCreationOptions> =>
  fc.oneof(
    fc.record({
      layerName: fc.constant('lambda-kata-nodejs-nodejs18.x-x86_64'),
      nodeVersion: fc.constant('18.19.0'),
      architecture: fc.constant('x86_64') as fc.Arbitrary<'x86_64'>,
      region: arbitraryRegion(),
      description: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    }),
    fc.record({
      layerName: fc.constant('lambda-kata-nodejs-nodejs18.x-arm64'),
      nodeVersion: fc.constant('18.19.0'),
      architecture: fc.constant('arm64') as fc.Arbitrary<'arm64'>,
      region: arbitraryRegion(),
      description: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    }),
    fc.record({
      layerName: fc.constant('lambda-kata-nodejs-nodejs20.x-x86_64'),
      nodeVersion: fc.constant('20.10.0'),
      architecture: fc.constant('x86_64') as fc.Arbitrary<'x86_64'>,
      region: arbitraryRegion(),
      description: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    }),
    fc.record({
      layerName: fc.constant('lambda-kata-nodejs-nodejs20.x-arm64'),
      nodeVersion: fc.constant('20.10.0'),
      architecture: fc.constant('arm64') as fc.Arbitrary<'arm64'>,
      region: arbitraryRegion(),
      description: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    }),
    fc.record({
      layerName: fc.constant('lambda-kata-nodejs-nodejs22.x-x86_64'),
      nodeVersion: fc.constant('22.1.0'),
      architecture: fc.constant('x86_64') as fc.Arbitrary<'x86_64'>,
      region: arbitraryRegion(),
      description: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    }),
    fc.record({
      layerName: fc.constant('lambda-kata-nodejs-nodejs22.x-arm64'),
      nodeVersion: fc.constant('22.1.0'),
      architecture: fc.constant('arm64') as fc.Arbitrary<'arm64'>,
      region: arbitraryRegion(),
      description: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    }),
  );

/**
 * Arbitrary generator for layer search options.
 */
const arbitraryLayerSearchOptions = (): fc.Arbitrary<LayerSearchOptions> =>
  fc.oneof(
    fc.record({
      layerName: fc.constant('lambda-kata-nodejs-nodejs18.x-x86_64'),
      requirements: fc.record({
        nodeVersion: fc.constant('18.19.0'),
        architecture: fc.constant('x86_64'),
        maxAge: fc.option(fc.integer({ min: 1000, max: 30 * 24 * 60 * 60 * 1000 }), { nil: undefined }),
      }),
    }),
    fc.record({
      layerName: fc.constant('lambda-kata-nodejs-nodejs18.x-arm64'),
      requirements: fc.record({
        nodeVersion: fc.constant('18.19.0'),
        architecture: fc.constant('arm64'),
        maxAge: fc.option(fc.integer({ min: 1000, max: 30 * 24 * 60 * 60 * 1000 }), { nil: undefined }),
      }),
    }),
    fc.record({
      layerName: fc.constant('lambda-kata-nodejs-nodejs20.x-x86_64'),
      requirements: fc.record({
        nodeVersion: fc.constant('20.10.0'),
        architecture: fc.constant('x86_64'),
        maxAge: fc.option(fc.integer({ min: 1000, max: 30 * 24 * 60 * 60 * 1000 }), { nil: undefined }),
      }),
    }),
    fc.record({
      layerName: fc.constant('lambda-kata-nodejs-nodejs20.x-arm64'),
      requirements: fc.record({
        nodeVersion: fc.constant('20.10.0'),
        architecture: fc.constant('arm64'),
        maxAge: fc.option(fc.integer({ min: 1000, max: 30 * 24 * 60 * 60 * 1000 }), { nil: undefined }),
      }),
    }),
    fc.record({
      layerName: fc.constant('lambda-kata-nodejs-nodejs22.x-x86_64'),
      requirements: fc.record({
        nodeVersion: fc.constant('22.1.0'),
        architecture: fc.constant('x86_64'),
        maxAge: fc.option(fc.integer({ min: 1000, max: 30 * 24 * 60 * 60 * 1000 }), { nil: undefined }),
      }),
    }),
    fc.record({
      layerName: fc.constant('lambda-kata-nodejs-nodejs22.x-arm64'),
      requirements: fc.record({
        nodeVersion: fc.constant('22.1.0'),
        architecture: fc.constant('arm64'),
        maxAge: fc.option(fc.integer({ min: 1000, max: 30 * 24 * 60 * 60 * 1000 }), { nil: undefined }),
      }),
    }),
  );

/**
 * Mock setup helper for successful AWS operations.
 */
function setupSuccessfulAwsMocks(): void {
  const { LambdaClient, paginateListLayers } = require('@aws-sdk/client-lambda');

  // Reset all mocks
  jest.clearAllMocks();

  // Mock successful layer operations
  const mockSend = jest.fn()
    .mockResolvedValue({ Layers: [] }) // ListLayers - no existing layers
    .mockResolvedValue({
      LayerVersionArn: 'arn:aws:lambda:us-east-1:123456789012:layer:test-layer:1',
      Version: 1,
      CreatedDate: '2023-01-01T00:00:00.000Z',
    });

  // Mock paginator for layer listing
  const mockPaginator = {
    [Symbol.asyncIterator]: async function* () {
      yield { Layers: [] };
    },
  };

  paginateListLayers.mockReturnValue(mockPaginator);

  LambdaClient.mockImplementation((config: LambdaClientConfig = {}) => ({
    send: mockSend,
    destroy: jest.fn(),
  }));

  // Store configuration for verification
  (LambdaClient as any).getLastConfig = () => {
    const calls = LambdaClient.mock.calls;
    return calls[calls.length - 1]?.[0] || {};
  };
}

/**
 * Mock setup helper for Docker operations.
 */
function setupDockerMocks(): void {
  const { spawn } = require('child_process');

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

  (spawn as jest.MockedFunction<typeof spawn>).mockReturnValue(mockProcess as any);

  // Mock file system operations
  const { promises: fs } = require('fs');
  fs.mkdtemp.mockResolvedValue('/tmp/test-layer-123');
  fs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
  fs.chmod.mockResolvedValue(undefined);
  fs.mkdir.mockResolvedValue(undefined);
  fs.copyFile.mockResolvedValue(undefined);
  fs.readFile.mockResolvedValue(Buffer.from('test content'));
  fs.rm.mockResolvedValue(undefined);
  fs.unlink.mockResolvedValue(undefined);
  fs.readdir.mockResolvedValue([]);
}

// Feature: nodejs-layer-management, Property 19: SDK Configuration Flexibility
describe('Feature: nodejs-layer-management, Property 19: SDK Configuration Flexibility', () => {
  let mockLogger: jest.Mocked<ConsoleLogger>;
  let LambdaClient: any;

  beforeEach(() => {
    // Create mock logger that captures all calls
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    setupSuccessfulAwsMocks();
    setupDockerMocks();

    // Get reference to mocked LambdaClient
    LambdaClient = require('@aws-sdk/client-lambda').LambdaClient;
  });

  /**
   * **Validates: Requirement 10.2**
   *
   * For any custom AWS SDK configuration provided, the Layer_Manager should
   * use the specified configuration for all AWS API operations.
   */
  describe('Property 19: SDK Configuration Flexibility', () => {
    /**
     * **Validates: Requirement 10.2**
     *
     * For any custom AWS SDK configuration with region settings,
     * the Layer_Manager should use the specified region for all operations.
     */
    it('should use custom region configuration for all AWS operations', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerCreationOptions(),
          arbitraryRegion(),
          async (layerOptions, customRegion) => {
            const awsSdkConfig: LambdaClientConfig = {
              region: customRegion,
            };

            const layerManager = new AWSLayerManager({
              awsSdkConfig,
              logger: mockLogger,
            });

            try {
              // Execute layer creation
              await layerManager.createNodeLayer(layerOptions);

              // Verify AWS SDK was configured with custom region
              expect(LambdaClient).toHaveBeenCalledWith(
                expect.objectContaining({
                  region: customRegion,
                }),
              );

              return true;
            } finally {
              layerManager.destroy();
            }
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 10.2**
     *
     * For any custom AWS SDK configuration with credentials,
     * the Layer_Manager should use the specified credentials for authentication.
     */
    it('should use custom credentials configuration for AWS authentication', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerSearchOptions(),
          arbitraryCredentials(),
          async (searchOptions, customCredentials) => {
            const awsSdkConfig: LambdaClientConfig = {
              credentials: customCredentials,
            };

            const layerManager = new AWSLayerManager({
              awsSdkConfig,
              logger: mockLogger,
            });

            try {
              // Execute layer search
              await layerManager.findExistingLayer(searchOptions);

              // Verify AWS SDK was configured with custom credentials
              expect(LambdaClient).toHaveBeenCalledWith({
                credentials: customCredentials,
              });

              return true;
            } finally {
              layerManager.destroy();
            }
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 10.2**
     *
     * For any custom AWS SDK configuration with endpoint settings,
     * the Layer_Manager should use the specified endpoint for API calls.
     */
    it('should use custom endpoint configuration for AWS API calls', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerSearchOptions(),
          arbitraryEndpoint(),
          async (searchOptions, customEndpoint) => {
            const awsSdkConfig: LambdaClientConfig = {
              endpoint: customEndpoint,
            };

            const layerManager = new AWSLayerManager({
              awsSdkConfig,
              logger: mockLogger,
            });

            try {
              // Execute layer search
              await layerManager.findExistingLayer(searchOptions);

              // Verify AWS SDK was configured with custom endpoint
              // The client should be called at least once with the endpoint
              expect(LambdaClient).toHaveBeenCalledWith({
                endpoint: customEndpoint,
              });

              return true;
            } finally {
              layerManager.destroy();
            }
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 10.2**
     *
     * For any comprehensive AWS SDK configuration with multiple settings,
     * the Layer_Manager should respect all provided configuration options.
     */
    it('should use comprehensive AWS SDK configuration with all settings', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerCreationOptions(),
          arbitraryAwsSdkConfig(),
          async (layerOptions, awsSdkConfig) => {
            const layerManager = new AWSLayerManager({
              awsSdkConfig,
              logger: mockLogger,
            });

            try {
              // Execute layer creation
              await layerManager.createNodeLayer(layerOptions);

              // Verify AWS SDK was configured with all provided settings
              const expectedConfig: any = {};

              if (awsSdkConfig.region !== undefined) {
                expectedConfig.region = awsSdkConfig.region;
              }
              if (awsSdkConfig.credentials !== undefined) {
                expectedConfig.credentials = awsSdkConfig.credentials;
              }
              if (awsSdkConfig.endpoint !== undefined) {
                expectedConfig.endpoint = awsSdkConfig.endpoint;
              }
              if (awsSdkConfig.maxAttempts !== undefined) {
                expectedConfig.maxAttempts = awsSdkConfig.maxAttempts;
              }
              if (awsSdkConfig.logger !== undefined) {
                expectedConfig.logger = awsSdkConfig.logger;
              }

              expect(LambdaClient).toHaveBeenCalledWith(
                expect.objectContaining(expectedConfig),
              );

              return true;
            } finally {
              layerManager.destroy();
            }
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 10.2**
     *
     * For any Layer_Manager instance without custom AWS SDK configuration,
     * the system should use default AWS SDK configuration.
     */
    it('should use default AWS SDK configuration when no custom config provided', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerSearchOptions(),
          async (searchOptions) => {
            // Create layer manager without custom AWS SDK config
            const layerManager = new AWSLayerManager({
              logger: mockLogger,
            });

            try {
              // Execute layer search
              await layerManager.findExistingLayer(searchOptions);

              // Verify AWS SDK was configured with defaults (empty config)
              expect(LambdaClient).toHaveBeenCalledWith({});

              return true;
            } finally {
              layerManager.destroy();
            }
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 10.2**
     *
     * For any AWS SDK configuration changes during runtime,
     * the Layer_Manager should maintain configuration consistency across operations.
     */
    it('should maintain configuration consistency across multiple operations', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerSearchOptions(),
          arbitraryLayerCreationOptions(),
          arbitraryAwsSdkConfig(),
          async (searchOptions, creationOptions, awsSdkConfig) => {
            const layerManager = new AWSLayerManager({
              awsSdkConfig,
              logger: mockLogger,
            });

            try {
              // Execute multiple operations
              await layerManager.findExistingLayer(searchOptions);
              await layerManager.createNodeLayer(creationOptions);

              // Verify AWS SDK configuration was consistent across operations
              const expectedConfig: any = {};

              if (awsSdkConfig.region !== undefined) {
                expectedConfig.region = awsSdkConfig.region;
              }
              if (awsSdkConfig.credentials !== undefined) {
                expectedConfig.credentials = awsSdkConfig.credentials;
              }
              if (awsSdkConfig.endpoint !== undefined) {
                expectedConfig.endpoint = awsSdkConfig.endpoint;
              }

              // Should have been called once during construction
              expect(LambdaClient).toHaveBeenCalledWith(
                expect.objectContaining(expectedConfig),
              );

              return true;
            } finally {
              layerManager.destroy();
            }
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 10.2**
     *
     * For any AWS SDK configuration with retry settings,
     * the Layer_Manager should respect the custom retry configuration.
     */
    it('should respect custom retry configuration in AWS SDK settings', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerCreationOptions(),
          fc.integer({ min: 1, max: 10 }), // maxAttempts
          async (layerOptions, maxAttempts) => {
            const awsSdkConfig: LambdaClientConfig = {
              maxAttempts,
            };

            const layerManager = new AWSLayerManager({
              awsSdkConfig,
              logger: mockLogger,
            });

            try {
              // Execute layer creation
              await layerManager.createNodeLayer(layerOptions);

              // Verify AWS SDK was configured with custom retry settings
              expect(LambdaClient).toHaveBeenCalledWith(
                expect.objectContaining({
                  maxAttempts,
                }),
              );

              return true;
            } finally {
              layerManager.destroy();
            }
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * **Validates: Requirement 10.2**
     *
     * For any AWS SDK configuration, the Layer_Manager should
     * successfully initialize and use the provided configuration.
     */
    it('should successfully initialize with any valid AWS SDK configuration', () => {
      return fc.assert(
        fc.asyncProperty(
          arbitraryLayerSearchOptions(),
          arbitraryAwsSdkConfig(),
          async (searchOptions, awsSdkConfig) => {
            const layerManager = new AWSLayerManager({
              awsSdkConfig,
              logger: mockLogger,
            });

            try {
              // Execute layer search
              await layerManager.findExistingLayer(searchOptions);

              // Verify AWS SDK configuration was used
              const expectedConfig: any = {};

              if (awsSdkConfig.region !== undefined) {
                expectedConfig.region = awsSdkConfig.region;
              }
              if (awsSdkConfig.credentials !== undefined) {
                expectedConfig.credentials = awsSdkConfig.credentials;
              }
              if (awsSdkConfig.endpoint !== undefined) {
                expectedConfig.endpoint = awsSdkConfig.endpoint;
              }
              if (awsSdkConfig.maxAttempts !== undefined) {
                expectedConfig.maxAttempts = awsSdkConfig.maxAttempts;
              }
              if (awsSdkConfig.logger !== undefined) {
                expectedConfig.logger = awsSdkConfig.logger;
              }

              expect(LambdaClient).toHaveBeenCalledWith(
                expect.objectContaining(expectedConfig),
              );

              return true;
            } finally {
              layerManager.destroy();
            }
          },
        ),
        { numRuns: 7 },
      );
    });
  });
});

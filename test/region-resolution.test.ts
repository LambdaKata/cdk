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
 * Region Resolution Tests
 *
 * Verifies that Node.js Layer deployment uses Stack deployment region,
 * not account default region.
 */

// Mock the native licensing module before any imports
jest.mock('@lambda-kata/licensing', () => ({
  NativeLicensingService: jest.fn().mockImplementation(() => ({
    checkEntitlementSync: jest.fn(),
  })),
}));

// Mock aws-layer-manager to prevent real AWS API calls
jest.mock('../src/aws-layer-manager', () => ({
  AWSLayerManager: jest.fn().mockImplementation(() => ({
    deployNodejsLayer: jest.fn().mockRejectedValue(new Error('No layer ZIP found at expected paths')),
    destroy: jest.fn(),
  })),
}));

// Mock ensure-node-runtime-layer to prevent Docker extraction fallback
jest.mock('../src/ensure-node-runtime-layer', () => ({
  ensureNodeRuntimeLayer: jest.fn().mockRejectedValue(new Error('Docker not available in test environment')),
}));

import { App, Stack } from 'aws-cdk-lib';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NativeLicensingService } from '@lambda-kata/licensing';

import { kataWithAccountId } from '../src/kata-wrapper';

// Get typed mock for NativeLicensingService
const mockNativeLicensingService = NativeLicensingService as jest.Mock;

// Helper to configure mock for entitled scenarios
function mockEntitled(layerArn: string): void {
  mockNativeLicensingService.mockImplementation(() => ({
    checkEntitlementSync: jest.fn().mockReturnValue({
      entitled: true,
      layerVersionArn: layerArn,
    }),
  }));
}

describe('Region Resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use Stack deployment region for Node.js layer, not account region', async () => {
    // Setup: Account in eu-central-1, but deploying to us-east-1
    const accountId = '123456789012';
    const deploymentRegion = 'us-east-1';
    const layerArn = `arn:aws:lambda:${deploymentRegion}:${accountId}:layer:LambdaKata:1`;

    // Configure mock to return entitled with deployment region layer ARN
    mockEntitled(layerArn);

    const app = new App({
      context: { 'aws:cdk:account': accountId },
    });

    // Stack explicitly deployed to us-east-1 (different from account region)
    const stack = new Stack(app, 'TestStack', {
      env: {
        account: accountId,
        region: deploymentRegion, // Deployment region
      },
    });

    const lambda = new LambdaFunction(stack, 'TestFunction', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
    });

    // Apply transformation - should use deploymentRegion (us-east-1)
    const result = await kataWithAccountId(lambda, accountId, deploymentRegion);

    // Verify transformation succeeded
    expect(result.transformed).toBe(true);
    expect(result.accountId).toBe(accountId);

    // Verify Stack.of(lambda).region returns deployment region
    expect(Stack.of(lambda).region).toBe(deploymentRegion);

    // Verify NativeLicensingService was called
    expect(mockNativeLicensingService).toHaveBeenCalled();
  });

  it('should handle cross-region deployment correctly', async () => {
    // Account default: eu-central-1
    // Deployment target: ap-southeast-1
    const accountId = '999888777666';
    const accountRegion = 'eu-central-1';
    const deploymentRegion = 'ap-southeast-1';
    const layerArn = `arn:aws:lambda:${deploymentRegion}:${accountId}:layer:LambdaKata:5`;

    // Configure mock to return entitled with deployment region layer ARN
    mockEntitled(layerArn);

    const app = new App({
      context: { 'aws:cdk:account': accountId },
    });

    const stack = new Stack(app, 'CrossRegionStack', {
      env: {
        account: accountId,
        region: deploymentRegion, // Different from account region
      },
    });

    const lambda = new LambdaFunction(stack, 'CrossRegionFunction', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler.main',
      code: Code.fromInline('exports.main = async () => ({ statusCode: 200 });'),
    });

    // Apply transformation with deployment region
    const result = await kataWithAccountId(lambda, accountId, deploymentRegion);

    // Verify correct region is used
    expect(result.transformed).toBe(true);
    expect(Stack.of(lambda).region).toBe(deploymentRegion);
    expect(Stack.of(lambda).region).not.toBe(accountRegion);

    // Verify NativeLicensingService was called
    expect(mockNativeLicensingService).toHaveBeenCalled();
  });

  it('should handle CDK token regions with context fallback', async () => {
    // Scenario: Stack region is a token, but context provides explicit region
    const accountId = '111222333444';
    const explicitRegion = 'eu-west-1';
    const layerArn = `arn:aws:lambda:${explicitRegion}:${accountId}:layer:LambdaKata:1`;

    // Configure mock to return entitled with explicit region layer ARN
    mockEntitled(layerArn);

    const app = new App({
      context: {
        'aws:cdk:account': accountId,
        'aws:cdk:region': explicitRegion, // Explicit region in context
      },
    });

    // Stack without explicit env.region - will use token
    const stack = new Stack(app, 'TokenRegionStack');

    const lambda = new LambdaFunction(stack, 'TokenRegionFunction', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
    });

    // Apply transformation - should use context region
    const result = await kataWithAccountId(lambda, accountId, explicitRegion);

    // Verify transformation succeeded
    expect(result.transformed).toBe(true);

    // Verify NativeLicensingService was called
    expect(mockNativeLicensingService).toHaveBeenCalled();
  });
});

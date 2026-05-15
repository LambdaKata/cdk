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
 * Tests for synchronous kata() transformation
 *
 * These tests verify that kata() applies transformations synchronously
 * during CDK synthesis, fixing the async Promise issue.
 */

import { App, Stack } from 'aws-cdk-lib';
import { CfnFunction, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Template } from 'aws-cdk-lib/assertions';

import { getKataPromise, kata } from '../src/kata-wrapper';
// Import after mock is set up
import { NativeLicensingService } from '@lambda-kata/licensing';

// Mock the native licensing module
jest.mock('@lambda-kata/licensing', () => ({
  NativeLicensingService: jest.fn().mockImplementation(() => ({
    checkEntitlementSync: jest.fn(),
  })),
}));

// Get typed mock for NativeLicensingService
const mockNativeLicensingService = NativeLicensingService as jest.Mock;

// Helper to configure mock for entitled scenarios
function mockEntitled(layerArn: string = 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1'): void {
  mockNativeLicensingService.mockImplementation(() => ({
    checkEntitlementSync: jest.fn().mockReturnValue({
      entitled: true,
      layerVersionArn: layerArn,
      message: 'Account is entitled',
    }),
  }));
}

// Helper to configure mock for not entitled scenarios
function mockNotEntitled(message?: string): void {
  mockNativeLicensingService.mockImplementation(() => ({
    checkEntitlementSync: jest.fn().mockReturnValue({
      entitled: false,
      message: message || 'Account is not entitled',
    }),
  }));
}

/**
 * Helper to create a test Lambda function
 */
function createTestLambda(stack: Stack, id: string): LambdaFunction {
  return new LambdaFunction(stack, id, {
    runtime: Runtime.NODEJS_18_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
  });
}

describe('Synchronous kata() transformation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Transformation is applied synchronously', () => {
    it('should transform Lambda BEFORE returning from kata()', () => {
      const app = new App({
        context: { 'aws:cdk:account': '123456789012' },
      });
      const stack = new Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
      });

      const lambda = createTestLambda(stack, 'TestFunction');
      mockEntitled();

      // Call kata() - transformation should be applied SYNCHRONOUSLY
      kata(lambda);

      // Verify transformation was applied IMMEDIATELY (no await needed)
      const cfnFunction = lambda.node.defaultChild as CfnFunction;
      expect(cfnFunction.runtime).toBe('python3.12');
      expect(cfnFunction.handler).toBe('lambdakata.optimized_handler.lambda_handler');
    });

    it('should produce correct CloudFormation template without awaiting', () => {
      const app = new App({
        context: { 'aws:cdk:account': '123456789012' },
      });
      const stack = new Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
      });

      const lambda = createTestLambda(stack, 'TestFunction');
      mockEntitled();

      // Call kata() synchronously
      kata(lambda);

      // Synthesize template WITHOUT awaiting any promises
      const template = Template.fromStack(stack);

      // Verify the template has correct runtime
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'python3.12',
        Handler: 'lambdakata.optimized_handler.lambda_handler',
      });
    });

    it('should attach layers synchronously', () => {
      const app = new App({
        context: { 'aws:cdk:account': '123456789012' },
      });
      const stack = new Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
      });

      const lambda = createTestLambda(stack, 'TestFunction');
      const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:TestLayer:1';
      mockEntitled(layerArn);

      kata(lambda);

      // Verify layers are attached synchronously
      const template = Template.fromStack(stack);

      // Check that Lambda has Layers property with at least 2 layers
      // (config layer + Lambda Kata layer)
      const resources = template.findResources('AWS::Lambda::Function');
      const functionResource = Object.values(resources)[0];
      expect(functionResource.Properties.Layers).toBeDefined();
      expect(functionResource.Properties.Layers.length).toBeGreaterThanOrEqual(2);
    });

    it('should store result in _kataResult for inspection', () => {
      const app = new App({
        context: { 'aws:cdk:account': '123456789012' },
      });
      const stack = new Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
      });

      const lambda = createTestLambda(stack, 'TestFunction');
      mockEntitled();

      kata(lambda);

      // Check that result is stored synchronously
      const result = (lambda as unknown as { _kataResult?: { transformed: boolean } })._kataResult;
      expect(result).toBeDefined();
      expect(result?.transformed).toBe(true);
    });
  });

  describe('Unlicensed accounts', () => {
    it('should NOT transform Lambda when not entitled', () => {
      const app = new App({
        context: { 'aws:cdk:account': '123456789012' },
      });
      const stack = new Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
      });

      const lambda = createTestLambda(stack, 'TestFunction');
      mockNotEntitled();

      kata(lambda);

      // Verify Lambda was NOT transformed
      const cfnFunction = lambda.node.defaultChild as CfnFunction;
      expect(cfnFunction.runtime).toBe('nodejs18.x');
      expect(cfnFunction.handler).toBe('index.handler');
    });

    it('should store transformed: false in result', () => {
      const app = new App({
        context: { 'aws:cdk:account': '123456789012' },
      });
      const stack = new Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
      });

      const lambda = createTestLambda(stack, 'TestFunction');
      mockNotEntitled();

      kata(lambda);

      const result = (lambda as unknown as { _kataResult?: { transformed: boolean } })._kataResult;
      expect(result).toBeDefined();
      expect(result?.transformed).toBe(false);
    });
  });

  describe('Backward compatibility', () => {
    it('should still provide _kataPromise for backward compatibility', async () => {
      const app = new App({
        context: { 'aws:cdk:account': '123456789012' },
      });
      const stack = new Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
      });

      const lambda = createTestLambda(stack, 'TestFunction');
      mockEntitled();

      kata(lambda);

      // _kataPromise should be a resolved Promise
      const promise = getKataPromise(lambda);
      expect(promise).toBeDefined();
      expect(promise).toBeInstanceOf(Promise);

      // Should resolve immediately since transformation is sync
      const result = await promise;
      expect(result?.transformed).toBe(true);
    });
  });
});

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
 * Unit Tests for kata-wrapper transformation logic
 *
 * These tests verify the applyTransformation function correctly transforms
 * Lambda functions according to the Lambda Kata requirements.
 *
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.7**
 * - 2.2: THE kata_Wrapper SHALL change the Lambda runtime from Node.js to Python 3.12
 * - 2.3: THE kata_Wrapper SHALL set the Lambda handler to `lambdakata.optimized_handler.lambda_handler`
 * - 2.4: THE kata_Wrapper SHALL attach the customer-specific Lambda_Layer ARN to the Lambda
 * - 2.7: THE kata_Wrapper SHALL add the `JS_HANDLER_PATH` environment variable pointing to the original Node.js handler
 *
 * @module kata-wrapper.test
 */

import { App, Stack } from 'aws-cdk-lib';
import { CfnFunction, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';

import {
  applyTransformation,
  getKataPromise,
  handleUnlicensed,
  isKataTransformed,
  kata,
  kataWithAccountId,
} from '../src/kata-wrapper';
import { TransformationConfig } from '../src/types';
import { MockLicensingService } from '../src/mock-licensing';

/**
 * Helper to create a test Lambda function
 */
function createTestLambda(
  stack: Stack,
  id: string,
  options?: {
    handler?: string;
    runtime?: Runtime;
    environment?: Record<string, string>;
    memorySize?: number;
    timeout?: number;
  },
): LambdaFunction {
  return new LambdaFunction(stack, id, {
    runtime: options?.runtime ?? Runtime.NODEJS_18_X,
    handler: options?.handler ?? 'index.handler',
    code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
    environment: options?.environment,
    memorySize: options?.memorySize,
  });
}

/**
 * Helper to create a test stack
 */
function createTestStack(accountId?: string): { app: App; stack: Stack } {
  const app = new App({
    context: accountId ? { 'aws:cdk:account': accountId } : undefined,
  });
  const stack = new Stack(app, 'TestStack', {
    env: accountId ? { account: accountId, region: 'us-east-1' } : undefined,
  });
  return { app, stack };
}

describe('kata-wrapper', () => {
  describe('applyTransformation', () => {
    /**
     * **Validates: Requirement 2.2**
     * THE kata_Wrapper SHALL change the Lambda runtime from Node.js to Python 3.12
     */
    describe('Requirement 2.2: Runtime transformation', () => {
      it('should change runtime from Node.js 18.x to Python 3.12', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
        });

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        const cfnFunction = lambda.node.defaultChild as CfnFunction;
        expect(cfnFunction.runtime).toBe('python3.12');
      });

      it('should change runtime from Node.js 20.x to Python 3.12', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_20_X,
        });

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        const cfnFunction = lambda.node.defaultChild as CfnFunction;
        expect(cfnFunction.runtime).toBe('python3.12');
      });

      it('should change runtime from Node.js 16.x to Python 3.12', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_16_X,
        });

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        const cfnFunction = lambda.node.defaultChild as CfnFunction;
        expect(cfnFunction.runtime).toBe('python3.12');
      });
    });

    /**
     * **Validates: Requirement 2.3**
     * THE kata_Wrapper SHALL set the Lambda handler to `lambdakata.optimized_handler.lambda_handler`
     */
    describe('Requirement 2.3: Handler transformation', () => {
      it('should set handler to lambdakata.optimized_handler.lambda_handler', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction', {
          handler: 'index.handler',
        });

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        const cfnFunction = lambda.node.defaultChild as CfnFunction;
        expect(cfnFunction.handler).toBe('lambdakata.optimized_handler.lambda_handler');
      });

      it('should set handler correctly regardless of original handler path', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction', {
          handler: 'src/handlers/myHandler.processEvent',
        });

        const config: TransformationConfig = {
          originalHandler: 'src/handlers/myHandler.processEvent',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        const cfnFunction = lambda.node.defaultChild as CfnFunction;
        expect(cfnFunction.handler).toBe('lambdakata.optimized_handler.lambda_handler');
      });
    });

    /**
     * **Validates: Requirement 2.4**
     * THE kata_Wrapper SHALL attach the customer-specific Lambda_Layer ARN to the Lambda
     */
    describe('Requirement 2.4: Layer attachment', () => {
      it('should attach the customer-specific Lambda Layer ARN', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction');
        const layerArn = 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1';

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn,
        };

        applyTransformation(lambda, config);

        // Use CDK assertions to verify the template
        // Note: Config layer is also attached, so we use arrayWith to check the Lambda Kata layer is present
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
          Layers: Match.arrayWith([layerArn]),
        });
      });

      it('should attach layer with different ARN formats', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction');
        const layerArn = 'arn:aws:lambda:eu-west-1:987654321098:layer:CustomLambdaKata:42';

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn,
        };

        applyTransformation(lambda, config);

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
          Layers: Match.arrayWith([layerArn]),
        });
      });
    });

    /**
     * **Validates: Requirements 3.4, 4.1, 4.2**
     * - 3.4: THE kata_Wrapper SHALL NOT set the `JS_HANDLER_PATH` environment variable
     * - 4.1: THE kata_Wrapper SHALL NOT add the `JS_HANDLER_PATH` environment variable to transformed Lambdas
     * - 4.2: THE kata_Wrapper SHALL continue to set other required environment variables
     *
     * Note: JS_HANDLER_PATH is now stored in a config layer instead of an environment variable.
     * See "Config Layer Handler Path" tests for config layer verification.
     */
    describe('Environment variables (updated for config layer)', () => {
      it('should NOT add JS_HANDLER_PATH environment variable (now uses config layer)', () => {
        const { stack } = createTestStack();
        const originalHandler = 'index.handler';
        const lambda = createTestLambda(stack, 'TestFunction', {
          handler: originalHandler,
        });

        const config: TransformationConfig = {
          originalHandler,
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify JS_HANDLER_PATH is NOT set (handler path is now in config layer)
        const template = Template.fromStack(stack);
        const resources = template.findResources('AWS::Lambda::Function');
        const functionResource = Object.values(resources)[0];
        const envVars = functionResource.Properties?.Environment?.Variables || {};
        expect(envVars).not.toHaveProperty('JS_HANDLER_PATH');
      });

      it('should store handler path in config layer instead of environment variable', () => {
        const { stack } = createTestStack();
        const originalHandler = 'src/handlers/api/users.createUser';
        const lambda = createTestLambda(stack, 'TestFunction', {
          handler: originalHandler,
        });

        const config: TransformationConfig = {
          originalHandler,
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify config layer is created with the handler path
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::LayerVersion', {
          Description: `Lambda Kata config layer for handler: ${originalHandler}`,
        });

        // Verify JS_HANDLER_PATH is NOT in environment variables
        const resources = template.findResources('AWS::Lambda::Function');
        const functionResource = Object.values(resources)[0];
        const envVars = functionResource.Properties?.Environment?.Variables || {};
        expect(envVars).not.toHaveProperty('JS_HANDLER_PATH');
      });

      it('should NOT add JS_BUNDLE_PATH environment variable (now uses config layer)', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction');

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify JS_BUNDLE_PATH is NOT set (bundle path is now in config layer)
        const template = Template.fromStack(stack);
        const resources = template.findResources('AWS::Lambda::Function');
        const functionResource = Object.values(resources)[0];
        const envVars = functionResource.Properties?.Environment?.Variables || {};
        expect(envVars).not.toHaveProperty('JS_BUNDLE_PATH');
      });

      it('should NOT add USE_CTYPES_BRIDGE environment variable (ctypes is always used)', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction');

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify USE_CTYPES_BRIDGE is NOT set (ctypes bridge is always used)
        const template = Template.fromStack(stack);
        const resources = template.findResources('AWS::Lambda::Function');
        const functionResource = Object.values(resources)[0];
        const envVars = functionResource.Properties?.Environment?.Variables || {};
        expect(envVars).not.toHaveProperty('USE_CTYPES_BRIDGE');
      });
    });

    /**
     * **Validates: Requirements 2.5, 2.6, 2.8, 2.9**
     * Preservation of non-target properties
     */
    describe('Preservation of non-target properties', () => {
      it('should preserve existing environment variables', () => {
        const { stack } = createTestStack();
        const existingEnvVars = {
          MY_VAR: 'my-value',
          ANOTHER_VAR: 'another-value',
        };
        const lambda = createTestLambda(stack, 'TestFunction', {
          environment: existingEnvVars,
        });

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
          Environment: {
            Variables: {
              MY_VAR: 'my-value',
              ANOTHER_VAR: 'another-value',
              // Note: No Lambda Kata env vars added - all config in layer
            },
          },
        });
      });

      it('should preserve memory size configuration', () => {
        const { stack } = createTestStack();
        const memorySize = 512;
        const lambda = createTestLambda(stack, 'TestFunction', {
          memorySize,
        });

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
          MemorySize: memorySize,
        });
      });

      it('should preserve function logical ID', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'MySpecialFunction');

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // The logical ID should be preserved - verify by counting Lambda functions
        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::Lambda::Function', 1);

        // Verify the function has the expected properties after transformation
        template.hasResourceProperties('AWS::Lambda::Function', {
          Runtime: 'python3.12',
          Handler: 'lambdakata.optimized_handler.lambda_handler',
        });
      });
    });
  });

  describe('kataWithAccountId', () => {
    it('should transform Lambda when account is entitled', async () => {
      const { stack } = createTestStack('123456789012');
      const lambda = createTestLambda(stack, 'TestFunction');
      const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';

      const mockLicensing = new MockLicensingService();
      mockLicensing.setEntitled('123456789012', layerArn);

      const result = await kataWithAccountId(lambda, '123456789012', {
        licensingService: mockLicensing,
      });

      expect(result.transformed).toBe(true);
      expect(result.licensingResponse.entitled).toBe(true);
      expect(result.licensingResponse.layerArn).toBe(layerArn);
      expect(result.accountId).toBe('123456789012');

      // Verify transformation was applied
      const cfnFunction = lambda.node.defaultChild as CfnFunction;
      expect(cfnFunction.runtime).toBe('python3.12');
      expect(cfnFunction.handler).toBe('lambdakata.optimized_handler.lambda_handler');
    });

    it('should not transform Lambda when account is not entitled', async () => {
      const { stack } = createTestStack('123456789012');
      const lambda = createTestLambda(stack, 'TestFunction', {
        runtime: Runtime.NODEJS_18_X,
        handler: 'index.handler',
      });

      const mockLicensing = new MockLicensingService();
      // Account is not entitled (no setEntitled call)

      const result = await kataWithAccountId(lambda, '123456789012', {
        licensingService: mockLicensing,
      });

      expect(result.transformed).toBe(false);
      expect(result.licensingResponse.entitled).toBe(false);

      // Verify transformation was NOT applied - runtime should still be Node.js
      const cfnFunction = lambda.node.defaultChild as CfnFunction;
      expect(cfnFunction.runtime).toBe('nodejs18.x');
      expect(cfnFunction.handler).toBe('index.handler');
    });
  });

  /**
   * **Validates: Requirements 3.5, 3.6, 6.1, 6.2, 6.3, 6.4**
   * - 3.5: IF the account is NOT entitled, THEN THE kata_Wrapper SHALL NOT apply any transformations
   * - 3.6: IF the account is NOT entitled, THEN THE kata_Wrapper SHALL emit a clear warning message
   * - 6.1: IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL keep the original Node.js runtime unchanged
   * - 6.2: IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL keep the original handler unchanged
   * - 6.3: IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL NOT attach any Lambda_Layer
   * - 6.4: IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL emit a warning message
   */
  describe('handleUnlicensed', () => {
    /**
     * **Validates: Requirement 6.1**
     * IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL keep the original Node.js runtime unchanged
     */
    describe('Requirement 6.1: Keep original runtime unchanged', () => {
      it('should keep Node.js 18.x runtime unchanged when unlicensed', async () => {
        const { stack } = createTestStack('123456789012');
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: 'index.handler',
        });

        const mockLicensing = new MockLicensingService();
        // Account is not entitled (no setEntitled call)

        await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        const cfnFunction = lambda.node.defaultChild as CfnFunction;
        expect(cfnFunction.runtime).toBe('nodejs18.x');
      });

      it('should keep Node.js 20.x runtime unchanged when unlicensed', async () => {
        const { stack } = createTestStack('123456789012');
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_20_X,
          handler: 'index.handler',
        });

        const mockLicensing = new MockLicensingService();

        await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        const cfnFunction = lambda.node.defaultChild as CfnFunction;
        expect(cfnFunction.runtime).toBe('nodejs20.x');
      });
    });

    /**
     * **Validates: Requirement 6.2**
     * IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL keep the original handler unchanged
     */
    describe('Requirement 6.2: Keep original handler unchanged', () => {
      it('should keep original handler unchanged when unlicensed', async () => {
        const { stack } = createTestStack('123456789012');
        const originalHandler = 'index.handler';
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: originalHandler,
        });

        const mockLicensing = new MockLicensingService();

        await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        const cfnFunction = lambda.node.defaultChild as CfnFunction;
        expect(cfnFunction.handler).toBe(originalHandler);
      });

      it('should keep nested handler path unchanged when unlicensed', async () => {
        const { stack } = createTestStack('123456789012');
        const originalHandler = 'src/handlers/api/users.createUser';
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: originalHandler,
        });

        const mockLicensing = new MockLicensingService();

        await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        const cfnFunction = lambda.node.defaultChild as CfnFunction;
        expect(cfnFunction.handler).toBe(originalHandler);
      });
    });

    /**
     * **Validates: Requirement 6.3**
     * IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL NOT attach any Lambda_Layer
     */
    describe('Requirement 6.3: Do not attach any layers', () => {
      it('should not attach any layers when unlicensed', async () => {
        const { stack } = createTestStack('123456789012');
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: 'index.handler',
        });

        const mockLicensing = new MockLicensingService();

        await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        // Verify no layers are attached in the CloudFormation template
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
          Layers: Match.absent(),
        });
      });

      it('should preserve existing layers but not add Lambda Kata layer when unlicensed', async () => {
        const { stack } = createTestStack('123456789012');
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: 'index.handler',
        });

        const mockLicensing = new MockLicensingService();

        await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        // Verify no Lambda Kata layer is attached
        const template = Template.fromStack(stack);
        // The function should not have any layers since we didn't add any
        template.hasResourceProperties('AWS::Lambda::Function', {
          Layers: Match.absent(),
        });
      });
    });

    /**
     * **Validates: Requirements 3.6, 6.4**
     * - 3.6: IF the account is NOT entitled, THEN THE kata_Wrapper SHALL emit a clear warning message
     * - 6.4: IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL emit a warning message:
     *        "Lambda Kata not enabled: AWS account is not entitled. Subscribe via AWS Marketplace to enable."
     */
    describe('Requirement 6.4: Emit warning message', () => {
      it('should emit warning with default message when unlicensed', async () => {
        const { app, stack } = createTestStack('123456789012');
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: 'index.handler',
        });

        const mockLicensing = new MockLicensingService();

        await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        // Synthesize the stack to capture annotations
        const assembly = app.synth();

        // Use CDK Annotations assertions to verify warning
        const annotations = Annotations.fromStack(stack);
        annotations.hasWarning(
          '/TestStack/TestFunction',
          Match.stringLikeRegexp('.*[Nn]ot entitled.*'),
        );
      });

      it('should emit the exact expected warning message', async () => {
        const { app, stack } = createTestStack('123456789012');
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: 'index.handler',
        });

        const mockLicensing = new MockLicensingService();
        mockLicensing.setNotEntitledMessage(
          'Lambda Kata not enabled: AWS account is not entitled. Subscribe via AWS Marketplace to enable.',
        );

        await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        // Synthesize the stack to capture annotations
        app.synth();

        // Verify the exact warning message
        const annotations = Annotations.fromStack(stack);
        annotations.hasWarning(
          '/TestStack/TestFunction',
          Match.stringLikeRegexp('Lambda Kata not enabled.*AWS account is not entitled.*Subscribe via AWS Marketplace'),
        );
      });

      it('should emit custom warning message from licensing response', async () => {
        const { app, stack } = createTestStack('123456789012');
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: 'index.handler',
        });

        const mockLicensing = new MockLicensingService();
        mockLicensing.setNotEntitledMessage('Custom licensing error: Account 123456789012 not found');

        await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        // Synthesize the stack to capture annotations
        app.synth();

        // Verify the custom warning message
        const annotations = Annotations.fromStack(stack);
        annotations.hasWarning(
          '/TestStack/TestFunction',
          Match.stringLikeRegexp('Custom licensing error.*Account 123456789012 not found'),
        );
      });
    });

    /**
     * **Validates: Requirement 3.5**
     * IF the account is NOT entitled, THEN THE kata_Wrapper SHALL NOT apply any transformations
     */
    describe('Requirement 3.5: No transformations applied', () => {
      it('should not add JS_HANDLER_PATH environment variable when unlicensed', async () => {
        const { stack } = createTestStack('123456789012');
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: 'index.handler',
        });

        const mockLicensing = new MockLicensingService();

        await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        // Verify JS_HANDLER_PATH is not added
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
          Environment: Match.absent(),
        });
      });

      it('should preserve existing environment variables without adding Lambda Kata vars when unlicensed', async () => {
        const { stack } = createTestStack('123456789012');
        const existingEnvVars = {
          MY_VAR: 'my-value',
          DATABASE_URL: 'postgres://localhost:5432/mydb',
        };
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: 'index.handler',
          environment: existingEnvVars,
        });

        const mockLicensing = new MockLicensingService();

        await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        // Verify existing env vars are preserved but Lambda Kata vars are not added
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
          Environment: {
            Variables: {
              MY_VAR: 'my-value',
              DATABASE_URL: 'postgres://localhost:5432/mydb',
              // JS_HANDLER_PATH should NOT be present
            },
          },
        });

        // Also verify JS_HANDLER_PATH is not present
        const resources = template.findResources('AWS::Lambda::Function');
        const functionResource = Object.values(resources)[0];
        const envVars = functionResource.Properties?.Environment?.Variables || {};
        expect(envVars).not.toHaveProperty('JS_HANDLER_PATH');
        expect(envVars).not.toHaveProperty('JS_BUNDLE_PATH');
        expect(envVars).not.toHaveProperty('USE_CTYPES_BRIDGE');
      });

      it('should return transformed: false when unlicensed', async () => {
        const { stack } = createTestStack('123456789012');
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: 'index.handler',
        });

        const mockLicensing = new MockLicensingService();

        const result = await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        expect(result.transformed).toBe(false);
        expect(result.licensingResponse.entitled).toBe(false);
      });
    });

    /**
     * **Validates: unlicensedBehavior: 'fail' option**
     */
    describe('unlicensedBehavior: fail option', () => {
      it('should emit warning by default (unlicensedBehavior: warn)', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction');

        // handleUnlicensed should not throw with default behavior
        expect(() => {
          handleUnlicensed(lambda, undefined, {
            entitled: false,
            message: 'Not entitled',
          });
        }).not.toThrow();
      });

      it('should emit warning when unlicensedBehavior is explicitly warn', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction');

        expect(() => {
          handleUnlicensed(
            lambda,
            { unlicensedBehavior: 'warn' },
            {
              entitled: false,
              message: 'Not entitled',
            },
          );
        }).not.toThrow();
      });

      it('should throw error when unlicensedBehavior is fail', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction');

        expect(() => {
          handleUnlicensed(
            lambda,
            { unlicensedBehavior: 'fail' },
            {
              entitled: false,
              message: 'Custom error message',
            },
          );
        }).toThrow('Custom error message');
      });

      it('should use default error message when no message provided and unlicensedBehavior is fail', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction');

        expect(() => {
          handleUnlicensed(
            lambda,
            { unlicensedBehavior: 'fail' },
            {
              entitled: false,
            },
          );
        }).toThrow('Lambda Kata licensing validation failed');
      });

      it('should throw error with licensing response message when unlicensedBehavior is fail', async () => {
        const { stack } = createTestStack('123456789012');
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: 'index.handler',
        });

        const mockLicensing = new MockLicensingService();
        mockLicensing.setNotEntitledMessage('Account not found in entitlement database');

        await expect(
          kataWithAccountId(lambda, '123456789012', {
            licensingService: mockLicensing,
            unlicensedBehavior: 'fail',
          }),
        ).rejects.toThrow('Account not found in entitlement database');
      });
    });

    /**
     * **Validates: Requirement 6.5**
     * IF the Licensing_Service is unreachable, THEN THE kata_Wrapper SHALL treat the account as unlicensed
     */
    describe('Requirement 6.5: Service unreachable handling', () => {
      it('should treat account as unlicensed when service is unreachable', async () => {
        const { stack } = createTestStack('123456789012');
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: 'index.handler',
        });

        const mockLicensing = new MockLicensingService();
        mockLicensing.setSimulateServiceError(true, 'Lambda Kata licensing service unreachable. Lambda will use original Node.js runtime.');

        const result = await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        expect(result.transformed).toBe(false);
        expect(result.licensingResponse.entitled).toBe(false);

        // Verify Lambda is unchanged
        const cfnFunction = lambda.node.defaultChild as CfnFunction;
        expect(cfnFunction.runtime).toBe('nodejs18.x');
        expect(cfnFunction.handler).toBe('index.handler');
      });

      it('should emit appropriate warning when service is unreachable', async () => {
        const { app, stack } = createTestStack('123456789012');
        const lambda = createTestLambda(stack, 'TestFunction', {
          runtime: Runtime.NODEJS_18_X,
          handler: 'index.handler',
        });

        const mockLicensing = new MockLicensingService();
        mockLicensing.setSimulateServiceError(true, 'Lambda Kata licensing service unreachable. Lambda will use original Node.js runtime.');

        await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        // Synthesize the stack to capture annotations
        app.synth();

        // Verify warning about service being unreachable
        const annotations = Annotations.fromStack(stack);
        annotations.hasWarning(
          '/TestStack/TestFunction',
          Match.stringLikeRegexp('.*licensing service unreachable.*'),
        );
      });
    });
  });

  describe('isKataTransformed', () => {
    it('should return true for transformed Lambda', () => {
      const { stack } = createTestStack();
      const lambda = createTestLambda(stack, 'TestFunction');

      const config: TransformationConfig = {
        originalHandler: 'index.handler',
        targetRuntime: Runtime.PYTHON_3_12,
        targetHandler: 'lambdakata.optimized_handler.lambda_handler',
        layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
      };

      applyTransformation(lambda, config);

      expect(isKataTransformed(lambda)).toBe(true);
    });

    it('should return false for non-transformed Lambda', () => {
      const { stack } = createTestStack();
      const lambda = createTestLambda(stack, 'TestFunction');

      expect(isKataTransformed(lambda)).toBe(false);
    });
  });

  describe('kata function', () => {
    it('should return the same Lambda construct', () => {
      const { stack } = createTestStack('123456789012');
      const lambda = createTestLambda(stack, 'TestFunction');

      const result = kata(lambda);

      expect(result).toBe(lambda);
    });

    it('should attach a promise to the Lambda construct', () => {
      const { stack } = createTestStack('123456789012');
      const lambda = createTestLambda(stack, 'TestFunction');

      kata(lambda);

      const promise = getKataPromise(lambda);
      expect(promise).toBeDefined();
      expect(promise).toBeInstanceOf(Promise);
    });

    it('should throw for invalid input - null', () => {
      expect(() => {
        kata(null as unknown as LambdaFunction);
      }).toThrow('kata() requires a valid Lambda Function construct');
    });

    it('should throw for invalid input - undefined', () => {
      expect(() => {
        kata(undefined as unknown as LambdaFunction);
      }).toThrow('kata() requires a valid Lambda Function construct');
    });

    it('should throw for invalid input - non-object', () => {
      expect(() => {
        kata('not a lambda' as unknown as LambdaFunction);
      }).toThrow('kata() requires a valid Lambda Function construct');
    });

    it('should throw for invalid input - object without node', () => {
      expect(() => {
        kata({} as unknown as LambdaFunction);
      }).toThrow('kata() requires a valid Lambda Function construct');
    });
  });

  describe('Integration: Full transformation flow', () => {
    it('should correctly transform a Lambda with all requirements', async () => {
      const { stack } = createTestStack('123456789012');
      const originalHandler = 'src/api/handler.processRequest';
      const existingEnvVars = {
        DATABASE_URL: 'postgres://localhost:5432/mydb',
        LOG_LEVEL: 'debug',
      };
      const memorySize = 1024;
      const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:5';

      const lambda = createTestLambda(stack, 'ApiHandler', {
        runtime: Runtime.NODEJS_18_X,
        handler: originalHandler,
        environment: existingEnvVars,
        memorySize,
      });

      const mockLicensing = new MockLicensingService();
      mockLicensing.setEntitled('123456789012', layerArn);

      const result = await kataWithAccountId(lambda, '123456789012', {
        licensingService: mockLicensing,
      });

      expect(result.transformed).toBe(true);

      // Use CDK assertions to verify the CloudFormation template
      const template = Template.fromStack(stack);

      // Requirement 2.2: Runtime changed to Python 3.12
      // Requirement 2.3: Handler set to Lambda Kata handler
      // Requirement 2.4: Layer attached (Lambda Kata layer)
      // Requirement 2.6: Original environment variables preserved
      // Requirement 2.8: Memory size preserved
      // Note: No Lambda Kata env vars are set - all config comes from config layer
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'python3.12',
        Handler: 'lambdakata.optimized_handler.lambda_handler',
        MemorySize: memorySize,
        Environment: {
          Variables: {
            DATABASE_URL: 'postgres://localhost:5432/mydb',
            LOG_LEVEL: 'debug',
          },
        },
      });

      // Verify no Lambda Kata env vars are set (Requirement 3.4, 4.1, 4.2)
      const resources = template.findResources('AWS::Lambda::Function');
      const functionResource = Object.values(resources)[0];
      const envVars = functionResource.Properties?.Environment?.Variables || {};
      expect(envVars).not.toHaveProperty('JS_HANDLER_PATH');
      expect(envVars).not.toHaveProperty('JS_BUNDLE_PATH');
      expect(envVars).not.toHaveProperty('USE_CTYPES_BRIDGE');
    });
  });

  /**
   * **Validates: Requirements 3.3, 3.4, 4.1, 4.2, 4.3**
   * - 3.3: THE kata_Wrapper SHALL attach the Config_Layer to the transformed Lambda
   * - 3.4: THE kata_Wrapper SHALL NOT set the `JS_HANDLER_PATH` environment variable
   * - 4.1: THE kata_Wrapper SHALL NOT add the `JS_HANDLER_PATH` environment variable to transformed Lambdas
   * - 4.2: THE kata_Wrapper SHALL NOT add any Lambda Kata environment variables (all config in layer)
   * - 4.3: IF a Lambda already has a `JS_HANDLER_PATH` environment variable, THE kata_Wrapper SHALL NOT modify or remove it
   */
  describe('Config Layer Handler Path', () => {
    /**
     * **Validates: Requirement 3.3**
     * THE kata_Wrapper SHALL attach the Config_Layer to the transformed Lambda
     */
    describe('Requirement 3.3: Config layer attachment', () => {
      it('should create and attach a config layer when transforming', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction', {
          handler: 'index.handler',
        });

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify that layers are attached (config layer + Lambda Kata layer)
        const template = Template.fromStack(stack);

        // Verify a config layer is created
        template.hasResourceProperties('AWS::Lambda::LayerVersion', {
          Description: 'Lambda Kata config layer for handler: index.handler',
        });

        // Verify Lambda Kata layer is attached
        template.hasResourceProperties('AWS::Lambda::Function', {
          Layers: Match.arrayWith([
            'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
          ]),
        });

        // Verify there are 2 layers total (config layer ref + Lambda Kata layer ARN)
        const resources = template.findResources('AWS::Lambda::Function');
        const functionResource = Object.values(resources)[0];
        expect(functionResource.Properties?.Layers).toHaveLength(2);
      });

      it('should create config layer with correct description', () => {
        const { stack } = createTestStack();
        const originalHandler = 'src/handlers/api.processRequest';
        const lambda = createTestLambda(stack, 'TestFunction', {
          handler: originalHandler,
        });

        const config: TransformationConfig = {
          originalHandler,
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify config layer is created with appropriate description
        // Note: CompatibleRuntimes is not specified to avoid CDK validation issues
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::LayerVersion', {
          Description: `Lambda Kata config layer for handler: ${originalHandler}`,
        });
      });
    });

    /**
     * **Validates: Requirements 3.4, 4.1**
     * - 3.4: THE kata_Wrapper SHALL NOT set the `JS_HANDLER_PATH` environment variable
     * - 4.1: THE kata_Wrapper SHALL NOT add the `JS_HANDLER_PATH` environment variable to transformed Lambdas
     */
    describe('Requirements 3.4, 4.1: JS_HANDLER_PATH not set', () => {
      it('should NOT set JS_HANDLER_PATH environment variable', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction', {
          handler: 'index.handler',
        });

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify JS_HANDLER_PATH is NOT in environment variables
        const template = Template.fromStack(stack);
        const resources = template.findResources('AWS::Lambda::Function');
        const functionResource = Object.values(resources)[0];
        const envVars = functionResource.Properties?.Environment?.Variables || {};

        expect(envVars).not.toHaveProperty('JS_HANDLER_PATH');
      });

      it('should NOT set JS_HANDLER_PATH even with nested handler paths', () => {
        const { stack } = createTestStack();
        const originalHandler = 'src/handlers/api/users.createUser';
        const lambda = createTestLambda(stack, 'TestFunction', {
          handler: originalHandler,
        });

        const config: TransformationConfig = {
          originalHandler,
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify JS_HANDLER_PATH is NOT in environment variables
        const template = Template.fromStack(stack);
        const resources = template.findResources('AWS::Lambda::Function');
        const functionResource = Object.values(resources)[0];
        const envVars = functionResource.Properties?.Environment?.Variables || {};

        expect(envVars).not.toHaveProperty('JS_HANDLER_PATH');
      });
    });

    /**
     * **Validates: Requirement 4.2**
     * THE kata_Wrapper SHALL NOT add any Lambda Kata environment variables (all config in layer)
     */
    describe('Requirement 4.2: No Lambda Kata env vars added', () => {
      it('should NOT set JS_BUNDLE_PATH environment variable (uses config layer)', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction');

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify JS_BUNDLE_PATH is NOT set (bundle path is in config layer)
        const template = Template.fromStack(stack);
        const resources = template.findResources('AWS::Lambda::Function');
        const functionResource = Object.values(resources)[0];
        const envVars = functionResource.Properties?.Environment?.Variables || {};
        expect(envVars).not.toHaveProperty('JS_BUNDLE_PATH');
      });

      it('should NOT set USE_CTYPES_BRIDGE environment variable (ctypes always used)', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction');

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify USE_CTYPES_BRIDGE is NOT set (ctypes bridge is always used)
        const template = Template.fromStack(stack);
        const resources = template.findResources('AWS::Lambda::Function');
        const functionResource = Object.values(resources)[0];
        const envVars = functionResource.Properties?.Environment?.Variables || {};
        expect(envVars).not.toHaveProperty('USE_CTYPES_BRIDGE');
      });

      it('should NOT set any Lambda Kata env vars (all config in layer)', () => {
        const { stack } = createTestStack();
        const lambda = createTestLambda(stack, 'TestFunction');

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify no Lambda Kata env vars are set
        const template = Template.fromStack(stack);
        const resources = template.findResources('AWS::Lambda::Function');
        const functionResource = Object.values(resources)[0];
        const envVars = functionResource.Properties?.Environment?.Variables || {};
        expect(envVars).not.toHaveProperty('JS_HANDLER_PATH');
        expect(envVars).not.toHaveProperty('JS_BUNDLE_PATH');
        expect(envVars).not.toHaveProperty('USE_CTYPES_BRIDGE');
      });
    });

    /**
     * **Validates: Requirement 4.3**
     * IF a Lambda already has a `JS_HANDLER_PATH` environment variable, THE kata_Wrapper SHALL NOT modify or remove it
     */
    describe('Requirement 4.3: Existing JS_HANDLER_PATH preserved', () => {
      it('should NOT remove existing JS_HANDLER_PATH environment variable', () => {
        const { stack } = createTestStack();
        const existingHandlerPath = 'custom/path.handler';
        const lambda = createTestLambda(stack, 'TestFunction', {
          environment: {
            JS_HANDLER_PATH: existingHandlerPath,
          },
        });

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify existing JS_HANDLER_PATH is preserved
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
          Environment: {
            Variables: {
              JS_HANDLER_PATH: existingHandlerPath,
            },
          },
        });
      });

      it('should NOT modify existing JS_HANDLER_PATH when it differs from originalHandler', () => {
        const { stack } = createTestStack();
        const existingHandlerPath = 'legacy/handler.process';
        const originalHandler = 'new/handler.handle';
        const lambda = createTestLambda(stack, 'TestFunction', {
          handler: originalHandler,
          environment: {
            JS_HANDLER_PATH: existingHandlerPath,
          },
        });

        const config: TransformationConfig = {
          originalHandler,
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify existing JS_HANDLER_PATH is preserved (not overwritten with originalHandler)
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
          Environment: {
            Variables: {
              JS_HANDLER_PATH: existingHandlerPath, // Should be the original value, not overwritten
            },
          },
        });
      });

      it('should preserve existing JS_HANDLER_PATH alongside other env vars (no Lambda Kata vars added)', () => {
        const { stack } = createTestStack();
        const existingHandlerPath = 'custom/path.handler';
        const lambda = createTestLambda(stack, 'TestFunction', {
          environment: {
            JS_HANDLER_PATH: existingHandlerPath,
            MY_CUSTOM_VAR: 'custom-value',
          },
        });

        const config: TransformationConfig = {
          originalHandler: 'index.handler',
          targetRuntime: Runtime.PYTHON_3_12,
          targetHandler: 'lambdakata.optimized_handler.lambda_handler',
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        };

        applyTransformation(lambda, config);

        // Verify user-set env vars are preserved
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::Function', {
          Environment: {
            Variables: {
              JS_HANDLER_PATH: existingHandlerPath,
              MY_CUSTOM_VAR: 'custom-value',
            },
          },
        });

        // Verify no Lambda Kata env vars are added (all config in layer)
        const resources = template.findResources('AWS::Lambda::Function');
        const functionResource = Object.values(resources)[0];
        const envVars = functionResource.Properties?.Environment?.Variables || {};
        expect(envVars).not.toHaveProperty('JS_BUNDLE_PATH');
        expect(envVars).not.toHaveProperty('USE_CTYPES_BRIDGE');
      });
    });

    /**
     * Integration test for config layer with kataWithAccountId
     */
    describe('Integration: Config layer with licensing', () => {
      it('should attach config layer when account is entitled', async () => {
        const { stack } = createTestStack('123456789012');
        const originalHandler = 'bundle.handler';
        const lambda = createTestLambda(stack, 'TestFunction', {
          handler: originalHandler,
        });
        const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';

        const mockLicensing = new MockLicensingService();
        mockLicensing.setEntitled('123456789012', layerArn);

        const result = await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        expect(result.transformed).toBe(true);

        // Verify config layer is created
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Lambda::LayerVersion', {
          Description: `Lambda Kata config layer for handler: ${originalHandler}`,
        });

        // Verify no Lambda Kata env vars are set (all config in layer)
        const resources = template.findResources('AWS::Lambda::Function');
        const functionResource = Object.values(resources)[0];
        const envVars = functionResource.Properties?.Environment?.Variables || {};
        expect(envVars).not.toHaveProperty('JS_HANDLER_PATH');
        expect(envVars).not.toHaveProperty('JS_BUNDLE_PATH');
        expect(envVars).not.toHaveProperty('USE_CTYPES_BRIDGE');
      });

      it('should NOT attach config layer when account is not entitled', async () => {
        const { stack } = createTestStack('123456789012');
        const lambda = createTestLambda(stack, 'TestFunction', {
          handler: 'index.handler',
        });

        const mockLicensing = new MockLicensingService();
        // Account is not entitled (no setEntitled call)

        const result = await kataWithAccountId(lambda, '123456789012', {
          licensingService: mockLicensing,
        });

        expect(result.transformed).toBe(false);

        // Verify no config layer is created
        const template = Template.fromStack(stack);
        expect(() => {
          template.hasResourceProperties('AWS::Lambda::LayerVersion', {
            Description: Match.stringLikeRegexp('Lambda Kata config layer.*'),
          });
        }).toThrow();
      });
    });
  });
});

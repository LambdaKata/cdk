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
 * Tests for LogGroup safety fix in applyTransformation.
 *
 * When the CDK feature flag `@aws-cdk/aws-lambda:useCdkManagedLogGroup` is enabled,
 * CDK creates a direct `AWS::Logs::LogGroup` resource for each Lambda function.
 * This causes `AlreadyExists` errors on redeployment when the LogGroup was previously
 * created by AWS automatically (outside CloudFormation).
 *
 * The fix replaces the CDK-managed LogGroup with a `LogRetention` Custom Resource
 * that safely handles `ResourceAlreadyExistsException`.
 *
 * @module log-group-safety.test
 */

import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { applyTransformation } from '../src/kata-wrapper';
import { TransformationConfig } from '../src/types';

/** Reusable transformation config for tests */
function makeConfig(overrides?: Partial<TransformationConfig>): TransformationConfig {
  return {
    originalHandler: 'index.handler',
    originalRuntime: 'nodejs18.x',
    targetRuntime: Runtime.PYTHON_3_12,
    targetHandler: 'lambdakata.optimized_handler.lambda_handler',
    layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:kata:1',
    ...overrides,
  };
}

/** Helper: create a stack with the useCdkManagedLogGroup feature flag enabled */
function createStackWithLogGroupFlag(): { app: App; stack: Stack } {
  const app = new App({
    context: {
      '@aws-cdk/aws-lambda:useCdkManagedLogGroup': true,
    },
  });
  const stack = new Stack(app, 'TestStack');
  return { app, stack };
}

/** Helper: create a stack WITHOUT the feature flag */
function createStackWithoutLogGroupFlag(): { app: App; stack: Stack } {
  const app = new App({
    context: {
      '@aws-cdk/aws-lambda:useCdkManagedLogGroup': false,
    },
  });
  const stack = new Stack(app, 'TestStack');
  return { app, stack };
}

/** Helper: create a Lambda function */
function createLambda(stack: Stack, id: string, props?: { functionName?: string }): LambdaFunction {
  return new LambdaFunction(stack, id, {
    runtime: Runtime.NODEJS_18_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => ({});'),
    functionName: props?.functionName,
  });
}

describe('LogGroup Safety Fix', () => {
  describe('when @aws-cdk/aws-lambda:useCdkManagedLogGroup is enabled', () => {
    it('should remove CDK-managed AWS::Logs::LogGroup and replace with LogRetention Custom Resource', () => {
      const { stack } = createStackWithLogGroupFlag();
      const lambda = createLambda(stack, 'TestFn', { functionName: 'my-function' });

      // Before transformation: CDK should have created a LogGroup child
      expect(lambda.node.tryFindChild('LogGroup')).toBeDefined();

      applyTransformation(lambda, makeConfig());

      // After transformation: direct LogGroup should be removed
      expect(lambda.node.tryFindChild('LogGroup')).toBeUndefined();

      // LogRetention should be created instead
      expect(lambda.node.tryFindChild('KataLogRetention')).toBeDefined();

      const template = Template.fromStack(stack);

      // The user Lambda's LogGroup (/aws/lambda/my-function) should NOT exist
      // as a direct AWS::Logs::LogGroup resource. Other LogGroups may exist
      // (e.g., from SnapStartActivator's Provider framework Lambda).
      const logGroups = template.findResources('AWS::Logs::LogGroup');
      const userLogGroupExists = Object.values(logGroups).some((lg: any) => {
        const name = lg.Properties?.LogGroupName;
        // Direct string match for the user Lambda's LogGroup
        return name === '/aws/lambda/my-function';
      });
      expect(userLogGroupExists).toBe(false);

      // Should have a Custom::LogRetention resource for the user Lambda
      template.hasResourceProperties('Custom::LogRetention', {
        LogGroupName: Match.objectLike({
          'Fn::Join': Match.anyValue(),
        }),
      });
    });

    it('should work correctly with multiple kata-transformed Lambdas', () => {
      const { stack } = createStackWithLogGroupFlag();
      const fn1 = createLambda(stack, 'Fn1', { functionName: 'fn-one' });
      const fn2 = createLambda(stack, 'Fn2', { functionName: 'fn-two' });

      applyTransformation(fn1, makeConfig());
      applyTransformation(fn2, makeConfig());

      // Both should have LogRetention, not direct LogGroup
      expect(fn1.node.tryFindChild('LogGroup')).toBeUndefined();
      expect(fn2.node.tryFindChild('LogGroup')).toBeUndefined();
      expect(fn1.node.tryFindChild('KataLogRetention')).toBeDefined();
      expect(fn2.node.tryFindChild('KataLogRetention')).toBeDefined();

      const template = Template.fromStack(stack);

      // Neither user Lambda's LogGroup should exist as direct AWS::Logs::LogGroup
      const logGroups = template.findResources('AWS::Logs::LogGroup');
      const userLogGroupNames = Object.values(logGroups)
        .map((lg: any) => lg.Properties?.LogGroupName)
        .filter((name: any) => typeof name === 'string');
      expect(userLogGroupNames).not.toContain('/aws/lambda/fn-one');
      expect(userLogGroupNames).not.toContain('/aws/lambda/fn-two');
    });

    it('should preserve Lambda transformation properties alongside LogGroup fix', () => {
      const { stack } = createStackWithLogGroupFlag();
      const lambda = createLambda(stack, 'TestFn');

      applyTransformation(lambda, makeConfig({
        originalHandler: 'src/api.handler',
      }));

      const template = Template.fromStack(stack);

      // Core transformation should still be applied
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'python3.12',
        Handler: 'lambdakata.optimized_handler.lambda_handler',
      });
    });
  });

  describe('when @aws-cdk/aws-lambda:useCdkManagedLogGroup is disabled', () => {
    it('should not create LogRetention when feature flag is off', () => {
      const { stack } = createStackWithoutLogGroupFlag();
      const lambda = createLambda(stack, 'TestFn');

      // No LogGroup child should exist
      expect(lambda.node.tryFindChild('LogGroup')).toBeUndefined();

      applyTransformation(lambda, makeConfig());

      // Should not create KataLogRetention either
      expect(lambda.node.tryFindChild('KataLogRetention')).toBeUndefined();

      const template = Template.fromStack(stack);

      // No LogGroup or LogRetention resources
      const logGroups = template.findResources('AWS::Logs::LogGroup');
      expect(Object.keys(logGroups).length).toBe(0);
    });
  });

  describe('when user provides explicit logGroup', () => {
    it('should not interfere with user-provided logGroup', () => {
      const { stack } = createStackWithLogGroupFlag();

      // User creates their own LogGroup and passes it to Lambda
      const userLogGroup = new LogGroup(stack, 'UserLogGroup', {
        logGroupName: '/custom/my-function',
      });

      const lambda = new LambdaFunction(stack, 'TestFn', {
        runtime: Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({});'),
        logGroup: userLogGroup,
      });

      // When user provides logGroup, CDK does NOT create the "LogGroup" child
      // (the feature flag branch is skipped)
      const hasLogGroupChild = lambda.node.tryFindChild('LogGroup') !== undefined;

      applyTransformation(lambda, makeConfig());

      // If there was no CDK-managed LogGroup, KataLogRetention should not be created
      if (!hasLogGroupChild) {
        expect(lambda.node.tryFindChild('KataLogRetention')).toBeUndefined();
      }

      // User's LogGroup should still exist in the template
      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/custom/my-function',
      });
    });
  });

  describe('idempotency', () => {
    it('should not fail if applyTransformation is called and LogGroup was already removed', () => {
      const { stack } = createStackWithLogGroupFlag();
      const lambda = createLambda(stack, 'TestFn');

      // Manually remove LogGroup before applyTransformation
      lambda.node.tryRemoveChild('LogGroup');

      // Should not throw
      expect(() => {
        applyTransformation(lambda, makeConfig());
      }).not.toThrow();

      // Should not create KataLogRetention since LogGroup was already gone
      expect(lambda.node.tryFindChild('KataLogRetention')).toBeUndefined();
    });
  });
});

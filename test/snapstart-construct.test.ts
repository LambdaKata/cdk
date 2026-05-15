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
 * Unit Tests for SnapStart Construct
 *
 * These tests verify the SnapStartActivator CDK construct correctly creates
 * the Custom Resource infrastructure for SnapStart activation.
 *
 * @module snapstart-construct.test
 */

import { App, CfnOutput, Stack } from 'aws-cdk-lib';
import { Capture, Match, Template } from 'aws-cdk-lib/assertions';
import { Code, Function as LambdaFunction, IFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SnapStartActivator } from '../src/snapstart-construct';
import * as fc from 'fast-check';

/**
 * Helper to create a test stack
 */
function createTestStack(): { app: App; stack: Stack } {
  const app = new App();
  const stack = new Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
  return { app, stack };
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

describe('snapstart-construct', () => {
  describe('SnapStartActivator', () => {
    describe('construct creation', () => {
      it('should create a Custom Resource', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::CloudFormation::CustomResource', 1);
      });

      it('should create a provider Lambda function', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        // Should have at least 2 Lambda functions: target + provider handler
        const lambdaResources = template.findResources('AWS::Lambda::Function');
        expect(Object.keys(lambdaResources).length).toBeGreaterThanOrEqual(2);
      });

      it('should set default alias name to "kata"', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        const activator = new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        expect(activator.aliasName).toBe('kata');
      });

      it('should use custom alias name when provided', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        const activator = new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
          aliasName: 'production',
        });

        expect(activator.aliasName).toBe('production');
      });
    });

    describe('Custom Resource properties', () => {
      it('should pass FunctionName to Custom Resource', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
          FunctionName: Match.objectLike({
            Ref: Match.stringLikeRegexp('TargetFunction'),
          }),
        });
      });

      it('should pass AliasName to Custom Resource', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
          aliasName: 'live',
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
          AliasName: 'live',
        });
      });

      it('should include Timestamp property for update triggering', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
          Timestamp: Match.anyValue(),
        });
      });

      it('should set Timestamp as a non-empty string value', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        const capture = new Capture();
        template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
          Timestamp: capture,
        });

        const timestampValue = capture.asString();
        expect(timestampValue).toBeDefined();
        expect(timestampValue.length).toBeGreaterThan(0);
        // Timestamp should be a numeric string (Date.now().toString())
        expect(Number(timestampValue)).not.toBeNaN();
      });

      it('should pass default AliasName "kata" to Custom Resource', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
          AliasName: 'kata',
        });
      });

      it('should pass SnapshotTimeoutSeconds to Custom Resource', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
          snapshotTimeoutSeconds: 300,
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
          SnapshotTimeoutSeconds: '300',
        });
      });

      it('should pass default SnapshotTimeoutSeconds when not specified', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
          SnapshotTimeoutSeconds: '180',
        });
      });
    });

    describe('provider Lambda configuration', () => {
      it('should use Node.js 18.x runtime for provider', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        // Find the handler function (not the target function)
        const lambdaResources = template.findResources('AWS::Lambda::Function', {
          Properties: {
            Description: Match.stringLikeRegexp('SnapStart'),
          },
        });

        const handlerResource = Object.values(lambdaResources)[0];
        expect(handlerResource?.Properties?.Runtime).toBe('nodejs18.x');
      });

      it('should set default timeout for provider when snapshotTimeoutSeconds is not specified', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        const lambdaResources = template.findResources('AWS::Lambda::Function', {
          Properties: {
            Description: Match.stringLikeRegexp('SnapStart'),
          },
        });

        const handlerResource = Object.values(lambdaResources)[0];
        // Default snapshotTimeoutSeconds is 180, so timeout = 180 + 60 = 240
        expect(handlerResource?.Properties?.Timeout).toBe(240);
      });

      it('should set timeout to snapshotTimeoutSeconds + 60 for explicit default value', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
          snapshotTimeoutSeconds: 180,
        });

        const template = Template.fromStack(stack);
        const lambdaResources = template.findResources('AWS::Lambda::Function', {
          Properties: {
            Description: Match.stringLikeRegexp('SnapStart'),
          },
        });

        const handlerResource = Object.values(lambdaResources)[0];
        // Timeout should be snapshotTimeout + 60 seconds buffer
        expect(handlerResource?.Properties?.Timeout).toBe(240);
      });

      it('should set timeout to snapshotTimeoutSeconds + 60 for custom value', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
          snapshotTimeoutSeconds: 300,
        });

        const template = Template.fromStack(stack);
        const lambdaResources = template.findResources('AWS::Lambda::Function', {
          Properties: {
            Description: Match.stringLikeRegexp('SnapStart'),
          },
        });

        const handlerResource = Object.values(lambdaResources)[0];
        // Timeout should be 300 + 60 = 360
        expect(handlerResource?.Properties?.Timeout).toBe(360);
      });

      it('should use asset-based code for provider Lambda', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        const lambdaResources = template.findResources('AWS::Lambda::Function', {
          Properties: {
            Description: Match.stringLikeRegexp('SnapStart'),
          },
        });

        const handlerResource = Object.values(lambdaResources)[0];
        // Asset-based code uses S3Bucket/S3Key instead of ZipFile
        expect(handlerResource?.Properties?.Code?.S3Bucket).toBeDefined();
        expect(handlerResource?.Properties?.Code?.S3Key).toBeDefined();
        // Should NOT have inline ZipFile
        expect(handlerResource?.Properties?.Code?.ZipFile).toBeUndefined();
      });

      it('should set handler to snapstart-handler.handler', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        const lambdaResources = template.findResources('AWS::Lambda::Function', {
          Properties: {
            Description: Match.stringLikeRegexp('SnapStart'),
          },
        });

        const handlerResource = Object.values(lambdaResources)[0];
        expect(handlerResource?.Properties?.Handler).toBe('snapstart-handler.handler');
      });
    });

    describe('IAM permissions', () => {
      it('should grant GetFunction permission', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::IAM::Policy', {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: Match.arrayWith(['lambda:GetFunction']),
                Effect: 'Allow',
              }),
            ]),
          },
        });
      });

      it('should grant GetFunctionConfiguration permission', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::IAM::Policy', {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: Match.arrayWith(['lambda:GetFunctionConfiguration']),
                Effect: 'Allow',
              }),
            ]),
          },
        });
      });

      it('should grant UpdateFunctionConfiguration permission', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::IAM::Policy', {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: Match.arrayWith(['lambda:UpdateFunctionConfiguration']),
                Effect: 'Allow',
              }),
            ]),
          },
        });
      });

      it('should grant PublishVersion permission', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::IAM::Policy', {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: Match.arrayWith(['lambda:PublishVersion']),
                Effect: 'Allow',
              }),
            ]),
          },
        });
      });

      it('should grant alias management permissions', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::IAM::Policy', {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: Match.arrayWith([
                  'lambda:GetAlias',
                  'lambda:CreateAlias',
                  'lambda:UpdateAlias',
                ]),
                Effect: 'Allow',
              }),
            ]),
          },
        });
      });

      it('should scope permissions to target function ARN', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::IAM::Policy', {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Resource: Match.arrayWith([
                  Match.objectLike({
                    'Fn::GetAtt': Match.arrayWith([
                      Match.stringLikeRegexp('TargetFunction'),
                      'Arn',
                    ]),
                  }),
                ]),
              }),
            ]),
          },
        });
      });

      it('should scope permissions to target function versions and aliases', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        // Verify the resource array includes functionArn:* for versions/aliases
        template.hasResourceProperties('AWS::IAM::Policy', {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Resource: Match.arrayWith([
                  Match.objectLike({
                    'Fn::Join': Match.arrayWith([
                      '',
                      Match.arrayWith([
                        Match.objectLike({
                          'Fn::GetAtt': Match.arrayWith([
                            Match.stringLikeRegexp('TargetFunction'),
                            'Arn',
                          ]),
                        }),
                        ':*',
                      ]),
                    ]),
                  }),
                ]),
              }),
            ]),
          },
        });
      });

      it('should not use wildcard resource for permissions', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        const policies = template.findResources('AWS::IAM::Policy');

        // Check that no policy statement uses '*' as a standalone resource
        for (const policyLogicalId of Object.keys(policies)) {
          const statements = policies[policyLogicalId].Properties?.PolicyDocument?.Statement ?? [];
          for (const statement of statements) {
            // Only check statements that contain our lambda actions
            const actions: string[] = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
            const hasLambdaAction = actions.some((a: string) => a.startsWith('lambda:'));
            if (hasLambdaAction) {
              const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
              // No resource should be the literal string '*'
              for (const resource of resources) {
                expect(resource).not.toBe('*');
              }
            }
          }
        }
      });

      it('should grant all seven required permissions in a single statement', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        // Verify all 7 permissions are present together
        template.hasResourceProperties('AWS::IAM::Policy', {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: Match.arrayWith([
                  'lambda:GetFunction',
                  'lambda:GetFunctionConfiguration',
                  'lambda:UpdateFunctionConfiguration',
                  'lambda:PublishVersion',
                  'lambda:GetAlias',
                  'lambda:CreateAlias',
                  'lambda:UpdateAlias',
                ]),
                Effect: 'Allow',
              }),
            ]),
          },
        });
      });
    });

    describe('dependency management', () => {
      it('should depend on target function', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        const template = Template.fromStack(stack);
        const customResources = template.findResources('AWS::CloudFormation::CustomResource');
        const customResource = Object.values(customResources)[0];

        // Custom Resource should have DependsOn including the target function
        expect(customResource.DependsOn).toBeDefined();
        expect(customResource.DependsOn).toEqual(
          expect.arrayContaining([
            expect.stringMatching(/TargetFunction/),
          ]),
        );
      });
    });

    describe('output references', () => {
      it('should expose versionRef as a CloudFormation attribute reference', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        const activator = new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        // versionRef must be defined and be a non-empty string (CDK token)
        expect(activator.versionRef).toBeDefined();
        expect(typeof activator.versionRef).toBe('string');
        expect(activator.versionRef.length).toBeGreaterThan(0);

        // Verify the synthesized template resolves versionRef via Fn::GetAtt on the Custom Resource
        const template = Template.fromStack(stack);
        const customResources = template.findResources('AWS::CloudFormation::CustomResource');
        expect(Object.keys(customResources).length).toBe(1);
      });

      it('should expose aliasArnRef as a CloudFormation attribute reference', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        const activator = new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        // aliasArnRef must be defined and be a non-empty string (CDK token)
        expect(activator.aliasArnRef).toBeDefined();
        expect(typeof activator.aliasArnRef).toBe('string');
        expect(activator.aliasArnRef.length).toBeGreaterThan(0);

        // Verify the synthesized template resolves aliasArnRef via Fn::GetAtt on the Custom Resource
        const template = Template.fromStack(stack);
        const customResources = template.findResources('AWS::CloudFormation::CustomResource');
        expect(Object.keys(customResources).length).toBe(1);
      });

      it('should expose aliasName as a string property', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        const activator = new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        expect(activator.aliasName).toBeDefined();
        expect(typeof activator.aliasName).toBe('string');
        expect(activator.aliasName).toBe('kata');
      });

      it('should expose custom aliasName when provided', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        const activator = new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
          aliasName: 'production',
        });

        expect(activator.aliasName).toBe('production');
      });

      it('should expose versionRef that resolves to Custom Resource GetAtt Version', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        const activator = new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        // Use versionRef in a CfnOutput to verify it resolves in the template
        new CfnOutput(stack, 'VersionOutput', {
          value: activator.versionRef,
        });

        const template = Template.fromStack(stack);
        // The output should reference the Custom Resource via Fn::GetAtt with 'Version'
        template.hasOutput('VersionOutput', {
          Value: Match.objectLike({
            'Fn::GetAtt': Match.arrayWith([
              Match.stringLikeRegexp('^SnapStart'),
              'Version',
            ]),
          }),
        });
      });

      it('should expose aliasArnRef that resolves to Custom Resource GetAtt AliasArn', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        const activator = new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        // Use aliasArnRef in a CfnOutput to verify it resolves in the template
        new CfnOutput(stack, 'AliasArnOutput', {
          value: activator.aliasArnRef,
        });

        const template = Template.fromStack(stack);
        // The output should reference the Custom Resource via Fn::GetAtt with 'AliasArn'
        template.hasOutput('AliasArnOutput', {
          Value: Match.objectLike({
            'Fn::GetAtt': Match.arrayWith([
              Match.stringLikeRegexp('^SnapStart'),
              'AliasArn',
            ]),
          }),
        });
      });

      it('should expose resource property', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        const activator = new SnapStartActivator(stack, 'SnapStart', {
          targetFunction,
        });

        expect(activator.resource).toBeDefined();
      });
    });

    describe('integration with kata wrapper', () => {
      it('should work with transformed Lambda function', () => {
        const { stack } = createTestStack();
        const targetFunction = createTestLambda(stack, 'TargetFunction');

        // Simulate what kata() does - change runtime and handler
        const cfnFunction = targetFunction.node.defaultChild as any;
        cfnFunction.runtime = 'python3.12';
        cfnFunction.handler = 'lambdakata.optimized_handler.lambda_handler';

        // Should not throw
        expect(() => {
          new SnapStartActivator(stack, 'SnapStart', {
            targetFunction,
          });
        }).not.toThrow();

        const template = Template.fromStack(stack);
        template.resourceCountIs('AWS::CloudFormation::CustomResource', 1);
      });
    });

    /**
     * Feature: snapstart-handler-refactor, Property 1: Asset-Based Code Deployment
     *
     * *For any* SnapStartActivator construct with valid props, the synthesized CloudFormation
     * template SHALL contain a Lambda function with:
     * - Code property using S3Bucket/S3Key (asset) instead of ZipFile (inline)
     * - Handler property set to `snapstart-handler.handler`
     *
     * **Validates: Requirements 3.2, 3.4, 3.5**
     */
    describe('Property 1: Asset-Based Code Deployment', () => {
      /**
       * Arbitrary generator for valid alias names
       * Lambda alias names must be 1-128 characters, alphanumeric with hyphens and underscores
       */
      const arbitraryAliasName = (): fc.Arbitrary<string> =>
        fc.stringOf(
          fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'),
          { minLength: 1, maxLength: 128 },
        );

      /**
       * Arbitrary generator for valid snapshot timeout values
       * Valid range: 60-600 seconds (1-10 minutes)
       */
      const arbitrarySnapshotTimeout = (): fc.Arbitrary<number> =>
        fc.integer({ min: 60, max: 600 });

      /**
       * Arbitrary generator for SnapStartActivator props (excluding targetFunction)
       */
      const arbitrarySnapStartProps = (): fc.Arbitrary<{
        aliasName: string;
        snapshotTimeoutSeconds: number;
      }> =>
        fc.record({
          aliasName: arbitraryAliasName(),
          snapshotTimeoutSeconds: arbitrarySnapshotTimeout(),
        });

      it('should use asset-based code (S3Bucket/S3Key) for any valid props', () => {
        fc.assert(
          fc.property(arbitrarySnapStartProps(), (props) => {
            const { stack } = createTestStack();
            const targetFunction = createTestLambda(stack, 'Target');

            new SnapStartActivator(stack, 'SnapStart', {
              targetFunction,
              ...props,
            });

            const template = Template.fromStack(stack);
            const lambdas = template.findResources('AWS::Lambda::Function', {
              Properties: {
                Description: Match.stringLikeRegexp('SnapStart'),
              },
            });

            // Should find exactly one SnapStart handler Lambda
            const handlerLambdas = Object.values(lambdas);
            expect(handlerLambdas.length).toBeGreaterThanOrEqual(1);

            const handler = handlerLambdas[0];

            // Asset-based code uses S3Bucket/S3Key
            expect(handler.Properties.Code.S3Bucket).toBeDefined();
            expect(handler.Properties.Code.S3Key).toBeDefined();

            // Should NOT have inline ZipFile
            expect(handler.Properties.Code.ZipFile).toBeUndefined();

            return true;
          }),
          { numRuns: 7 },
        );
      });

      it('should set handler to snapstart-handler.handler for any valid props', () => {
        fc.assert(
          fc.property(arbitrarySnapStartProps(), (props) => {
            const { stack } = createTestStack();
            const targetFunction = createTestLambda(stack, 'Target');

            new SnapStartActivator(stack, 'SnapStart', {
              targetFunction,
              ...props,
            });

            const template = Template.fromStack(stack);
            const lambdas = template.findResources('AWS::Lambda::Function', {
              Properties: {
                Description: Match.stringLikeRegexp('SnapStart'),
              },
            });

            const handlerLambdas = Object.values(lambdas);
            expect(handlerLambdas.length).toBeGreaterThanOrEqual(1);

            const handler = handlerLambdas[0];

            // Handler must be snapstart-handler.handler
            expect(handler.Properties.Handler).toBe('snapstart-handler.handler');

            return true;
          }),
          { numRuns: 7 },
        );
      });

      it('should use asset-based code with correct handler for any combination of optional props', () => {
        /**
         * Test with optional props (aliasName and snapshotTimeoutSeconds can be omitted)
         */
        const arbitraryOptionalProps = (): fc.Arbitrary<{
          aliasName?: string;
          snapshotTimeoutSeconds?: number;
        }> =>
          fc.record({
            aliasName: fc.option(arbitraryAliasName(), { nil: undefined }),
            snapshotTimeoutSeconds: fc.option(arbitrarySnapshotTimeout(), { nil: undefined }),
          });

        fc.assert(
          fc.property(arbitraryOptionalProps(), (props) => {
            const { stack } = createTestStack();
            const targetFunction = createTestLambda(stack, 'Target');

            // Filter out undefined values
            const cleanProps: { aliasName?: string; snapshotTimeoutSeconds?: number } = {};
            if (props.aliasName !== undefined) cleanProps.aliasName = props.aliasName;
            if (props.snapshotTimeoutSeconds !== undefined) cleanProps.snapshotTimeoutSeconds = props.snapshotTimeoutSeconds;

            new SnapStartActivator(stack, 'SnapStart', {
              targetFunction,
              ...cleanProps,
            });

            const template = Template.fromStack(stack);
            const lambdas = template.findResources('AWS::Lambda::Function', {
              Properties: {
                Description: Match.stringLikeRegexp('SnapStart'),
              },
            });

            const handlerLambdas = Object.values(lambdas);
            expect(handlerLambdas.length).toBeGreaterThanOrEqual(1);

            const handler = handlerLambdas[0];

            // Asset-based code invariants
            expect(handler.Properties.Code.S3Bucket).toBeDefined();
            expect(handler.Properties.Code.S3Key).toBeDefined();
            expect(handler.Properties.Code.ZipFile).toBeUndefined();

            // Handler invariant
            expect(handler.Properties.Handler).toBe('snapstart-handler.handler');

            return true;
          }),
          { numRuns: 7 },
        );
      });
    });

    /**
     * Feature: snapstart-handler-refactor, Property 3: Backward Compatible API
     *
     * *For any* valid SnapStartActivatorProps configuration, the construct SHALL:
     * - Accept the same props interface (targetFunction, aliasName, snapshotTimeoutSeconds)
     * - Expose the same output references (versionRef, aliasArnRef, aliasName, resource)
     * - Generate equivalent IAM permissions for the provider Lambda
     * - Calculate timeout as snapshotTimeoutSeconds + 60 seconds
     *
     * **Validates: Requirements 5.1, 5.2**
     */
    describe('Property 3: Backward Compatible API', () => {
      /**
       * Arbitrary generator for valid alias names
       * Lambda alias names must be 1-128 characters, alphanumeric with hyphens and underscores
       */
      const arbitraryAliasName = (): fc.Arbitrary<string> =>
        fc.stringOf(
          fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'),
          { minLength: 1, maxLength: 128 },
        );

      /**
       * Arbitrary generator for valid snapshot timeout values
       * Valid range: 60-600 seconds (1-10 minutes)
       */
      const arbitrarySnapshotTimeout = (): fc.Arbitrary<number> =>
        fc.integer({ min: 60, max: 600 });

      /**
       * Arbitrary generator for optional SnapStartActivator props (excluding targetFunction)
       * Both aliasName and snapshotTimeoutSeconds are optional in the API
       */
      const arbitraryOptionalSnapStartProps = (): fc.Arbitrary<{
        aliasName?: string;
        snapshotTimeoutSeconds?: number;
      }> =>
        fc.record({
          aliasName: fc.option(arbitraryAliasName(), { nil: undefined }),
          snapshotTimeoutSeconds: fc.option(arbitrarySnapshotTimeout(), { nil: undefined }),
        });

      it('should preserve API contract for any valid props', () => {
        fc.assert(
          fc.property(arbitraryOptionalSnapStartProps(), (props) => {
            const { stack } = createTestStack();
            const targetFunction = createTestLambda(stack, 'Target');

            // Filter out undefined values to match real usage patterns
            const cleanProps: { aliasName?: string; snapshotTimeoutSeconds?: number } = {};
            if (props.aliasName !== undefined) cleanProps.aliasName = props.aliasName;
            if (props.snapshotTimeoutSeconds !== undefined) cleanProps.snapshotTimeoutSeconds = props.snapshotTimeoutSeconds;

            const activator = new SnapStartActivator(stack, 'SnapStart', {
              targetFunction,
              ...cleanProps,
            });

            // API contract verification: all output references must be defined
            expect(activator.aliasName).toBeDefined();
            expect(typeof activator.aliasName).toBe('string');
            expect(activator.versionRef).toBeDefined();
            expect(typeof activator.versionRef).toBe('string');
            expect(activator.aliasArnRef).toBeDefined();
            expect(typeof activator.aliasArnRef).toBe('string');
            expect(activator.resource).toBeDefined();

            // aliasName should match input or default to 'kata'
            const expectedAliasName = props.aliasName ?? 'kata';
            expect(activator.aliasName).toBe(expectedAliasName);

            return true;
          }),
          { numRuns: 7 },
        );
      });

      it('should calculate timeout as snapshotTimeoutSeconds + 60 for any valid timeout', () => {
        fc.assert(
          fc.property(arbitraryOptionalSnapStartProps(), (props) => {
            const { stack } = createTestStack();
            const targetFunction = createTestLambda(stack, 'Target');

            // Filter out undefined values
            const cleanProps: { aliasName?: string; snapshotTimeoutSeconds?: number } = {};
            if (props.aliasName !== undefined) cleanProps.aliasName = props.aliasName;
            if (props.snapshotTimeoutSeconds !== undefined) cleanProps.snapshotTimeoutSeconds = props.snapshotTimeoutSeconds;

            new SnapStartActivator(stack, 'SnapStart', {
              targetFunction,
              ...cleanProps,
            });

            // Timeout calculation: snapshotTimeoutSeconds + 60 seconds buffer
            const expectedTimeout = (props.snapshotTimeoutSeconds ?? 180) + 60;
            const template = Template.fromStack(stack);
            const lambdas = template.findResources('AWS::Lambda::Function', {
              Properties: {
                Description: Match.stringLikeRegexp('SnapStart'),
              },
            });

            const handlerLambdas = Object.values(lambdas);
            expect(handlerLambdas.length).toBeGreaterThanOrEqual(1);

            const handler = handlerLambdas[0];
            expect(handler.Properties.Timeout).toBe(expectedTimeout);

            return true;
          }),
          { numRuns: 7 },
        );
      });

      it('should generate equivalent IAM permissions for any valid props', () => {
        fc.assert(
          fc.property(arbitraryOptionalSnapStartProps(), (props) => {
            const { stack } = createTestStack();
            const targetFunction = createTestLambda(stack, 'Target');

            // Filter out undefined values
            const cleanProps: { aliasName?: string; snapshotTimeoutSeconds?: number } = {};
            if (props.aliasName !== undefined) cleanProps.aliasName = props.aliasName;
            if (props.snapshotTimeoutSeconds !== undefined) cleanProps.snapshotTimeoutSeconds = props.snapshotTimeoutSeconds;

            new SnapStartActivator(stack, 'SnapStart', {
              targetFunction,
              ...cleanProps,
            });

            const template = Template.fromStack(stack);

            // Verify all 7 required IAM permissions are present
            template.hasResourceProperties('AWS::IAM::Policy', {
              PolicyDocument: {
                Statement: Match.arrayWith([
                  Match.objectLike({
                    Action: Match.arrayWith([
                      'lambda:GetFunction',
                      'lambda:GetFunctionConfiguration',
                      'lambda:UpdateFunctionConfiguration',
                      'lambda:PublishVersion',
                      'lambda:GetAlias',
                      'lambda:CreateAlias',
                      'lambda:UpdateAlias',
                    ]),
                    Effect: 'Allow',
                  }),
                ]),
              },
            });

            // Verify permissions are scoped to target function (not wildcard)
            template.hasResourceProperties('AWS::IAM::Policy', {
              PolicyDocument: {
                Statement: Match.arrayWith([
                  Match.objectLike({
                    Resource: Match.arrayWith([
                      Match.objectLike({
                        'Fn::GetAtt': Match.arrayWith([
                          Match.stringLikeRegexp('Target'),
                          'Arn',
                        ]),
                      }),
                    ]),
                  }),
                ]),
              },
            });

            return true;
          }),
          { numRuns: 7 },
        );
      });

      it('should accept the same props interface for any combination of optional props', () => {
        /**
         * Test that the construct accepts all valid combinations of the props interface:
         * - targetFunction (required)
         * - aliasName (optional)
         * - snapshotTimeoutSeconds (optional)
         */
        fc.assert(
          fc.property(
            fc.record({
              hasAliasName: fc.boolean(),
              hasSnapshotTimeout: fc.boolean(),
              aliasName: arbitraryAliasName(),
              snapshotTimeoutSeconds: arbitrarySnapshotTimeout(),
            }),
            ({ hasAliasName, hasSnapshotTimeout, aliasName, snapshotTimeoutSeconds }) => {
              const { stack } = createTestStack();
              const targetFunction = createTestLambda(stack, 'Target');

              // Build props based on boolean flags to test all combinations
              const constructProps: {
                targetFunction: IFunction;
                aliasName?: string;
                snapshotTimeoutSeconds?: number;
              } = { targetFunction };

              if (hasAliasName) {
                constructProps.aliasName = aliasName;
              }
              if (hasSnapshotTimeout) {
                constructProps.snapshotTimeoutSeconds = snapshotTimeoutSeconds;
              }

              // Should not throw for any valid combination
              const activator = new SnapStartActivator(stack, 'SnapStart', constructProps);

              // All output references must be defined regardless of input combination
              expect(activator.aliasName).toBeDefined();
              expect(activator.versionRef).toBeDefined();
              expect(activator.aliasArnRef).toBeDefined();
              expect(activator.resource).toBeDefined();

              // Verify defaults are applied correctly
              if (!hasAliasName) {
                expect(activator.aliasName).toBe('kata');
              } else {
                expect(activator.aliasName).toBe(aliasName);
              }

              // Verify timeout calculation
              const expectedTimeout = (hasSnapshotTimeout ? snapshotTimeoutSeconds : 180) + 60;
              const template = Template.fromStack(stack);
              const lambdas = template.findResources('AWS::Lambda::Function', {
                Properties: {
                  Description: Match.stringLikeRegexp('SnapStart'),
                },
              });
              const handler = Object.values(lambdas)[0];
              expect(handler.Properties.Timeout).toBe(expectedTimeout);

              return true;
            },
          ),
          { numRuns: 7 },
        );
      });
    });
  });
});

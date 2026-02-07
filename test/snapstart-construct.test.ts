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

import { App, Stack } from 'aws-cdk-lib';
import { Template, Match, Capture } from 'aws-cdk-lib/assertions';
import { Function as LambdaFunction, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { SnapStartActivator, SnapStartActivatorProps } from '../src/snapstart-construct';

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

            it('should set appropriate timeout for provider', () => {
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

            it('should include inline handler code', () => {
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
                expect(handlerResource?.Properties?.Code?.ZipFile).toBeDefined();
                expect(handlerResource?.Properties?.Code?.ZipFile).toContain('SNAPSTART ACTIVATION CYCLE');
            });
        });

        describe('IAM permissions', () => {
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
                    ])
                );
            });
        });

        describe('output references', () => {
            it('should expose versionRef attribute', () => {
                const { stack } = createTestStack();
                const targetFunction = createTestLambda(stack, 'TargetFunction');

                const activator = new SnapStartActivator(stack, 'SnapStart', {
                    targetFunction,
                });

                expect(activator.versionRef).toBeDefined();
            });

            it('should expose aliasArnRef attribute', () => {
                const { stack } = createTestStack();
                const targetFunction = createTestLambda(stack, 'TargetFunction');

                const activator = new SnapStartActivator(stack, 'SnapStart', {
                    targetFunction,
                });

                expect(activator.aliasArnRef).toBeDefined();
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
    });
});

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

import { App, Stack, CfnOutput } from 'aws-cdk-lib';
import { Template, Match, Capture } from 'aws-cdk-lib/assertions';
import { Function as LambdaFunction, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { SnapStartActivator } from '../src/snapstart-construct';

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
                    ])
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
    });
});

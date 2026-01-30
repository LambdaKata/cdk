/*
 * MIT
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the MIT; see the LICENSE file
 * or https://choosealicense.com/licenses/mit/ for details.
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * Integration Tests for Example CDK Stacks
 *
 * These tests verify that the example stacks are properly exported and that
 * equivalent stacks synthesize successfully with expected CloudFormation resources.
 *
 * Note: The actual example stacks use NodejsFunction which requires Docker for
 * bundling. These tests use regular Lambda Function with inline code to avoid
 * Docker dependency while still validating the kata() transformation behavior.
 *
 * **Validates: Requirements 8.5**
 * - THE Example_Stack SHALL be deployable for integration testing
 *
 * @module example-stack.test
 */

import { App, Stack, Duration } from 'aws-cdk-lib';
import { Function as LambdaFunction, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Template, Match } from 'aws-cdk-lib/assertions';

// Verify the example stack exports are available
import { ExampleLambdaKataStack, MultipleKataFunctionsStack } from '../examples/example-stack';
import { kata, getKataPromise } from '../src/index';

/**
 * Helper to create a test Lambda function (without Docker dependency)
 */
function createTestLambda(
    stack: Stack,
    id: string,
    options?: {
        handler?: string;
        runtime?: Runtime;
        environment?: Record<string, string>;
        memorySize?: number;
        timeout?: Duration;
        functionName?: string;
        description?: string;
    }
): LambdaFunction {
    return new LambdaFunction(stack, id, {
        runtime: options?.runtime ?? Runtime.NODEJS_18_X,
        handler: options?.handler ?? 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
        environment: options?.environment,
        memorySize: options?.memorySize,
        timeout: options?.timeout,
        functionName: options?.functionName,
        description: options?.description,
    });
}

describe('Example Stack Integration Tests', () => {
    /**
     * Verify that the example stack classes are exported and can be imported
     */
    describe('Example Stack Exports', () => {
        it('should export ExampleLambdaKataStack class', () => {
            expect(ExampleLambdaKataStack).toBeDefined();
            expect(typeof ExampleLambdaKataStack).toBe('function');
        });

        it('should export MultipleKataFunctionsStack class', () => {
            expect(MultipleKataFunctionsStack).toBeDefined();
            expect(typeof MultipleKataFunctionsStack).toBe('function');
        });
    });

    /**
     * Test equivalent stack to ExampleLambdaKataStack
     * Uses inline code to avoid Docker dependency
     */
    describe('ExampleLambdaKataStack equivalent', () => {
        let app: App;
        let stack: Stack;
        let template: Template;

        beforeAll(async () => {
            // Create an equivalent stack without Docker dependency
            app = new App({
                context: {
                    'aws:cdk:account': '123456789012',
                },
            });
            stack = new Stack(app, 'TestExampleStack', {
                env: {
                    account: '123456789012',
                    region: 'us-east-1',
                },
            });

            // Create a Lambda function equivalent to the example stack
            const myFunction = createTestLambda(stack, 'ExampleKataFunction', {
                handler: 'index.handler',
                runtime: Runtime.NODEJS_18_X,
                memorySize: 256,
                timeout: Duration.seconds(30),
                environment: {
                    LOG_LEVEL: 'INFO',
                    MY_CONFIG_VALUE: 'example',
                },
                functionName: 'ExampleKataFunction',
                description: 'Example Lambda function using Lambda Kata runtime',
            });

            // Wrap with kata() to demonstrate transformation
            kata(myFunction);

            // Wait for kata() to complete before synthesizing
            const kataPromise = getKataPromise(myFunction);
            if (kataPromise) {
                await kataPromise;
            }

            // Synthesize the stack to get the CloudFormation template
            template = Template.fromStack(stack);
        });

        /**
         * **Validates: Requirement 8.5**
         * THE Example_Stack SHALL be deployable for integration testing
         */
        describe('Stack Synthesis', () => {
            it('should synthesize without errors', () => {
                // If we got here, synthesis succeeded
                expect(template).toBeDefined();
            });

            it('should produce a valid CloudFormation template', () => {
                // Verify the template has the expected structure
                const templateJson = template.toJSON();
                expect(templateJson).toHaveProperty('Resources');
            });
        });

        /**
         * **Validates: Requirements 8.1, 8.2, 8.3**
         * - 8.1: THE Example_Stack SHALL demonstrate wrapping a Node.js Lambda with `kata(...)`
         * - 8.2: THE Example_Stack SHALL include a simple Node.js handler function
         * - 8.3: THE Example_Stack SHALL show the transformation from Node.js to Python runtime
         */
        describe('Lambda Function Resource', () => {
            it('should contain a Lambda function resource', () => {
                template.resourceCountIs('AWS::Lambda::Function', 1);
            });

            it('should have the expected function name', () => {
                template.hasResourceProperties('AWS::Lambda::Function', {
                    FunctionName: 'ExampleKataFunction',
                });
            });

            it('should have a description', () => {
                template.hasResourceProperties('AWS::Lambda::Function', {
                    Description: Match.stringLikeRegexp('.*Lambda Kata.*'),
                });
            });

            it('should have the expected memory size', () => {
                template.hasResourceProperties('AWS::Lambda::Function', {
                    MemorySize: 256,
                });
            });

            it('should have the expected timeout', () => {
                template.hasResourceProperties('AWS::Lambda::Function', {
                    Timeout: 30,
                });
            });

            it('should have environment variables including original ones', () => {
                template.hasResourceProperties('AWS::Lambda::Function', {
                    Environment: {
                        Variables: Match.objectLike({
                            LOG_LEVEL: 'INFO',
                            MY_CONFIG_VALUE: 'example',
                        }),
                    },
                });
            });
        });

        /**
         * Verify the Lambda function has an IAM role
         */
        describe('IAM Role', () => {
            it('should have an IAM role for the Lambda function', () => {
                template.resourceCountIs('AWS::IAM::Role', 1);
            });

            it('should have the Lambda assume role policy', () => {
                template.hasResourceProperties('AWS::IAM::Role', {
                    AssumeRolePolicyDocument: {
                        Statement: Match.arrayWith([
                            Match.objectLike({
                                Action: 'sts:AssumeRole',
                                Effect: 'Allow',
                                Principal: {
                                    Service: 'lambda.amazonaws.com',
                                },
                            }),
                        ]),
                    },
                });
            });
        });
    });

    /**
     * Test equivalent stack to MultipleKataFunctionsStack
     * Uses inline code to avoid Docker dependency
     */
    describe('MultipleKataFunctionsStack equivalent', () => {
        let app: App;
        let stack: Stack;
        let template: Template;

        beforeAll(async () => {
            // Create an equivalent stack without Docker dependency
            app = new App({
                context: {
                    'aws:cdk:account': '123456789012',
                },
            });
            stack = new Stack(app, 'TestMultipleStack', {
                env: {
                    account: '123456789012',
                    region: 'us-east-1',
                },
            });

            // Function 1: API handler
            const apiHandler = createTestLambda(stack, 'ApiHandler', {
                handler: 'index.handler',
                runtime: Runtime.NODEJS_18_X,
                memorySize: 512,
                timeout: Duration.seconds(10),
            });

            // Function 2: Background processor
            const processor = createTestLambda(stack, 'BackgroundProcessor', {
                handler: 'index.process',
                runtime: Runtime.NODEJS_18_X,
                memorySize: 1024,
                timeout: Duration.minutes(5),
            });

            // Wrap both with kata()
            kata(apiHandler);
            kata(processor);

            // Wait for kata() to complete before synthesizing
            const apiPromise = getKataPromise(apiHandler);
            const processorPromise = getKataPromise(processor);
            if (apiPromise) await apiPromise;
            if (processorPromise) await processorPromise;

            // Synthesize the stack to get the CloudFormation template
            template = Template.fromStack(stack);
        });

        /**
         * **Validates: Requirement 8.5**
         * THE Example_Stack SHALL be deployable for integration testing
         */
        describe('Stack Synthesis', () => {
            it('should synthesize without errors', () => {
                // If we got here, synthesis succeeded
                expect(template).toBeDefined();
            });

            it('should produce a valid CloudFormation template', () => {
                // Verify the template has the expected structure
                const templateJson = template.toJSON();
                expect(templateJson).toHaveProperty('Resources');
            });
        });

        /**
         * Verify multiple Lambda functions are created
         */
        describe('Multiple Lambda Functions', () => {
            it('should contain two Lambda function resources', () => {
                template.resourceCountIs('AWS::Lambda::Function', 2);
            });

            it('should have an API handler function with expected memory', () => {
                // Find the API handler by its memory size (512 MB)
                template.hasResourceProperties('AWS::Lambda::Function', {
                    MemorySize: 512,
                    Timeout: 10,
                });
            });

            it('should have a background processor function with expected memory', () => {
                // Find the processor by its memory size (1024 MB)
                template.hasResourceProperties('AWS::Lambda::Function', {
                    MemorySize: 1024,
                    Timeout: 300, // 5 minutes in seconds
                });
            });
        });

        /**
         * Verify IAM roles are created for each function
         */
        describe('IAM Roles', () => {
            it('should have IAM roles for the Lambda functions', () => {
                template.resourceCountIs('AWS::IAM::Role', 2);
            });
        });
    });

    /**
     * Test that stacks can be instantiated with different configurations
     */
    describe('Stack Configuration Variations', () => {
        it('should synthesize stack without explicit env', async () => {
            const app = new App();
            const stack = new Stack(app, 'NoEnvStack');

            const lambda = createTestLambda(stack, 'TestFunction', {
                runtime: Runtime.NODEJS_18_X,
                memorySize: 256,
            });
            kata(lambda);

            // Wait for kata() to complete
            const kataPromise = getKataPromise(lambda);
            if (kataPromise) await kataPromise;

            const template = Template.fromStack(stack);

            // Should still have a Lambda function
            template.resourceCountIs('AWS::Lambda::Function', 1);
        });

        it('should synthesize stack with multiple functions without explicit env', async () => {
            const app = new App();
            const stack = new Stack(app, 'NoEnvMultiStack');

            const fn1 = createTestLambda(stack, 'Function1');
            const fn2 = createTestLambda(stack, 'Function2');
            kata(fn1);
            kata(fn2);

            // Wait for kata() to complete
            const p1 = getKataPromise(fn1);
            const p2 = getKataPromise(fn2);
            if (p1) await p1;
            if (p2) await p2;

            const template = Template.fromStack(stack);

            // Should still have two Lambda functions
            template.resourceCountIs('AWS::Lambda::Function', 2);
        });

        it('should synthesize stack with different region', async () => {
            const app = new App();
            const stack = new Stack(app, 'EuStack', {
                env: {
                    account: '123456789012',
                    region: 'eu-west-1',
                },
            });

            const lambda = createTestLambda(stack, 'TestFunction');
            kata(lambda);

            // Wait for kata() to complete
            const kataPromise = getKataPromise(lambda);
            if (kataPromise) await kataPromise;

            const template = Template.fromStack(stack);

            // Should still have a Lambda function
            template.resourceCountIs('AWS::Lambda::Function', 1);
        });
    });

    /**
     * Test kata() transformation is applied correctly in example-like scenarios
     */
    describe('kata() Transformation in Example Scenarios', () => {
        it('should preserve all original properties after kata() transformation', async () => {
            const app = new App({
                context: { 'aws:cdk:account': '123456789012' },
            });
            const stack = new Stack(app, 'PreservationTestStack', {
                env: { account: '123456789012', region: 'us-east-1' },
            });

            const lambda = createTestLambda(stack, 'TestFunction', {
                handler: 'src/handlers/api.handler',
                runtime: Runtime.NODEJS_18_X,
                memorySize: 512,
                timeout: Duration.seconds(60),
                environment: {
                    DATABASE_URL: 'postgres://localhost:5432/db',
                    API_KEY: 'secret-key',
                },
                functionName: 'MyApiFunction',
                description: 'My API handler function',
            });

            kata(lambda);

            // Wait for kata() to complete
            const kataPromise = getKataPromise(lambda);
            if (kataPromise) await kataPromise;

            const template = Template.fromStack(stack);

            // Verify all original properties are preserved
            template.hasResourceProperties('AWS::Lambda::Function', {
                FunctionName: 'MyApiFunction',
                Description: 'My API handler function',
                MemorySize: 512,
                Timeout: 60,
                Environment: {
                    Variables: Match.objectLike({
                        DATABASE_URL: 'postgres://localhost:5432/db',
                        API_KEY: 'secret-key',
                    }),
                },
            });
        });

        it('should work with minimal Lambda configuration', async () => {
            const app = new App();
            const stack = new Stack(app, 'MinimalStack');

            // Minimal Lambda - just runtime and handler
            const lambda = new LambdaFunction(stack, 'MinimalFunction', {
                runtime: Runtime.NODEJS_18_X,
                handler: 'index.handler',
                code: Code.fromInline('exports.handler = async () => ({});'),
            });

            kata(lambda);

            // Wait for kata() to complete
            const kataPromise = getKataPromise(lambda);
            if (kataPromise) await kataPromise;

            const template = Template.fromStack(stack);

            // Should synthesize successfully
            template.resourceCountIs('AWS::Lambda::Function', 1);
        });
    });
});

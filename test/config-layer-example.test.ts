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
 * Integration Tests for Config Layer Example Stack
 *
 * These tests verify that the ConfigLayerExampleStack correctly demonstrates
 * the config layer approach where the original handler path is stored in a
 * Lambda Layer at /opt/.kata/original_handler.json instead of the
 * JS_HANDLER_PATH environment variable.
 *
 * **Validates: Requirements 7.3, 7.4**
 * - 7.3: THE Example_Stack SHALL be deployable and testable end-to-end
 * - 7.4: THE Example_Stack SHALL include verification that the handler path
 *        is correctly resolved from the config Layer
 *
 * @module config-layer-example.test
 */

import { App, Stack, Duration } from 'aws-cdk-lib';
import { Function as LambdaFunction, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Template, Match } from 'aws-cdk-lib/assertions';

import { kataWithAccountId } from '../src/kata-wrapper';
import { MockLicensingService } from '../src/mock-licensing';

/**
 * Helper to create a test Lambda function (without Docker dependency)
 * This mimics the ConfigLayerExampleStack's Lambda but uses inline code
 * to avoid Docker bundling requirements during testing.
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

/**
 * Helper to create a mock licensing service with an entitled account
 */
function createEntitledMockLicensing(accountId: string): MockLicensingService {
    const mockLicensing = new MockLicensingService();
    const layerArn = `arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1`;
    mockLicensing.setEntitled(accountId, layerArn);
    return mockLicensing;
}

describe('Config Layer Example Stack Integration Tests', () => {
    /**
     * Test equivalent stack to ConfigLayerExampleStack
     * Uses inline code to avoid Docker dependency while validating
     * the config layer approach.
     *
     * **Validates: Requirement 7.3**
     * THE Example_Stack SHALL be deployable and testable end-to-end
     */
    describe('ConfigLayerExampleStack equivalent', () => {
        let app: App;
        let stack: Stack;
        let template: Template;
        const accountId = '123456789012';

        beforeAll(async () => {
            // Create an equivalent stack without Docker dependency
            app = new App({
                context: {
                    'aws:cdk:account': accountId,
                },
            });
            stack = new Stack(app, 'TestConfigLayerExampleStack', {
                env: {
                    account: accountId,
                    region: 'us-east-1',
                },
            });

            // Create a Lambda function equivalent to the example stack
            // This mimics the ConfigLayerExampleStack's Lambda configuration
            const configLayerExample = createTestLambda(stack, 'ConfigLayerExampleFunction', {
                handler: 'handler',
                runtime: Runtime.NODEJS_18_X,
                memorySize: 256,
                timeout: Duration.seconds(30),
                functionName: 'ConfigLayerExampleFunction',
                description: 'Example Lambda demonstrating config layer approach (no JS_HANDLER_PATH)',
                environment: {
                    LOG_LEVEL: 'DEBUG',
                    EXAMPLE_CONFIG: 'config-layer-demo',
                },
            });

            // Use kataWithAccountId with mock licensing service for testing
            const mockLicensing = createEntitledMockLicensing(accountId);
            await kataWithAccountId(configLayerExample, accountId, 'us-east-1', {
                licensingService: mockLicensing,
            });

            // Synthesize the stack to get the CloudFormation template
            template = Template.fromStack(stack);
        });

        /**
         * **Validates: Requirement 7.3**
         * THE Example_Stack SHALL be deployable and testable end-to-end
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
         * **Validates: Requirement 7.4**
         * THE Example_Stack SHALL include verification that the handler path
         * is correctly resolved from the config Layer
         */
        describe('Config Layer Verification', () => {
            it('should have a config layer attached to the Lambda function', () => {
                // Verify that a Lambda Layer Version is created for the config
                template.hasResourceProperties('AWS::Lambda::LayerVersion', {
                    Description: Match.stringLikeRegexp('Lambda Kata config layer for handler:.*'),
                });
            });

            it('should have the config layer with correct handler path in description', () => {
                // The config layer description should contain the original handler path
                template.hasResourceProperties('AWS::Lambda::LayerVersion', {
                    Description: 'Lambda Kata config layer for handler: handler',
                });
            });

            it('should attach the config layer to the Lambda function', () => {
                // Verify the Lambda function has layers attached
                // Get the Lambda function and check it has layers
                const resources = template.findResources('AWS::Lambda::Function');
                const functionResource = Object.values(resources)[0];
                const layers = functionResource.Properties?.Layers;

                // Should have layers array with at least one entry
                expect(layers).toBeDefined();
                expect(Array.isArray(layers)).toBe(true);
                expect(layers.length).toBeGreaterThanOrEqual(1);
            });
        });

        /**
         * **Validates: Requirement 7.2 (from requirements.md)**
         * THE Example_Stack SHALL NOT use the `JS_HANDLER_PATH` environment variable
         */
        describe('JS_HANDLER_PATH Environment Variable NOT Set', () => {
            it('should NOT have JS_HANDLER_PATH environment variable', () => {
                // Get all Lambda function resources
                const resources = template.findResources('AWS::Lambda::Function');
                const functionResource = Object.values(resources)[0];
                const envVars = functionResource.Properties?.Environment?.Variables || {};

                // Verify JS_HANDLER_PATH is NOT set
                expect(envVars).not.toHaveProperty('JS_HANDLER_PATH');
            });

            it('should NOT have Lambda Kata environment variables set (all config in layer)', () => {
                // Verify JS_BUNDLE_PATH is NOT set (bundle path is in config layer)
                const resources = template.findResources('AWS::Lambda::Function');
                const functionResource = Object.values(resources)[0];
                const envVars = functionResource.Properties?.Environment?.Variables || {};
                expect(envVars).not.toHaveProperty('JS_BUNDLE_PATH');

                // Verify USE_CTYPES_BRIDGE is NOT set (ctypes bridge is always used)
                expect(envVars).not.toHaveProperty('USE_CTYPES_BRIDGE');
            });

            it('should preserve original user environment variables', () => {
                // Verify original environment variables are preserved
                template.hasResourceProperties('AWS::Lambda::Function', {
                    Environment: {
                        Variables: Match.objectLike({
                            LOG_LEVEL: 'DEBUG',
                            EXAMPLE_CONFIG: 'config-layer-demo',
                        }),
                    },
                });
            });
        });

        /**
         * Verify Lambda Kata Layer is attached
         */
        describe('Lambda Kata Layer Attachment', () => {
            it('should have at least two layers attached (config + Lambda Kata)', () => {
                // The Lambda should have both the config layer and the Lambda Kata layer
                // Get the Lambda function and check it has at least 2 layers
                const resources = template.findResources('AWS::Lambda::Function');
                const functionResource = Object.values(resources)[0];
                const layers = functionResource.Properties?.Layers;

                // Should have at least 2 layers (config layer + Lambda Kata layer)
                expect(layers).toBeDefined();
                expect(Array.isArray(layers)).toBe(true);
                expect(layers.length).toBeGreaterThanOrEqual(2);
            });
        });

        /**
         * Verify Lambda function transformation
         */
        describe('Lambda Function Transformation', () => {
            it('should have runtime changed to Python 3.12', () => {
                template.hasResourceProperties('AWS::Lambda::Function', {
                    Runtime: 'python3.12',
                });
            });

            it('should have handler changed to Lambda Kata handler', () => {
                template.hasResourceProperties('AWS::Lambda::Function', {
                    Handler: 'lambdakata.optimized_handler.lambda_handler',
                });
            });

            it('should preserve the function name', () => {
                template.hasResourceProperties('AWS::Lambda::Function', {
                    FunctionName: 'ConfigLayerExampleFunction',
                });
            });

            it('should preserve memory size configuration', () => {
                template.hasResourceProperties('AWS::Lambda::Function', {
                    MemorySize: 256,
                });
            });

            it('should preserve timeout configuration', () => {
                template.hasResourceProperties('AWS::Lambda::Function', {
                    Timeout: 30,
                });
            });
        });
    });

    /**
     * Test that different handler paths produce different config layers
     *
     * **Validates: Requirement 3.5 (from requirements.md)**
     * THE Config_Layer SHALL be created as a unique asset per Lambda function
     * to support different handler paths
     */
    describe('Unique Config Layers for Different Handlers', () => {
        it('should create unique config layers for different handler paths', async () => {
            const accountId = '123456789012';
            const app = new App({
                context: {
                    'aws:cdk:account': accountId,
                },
            });
            const stack = new Stack(app, 'MultiHandlerStack', {
                env: {
                    account: accountId,
                    region: 'us-east-1',
                },
            });

            // Create two Lambda functions with different handlers
            const lambda1 = createTestLambda(stack, 'Function1', {
                handler: 'index.handler',
            });
            const lambda2 = createTestLambda(stack, 'Function2', {
                handler: 'api.processRequest',
            });

            // Use kataWithAccountId with mock licensing service
            const mockLicensing = createEntitledMockLicensing(accountId);
            await kataWithAccountId(lambda1, accountId, 'us-east-1', { licensingService: mockLicensing });
            await kataWithAccountId(lambda2, accountId, 'us-east-1', { licensingService: mockLicensing });

            const template = Template.fromStack(stack);

            // Verify two different config layers are created
            const layers = template.findResources('AWS::Lambda::LayerVersion');
            const layerDescriptions = Object.values(layers)
                .map((layer) => (layer as { Properties?: { Description?: string } }).Properties?.Description)
                .filter((desc) => desc?.includes('Lambda Kata config layer'));

            // Should have two config layers with different descriptions
            expect(layerDescriptions).toHaveLength(2);
            expect(layerDescriptions).toContain('Lambda Kata config layer for handler: index.handler');
            expect(layerDescriptions).toContain('Lambda Kata config layer for handler: api.processRequest');
        });
    });

    /**
     * Test that the example stack works without explicit environment
     */
    describe('Stack Without Explicit Environment', () => {
        it('should synthesize successfully without explicit env', async () => {
            const accountId = '123456789012';
            const app = new App();
            const stack = new Stack(app, 'NoEnvConfigLayerStack');

            const lambda = createTestLambda(stack, 'TestFunction', {
                handler: 'handler',
                runtime: Runtime.NODEJS_18_X,
                memorySize: 256,
            });

            // Use kataWithAccountId with mock licensing service
            const mockLicensing = createEntitledMockLicensing(accountId);
            await kataWithAccountId(lambda, accountId, 'us-east-1', { licensingService: mockLicensing });

            const template = Template.fromStack(stack);

            // Should still have a Lambda function
            template.resourceCountIs('AWS::Lambda::Function', 1);

            // Should NOT have JS_HANDLER_PATH
            const resources = template.findResources('AWS::Lambda::Function');
            const functionResource = Object.values(resources)[0];
            const envVars = functionResource.Properties?.Environment?.Variables || {};
            expect(envVars).not.toHaveProperty('JS_HANDLER_PATH');
        });
    });

    /**
     * Test that existing JS_HANDLER_PATH is not removed if already set
     *
     * **Validates: Requirement 4.3 (from requirements.md)**
     * IF a Lambda already has a `JS_HANDLER_PATH` environment variable,
     * THE kata_Wrapper SHALL NOT modify or remove it
     */
    describe('Existing JS_HANDLER_PATH Preservation', () => {
        it('should not remove existing JS_HANDLER_PATH if already set by user', async () => {
            const accountId = '123456789012';
            const app = new App({
                context: {
                    'aws:cdk:account': accountId,
                },
            });
            const stack = new Stack(app, 'ExistingEnvStack', {
                env: {
                    account: accountId,
                    region: 'us-east-1',
                },
            });

            // Create a Lambda with JS_HANDLER_PATH already set
            const lambda = createTestLambda(stack, 'TestFunction', {
                handler: 'index.handler',
                environment: {
                    JS_HANDLER_PATH: 'custom.handler', // User-set value
                    OTHER_VAR: 'other-value',
                },
            });

            // Use kataWithAccountId with mock licensing service
            const mockLicensing = createEntitledMockLicensing(accountId);
            await kataWithAccountId(lambda, accountId, 'us-east-1', { licensingService: mockLicensing });

            const template = Template.fromStack(stack);

            // The user-set JS_HANDLER_PATH should be preserved
            template.hasResourceProperties('AWS::Lambda::Function', {
                Environment: {
                    Variables: Match.objectLike({
                        JS_HANDLER_PATH: 'custom.handler',
                        OTHER_VAR: 'other-value',
                    }),
                },
            });
        });
    });

    /**
     * Test that Lambda invocation would succeed (verified by correct transformation)
     *
     * **Validates: Requirement 7.3**
     * THE Example_Stack SHALL be deployable and testable end-to-end
     */
    describe('Lambda Invocation Readiness', () => {
        it('should have all required components for successful invocation', async () => {
            const accountId = '123456789012';
            const app = new App({
                context: {
                    'aws:cdk:account': accountId,
                },
            });
            const stack = new Stack(app, 'InvocationReadyStack', {
                env: {
                    account: accountId,
                    region: 'us-east-1',
                },
            });

            const lambda = createTestLambda(stack, 'TestFunction', {
                handler: 'bundle.handler',
                runtime: Runtime.NODEJS_18_X,
            });

            const mockLicensing = createEntitledMockLicensing(accountId);
            await kataWithAccountId(lambda, accountId, 'us-east-1', { licensingService: mockLicensing });

            const template = Template.fromStack(stack);

            // Verify all components needed for successful invocation:
            // 1. Runtime is Python 3.12 (Lambda Kata runtime)
            template.hasResourceProperties('AWS::Lambda::Function', {
                Runtime: 'python3.12',
            });

            // 2. Handler is Lambda Kata handler
            template.hasResourceProperties('AWS::Lambda::Function', {
                Handler: 'lambdakata.optimized_handler.lambda_handler',
            });

            // 3. Config layer is attached (contains original handler path)
            template.hasResourceProperties('AWS::Lambda::LayerVersion', {
                Description: 'Lambda Kata config layer for handler: bundle.handler',
            });

            // 4. Lambda Kata layer is attached
            template.hasResourceProperties('AWS::Lambda::Function', {
                Layers: Match.arrayWith([
                    'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1',
                ]),
            });

            // 5. No Lambda Kata environment variables are set (all config in layer)
            const resources = template.findResources('AWS::Lambda::Function');
            const functionResource = Object.values(resources)[0];
            const envVars = functionResource.Properties?.Environment?.Variables || {};
            expect(envVars).not.toHaveProperty('JS_HANDLER_PATH');
            expect(envVars).not.toHaveProperty('JS_BUNDLE_PATH');
            expect(envVars).not.toHaveProperty('USE_CTYPES_BRIDGE');
        });
    });
});

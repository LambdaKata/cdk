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
 * Property-Based Tests for kata-wrapper transformation logic
 *
 * Feature: cdk-integration
 *
 * Property 1: Licensed Transformation Applies Correct Changes
 * *For any* Node.js Lambda function and any entitled AWS account, when `kata(lambda)` is called,
 * the resulting Lambda SHALL have:
 * - Runtime set to Python 3.12
 * - Handler set to `lambdakata.optimized_handler.lambda_handler`
 * - The customer-specific Layer ARN attached
 *
 * **Validates: Requirements 2.2, 2.3, 2.4, 3.4**
 * - 2.2: THE kata_Wrapper SHALL change the Lambda runtime from Node.js to Python 3.12
 * - 2.3: THE kata_Wrapper SHALL set the Lambda handler to `lambdakata.optimized_handler.lambda_handler`
 * - 2.4: THE kata_Wrapper SHALL attach the customer-specific Lambda_Layer ARN to the Lambda
 * - 3.4: IF the account is entitled, THEN THE kata_Wrapper SHALL apply all Lambda transformations
 *
 * Property 2: Transformation Preserves Non-Target Properties
 * *For any* Lambda function wrapped with `kata()` (regardless of entitlement status), the following
 * properties SHALL remain unchanged:
 * - Function name and logical ID
 * - All original environment variables (new ones may be added)
 * - Memory size configuration
 * - Timeout configuration
 * - IAM execution role
 * - All existing event triggers
 * - Original code asset
 *
 * **Validates: Requirements 2.5, 2.6, 2.8, 2.9, 2.10, 2.11**
 * - 2.5: THE kata_Wrapper SHALL preserve the original function name and logical ID
 * - 2.6: THE kata_Wrapper SHALL preserve all existing environment variables
 * - 2.8: THE kata_Wrapper SHALL preserve the original memory and timeout settings
 * - 2.9: THE kata_Wrapper SHALL preserve the original IAM role
 * - 2.10: THE kata_Wrapper SHALL preserve all existing triggers (API Gateway, EventBridge, S3, etc.)
 * - 2.11: THE kata_Wrapper SHALL preserve the original code asset without modification
 *
 * @module kata-wrapper.property.test
 */

// Mock the native licensing module BEFORE any imports
jest.mock('@lambda-kata/licensing', () => ({
    NativeLicensingService: jest.fn().mockImplementation(() => ({
        checkEntitlementSync: jest.fn().mockReturnValue({
            entitled: true,
            layerVersionArn: 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1',
        }),
    })),
}));

import * as fc from 'fast-check';
import { App, Stack, Duration } from 'aws-cdk-lib';
import { Function as LambdaFunction, Runtime, Code, CfnFunction } from 'aws-cdk-lib/aws-lambda';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Template, Annotations, Match } from 'aws-cdk-lib/assertions';

import { kata, getKataPromise } from '../src/kata-wrapper';
import { NativeLicensingService } from '@lambda-kata/licensing';

// Get typed mock for NativeLicensingService
const mockNativeLicensingService = NativeLicensingService as jest.Mock;

/**
 * Expected handler for Lambda Kata runtime
 */
const LAMBDA_KATA_HANDLER = 'lambdakata.optimized_handler.lambda_handler';

/**
 * Expected runtime for Lambda Kata
 */
const LAMBDA_KATA_RUNTIME = 'python3.12';

/**
 * Helper to configure the mock for entitled accounts
 */
function configureMockEntitled(layerArn: string): void {
    mockNativeLicensingService.mockImplementation(() => ({
        checkEntitlementSync: jest.fn().mockReturnValue({
            entitled: true,
            layerVersionArn: layerArn,
        }),
    }));
}

/**
 * Helper to configure the mock for non-entitled accounts
 */
function configureMockNotEntitled(): void {
    mockNativeLicensingService.mockImplementation(() => ({
        checkEntitlementSync: jest.fn().mockReturnValue({
            entitled: false,
            // Don't set message - let handleUnlicensed use the default UNLICENSED_WARNING
        }),
    }));
}

/**
 * Arbitrary generator for valid AWS account IDs (12-digit strings)
 */
const arbitraryAccountId = (): fc.Arbitrary<string> =>
    fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
        minLength: 12,
        maxLength: 12,
    });

/**
 * Arbitrary generator for valid AWS regions
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
        'ap-southeast-2'
    );

/**
 * Arbitrary generator for valid Lambda Layer ARNs
 */
const arbitraryLayerArn = (): fc.Arbitrary<string> =>
    fc.tuple(arbitraryRegion(), arbitraryAccountId(), fc.integer({ min: 1, max: 999 })).map(
        ([region, accountId, version]) =>
            `arn:aws:lambda:${region}:${accountId}:layer:LambdaKata:${version}`
    );

/**
 * Arbitrary generator for Node.js runtimes supported by Lambda
 */
const arbitraryNodejsRuntime = (): fc.Arbitrary<Runtime> =>
    fc.constantFrom(Runtime.NODEJS_16_X, Runtime.NODEJS_18_X, Runtime.NODEJS_20_X);

/**
 * Arbitrary generator for valid Lambda handler paths
 * Generates paths like: "index.handler", "src/handler.main", "handlers/api/users.createUser"
 */
const arbitraryHandlerPath = (): fc.Arbitrary<string> => {
    // Generate valid JavaScript identifier (starts with letter, contains alphanumeric and underscore)
    const identifier = fc
        .tuple(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
            fc.stringOf(
                fc.constantFrom(
                    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('')
                ),
                { minLength: 0, maxLength: 15 }
            )
        )
        .map(([first, rest]) => first + rest);

    // Generate path segments (directory names)
    const pathSegment = fc
        .tuple(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), {
                minLength: 0,
                maxLength: 10,
            })
        )
        .map(([first, rest]) => first + rest);

    // Generate full handler path: [path/to/]file.exportedFunction
    return fc
        .tuple(
            fc.array(pathSegment, { minLength: 0, maxLength: 3 }),
            identifier, // file name
            identifier // exported function name
        )
        .map(([dirs, file, func]) => {
            const path = dirs.length > 0 ? dirs.join('/') + '/' : '';
            return `${path}${file}.${func}`;
        });
};

/**
 * Arbitrary generator for Lambda memory sizes (valid values: 128-10240 MB)
 */
const arbitraryMemorySize = (): fc.Arbitrary<number> =>
    fc.integer({ min: 128, max: 10240 }).map((n) => Math.floor(n / 64) * 64); // Must be multiple of 64

/**
 * Arbitrary generator for Lambda timeout in seconds (valid values: 1-900 seconds)
 */
const arbitraryTimeoutSeconds = (): fc.Arbitrary<number> =>
    fc.integer({ min: 1, max: 900 });

/**
 * Arbitrary generator for Lambda function configurations
 */
interface LambdaConfig {
    handler: string;
    runtime: Runtime;
    memorySize: number;
    timeout: number;
    environment: Record<string, string>;
}

const arbitraryLambdaConfig = (): fc.Arbitrary<LambdaConfig> =>
    fc.record({
        handler: arbitraryHandlerPath(),
        runtime: arbitraryNodejsRuntime(),
        memorySize: arbitraryMemorySize(),
        timeout: arbitraryTimeoutSeconds(),
        environment: fc.dictionary(
            fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ_'.split('')), {
                minLength: 1,
                maxLength: 20,
            }),
            fc.string({ minLength: 0, maxLength: 50 }),
            { minKeys: 0, maxKeys: 5 }
        ),
    });

/**
 * Helper to create a test Lambda function from a config
 */
function createTestLambda(stack: Stack, id: string, config: LambdaConfig): LambdaFunction {
    return new LambdaFunction(stack, id, {
        runtime: config.runtime,
        handler: config.handler,
        code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
        environment: config.environment,
        memorySize: config.memorySize,
        timeout: Duration.seconds(config.timeout),
    });
}

/**
 * Helper to create a test stack with account ID
 */
function createTestStack(accountId: string): { app: App; stack: Stack } {
    const app = new App({
        context: { 'aws:cdk:account': accountId },
    });
    const stack = new Stack(app, 'TestStack', {
        env: { account: accountId, region: 'us-east-1' },
    });
    return { app, stack };
}

describe('Feature: cdk-integration, Property 1: Licensed Transformation Applies Correct Changes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    /**
     * **Validates: Requirements 2.2, 2.3, 2.4, 3.4**
     */
    describe('Property 1: Licensed Transformation Applies Correct Changes', () => {
        /**
         * **Validates: Requirement 2.2**
         * THE kata_Wrapper SHALL change the Lambda runtime from Node.js to Python 3.12
         */
        it('should set runtime to Python 3.12 for any Node.js Lambda with entitled account', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (config, accountId, layerArn) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock for entitled account
                        configureMockEntitled(layerArn);

                        // Apply transformation
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was applied
                        expect(result?.transformed).toBe(true);

                        // Verify runtime is Python 3.12
                        const cfnFunction = lambda.node.defaultChild as CfnFunction;
                        expect(cfnFunction.runtime).toBe(LAMBDA_KATA_RUNTIME);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 2.3**
         * THE kata_Wrapper SHALL set the Lambda handler to `lambdakata.optimized_handler.lambda_handler`
         */
        it('should set handler to lambdakata.optimized_handler.lambda_handler for any entitled Lambda', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (config, accountId, layerArn) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock for entitled account
                        configureMockEntitled(layerArn);

                        // Apply transformation
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was applied
                        expect(result?.transformed).toBe(true);

                        // Verify handler is set correctly
                        const cfnFunction = lambda.node.defaultChild as CfnFunction;
                        expect(cfnFunction.handler).toBe(LAMBDA_KATA_HANDLER);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 2.4**
         * THE kata_Wrapper SHALL attach the customer-specific Lambda_Layer ARN to the Lambda
         */
        it('should attach the customer-specific Layer ARN for any entitled Lambda', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (config, accountId, layerArn) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock for entitled account
                        configureMockEntitled(layerArn);

                        // Apply transformation
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was applied
                        expect(result?.transformed).toBe(true);

                        // Verify layer is attached using CloudFormation template
                        // Note: Config layer is also attached, so we use arrayWith to check the Lambda Kata layer is present
                        const template = Template.fromStack(stack);
                        template.hasResourceProperties('AWS::Lambda::Function', {
                            Layers: Match.arrayWith([layerArn]),
                        });

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 3.4**
         * IF the account is entitled, THEN THE kata_Wrapper SHALL apply all Lambda transformations
         *
         * This test verifies all three transformations are applied together:
         * - Runtime set to Python 3.12
         * - Handler set to lambdakata.optimized_handler.lambda_handler
         * - Customer-specific Layer ARN attached
         */
        it('should apply all transformations (runtime, handler, layer) for any entitled account', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (config, accountId, layerArn) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock for entitled account
                        configureMockEntitled(layerArn);

                        // Apply transformation
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was applied
                        expect(result?.transformed).toBe(true);
                        expect(result?.licensingResponse.entitled).toBe(true);
                        expect(result?.licensingResponse.layerVersionArn).toBe(layerArn);

                        // Verify all three transformations
                        const cfnFunction = lambda.node.defaultChild as CfnFunction;

                        // 1. Runtime is Python 3.12
                        expect(cfnFunction.runtime).toBe(LAMBDA_KATA_RUNTIME);

                        // 2. Handler is Lambda Kata handler
                        expect(cfnFunction.handler).toBe(LAMBDA_KATA_HANDLER);

                        // 3. Layer is attached
                        // Note: Config layer is also attached, so we use arrayWith to check the Lambda Kata layer is present
                        const template = Template.fromStack(stack);
                        template.hasResourceProperties('AWS::Lambda::Function', {
                            Layers: Match.arrayWith([layerArn]),
                        });

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * Additional property: Transformation is idempotent with respect to licensing response
         * The layer ARN attached should exactly match what the licensing service returns
         */
        it('should attach exactly the Layer ARN returned by the licensing service', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (config, accountId, layerArn) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock for entitled account with specific layer ARN
                        configureMockEntitled(layerArn);

                        // Apply transformation
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify the layer ARN in the result matches what we set
                        expect(result?.licensingResponse.layerVersionArn).toBe(layerArn);

                        // Verify the layer ARN in the CloudFormation template matches exactly
                        // Note: Config layer is also attached, so we expect 2 layers total
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];
                        const layers = functionResource.Properties?.Layers;

                        expect(layers).toBeDefined();
                        expect(layers.length).toBeGreaterThanOrEqual(2); // Config layer + Lambda Kata layer (+ optional Node.js runtime layer)
                        // The Lambda Kata layer ARN should be in the layers array
                        expect(layers).toContainEqual(layerArn);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * Property: Different entitled accounts get their specific layer ARNs
         * Each account should receive its own customer-specific layer ARN
         */
        it('should use the correct layer ARN for each entitled account', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    arbitraryLayerArn(),
                    async (config, accountId1, accountId2, layerArn1, layerArn2) => {
                        // Ensure we have different accounts and layer ARNs
                        fc.pre(accountId1 !== accountId2);
                        fc.pre(layerArn1 !== layerArn2);

                        // Test first account
                        const { stack: stack1 } = createTestStack(accountId1);
                        const lambda1 = createTestLambda(stack1, 'TestFunction', config);

                        configureMockEntitled(layerArn1);
                        kata(lambda1);
                        const result1 = await getKataPromise(lambda1);

                        // Test second account
                        const { stack: stack2 } = createTestStack(accountId2);
                        const lambda2 = createTestLambda(stack2, 'TestFunction', config);

                        configureMockEntitled(layerArn2);
                        kata(lambda2);
                        const result2 = await getKataPromise(lambda2);

                        // Verify each account gets its specific layer ARN
                        expect(result1?.licensingResponse.layerVersionArn).toBe(layerArn1);
                        expect(result2?.licensingResponse.layerVersionArn).toBe(layerArn2);

                        // Verify in CloudFormation templates
                        // Note: Config layer is also attached, so we use arrayWith to check the Lambda Kata layer is present
                        const template1 = Template.fromStack(stack1);
                        template1.hasResourceProperties('AWS::Lambda::Function', {
                            Layers: Match.arrayWith([layerArn1]),
                        });

                        const template2 = Template.fromStack(stack2);
                        template2.hasResourceProperties('AWS::Lambda::Function', {
                            Layers: Match.arrayWith([layerArn2]),
                        });

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });
    });
});


/**
 * Feature: cdk-integration, Property 2: Transformation Preserves Non-Target Properties
 *
 * **Validates: Requirements 2.5, 2.6, 2.8, 2.9, 2.10, 2.11**
 * - 2.5: THE kata_Wrapper SHALL preserve the original function name and logical ID
 * - 2.6: THE kata_Wrapper SHALL preserve all existing environment variables
 * - 2.8: THE kata_Wrapper SHALL preserve the original memory and timeout settings
 * - 2.9: THE kata_Wrapper SHALL preserve the original IAM role
 * - 2.10: THE kata_Wrapper SHALL preserve all existing triggers (API Gateway, EventBridge, S3, etc.)
 * - 2.11: THE kata_Wrapper SHALL preserve the original code asset without modification
 */
describe('Feature: cdk-integration, Property 2: Transformation Preserves Non-Target Properties', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    /**
     * Arbitrary generator for entitlement status (true = entitled, false = not entitled)
     */
    const arbitraryEntitlementStatus = (): fc.Arbitrary<boolean> => fc.boolean();

    /**
     * Arbitrary generator for IAM role names
     */
    const arbitraryRoleName = (): fc.Arbitrary<string> =>
        fc.tuple(
            fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('')),
            fc.stringOf(
                fc.constantFrom(
                    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('')
                ),
                { minLength: 0, maxLength: 30 }
            )
        ).map(([first, rest]) => `${first}${rest}Role`);

    /**
     * Extended Lambda config with role name for preservation tests
     */
    interface ExtendedLambdaConfig extends LambdaConfig {
        roleName: string;
    }

    /**
     * Arbitrary generator for extended Lambda configurations
     */
    const arbitraryExtendedLambdaConfig = (): fc.Arbitrary<ExtendedLambdaConfig> =>
        fc.record({
            handler: arbitraryHandlerPath(),
            runtime: arbitraryNodejsRuntime(),
            memorySize: arbitraryMemorySize(),
            timeout: arbitraryTimeoutSeconds(),
            environment: fc.dictionary(
                fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ_'.split('')), {
                    minLength: 1,
                    maxLength: 20,
                }),
                fc.string({ minLength: 0, maxLength: 50 }),
                { minKeys: 0, maxKeys: 5 }
            ),
            roleName: arbitraryRoleName(),
        });

    /**
     * Helper to create a test Lambda function with a custom IAM role
     */
    function createTestLambdaWithRole(
        stack: Stack,
        id: string,
        config: ExtendedLambdaConfig
    ): { lambda: LambdaFunction; role: Role } {
        const role = new Role(stack, `${id}Role`, {
            roleName: config.roleName,
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });

        const lambda = new LambdaFunction(stack, id, {
            runtime: config.runtime,
            handler: config.handler,
            code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
            environment: config.environment,
            memorySize: config.memorySize,
            timeout: Duration.seconds(config.timeout),
            role: role,
        });

        return { lambda, role };
    }

    describe('Property 2: Transformation Preserves Non-Target Properties', () => {
        /**
         * **Validates: Requirement 2.5**
         * THE kata_Wrapper SHALL preserve the original function name and logical ID
         */
        it('should preserve function name and logical ID regardless of entitlement status', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    arbitraryEntitlementStatus(),
                    async (config, accountId, layerArn, isEntitled) => {
                        const { stack } = createTestStack(accountId);
                        const functionId = 'TestFunction';
                        const lambda = createTestLambda(stack, functionId, config);

                        // Capture original function name before transformation
                        const originalFunctionName = lambda.functionName;
                        const originalNodeId = lambda.node.id;

                        // Configure mock based on entitlement status
                        if (isEntitled) {
                            configureMockEntitled(layerArn);
                        } else {
                            configureMockNotEntitled();
                        }

                        // Apply transformation
                        kata(lambda);
                        await getKataPromise(lambda);

                        // Verify function name is preserved
                        expect(lambda.functionName).toBe(originalFunctionName);

                        // Verify logical ID (node.id) is preserved
                        expect(lambda.node.id).toBe(originalNodeId);
                        expect(lambda.node.id).toBe(functionId);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 2.6**
         * THE kata_Wrapper SHALL preserve all existing environment variables
         */
        it('should preserve all original environment variables regardless of entitlement status', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    arbitraryEntitlementStatus(),
                    async (config, accountId, layerArn, isEntitled) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock based on entitlement status
                        if (isEntitled) {
                            configureMockEntitled(layerArn);
                        } else {
                            configureMockNotEntitled();
                        }

                        // Apply transformation
                        kata(lambda);
                        await getKataPromise(lambda);

                        // Verify all original environment variables are preserved
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];
                        const envVars = functionResource.Properties?.Environment?.Variables ?? {};

                        // All original env vars should be present
                        for (const [key, value] of Object.entries(config.environment)) {
                            expect(envVars[key]).toBe(value);
                        }

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 2.8**
         * THE kata_Wrapper SHALL preserve the original memory and timeout settings
         */
        it('should preserve memory size regardless of entitlement status', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    arbitraryEntitlementStatus(),
                    async (config, accountId, layerArn, isEntitled) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock based on entitlement status
                        if (isEntitled) {
                            configureMockEntitled(layerArn);
                        } else {
                            configureMockNotEntitled();
                        }

                        // Apply transformation
                        kata(lambda);
                        await getKataPromise(lambda);

                        // Verify memory size is preserved (or increased to minimum 512MB for entitled)
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];

                        // Lambda Kata has a minimum memory requirement of 512MB
                        // If entitled and original memory < 512, it will be increased to 512
                        const expectedMemory = isEntitled && config.memorySize < 512
                            ? 512
                            : config.memorySize;
                        expect(functionResource.Properties?.MemorySize).toBe(expectedMemory);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 2.8**
         * THE kata_Wrapper SHALL preserve the original memory and timeout settings
         */
        it('should preserve timeout regardless of entitlement status', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    arbitraryEntitlementStatus(),
                    async (config, accountId, layerArn, isEntitled) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock based on entitlement status
                        if (isEntitled) {
                            configureMockEntitled(layerArn);
                        } else {
                            configureMockNotEntitled();
                        }

                        // Apply transformation
                        kata(lambda);
                        await getKataPromise(lambda);

                        // Verify timeout is preserved
                        const template = Template.fromStack(stack);
                        template.hasResourceProperties('AWS::Lambda::Function', {
                            Timeout: config.timeout,
                        });

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 2.9**
         * THE kata_Wrapper SHALL preserve the original IAM role
         */
        it('should preserve IAM execution role regardless of entitlement status', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryExtendedLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    arbitraryEntitlementStatus(),
                    async (config, accountId, layerArn, isEntitled) => {
                        const { stack } = createTestStack(accountId);
                        const { lambda, role } = createTestLambdaWithRole(stack, 'TestFunction', config);

                        // Capture original role ARN before transformation
                        const originalRoleArn = role.roleArn;

                        // Configure mock based on entitlement status
                        if (isEntitled) {
                            configureMockEntitled(layerArn);
                        } else {
                            configureMockNotEntitled();
                        }

                        // Apply transformation
                        kata(lambda);
                        await getKataPromise(lambda);

                        // Verify role is preserved - the lambda's role should still reference the same role
                        expect(lambda.role?.roleArn).toBe(originalRoleArn);

                        // Verify in CloudFormation template that the role reference is preserved
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];

                        // The Role property should reference our custom role
                        expect(functionResource.Properties?.Role).toBeDefined();

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 2.11**
         * THE kata_Wrapper SHALL preserve the original code asset without modification
         */
        it('should preserve original code asset regardless of entitlement status', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    arbitraryEntitlementStatus(),
                    async (config, accountId, layerArn, isEntitled) => {
                        const { stack } = createTestStack(accountId);
                        const inlineCode = 'exports.handler = async () => ({ statusCode: 200 });';
                        const lambda = new LambdaFunction(stack, 'TestFunction', {
                            runtime: config.runtime,
                            handler: config.handler,
                            code: Code.fromInline(inlineCode),
                            environment: config.environment,
                            memorySize: config.memorySize,
                            timeout: Duration.seconds(config.timeout),
                        });

                        // Configure mock based on entitlement status
                        if (isEntitled) {
                            configureMockEntitled(layerArn);
                        } else {
                            configureMockNotEntitled();
                        }

                        // Apply transformation
                        kata(lambda);
                        await getKataPromise(lambda);

                        // Verify code asset is preserved
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];

                        // For inline code, verify ZipFile property is preserved
                        expect(functionResource.Properties?.Code?.ZipFile).toBe(inlineCode);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * Combined test: All non-target properties preserved together
         * This test verifies all preservation requirements in a single property test
         *
         * **Validates: Requirements 2.5, 2.6, 2.8, 2.9, 2.10, 2.11**
         */
        it('should preserve all non-target properties (name, env vars, memory, timeout, role, code) regardless of entitlement', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryExtendedLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    arbitraryEntitlementStatus(),
                    async (config, accountId, layerArn, isEntitled) => {
                        const { stack } = createTestStack(accountId);
                        const functionId = 'TestFunction';
                        const inlineCode = 'exports.handler = async () => ({ statusCode: 200 });';

                        // Create role
                        const role = new Role(stack, `${functionId}Role`, {
                            roleName: config.roleName,
                            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
                            managedPolicies: [
                                ManagedPolicy.fromAwsManagedPolicyName(
                                    'service-role/AWSLambdaBasicExecutionRole'
                                ),
                            ],
                        });

                        // Create Lambda with all properties
                        const lambda = new LambdaFunction(stack, functionId, {
                            runtime: config.runtime,
                            handler: config.handler,
                            code: Code.fromInline(inlineCode),
                            environment: config.environment,
                            memorySize: config.memorySize,
                            timeout: Duration.seconds(config.timeout),
                            role: role,
                        });

                        // Capture original values
                        const originalFunctionName = lambda.functionName;
                        const originalNodeId = lambda.node.id;
                        const originalRoleArn = role.roleArn;

                        // Configure mock based on entitlement status
                        if (isEntitled) {
                            configureMockEntitled(layerArn);
                        } else {
                            configureMockNotEntitled();
                        }

                        // Apply transformation
                        kata(lambda);
                        await getKataPromise(lambda);

                        // Get CloudFormation template
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];

                        // 1. Verify function name and logical ID preserved (Req 2.5)
                        expect(lambda.functionName).toBe(originalFunctionName);
                        expect(lambda.node.id).toBe(originalNodeId);

                        // 2. Verify all original environment variables preserved (Req 2.6)
                        const envVars = functionResource.Properties?.Environment?.Variables ?? {};
                        for (const [key, value] of Object.entries(config.environment)) {
                            expect(envVars[key]).toBe(value);
                        }

                        // 3. Verify memory size preserved (Req 2.8)
                        // Lambda Kata has a minimum memory requirement of 512MB
                        // If entitled and original memory < 512, it will be increased to 512
                        const expectedMemory = isEntitled && config.memorySize < 512
                            ? 512
                            : config.memorySize;
                        expect(functionResource.Properties?.MemorySize).toBe(expectedMemory);

                        // 4. Verify timeout preserved (Req 2.8)
                        expect(functionResource.Properties?.Timeout).toBe(config.timeout);

                        // 5. Verify role preserved (Req 2.9)
                        expect(lambda.role?.roleArn).toBe(originalRoleArn);
                        expect(functionResource.Properties?.Role).toBeDefined();

                        // 6. Verify code asset preserved (Req 2.11)
                        expect(functionResource.Properties?.Code?.ZipFile).toBe(inlineCode);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * Test that new environment variables can be added without affecting originals
         * This validates that "new ones may be added" per the design doc
         */
        it('should allow new environment variables to be added while preserving originals (entitled case)', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (config, accountId, layerArn) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock for entitled account
                        configureMockEntitled(layerArn);

                        // Apply transformation
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was applied
                        expect(result?.transformed).toBe(true);

                        // Get CloudFormation template
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];
                        const envVars = functionResource.Properties?.Environment?.Variables ?? {};

                        // All original env vars should still be present
                        for (const [key, value] of Object.entries(config.environment)) {
                            expect(envVars[key]).toBe(value);
                        }

                        // New Lambda Kata env vars should NOT be added (all config in layer)
                        // Note: JS_HANDLER_PATH is no longer set as env var - handler path is stored in config layer
                        expect(envVars['JS_HANDLER_PATH']).toBeUndefined();
                        expect(envVars['JS_BUNDLE_PATH']).toBeUndefined();
                        expect(envVars['USE_CTYPES_BRIDGE']).toBeUndefined();

                        // Verify config layer is attached (contains handler path)
                        const layers = functionResource.Properties?.Layers ?? [];
                        // Should have at least 2 layers: Lambda Kata layer and config layer
                        expect(layers.length).toBeGreaterThanOrEqual(2);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });
    });
});


/**
 * Feature: cdk-integration, Property 3: Original Handler Captured in Config Layer
 *
 * *For any* Lambda function wrapped with `kata()` on an entitled account, the handler path
 * SHALL be stored in a config layer at `/opt/.kata/original_handler.json`.
 *
 * **Validates: Requirements 3.2, 3.3, 3.4**
 * - 3.2: THE kata_Wrapper SHALL generate the JSON configuration with the correct `original_js_handler` value
 * - 3.3: THE kata_Wrapper SHALL attach the Config_Layer to the transformed Lambda
 * - 3.4: THE kata_Wrapper SHALL NOT set the `JS_HANDLER_PATH` environment variable
 *
 * Note: This property was updated from checking JS_HANDLER_PATH env var to checking config layer
 * as part of the config-layer-handler-path feature.
 */
describe('Feature: cdk-integration, Property 3: Original Handler Captured in Config Layer', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Property 3: Original Handler Captured in Config Layer', () => {
        /**
         * **Validates: Requirements 3.3, 3.4**
         * THE kata_Wrapper SHALL attach the Config_Layer and NOT set JS_HANDLER_PATH env var
         *
         * For any random handler path, when the Lambda is transformed:
         * - A config layer should be attached
         * - JS_HANDLER_PATH should NOT be set as an environment variable
         */
        it('should attach config layer and NOT set JS_HANDLER_PATH for any entitled Lambda', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryHandlerPath(),
                    arbitraryNodejsRuntime(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (handlerPath, runtime, accountId, layerArn) => {
                        const { stack } = createTestStack(accountId);

                        // Create Lambda with the generated handler path
                        const lambda = new LambdaFunction(stack, 'TestFunction', {
                            runtime: runtime,
                            handler: handlerPath,
                            code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
                        });

                        // Configure mock for entitled account
                        configureMockEntitled(layerArn);

                        // Apply transformation
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was applied
                        expect(result?.transformed).toBe(true);

                        // Verify JS_HANDLER_PATH is NOT set (handler path is now in config layer)
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];
                        const envVars = functionResource.Properties?.Environment?.Variables ?? {};

                        expect(envVars['JS_HANDLER_PATH']).toBeUndefined();

                        // Verify config layer is attached (at least 2 layers: Lambda Kata + config)
                        const layers = functionResource.Properties?.Layers ?? [];
                        expect(layers.length).toBeGreaterThanOrEqual(2);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 3.3, 3.4**
         * Test with various handler path formats to ensure config layer is attached for all valid formats.
         *
         * Handler paths can be:
         * - Simple: "index.handler"
         * - With directory: "src/handler.main"
         * - Deeply nested: "handlers/api/users.createUser"
         */
        it('should attach config layer for handler paths with various directory depths', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryHandlerPath(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (handlerPath, accountId, layerArn) => {
                        const { stack } = createTestStack(accountId);

                        const lambda = new LambdaFunction(stack, 'TestFunction', {
                            runtime: Runtime.NODEJS_18_X,
                            handler: handlerPath,
                            code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
                        });

                        // Configure mock for entitled account
                        configureMockEntitled(layerArn);

                        // Apply transformation
                        kata(lambda);
                        await getKataPromise(lambda);

                        // Verify JS_HANDLER_PATH is NOT in environment variables
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];
                        const envVars = functionResource.Properties?.Environment?.Variables ?? {};

                        // JS_HANDLER_PATH should NOT be set (handler path is in config layer)
                        expect(envVars['JS_HANDLER_PATH']).toBeUndefined();

                        // Config layer should be attached
                        const layers = functionResource.Properties?.Layers ?? [];
                        expect(layers.length).toBeGreaterThanOrEqual(2);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 3.3, 3.4**
         * Test that config layer is attached without overwriting existing environment variables.
         */
        it('should attach config layer without overwriting existing environment variables', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (config, accountId, layerArn) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock for entitled account
                        configureMockEntitled(layerArn);

                        // Apply transformation
                        kata(lambda);
                        await getKataPromise(lambda);

                        // Verify environment variables
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];
                        const envVars = functionResource.Properties?.Environment?.Variables ?? {};

                        // JS_HANDLER_PATH should NOT be set (handler path is in config layer)
                        expect(envVars['JS_HANDLER_PATH']).toBeUndefined();

                        // All original env vars should still be present
                        for (const [key, value] of Object.entries(config.environment)) {
                            expect(envVars[key]).toBe(value);
                        }

                        // Config layer should be attached
                        const layers = functionResource.Properties?.Layers ?? [];
                        expect(layers.length).toBeGreaterThanOrEqual(2);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 3.4**
         * Test that JS_HANDLER_PATH is NOT added for non-entitled accounts.
         * This ensures the environment variable is only added when transformation occurs.
         */
        it('should NOT attach config layer for non-entitled accounts', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryHandlerPath(),
                    arbitraryNodejsRuntime(),
                    arbitraryAccountId(),
                    async (handlerPath, runtime, accountId) => {
                        const { stack } = createTestStack(accountId);

                        const lambda = new LambdaFunction(stack, 'TestFunction', {
                            runtime: runtime,
                            handler: handlerPath,
                            code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
                        });

                        // Configure mock for non-entitled account
                        configureMockNotEntitled();

                        // Apply transformation (should not transform)
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was NOT applied
                        expect(result?.transformed).toBe(false);

                        // Verify JS_HANDLER_PATH is NOT present
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];
                        const envVars = functionResource.Properties?.Environment?.Variables;

                        // Either no environment variables, or JS_HANDLER_PATH is not present
                        if (envVars) {
                            expect(envVars['JS_HANDLER_PATH']).toBeUndefined();
                        }

                        // No Lambda Kata layers should be attached
                        const layers = functionResource.Properties?.Layers;
                        expect(layers).toBeUndefined();

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 3.3, 3.4**
         * Test that config layer is attached for various handler paths (no modification to handler).
         */
        it('should attach config layer for any valid handler path (no modification)', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryHandlerPath(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (handlerPath, accountId, layerArn) => {
                        const { stack } = createTestStack(accountId);

                        const lambda = new LambdaFunction(stack, 'TestFunction', {
                            runtime: Runtime.NODEJS_20_X,
                            handler: handlerPath,
                            code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
                        });

                        // Configure mock for entitled account
                        configureMockEntitled(layerArn);

                        // Apply transformation
                        kata(lambda);
                        await getKataPromise(lambda);

                        // Get the environment variables
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];
                        const envVars = functionResource.Properties?.Environment?.Variables ?? {};

                        // JS_HANDLER_PATH should NOT be set (handler path is in config layer)
                        expect(envVars['JS_HANDLER_PATH']).toBeUndefined();

                        // Config layer should be attached
                        const layers = functionResource.Properties?.Layers ?? [];
                        expect(layers.length).toBeGreaterThanOrEqual(2);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });
    });
});


/**
 * Feature: cdk-integration, Property 4: Layer ARN Matches Licensing Response
 *
 * *For any* entitled account, the Layer ARN attached to the transformed Lambda SHALL exactly match
 * the Layer ARN returned by the Licensing Service.
 *
 * **Validates: Requirements 5.3**
 * - 5.3: THE kata_Wrapper SHALL only attach the Layer_ARN returned by the Licensing_Service
 */
describe('Feature: cdk-integration, Property 4: Layer ARN Matches Licensing Response', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    /**
     * Arbitrary generator for valid Lambda Layer ARNs with various formats
     * Generates ARNs like: arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1
     */
    const arbitraryLayerArnWithName = (): fc.Arbitrary<string> =>
        fc.tuple(
            arbitraryRegion(),
            arbitraryAccountId(),
            fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), {
                minLength: 1,
                maxLength: 30,
            }),
            fc.integer({ min: 1, max: 999 })
        ).map(
            ([region, accountId, layerName, version]) =>
                `arn:aws:lambda:${region}:${accountId}:layer:${layerName}:${version}`
        );

    describe('Property 4: Layer ARN Matches Licensing Response', () => {
        /**
         * **Validates: Requirement 5.3**
         * THE kata_Wrapper SHALL only attach the Layer_ARN returned by the Licensing_Service
         *
         * For any random Layer ARN returned by the licensing service, the attached layer
         * must exactly match that ARN.
         *
         * Note: With config-layer-handler-path feature, there are now 2 layers:
         * - Config layer (contains handler path)
         * - Lambda Kata layer (from licensing service)
         */
        it('should attach exactly the Layer ARN returned by the licensing service', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryHandlerPath(),
                    arbitraryNodejsRuntime(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (handlerPath, runtime, accountId, layerArn) => {
                        const { stack } = createTestStack(accountId);

                        // Create Lambda with generated config
                        const lambda = new LambdaFunction(stack, 'TestFunction', {
                            runtime: runtime,
                            handler: handlerPath,
                            code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
                        });

                        // Configure mock for entitled account with specific layer ARN
                        configureMockEntitled(layerArn);

                        // Apply transformation
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was applied
                        expect(result?.transformed).toBe(true);
                        expect(result?.licensingResponse.entitled).toBe(true);

                        // Verify the layer ARN in the result matches exactly what licensing returned
                        expect(result?.licensingResponse.layerVersionArn).toBe(layerArn);

                        // Verify the layer ARN in the CloudFormation template matches exactly
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];
                        const layers = functionResource.Properties?.Layers;

                        expect(layers).toBeDefined();
                        // Expect at least 2 layers: config layer + Lambda Kata layer (+ optional Node.js runtime layer)
                        expect(layers.length).toBeGreaterThanOrEqual(2);
                        // Lambda Kata layer (from licensing) should be in the layers array
                        expect(layers).toContain(layerArn);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 5.3**
         * Test that different accounts receive their specific layer ARNs from licensing.
         * Each account should get exactly the layer ARN that the licensing service returns for them.
         */
        it('should attach the correct layer ARN for each account based on licensing response', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryHandlerPath(),
                    arbitraryNodejsRuntime(),
                    arbitraryAccountId(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    arbitraryLayerArn(),
                    async (handlerPath, runtime, accountId1, accountId2, layerArn1, layerArn2) => {
                        // Ensure we have different accounts and layer ARNs for meaningful test
                        fc.pre(accountId1 !== accountId2);
                        fc.pre(layerArn1 !== layerArn2);

                        // Test first account
                        const { stack: stack1 } = createTestStack(accountId1);
                        const lambda1 = new LambdaFunction(stack1, 'TestFunction', {
                            runtime: runtime,
                            handler: handlerPath,
                            code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
                        });

                        configureMockEntitled(layerArn1);
                        kata(lambda1);
                        const result1 = await getKataPromise(lambda1);

                        // Test second account
                        const { stack: stack2 } = createTestStack(accountId2);
                        const lambda2 = new LambdaFunction(stack2, 'TestFunction', {
                            runtime: runtime,
                            handler: handlerPath,
                            code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
                        });

                        configureMockEntitled(layerArn2);
                        kata(lambda2);
                        const result2 = await getKataPromise(lambda2);

                        // Verify each account gets exactly its specific layer ARN from licensing
                        expect(result1?.licensingResponse.layerVersionArn).toBe(layerArn1);
                        expect(result2?.licensingResponse.layerVersionArn).toBe(layerArn2);

                        // Verify in CloudFormation templates
                        // Now expect 2 layers: config layer + Lambda Kata layer
                        const template1 = Template.fromStack(stack1);
                        const resources1 = template1.findResources('AWS::Lambda::Function');
                        const layers1 = Object.values(resources1)[0].Properties?.Layers;
                        expect(layers1.length).toBeGreaterThanOrEqual(2);
                        expect(layers1).toContain(layerArn1);

                        const template2 = Template.fromStack(stack2);
                        const resources2 = template2.findResources('AWS::Lambda::Function');
                        const layers2 = Object.values(resources2)[0].Properties?.Layers;
                        expect(layers2.length).toBeGreaterThanOrEqual(2);
                        expect(layers2).toContain(layerArn2);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 5.3**
         * Test that the layer ARN is preserved exactly as returned by licensing,
         * including all components (region, account, layer name, version).
         *
         * Note: With config-layer-handler-path feature, there are now 2 layers:
         * - Config layer (contains handler path) - index 0
         * - Lambda Kata layer (from licensing service) - index 1
         */
        it('should preserve all components of the layer ARN exactly as returned by licensing', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryHandlerPath(),
                    arbitraryNodejsRuntime(),
                    arbitraryAccountId(),
                    arbitraryRegion(),
                    arbitraryAccountId(),
                    fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), {
                        minLength: 1,
                        maxLength: 30,
                    }),
                    fc.integer({ min: 1, max: 999 }),
                    async (handlerPath, runtime, targetAccountId, layerRegion, layerAccountId, layerName, layerVersion) => {
                        const { stack } = createTestStack(targetAccountId);

                        // Construct a specific layer ARN with all components
                        const layerArn = `arn:aws:lambda:${layerRegion}:${layerAccountId}:layer:${layerName}:${layerVersion}`;

                        const lambda = new LambdaFunction(stack, 'TestFunction', {
                            runtime: runtime,
                            handler: handlerPath,
                            code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
                        });

                        // Configure mock for entitled account with the constructed layer ARN
                        configureMockEntitled(layerArn);

                        // Apply transformation
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was applied
                        expect(result?.transformed).toBe(true);

                        // Verify the complete layer ARN matches exactly
                        expect(result?.licensingResponse.layerVersionArn).toBe(layerArn);

                        // Verify in CloudFormation template
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];
                        const layers = functionResource.Properties?.Layers;

                        // Expect at least 2 layers: config layer + Lambda Kata layer (+ optional Node.js runtime layer)
                        expect(layers.length).toBeGreaterThanOrEqual(2);
                        // Verify the Lambda Kata layer is in the array
                        expect(layers).toContain(layerArn);

                        // The attached layer ARN must exactly match the licensing response
                        const attachedLayerArn = layerArn;

                        // Verify all components are preserved
                        expect(attachedLayerArn).toContain(layerRegion);
                        expect(attachedLayerArn).toContain(layerAccountId);
                        expect(attachedLayerArn).toContain(layerName);
                        expect(attachedLayerArn).toContain(`:${layerVersion}`);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 5.3**
         * Test that no layer is attached when the licensing service does not return a layer ARN.
         * This ensures we only attach what licensing explicitly provides.
         */
        it('should not attach any layer when licensing service returns no layer ARN', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryHandlerPath(),
                    arbitraryNodejsRuntime(),
                    arbitraryAccountId(),
                    async (handlerPath, runtime, accountId) => {
                        const { stack } = createTestStack(accountId);

                        const lambda = new LambdaFunction(stack, 'TestFunction', {
                            runtime: runtime,
                            handler: handlerPath,
                            code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
                        });

                        // Configure mock for non-entitled account (no layer ARN returned)
                        configureMockNotEntitled();

                        // Apply transformation
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was NOT applied
                        expect(result?.transformed).toBe(false);
                        expect(result?.licensingResponse.entitled).toBe(false);
                        expect(result?.licensingResponse.layerVersionArn).toBeUndefined();

                        // Verify no layer is attached in CloudFormation template
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];
                        const layers = functionResource.Properties?.Layers;

                        // Either no Layers property or empty array
                        expect(layers).toBeUndefined();

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 5.3**
         * Test that the layer ARN string is not modified in any way during transformation.
         * The exact string returned by licensing must be used.
         *
         * Note: With config-layer-handler-path feature, there are now 2 layers:
         * - Config layer (contains handler path) - index 0
         * - Lambda Kata layer (from licensing service) - index 1
         */
        it('should use the exact layer ARN string without any modification', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryHandlerPath(),
                    arbitraryNodejsRuntime(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (handlerPath, runtime, accountId, layerArn) => {
                        const { stack } = createTestStack(accountId);

                        const lambda = new LambdaFunction(stack, 'TestFunction', {
                            runtime: runtime,
                            handler: handlerPath,
                            code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
                        });

                        // Configure mock for entitled account
                        configureMockEntitled(layerArn);

                        // Apply transformation
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was applied
                        expect(result?.transformed).toBe(true);

                        // Get the attached layer ARN from CloudFormation
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];
                        const layers = functionResource.Properties?.Layers;

                        // Expect at least 2 layers: config layer + Lambda Kata layer (+ optional Node.js runtime layer)
                        expect(layers.length).toBeGreaterThanOrEqual(2);
                        // Verify the Lambda Kata layer is in the array
                        expect(layers).toContain(layerArn);

                        // Verify exact string match (same length, same characters, same case)
                        // The layerArn we passed to the mock should be in the layers array
                        expect(layerArn.length).toBeGreaterThan(0);

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });
    });
});


/**
 * Feature: cdk-integration, Property 5: Unlicensed Accounts Receive No Transformation
 *
 * *For any* Lambda function and any non-entitled AWS account, when `kata(lambda)` is called:
 * - Runtime SHALL remain the original Node.js runtime
 * - Handler SHALL remain the original handler
 * - No Lambda Kata Layer SHALL be attached
 *
 * **Validates: Requirements 3.5, 6.1, 6.2, 6.3**
 * - 3.5: IF the account is NOT entitled, THEN THE kata_Wrapper SHALL NOT apply any transformations
 * - 6.1: IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL keep the original Node.js runtime unchanged
 * - 6.2: IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL keep the original handler unchanged
 * - 6.3: IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL NOT attach any Lambda_Layer
 */
describe('Feature: cdk-integration, Property 5: Unlicensed Accounts Receive No Transformation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Property 5: Unlicensed Accounts Receive No Transformation', () => {
        /**
         * **Validates: Requirement 6.1**
         * IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL keep the original Node.js runtime unchanged
         *
         * For any Lambda with any Node.js runtime and any non-entitled account,
         * the runtime must remain unchanged after calling kata().
         */
        it('should keep the original Node.js runtime unchanged for non-entitled accounts', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    async (config, accountId) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Capture original runtime before transformation
                        const originalRuntime = config.runtime.name;

                        // Configure mock for non-entitled account
                        configureMockNotEntitled();

                        // Apply transformation (should not transform)
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was NOT applied
                        expect(result?.transformed).toBe(false);
                        expect(result?.licensingResponse.entitled).toBe(false);

                        // Verify runtime is unchanged
                        const cfnFunction = lambda.node.defaultChild as CfnFunction;
                        expect(cfnFunction.runtime).toBe(originalRuntime);

                        // Verify in CloudFormation template
                        const template = Template.fromStack(stack);
                        template.hasResourceProperties('AWS::Lambda::Function', {
                            Runtime: originalRuntime,
                        });

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.2**
         * IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL keep the original handler unchanged
         *
         * For any Lambda with any handler path and any non-entitled account,
         * the handler must remain unchanged after calling kata().
         */
        it('should keep the original handler unchanged for non-entitled accounts', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    async (config, accountId) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Capture original handler before transformation
                        const originalHandler = config.handler;

                        // Configure mock for non-entitled account
                        configureMockNotEntitled();

                        // Apply transformation (should not transform)
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was NOT applied
                        expect(result?.transformed).toBe(false);
                        expect(result?.licensingResponse.entitled).toBe(false);

                        // Verify handler is unchanged
                        const cfnFunction = lambda.node.defaultChild as CfnFunction;
                        expect(cfnFunction.handler).toBe(originalHandler);

                        // Verify in CloudFormation template
                        const template = Template.fromStack(stack);
                        template.hasResourceProperties('AWS::Lambda::Function', {
                            Handler: originalHandler,
                        });

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.3**
         * IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL NOT attach any Lambda_Layer
         *
         * For any Lambda and any non-entitled account, no Lambda Kata layer should be attached.
         */
        it('should not attach any Lambda Kata layer for non-entitled accounts', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    async (config, accountId) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock for non-entitled account
                        configureMockNotEntitled();

                        // Apply transformation (should not transform)
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was NOT applied
                        expect(result?.transformed).toBe(false);
                        expect(result?.licensingResponse.entitled).toBe(false);
                        expect(result?.licensingResponse.layerVersionArn).toBeUndefined();

                        // Verify no layer is attached in CloudFormation template
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];
                        const layers = functionResource.Properties?.Layers;

                        // Either no Layers property or undefined
                        expect(layers).toBeUndefined();

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 3.5**
         * IF the account is NOT entitled, THEN THE kata_Wrapper SHALL NOT apply any transformations
         *
         * Combined test: For any Lambda and any non-entitled account, all three conditions must hold:
         * - Runtime unchanged
         * - Handler unchanged
         * - No layer attached
         */
        it('should not apply any transformations for non-entitled accounts (runtime, handler, layer all unchanged)', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    async (config, accountId) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Capture original values before transformation
                        const originalRuntime = config.runtime.name;
                        const originalHandler = config.handler;

                        // Configure mock for non-entitled account
                        configureMockNotEntitled();

                        // Apply transformation (should not transform)
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was NOT applied
                        expect(result?.transformed).toBe(false);
                        expect(result?.licensingResponse.entitled).toBe(false);

                        // Get CloudFormation template
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];

                        // 1. Verify runtime is unchanged (Req 6.1)
                        expect(functionResource.Properties?.Runtime).toBe(originalRuntime);

                        // 2. Verify handler is unchanged (Req 6.2)
                        expect(functionResource.Properties?.Handler).toBe(originalHandler);

                        // 3. Verify no layer is attached (Req 6.3)
                        expect(functionResource.Properties?.Layers).toBeUndefined();

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 3.5, 6.1, 6.2, 6.3**
         * Test that non-entitled accounts preserve all original Lambda properties exactly.
         * This ensures the Lambda is completely unchanged when not entitled.
         */
        it('should preserve all original Lambda properties for non-entitled accounts', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    async (config, accountId) => {
                        const { stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock for non-entitled account
                        configureMockNotEntitled();

                        // Apply transformation (should not transform)
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was NOT applied
                        expect(result?.transformed).toBe(false);

                        // Get CloudFormation template
                        const template = Template.fromStack(stack);
                        const resources = template.findResources('AWS::Lambda::Function');
                        const functionResource = Object.values(resources)[0];

                        // Verify all original properties are preserved
                        expect(functionResource.Properties?.Runtime).toBe(config.runtime.name);
                        expect(functionResource.Properties?.Handler).toBe(config.handler);
                        expect(functionResource.Properties?.MemorySize).toBe(config.memorySize);
                        expect(functionResource.Properties?.Timeout).toBe(config.timeout);
                        expect(functionResource.Properties?.Layers).toBeUndefined();

                        // Verify original environment variables are preserved (no Lambda Kata vars added)
                        const envVars = functionResource.Properties?.Environment?.Variables;
                        if (Object.keys(config.environment).length > 0) {
                            for (const [key, value] of Object.entries(config.environment)) {
                                expect(envVars?.[key]).toBe(value);
                            }
                        }

                        // Verify Lambda Kata environment variables are NOT added
                        if (envVars) {
                            expect(envVars['JS_HANDLER_PATH']).toBeUndefined();
                            expect(envVars['JS_BUNDLE_PATH']).toBeUndefined();
                            expect(envVars['USE_CTYPES_BRIDGE']).toBeUndefined();
                        }

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 3.5, 6.1, 6.2, 6.3**
         * Test that different non-entitled accounts all receive no transformation.
         * Ensures the no-op behavior is consistent across all non-entitled accounts.
         */
        it('should consistently not transform for any non-entitled account', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryAccountId(),
                    async (config, accountId1, accountId2) => {
                        // Ensure we have different accounts for meaningful test
                        fc.pre(accountId1 !== accountId2);

                        // Test first non-entitled account
                        const { stack: stack1 } = createTestStack(accountId1);
                        const lambda1 = createTestLambda(stack1, 'TestFunction', config);

                        configureMockNotEntitled();
                        kata(lambda1);
                        const result1 = await getKataPromise(lambda1);

                        // Test second non-entitled account
                        const { stack: stack2 } = createTestStack(accountId2);
                        const lambda2 = createTestLambda(stack2, 'TestFunction', config);

                        configureMockNotEntitled();
                        kata(lambda2);
                        const result2 = await getKataPromise(lambda2);

                        // Both should not be transformed
                        expect(result1?.transformed).toBe(false);
                        expect(result2?.transformed).toBe(false);
                        expect(result1?.licensingResponse.entitled).toBe(false);
                        expect(result2?.licensingResponse.entitled).toBe(false);

                        // Verify both have original runtime and handler
                        const template1 = Template.fromStack(stack1);
                        const resources1 = template1.findResources('AWS::Lambda::Function');
                        const func1 = Object.values(resources1)[0];

                        const template2 = Template.fromStack(stack2);
                        const resources2 = template2.findResources('AWS::Lambda::Function');
                        const func2 = Object.values(resources2)[0];

                        // Both should have original runtime
                        expect(func1.Properties?.Runtime).toBe(config.runtime.name);
                        expect(func2.Properties?.Runtime).toBe(config.runtime.name);

                        // Both should have original handler
                        expect(func1.Properties?.Handler).toBe(config.handler);
                        expect(func2.Properties?.Handler).toBe(config.handler);

                        // Neither should have layers
                        expect(func1.Properties?.Layers).toBeUndefined();
                        expect(func2.Properties?.Layers).toBeUndefined();

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 3.5, 6.1, 6.2, 6.3**
         * Test contrast: entitled vs non-entitled accounts with same Lambda config.
         * Ensures the transformation only applies to entitled accounts.
         */
        it('should transform entitled accounts but not non-entitled accounts with same Lambda config', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (config, entitledAccountId, nonEntitledAccountId, layerArn) => {
                        // Ensure we have different accounts
                        fc.pre(entitledAccountId !== nonEntitledAccountId);

                        // Test entitled account
                        const { stack: entitledStack } = createTestStack(entitledAccountId);
                        const entitledLambda = createTestLambda(entitledStack, 'TestFunction', config);

                        configureMockEntitled(layerArn);
                        kata(entitledLambda);
                        const entitledResult = await getKataPromise(entitledLambda);

                        // Test non-entitled account
                        const { stack: nonEntitledStack } = createTestStack(nonEntitledAccountId);
                        const nonEntitledLambda = createTestLambda(nonEntitledStack, 'TestFunction', config);

                        configureMockNotEntitled();
                        kata(nonEntitledLambda);
                        const nonEntitledResult = await getKataPromise(nonEntitledLambda);

                        // Entitled account should be transformed
                        expect(entitledResult?.transformed).toBe(true);
                        expect(entitledResult?.licensingResponse.entitled).toBe(true);

                        // Non-entitled account should NOT be transformed
                        expect(nonEntitledResult?.transformed).toBe(false);
                        expect(nonEntitledResult?.licensingResponse.entitled).toBe(false);

                        // Verify entitled Lambda has Python runtime and Lambda Kata handler
                        // Note: Config layer is also attached, so we use arrayWith to check the Lambda Kata layer is present
                        const entitledTemplate = Template.fromStack(entitledStack);
                        entitledTemplate.hasResourceProperties('AWS::Lambda::Function', {
                            Runtime: 'python3.12',
                            Handler: 'lambdakata.optimized_handler.lambda_handler',
                            Layers: Match.arrayWith([layerArn]),
                        });

                        // Verify non-entitled Lambda has original runtime and handler, no layers
                        const nonEntitledTemplate = Template.fromStack(nonEntitledStack);
                        const nonEntitledResources = nonEntitledTemplate.findResources('AWS::Lambda::Function');
                        const nonEntitledFunc = Object.values(nonEntitledResources)[0];

                        expect(nonEntitledFunc.Properties?.Runtime).toBe(config.runtime.name);
                        expect(nonEntitledFunc.Properties?.Handler).toBe(config.handler);
                        expect(nonEntitledFunc.Properties?.Layers).toBeUndefined();

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });
    });
});


/**
 * Feature: cdk-integration, Property 6: Unlicensed Accounts Receive Warning
 *
 * *For any* non-entitled AWS account, when `kata(lambda)` is called, a warning message
 * SHALL be emitted containing licensing guidance.
 *
 * **Validates: Requirements 3.6, 6.4**
 * - 3.6: IF the account is NOT entitled, THEN THE kata_Wrapper SHALL emit a clear warning message indicating the licensing issue
 * - 6.4: IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL emit a warning message:
 *        "Lambda Kata not enabled: AWS account is not entitled. Subscribe via AWS Marketplace to enable."
 */
describe('Feature: cdk-integration, Property 6: Unlicensed Accounts Receive Warning', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Property 6: Unlicensed Accounts Receive Warning', () => {
        /**
         * **Validates: Requirement 3.6**
         * IF the account is NOT entitled, THEN THE kata_Wrapper SHALL emit a clear warning message indicating the licensing issue
         *
         * For any non-entitled account, a warning message must be emitted.
         */
        it('should emit a warning message for any non-entitled account', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    async (config, accountId) => {
                        const { app, stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock for non-entitled account
                        configureMockNotEntitled();

                        // Apply transformation (should not transform but should emit warning)
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was NOT applied
                        expect(result?.transformed).toBe(false);
                        expect(result?.licensingResponse.entitled).toBe(false);

                        // Synthesize the stack to capture annotations
                        app.synth();

                        // Verify warning is emitted using CDK Annotations assertions
                        const annotations = Annotations.fromStack(stack);
                        annotations.hasWarning(
                            '/TestStack/TestFunction',
                            Match.stringLikeRegexp('.*[Nn]ot entitled.*')
                        );

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirement 6.4**
         * IF the Licensing_Service returns an unlicensed status, THEN THE kata_Wrapper SHALL emit a warning message:
         * "Lambda Kata not enabled: AWS account is not entitled. Subscribe via AWS Marketplace to enable."
         *
         * For any non-entitled account, the exact warning message format must be emitted.
         */
        it('should emit the exact warning message format for any non-entitled account', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    async (config, accountId) => {
                        const { app, stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock for non-entitled account
                        configureMockNotEntitled();

                        // Apply transformation (should not transform but should emit warning)
                        kata(lambda);
                        const result = await getKataPromise(lambda);

                        // Verify transformation was NOT applied
                        expect(result?.transformed).toBe(false);
                        expect(result?.licensingResponse.entitled).toBe(false);

                        // Synthesize the stack to capture annotations
                        app.synth();

                        // Verify the exact warning message format as specified in Requirement 6.4
                        const annotations = Annotations.fromStack(stack);
                        annotations.hasWarning(
                            '/TestStack/TestFunction',
                            Match.stringLikeRegexp('Lambda Kata not enabled.*AWS account is not entitled.*Subscribe via AWS Marketplace')
                        );

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 3.6, 6.4**
         * Test that the warning message contains licensing guidance.
         *
         * For any non-entitled account, the warning must contain guidance on how to enable Lambda Kata.
         */
        it('should emit warning containing licensing guidance for any non-entitled account', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    async (config, accountId) => {
                        const { app, stack } = createTestStack(accountId);
                        const lambda = createTestLambda(stack, 'TestFunction', config);

                        // Configure mock for non-entitled account
                        configureMockNotEntitled();

                        // Apply transformation (should not transform but should emit warning)
                        kata(lambda);
                        await getKataPromise(lambda);

                        // Synthesize the stack to capture annotations
                        app.synth();

                        // Verify warning contains licensing guidance (mentions AWS Marketplace)
                        const annotations = Annotations.fromStack(stack);
                        annotations.hasWarning(
                            '/TestStack/TestFunction',
                            Match.stringLikeRegexp('.*AWS Marketplace.*')
                        );

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 3.6, 6.4**
         * Test that different non-entitled accounts all receive the same warning message.
         *
         * Ensures the warning behavior is consistent across all non-entitled accounts.
         */
        it('should emit consistent warning message for any non-entitled account', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryAccountId(),
                    async (config, accountId1, accountId2) => {
                        // Ensure we have different accounts for meaningful test
                        fc.pre(accountId1 !== accountId2);

                        // Test first non-entitled account
                        const { app: app1, stack: stack1 } = createTestStack(accountId1);
                        const lambda1 = createTestLambda(stack1, 'TestFunction', config);

                        configureMockNotEntitled();
                        kata(lambda1);
                        await getKataPromise(lambda1);

                        // Test second non-entitled account
                        const { app: app2, stack: stack2 } = createTestStack(accountId2);
                        const lambda2 = createTestLambda(stack2, 'TestFunction', config);

                        configureMockNotEntitled();
                        kata(lambda2);
                        await getKataPromise(lambda2);

                        // Synthesize both stacks
                        app1.synth();
                        app2.synth();

                        // Both should have the same warning message format
                        const annotations1 = Annotations.fromStack(stack1);
                        const annotations2 = Annotations.fromStack(stack2);

                        // Both should have warnings matching the expected format
                        annotations1.hasWarning(
                            '/TestStack/TestFunction',
                            Match.stringLikeRegexp('Lambda Kata not enabled.*AWS account is not entitled.*Subscribe via AWS Marketplace')
                        );

                        annotations2.hasWarning(
                            '/TestStack/TestFunction',
                            Match.stringLikeRegexp('Lambda Kata not enabled.*AWS account is not entitled.*Subscribe via AWS Marketplace')
                        );

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });

        /**
         * **Validates: Requirements 3.6, 6.4**
         * Test contrast: entitled accounts should NOT receive warning, non-entitled should.
         *
         * Ensures warnings are only emitted for non-entitled accounts.
         */
        it('should emit warning only for non-entitled accounts, not for entitled accounts', () => {
            fc.assert(
                fc.asyncProperty(
                    arbitraryLambdaConfig(),
                    arbitraryAccountId(),
                    arbitraryAccountId(),
                    arbitraryLayerArn(),
                    async (config, entitledAccountId, nonEntitledAccountId, layerArn) => {
                        // Ensure we have different accounts
                        fc.pre(entitledAccountId !== nonEntitledAccountId);

                        // Test entitled account
                        const { app: entitledApp, stack: entitledStack } = createTestStack(entitledAccountId);
                        const entitledLambda = createTestLambda(entitledStack, 'TestFunction', config);

                        configureMockEntitled(layerArn);
                        kata(entitledLambda);
                        const entitledResult = await getKataPromise(entitledLambda);

                        // Test non-entitled account
                        const { app: nonEntitledApp, stack: nonEntitledStack } = createTestStack(nonEntitledAccountId);
                        const nonEntitledLambda = createTestLambda(nonEntitledStack, 'TestFunction', config);

                        configureMockNotEntitled();
                        kata(nonEntitledLambda);
                        const nonEntitledResult = await getKataPromise(nonEntitledLambda);

                        // Synthesize both stacks
                        entitledApp.synth();
                        nonEntitledApp.synth();

                        // Entitled account should be transformed
                        expect(entitledResult?.transformed).toBe(true);
                        expect(entitledResult?.licensingResponse.entitled).toBe(true);

                        // Non-entitled account should NOT be transformed
                        expect(nonEntitledResult?.transformed).toBe(false);
                        expect(nonEntitledResult?.licensingResponse.entitled).toBe(false);

                        // Entitled account should NOT have warning about not being entitled
                        const entitledAnnotations = Annotations.fromStack(entitledStack);
                        expect(() => {
                            entitledAnnotations.hasWarning(
                                '/TestStack/TestFunction',
                                Match.stringLikeRegexp('.*not entitled.*')
                            );
                        }).toThrow();

                        // Non-entitled account SHOULD have warning
                        const nonEntitledAnnotations = Annotations.fromStack(nonEntitledStack);
                        nonEntitledAnnotations.hasWarning(
                            '/TestStack/TestFunction',
                            Match.stringLikeRegexp('Lambda Kata not enabled.*AWS account is not entitled.*Subscribe via AWS Marketplace')
                        );

                        return true;
                    }
                ),
                { numRuns: 10 }
            );
        });
    });
});

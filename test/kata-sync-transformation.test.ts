/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
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

import { kata, getKataPromise } from '../src/kata-wrapper';
import { LicensingResponse } from '../src/types';

/**
 * Mock licensing service interface for testing
 * Implements the same interface as NativeLicensingService
 */
interface MockLicensingServiceInterface {
    checkEntitlement(accountId: string): Promise<LicensingResponse>;
    checkEntitlementSync(accountId: string): LicensingResponse;
}

/**
 * Mock sync licensing service for testing
 */
class MockSyncLicensingService implements MockLicensingServiceInterface {
    private entitled: boolean;
    private layerArn: string;

    constructor(entitled: boolean, layerArn: string = 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1') {
        this.entitled = entitled;
        this.layerArn = layerArn;
    }

    async checkEntitlement(accountId: string): Promise<LicensingResponse> {
        return this.checkEntitlementSync(accountId);
    }

    checkEntitlementSync(accountId: string): LicensingResponse {
        if (this.entitled) {
            return {
                entitled: true,
                layerArn: this.layerArn,
                message: 'Account is entitled',
            };
        }
        return {
            entitled: false,
            message: 'Account is not entitled',
        };
    }
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
    describe('Transformation is applied synchronously', () => {
        it('should transform Lambda BEFORE returning from kata()', () => {
            const app = new App({
                context: { 'aws:cdk:account': '123456789012' },
            });
            const stack = new Stack(app, 'TestStack', {
                env: { account: '123456789012', region: 'us-east-1' },
            });

            const lambda = createTestLambda(stack, 'TestFunction');
            const mockService = new MockSyncLicensingService(true);

            // Call kata() - transformation should be applied SYNCHRONOUSLY
            kata(lambda, { syncLicensingService: mockService });

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
            const mockService = new MockSyncLicensingService(true);

            // Call kata() synchronously
            kata(lambda, { syncLicensingService: mockService });

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
            const mockService = new MockSyncLicensingService(true, layerArn);

            kata(lambda, { syncLicensingService: mockService });

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
            const mockService = new MockSyncLicensingService(true);

            kata(lambda, { syncLicensingService: mockService });

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
            const mockService = new MockSyncLicensingService(false);

            kata(lambda, { syncLicensingService: mockService });

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
            const mockService = new MockSyncLicensingService(false);

            kata(lambda, { syncLicensingService: mockService });

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
            const mockService = new MockSyncLicensingService(true);

            kata(lambda, { syncLicensingService: mockService });

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

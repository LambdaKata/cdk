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
 * Region Resolution Tests
 *
 * Verifies that Node.js Layer deployment uses Stack deployment region,
 * not account default region.
 */

import { App, Stack } from 'aws-cdk-lib';
import { Function as LambdaFunction, Runtime, Code } from 'aws-cdk-lib/aws-lambda';

import { kataWithAccountId } from '../src/kata-wrapper';
import { MockLicensingService } from '../src/mock-licensing';

describe('Region Resolution', () => {
    it('should use Stack deployment region for Node.js layer, not account region', async () => {
        // Setup: Account in eu-central-1, but deploying to us-east-1
        const accountId = '123456789012';
        const deploymentRegion = 'us-east-1';

        const app = new App({
            context: { 'aws:cdk:account': accountId },
        });

        // Stack explicitly deployed to us-east-1 (different from account region)
        const stack = new Stack(app, 'TestStack', {
            env: {
                account: accountId,
                region: deploymentRegion, // Deployment region
            },
        });

        const lambda = new LambdaFunction(stack, 'TestFunction', {
            runtime: Runtime.NODEJS_20_X,
            handler: 'index.handler',
            code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
        });

        // Setup entitled account
        const mockLicensing = new MockLicensingService();
        const layerArn = `arn:aws:lambda:${deploymentRegion}:${accountId}:layer:LambdaKata:1`;
        mockLicensing.setEntitled(accountId, layerArn);

        // Apply transformation - should use deploymentRegion (us-east-1)
        const result = await kataWithAccountId(lambda, accountId, deploymentRegion, {
            licensingService: mockLicensing,
        });

        // Verify transformation succeeded
        expect(result.transformed).toBe(true);
        expect(result.accountId).toBe(accountId);

        // Verify Stack.of(lambda).region returns deployment region
        expect(Stack.of(lambda).region).toBe(deploymentRegion);
    });

    it('should handle cross-region deployment correctly', async () => {
        // Account default: eu-central-1
        // Deployment target: ap-southeast-1
        const accountId = '999888777666';
        const accountRegion = 'eu-central-1';
        const deploymentRegion = 'ap-southeast-1';

        const app = new App({
            context: { 'aws:cdk:account': accountId },
        });

        const stack = new Stack(app, 'CrossRegionStack', {
            env: {
                account: accountId,
                region: deploymentRegion, // Different from account region
            },
        });

        const lambda = new LambdaFunction(stack, 'CrossRegionFunction', {
            runtime: Runtime.NODEJS_18_X,
            handler: 'handler.main',
            code: Code.fromInline('exports.main = async () => ({ statusCode: 200 });'),
        });

        // Setup licensing with deployment region ARN
        const mockLicensing = new MockLicensingService();
        const layerArn = `arn:aws:lambda:${deploymentRegion}:${accountId}:layer:LambdaKata:5`;
        mockLicensing.setEntitled(accountId, layerArn);

        // Apply transformation with deployment region
        const result = await kataWithAccountId(lambda, accountId, deploymentRegion, {
            licensingService: mockLicensing,
        });

        // Verify correct region is used
        expect(result.transformed).toBe(true);
        expect(Stack.of(lambda).region).toBe(deploymentRegion);
        expect(Stack.of(lambda).region).not.toBe(accountRegion);
    });
});

it('should handle CDK token regions with context fallback', async () => {
    // Scenario: Stack region is a token, but context provides explicit region
    const accountId = '111222333444';
    const explicitRegion = 'eu-west-1';

    const app = new App({
        context: {
            'aws:cdk:account': accountId,
            'aws:cdk:region': explicitRegion, // Explicit region in context
        },
    });

    // Stack without explicit env.region - will use token
    const stack = new Stack(app, 'TokenRegionStack');

    const lambda = new LambdaFunction(stack, 'TokenRegionFunction', {
        runtime: Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
    });

    // Setup licensing
    const mockLicensing = new MockLicensingService();
    const layerArn = `arn:aws:lambda:${explicitRegion}:${accountId}:layer:LambdaKata:1`;
    mockLicensing.setEntitled(accountId, layerArn);

    // Apply transformation - should use context region
    const result = await kataWithAccountId(lambda, accountId, explicitRegion, {
        licensingService: mockLicensing,
    });

    // Verify transformation succeeded
    expect(result.transformed).toBe(true);
});

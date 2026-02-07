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
 * SnapStart Activator - Custom Resource Handler
 *
 * This module provides the Lambda handler for a CloudFormation Custom Resource
 * that enables SnapStart on Lambda functions after deployment. SnapStart requires
 * asynchronous waiting for snapshot creation, which cannot be done during CDK synthesis.
 *
 * The activation process:
 * 1. Wait for function to be Active
 * 2. Enable SnapStart configuration
 * 3. Wait for configuration update
 * 4. Publish new version (triggers snapshot creation)
 * 5. Wait for snapshot to be ready (up to 3 minutes)
 * 6. Create/update 'kata' alias pointing to the new version
 *
 * @module snapstart-activator
 */

import {
    LambdaClient,
    UpdateFunctionConfigurationCommand,
    PublishVersionCommand,
    GetFunctionConfigurationCommand,
    CreateAliasCommand,
    UpdateAliasCommand,
    GetAliasCommand,
    ResourceNotFoundException,
    waitUntilFunctionUpdatedV2,
    waitUntilFunctionActiveV2,
} from '@aws-sdk/client-lambda';

/**
 * Custom Resource event from CloudFormation.
 */
export interface CustomResourceEvent {
    RequestType: 'Create' | 'Update' | 'Delete';
    ServiceToken: string;
    ResponseURL: string;
    StackId: string;
    RequestId: string;
    ResourceType: string;
    LogicalResourceId: string;
    PhysicalResourceId?: string;
    ResourceProperties: {
        ServiceToken: string;
        FunctionName: string;
        AliasName?: string;
    };
    OldResourceProperties?: {
        FunctionName: string;
        AliasName?: string;
    };
}

/**
 * Custom Resource response to CloudFormation.
 */
export interface CustomResourceResponse {
    Status: 'SUCCESS' | 'FAILED';
    Reason?: string;
    PhysicalResourceId: string;
    StackId: string;
    RequestId: string;
    LogicalResourceId: string;
    Data?: {
        Version?: string;
        AliasName?: string;
        AliasArn?: string;
        OptimizationStatus?: string;
    };
}

/**
 * Result of SnapStart activation.
 */
export interface SnapStartActivationResult {
    version: string;
    aliasName: string;
    aliasArn: string;
    optimizationStatus: string;
}

/**
 * Configuration for SnapStart activation.
 */
export interface SnapStartActivatorConfig {
    /** Maximum time to wait for snapshot creation in seconds. Default: 180 (3 minutes) */
    snapshotTimeoutSeconds?: number;
    /** Polling interval in seconds. Default: 2 */
    pollingIntervalSeconds?: number;
    /** Alias name to create/update. Default: 'kata' */
    aliasName?: string;
}

const DEFAULT_CONFIG: Required<SnapStartActivatorConfig> = {
    snapshotTimeoutSeconds: 180,
    pollingIntervalSeconds: 2,
    aliasName: 'kata',
};

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Activates SnapStart on a Lambda function.
 *
 * This function performs the full SnapStart activation cycle:
 * 1. Ensures function is Active
 * 2. Enables SnapStart configuration
 * 3. Waits for configuration update
 * 4. Publishes new version
 * 5. Waits for snapshot creation
 * 6. Creates/updates alias
 *
 * @param lambdaClient - AWS Lambda client
 * @param functionName - Name or ARN of the Lambda function
 * @param config - Optional configuration
 * @returns Activation result with version and alias information
 */
export async function activateSnapStart(
    lambdaClient: LambdaClient,
    functionName: string,
    config?: SnapStartActivatorConfig,
): Promise<SnapStartActivationResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const maxAttempts = Math.ceil(cfg.snapshotTimeoutSeconds / cfg.pollingIntervalSeconds);

    console.log('='.repeat(60));
    console.log('SNAPSTART ACTIVATION CYCLE');
    console.log('='.repeat(60));
    console.log(`Function: ${functionName}`);
    console.log(`Timeout: ${cfg.snapshotTimeoutSeconds}s, Polling: ${cfg.pollingIntervalSeconds}s`);

    // Step 0: Ensure function is Active before starting
    console.log('\n[0/5] Ensuring function is Active...');
    await waitUntilFunctionActiveV2(
        { client: lambdaClient, maxWaitTime: 60 },
        { FunctionName: functionName }
    );
    console.log('      Function is Active');

    // Step 1: Enable SnapStart on the function
    console.log('\n[1/5] Enabling SnapStart (ApplyOn: PublishedVersions)...');
    await lambdaClient.send(new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        SnapStart: { ApplyOn: 'PublishedVersions' },
    }));
    console.log('      SnapStart configuration sent');

    // Step 2: Wait for configuration update to complete
    console.log('[2/5] Waiting for configuration update...');
    await waitUntilFunctionUpdatedV2(
        { client: lambdaClient, maxWaitTime: 120 },
        { FunctionName: functionName }
    );
    console.log('      Configuration updated successfully');

    // Step 3: Publish new version to create snapshot
    console.log('[3/5] Publishing new version to create SnapStart snapshot...');
    const publishResponse = await lambdaClient.send(new PublishVersionCommand({
        FunctionName: functionName,
        Description: `SnapStart enabled - ${new Date().toISOString()}`,
    }));
    const version = publishResponse.Version!;
    console.log(`      Published version: ${version}`);

    // Step 4: Wait for snapshot optimization and verify status
    console.log('[4/5] Waiting for SnapStart snapshot creation (this may take 1-3 minutes)...');
    let optimizationStatus = 'Unknown';
    let state = 'Unknown';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const versionConfig = await lambdaClient.send(new GetFunctionConfigurationCommand({
            FunctionName: functionName,
            Qualifier: version,
        }));

        const snapStartStatus = versionConfig.SnapStart ?? {};
        optimizationStatus = snapStartStatus.OptimizationStatus ?? 'Unknown';
        state = versionConfig.State ?? 'Unknown';

        if (state === 'Active') {
            console.log('      SnapStart snapshot ready!');
            console.log(`      OptimizationStatus: ${optimizationStatus}`);
            console.log(`      State: ${state}`);
            break;
        } else if (state === 'Failed') {
            const stateReason = versionConfig.StateReason ?? 'Unknown';
            console.log(`      ERROR: Snapshot creation failed - ${stateReason}`);
            throw new Error(`SnapStart snapshot creation failed: ${stateReason}`);
        } else {
            // Show progress every 10 attempts or first 5
            if (attempt % 10 === 0 || attempt < 5) {
                const elapsed = attempt * cfg.pollingIntervalSeconds;
                console.log(`      Creating snapshot... Status: ${optimizationStatus}, State: ${state} (${elapsed}s elapsed)`);
            }
        }

        await sleep(cfg.pollingIntervalSeconds * 1000);
    }

    // Check if we timed out
    if (state !== 'Active') {
        console.log(`      Warning: Snapshot creation timeout after ${cfg.snapshotTimeoutSeconds}s`);
        console.log(`      Final status: OptimizationStatus=${optimizationStatus}, State=${state}`);
        console.log('      The alias will be created, but function may not be ready yet');
    }

    // Step 5: Create or update alias
    console.log(`[5/5] Creating/updating alias '${cfg.aliasName}' -> version ${version}...`);
    let aliasArn: string;

    try {
        // Try to get existing alias
        await lambdaClient.send(new GetAliasCommand({
            FunctionName: functionName,
            Name: cfg.aliasName,
        }));

        // Alias exists, update it
        const updateResponse = await lambdaClient.send(new UpdateAliasCommand({
            FunctionName: functionName,
            Name: cfg.aliasName,
            FunctionVersion: version,
            Description: 'Lambda Kata SnapStart-enabled version',
        }));
        aliasArn = updateResponse.AliasArn!;
        console.log(`      Updated existing alias: ${aliasArn}`);
    } catch (error) {
        // Check by error name for better testability
        const isResourceNotFound = error instanceof ResourceNotFoundException ||
            (error instanceof Error && error.name === 'ResourceNotFoundException');

        if (isResourceNotFound) {
            // Alias doesn't exist, create it
            const createResponse = await lambdaClient.send(new CreateAliasCommand({
                FunctionName: functionName,
                Name: cfg.aliasName,
                FunctionVersion: version,
                Description: 'Lambda Kata SnapStart-enabled version',
            }));
            aliasArn = createResponse.AliasArn!;
            console.log(`      Created new alias: ${aliasArn}`);
        } else {
            throw error;
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('SNAPSTART ACTIVATION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Version: ${version}`);
    console.log(`Alias: ${cfg.aliasName} -> ${aliasArn}`);
    console.log(`OptimizationStatus: ${optimizationStatus}`);

    return {
        version,
        aliasName: cfg.aliasName,
        aliasArn,
        optimizationStatus,
    };
}

/**
 * Lambda handler for CloudFormation Custom Resource.
 *
 * This handler is invoked by CloudFormation when the custom resource
 * is created, updated, or deleted.
 */
export async function handler(event: CustomResourceEvent): Promise<CustomResourceResponse> {
    console.log('Custom Resource Event:', JSON.stringify(event, null, 2));

    const { RequestType, StackId, RequestId, LogicalResourceId, ResourceProperties } = event;
    const functionName = ResourceProperties.FunctionName;
    const aliasName = ResourceProperties.AliasName ?? 'kata';

    // Physical resource ID format: {functionName}:snapstart:{aliasName}
    const physicalResourceId = event.PhysicalResourceId ?? `${functionName}:snapstart:${aliasName}`;

    const baseResponse: Omit<CustomResourceResponse, 'Status' | 'Reason' | 'Data'> = {
        PhysicalResourceId: physicalResourceId,
        StackId,
        RequestId,
        LogicalResourceId,
    };

    try {
        if (RequestType === 'Delete') {
            // On delete, we don't remove SnapStart or the alias
            // The Lambda function itself will be deleted by CloudFormation
            console.log('Delete request - no action needed (Lambda will be deleted by CloudFormation)');
            return {
                ...baseResponse,
                Status: 'SUCCESS',
            };
        }

        // Create or Update - activate SnapStart
        const lambdaClient = new LambdaClient({});

        const result = await activateSnapStart(lambdaClient, functionName, { aliasName });

        return {
            ...baseResponse,
            Status: 'SUCCESS',
            Data: {
                Version: result.version,
                AliasName: result.aliasName,
                AliasArn: result.aliasArn,
                OptimizationStatus: result.optimizationStatus,
            },
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('SnapStart activation failed:', errorMessage);

        return {
            ...baseResponse,
            Status: 'FAILED',
            Reason: `SnapStart activation failed: ${errorMessage}`,
        };
    }
}

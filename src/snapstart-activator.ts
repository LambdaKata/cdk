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
 * Result of a successful SnapStart activation cycle.
 *
 * Returned by {@link activateSnapStart} after enabling SnapStart,
 * publishing a version, waiting for snapshot readiness, and creating/updating an alias.
 *
 * @see {@link SnapStartActivatorConfig} for configuration options
 */
export interface SnapStartActivationResult {
    /** The published Lambda version number (e.g. "42"). */
    version: string;
    /** The alias name that was created or updated (e.g. "kata"). */
    aliasName: string;
    /** The full ARN of the alias (e.g. "arn:aws:lambda:us-east-1:123456789012:function:my-fn:kata"). */
    aliasArn: string;
    /** The SnapStart optimization status of the published version ("On", "Off", or "Unknown"). */
    optimizationStatus: string;
}

/**
 * Configuration options for the SnapStart activation cycle.
 *
 * All properties are optional and fall back to sensible defaults.
 *
 * @see {@link activateSnapStart} for the function that consumes this config
 */
export interface SnapStartActivatorConfig {
    /**
     * Maximum time in seconds to wait for snapshot creation before proceeding.
     * If exceeded, a warning is logged and alias creation continues.
     * @default 180
     */
    snapshotTimeoutSeconds?: number;
    /**
     * Interval in seconds between polling attempts for snapshot readiness.
     * @default 2
     */
    pollingIntervalSeconds?: number;
    /**
     * The Lambda alias name to create or update after publishing a version.
     * @default 'kata'
     */
    aliasName?: string;
    /**
     * @internal Override pre-publish delay in milliseconds (for testing only).
     * @default 3000
     */
    _prePublishDelayMs?: number;
    /**
     * @internal Override retry delay in milliseconds (for testing only).
     * @default 5000
     */
    _retryDelayMs?: number;
}

/**
 * Maximum number of PublishVersion + snapshot polling attempts.
 * Each retry publishes a NEW version (new snapshot attempt).
 * Bounded to prevent infinite loops; total worst-case time:
 * 5 * (15s delay + publish + 180s poll) ≈ 16min, within Lambda 15min limit
 * (but snapshot timeout is typically much shorter than 180s per attempt).
 */
const MAX_PUBLISH_RETRIES = 5;

/**
 * Delay in milliseconds before retrying a failed snapshot creation.
 * Set to 15s to give transient Lambda init failures time to clear.
 */
const RETRY_DELAY_MS = 15000;

/**
 * Delay in milliseconds after waitUntilFunctionUpdatedV2 completes,
 * before the first PublishVersion call. Mitigates eventual consistency
 * between Lambda config update propagation and PublishVersion init phase.
 */
const PRE_PUBLISH_DELAY_MS = 3000;

const DEFAULT_CONFIG: Required<SnapStartActivatorConfig> = {
    snapshotTimeoutSeconds: 180,
    pollingIntervalSeconds: 2,
    aliasName: 'kata',
    _prePublishDelayMs: PRE_PUBLISH_DELAY_MS,
    _retryDelayMs: RETRY_DELAY_MS,
};

/**
 * Sleep for specified milliseconds.
 * @internal Exported for testability — tests can jest.spyOn to avoid real delays.
 */
export const _testable = {
    sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
};

/**
 * Checks whether an error (or its cause chain) is a ResourceNotFoundException.
 *
 * AWS SDK v3 waiters may throw the underlying service exception directly,
 * or wrap it in a waiter-state error. This helper inspects both the error
 * itself and its `cause` property to detect either case.
 */
function isResourceNotFoundError(error: unknown): boolean {
    if (error instanceof ResourceNotFoundException) {
        return true;
    }
    if (error instanceof Error) {
        if (error.name === 'ResourceNotFoundException') {
            return true;
        }
        // Waiters may wrap the service exception in a cause chain
        const cause = (error as Error & { cause?: unknown }).cause;
        if (cause instanceof ResourceNotFoundException) {
            return true;
        }
        if (cause instanceof Error && cause.name === 'ResourceNotFoundException') {
            return true;
        }
    }
    return false;
}

/**
 * Required IAM permissions for SnapStart activation.
 * Used in error messages to guide users when AccessDeniedException occurs.
 */
const REQUIRED_PERMISSIONS: readonly string[] = [
    'lambda:GetFunction',
    'lambda:GetFunctionConfiguration',
    'lambda:UpdateFunctionConfiguration',
    'lambda:PublishVersion',
    'lambda:GetAlias',
    'lambda:CreateAlias',
    'lambda:UpdateAlias',
];

/**
 * Checks whether an error is an AccessDeniedException.
 *
 * AWS SDK v3 may throw AccessDeniedException directly or wrap it.
 * This helper inspects both the error itself and its `cause` property.
 */
function isAccessDeniedError(error: unknown): boolean {
    if (error instanceof Error) {
        if (error.name === 'AccessDeniedException') {
            return true;
        }
        const cause = (error as Error & { cause?: unknown }).cause;
        if (cause instanceof Error && cause.name === 'AccessDeniedException') {
            return true;
        }
    }
    return false;
}


/**
 * Activates SnapStart on a Lambda function.
 *
 * This function performs the full SnapStart activation cycle:
 * 1. Ensures function is Active
 * 2. Enables SnapStart configuration
 * 3. Waits for configuration update
 * 4. Publishes new version (with retry on snapshot failure)
 * 5. Waits for snapshot creation
 * 6. Creates/updates alias
 *
 * Steps 3+4 are wrapped in a retry loop: on State: Failed, a new version
 * is published (up to MAX_PUBLISH_RETRIES attempts) to handle transient
 * initialization failures during snapshot creation.
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
    console.log(`Max publish retries: ${MAX_PUBLISH_RETRIES}`);

    try {
        // Step 0: Ensure function is Active before starting
        console.log('\n[0/5] Ensuring function is Active...');
        try {
            await waitUntilFunctionActiveV2(
                { client: lambdaClient, maxWaitTime: 60 },
                { FunctionName: functionName }
            );
        } catch (error) {
            if (isResourceNotFoundError(error)) {
                throw new Error(`Lambda function '${functionName}' does not exist. Verify the function name or ARN is correct.`);
            }
            if (isAccessDeniedError(error)) {
                throw new Error(
                    `Insufficient permissions to activate SnapStart on '${functionName}'. ` +
                    `Ensure the execution role has the following permissions: ${REQUIRED_PERMISSIONS.join(', ')}`
                );
            }
            throw error;
        }
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
        try {
            await waitUntilFunctionUpdatedV2(
                { client: lambdaClient, maxWaitTime: 120 },
                { FunctionName: functionName }
            );
        } catch (error) {
            if (isResourceNotFoundError(error)) {
                throw new Error(`Lambda function '${functionName}' does not exist. Verify the function name or ARN is correct.`);
            }
            if (isAccessDeniedError(error)) {
                throw new Error(
                    `Insufficient permissions to activate SnapStart on '${functionName}'. ` +
                    `Ensure the execution role has the following permissions: ${REQUIRED_PERMISSIONS.join(', ')}`
                );
            }
            throw error;
        }
        console.log('      Configuration updated successfully');

        // Pre-publish delay: mitigate eventual consistency between
        // Lambda config update propagation and PublishVersion init phase
        console.log(`      Waiting ${cfg._prePublishDelayMs / 1000}s for configuration propagation...`);
        await _testable.sleep(cfg._prePublishDelayMs);

        // Steps 3+4: Publish version and wait for snapshot (WITH RETRY)
        let version: string = '';
        let optimizationStatus = 'Unknown';
        let state = 'Unknown';
        let lastFailReason = '';

        for (let publishAttempt = 1; publishAttempt <= MAX_PUBLISH_RETRIES; publishAttempt++) {
            // Step 3: Publish new version to create snapshot
            console.log(`[3/5] Publishing new version (attempt ${publishAttempt}/${MAX_PUBLISH_RETRIES})...`);

            // Before re-publish (attempt > 1), wait and ensure function is ready
            if (publishAttempt > 1) {
                console.log(`      Waiting ${cfg._retryDelayMs / 1000}s before retry...`);
                await _testable.sleep(cfg._retryDelayMs);
                console.log('      Ensuring function is Active before re-publish...');
                await waitUntilFunctionActiveV2(
                    { client: lambdaClient, maxWaitTime: 60 },
                    { FunctionName: functionName }
                );
                // Force a config update so PublishVersion creates a genuinely new version.
                // Without this, PublishVersion returns the same (Failed) version number
                // because Lambda deduplicates identical configurations.
                console.log('      Re-applying SnapStart config to force new version...');
                await lambdaClient.send(new UpdateFunctionConfigurationCommand({
                    FunctionName: functionName,
                    SnapStart: { ApplyOn: 'PublishedVersions' },
                }));
                await waitUntilFunctionUpdatedV2(
                    { client: lambdaClient, maxWaitTime: 120 },
                    { FunctionName: functionName }
                );
                console.log(`      Waiting ${cfg._prePublishDelayMs / 1000}s for configuration propagation...`);
                await _testable.sleep(cfg._prePublishDelayMs);
            }

            const publishResponse = await lambdaClient.send(new PublishVersionCommand({
                FunctionName: functionName,
                Description: `SnapStart enabled - ${new Date().toISOString()} (attempt ${publishAttempt})`,
            }));
            version = publishResponse.Version!;
            console.log(`      Published version: ${version}`);

            // Step 4: Wait for snapshot optimization and verify status
            console.log('[4/5] Waiting for SnapStart snapshot creation...');
            state = 'Unknown';

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
                    lastFailReason = versionConfig.StateReason ?? 'Unknown';
                    console.log(`      Snapshot creation failed: ${lastFailReason}`);
                    break;
                } else {
                    // Show progress every 10 attempts or first 5
                    if (attempt % 10 === 0 || attempt < 5) {
                        const elapsed = attempt * cfg.pollingIntervalSeconds;
                        console.log(`      Creating snapshot... Status: ${optimizationStatus}, State: ${state} (${elapsed}s elapsed)`);
                    }
                }

                await _testable.sleep(cfg.pollingIntervalSeconds * 1000);
            }

            // If snapshot succeeded, break out of retry loop
            if (state === 'Active') {
                break;
            }

            // Only retry on Failed state — timeout (Pending) should not retry
            if (state !== 'Failed') {
                break;
            }

            // If failed and we have retries left, log and continue
            if (publishAttempt < MAX_PUBLISH_RETRIES) {
                console.log(`      Snapshot failed on attempt ${publishAttempt}, will retry with new version...`);
                console.log(`      Reason: ${lastFailReason}`);
            }
        }

        // After all retries, check final state
        if (state === 'Failed') {
            console.log(`      All ${MAX_PUBLISH_RETRIES} snapshot attempts failed.`);
            console.log(`      Reason: ${lastFailReason}`);
            console.log('');
            console.log('      [Lambda Kata] SnapStart optimization failed. Alias will be created pointing');
            console.log('      to the latest version. Function remains operational without SnapStart.');
            console.log('      Review CloudWatch logs for initialization errors.');
        }

        // Check if we timed out
        if (state !== 'Active' && state !== 'Failed') {
            console.log(`      Warning: Snapshot creation timeout after ${cfg.snapshotTimeoutSeconds}s`);
            console.log(`      Final status: OptimizationStatus=${optimizationStatus}, State=${state}`);
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
    } catch (error) {
        // Catch AccessDeniedException from any Lambda API call (send calls)
        // that isn't already handled by the waiter try-catch blocks
        if (isAccessDeniedError(error)) {
            throw new Error(
                `Insufficient permissions to activate SnapStart on '${functionName}'. ` +
                `Ensure the execution role has the following permissions: ${REQUIRED_PERMISSIONS.join(', ')}`
            );
        }
        throw error;
    }
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

        // On Update requests, return SUCCESS even on failure to prevent
        // CloudFormation rollback from getting stuck in UPDATE_ROLLBACK_FAILED.
        // Returning FAILED from an Update during rollback blocks the entire stack.
        // The function remains operational with its previous configuration.
        if (RequestType === 'Update') {
            console.log('Returning SUCCESS for Update request to prevent rollback deadlock.');
            console.log('The function will continue with its previous SnapStart configuration.');
            return {
                ...baseResponse,
                Status: 'SUCCESS',
                Reason: `SnapStart activation failed (non-blocking): ${errorMessage}`,
            };
        }

        return {
            ...baseResponse,
            Status: 'FAILED',
            Reason: `SnapStart activation failed: ${errorMessage}`,
        };
    }
}

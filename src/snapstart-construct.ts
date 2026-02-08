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
 * SnapStart Construct - CDK Custom Resource for SnapStart Activation
 *
 * This module provides a CDK construct that creates a Custom Resource
 * to enable SnapStart on Lambda functions after deployment. The construct
 * handles the asynchronous nature of SnapStart snapshot creation.
 *
 * @module snapstart-construct
 */

import { Construct } from 'constructs';
import { CustomResource, Duration, Stack } from 'aws-cdk-lib';
import { Function as LambdaFunction, Runtime, Code, IFunction } from 'aws-cdk-lib/aws-lambda';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

/**
 * Properties for the {@link SnapStartActivator} construct.
 *
 * @see {@link SnapStartActivator} for the construct that consumes these properties
 */
export interface SnapStartActivatorProps {
  /**
   * The Lambda function to enable SnapStart on.
   * The construct will add a dependency so the Custom Resource runs after this function is created.
   */
  targetFunction: IFunction;

  /**
   * The alias name to create or update after publishing a SnapStart-enabled version.
   * @default 'kata'
   */
  aliasName?: string;

  /**
   * Maximum time in seconds to wait for SnapStart snapshot creation.
   * The Custom Resource handler timeout is set to this value plus a 60-second buffer.
   * @default 180
   */
  snapshotTimeoutSeconds?: number;
}

/**
 * CDK Construct that enables SnapStart on a Lambda function after deployment.
 *
 * Creates a CloudFormation Custom Resource backed by a Lambda handler that
 * performs the full SnapStart activation cycle during stack deployment:
 *
 * 1. Waits for the target function to reach Active state
 * 2. Enables SnapStart configuration (`ApplyOn: PublishedVersions`)
 * 3. Publishes a new version (triggers snapshot creation)
 * 4. Polls until the snapshot is ready (or timeout is reached)
 * 5. Creates or updates an alias pointing to the new version
 *
 * After deployment, the published version number and alias ARN are available
 * as CloudFormation attributes via {@link versionRef} and {@link aliasArnRef}.
 *
 * @example
 * ```typescript
 * const myFunction = new lambda.Function(this, 'MyFunction', { ... });
 *
 * const snapStart = new SnapStartActivator(this, 'SnapStart', {
 *   targetFunction: myFunction,
 *   aliasName: 'kata',
 *   snapshotTimeoutSeconds: 180,
 * });
 *
 * // Reference outputs after deployment
 * new CfnOutput(this, 'Version', { value: snapStart.versionRef });
 * new CfnOutput(this, 'AliasArn', { value: snapStart.aliasArnRef });
 * ```
 *
 * @see {@link SnapStartActivatorProps} for configuration options
 */
export class SnapStartActivator extends Construct {
  /**
   * The alias name that was created or updated (e.g. "kata").
   *
   * This is a static property set at synthesis time from {@link SnapStartActivatorProps.aliasName}.
   */
  public readonly aliasName: string;

  /**
   * The Custom Resource that manages SnapStart activation during deployment.
   *
   * Use this to add additional dependencies or access CloudFormation attributes.
   */
  public readonly resource: CustomResource;

  /**
   * The version number created by SnapStart activation (CloudFormation attribute).
   *
   * This value is resolved at deployment time when the Custom Resource handler
   * publishes a new Lambda version. Use it in `CfnOutput` or other constructs
   * that need to reference the published version.
   */
  public readonly versionRef: string;

  /**
   * The alias ARN created by SnapStart activation (CloudFormation attribute).
   *
   * This value is resolved at deployment time when the Custom Resource handler
   * creates or updates the alias. Use it in `CfnOutput` or other constructs
   * that need to reference the alias.
   */
  public readonly aliasArnRef: string;

  constructor(scope: Construct, id: string, props: SnapStartActivatorProps) {
    super(scope, id);

    this.aliasName = props.aliasName ?? 'kata';
    const timeoutSeconds = props.snapshotTimeoutSeconds ?? 180;

    // Create the provider function with permissions baked into its initial role policy.
    // Using initialPolicy instead of addToRolePolicy ensures the IAM policy is created
    // as part of the role itself, avoiding race conditions where CloudFormation invokes
    // the Custom Resource before a separate inline policy resource is applied.
    const providerFunction = this.createProviderFunction(timeoutSeconds, props.targetFunction);

    // Create the Custom Resource provider
    const provider = new Provider(this, 'Provider', {
      onEventHandler: providerFunction,
    });

    // Create the Custom Resource
    this.resource = new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        FunctionName: props.targetFunction.functionName,
        AliasName: this.aliasName,
        SnapshotTimeoutSeconds: timeoutSeconds.toString(),
        // Add a timestamp to force update on each deployment
        Timestamp: Date.now().toString(),
      },
    });

    // Ensure the Custom Resource runs after the Lambda function is created
    this.resource.node.addDependency(props.targetFunction);

    // Export references to the created resources
    this.versionRef = this.resource.getAttString('Version');
    this.aliasArnRef = this.resource.getAttString('AliasArn');
  }

  /**
   * Creates the Lambda function that handles Custom Resource events.
   * Permissions are passed via initialPolicy to ensure they are part of the
   * role creation (not a separate AWS::IAM::Policy resource), preventing
   * IAM propagation race conditions.
   */
  private createProviderFunction(timeoutSeconds: number, targetFunction: IFunction): LambdaFunction {
    const handlerCode = this.generateHandlerCode();

    const fn = new LambdaFunction(this, 'Handler', {
      runtime: Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: Code.fromInline(handlerCode),
      timeout: Duration.seconds(timeoutSeconds + 60), // Extra time for setup/teardown
      description: 'Lambda Kata SnapStart Activator - Custom Resource Handler',
      memorySize: 256,
      initialPolicy: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'lambda:GetFunction',
            'lambda:GetFunctionConfiguration',
            'lambda:UpdateFunctionConfiguration',
            'lambda:PublishVersion',
            'lambda:GetAlias',
            'lambda:CreateAlias',
            'lambda:UpdateAlias',
          ],
          resources: [
            targetFunction.functionArn,
            `${targetFunction.functionArn}:*`,
          ],
        }),
      ],
    });

    return fn;
  }

  /**
   * Generates the inline handler code for the Custom Resource.
   *
   * This is a self-contained version of the snapstart-activator logic
   * that can be deployed as inline Lambda code.
   */
  private generateHandlerCode(): string {
    return `
const { LambdaClient, UpdateFunctionConfigurationCommand, PublishVersionCommand,
        GetFunctionConfigurationCommand, CreateAliasCommand, UpdateAliasCommand,
        GetAliasCommand, waitUntilFunctionUpdatedV2, waitUntilFunctionActiveV2 } = require('@aws-sdk/client-lambda');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const { RequestType, ResourceProperties } = event;
  const functionName = ResourceProperties.FunctionName;
  const aliasName = ResourceProperties.AliasName || 'kata';
  
  if (RequestType === 'Delete') {
    console.log('Delete request - no action needed');
    return { Version: 'N/A', AliasName: aliasName, AliasArn: 'N/A', OptimizationStatus: 'N/A' };
  }
  
  const client = new LambdaClient({});
  const snapshotTimeoutSeconds = parseInt(ResourceProperties.SnapshotTimeoutSeconds || '180', 10);
  const pollingInterval = 2000;
  const maxAttempts = Math.ceil((snapshotTimeoutSeconds * 1000) / pollingInterval);
  
  console.log('='.repeat(60));
  console.log('SNAPSTART ACTIVATION CYCLE');
  console.log('='.repeat(60));
  
  // Step 0: Wait for function to be Active
  console.log('[0/5] Ensuring function is Active...');
  await waitUntilFunctionActiveV2({ client, maxWaitTime: 60 }, { FunctionName: functionName });
  console.log('      Function is Active');
  
  // Step 1: Enable SnapStart
  console.log('[1/5] Enabling SnapStart...');
  await client.send(new UpdateFunctionConfigurationCommand({
    FunctionName: functionName,
    SnapStart: { ApplyOn: 'PublishedVersions' }
  }));
  
  // Step 2: Wait for configuration update
  console.log('[2/5] Waiting for configuration update...');
  await waitUntilFunctionUpdatedV2({ client, maxWaitTime: 120 }, { FunctionName: functionName });
  console.log('      Configuration updated');
  
  // Step 3: Publish version
  console.log('[3/5] Publishing new version...');
  const publishResponse = await client.send(new PublishVersionCommand({
    FunctionName: functionName,
    Description: 'SnapStart enabled - ' + new Date().toISOString()
  }));
  const version = publishResponse.Version;
  console.log('      Published version:', version);
  
  // Step 4: Wait for snapshot
  console.log('[4/5] Waiting for snapshot creation...');
  let optimizationStatus = 'Unknown';
  let state = 'Unknown';
  
  for (let i = 0; i < maxAttempts; i++) {
    const config = await client.send(new GetFunctionConfigurationCommand({
      FunctionName: functionName,
      Qualifier: version
    }));
    
    optimizationStatus = config.SnapStart?.OptimizationStatus || 'Unknown';
    state = config.State || 'Unknown';
    
    if (state === 'Active') {
      console.log('      Snapshot ready! Status:', optimizationStatus);
      break;
    } else if (state === 'Failed') {
      throw new Error('Snapshot creation failed: ' + (config.StateReason || 'Unknown'));
    }
    
    if (i % 10 === 0) console.log('      Creating snapshot... State:', state, '(' + (i * 2) + 's)');
    await sleep(pollingInterval);
  }
  
  // Step 5: Create/update alias
  console.log('[5/5] Creating/updating alias...');
  let aliasArn;
  
  try {
    await client.send(new GetAliasCommand({ FunctionName: functionName, Name: aliasName }));
    const updateResp = await client.send(new UpdateAliasCommand({
      FunctionName: functionName,
      Name: aliasName,
      FunctionVersion: version,
      Description: 'Lambda Kata SnapStart-enabled version'
    }));
    aliasArn = updateResp.AliasArn;
    console.log('      Updated alias:', aliasArn);
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') {
      const createResp = await client.send(new CreateAliasCommand({
        FunctionName: functionName,
        Name: aliasName,
        FunctionVersion: version,
        Description: 'Lambda Kata SnapStart-enabled version'
      }));
      aliasArn = createResp.AliasArn;
      console.log('      Created alias:', aliasArn);
    } else {
      throw e;
    }
  }
  
  console.log('='.repeat(60));
  console.log('SNAPSTART ACTIVATION COMPLETE');
  console.log('='.repeat(60));
  
  return { Version: version, AliasName: aliasName, AliasArn: aliasArn, OptimizationStatus: optimizationStatus };
};
`;
  }
}

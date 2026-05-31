/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Config Layer Example CDK Stack
 *
 * This example demonstrates the config layer that `kata()` attaches to a
 * transformed Lambda function. The original handler path is stored in a
 * dedicated config layer at `/opt/.kata/original_handler.json`, which the
 * Lambda Kata runtime reads during initialization.
 *
 * ## What kata() does
 *
 * When you call `kata(myFunction)` on an entitled AWS account:
 *
 * 1. Creates a config layer containing `/opt/.kata/original_handler.json`
 *    with `{ "original_js_handler": "<your handler>" }`
 * 2. Attaches the config layer and the customer-specific Lambda Kata layer
 * 3. Changes the runtime to `python3.12`
 * 4. Sets the handler to `lambdakata.optimized_handler.lambda_handler`
 *
 * Your original JavaScript/TypeScript code remains unchanged.
 *
 * ## Verification
 *
 * The example handler reads `/opt/.kata/original_handler.json` and returns its
 * contents, so you can confirm the config layer is mounted and contains the
 * original handler path.
 *
 * @example
 * ```bash
 * # From your CDK application directory
 * npx cdk deploy ConfigLayerExampleStack
 *
 * # Invoke the deployed function
 * aws lambda invoke --function-name ConfigLayerExampleFunction output.json
 * cat output.json
 * ```
 */

import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

// Import the kata wrapper from the @lambdakata/cdk package
import { kata } from '@lambdakata/cdk';

/**
 * Example CDK Stack demonstrating the config layer.
 *
 * This stack creates a Lambda function whose handler reads the config layer
 * file and returns its contents.
 */
export class ConfigLayerExampleStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // ============================================================
        // Create a Node.js Lambda function
        // ============================================================
        //
        // A standard NodejsFunction. The handler reads the config layer file
        // to demonstrate the config layer is mounted at runtime.
        //
        const configLayerExample = new NodejsFunction(this, 'ConfigLayerExampleFunction', {
            // Entry point to the handler
            entry: path.join(__dirname, 'handler.ts'),

            // Handler export name - this is stored in the config layer
            handler: 'handler',

            // Original runtime - transformed to python3.12 by kata()
            runtime: Runtime.NODEJS_20_X,

            // Standard Lambda configuration
            memorySize: 256,
            timeout: Duration.seconds(30),

            // Function name for easy identification
            functionName: 'ConfigLayerExampleFunction',

            // Description
            description: 'Example Lambda demonstrating the Lambda Kata config layer',

            // User environment variables - preserved by kata()
            environment: {
                LOG_LEVEL: 'DEBUG',
                EXAMPLE_CONFIG: 'config-layer-demo',
            },
        });

        // ============================================================
        // Wrap with kata()
        // ============================================================
        //
        // kata() creates the config layer with the original handler path,
        // attaches it alongside the customer Lambda Kata layer, switches the
        // runtime to python3.12, and sets the handler to
        // lambdakata.optimized_handler.lambda_handler.
        //
        // The original handler path ('handler') is stored in:
        //   /opt/.kata/original_handler.json
        //
        // Content: { "original_js_handler": "handler" }
        //
        kata(configLayerExample);

        // ============================================================
        // Stack Outputs
        // ============================================================
        new CfnOutput(this, 'FunctionName', {
            value: configLayerExample.functionName,
            description: 'Lambda function name for testing',
        });

        new CfnOutput(this, 'FunctionArn', {
            value: configLayerExample.functionArn,
            description: 'Lambda function ARN',
        });
    }
}

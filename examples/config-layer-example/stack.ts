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
 * Config Layer Example CDK Stack
 *
 * This example demonstrates the config layer approach for Lambda Kata integration.
 * Instead of using environment variables, the original handler path and bundle path
 * are stored in a dedicated config layer at /opt/.kata/original_handler.json.
 *
 * ## Key Points
 *
 * 1. **No JS_HANDLER_PATH**: The kata() wrapper does not set this environment variable
 * 2. **No JS_BUNDLE_PATH**: Bundle path is also stored in config layer
 * 3. **Config Layer**: All config is stored in /opt/.kata/original_handler.json
 * 4. **Cleaner Separation**: Configuration is separated from environment variables
 * 5. **Same Developer Experience**: Just call kata(myFunction) - it works the same way
 *
 * ## How It Works
 *
 * When you call kata(myFunction):
 * 1. A config layer is created with your original handler path
 * 2. The config layer is attached to your Lambda
 * 3. Runtime is changed to Python 3.12
 * 4. Handler is set to handler.lambda_handler
 * 5. Lambda Kata Layer is attached
 * 6. No Lambda Kata-specific environment variables are added
 *
 * ## Verification
 *
 * The example handler includes verification logic to confirm:
 * - JS_HANDLER_PATH environment variable is NOT set
 * - Config layer exists at /opt/.kata/original_handler.json
 * - Config layer contains the correct original_js_handler value
 *
 * @example
 * ```bash
 * # Deploy this stack
 * cd cdk-integration
 * npx cdk deploy ConfigLayerExampleStack
 *
 * # Test the function
 * aws lambda invoke --function-name ConfigLayerExampleFunction output.json
 * cat output.json
 * ```
 */

import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

// Import the kata wrapper from the @lambda-kata/cdk package
import { kata } from '@lambda-kata/cdk';

/**
 * Example CDK Stack demonstrating the config layer approach.
 *
 * This stack creates a Lambda function that verifies the config layer
 * is correctly set up and that JS_HANDLER_PATH is NOT used.
 *
 * Requirements validated:
 * - 7.1: Demonstrates kata() wrapper with config layer
 * - 7.2: Does NOT use JS_HANDLER_PATH environment variable
 * - 7.3: Deployable and testable end-to-end
 * - 7.4: Includes verification of handler path resolution from config layer
 */
export class ConfigLayerExampleStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // ============================================================
        // Create a Node.js Lambda function
        // ============================================================
        //
        // This is a standard NodejsFunction. The handler includes
        // verification logic to confirm the config layer approach works.
        //
        const configLayerExample = new NodejsFunction(this, 'ConfigLayerExampleFunction', {
            // Entry point to the handler
            entry: path.join(__dirname, 'handler.ts'),

            // Handler export name - this will be stored in the config layer
            handler: 'handler',

            // Original runtime - will be transformed to Python 3.12
            runtime: Runtime.NODEJS_18_X,

            // Standard Lambda configuration
            memorySize: 256,
            timeout: Duration.seconds(30),

            // Function name for easy identification
            functionName: 'ConfigLayerExampleFunction',

            // Description
            description: 'Example Lambda demonstrating config layer approach (no JS_HANDLER_PATH)',

            // User environment variables - these are preserved
            environment: {
                LOG_LEVEL: 'DEBUG',
                EXAMPLE_CONFIG: 'config-layer-demo',
            },
        });

        // ============================================================
        // Wrap with kata() - Config Layer Approach
        // ============================================================
        //
        // The kata() wrapper now uses a config layer instead of
        // JS_HANDLER_PATH environment variable.
        //
        // BEFORE kata():
        //   - Runtime: nodejs18.x
        //   - Handler: index.handler
        //   - Layers: (none)
        //   - Environment: { LOG_LEVEL, EXAMPLE_CONFIG }
        //
        // AFTER kata():
        //   - Runtime: python3.12
        //   - Handler: handler.lambda_handler
        //   - Layers: [KataConfigLayer, LambdaKataLayer]
        //   - Environment: {
        //       LOG_LEVEL: 'DEBUG',           // Original preserved
        //       EXAMPLE_CONFIG: '...',        // Original preserved
        //       // NOTE: No Lambda Kata env vars added - all config in layer
        //     }
        //
        // The original handler path ('index.handler') is stored in:
        //   /opt/.kata/original_handler.json
        //
        // Content: { "original_js_handler": "index.handler" }
        //
        kata(configLayerExample);

        // ============================================================
        // Stack Outputs
        // ============================================================
        //
        // Output the function name and ARN for easy testing
        //
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

// ============================================================
// CDK App Entry Point (for standalone deployment)
// ============================================================
//
// To deploy this stack directly:
//
// 1. Uncomment the code below
// 2. Run: npx cdk deploy ConfigLayerExampleStack
//
// import { App } from 'aws-cdk-lib';
//
// const app = new App();
// new ConfigLayerExampleStack(app, 'ConfigLayerExampleStack', {
//     env: {
//         account: process.env.CDK_DEFAULT_ACCOUNT,
//         region: process.env.CDK_DEFAULT_REGION,
//     },
// });

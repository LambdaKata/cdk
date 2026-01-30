/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * Middleware Example CDK Stack
 *
 * This example demonstrates the middleware mechanism for Lambda Kata integration.
 * Middleware allows custom handler resolution logic via an esbuild-compiled
 * TypeScript/JavaScript module.
 *
 * ## Key Points
 *
 * 1. **Custom Handler Resolution**: Middleware controls how the handler is obtained
 * 2. **esbuild Compilation**: Middleware TypeScript is compiled automatically
 * 3. **Config Layer Integration**: Compiled middleware is placed at /opt/.kata/middleware.js
 * 4. **Handler Wrapping**: Middleware can wrap handlers with logging/metrics
 *
 * ## How It Works
 *
 * When you call kata(myFunction, { middlewarePath: '...' }):
 * 1. Middleware TypeScript is compiled with esbuild
 * 2. Compiled middleware is placed in the config layer at /opt/.kata/middleware.js
 * 3. Config JSON includes has_middleware: true
 * 4. At runtime, init_wrapper.js loads and calls the middleware
 * 5. Middleware returns the resolved handler function
 *
 * ## Middleware Function Signature
 *
 * ```typescript
 * type MiddlewareFunction = (
 *     bundle: unknown,
 *     context: { originalHandler: string }
 * ) => Function;
 * ```
 *
 * @example
 * ```bash
 * # Deploy this stack
 * cd cdk-integration
 * npx cdk deploy MiddlewareExampleStack
 *
 * # Test the function
 * aws lambda invoke --function-name MiddlewareExampleFunction output.json
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
 * Example CDK Stack demonstrating the middleware mechanism.
 *
 * This stack creates a Lambda function with custom middleware that
 * wraps the handler with logging functionality.
 *
 * Requirements validated:
 * - 2.4: Middleware module exports a function with signature (bundle, context) => handler
 * - 5.1: kata() wrapper accepts middlewarePath option
 */
export class MiddlewareExampleStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // ============================================================
        // Create a Node.js Lambda function
        // ============================================================
        //
        // This is a standard NodejsFunction. The middleware will wrap
        // this handler with logging functionality.
        //
        const middlewareExample = new NodejsFunction(this, 'MiddlewareExampleFunction', {
            // Entry point to the handler
            entry: path.join(__dirname, 'handler.ts'),

            // Handler export name - passed to middleware via context.originalHandler
            handler: 'handler',

            // Original runtime - will be transformed to Python 3.12
            runtime: Runtime.NODEJS_18_X,

            // Standard Lambda configuration
            memorySize: 256,
            timeout: Duration.seconds(30),

            // Function name for easy identification
            functionName: 'MiddlewareExampleFunction',

            // Description
            description: 'Example Lambda demonstrating middleware for custom handler resolution',

            // User environment variables - these are preserved
            environment: {
                LOG_LEVEL: 'DEBUG',
                EXAMPLE_CONFIG: 'middleware-demo',
            },
        });

        // ============================================================
        // Wrap with kata() using middlewarePath option
        // ============================================================
        //
        // The kata() wrapper with middlewarePath performs:
        //
        // 1. Compiles middleware.ts with esbuild
        // 2. Places compiled middleware at /opt/.kata/middleware.js
        // 3. Sets has_middleware: true in config JSON
        // 4. Applies standard Lambda Kata transformations
        //
        // BEFORE kata():
        //   - Runtime: nodejs18.x
        //   - Handler: index.handler
        //   - Layers: (none)
        //
        // AFTER kata():
        //   - Runtime: python3.12
        //   - Handler: lambdakata.optimized_handler.lambda_handler
        //   - Layers: [KataConfigLayer (with middleware.js), LambdaKataLayer]
        //   - Config: {
        //       original_js_handler: "index.handler",
        //       has_middleware: true
        //     }
        //
        kata(middlewareExample, {
            middlewarePath: path.join(__dirname, 'middleware.ts'),
        });

        // ============================================================
        // Stack Outputs
        // ============================================================
        //
        // Output the function name and ARN for easy testing
        //
        new CfnOutput(this, 'FunctionName', {
            value: middlewareExample.functionName,
            description: 'Lambda function name for testing',
        });

        new CfnOutput(this, 'FunctionArn', {
            value: middlewareExample.functionArn,
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
// 2. Run: npx cdk deploy MiddlewareExampleStack
//
// import { App } from 'aws-cdk-lib';
//
// const app = new App();
// new MiddlewareExampleStack(app, 'MiddlewareExampleStack', {
//     env: {
//         account: process.env.CDK_DEFAULT_ACCOUNT,
//         region: process.env.CDK_DEFAULT_REGION,
//     },
// });

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
 * Example CDK Stack demonstrating Lambda Kata integration
 *
 * This example shows how to use the `kata()` wrapper to transform a Node.js
 * Lambda function to run via the Lambda Kata runtime.
 *
 * ## How Lambda Kata Works
 *
 * Lambda Kata is a high-performance AWS Lambda runtime that enables Python 3.12
 * Lambda functions to execute JavaScript code through an embedded Node.js engine
 * via a C extension module.
 *
 * ## The Handler-From-Layer Pattern
 *
 * Lambda Kata uses a "handler-from-layer" architecture:
 *
 * 1. **Your Code Stays Unchanged**: Your original Node.js handler code remains
 *    in your function's code asset exactly as you wrote it.
 *
 * 2. **Runtime Transformation**: The `kata()` wrapper transforms your Lambda:
 *    - Runtime: Node.js → Python 3.12
 *    - Handler: Your handler → `lambdakata.optimized_handler.lambda_handler`
 *
 * 3. **Layer Provides the Handler**: The Lambda Kata Layer (attached automatically)
 *    contains the Python handler at `/opt/python/lambdakata/optimized_handler.py`.
 *    This handler is what Lambda actually invokes.
 *
 * 4. **JS_HANDLER_PATH Environment Variable**: Your original handler path
 *    (e.g., "index.handler") is stored in the `JS_HANDLER_PATH` environment
 *    variable. The Lambda Kata runtime uses this to locate and execute your
 *    JavaScript code.
 *
 * ## Execution Flow
 *
 * ```
 * Lambda Invocation
 *       ↓
 * Python 3.12 Runtime
 *       ↓
 * /opt/python/lambdakata/optimized_handler.py (from Layer)
 *       ↓
 * C Bridge (ctypes) → Node.js Subprocess
 *       ↓
 * Your JS Handler (via JS_HANDLER_PATH)
 *       ↓
 * Response returned to caller
 * ```
 *
 * ## Benefits
 *
 * - **SnapStart Optimization**: Near-zero cold start times
 * - **No Code Changes**: Your JavaScript code works as-is
 * - **Minimal Overhead**: <1ms execution overhead
 * - **AWS Marketplace Integration**: Licensing validated at deploy time
 *
 * @example
 * ```bash
 * # Deploy this stack
 * cdk deploy ExampleLambdaKataStack
 *
 * # Test the function
 * aws lambda invoke --function-name ExampleKataFunction output.json
 * cat output.json
 * ```
 */

import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

// Import the kata wrapper from the @lambdakata/cdk package
// In a real project, you would install this via: npm install @lambdakata/cdk
import { kata } from '../src';

/**
 * Example CDK Stack demonstrating Lambda Kata integration.
 *
 * This stack creates a simple Node.js Lambda function and wraps it with
 * `kata()` to transform it to use the Lambda Kata runtime.
 */
export class ExampleLambdaKataStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // ============================================================
        // Step 1: Define your Node.js Lambda function as usual
        // ============================================================
        //
        // Create a standard NodejsFunction. This is your existing Lambda
        // that you want to run via Lambda Kata. No changes needed to your
        // handler code!
        //
        const myFunction = new NodejsFunction(this, 'ExampleKataFunction', {
            // Entry point to your handler code
            entry: path.join(__dirname, 'handlers/example-handler.ts'),

            // Your original handler export name
            handler: 'handler',

            // Original runtime - this will be transformed to Python 3.12
            runtime: Runtime.NODEJS_18_X,

            // Standard Lambda configuration - all preserved after transformation
            memorySize: 256,
            timeout: Duration.seconds(30),

            // Your existing environment variables - all preserved
            environment: {
                LOG_LEVEL: 'INFO',
                MY_CONFIG_VALUE: 'example',
            },

            // Function name (optional) - preserved after transformation
            functionName: 'ExampleKataFunction',

            // Description - preserved after transformation
            description: 'Example Lambda function using Lambda Kata runtime',
        });

        // ============================================================
        // Step 2: Wrap with kata() to enable Lambda Kata
        // ============================================================
        //
        // The kata() wrapper performs the following transformations:
        //
        // BEFORE kata():
        //   - Runtime: nodejs18.x
        //   - Handler: index.handler
        //   - Layers: (none)
        //   - Environment: { LOG_LEVEL: 'INFO', MY_CONFIG_VALUE: 'example' }
        //
        // AFTER kata() (if licensed):
        //   - Runtime: python3.12
        //   - Handler: lambdakata.optimized_handler.lambda_handler
        //   - Layers: [arn:aws:lambda:REGION:ACCOUNT:layer:lambda-kata:VERSION, config-layer]
        //   - Environment: {
        //       LOG_LEVEL: 'INFO',           // Original preserved
        //       MY_CONFIG_VALUE: 'example',  // Original preserved
        //     }
        //   - Config Layer: /opt/.kata/original_handler.json contains handler path
        //
        // WHAT'S PRESERVED:
        //   ✓ Function name and logical ID
        //   ✓ All original environment variables
        //   ✓ Memory size (256 MB)
        //   ✓ Timeout (30 seconds)
        //   ✓ IAM execution role
        //   ✓ All event triggers (API Gateway, EventBridge, S3, etc.)
        //   ✓ Original code asset (your JS code)
        //
        kata(myFunction);

        // ============================================================
        // Alternative: Configure kata() behavior
        // ============================================================
        //
        // You can customize kata() behavior with options:
        //
        // kata(myFunction, {
        //     // Fail CDK synthesis if account is not licensed
        //     // Default is 'warn' which keeps original Lambda and emits warning
        //     unlicensedBehavior: 'fail',
        //
        //     // Override licensing endpoint (for testing)
        //     licensingEndpoint: 'https://custom-licensing.example.com',
        // });

        // ============================================================
        // What happens if not licensed?
        // ============================================================
        //
        // If your AWS account is not entitled via AWS Marketplace:
        //
        // 1. With unlicensedBehavior: 'warn' (default):
        //    - Lambda remains unchanged (Node.js runtime, original handler)
        //    - CDK emits a warning: "Lambda Kata not enabled: AWS account
        //      is not entitled. Subscribe via AWS Marketplace to enable."
        //    - Deployment succeeds, Lambda works normally without Lambda Kata
        //
        // 2. With unlicensedBehavior: 'fail':
        //    - CDK synthesis fails with an error
        //    - Deployment is blocked until you subscribe via AWS Marketplace
    }
}

/**
 * Example showing multiple functions with kata()
 *
 * You can wrap multiple Lambda functions in the same stack.
 * Each function is transformed independently.
 */
export class MultipleKataFunctionsStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // Function 1: API handler
        const apiHandler = new NodejsFunction(this, 'ApiHandler', {
            entry: path.join(__dirname, 'handlers/api-handler.ts'),
            handler: 'handler',
            runtime: Runtime.NODEJS_18_X,
            memorySize: 512,
            timeout: Duration.seconds(10),
        });

        // Function 2: Background processor
        const processor = new NodejsFunction(this, 'BackgroundProcessor', {
            entry: path.join(__dirname, 'handlers/processor.ts'),
            handler: 'process',
            runtime: Runtime.NODEJS_18_X,
            memorySize: 1024,
            timeout: Duration.minutes(5),
        });

        // Wrap both with kata()
        // Each function gets its own transformation with the same customer Layer
        kata(apiHandler);
        kata(processor);
    }
}

/**
 * Example showing kata() with middleware for custom handler resolution
 *
 * This demonstrates how to use the middlewarePath option to provide
 * custom handler resolution logic. The middleware is compiled with
 * esbuild and included in the config layer.
 *
 * ## Middleware Use Cases
 *
 * - **Handler Wrapping**: Add logging, metrics, or error handling
 * - **Environment-based Selection**: Choose handlers based on env vars
 * - **Multi-handler Routing**: Route to different handlers based on patterns
 *
 * ## Middleware Function Signature
 *
 * ```typescript
 * type MiddlewareFunction = (
 *     bundle: unknown,
 *     context: { originalHandler: string }
 * ) => Function;
 * ```
 */
export class MiddlewareExampleStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // ============================================================
        // Create a Node.js Lambda function
        // ============================================================
        //
        // Standard NodejsFunction - the middleware will wrap this handler
        // with custom logic (e.g., logging, metrics).
        //
        const middlewareFunction = new NodejsFunction(this, 'MiddlewareFunction', {
            // Entry point to your handler code
            entry: path.join(__dirname, 'middleware-example/handler.ts'),

            // Your original handler export name
            handler: 'handler',

            // Original runtime - this will be transformed to Python 3.12
            runtime: Runtime.NODEJS_18_X,

            // Standard Lambda configuration
            memorySize: 256,
            timeout: Duration.seconds(30),

            // Function name
            functionName: 'MiddlewareExampleFunction',

            // Description
            description: 'Example Lambda using middleware for custom handler resolution',

            // Environment variables
            environment: {
                LOG_LEVEL: 'DEBUG',
            },
        });

        // ============================================================
        // Wrap with kata() using middlewarePath option
        // ============================================================
        //
        // The middlewarePath option enables custom handler resolution:
        //
        // 1. Middleware TypeScript is compiled with esbuild
        // 2. Compiled middleware is placed at /opt/.kata/middleware.js
        // 3. Config JSON includes has_middleware: true
        // 4. At runtime, init_wrapper.js loads and calls the middleware
        // 5. Middleware returns the resolved handler function
        //
        // The middleware receives:
        //   - bundle: The loaded JavaScript bundle
        //   - context: { originalHandler: 'index.handler' }
        //
        // And returns the handler function to invoke.
        //
        kata(middlewareFunction, {
            // Path to middleware TypeScript file
            // This will be compiled with esbuild and included in the config layer
            middlewarePath: path.join(__dirname, 'middleware-example/middleware.ts'),
        });
    }
}

/**
 * Example showing kata() with both bundlePath and middlewarePath
 *
 * This demonstrates using both options together for maximum flexibility:
 * - Custom bundle location (bundlePath)
 * - Custom handler resolution (middlewarePath)
 */
export class AdvancedKataConfigStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const advancedFunction = new NodejsFunction(this, 'AdvancedFunction', {
            entry: path.join(__dirname, 'handlers/example-handler.ts'),
            handler: 'handler',
            runtime: Runtime.NODEJS_18_X,
            memorySize: 512,
            timeout: Duration.seconds(30),
            functionName: 'AdvancedKataFunction',
            description: 'Example with custom bundle path and middleware',
        });

        // ============================================================
        // Wrap with kata() using both bundlePath and middlewarePath
        // ============================================================
        //
        // Configuration options:
        //
        // bundlePath: Custom location for the JavaScript bundle
        //   - Default: /opt/js_runtime/bundle.js
        //   - Use when your bundle is in a custom location (e.g., /var/task/dist/index.js)
        //
        // middlewarePath: Custom handler resolution logic
        //   - Compiled with esbuild and placed at /opt/.kata/middleware.js
        //   - Use for handler wrapping, routing, or environment-based selection
        //
        kata(advancedFunction, {
            // Custom bundle path (optional)
            // bundlePath: '/var/task/dist/bundle.js',

            // Custom middleware for handler resolution (optional)
            middlewarePath: path.join(__dirname, 'middleware-example/middleware.ts'),
        });
    }
}

/**
 * Example showing kata() with inline handlerResolver
 *
 * This is the RECOMMENDED approach for custom handler resolution.
 * Instead of creating a separate middleware file, you write the
 * resolver function directly in your CDK code.
 *
 * The function is:
 * 1. Serialized to a temporary TypeScript file
 * 2. Compiled with esbuild
 * 3. Included in the config layer as middleware.js
 *
 * ## Benefits
 *
 * - No separate middleware file needed
 * - Handler resolution logic lives with your CDK stack
 * - Full TypeScript support
 * - Each Lambda can have its own resolver
 */
export class InlineHandlerResolverStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // ============================================================
        // Example 1: Simple handler resolution
        // ============================================================
        const simpleFunction = new NodejsFunction(this, 'SimpleFunction', {
            entry: path.join(__dirname, 'handlers/example-handler.ts'),
            handler: 'handler',
            runtime: Runtime.NODEJS_18_X,
            memorySize: 256,
            timeout: Duration.seconds(30),
            functionName: 'InlineResolverSimple',
        });

        kata(simpleFunction, {
            // Inline handler resolver - no separate file needed!
            handlerResolver: (bundle: unknown, ctx: { originalHandler: string }) => {
                const handlerName = ctx.originalHandler.split('.').pop() as string;
                return (bundle as Record<string, Function>)[handlerName];
            },
        });

        // ============================================================
        // Example 2: Handler with logging wrapper
        // ============================================================
        const loggingFunction = new NodejsFunction(this, 'LoggingFunction', {
            entry: path.join(__dirname, 'handlers/example-handler.ts'),
            handler: 'handler',
            runtime: Runtime.NODEJS_18_X,
            memorySize: 256,
            timeout: Duration.seconds(30),
            functionName: 'InlineResolverWithLogging',
        });

        kata(loggingFunction, {
            handlerResolver: (bundle: unknown, ctx: { originalHandler: string }) => {
                const handlerName = ctx.originalHandler.split('.').pop() as string;
                const originalHandler = (bundle as Record<string, Function>)[handlerName];

                // Wrap with logging
                return async (event: unknown, lambdaCtx: unknown) => {
                    console.log('Invocation started', { handler: handlerName });
                    const start = Date.now();
                    try {
                        const result = await originalHandler(event, lambdaCtx);
                        console.log('Invocation completed', { durationMs: Date.now() - start });
                        return result;
                    } catch (error) {
                        console.error('Invocation failed', { error });
                        throw error;
                    }
                };
            },
        });

        // ============================================================
        // Example 3: Environment-based handler selection
        // ============================================================
        const envBasedFunction = new NodejsFunction(this, 'EnvBasedFunction', {
            entry: path.join(__dirname, 'handlers/example-handler.ts'),
            handler: 'handler',
            runtime: Runtime.NODEJS_18_X,
            memorySize: 256,
            timeout: Duration.seconds(30),
            functionName: 'InlineResolverEnvBased',
            environment: {
                HANDLER_VERSION: 'v2',
            },
        });

        kata(envBasedFunction, {
            handlerResolver: (bundle: unknown, ctx: { originalHandler: string }) => {
                const b = bundle as Record<string, Function>;
                const version = process.env.HANDLER_VERSION || 'v1';

                // Select handler based on environment variable
                if (version === 'v2' && b['handlerV2']) {
                    return b['handlerV2'];
                }

                // Fallback to default
                const handlerName = ctx.originalHandler.split('.').pop() as string;
                return b[handlerName];
            },
        });
    }
}

// ============================================================
// CDK App Entry Point (for standalone deployment)
// ============================================================
//
// Uncomment the following to deploy this stack directly:
//
// import { App } from 'aws-cdk-lib';
//
// const app = new App();
// new ExampleLambdaKataStack(app, 'ExampleLambdaKataStack', {
//     env: {
//         account: process.env.CDK_DEFAULT_ACCOUNT,
//         region: process.env.CDK_DEFAULT_REGION,
//     },
// });

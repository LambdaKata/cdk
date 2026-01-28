/**
 * Example Node.js Lambda Handler
 *
 * This is a simple example handler that demonstrates a typical Lambda function.
 * When wrapped with kata(), this handler will be executed via the Lambda Kata
 * runtime, but the code itself remains unchanged.
 *
 * The Lambda Kata runtime will:
 * 1. Receive the Lambda invocation via Python 3.12
 * 2. Pass the event to the Node.js subprocess via IPC
 * 3. Execute this handler
 * 4. Return the response back through the Python handler
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

/**
 * Main Lambda handler function.
 *
 * This handler works identically whether running:
 * - Directly on Node.js runtime (without Lambda Kata)
 * - Via Lambda Kata runtime (after kata() transformation)
 *
 * @param event - The Lambda event (API Gateway, EventBridge, S3, etc.)
 * @param context - The Lambda context object
 * @returns The handler response
 */
export async function handler(
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> {
    // Log the invocation (works the same with or without Lambda Kata)
    console.log('Handler invoked', {
        requestId: context.awsRequestId,
        functionName: context.functionName,
        memoryLimit: context.memoryLimitInMB,
    });

    // Access environment variables (including those added by kata())
    const logLevel = process.env.LOG_LEVEL ?? 'INFO';
    const configValue = process.env.MY_CONFIG_VALUE ?? 'default';

    // When running via Lambda Kata, these additional env vars are available:
    // - JS_HANDLER_PATH: The original handler path (e.g., "index.handler")
    // - JS_BUNDLE_PATH: Path to the JS bundle in the Layer
    // - USE_CTYPES_BRIDGE: Whether ctypes bridge is enabled
    const jsHandlerPath = process.env.JS_HANDLER_PATH;
    const isLambdaKata = jsHandlerPath !== undefined;

    // Your business logic here
    const response = {
        message: 'Hello from Lambda Kata!',
        timestamp: new Date().toISOString(),
        runtime: isLambdaKata ? 'Lambda Kata (Python + Node.js)' : 'Native Node.js',
        config: {
            logLevel,
            configValue,
        },
        context: {
            requestId: context.awsRequestId,
            functionName: context.functionName,
        },
    };

    // Return API Gateway compatible response
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(response, null, 2),
    };
}

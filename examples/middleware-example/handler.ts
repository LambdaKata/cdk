/**
 * Example Handler for Middleware Demo
 *
 * This handler is used with the middleware example to demonstrate
 * how custom handler resolution works with Lambda Kata.
 *
 * The middleware wraps this handler with logging functionality,
 * demonstrating cross-cutting concerns without modifying handler code.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

/**
 * Main Lambda handler function.
 *
 * This handler demonstrates a simple API response that includes
 * information about the middleware integration.
 *
 * @param event - The Lambda event
 * @param context - The Lambda context object
 * @returns API Gateway response
 */
export async function handler(
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> {
    console.log('Handler invoked', {
        requestId: context.awsRequestId,
        functionName: context.functionName,
    });

    // Simulate some processing
    const processingStart = Date.now();
    await simulateWork(50); // 50ms simulated work
    const processingTime = Date.now() - processingStart;

    // Build response
    const response = {
        message: 'Middleware Example - Custom Handler Resolution',
        timestamp: new Date().toISOString(),
        processing: {
            simulatedWorkMs: processingTime,
        },
        context: {
            requestId: context.awsRequestId,
            functionName: context.functionName,
            memoryLimitInMB: context.memoryLimitInMB,
        },
        middleware: {
            description: 'This handler was resolved and wrapped by custom middleware',
            features: [
                'Logging wrapper adds invocation tracking',
                'Duration measurement for each invocation',
                'Error handling with detailed logging',
            ],
        },
    };

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(response, null, 2),
    };
}

/**
 * Simulates some async work.
 *
 * @param ms - Milliseconds to wait
 */
async function simulateWork(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Alternative handler for demonstrating multi-handler routing.
 *
 * This handler could be selected by middleware based on environment
 * variables or other criteria.
 *
 * @param event - The Lambda event
 * @param context - The Lambda context object
 * @returns API Gateway response
 */
export async function handlerV2(
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> {
    console.log('Handler V2 invoked', {
        requestId: context.awsRequestId,
    });

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: 'Handler V2 - Alternative implementation',
            version: 'v2',
            timestamp: new Date().toISOString(),
        }, null, 2),
    };
}

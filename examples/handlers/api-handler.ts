/**
 * Example API Handler for Lambda Kata
 *
 * This handler demonstrates a typical API Gateway Lambda function.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

/**
 * API handler function.
 */
export async function handler(
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> {
    console.log('API Handler invoked', {
        requestId: context.awsRequestId,
        path: event.path,
        method: event.httpMethod,
    });

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: 'API Handler response',
            requestId: context.awsRequestId,
        }),
    };
}

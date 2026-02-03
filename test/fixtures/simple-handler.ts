/*
 * Simple test handler for integration tests
 */

export const handler = async (event: any, context: any) => {
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Hello from Lambda Kata!',
            event,
            context: {
                requestId: context.requestId,
                functionName: context.functionName,
            },
        }),
    };
};
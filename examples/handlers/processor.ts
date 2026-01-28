/**
 * Example Background Processor for Lambda Kata
 *
 * This handler demonstrates a background processing Lambda function.
 */

import { Context } from 'aws-lambda';

interface ProcessorEvent {
    records?: Array<{ id: string; data: unknown }>;
    [key: string]: unknown;
}

interface ProcessorResult {
    processed: number;
    requestId: string;
}

/**
 * Background processor function.
 */
export async function process(
    event: ProcessorEvent,
    context: Context
): Promise<ProcessorResult> {
    console.log('Background Processor invoked', {
        requestId: context.awsRequestId,
        recordCount: event.records?.length ?? 0,
    });

    const recordCount = event.records?.length ?? 0;

    return {
        processed: recordCount,
        requestId: context.awsRequestId,
    };
}

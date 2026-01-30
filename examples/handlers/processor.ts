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

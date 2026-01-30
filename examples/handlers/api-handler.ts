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

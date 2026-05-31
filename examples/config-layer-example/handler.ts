/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Example Node.js Lambda Handler for the Config Layer Example
 *
 * When this function is wrapped with `kata()`, a config layer is attached
 * that exposes the original handler path to the Lambda Kata runtime at
 * `/opt/.kata/original_handler.json`.
 *
 * This handler reads that file and returns its contents, demonstrating how
 * the config layer artifact is available inside the running function.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import * as fs from 'fs';

/**
 * Path to the config layer file mounted by the Lambda Kata config layer.
 * The Lambda Kata runtime reads this file during initialization to determine
 * which JavaScript handler to invoke.
 */
const CONFIG_PATH = '/opt/.kata/original_handler.json';

/**
 * Main Lambda handler function.
 *
 * Reads the config layer file and returns its contents so you can observe the
 * configuration the Lambda Kata runtime uses at startup.
 *
 * @param event - The Lambda event
 * @param context - The Lambda context object
 * @returns The handler response including the config layer contents
 */
export async function handler(
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> {
    console.log('Config Layer Example Handler invoked', {
        requestId: context.awsRequestId,
        functionName: context.functionName,
    });

    // Read the config layer file (/opt/.kata/original_handler.json)
    let configContent: { original_js_handler?: string; bundle_path?: string; has_middleware?: boolean } | null = null;
    let configExists = false;
    let readError: string | null = null;

    try {
        if (fs.existsSync(CONFIG_PATH)) {
            configExists = true;
            const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
            configContent = JSON.parse(raw);
        }
    } catch (error) {
        readError = error instanceof Error ? error.message : String(error);
        console.error('Error reading config layer:', readError);
    }

    const response = {
        message: 'Config Layer Example - Handler Path from Config Layer',
        timestamp: new Date().toISOString(),
        configLayer: {
            path: CONFIG_PATH,
            exists: configExists,
            content: configContent,
            readError,
        },
        context: {
            requestId: context.awsRequestId,
            functionName: context.functionName,
            memoryLimitInMB: context.memoryLimitInMB,
        },
    };

    return {
        statusCode: configExists && configContent?.original_js_handler !== undefined ? 200 : 500,
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(response, null, 2),
    };
}

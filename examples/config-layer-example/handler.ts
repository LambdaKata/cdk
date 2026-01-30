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
 * Example Node.js Lambda Handler for Config Layer Demo
 *
 * This handler demonstrates the config layer approach where the original
 * handler path is stored in a Lambda Layer at /opt/.kata/original_handler.json
 * instead of the JS_HANDLER_PATH environment variable.
 *
 * Key differences from the old approach:
 * - JS_HANDLER_PATH environment variable is NOT set
 * - Handler path is read from /opt/.kata/original_handler.json by the runtime
 * - This provides cleaner separation between config and environment variables
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import * as fs from 'fs';

/**
 * Configuration file path in the Lambda Layer.
 * This is where the Lambda Kata runtime reads the original handler path.
 */
const CONFIG_PATH = '/opt/.kata/original_handler.json';

/**
 * Main Lambda handler function.
 *
 * This handler demonstrates the config layer approach and includes
 * verification that the handler path is correctly resolved from the
 * config layer (not from environment variables).
 *
 * @param event - The Lambda event
 * @param context - The Lambda context object
 * @returns The handler response with config layer verification
 */
export async function handler(
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> {
    console.log('Config Layer Example Handler invoked', {
        requestId: context.awsRequestId,
        functionName: context.functionName,
    });

    // Verify that JS_HANDLER_PATH is NOT set (Requirement 7.2)
    const jsHandlerPathEnv = process.env.JS_HANDLER_PATH;
    const jsHandlerPathNotSet = jsHandlerPathEnv === undefined;

    // Read the config layer to verify handler path resolution (Requirement 7.4)
    let configLayerParsed: { original_js_handler?: string } | null = null;
    let configLayerExists = false;
    let configReadError: string | null = null;

    try {
        if (fs.existsSync(CONFIG_PATH)) {
            configLayerExists = true;
            const configLayerContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
            configLayerParsed = JSON.parse(configLayerContent) as { original_js_handler?: string };
        }
    } catch (error) {
        configReadError = error instanceof Error ? error.message : String(error);
        console.error('Error reading config layer:', configReadError);
    }

    // Build verification results
    const verification = {
        // Requirement 7.2: JS_HANDLER_PATH should NOT be set
        jsHandlerPathNotSet,
        jsHandlerPathValue: jsHandlerPathEnv ?? null,

        // Requirement 7.4: Config layer should exist and contain handler path
        configLayerExists,
        configLayerPath: CONFIG_PATH,
        configLayerContent: configLayerParsed,

        // Overall verification status
        allChecksPass: jsHandlerPathNotSet && configLayerExists && configLayerParsed?.original_js_handler !== undefined,
    };

    // Build response
    const response = {
        message: 'Config Layer Example - Handler Path from Layer',
        timestamp: new Date().toISOString(),
        verification,
        context: {
            requestId: context.awsRequestId,
            functionName: context.functionName,
            memoryLimitInMB: context.memoryLimitInMB,
        },
        environment: {
            // Note: Lambda Kata no longer sets environment variables for config
            // Handler path and bundle path are read from config layer
            JS_HANDLER_PATH: process.env.JS_HANDLER_PATH ?? '(not set - as expected)',
            JS_BUNDLE_PATH: process.env.JS_BUNDLE_PATH ?? '(not set - read from config layer)',
        },
    };

    return {
        statusCode: verification.allChecksPass ? 200 : 500,
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(response, null, 2),
    };
}

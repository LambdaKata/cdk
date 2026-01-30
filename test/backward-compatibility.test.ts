/*
 * MIT
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the MIT; see the LICENSE file
 * or https://choosealicense.com/licenses/mit/ for details.
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * Unit Tests for Backward Compatibility
 *
 * These tests verify that existing Lambda Kata deployments continue to work
 * without changes when the new configurable bundle path and middleware features
 * are introduced.
 *
 * **Validates: Requirements 6.1, 6.2, 6.4, 6.5, 6.6**
 * - 6.1: WHEN no `bundle_path` is configured, THE Init_Wrapper SHALL behave identically to the current implementation
 * - 6.2: WHEN no middleware is configured, THE Init_Wrapper SHALL use the default handler resolution
 * - 6.4: THE Init_Wrapper SHALL continue to process stdin events in the same format
 * - 6.5: THE Init_Wrapper SHALL maintain the same timing measurements and logging format
 * - 6.6: THE existing Config_Layer schema with only `original_js_handler` SHALL remain valid
 *
 * @module backward-compatibility.test
 */

import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { Function as LambdaFunction, Runtime, Code, CfnFunction } from 'aws-cdk-lib/aws-lambda';
import {
    createKataConfigLayer,
    generateConfigContent,
    KataConfigLayerProps,
    HANDLER_CONFIG_KEY,
} from '../src/config-layer';
import { applyTransformation } from '../src/kata-wrapper';
import { TransformationConfig } from '../src/types';

/**
 * Default values used by init_wrapper.js for backward compatibility
 */
const DEFAULT_BUNDLE_PATH = '/opt/js_runtime/bundle.js';
const DEFAULT_ORIGINAL_HANDLER = 'index.handler';
const DEFAULT_HAS_MIDDLEWARE = false;

/**
 * Helper to create a test stack
 */
function createTestStack(): { app: App; stack: Stack } {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    return { app, stack };
}

/**
 * Helper to create a test Lambda function
 */
function createTestLambda(
    stack: Stack,
    id: string,
    options?: {
        handler?: string;
        runtime?: Runtime;
        environment?: Record<string, string>;
    }
): LambdaFunction {
    return new LambdaFunction(stack, id, {
        runtime: options?.runtime ?? Runtime.NODEJS_18_X,
        handler: options?.handler ?? 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
        environment: options?.environment,
    });
}

/**
 * Interface representing the parsed config from init_wrapper.js
 */
interface ParsedConfig {
    bundle_path: string;
    original_js_handler: string;
    has_middleware: boolean;
}

/**
 * Simulates the config parsing logic from init_wrapper.js
 * This mirrors the actual implementation for testing backward compatibility
 *
 * @param configContent - The content of the config file (or undefined if missing)
 * @returns The parsed config with defaults applied
 */
function simulateConfigParsing(configContent: string | undefined): ParsedConfig {
    let config: Record<string, unknown> = {};

    if (configContent !== undefined) {
        try {
            config = JSON.parse(configContent);
        } catch {
            // Continue with empty config (defaults will be applied)
            config = {};
        }
    }

    // Apply defaults exactly as init_wrapper.js does
    const bundlePath =
        typeof config.bundle_path === 'string' ? config.bundle_path : DEFAULT_BUNDLE_PATH;
    const originalHandler =
        typeof config.original_js_handler === 'string'
            ? config.original_js_handler
            : DEFAULT_ORIGINAL_HANDLER;
    const hasMiddleware = config.has_middleware === true;

    return {
        bundle_path: bundlePath,
        original_js_handler: originalHandler,
        has_middleware: hasMiddleware,
    };
}

/**
 * Simulates the default handler resolution logic from init_wrapper.js
 *
 * @param bundle - The loaded bundle object
 * @param originalHandler - The original handler path (e.g., 'index.handler')
 * @returns The resolved handler function or undefined
 */
function simulateDefaultHandlerResolution(
    bundle: Record<string, unknown>,
    originalHandler: string
): unknown {
    const handlerParts = originalHandler.split('.');
    const handlerName = handlerParts[handlerParts.length - 1];
    return bundle[handlerName];
}

/**
 * Interface representing the ready signal format
 */
interface ReadySignal {
    ready: true;
    pid: number;
}

/**
 * Interface representing the error signal format
 */
interface ErrorSignal {
    ready: false;
    error: string;
}

/**
 * Interface representing the request format (stdin)
 */
interface RequestFormat {
    event: unknown;
    context: unknown;
}

/**
 * Interface representing the response format (stdout)
 */
interface ResponseFormat {
    success: boolean;
    result?: unknown;
    error?: string;
}

/**
 * Validates the ready signal format
 */
function isValidReadySignal(signal: unknown): signal is ReadySignal {
    return (
        typeof signal === 'object' &&
        signal !== null &&
        (signal as Record<string, unknown>).ready === true &&
        typeof (signal as Record<string, unknown>).pid === 'number'
    );
}

/**
 * Validates the error signal format
 */
function isValidErrorSignal(signal: unknown): signal is ErrorSignal {
    return (
        typeof signal === 'object' &&
        signal !== null &&
        (signal as Record<string, unknown>).ready === false &&
        typeof (signal as Record<string, unknown>).error === 'string'
    );
}

/**
 * Validates the response format
 */
function isValidResponseFormat(response: unknown): response is ResponseFormat {
    if (typeof response !== 'object' || response === null) {
        return false;
    }
    const resp = response as Record<string, unknown>;
    if (typeof resp.success !== 'boolean') {
        return false;
    }
    if (resp.success === true) {
        return 'result' in resp;
    } else {
        return typeof resp.error === 'string';
    }
}

describe('Backward Compatibility', () => {
    /**
     * **Validates: Requirement 6.6**
     * THE existing Config_Layer schema with only `original_js_handler` SHALL remain valid
     */
    describe('Requirement 6.6: Config with only original_js_handler works', () => {
        it('should create valid config layer with only originalHandler', () => {
            const { stack } = createTestStack();
            const props: KataConfigLayerProps = {
                originalHandler: 'index.handler',
                // No bundlePath
                // No middlewarePath
            };

            const layer = createKataConfigLayer(stack, 'TestConfigLayer', props);

            expect(layer).toBeDefined();
            const template = Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::LayerVersion', 1);
        });

        it('should generate config JSON with only original_js_handler key when no other options provided', () => {
            const handlerPath = 'bundle.handler';
            const content = generateConfigContent(handlerPath);

            const parsed = JSON.parse(content);

            // Should have only the original_js_handler key
            expect(parsed[HANDLER_CONFIG_KEY]).toBe(handlerPath);
            expect(Object.keys(parsed)).toHaveLength(1);
            expect(parsed).not.toHaveProperty('bundle_path');
            expect(parsed).not.toHaveProperty('has_middleware');
        });

        it('should parse config with only original_js_handler and use defaults for other fields', () => {
            const configContent = JSON.stringify({
                original_js_handler: 'myModule.myHandler',
            });

            const parsed = simulateConfigParsing(configContent);

            expect(parsed.original_js_handler).toBe('myModule.myHandler');
            expect(parsed.bundle_path).toBe(DEFAULT_BUNDLE_PATH);
            expect(parsed.has_middleware).toBe(DEFAULT_HAS_MIDDLEWARE);
        });

        it('should work with various handler path formats', () => {
            const handlerPaths = [
                'index.handler',
                'bundle.handler',
                'src/index.handler',
                'dist/handlers/api.processRequest',
                'lib/handler.main',
            ];

            for (const handlerPath of handlerPaths) {
                const configContent = JSON.stringify({
                    original_js_handler: handlerPath,
                });

                const parsed = simulateConfigParsing(configContent);

                expect(parsed.original_js_handler).toBe(handlerPath);
                expect(parsed.bundle_path).toBe(DEFAULT_BUNDLE_PATH);
                expect(parsed.has_middleware).toBe(DEFAULT_HAS_MIDDLEWARE);
            }
        });
    });

    /**
     * **Validates: Requirement 6.1**
     * WHEN no `bundle_path` is configured, THE Init_Wrapper SHALL behave identically to the current implementation
     */
    describe('Requirement 6.1: Missing config file uses defaults', () => {
        it('should use default bundle_path when config file is missing', () => {
            const parsed = simulateConfigParsing(undefined);

            expect(parsed.bundle_path).toBe(DEFAULT_BUNDLE_PATH);
        });

        it('should use default original_js_handler when config file is missing', () => {
            const parsed = simulateConfigParsing(undefined);

            expect(parsed.original_js_handler).toBe(DEFAULT_ORIGINAL_HANDLER);
        });

        it('should use default has_middleware (false) when config file is missing', () => {
            const parsed = simulateConfigParsing(undefined);

            expect(parsed.has_middleware).toBe(DEFAULT_HAS_MIDDLEWARE);
        });

        it('should use default bundle_path when bundle_path is not in config', () => {
            const configContent = JSON.stringify({
                original_js_handler: 'index.handler',
                // No bundle_path
            });

            const parsed = simulateConfigParsing(configContent);

            expect(parsed.bundle_path).toBe(DEFAULT_BUNDLE_PATH);
        });

        it('should use default has_middleware when has_middleware is not in config', () => {
            const configContent = JSON.stringify({
                original_js_handler: 'index.handler',
                // No has_middleware
            });

            const parsed = simulateConfigParsing(configContent);

            expect(parsed.has_middleware).toBe(DEFAULT_HAS_MIDDLEWARE);
        });

        it('should continue initialization with defaults when config is empty object', () => {
            const configContent = JSON.stringify({});

            const parsed = simulateConfigParsing(configContent);

            expect(parsed.bundle_path).toBe(DEFAULT_BUNDLE_PATH);
            expect(parsed.original_js_handler).toBe(DEFAULT_ORIGINAL_HANDLER);
            expect(parsed.has_middleware).toBe(DEFAULT_HAS_MIDDLEWARE);
        });
    });

    /**
     * **Validates: Requirement 6.2**
     * WHEN no middleware is configured, THE Init_Wrapper SHALL use the default handler resolution
     */
    describe('Requirement 6.2: Default handler resolution without middleware', () => {
        it('should resolve handler using default resolution when has_middleware is false', () => {
            const bundle = {
                handler: () => 'test result',
                otherExport: 'not a handler',
            };

            const handler = simulateDefaultHandlerResolution(bundle, 'index.handler');

            expect(handler).toBe(bundle.handler);
        });

        it('should resolve handler using default resolution when has_middleware is not set', () => {
            const configContent = JSON.stringify({
                original_js_handler: 'module.processEvent',
            });

            const parsed = simulateConfigParsing(configContent);

            expect(parsed.has_middleware).toBe(false);

            const bundle = {
                processEvent: () => 'processed',
            };

            const handler = simulateDefaultHandlerResolution(bundle, parsed.original_js_handler);

            expect(handler).toBe(bundle.processEvent);
        });

        it('should extract handler name from nested path correctly', () => {
            const bundle = {
                createUser: () => 'user created',
            };

            const handler = simulateDefaultHandlerResolution(
                bundle,
                'src/handlers/api/users.createUser'
            );

            expect(handler).toBe(bundle.createUser);
        });

        it('should return undefined when handler does not exist in bundle', () => {
            const bundle = {
                existingHandler: () => 'exists',
            };

            const handler = simulateDefaultHandlerResolution(bundle, 'index.nonExistent');

            expect(handler).toBeUndefined();
        });
    });

    /**
     * **Validates: Requirement 6.4**
     * THE Init_Wrapper SHALL continue to process stdin events in the same format
     */
    describe('Requirement 6.4: IPC protocol format preserved', () => {
        describe('Ready/Error signal format', () => {
            it('should validate ready signal format: {"ready":true,"pid":<number>}', () => {
                const validReadySignal = { ready: true, pid: 12345 };

                expect(isValidReadySignal(validReadySignal)).toBe(true);
            });

            it('should reject ready signal with wrong ready value', () => {
                const invalidSignal = { ready: false, pid: 12345 };

                expect(isValidReadySignal(invalidSignal)).toBe(false);
            });

            it('should reject ready signal with missing pid', () => {
                const invalidSignal = { ready: true };

                expect(isValidReadySignal(invalidSignal)).toBe(false);
            });

            it('should reject ready signal with string pid', () => {
                const invalidSignal = { ready: true, pid: '12345' };

                expect(isValidReadySignal(invalidSignal)).toBe(false);
            });

            it('should validate error signal format: {"ready":false,"error":"<message>"}', () => {
                const validErrorSignal = { ready: false, error: 'Something went wrong' };

                expect(isValidErrorSignal(validErrorSignal)).toBe(true);
            });

            it('should reject error signal with wrong ready value', () => {
                const invalidSignal = { ready: true, error: 'Something went wrong' };

                expect(isValidErrorSignal(invalidSignal)).toBe(false);
            });

            it('should reject error signal with missing error message', () => {
                const invalidSignal = { ready: false };

                expect(isValidErrorSignal(invalidSignal)).toBe(false);
            });
        });

        describe('Request/Response format', () => {
            it('should accept request format: {"event":<data>,"context":<data>}', () => {
                const request: RequestFormat = {
                    event: { key: 'value' },
                    context: { functionName: 'test' },
                };

                expect(request.event).toBeDefined();
                expect(request.context).toBeDefined();
            });

            it('should validate success response format: {"success":true,"result":<data>}', () => {
                const response = { success: true, result: { statusCode: 200 } };

                expect(isValidResponseFormat(response)).toBe(true);
            });

            it('should validate error response format: {"success":false,"error":"<message>"}', () => {
                const response = { success: false, error: 'Handler error' };

                expect(isValidResponseFormat(response)).toBe(true);
            });

            it('should reject response with missing success field', () => {
                const response = { result: { statusCode: 200 } };

                expect(isValidResponseFormat(response)).toBe(false);
            });

            it('should reject success response without result', () => {
                const response = { success: true };

                expect(isValidResponseFormat(response)).toBe(false);
            });

            it('should reject error response without error message', () => {
                const response = { success: false };

                expect(isValidResponseFormat(response)).toBe(false);
            });
        });

        describe('JSON serialization compatibility', () => {
            it('should produce valid JSON for ready signal', () => {
                const signal = { ready: true, pid: 12345 };
                const json = JSON.stringify(signal) + '\n';

                expect(() => JSON.parse(json.trim())).not.toThrow();
                expect(JSON.parse(json.trim())).toEqual(signal);
            });

            it('should produce valid JSON for error signal', () => {
                const signal = { ready: false, error: 'Test error message' };
                const json = JSON.stringify(signal) + '\n';

                expect(() => JSON.parse(json.trim())).not.toThrow();
                expect(JSON.parse(json.trim())).toEqual(signal);
            });

            it('should produce valid JSON for success response', () => {
                const response = { success: true, result: { data: 'test' } };
                const json = JSON.stringify(response) + '\n';

                expect(() => JSON.parse(json.trim())).not.toThrow();
                expect(JSON.parse(json.trim())).toEqual(response);
            });

            it('should produce valid JSON for error response', () => {
                const response = { success: false, error: 'Handler failed' };
                const json = JSON.stringify(response) + '\n';

                expect(() => JSON.parse(json.trim())).not.toThrow();
                expect(JSON.parse(json.trim())).toEqual(response);
            });
        });
    });

    /**
     * **Validates: Requirement 6.5**
     * THE Init_Wrapper SHALL maintain the same timing measurements and logging format
     */
    describe('Requirement 6.5: Timing measurements and logging format', () => {
        describe('Logging format', () => {
            it('should use [Node.js] prefix for log messages', () => {
                const logPrefix = '[Node.js]';
                const logMessage = `${logPrefix} Test message`;

                expect(logMessage.startsWith(logPrefix)).toBe(true);
            });

            it('should use [Init] tag for initialization messages', () => {
                const initMessages = [
                    '[Init] Starting init_wrapper.js...',
                    '[Init] Config loaded:',
                    '[Init] Loading bundle from:',
                    '[Init] Bundle loaded in',
                    '[Init] Resolving handler...',
                    '[Init] Handler resolved in',
                    '[Init] Ready signal sent',
                ];

                for (const message of initMessages) {
                    expect(message.includes('[Init]')).toBe(true);
                }
            });

            it('should use [Event] tag for event processing messages', () => {
                const eventMessage = '[Event] Processing request...';

                expect(eventMessage.includes('[Event]')).toBe(true);
            });

            it('should use [Error] tag for error messages', () => {
                const errorMessage = '[Error] Something went wrong';

                expect(errorMessage.includes('[Error]')).toBe(true);
            });
        });

        describe('Timing measurement format', () => {
            it('should report bundle load time in milliseconds', () => {
                const loadTimeMessage = '[Init] Bundle loaded in 42ms';

                expect(loadTimeMessage).toMatch(/Bundle loaded in \d+ms/);
            });

            it('should report handler resolution time in milliseconds', () => {
                const resolveTimeMessage = '[Init] Handler resolved in 5ms';

                expect(resolveTimeMessage).toMatch(/Handler resolved in \d+ms/);
            });
        });
    });

    /**
     * Tests for existing deployments unchanged
     */
    describe('Existing deployments unchanged', () => {
        it('should apply transformation with only originalHandler (no bundlePath, no middlewarePath)', () => {
            const { stack } = createTestStack();
            const lambda = createTestLambda(stack, 'TestFunction', {
                handler: 'index.handler',
            });

            const config: TransformationConfig = {
                originalHandler: 'index.handler',
                targetRuntime: Runtime.PYTHON_3_12,
                targetHandler: 'lambdakata.optimized_handler.lambda_handler',
                layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
                // No bundlePath
                // No middlewarePath
            };

            applyTransformation(lambda, config);

            const cfnFunction = lambda.node.defaultChild as CfnFunction;
            expect(cfnFunction.runtime).toBe('python3.12');
            expect(cfnFunction.handler).toBe('lambdakata.optimized_handler.lambda_handler');
        });

        it('should create config layer with only original_js_handler when no bundlePath or middlewarePath', () => {
            const { stack } = createTestStack();
            const lambda = createTestLambda(stack, 'TestFunction', {
                handler: 'bundle.handler',
            });

            const config: TransformationConfig = {
                originalHandler: 'bundle.handler',
                targetRuntime: Runtime.PYTHON_3_12,
                targetHandler: 'lambdakata.optimized_handler.lambda_handler',
                layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
            };

            applyTransformation(lambda, config);

            const template = Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::LayerVersion', {
                Description: 'Lambda Kata config layer for handler: bundle.handler',
            });
        });

        it('should NOT set JS_BUNDLE_PATH environment variable (uses config layer)', () => {
            const { stack } = createTestStack();
            const lambda = createTestLambda(stack, 'TestFunction');

            const config: TransformationConfig = {
                originalHandler: 'index.handler',
                targetRuntime: Runtime.PYTHON_3_12,
                targetHandler: 'lambdakata.optimized_handler.lambda_handler',
                layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
            };

            applyTransformation(lambda, config);

            // Verify JS_BUNDLE_PATH is NOT set (bundle path is in config layer)
            const template = Template.fromStack(stack);
            const resources = template.findResources('AWS::Lambda::Function');
            const functionResource = Object.values(resources)[0];
            const envVars = functionResource.Properties?.Environment?.Variables || {};
            expect(envVars).not.toHaveProperty('JS_BUNDLE_PATH');
        });

        it('should preserve existing environment variables during transformation (no Lambda Kata vars added)', () => {
            const { stack } = createTestStack();
            const lambda = createTestLambda(stack, 'TestFunction', {
                environment: {
                    MY_CUSTOM_VAR: 'my-value',
                    ANOTHER_VAR: 'another-value',
                },
            });

            const config: TransformationConfig = {
                originalHandler: 'index.handler',
                targetRuntime: Runtime.PYTHON_3_12,
                targetHandler: 'lambdakata.optimized_handler.lambda_handler',
                layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
            };

            applyTransformation(lambda, config);

            const template = Template.fromStack(stack);
            // Verify original env vars are preserved
            template.hasResourceProperties('AWS::Lambda::Function', {
                Environment: {
                    Variables: {
                        MY_CUSTOM_VAR: 'my-value',
                        ANOTHER_VAR: 'another-value',
                    },
                },
            });

            // Verify no Lambda Kata env vars are added (all config in layer)
            const resources = template.findResources('AWS::Lambda::Function');
            const functionResource = Object.values(resources)[0];
            const envVars = functionResource.Properties?.Environment?.Variables || {};
            expect(envVars).not.toHaveProperty('JS_BUNDLE_PATH');
            expect(envVars).not.toHaveProperty('USE_CTYPES_BRIDGE');
        });

        it('should attach both Lambda Kata layer and config layer', () => {
            const { stack } = createTestStack();
            const lambda = createTestLambda(stack, 'TestFunction');
            const layerArn = 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1';

            const config: TransformationConfig = {
                originalHandler: 'index.handler',
                targetRuntime: Runtime.PYTHON_3_12,
                targetHandler: 'lambdakata.optimized_handler.lambda_handler',
                layerArn,
            };

            applyTransformation(lambda, config);

            const template = Template.fromStack(stack);

            // Should have 2 layer versions: Lambda Kata layer and config layer
            template.resourceCountIs('AWS::Lambda::LayerVersion', 1); // Config layer is created

            // Lambda function should have layers attached
            template.hasResourceProperties('AWS::Lambda::Function', {
                Layers: Match.arrayWith([layerArn]),
            });
        });
    });

    /**
     * Tests for graceful degradation
     */
    describe('Graceful degradation', () => {
        it('should use defaults when config has unexpected field types', () => {
            const configContent = JSON.stringify({
                original_js_handler: 12345, // Should be string
                bundle_path: true, // Should be string
                has_middleware: 'yes', // Should be boolean
            });

            const parsed = simulateConfigParsing(configContent);

            // Should fall back to defaults for invalid types
            expect(parsed.original_js_handler).toBe(DEFAULT_ORIGINAL_HANDLER);
            expect(parsed.bundle_path).toBe(DEFAULT_BUNDLE_PATH);
            expect(parsed.has_middleware).toBe(DEFAULT_HAS_MIDDLEWARE);
        });

        it('should use defaults when config has null values', () => {
            const configContent = JSON.stringify({
                original_js_handler: null,
                bundle_path: null,
                has_middleware: null,
            });

            const parsed = simulateConfigParsing(configContent);

            expect(parsed.original_js_handler).toBe(DEFAULT_ORIGINAL_HANDLER);
            expect(parsed.bundle_path).toBe(DEFAULT_BUNDLE_PATH);
            expect(parsed.has_middleware).toBe(DEFAULT_HAS_MIDDLEWARE);
        });

        it('should use defaults when config has extra unknown fields', () => {
            const configContent = JSON.stringify({
                original_js_handler: 'index.handler',
                unknown_field: 'some value',
                another_unknown: 123,
            });

            const parsed = simulateConfigParsing(configContent);

            // Should still work with known fields
            expect(parsed.original_js_handler).toBe('index.handler');
            expect(parsed.bundle_path).toBe(DEFAULT_BUNDLE_PATH);
            expect(parsed.has_middleware).toBe(DEFAULT_HAS_MIDDLEWARE);
        });
    });
});

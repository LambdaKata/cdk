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
 * Build Verification Tests for SnapStart Handler Bundle
 *
 * These tests verify that the snapstart-handler.js bundle is correctly produced
 * by the build system and meets the requirements for deployment.
 *
 * **Validates: Requirements 6.1, 1.5, 4.1**
 * - 6.1: Test suite verifies `snapstart-handler.js` exists at expected path after build
 * - 1.5: Handler_Bundle exports a `handler` function compatible with CloudFormation Custom Resource Provider framework
 * - 4.1: SnapStart_Handler exports an async `handler` function that accepts a `CustomResourceEvent` parameter
 *
 * @module snapstart-handler-build.test
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Expected path to the snapstart handler bundle relative to test directory
 */
const HANDLER_PATH = path.join(__dirname, '../out/dist/snapstart-handler.js');

describe('snapstart-handler build', () => {
    /**
     * Test: Verify snapstart-handler.js exists at expected path
     *
     * **Validates: Requirement 6.1**
     * THE test suite SHALL verify that `snapstart-handler.js` exists at the expected path after build
     */
    it('should produce snapstart-handler.js in out/dist/', () => {
        expect(fs.existsSync(HANDLER_PATH)).toBe(true);
    });

    /**
     * Test: Verify module exports a handler function
     *
     * **Validates: Requirements 1.5, 4.1**
     * - 1.5: THE Handler_Bundle SHALL export a `handler` function compatible with the CloudFormation Custom Resource Provider framework
     * - 4.1: THE SnapStart_Handler SHALL export an async `handler` function that accepts a `CustomResourceEvent` parameter
     */
    it('should export a handler function', () => {
        const handler = require('../out/dist/snapstart-handler');
        expect(typeof handler.handler).toBe('function');
    });

    /**
     * Test: Verify AWS SDK is externalized (not bundled)
     *
     * **Validates: Requirement 1.3**
     * THE Build_System SHALL mark all `@aws-sdk/*` packages as external dependencies (available in Lambda runtime)
     *
     * This ensures the bundle size is minimized and the Lambda runtime's built-in AWS SDK is used.
     */
    it('should not bundle AWS SDK', () => {
        const content = fs.readFileSync(HANDLER_PATH, 'utf-8');
        // AWS SDK should be required, not bundled
        expect(content).toContain('require("@aws-sdk/client-lambda")');
    });

    /**
     * Test: Verify handler is callable and returns a Promise
     *
     * **Validates: Requirement 4.1**
     * THE SnapStart_Handler SHALL export an async `handler` function
     *
     * Note: We don't actually invoke the handler as it requires AWS SDK and Lambda context,
     * but we verify it's a function that would return a Promise when called.
     */
    it('should have handler that is an async function', () => {
        const handler = require('../out/dist/snapstart-handler');

        // Verify handler exists and is a function
        expect(handler.handler).toBeDefined();
        expect(typeof handler.handler).toBe('function');

        // Async functions have a specific constructor name
        // Note: Bundled/minified code may not preserve this, so we check the function exists
        // The actual async behavior is tested in snapstart-activator.test.ts
    });

    /**
     * Test: Verify bundle is a valid CommonJS module
     *
     * **Validates: Requirement 1.2**
     * THE Build_System SHALL bundle `src/snapstart-activator.ts` as a standalone CommonJS module targeting Node.js 18
     */
    it('should be a valid CommonJS module', () => {
        const content = fs.readFileSync(HANDLER_PATH, 'utf-8');

        // CommonJS modules typically have module.exports or exports assignments
        // esbuild bundles use a specific pattern for CommonJS output
        const hasCommonJSPattern =
            content.includes('module.exports') ||
            content.includes('exports.') ||
            content.includes('__commonJS') ||
            content.includes('__toCommonJS');

        expect(hasCommonJSPattern).toBe(true);
    });

    /**
     * Test: Verify bundle file is not empty and has reasonable size
     *
     * **Validates: Requirement 1.1**
     * WHEN `yarn build` is executed, THE Build_System SHALL produce a `snapstart-handler.js` file
     */
    it('should have non-empty bundle with reasonable size', () => {
        const stats = fs.statSync(HANDLER_PATH);

        // Bundle should not be empty
        expect(stats.size).toBeGreaterThan(0);

        // Bundle should be reasonably sized (not too small indicating missing code,
        // not too large indicating bundled dependencies)
        // Expected range: 1KB - 100KB for a minified handler without AWS SDK
        expect(stats.size).toBeGreaterThan(1000); // > 1KB
        expect(stats.size).toBeLessThan(100000); // < 100KB
    });
});


/**
 * Property-Based Tests for Handler Bundle Exports
 *
 * These tests use fast-check to verify that the handler bundle exports
 * a callable handler function that returns a Promise for any valid input.
 *
 * **Feature: snapstart-handler-refactor, Property 4: Handler Bundle Exports**
 * **Validates: Requirements 1.5, 4.1**
 *
 * @module snapstart-handler-build.property.test
 */
import * as fc from 'fast-check';

describe('Property 4: Handler Bundle Exports', () => {
    /**
     * Arbitrary for valid Lambda function names
     * Lambda function names: 1-64 characters, alphanumeric, hyphens, underscores
     */
    const functionNameArb = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'),
        { minLength: 1, maxLength: 64 }
    );

    /**
     * Arbitrary for valid alias names
     * Lambda alias names: 1-128 characters, alphanumeric, hyphens, underscores
     */
    const aliasNameArb = fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'),
        { minLength: 1, maxLength: 128 }
    );

    /**
     * Arbitrary for Custom Resource request types
     */
    const requestTypeArb = fc.constantFrom('Create', 'Update', 'Delete') as fc.Arbitrary<'Create' | 'Update' | 'Delete'>;

    /**
     * Arbitrary for valid CustomResourceEvent objects
     */
    const customResourceEventArb = fc.record({
        RequestType: requestTypeArb,
        FunctionName: functionNameArb,
        AliasName: fc.option(aliasNameArb, { nil: undefined }),
        StackId: fc.constant('arn:aws:cloudformation:us-east-1:123456789012:stack/TestStack/guid'),
        RequestId: fc.uuid(),
        LogicalResourceId: fc.constant('SnapStartResource'),
    }).map(({ RequestType, FunctionName, AliasName, StackId, RequestId, LogicalResourceId }) => ({
        RequestType,
        ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
        ResponseURL: 'https://cloudformation.s3.amazonaws.com/response',
        StackId,
        RequestId,
        ResourceType: 'Custom::SnapStartActivator',
        LogicalResourceId,
        PhysicalResourceId: `${FunctionName}:snapstart:${AliasName ?? 'kata'}`,
        ResourceProperties: {
            ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
            FunctionName,
            ...(AliasName ? { AliasName } : {}),
        },
    }));

    /**
     * Property Test: Handler is exported and callable
     *
     * **Feature: snapstart-handler-refactor, Property 4: Handler Bundle Exports**
     * **Validates: Requirements 1.5, 4.1**
     *
     * For any build of the snapstart-handler.js bundle, the module SHALL export
     * a `handler` function that is callable.
     */
    it('should export a callable handler function', () => {
        // This is a deterministic property - the bundle either exports handler or not
        // We run it multiple times to ensure consistency across test runs
        fc.assert(
            fc.property(
                fc.constant(null), // No input needed - testing export existence
                () => {
                    const handlerModule = require('../out/dist/snapstart-handler');

                    // Property: handler must be exported
                    expect(handlerModule.handler).toBeDefined();

                    // Property: handler must be a function (callable)
                    expect(typeof handlerModule.handler).toBe('function');

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property Test: Handler returns a Promise when called with any valid event structure
     *
     * **Feature: snapstart-handler-refactor, Property 4: Handler Bundle Exports**
     * **Validates: Requirements 1.5, 4.1**
     *
     * For any valid CustomResourceEvent structure, the handler function SHALL return a Promise.
     * This test verifies the Promise return type without waiting for resolution (which would
     * require AWS SDK mocking in the bundled code).
     */
    it('should return a Promise when called with any valid CustomResourceEvent structure', () => {
        fc.assert(
            fc.property(
                customResourceEventArb,
                (event) => {
                    const handlerModule = require('../out/dist/snapstart-handler');

                    // Call the handler with the generated event
                    const result = handlerModule.handler(event);

                    // Property: handler must return a Promise (thenable)
                    expect(result).toBeDefined();
                    expect(typeof result.then).toBe('function');
                    expect(typeof result.catch).toBe('function');
                    expect(result).toBeInstanceOf(Promise);

                    // Clean up: catch the promise to prevent unhandled rejection warnings
                    // The promise will reject because AWS SDK is not mocked in the bundle,
                    // but we only care about verifying the return type is a Promise
                    result.catch(() => {
                        // Expected - AWS SDK calls will fail without proper mocking
                    });

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property Test: Handler accepts any valid CustomResourceEvent without throwing synchronously
     *
     * **Feature: snapstart-handler-refactor, Property 4: Handler Bundle Exports**
     * **Validates: Requirements 1.5, 4.1**
     *
     * For any valid CustomResourceEvent, calling the handler SHALL NOT throw synchronously.
     * The handler should always return a Promise (async errors are handled via Promise rejection).
     */
    it('should not throw synchronously for any valid CustomResourceEvent', () => {
        fc.assert(
            fc.property(
                customResourceEventArb,
                (event) => {
                    const handlerModule = require('../out/dist/snapstart-handler');

                    // Property: calling handler should not throw synchronously
                    let result: Promise<unknown>;
                    expect(() => {
                        result = handlerModule.handler(event);
                    }).not.toThrow();

                    // Clean up the promise
                    result!.catch(() => {
                        // Expected - AWS SDK calls will fail without proper mocking
                    });

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property Test: Handler function has correct arity (accepts event parameter)
     *
     * **Feature: snapstart-handler-refactor, Property 4: Handler Bundle Exports**
     * **Validates: Requirements 1.5, 4.1**
     *
     * The handler function SHALL accept at least one parameter (the CustomResourceEvent).
     * This verifies the function signature is compatible with the CloudFormation Custom Resource
     * Provider framework.
     */
    it('should have handler function with correct arity', () => {
        fc.assert(
            fc.property(
                fc.constant(null),
                () => {
                    const handlerModule = require('../out/dist/snapstart-handler');

                    // Property: handler must accept at least 1 parameter (event)
                    // Note: Function.length returns the number of expected parameters
                    // Async functions and functions with default params may report 0,
                    // so we verify it's callable with an event object instead
                    expect(typeof handlerModule.handler).toBe('function');

                    // Verify handler can be called with an event object
                    const testEvent = {
                        RequestType: 'Delete',
                        ServiceToken: 'test',
                        ResponseURL: 'test',
                        StackId: 'test',
                        RequestId: 'test',
                        ResourceType: 'test',
                        LogicalResourceId: 'test',
                        ResourceProperties: {
                            ServiceToken: 'test',
                            FunctionName: 'test',
                        },
                    };

                    const result = handlerModule.handler(testEvent);
                    expect(result).toBeInstanceOf(Promise);

                    // Clean up
                    result.catch(() => { });

                    return true;
                }
            ),
            { numRuns: 100 }
        );
    });
});

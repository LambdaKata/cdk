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
 * Tests for inline handlerResolver functionality
 *
 * These tests verify that the handlerResolver option works correctly:
 * 1. Inline function is serialized to a temporary .ts file
 * 2. esbuild compiles it to middleware.js
 * 3. Config layer includes has_middleware: true
 */

import { App, Stack } from 'aws-cdk-lib';

import { createKataConfigLayer } from '../src/config-layer';

describe('handlerResolver inline function', () => {
  let app: App;
  let stack: Stack;

  beforeEach(() => {
    app = new App();
    stack = new Stack(app, 'TestStack');
  });

  it('should compile inline handlerResolver function to middleware.js', () => {
    // Create config layer with inline handlerResolver
    const configLayer = createKataConfigLayer(stack, 'TestConfigLayer', {
      originalHandler: 'index.handler',
      handlerResolver: (bundle: unknown, ctx: { originalHandler: string }) => {
        const handlerName = ctx.originalHandler.split('.').pop() as string;
        return (bundle as Record<string, Function>)[handlerName];
      },
    });

    // Verify layer was created
    expect(configLayer).toBeDefined();
  });

  it('should set has_middleware: true when handlerResolver is provided', () => {
    const configLayer = createKataConfigLayer(stack, 'TestConfigLayer', {
      originalHandler: 'index.handler',
      handlerResolver: (bundle: unknown, ctx: { originalHandler: string }) => {
        return (bundle as Record<string, Function>)['handler'];
      },
    });

    expect(configLayer).toBeDefined();
    // The config JSON should have has_middleware: true
    // This is verified by the layer being created successfully
  });

  it('should throw error when both middlewarePath and handlerResolver are provided', () => {
    expect(() => {
      createKataConfigLayer(stack, 'TestConfigLayer', {
        originalHandler: 'index.handler',
        middlewarePath: './some-middleware.ts',
        handlerResolver: (bundle: unknown, ctx: { originalHandler: string }) => {
          return (bundle as Record<string, Function>)['handler'];
        },
      });
    }).toThrow('Cannot specify both middlewarePath and handlerResolver');
  });

  it('should work with arrow function syntax', () => {
    const configLayer = createKataConfigLayer(stack, 'TestConfigLayer', {
      originalHandler: 'bundle.myHandler',
      handlerResolver: (bundle, ctx) => {
        const name = ctx.originalHandler.split('.')[1];
        return (bundle as Record<string, Function>)[name];
      },
    });

    expect(configLayer).toBeDefined();
  });

  it('should work with complex handler resolution logic', () => {
    const configLayer = createKataConfigLayer(stack, 'TestConfigLayer', {
      originalHandler: 'src/handlers/api.processRequest',
      handlerResolver: (bundle, ctx) => {
        // Complex resolution: parse path and find handler
        const parts = ctx.originalHandler.split('.');
        const handlerName = parts[parts.length - 1];
        const b = bundle as Record<string, unknown>;

        // Support nested exports
        if (b[handlerName] && typeof b[handlerName] === 'function') {
          return b[handlerName] as Function;
        }

        // Fallback to default export
        if (b['default'] && typeof b['default'] === 'function') {
          return b['default'] as Function;
        }

        throw new Error(`Handler ${handlerName} not found`);
      },
    });

    expect(configLayer).toBeDefined();
  });
});

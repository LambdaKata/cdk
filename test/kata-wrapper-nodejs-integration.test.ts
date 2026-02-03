/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for Node.js runtime detection in kata wrapper
 *
 * Tests the integration between kata() function and Node.js layer management
 * for task 9.1: Modify kata() function to detect Node.js runtimes
 */

import { Stack } from 'aws-cdk-lib';
import { Architecture, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

// Import the helper functions we added
import { getLambdaArchitecture, getOriginalRuntime, isNodejsRuntime } from '../src/kata-wrapper';

describe('Node.js Runtime Detection in kata wrapper', () => {
  let stack: Stack;

  beforeEach(() => {
    stack = new Stack();
  });

  describe('getOriginalRuntime', () => {
    it('should detect nodejs18.x runtime', () => {
      const lambda = new LambdaFunction(stack, 'TestFunction', {
        runtime: Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      });

      const runtime = getOriginalRuntime(lambda);
      expect(runtime).toBe('nodejs18.x');
    });

    it('should detect nodejs20.x runtime', () => {
      const lambda = new LambdaFunction(stack, 'TestFunction', {
        runtime: Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      });

      const runtime = getOriginalRuntime(lambda);
      expect(runtime).toBe('nodejs20.x');
    });

    it('should detect python runtime', () => {
      const lambda = new LambdaFunction(stack, 'TestFunction', {
        runtime: Runtime.PYTHON_3_12,
        handler: 'index.handler',
        code: Code.fromInline('def handler(event, context): return {"statusCode": 200}'),
      });

      const runtime = getOriginalRuntime(lambda);
      expect(runtime).toBe('python3.12');
    });
  });

  describe('isNodejsRuntime', () => {
    it('should return true for nodejs18.x', () => {
      const lambda = new LambdaFunction(stack, 'TestFunction', {
        runtime: Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      });

      expect(isNodejsRuntime(lambda)).toBe(true);
    });

    it('should return true for nodejs20.x', () => {
      const lambda = new LambdaFunction(stack, 'TestFunction', {
        runtime: Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      });

      expect(isNodejsRuntime(lambda)).toBe(true);
    });

    it('should return false for python runtime', () => {
      const lambda = new LambdaFunction(stack, 'TestFunction', {
        runtime: Runtime.PYTHON_3_12,
        handler: 'index.handler',
        code: Code.fromInline('def handler(event, context): return {"statusCode": 200}'),
      });

      expect(isNodejsRuntime(lambda)).toBe(false);
    });

    it('should return false for non-nodejs runtime', () => {
      const lambda = new LambdaFunction(stack, 'TestFunction', {
        runtime: Runtime.PYTHON_3_9,
        handler: 'index.handler',
        code: Code.fromInline('def handler(event, context): return {"statusCode": 200}'),
      });

      expect(isNodejsRuntime(lambda)).toBe(false);
    });
  });

  describe('getLambdaArchitecture', () => {
    it('should return x86_64 as default architecture', () => {
      const lambda = new LambdaFunction(stack, 'TestFunction', {
        runtime: Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      });

      const architecture = getLambdaArchitecture(lambda);
      expect(architecture).toBe('x86_64');
    });

    it('should detect arm64 architecture when specified', () => {
      const lambda = new LambdaFunction(stack, 'TestFunction', {
        runtime: Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
        architecture: Architecture.ARM_64,
      });

      const architecture = getLambdaArchitecture(lambda);
      expect(architecture).toBe('arm64');
    });
  });

  describe('NodejsFunction support', () => {
    it('should detect runtime from NodejsFunction with explicit runtime', () => {
      const lambda = new NodejsFunction(stack, 'TestFunction', {
        entry: __filename, // Use this test file as entry point
        runtime: Runtime.NODEJS_20_X,
      });

      expect(isNodejsRuntime(lambda)).toBe(true);
      expect(getOriginalRuntime(lambda)).toBe('nodejs20.x');
    });
  });
});

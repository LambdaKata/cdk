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
 * Example stacks — real synthesis tests.
 *
 * Unlike a "does it compile" check, these tests instantiate the ACTUAL example
 * stacks (`examples/.../stack.ts`, importing `@lambdakata/cdk` exactly as a user
 * would) and synthesize them to CloudFormation. They then assert that the
 * synthesized template is the RESULT a user expects after `kata()`:
 *
 *   - the user's Lambda runs on `python3.12`
 *   - the handler is `lambdakata.optimized_handler.lambda_handler`
 *   - a config layer is created describing the original handler path
 *   - the customer-specific Lambda Kata layer is attached
 *   - the NodejsFunction code bundles without Docker
 *
 * Entitlement is forced via the native licensing module mock — the same seam the
 * core `kata-wrapper` tests use — because the synchronous `kata()` path validates
 * licensing through `NativeLicensingService`. This proves the stacks build into
 * the correct infrastructure; it does NOT exercise a live AWS invocation (that
 * requires a real account + Marketplace subscription and is out of scope for CI).
 *
 * @module example-stacks-synth.test
 */

import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { NativeLicensingService } from '@lambda-kata/licensing';

const TEST_ACCOUNT = '123456789012';
const TEST_REGION = 'us-east-1';
const TEST_LAYER_ARN = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';

// Force an entitled response from the native licensing module so the synchronous
// kata() path applies the real transformation during synthesis.
jest.mock('@lambda-kata/licensing', () => ({
  NativeLicensingService: jest.fn().mockImplementation(() => ({
    checkEntitlementSync: jest.fn().mockReturnValue({
      entitled: true,
      layerVersionArn: TEST_LAYER_ARN,
    }),
  })),
}));

const mockNativeLicensing = NativeLicensingService as jest.Mock;

/** The Lambda Kata Python handler the transformed function must use. */
const KATA_HANDLER = 'lambdakata.optimized_handler.lambda_handler';

/**
 * Finds the user's transformed function in the template.
 *
 * A transformed example stack contains helper Lambdas (SnapStart activator and
 * its CDK provider). The user function is the one whose handler is the Lambda
 * Kata Python handler.
 */
function findKataFunction(template: Template): { id: string; props: Record<string, unknown> } {
  const fns = template.findResources('AWS::Lambda::Function');
  const entries = Object.entries(fns).filter(
    ([, r]) => (r as { Properties?: { Handler?: string } }).Properties?.Handler === KATA_HANDLER,
  );
  expect(entries).toHaveLength(1);
  const [id, resource] = entries[0];
  return { id, props: (resource as { Properties: Record<string, unknown> }).Properties };
}

/** Collects the config layer descriptions present in the template. */
function configLayerDescriptions(template: Template): string[] {
  const layers = template.findResources('AWS::Lambda::LayerVersion');
  return Object.values(layers)
    .map((r) => (r as { Properties?: { Description?: string } }).Properties?.Description ?? '')
    .filter((d) => d.startsWith('Lambda Kata config layer'));
}

beforeEach(() => {
  mockNativeLicensing.mockClear();
});

describe('ConfigLayerExampleStack — real synthesis result', () => {
  let template: Template;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ConfigLayerExampleStack } = require('../../examples/config-layer-example/stack');
    const app = new App({ context: { 'aws:cdk:account': TEST_ACCOUNT } });
    const stack: Stack = new ConfigLayerExampleStack(app, 'ConfigLayerExampleStack', {
      env: { account: TEST_ACCOUNT, region: TEST_REGION },
    });
    template = Template.fromStack(stack);
  });

  it('transforms the user function to the Lambda Kata Python runtime', () => {
    const { props } = findKataFunction(template);
    expect(props.Runtime).toBe('python3.12');
    expect(props.Handler).toBe(KATA_HANDLER);
  });

  it('preserves the user function name and configuration', () => {
    const { props } = findKataFunction(template);
    expect(props.FunctionName).toBe('ConfigLayerExampleFunction');
    // kata() enforces a 512MB minimum; the example requests 256MB.
    expect(props.MemorySize).toBe(512);
    expect(props.Timeout).toBe(30);
  });

  it('preserves the user-provided environment variables', () => {
    const { props } = findKataFunction(template);
    const env = (props.Environment as { Variables?: Record<string, string> })?.Variables ?? {};
    expect(env.LOG_LEVEL).toBe('DEBUG');
    expect(env.EXAMPLE_CONFIG).toBe('config-layer-demo');
  });

  it('creates a config layer for the original (bundled) handler path', () => {
    // NodejsFunction bundles to index.js, so the original handler is index.handler.
    expect(configLayerDescriptions(template)).toContain(
      'Lambda Kata config layer for handler: index.handler',
    );
  });

  it('attaches the customer-specific Lambda Kata layer to the user function', () => {
    const { props } = findKataFunction(template);
    const layers = props.Layers as unknown[];
    expect(Array.isArray(layers)).toBe(true);
    // Config layer + Node.js runtime layer + customer Lambda Kata layer.
    expect(layers.length).toBeGreaterThanOrEqual(3);
    expect(layers).toContain(TEST_LAYER_ARN);
  });

  it('does NOT leak Lambda Kata configuration into environment variables', () => {
    const { props } = findKataFunction(template);
    const env = (props.Environment as { Variables?: Record<string, string> })?.Variables ?? {};
    expect(env).not.toHaveProperty('JS_HANDLER_PATH');
    expect(env).not.toHaveProperty('JS_BUNDLE_PATH');
    expect(env).not.toHaveProperty('USE_CTYPES_BRIDGE');
  });
});

describe('MiddlewareExampleStack — real synthesis result', () => {
  let template: Template;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MiddlewareExampleStack } = require('../../examples/middleware-example/stack');
    const app = new App({ context: { 'aws:cdk:account': TEST_ACCOUNT } });
    const stack: Stack = new MiddlewareExampleStack(app, 'MiddlewareExampleStack', {
      env: { account: TEST_ACCOUNT, region: TEST_REGION },
    });
    template = Template.fromStack(stack);
  });

  it('transforms the user function to the Lambda Kata Python runtime', () => {
    const { props } = findKataFunction(template);
    expect(props.Runtime).toBe('python3.12');
    expect(props.Handler).toBe(KATA_HANDLER);
  });

  it('preserves the user function name', () => {
    const { props } = findKataFunction(template);
    expect(props.FunctionName).toBe('MiddlewareExampleFunction');
  });

  it('compiles middleware and creates the config layer (esbuild, no Docker)', () => {
    // The middleware path triggers esbuild compilation during synthesis; a
    // config layer for the bundled handler must be present.
    expect(configLayerDescriptions(template)).toContain(
      'Lambda Kata config layer for handler: index.handler',
    );
  });

  it('attaches the customer-specific Lambda Kata layer', () => {
    const { props } = findKataFunction(template);
    expect(props.Layers as unknown[]).toContain(TEST_LAYER_ARN);
  });
});

describe('Unlicensed account — example stack is NOT transformed', () => {
  beforeAll(() => {
    // Re-mock as NOT entitled for this scenario.
    mockNativeLicensing.mockImplementation(() => ({
      checkEntitlementSync: jest.fn().mockReturnValue({
        entitled: false,
        message: 'AWS account is not entitled. Subscribe via AWS Marketplace to enable.',
      }),
    }));
  });

  afterAll(() => {
    // Restore the entitled default for any subsequently loaded module state.
    mockNativeLicensing.mockImplementation(() => ({
      checkEntitlementSync: jest.fn().mockReturnValue({
        entitled: true,
        layerVersionArn: TEST_LAYER_ARN,
      }),
    }));
  });

  it('leaves the user function on its original Node.js runtime', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ConfigLayerExampleStack } = require('../../examples/config-layer-example/stack');
      const app = new App({ context: { 'aws:cdk:account': TEST_ACCOUNT } });
      const stack: Stack = new ConfigLayerExampleStack(app, 'UnlicensedConfigLayerStack', {
        env: { account: TEST_ACCOUNT, region: TEST_REGION },
      });
      const template = Template.fromStack(stack);

      // Exactly one Lambda function (no SnapStart/provider helpers are added
      // when there is no transformation), still on its original Node.js runtime.
      const fns = template.findResources('AWS::Lambda::Function');
      const allProps = Object.values(fns).map(
        (r) => (r as { Properties: { Runtime?: string; Handler?: string } }).Properties,
      );
      expect(allProps).toHaveLength(1);
      expect(allProps[0].Runtime).toBe('nodejs20.x');
      // No function carries the Lambda Kata handler.
      expect(allProps.some((p) => p.Handler === KATA_HANDLER)).toBe(false);
      // No config layer should be created.
      expect(configLayerDescriptions(template)).toHaveLength(0);
    });
  });
});

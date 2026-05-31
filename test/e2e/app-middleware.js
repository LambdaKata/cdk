/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Target Insight Function. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Real-AWS end-to-end CDK application for the MIDDLEWARE FILE variant.
 *
 * Mirrors the documented README "Option 2: Middleware File" usage:
 *
 *   kata(fn, { middlewarePath: path.join(__dirname, 'middleware.ts') })
 *
 * Drives the BUILT package (../../out/dist) and the real example handler +
 * middleware files so the deployed function exercises custom handler
 * resolution via /opt/.kata/middleware.js at runtime.
 */

const path = require('path');
const { App, Stack, Duration, CfnOutput } = require('aws-cdk-lib');
const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
const { Runtime } = require('aws-cdk-lib/aws-lambda');

const { kata } = require(path.join(__dirname, '..', '..', 'out', 'dist', 'index.js'));

const ACCOUNT = process.env.LK_E2E_ACCOUNT;
const REGION = process.env.LK_E2E_REGION || 'eu-central-1';
const FUNCTION_NAME = process.env.LK_E2E_FUNCTION_NAME || 'LambdaKataE2EMiddlewareFunction';
const STACK_NAME = process.env.LK_E2E_STACK_NAME || 'LambdaKataE2EMiddlewareStack';

if (!ACCOUNT) {
  throw new Error('LK_E2E_ACCOUNT must be set to the target (entitled) AWS account id');
}

const exampleDir = path.join(__dirname, '..', '..', 'examples', 'middleware-example');

class E2EMiddlewareStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const fn = new NodejsFunction(this, 'E2EMiddlewareFunction', {
      // Reuse the real, documented example handler and middleware.
      entry: path.join(exampleDir, 'handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      functionName: FUNCTION_NAME,
      description: 'Lambda Kata E2E - middleware file example (real deploy)',
      environment: {
        LOG_LEVEL: 'DEBUG',
        EXAMPLE_CONFIG: 'middleware-demo',
      },
    });

    // README "Option 2: Middleware File" — custom handler resolution from a file.
    kata(fn, {
      middlewarePath: path.join(exampleDir, 'middleware.ts'),
    });

    new CfnOutput(this, 'FunctionName', { value: fn.functionName });
  }
}

const app = new App();
new E2EMiddlewareStack(app, STACK_NAME, {
  env: { account: ACCOUNT, region: REGION },
});

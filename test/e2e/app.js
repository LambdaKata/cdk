/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Target Insight Function. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Real-AWS end-to-end CDK application.
 *
 * Drives the BUILT package (../../out/dist) — the same artifact a user installs
 * from npm — so the SnapStart custom-resource handler asset resolves correctly.
 * Wraps the real config-layer example handler with kata() and lets the actual
 * native licensing module gate the transformation against a real, entitled
 * account.
 */

const path = require('path');
const { App, Stack, Duration, CfnOutput } = require('aws-cdk-lib');
const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
const { Runtime } = require('aws-cdk-lib/aws-lambda');

// Import kata() from the BUILT package, exactly as a user would after install.
const { kata } = require(path.join(__dirname, '..', '..', 'out', 'dist', 'index.js'));

const ACCOUNT = process.env.LK_E2E_ACCOUNT;
const REGION = process.env.LK_E2E_REGION || 'eu-central-1';
const FUNCTION_NAME = process.env.LK_E2E_FUNCTION_NAME || 'LambdaKataE2EConfigLayerFunction';
const STACK_NAME = process.env.LK_E2E_STACK_NAME || 'LambdaKataE2EConfigLayerStack';

if (!ACCOUNT) {
  throw new Error('LK_E2E_ACCOUNT must be set to the target (entitled) AWS account id');
}

class E2EConfigLayerStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const fn = new NodejsFunction(this, 'E2EConfigLayerFunction', {
      // Reuse the real, documented example handler.
      entry: path.join(__dirname, '..', '..', 'examples', 'config-layer-example', 'handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      functionName: FUNCTION_NAME,
      description: 'Lambda Kata E2E - config layer example (real deploy)',
      environment: {
        LOG_LEVEL: 'DEBUG',
        EXAMPLE_CONFIG: 'config-layer-demo',
      },
    });

    // Real transformation: native licensing module validates the account.
    kata(fn);

    new CfnOutput(this, 'FunctionName', { value: fn.functionName });
  }
}

const app = new App();
new E2EConfigLayerStack(app, STACK_NAME, {
  env: { account: ACCOUNT, region: REGION },
});

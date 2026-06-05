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
 * Benchmark Harness Example CDK Stack
 *
 * This example demonstrates the Lambda Kata Benchmark Harness: a single
 * `kataBench(stack)` call that discovers the stack's Lambda functions, clones
 * each eligible one through the unchanged `kata()` transformation, wires
 * benchmark infrastructure, and emits a benchmark manifest pointer as a
 * `CfnOutput`.
 *
 * ## What `kataBench(stack)` does at synth time
 *
 * 1. **Discovers** every Lambda in the stack and **classifies** it as
 *    cloneable / cloneable-with-warnings / unsupported. Unsupported Lambdas are
 *    skipped (recorded in the result) without aborting the run.
 * 2. **Clones** each eligible Lambda into a sibling `Baseline_Variant` (your
 *    untouched function) and a `Kata_Variant` (the clone transformed by the
 *    same public `kata()` wrapper). The original function is never mutated.
 * 3. **Provisions** isolated benchmark trigger sources and writes both event
 *    source mappings DISABLED by default (safe-by-default; the run-time runner
 *    toggles them).
 * 4. **Writes** a versioned benchmark manifest (SSM pointer + S3 body) and
 *    emits a `CfnOutput` carrying only the pointer. The run-time
 *    `lambda-kata-bench` CLI reads this pointer to drive a run.
 *
 * ## Safe by default
 *
 * The harness is conservative unless told otherwise:
 * - fidelity `L0` (synthetic handler, pure runtime overhead),
 * - side-effect policy `unsafe` (blocks parallel fan-out),
 * - role mode `reuse-role`,
 * - external-resource disposition `block` (default-deny),
 * - clone trigger mappings created DISABLED.
 *
 * Nothing in this stack runs load or enables a benchmark trigger at deploy
 * time. Running a benchmark is a separate, explicit run-time step (see the
 * CLI flow in the README) whose default mode is observe-only.
 *
 * @example
 * ```bash
 * # 1. Deploy the stack (creates baseline+clone pairs and the manifest pointer)
 * npx cdk deploy BenchmarkExampleStack
 *
 * # 2. Read the manifest pointer emitted as a stack output
 * aws cloudformation describe-stacks \
 *   --stack-name BenchmarkExampleStack \
 *   --query "Stacks[0].Outputs[?OutputKey=='BenchmarkManifestParameter'].OutputValue" \
 *   --output text
 *
 * # 3. Drive a run in the DEFAULT observe-only mode (no load, no toggling)
 * npx lambda-kata-bench run --manifest <ssm-parameter-name> --observe-only
 * ```
 */

import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

// Import from the @lambdakata/cdk package. `kataBench` is the additive
// benchmark entry point; it sits alongside the existing `kata()` wrapper and
// the FidelityLevel enum on the same public surface.
import { kataBench, FidelityLevel } from '@lambdakata/cdk';

/**
 * Example CDK Stack demonstrating the Benchmark Harness.
 *
 * The stack defines ordinary `NodejsFunction`s exactly as it would without the
 * harness. A single `kataBench(this)` call at the end of the constructor turns
 * the stack into a benchmark: each eligible Lambda gains a Kata clone and the
 * manifest pointer is exposed as a stack output.
 */
export class BenchmarkExampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ============================================================
    // Step 1: Define your Lambda functions as usual
    // ============================================================
    //
    // These are standard NodejsFunctions. You do NOT call kata() on them
    // yourself — kataBench() clones each eligible function and applies the
    // kata() transformation to the CLONE only, leaving these baselines
    // byte-identical.
    //
    new NodejsFunction(this, 'ApiHandler', {
      entry: path.join(__dirname, '../handlers/api-handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(10),
      functionName: 'BenchmarkExampleApiHandler',
      description: 'Baseline API handler benchmarked against its Kata clone',
    });

    new NodejsFunction(this, 'BackgroundProcessor', {
      entry: path.join(__dirname, '../handlers/processor.ts'),
      handler: 'process',
      runtime: Runtime.NODEJS_20_X,
      memorySize: 1024,
      timeout: Duration.minutes(5),
      functionName: 'BenchmarkExampleProcessor',
      description: 'Baseline background processor benchmarked against its Kata clone',
    });

    // ============================================================
    // Step 2: Turn the stack into a benchmark with kataBench()
    // ============================================================
    //
    // A single call discovers the Lambdas above, clones the eligible ones
    // through the unchanged kata() path, provisions disabled benchmark
    // triggers, and writes the manifest. All options are optional and fall
    // back to the conservative defaults; they are shown here to make the
    // safe-by-default posture explicit and reviewable.
    //
    const result = kataBench(this, {
      // Most conservative measurement tier: a synthetic handler that
      // isolates pure runtime cold-start/overhead from business logic.
      fidelity: FidelityLevel.L0,

      // Declare the handlers' side-effect contract. `unsafe` (the default)
      // blocks parallel fan-out so duplicate executions can never hit a
      // shared resource. Tighten to 'read-only' / 'idempotent' /
      // 'isolated-writes' only when you can guarantee it.
      sideEffectPolicy: 'unsafe',

      // The clone reuses the baseline execution role (default).
      roleMode: 'reuse-role',

      // Default-deny any finding that touches an external resource.
      externalResourceDisposition: 'block',
    });

    // ============================================================
    // Step 3: Expose the manifest pointer for the run-time CLI
    // ============================================================
    //
    // kataBench() already emits its own CfnOutput pointer internally; this
    // additional, explicitly-named output simply makes the SSM parameter
    // name easy to script against (see the README CLI flow).
    //
    new CfnOutput(this, 'BenchmarkManifestParameter', {
      value: result.manifestParameterName,
      description: 'SSM parameter holding the benchmark manifest pointer',
    });

    new CfnOutput(this, 'BenchmarkVariantCount', {
      value: String(result.variants.length),
      description: 'Number of baseline/kata variant pairs synthesized',
    });

    new CfnOutput(this, 'BenchmarkSkippedCount', {
      value: String(result.skipped.length),
      description: 'Number of discovered Lambdas skipped as unsupported',
    });
  }
}

// ============================================================
// CDK App Entry Point (for standalone deployment)
// ============================================================
//
// Uncomment the following to deploy this stack directly:
//
// import { App } from 'aws-cdk-lib';
//
// const app = new App();
// new BenchmarkExampleStack(app, 'BenchmarkExampleStack', {
//     env: {
//         account: process.env.CDK_DEFAULT_ACCOUNT,
//         region: process.env.CDK_DEFAULT_REGION,
//     },
// });

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
 * Example: Node.js Lambda Layer Deployment
 *
 * This example demonstrates how to deploy pre-built Node.js Lambda Layers
 * using the new deployment functionality. This bypasses the Docker binary
 * extraction that can fail with large Node.js binaries (>80MB).
 *
 * Usage:
 * ```bash
 * # Deploy for single architecture
 * npx ts-node examples/nodejs-layer-deployment-example.ts --architecture arm64
 *
 * # Deploy for all architectures
 * npx ts-node examples/nodejs-layer-deployment-example.ts --all
 * ```
 */

import { AWSLayerManager } from '../src/aws-layer-manager';
import { createDefaultLogger } from '../src/logger';

async function deployNodejsLayerExample() {
  console.log('Node.js Lambda Layer Deployment Example');
  console.log('==========================================\n');

  // Initialize the layer manager with S3 support for large layers
  const manager = new AWSLayerManager({
    logger: createDefaultLogger(),
    enableS3Support: true, // Enable S3 for layers >50MB
    awsSdkConfig: {
      region: process.env.AWS_REGION || 'us-east-1',
    },
  });

  try {
    const architecture = (process.argv.includes('--architecture')
      ? process.argv[process.argv.indexOf('--architecture') + 1]
      : 'arm64') as 'arm64' | 'x86_64';

    const deployAll = process.argv.includes('--all');

    if (deployAll) {
      console.log('Deploying layers for all architectures...\n');

      const result = await manager.deployAllArchitectures({
        region: process.env.AWS_REGION || 'us-east-1',
        baseDirectory: process.cwd(), // Look for ZIP files in current directory
      });

      console.log('\n✓ Multi-architecture deployment completed!');
      console.log(`Success: ${result.success}`);
      console.log(`Successful deployments: ${result.successful.length}`);
      console.log(`Failed deployments: ${result.failed.length}\n`);

      // Display results
      result.successful.forEach(success => {
        console.log(`✓ ${success.architecture}: ${success.layerVersionArn}`);
      });

      result.failed.forEach(failure => {
        console.log(`✗ ${failure.architecture}: ${failure.error}`);
      });

    } else {
      console.log(`Deploying layer for ${architecture} architecture...\n`);

      const result = await manager.deployNodejsLayer({
        region: process.env.AWS_REGION || 'us-east-1',
        architecture,
        baseDirectory: process.cwd(), // Look for ZIP files in current directory
        // Optional: custom layer name and description
        // layerName: 'my-custom-nodejs-layer',
        // description: 'Custom Node.js runtime layer for Lambda Kata',
      });

      console.log('\n✓ Layer deployment completed!');
      console.log(`Layer ARN: ${result.layerVersionArn}`);
      console.log(`Layer Name: ${result.layerName}`);
      console.log(`Version: ${result.version}`);
      console.log(`Architecture: ${result.architecture}`);
      console.log(`Size: ${(result.layerSize / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`Upload Method: ${result.uploadedViaS3 ? 'S3 (large layer)' : 'Direct (small layer)'}`);
      console.log(`ZIP File: ${result.zipFilePath}`);
    }

    console.log('\n Next Steps:');
    console.log('1. Use the layer ARN in your Lambda functions');
    console.log('2. The layer provides Node.js runtime binaries for Lambda Kata');
    console.log('3. Layers are region-specific - deploy in each required region');

  } catch (error) {
    console.error('\n✗ Deployment failed:', error instanceof Error ? error.message : String(error));

    if (error instanceof Error && error.message.includes('No layer ZIP found')) {
      console.log('\n💡 Expected ZIP files:');
      console.log('For arm64: nodejs-layer-arm64-minimal.zip or nodejs-layer-arm64.zip');
      console.log('For x86_64: nodejs-layer-x86_64-minimal.zip, nodejs-layer-x86_64.zip,');
      console.log('           nodejs-layer-x86-minimal.zip, or nodejs-layer-x86.zip');
      console.log('\nPlace these files in the current directory or specify --baseDirectory');
    }

    process.exit(1);
  } finally {
    // Clean up resources
    manager.destroy();
  }
}

// Run the example
if (require.main === module) {
  deployNodejsLayerExample().catch(console.error);
}

export { deployNodejsLayerExample };

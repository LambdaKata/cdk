# Node.js Layer Management - Technical Implementation Guide

## Overview

The Node.js Layer Management system automatically detects Node.js Lambda runtime versions and manages corresponding Node.js Lambda Layers in customer AWS accounts. This extends the existing Lambda Kata TypeScript tooling to provide seamless Node.js runtime support while maintaining performance benefits.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Components](#core-components)
3. [Installation & Setup](#installation--setup)
4. [Basic Usage Examples](#basic-usage-examples)
5. [Advanced Configuration](#advanced-configuration)
6. [Step-by-Step Workflow Examples](#step-by-step-workflow-examples)
7. [Error Handling](#error-handling)
8. [Performance Optimization](#performance-optimization)
9. [Troubleshooting](#troubleshooting)

## Architecture Overview

```mermaid
graph TB
    subgraph "CDK Application"
        A[kata() wrapper] --> B[ensureNodeRuntimeLayer()]
    end
    
    subgraph "Node.js Layer Management System"
        B --> C[RuntimeDetector]
        B --> D[LayerManager]
        C --> E[Docker Runtime Images]
        D --> F[AWS Lambda API]
        D --> G[Layer Cache]
    end
    
    subgraph "External Dependencies"
        E --> H[public.ecr.aws/lambda/nodejs]
        F --> I[AWS SDK v3]
        G --> J[In-Memory Cache]
    end
```

### Key Design Principles

- **Correctness**: All operations are idempotent and maintain consistency
- **Security**: Minimal attack surface with proper input validation
- **Performance**: Efficient caching and minimal Docker operations
- **Maintainability**: Clear interfaces and comprehensive error handling

## Core Components

### 1. RuntimeDetector
Detects exact Node.js versions from AWS Lambda Docker images.

### 2. LayerManager
Creates, finds, and manages Node.js Lambda Layers with idempotent operations.

### 3. Main API (ensureNodeRuntimeLayer)
Primary entry point that coordinates runtime detection and layer management.

## Installation & Setup

### Prerequisites

```bash
# Required dependencies
npm install @lambda-kata/cdk aws-cdk-lib constructs

# Development dependencies
npm install --save-dev @types/node typescript jest
```

### Docker Setup (Required)

```bash
# Install Docker (macOS with Homebrew)
brew install docker

# Start Docker daemon
open -a Docker

# Verify Docker installation
docker --version
docker pull public.ecr.aws/lambda/nodejs:20-x86_64
```

### AWS Configuration

```bash
# Configure AWS credentials
aws configure

# Or use environment variables
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_DEFAULT_REGION=us-east-1
```

## Basic Usage Examples

### Example 1: Simple Node.js Lambda with Automatic Layer Management

```typescript
// stack.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { kata } from '@lambda-kata/cdk';

export class MyLambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a Node.js Lambda function with automatic layer management
    const myFunction = kata(new lambda.Function(this, 'MyNodeFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,  // Automatically detected
      architecture: lambda.Architecture.X86_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
    }));

    // The kata() wrapper automatically:
    // 1. Detects Node.js 20.x runtime
    // 2. Creates/finds compatible Node.js layer
    // 3. Attaches the layer to your function
    // 4. Switches runtime to Python 3.12 for Lambda Kata
  }
}
```

### Example 2: Manual Layer Management

```typescript
// manual-layer-example.ts
import { ensureNodeRuntimeLayer } from '@lambda-kata/cdk';

async function createNodeLayer() {
  try {
    const result = await ensureNodeRuntimeLayer({
      runtimeName: 'nodejs20.x',
      architecture: 'x86_64',
      region: 'us-east-1',
      accountId: '123456789012',
      awsSdkConfig: {
        region: 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      },
    });

    console.log('Layer created/found:', {
      layerArn: result.layerArn,
      layerName: result.layerName,
      nodeVersion: result.nodeVersion,
      created: result.created, // true if new, false if reused
    });

    return result;
  } catch (error) {
    console.error('Layer management failed:', error);
    throw error;
  }
}
```

## Advanced Configuration

### Custom Logger Integration

```typescript
import { ensureNodeRuntimeLayer } from '@lambda-kata/cdk';
import { createDefaultLogger } from '@lambda-kata/cdk/logger';

// Create custom logger
class CustomLogger {
  debug(message: string, meta?: Record<string, unknown>) {
    console.log(`[DEBUG] ${message}`, meta);
  }
  
  info(message: string, meta?: Record<string, unknown>) {
    console.log(`[INFO] ${message}`, meta);
  }
  
  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(`[WARN] ${message}`, meta);
  }
  
  error(message: string, meta?: Record<string, unknown>) {
    console.error(`[ERROR] ${message}`, meta);
  }
}

const result = await ensureNodeRuntimeLayer({
  runtimeName: 'nodejs20.x',
  architecture: 'arm64',
  region: 'us-west-2',
  accountId: '123456789012',
  logger: new CustomLogger(),
});
```

### Multi-Region Deployment

```typescript
// multi-region-stack.ts
import * as cdk from 'aws-cdk-lib';
import { kata } from '@lambda-kata/cdk';

export class MultiRegionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const regions = ['us-east-1', 'us-west-2', 'eu-west-1'];
    
    regions.forEach(region => {
      // Each region will get its own Node.js layer
      const regionalFunction = kata(new lambda.Function(this, `Function-${region}`, {
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        handler: 'index.handler',
        code: lambda.Code.fromAsset('src'),
        environment: {
          REGION: region,
        },
      }));
    });
  }
}
```

## Step-by-Step Workflow Examples

### Workflow 1: First-Time Layer Creation

This example shows the complete process when no compatible layer exists.

#### Step 1: Initialize the System

```typescript
// workflow-example-1.ts
import { ensureNodeRuntimeLayer } from '@lambda-kata/cdk';
import { createDefaultLogger } from '@lambda-kata/cdk/logger';

const logger = createDefaultLogger();

async function firstTimeLayerCreation() {
  logger.info('Starting Node.js layer management workflow');
  
  const options = {
    runtimeName: 'nodejs20.x' as const,
    architecture: 'x86_64' as const,
    region: 'us-east-1',
    accountId: '123456789012',
    logger,
  };
```

#### Step 2: Runtime Detection Phase

```typescript
  // The system automatically:
  // 1. Validates input parameters
  logger.info('Phase 1: Input validation', options);
  
  // 2. Pulls AWS Lambda Docker image
  logger.info('Phase 2: Docker image detection', {
    dockerImage: 'public.ecr.aws/lambda/nodejs:20-x86_64'
  });
  
  // 3. Extracts exact Node.js version
  logger.info('Phase 3: Version extraction', {
    expectedVersion: '20.10.0' // Example version
  });
```

#### Step 3: Layer Search Phase

```typescript
  // 4. Searches for existing compatible layers
  logger.info('Phase 4: Layer compatibility search', {
    layerName: 'lambda-kata-nodejs-nodejs20.x-x86_64',
    searchCriteria: {
      nodeVersion: '20.10.0',
      architecture: 'x86_64',
      maxAge: '30 days'
    }
  });
```

#### Step 4: Layer Creation Phase

```typescript
  // 5. Creates new layer (since none exists)
  logger.info('Phase 5: New layer creation');
  
  try {
    const result = await ensureNodeRuntimeLayer(options);
    
    logger.info('Layer creation completed successfully', {
      layerArn: result.layerArn,
      layerName: result.layerName,
      nodeVersion: result.nodeVersion,
      created: result.created, // Should be true
      architecture: result.architecture,
    });
    
    return result;
  } catch (error) {
    logger.error('Layer creation failed', { error });
    throw error;
  }
}
```

#### Step 5: Verification and Usage

```typescript
// Verify the layer was created correctly
async function verifyLayerCreation(layerArn: string) {
  const { LambdaClient, GetLayerVersionCommand } = await import('@aws-sdk/client-lambda');
  
  const client = new LambdaClient({ region: 'us-east-1' });
  
  try {
    const response = await client.send(new GetLayerVersionCommand({
      LayerName: layerArn.split(':')[6], // Extract layer name from ARN
      VersionNumber: parseInt(layerArn.split(':')[7]), // Extract version
    }));
    
    logger.info('Layer verification successful', {
      layerArn: response.LayerVersionArn,
      description: response.Description,
      compatibleRuntimes: response.CompatibleRuntimes,
      compatibleArchitectures: response.CompatibleArchitectures,
    });
    
    return response;
  } finally {
    client.destroy();
  }
}

// Execute the workflow
firstTimeLayerCreation()
  .then(result => verifyLayerCreation(result.layerArn))
  .then(() => logger.info('Workflow completed successfully'))
  .catch(error => logger.error('Workflow failed', { error }));
```

### Workflow 2: Layer Reuse Scenario

This example demonstrates the idempotent behavior when a compatible layer already exists.

#### Complete Reuse Workflow

```typescript
// workflow-example-2.ts
async function layerReuseWorkflow() {
  const logger = createDefaultLogger();
  
  logger.info('Starting layer reuse workflow demonstration');
  
  const commonOptions = {
    runtimeName: 'nodejs18.x' as const,
    architecture: 'arm64' as const,
    region: 'us-west-2',
    accountId: '123456789012',
    logger,
  };

  // First call - creates the layer
  logger.info('=== FIRST CALL: Layer Creation ===');
  const firstResult = await ensureNodeRuntimeLayer(commonOptions);
  
  logger.info('First call completed', {
    layerArn: firstResult.layerArn,
    created: firstResult.created, // Should be true
    nodeVersion: firstResult.nodeVersion,
  });

  // Second call - should reuse existing layer
  logger.info('=== SECOND CALL: Layer Reuse ===');
  const secondResult = await ensureNodeRuntimeLayer(commonOptions);
  
  logger.info('Second call completed', {
    layerArn: secondResult.layerArn,
    created: secondResult.created, // Should be false
    nodeVersion: secondResult.nodeVersion,
  });

  // Verify idempotency
  const isIdempotent = (
    firstResult.layerArn === secondResult.layerArn &&
    firstResult.layerName === secondResult.layerName &&
    firstResult.nodeVersion === secondResult.nodeVersion &&
    firstResult.architecture === secondResult.architecture &&
    firstResult.runtimeName === secondResult.runtimeName &&
    firstResult.created === true &&
    secondResult.created === false
  );

  logger.info('Idempotency verification', {
    isIdempotent,
    firstCallCreated: firstResult.created,
    secondCallCreated: secondResult.created,
    sameLayerArn: firstResult.layerArn === secondResult.layerArn,
  });

  if (!isIdempotent) {
    throw new Error('Layer management is not idempotent!');
  }

  logger.info('Layer reuse workflow completed successfully');
  return { firstResult, secondResult };
}
```

### Workflow 3: CDK Integration Workflow

This example shows how the system integrates with AWS CDK deployments.

#### Complete CDK Deployment Workflow

```typescript
// workflow-example-3.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { kata } from '@lambda-kata/cdk';

export class NodeJsLayerWorkflowStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Step 1: Define your Node.js Lambda function
    const originalFunction = new lambda.Function(this, 'MyNodeFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,  // Original Node.js runtime
      architecture: lambda.Architecture.X86_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
    });

    // Step 2: Apply kata() transformation
    const transformedFunction = kata(originalFunction);

    // Behind the scenes, kata() performs these steps:
    // 1. Detects Node.js runtime (nodejs20.x)
    // 2. Calls ensureNodeRuntimeLayer() to create/find Node.js layer
    // 3. Switches runtime to Python 3.12 for Lambda Kata
    // 4. Attaches Node.js layer for runtime support
    // 5. Attaches configuration layer with handler path
    // 6. Attaches Lambda Kata layer for optimization

    // Step 3: Add additional resources that depend on the function
    const api = new cdk.aws_apigateway.RestApi(this, 'MyApi', {
      restApiName: 'Node.js Layer Demo API',
    });

    const integration = new cdk.aws_apigateway.LambdaIntegration(transformedFunction);
    api.root.addMethod('GET', integration);

    // Step 4: Output important information
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'FunctionName', {
      value: transformedFunction.functionName,
      description: 'Lambda Function Name',
    });
  }
}

// Deployment script
async function deployWorkflow() {
  const app = new cdk.App();
  
  const stack = new NodeJsLayerWorkflowStack(app, 'NodeJsLayerWorkflowStack', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
  });

  // The CDK deployment will automatically:
  // 1. Synthesize the CloudFormation template
  // 2. Create the Node.js layer during synthesis (if needed)
  // 3. Deploy all resources including the transformed Lambda function
  // 4. Attach all necessary layers in the correct order

  console.log('CDK synthesis and deployment completed');
  console.log('Your Node.js function is now optimized with Lambda Kata!');
}
```

### Workflow 4: Error Handling and Recovery

This example demonstrates comprehensive error handling scenarios.

#### Error Handling Workflow

```typescript
// workflow-example-4.ts
import { 
  ensureNodeRuntimeLayer, 
  NodeRuntimeLayerError, 
  ErrorCodes 
} from '@lambda-kata/cdk';

async function errorHandlingWorkflow() {
  const logger = createDefaultLogger();
  
  logger.info('Starting error handling workflow demonstration');

  // Scenario 1: Invalid Runtime Error
  try {
    logger.info('=== SCENARIO 1: Invalid Runtime ===');
    
    await ensureNodeRuntimeLayer({
      runtimeName: 'nodejs16.x', // Unsupported runtime
      architecture: 'x86_64',
      region: 'us-east-1',
      accountId: '123456789012',
    });
    
  } catch (error) {
    if (error instanceof NodeRuntimeLayerError) {
      logger.info('Expected error caught', {
        errorCode: error.code,
        expectedCode: ErrorCodes.RUNTIME_UNSUPPORTED,
        message: error.message,
      });
      
      // Handle the error appropriately
      if (error.code === ErrorCodes.RUNTIME_UNSUPPORTED) {
        logger.info('Suggestion: Use nodejs18.x, nodejs20.x, or nodejs22.x');
      }
    }
  }

  // Scenario 2: Docker Unavailable with Fallback
  try {
    logger.info('=== SCENARIO 2: Docker Fallback ===');
    
    // Simulate Docker unavailable by using a detector with fallback enabled
    const { DockerRuntimeDetector } = await import('@lambda-kata/cdk');
    
    const detector = new DockerRuntimeDetector({
      logger,
      enableFallback: true, // Enable fallback when Docker fails
    });
    
    const versionInfo = await detector.detectNodeVersion('nodejs20.x', 'x86_64');
    
    logger.info('Fallback version detection successful', {
      version: versionInfo.version,
      source: 'fallback-mapping',
      dockerImage: versionInfo.dockerImage,
    });
    
  } catch (error) {
    logger.error('Even fallback failed', { error });
  }

  // Scenario 3: AWS API Error with Retry
  try {
    logger.info('=== SCENARIO 3: AWS API Retry Logic ===');
    
    // This will demonstrate the retry logic for transient AWS errors
    const result = await ensureNodeRuntimeLayer({
      runtimeName: 'nodejs20.x',
      architecture: 'x86_64',
      region: 'us-east-1',
      accountId: '123456789012',
      awsSdkConfig: {
        maxAttempts: 3, // Configure retry attempts
        retryMode: 'adaptive', // Use adaptive retry mode
      },
    });
    
    logger.info('AWS operation succeeded (possibly after retries)', {
      layerArn: result.layerArn,
    });
    
  } catch (error) {
    if (error instanceof NodeRuntimeLayerError) {
      logger.error('AWS operation failed after retries', {
        errorCode: error.code,
        message: error.message,
        troubleshooting: getTroubleshootingGuide(error.code),
      });
    }
  }

  // Scenario 4: Resource Cleanup on Failure
  logger.info('=== SCENARIO 4: Resource Cleanup ===');
  
  const { AWSLayerManager } = await import('@lambda-kata/cdk');
  const layerManager = new AWSLayerManager({ logger });
  
  try {
    // Attempt layer creation that might fail
    await layerManager.createNodeLayer({
      layerName: 'test-layer-cleanup',
      nodeVersion: '20.10.0',
      architecture: 'x86_64',
      region: 'us-east-1',
    });
    
  } catch (error) {
    logger.info('Layer creation failed, but cleanup was performed automatically', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // Always clean up resources
    layerManager.destroy();
    logger.info('Layer manager resources cleaned up');
  }

  logger.info('Error handling workflow completed');
}

function getTroubleshootingGuide(errorCode: string): string {
  const guides: Record<string, string> = {
    [ErrorCodes.DOCKER_UNAVAILABLE]: 'Install Docker and ensure the daemon is running',
    [ErrorCodes.AWS_API_ERROR]: 'Check AWS credentials and permissions',
    [ErrorCodes.LAYER_CREATION_FAILED]: 'Verify AWS Lambda permissions and account limits',
    [ErrorCodes.RUNTIME_UNSUPPORTED]: 'Use supported runtimes: nodejs18.x, nodejs20.x, nodejs22.x',
    [ErrorCodes.INVALID_ARCHITECTURE]: 'Use supported architectures: x86_64, arm64',
  };
  
  return guides[errorCode] || 'Check logs for detailed error information';
}
```

## Error Handling

### Common Error Scenarios

#### 1. Docker Not Available

```typescript
try {
  const result = await ensureNodeRuntimeLayer(options);
} catch (error) {
  if (error instanceof NodeRuntimeLayerError && 
      error.code === ErrorCodes.VERSION_DETECTION_FAILED) {
    
    console.log('Docker unavailable, using fallback version detection');
    
    // Retry with fallback enabled
    const detectorWithFallback = new DockerRuntimeDetector({
      enableFallback: true,
    });
  }
}
```

#### 2. AWS API Failures

```typescript
try {
  const result = await ensureNodeRuntimeLayer({
    ...options,
    awsSdkConfig: {
      maxAttempts: 5,
      retryMode: 'adaptive',
    },
  });
} catch (error) {
  if (error instanceof NodeRuntimeLayerError && 
      error.code === ErrorCodes.AWS_API_ERROR) {
    
    console.error('AWS API error:', error.message);
    console.log('Check your AWS credentials and permissions');
  }
}
```

## Performance Optimization

### Caching Strategies

```typescript
// Enable version caching for better performance
const detector = new DockerRuntimeDetector({
  enableCache: true,
  cacheTTL: 24 * 60 * 60 * 1000, // 24 hours
});

// Reuse the same detector instance across multiple calls
const cachedVersionInfo = await detector.detectNodeVersion('nodejs20.x', 'x86_64');
```

### Concurrent Operations

```typescript
// Handle multiple layer requests efficiently
const layerRequests = [
  { runtime: 'nodejs18.x', arch: 'x86_64' },
  { runtime: 'nodejs20.x', arch: 'x86_64' },
  { runtime: 'nodejs20.x', arch: 'arm64' },
];

const results = await Promise.all(
  layerRequests.map(req => 
    ensureNodeRuntimeLayer({
      runtimeName: req.runtime,
      architecture: req.arch,
      region: 'us-east-1',
      accountId: '123456789012',
    })
  )
);

console.log('All layers created/found:', results.map(r => r.layerArn));
```

## Troubleshooting

### Common Issues and Solutions

#### Issue 1: "Docker daemon not running"

**Solution:**
```bash
# Start Docker daemon
open -a Docker  # macOS
sudo systemctl start docker  # Linux

# Verify Docker is running
docker ps
```

#### Issue 2: "AWS credentials not configured"

**Solution:**
```bash
# Configure AWS CLI
aws configure

# Or set environment variables
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_DEFAULT_REGION=us-east-1
```

#### Issue 3: "Layer size exceeds limit"

**Solution:**
```typescript
// The system automatically handles layer size optimization
// If you encounter size issues, check your Docker image
const result = await ensureNodeRuntimeLayer({
  // ... options
});

// Layer content is automatically minimized to include only Node.js binary
```

#### Issue 4: "Permission denied for Lambda operations"

**Required AWS Permissions:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:ListLayers",
        "lambda:ListLayerVersions",
        "lambda:PublishLayerVersion",
        "lambda:GetLayerVersion"
      ],
      "Resource": "*"
    }
  ]
}
```

### Debug Mode

```typescript
import { createDefaultLogger } from '@lambda-kata/cdk/logger';

const debugLogger = createDefaultLogger();
debugLogger.setLevel('debug'); // Enable debug logging

const result = await ensureNodeRuntimeLayer({
  runtimeName: 'nodejs20.x',
  architecture: 'x86_64',
  region: 'us-east-1',
  accountId: '123456789012',
  logger: debugLogger, // Use debug logger
});
```

## Conclusion

The Node.js Layer Management system provides a robust, production-ready solution for automatically managing Node.js runtime layers in AWS Lambda. With comprehensive error handling, performance optimization, and seamless CDK integration, it enables developers to focus on business logic while the system handles runtime complexity automatically.

For additional support or advanced use cases, refer to the API documentation or contact the development team.
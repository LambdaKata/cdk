# Lambda Kata CDK - API Reference

## Core Functions

### `kata(lambda, options?)`

Transforms a Node.js Lambda function to use the Lambda Kata runtime with automatic Node.js layer management.

**Signature:**
```typescript
function kata<T extends NodejsFunction | LambdaFunction>(
  lambda: T,
  options?: KataWrapperOptions
): T
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `lambda` | `NodejsFunction \| LambdaFunction` | ✅ | The Lambda function to transform |
| `options` | `KataWrapperOptions` | ❌ | Configuration options |

**Returns:** The same Lambda construct (modified if licensed)

**Example:**
```typescript
import { kata } from '@lambdakata/cdk';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

const myFunction = new NodejsFunction(this, 'MyFunction', {
  entry: 'src/handler.ts',
  runtime: Runtime.NODEJS_20_X,
});

// Basic transformation
kata(myFunction);

// With options
kata(myFunction, {
  unlicensedBehavior: 'fail',
  handlerResolver: (bundle, ctx) => {
    const handlerName = ctx.originalHandler.split('.').pop();
    return bundle[handlerName];
  },
});
```

### `ensureNodeRuntimeLayer(options)`

Low-level API for managing Node.js runtime layers. Automatically called by `kata()` for Node.js functions.

**Signature:**
```typescript
function ensureNodeRuntimeLayer(
  options: EnsureNodeRuntimeLayerOptions
): Promise<EnsureNodeRuntimeLayerResult>
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options` | `EnsureNodeRuntimeLayerOptions` | ✅ | Layer management configuration |

**Returns:** Promise resolving to layer information

**Example:**
```typescript
import { ensureNodeRuntimeLayer } from '@lambdakata/cdk';

const result = await ensureNodeRuntimeLayer({
  runtimeName: 'nodejs20.x',
  architecture: 'x86_64',
  region: 'us-east-1',
  accountId: '123456789012',
});

console.log(`Layer ARN: ${result.layerArn}`);
console.log(`Node.js version: ${result.nodeVersion}`);
console.log(`Created new layer: ${result.created}`);
```

## Type Definitions

### `KataWrapperOptions`

Configuration options for the `kata()` function.

```typescript
interface KataWrapperOptions {
  unlicensedBehavior?: 'warn' | 'fail';
  bundlePath?: string;
  middlewarePath?: string;
  handlerResolver?: HandlerResolver;
  licensingEndpoint?: string;
  awsSdkConfig?: LambdaClientConfig;
  logger?: Logger;
}
```

**Properties:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `unlicensedBehavior` | `'warn' \| 'fail'` | `'warn'` | Behavior when account is not licensed |
| `bundlePath` | `string` | `undefined` | Custom path to JavaScript bundle |
| `middlewarePath` | `string` | `undefined` | Path to middleware TypeScript/JavaScript file |
| `handlerResolver` | `HandlerResolver` | `undefined` | Inline handler resolver function |
| `licensingEndpoint` | `string` | `undefined` | Custom licensing service endpoint |
| `awsSdkConfig` | `LambdaClientConfig` | `undefined` | Custom AWS SDK configuration |
| `logger` | `Logger` | `undefined` | Custom logger implementation |

**Constraints:**
- `middlewarePath` and `handlerResolver` are mutually exclusive
- `handlerResolver` must be a pure function (no closures)

### `EnsureNodeRuntimeLayerOptions`

Configuration for Node.js runtime layer management.

```typescript
interface EnsureNodeRuntimeLayerOptions {
  runtimeName: string;
  architecture: 'x86_64' | 'arm64';
  region: string;
  accountId: string;
  awsSdkConfig?: LambdaClientConfig;
  logger?: Logger;
}
```

**Properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `runtimeName` | `string` | ✅ | AWS Lambda runtime (nodejs18.x, nodejs20.x, nodejs22.x) |
| `architecture` | `'x86_64' \| 'arm64'` | ✅ | Target architecture |
| `region` | `string` | ✅ | AWS region |
| `accountId` | `string` | ✅ | AWS account ID (12 digits) |
| `awsSdkConfig` | `LambdaClientConfig` | ❌ | Custom AWS SDK configuration |
| `logger` | `Logger` | ❌ | Custom logger |

### `EnsureNodeRuntimeLayerResult`

Result of Node.js runtime layer management.

```typescript
interface EnsureNodeRuntimeLayerResult {
  layerArn: string;
  layerName: string;
  runtimeName: string;
  nodeVersion: string;
  architecture: 'x86_64' | 'arm64';
  created: boolean;
}
```

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `layerArn` | `string` | ARN of the Lambda Layer |
| `layerName` | `string` | Name of the Lambda Layer |
| `runtimeName` | `string` | Original runtime name requested |
| `nodeVersion` | `string` | Exact Node.js version (e.g., "20.10.0") |
| `architecture` | `'x86_64' \| 'arm64'` | Architecture of the layer |
| `created` | `boolean` | Whether a new layer was created (true) or reused (false) |

### `HandlerResolver`

Function signature for custom handler resolution.

```typescript
type HandlerResolver = (
  bundle: unknown,
  context: { originalHandler: string }
) => Function;
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `bundle` | `unknown` | The loaded JavaScript bundle |
| `context.originalHandler` | `string` | Original handler path (e.g., "index.handler") |

**Returns:** The handler function to invoke

**Example:**
```typescript
const resolver: HandlerResolver = (bundle, ctx) => {
  const handlerName = ctx.originalHandler.split('.').pop();
  const handlers = bundle as Record<string, Function>;
  
  if (!handlers[handlerName]) {
    throw new Error(`Handler ${handlerName} not found`);
  }
  
  return handlers[handlerName];
};
```

### `Logger`

Interface for custom logging implementations.

```typescript
interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

**Example Implementation:**
```typescript
class CustomLogger implements Logger {
  debug(message: string, meta?: Record<string, unknown>): void {
    console.debug(`[DEBUG] ${message}`, meta);
  }
  
  info(message: string, meta?: Record<string, unknown>): void {
    console.info(`[INFO] ${message}`, meta);
  }
  
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[WARN] ${message}`, meta);
  }
  
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(`[ERROR] ${message}`, meta);
  }
}
```

## Utility Functions

### `isKataTransformed(lambda)`

Checks if a Lambda function has been transformed by `kata()`.

**Signature:**
```typescript
function isKataTransformed(lambda: NodejsFunction | LambdaFunction): boolean
```

**Example:**
```typescript
const myFunction = new NodejsFunction(this, 'MyFunction', { ... });
kata(myFunction);

if (isKataTransformed(myFunction)) {
  console.log('Function is using Lambda Kata runtime');
}
```

### `getKataPromise(lambda)`

Gets the transformation promise for a Lambda function (useful for testing).

**Signature:**
```typescript
function getKataPromise(
  lambda: NodejsFunction | LambdaFunction
): Promise<KataResult> | undefined
```

**Example:**
```typescript
const myFunction = new NodejsFunction(this, 'MyFunction', { ... });
kata(myFunction);

const result = await getKataPromise(myFunction);
if (result?.transformed) {
  console.log(`Transformed with layer: ${result.licensingResponse.layerArn}`);
}
```

### `createDefaultLogger(level?)`

Creates a default console logger with configurable log level.

**Signature:**
```typescript
function createDefaultLogger(level?: 'debug' | 'info' | 'warn' | 'error'): Logger
```

**Example:**
```typescript
import { createDefaultLogger } from '@lambdakata/cdk';

const logger = createDefaultLogger('debug');
kata(myFunction, { logger });
```

## Error Handling

### `NodeRuntimeLayerError`

Specialized error class for Node.js layer management operations.

```typescript
class NodeRuntimeLayerError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCodes,
    public readonly cause?: Error
  );
}
```

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `message` | `string` | Human-readable error message |
| `code` | `ErrorCodes` | Structured error code |
| `cause` | `Error?` | Optional underlying error |

### `ErrorCodes`

Enumeration of error codes for structured error handling.

```typescript
enum ErrorCodes {
  DOCKER_UNAVAILABLE = 'DOCKER_UNAVAILABLE',
  RUNTIME_UNSUPPORTED = 'RUNTIME_UNSUPPORTED',
  AWS_API_ERROR = 'AWS_API_ERROR',
  LAYER_CREATION_FAILED = 'LAYER_CREATION_FAILED',
  INVALID_ARCHITECTURE = 'INVALID_ARCHITECTURE',
  VERSION_DETECTION_FAILED = 'VERSION_DETECTION_FAILED',
  LAYER_SIZE_EXCEEDED = 'LAYER_SIZE_EXCEEDED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
```

**Error Handling Example:**
```typescript
try {
  const result = await ensureNodeRuntimeLayer(options);
} catch (error) {
  if (error instanceof NodeRuntimeLayerError) {
    switch (error.code) {
      case ErrorCodes.DOCKER_UNAVAILABLE:
        console.error('Docker is not available. Please install Docker.');
        break;
      case ErrorCodes.AWS_API_ERROR:
        console.error('AWS API error:', error.message);
        break;
      default:
        console.error('Layer management error:', error.message);
    }
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Advanced Configuration

### Custom AWS SDK Configuration

```typescript
import { LambdaClientConfig } from '@aws-sdk/client-lambda';

const awsConfig: LambdaClientConfig = {
  region: 'eu-west-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  maxAttempts: 5,
  retryMode: 'adaptive',
  requestTimeout: 30000,
};

kata(myFunction, { awsSdkConfig: awsConfig });
```

### Custom Handler Resolution with Error Handling

```typescript
const robustResolver: HandlerResolver = (bundle, ctx) => {
  try {
    const handlerPath = ctx.originalHandler.split('.');
    const handlerName = handlerPath.pop();
    
    let target = bundle;
    for (const segment of handlerPath.slice(0, -1)) {
      target = (target as any)[segment];
      if (!target) {
        throw new Error(`Module path ${handlerPath.slice(0, -1).join('.')} not found`);
      }
    }
    
    const handler = (target as any)[handlerName];
    if (typeof handler !== 'function') {
      throw new Error(`Handler ${handlerName} is not a function`);
    }
    
    return handler;
  } catch (error) {
    console.error('Handler resolution failed:', error);
    throw error;
  }
};

kata(myFunction, { handlerResolver: robustResolver });
```

### Middleware with Logging and Metrics

```typescript
const instrumentedResolver: HandlerResolver = (bundle, ctx) => {
  const handlerName = ctx.originalHandler.split('.').pop();
  const originalHandler = (bundle as any)[handlerName];
  
  return async (event: any, context: any) => {
    const startTime = Date.now();
    const requestId = context.awsRequestId;
    
    console.log('Lambda invocation started', {
      requestId,
      handler: handlerName,
      event: JSON.stringify(event),
    });
    
    try {
      const result = await originalHandler(event, context);
      const duration = Date.now() - startTime;
      
      console.log('Lambda invocation completed', {
        requestId,
        duration,
        success: true,
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error('Lambda invocation failed', {
        requestId,
        duration,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      throw error;
    }
  };
};
```

## Migration Patterns

### From Manual Layer Management

```typescript
// Before: Manual layer management
const manualLayer = LayerVersion.fromLayerVersionArn(
  this,
  'NodeLayer',
  'arn:aws:lambda:us-east-1:123456789012:layer:my-node-layer:1'
);

const myFunction = new NodejsFunction(this, 'MyFunction', {
  entry: 'src/handler.ts',
  layers: [manualLayer],
});

// After: Automatic layer management
const myFunction = new NodejsFunction(this, 'MyFunction', {
  entry: 'src/handler.ts',
});

kata(myFunction); // Automatically manages Node.js layer
```

### Conditional Transformation

```typescript
// Apply kata transformation conditionally
const myFunction = new NodejsFunction(this, 'MyFunction', {
  entry: 'src/handler.ts',
});

// Only transform in production
if (this.node.tryGetContext('environment') === 'production') {
  kata(myFunction);
}
```

### Multi-Region Deployment

```typescript
class MultiRegionStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    
    const myFunction = new NodejsFunction(this, 'MyFunction', {
      entry: 'src/handler.ts',
    });
    
    // Layer will be created in the stack's region
    kata(myFunction, {
      awsSdkConfig: {
        region: this.region, // Use stack's region
      },
    });
  }
}

// Deploy to multiple regions
const app = new App();
['us-east-1', 'eu-west-1', 'ap-southeast-1'].forEach(region => {
  new MultiRegionStack(app, `MyStack-${region}`, {
    env: { region, account: process.env.CDK_DEFAULT_ACCOUNT },
  });
});
```

## Testing

### Unit Testing with Mocks

```typescript
import { kata, getKataPromise } from '@lambdakata/cdk';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { App, Stack } from 'aws-cdk-lib';

describe('Lambda Kata Integration', () => {
  test('should transform Node.js function', async () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    
    const myFunction = new NodejsFunction(stack, 'TestFunction', {
      entry: 'test/handler.ts',
    });
    
    kata(myFunction);
    
    // Wait for transformation to complete
    const result = await getKataPromise(myFunction);
    
    expect(result?.transformed).toBe(true);
    expect(result?.licensingResponse.entitled).toBe(true);
  });
});
```

### Integration Testing

```typescript
import { Template } from 'aws-cdk-lib/assertions';

test('CDK template includes Node.js layer', () => {
  const app = new App();
  const stack = new Stack(app, 'TestStack');
  
  const myFunction = new NodejsFunction(stack, 'TestFunction', {
    entry: 'test/handler.ts',
  });
  
  kata(myFunction);
  
  const template = Template.fromStack(stack);
  
  // Verify Lambda function transformation
  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'python3.12',
    Handler: 'lambdakata.optimized_handler.lambda_handler',
  });
  
  // Verify layers are attached
  template.hasResourceProperties('AWS::Lambda::Function', {
    Layers: Match.arrayWith([
      Match.stringLikeRegexp('lambda-kata-nodejs-.*'),
    ]),
  });
});
```

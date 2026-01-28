# Config Layer Example

This example demonstrates the **config layer approach** for Lambda Kata integration, where the original handler path is stored in a dedicated Lambda Layer instead of the `JS_HANDLER_PATH` environment variable.

## Overview

### What Changed?

| Aspect | Old Approach | New Approach (Config Layer) |
|--------|--------------|----------------------------|
| Handler Path Storage | `JS_HANDLER_PATH` env var | `/opt/.kata/original_handler.json` |
| Configuration Location | Environment variables | Dedicated Lambda Layer |
| Separation of Concerns | Mixed with other env vars | Clean separation |

### Benefits

1. **Cleaner Environment**: Handler path is not mixed with other environment variables
2. **Better Separation**: Configuration is isolated in its own layer
3. **Same Developer Experience**: Just call `kata(myFunction)` - no changes needed
4. **Easier Debugging**: Config is in a predictable file location

## Files

```
config-layer-example/
├── handler.ts    # Lambda handler with config layer verification
├── stack.ts      # CDK stack demonstrating kata() with config layer
└── README.md     # This file
```

## How It Works

When you call `kata(myFunction)`:

1. **Config Layer Created**: A new Lambda Layer is created containing:
   ```
   /opt/.kata/original_handler.json
   ```
   With content:
   ```json
   {
     "original_js_handler": "index.handler"
   }
   ```

2. **Layers Attached**: Both the config layer and Lambda Kata layer are attached

3. **Runtime Changed**: Node.js → Python 3.12

4. **Handler Changed**: Your handler → `lambdakata.optimized_handler.lambda_handler`

5. **Environment Variables Set**:
   - `JS_BUNDLE_PATH` ✓
   - `USE_CTYPES_BRIDGE` ✓
   - `JS_HANDLER_PATH` ✗ (NOT set - this is the key change!)

## Deployment

### Prerequisites

1. AWS CLI configured with appropriate credentials
2. Node.js 18+ installed
3. CDK CLI installed (`npm install -g aws-cdk`)
4. Lambda Kata AWS Marketplace subscription (for production use)

### Deploy the Stack

```bash
# Navigate to the cdk-integration directory
cd cdk-integration

# Install dependencies
npm install

# Bootstrap CDK (if not already done)
npx cdk bootstrap

# Deploy the example stack
npx cdk deploy ConfigLayerExampleStack
```

### Test the Function

```bash
# Invoke the Lambda function
aws lambda invoke \
  --function-name ConfigLayerExampleFunction \
  --payload '{}' \
  output.json

# View the response
cat output.json | jq .
```

### Expected Response

A successful invocation returns:

```json
{
  "statusCode": 200,
  "body": {
    "message": "Config Layer Example - Handler Path from Layer",
    "timestamp": "2024-...",
    "verification": {
      "jsHandlerPathNotSet": true,
      "jsHandlerPathValue": null,
      "configLayerExists": true,
      "configLayerPath": "/opt/.kata/original_handler.json",
      "configLayerContent": {
        "original_js_handler": "index.handler"
      },
      "allChecksPass": true
    },
    "environment": {
      "JS_BUNDLE_PATH": "/opt/js_runtime/bundle.js",
      "USE_CTYPES_BRIDGE": "true",
      "JS_HANDLER_PATH": "(not set - as expected)"
    }
  }
}
```

### Verification Points

The handler verifies:

| Check | Expected | Description |
|-------|----------|-------------|
| `jsHandlerPathNotSet` | `true` | `JS_HANDLER_PATH` env var should NOT be set |
| `configLayerExists` | `true` | Config file should exist at `/opt/.kata/original_handler.json` |
| `configLayerContent.original_js_handler` | `"index.handler"` | Should contain the original handler path |
| `allChecksPass` | `true` | All verification checks passed |

## Cleanup

```bash
# Remove the deployed stack
npx cdk destroy ConfigLayerExampleStack
```

## Troubleshooting

### Config Layer Not Found

If `configLayerExists` is `false`:
- Ensure the Lambda Kata layer is properly attached
- Check that the kata() wrapper was called on the function
- Verify the CDK synthesis completed without errors

### JS_HANDLER_PATH Is Set

If `jsHandlerPathNotSet` is `false`:
- You may be using an older version of the kata() wrapper
- Check that you're using the latest @lambda-kata/cdk package
- Ensure no other code is setting this environment variable

### Handler Path Incorrect

If `original_js_handler` has an unexpected value:
- Check the `handler` property in your NodejsFunction definition
- The value should match your exported handler function name

## Code Example

```typescript
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { kata } from '@lambda-kata/cdk';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create your Lambda function as usual
    const myFunction = new NodejsFunction(this, 'MyFunction', {
      entry: 'src/handler.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
    });

    // Wrap with kata() - config layer is created automatically
    // No JS_HANDLER_PATH environment variable is set
    kata(myFunction);
  }
}
```

## Related Documentation

- [Lambda Kata Overview](../../../README.md)
- [CDK Integration Guide](../../README.md)
- [Config Layer Design](../../../.kiro/specs/config-layer-handler-path/design.md)

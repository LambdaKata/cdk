# Config Layer Example

This example demonstrates the **config layer** that `kata()` attaches to a transformed Lambda function. The original handler path is stored in a dedicated Lambda layer at `/opt/.kata/original_handler.json`, which the Lambda Kata runtime reads during initialization.

## How It Works

When you call `kata(myFunction)` on an entitled AWS account:

1. **Config Layer Created** — a layer containing a single file:

   ```
   /opt/.kata/original_handler.json
   ```

   with content:

   ```json
   {
     "original_js_handler": "handler"
   }
   ```

2. **Layers Attached** — the config layer and the customer-specific Lambda Kata layer are attached to the function.

3. **Runtime Changed** — the runtime becomes `python3.12`.

4. **Handler Changed** — the handler becomes `lambdakata.optimized_handler.lambda_handler`.

Your original JavaScript/TypeScript code remains unchanged. The Lambda Kata runtime reads the config layer to determine which JavaScript handler to invoke.

### Config Layer Keys

| Key | When present | Description |
|-----|--------------|-------------|
| `original_js_handler` | Always | The original handler path (e.g. `"handler"`) |
| `bundle_path` | When `bundlePath` option is passed to `kata()` | Custom path to the JavaScript bundle |
| `has_middleware` | When `middlewarePath` or `handlerResolver` is passed to `kata()` | `true` if compiled middleware is included at `/opt/.kata/middleware.js` |

## Files

```
config-layer-example/
├── handler.ts    # Lambda handler that reads and returns the config layer file
├── stack.ts      # CDK stack demonstrating kata() with the config layer
└── README.md     # This file
```

## Deployment

### Prerequisites

1. AWS credentials configured for the target account
2. Node.js 20+ installed
3. AWS CDK v2 CLI installed (`npm install -g aws-cdk`)
4. An active Lambda Kata AWS Marketplace subscription for the AWS account
   (entitlement is validated during CDK synthesis)

### Deploy the Stack

Add `ConfigLayerExampleStack` to your CDK application and deploy it:

```bash
# Install the package in your CDK application
npm install @lambdakata/cdk

# Deploy the stack
npx cdk deploy ConfigLayerExampleStack
```

### Invoke the Function

```bash
aws lambda invoke \
  --function-name ConfigLayerExampleFunction \
  --payload '{}' \
  output.json

cat output.json | jq .
```

### Expected Response

A successful invocation returns the contents of the config layer file:

```json
{
  "message": "Config Layer Example - Handler Path from Config Layer",
  "timestamp": "2024-...",
  "configLayer": {
    "path": "/opt/.kata/original_handler.json",
    "exists": true,
    "content": {
      "original_js_handler": "handler"
    },
    "readError": null
  },
  "context": {
    "requestId": "...",
    "functionName": "ConfigLayerExampleFunction",
    "memoryLimitInMB": "256"
  }
}
```

### Verification Points

| Field | Expected | Description |
|-------|----------|-------------|
| `configLayer.exists` | `true` | The config file exists at `/opt/.kata/original_handler.json` |
| `configLayer.content.original_js_handler` | `"handler"` | Contains the original handler path |
| `statusCode` | `200` | Returned when the config layer is present and contains the handler path |

## Cleanup

```bash
npx cdk destroy ConfigLayerExampleStack
```

## Troubleshooting

### Config Layer Not Found

If `configLayer.exists` is `false`:

- Confirm `kata()` was called on the function in your CDK stack
- Confirm the AWS account has an active Lambda Kata Marketplace subscription
  (an unentitled account is deployed without transformation)
- Check that CDK synthesis completed without warnings from Lambda Kata

### Handler Path Incorrect

If `configLayer.content.original_js_handler` has an unexpected value:

- Check the `handler` property of your `NodejsFunction` definition
- The value should match your exported handler function name

## Code Example

```typescript
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { kata } from '@lambdakata/cdk';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create your Lambda function as usual
    const myFunction = new NodejsFunction(this, 'MyFunction', {
      entry: 'src/handler.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
    });

    // Wrap with kata() - the config layer is created and attached automatically
    kata(myFunction);
  }
}
```

## Related Documentation

- [CDK Integration Guide](../../README.md)
- [Middleware Example](../middleware-example/README.md)

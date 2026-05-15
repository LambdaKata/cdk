<h1 align="center" style="font-weight:500">
  Lambda Kata for AWS CDK integration
</h1>

<p align="center">
  Transform Node.js Lambda functions to run via the Lambda Kata runtime.
</p>

<p align="center">
  <a href="https://aws.amazon.com/marketplace/pp/prodview-dce6qhwrlygwo" target="_blank"><img src="https://img.shields.io/badge/AWS Marketplace-Lambda%20Kata-ff4500?style=for-the-badge" alt="Lambda Kata ecosystem"></a>
  <a href="https://www.npmjs.com/package/@lambdakata/cdk" target="_blank"><img src="https://img.shields.io/badge/npm-@lambdakata%2Fcdk-cc3534?style=for-the-badge&logo=npm" alt="npm package"></a>
  <a href="https://www.npmjs.com/package/@lambdakata/cdk" target="_blank"><img src="https://img.shields.io/badge/version-0.1.3--rc.97-brightgreen?style=for-the-badge&logo=semver" alt="Version"></a>
  <a href="https://docs.aws.amazon.com/cdk/v2/guide/home.html" target="_blank"><img src="https://img.shields.io/badge/AWS%20CDK-v2-4B8BBE?style=for-the-badge&logo=amazonwebservices" alt="AWS CDK v2"></a>
  <a href="https://nodejs.org" target="_blank"><img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs" alt="Node.js 18+"></a>
  <a href="https://www.typescriptlang.org" target="_blank"><img src="https://img.shields.io/badge/TypeScript-5.3%2B-3178C6?style=for-the-badge&logo=typescript" alt="TypeScript 5.3+"></a>
  <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&logo=opensourceinitiative" alt="License Apache-2.0"></a>
  <a href="https://jestjs.io" target="_blank"><img src="https://img.shields.io/badge/tests-Jest%20%7C%20fast--check-brightgreen?style=for-the-badge&logo=jest" alt="Tests"></a>
  <a href="https://esbuild.github.io" target="_blank"><img src="https://img.shields.io/badge/build-esbuild%20%2B%20tsc-FFCF00?style=for-the-badge&logo=esbuild" alt="Build"></a>
</p>



## Installation

```bash
npm install @lambdakata/cdk
```

## Quick Start

```typescript
import { kata } from '@lambdakata/cdk';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const myFunction = new NodejsFunction(this, 'MyFunction', {
      entry: 'src/handler.ts',
    });

    // Transform to use Lambda Kata runtime
    kata(myFunction);
  }
}
```

## How It Works

The `kata()` wrapper transforms your Node.js Lambda function to run via the Lambda Kata runtime:

1. **Runtime Change**: Switches from Node.js to Python 3.12
2. **Handler Update**: Sets handler to `lambdakata.optimized_handler.lambda_handler`
3. **Layer Attachment**: Attaches the customer-specific Lambda Kata Layer
4. **Config Layer**: Creates a config layer with handler path at `/opt/.kata/original_handler.json`

Your original JavaScript/TypeScript code remains unchanged - the Lambda Kata runtime executes it through an embedded Node.js engine.

## Custom Handler Resolution

Lambda Kata supports two ways to customize how handlers are resolved:

### Option 1: Inline Handler Resolver (Recommended)

Write the resolver function directly in your CDK code:

```typescript
kata(myFunction, {
  handlerResolver: (bundle, ctx) => {
    const handlerName = ctx.originalHandler.split('.').pop() as string;
    return (bundle as Record<string, Function>)[handlerName];
  },
});
```

The function is:
1. Serialized to a temporary TypeScript file
2. Compiled with esbuild
3. Included in the config layer as `/opt/.kata/middleware.js`

**Use cases:**
- Handler wrapping with logging/metrics
- Environment-based handler selection
- Multi-handler routing

**Example with logging wrapper:**

```typescript
kata(myFunction, {
  handlerResolver: (bundle, ctx) => {
    const handlerName = ctx.originalHandler.split('.').pop() as string;
    const originalHandler = (bundle as Record<string, Function>)[handlerName];

    // Wrap with logging
    return async (event: unknown, lambdaCtx: unknown) => {
      console.log('Invocation started', { handler: handlerName });
      const start = Date.now();
      try {
        const result = await originalHandler(event, lambdaCtx);
        console.log('Invocation completed', { durationMs: Date.now() - start });
        return result;
      } catch (error) {
        console.error('Invocation failed', { error });
        throw error;
      }
    };
  },
});
```

### Option 2: Middleware File

For complex middleware logic, use a separate TypeScript file:

```typescript
kata(myFunction, {
  middlewarePath: path.join(__dirname, 'middleware.ts'),
});
```

See [Middleware Example](./examples/middleware-example/README.md) for details.

## Handler Resolver Function Signature

```typescript
type HandlerResolver = (
  bundle: unknown,
  context: { originalHandler: string }
) => Function;
```

| Parameter | Description |
|-----------|-------------|
| `bundle` | The loaded JavaScript bundle (result of `require()`) |
| `context.originalHandler` | The original handler path (e.g., `"index.handler"`) |
| **Returns** | The handler function to invoke |

**Important:** The function must be pure (no closures over external CDK variables) because it's serialized via `.toString()`.

## API Reference

### `kata(lambda, options?)`

Transforms a Node.js Lambda function to use Lambda Kata runtime.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `lambda` | `NodejsFunction \| Function` | The Lambda function to transform |
| `options` | `KataWrapperOptions` | Optional configuration |

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `unlicensedBehavior` | `'warn' \| 'fail'` | Behavior when account is not licensed. Default: `'warn'` |
| `bundlePath` | `string` | Custom path to JavaScript bundle |
| `middlewarePath` | `string` | Path to middleware TypeScript/JavaScript file |
| `handlerResolver` | `Function` | Inline handler resolver function |

**Note:** `middlewarePath` and `handlerResolver` are mutually exclusive.

## Requirements

- AWS CDK v2
- Node.js 18+
- Valid AWS Marketplace subscription for Lambda Kata

## Examples

See the [examples](./examples) directory:

- [Basic Usage](./examples/example-stack.ts) - Simple kata() transformation
- [Middleware Example](./examples/middleware-example) - Custom handler resolution with middleware file
- [Config Layer Example](./examples/config-layer-example) - Handler path configuration

## Contributing

**Security:** Report vulnerabilities privately to [raman@worktif.com](mailto:raman@worktif.com)

## License

Apache-2.0

<h1 align="center" style="font-weight:500">
  Lambda Kata for AWS CDK integration
</h1>

<p align="center">
  Transform Node.js Lambda functions to run via the Lambda Kata runtime.
</p>

<p align="center">
  <a href="https://aws.amazon.com/marketplace/pp/prodview-dce6qhwrlygwo" target="_blank"><img src="https://img.shields.io/badge/AWS%20Marketplace-Lambda%20Kata-ff4500?style=for-the-badge&logo=amazonaws&logoColor=white" alt="AWS Marketplace – Lambda Kata" title="Lambda Kata on AWS Marketplace"></a>
  <a href="https://github.com/LambdaKata/cdk/blob/main/LICENSE" target="_blank"><img src="https://img.shields.io/github/license/LambdaKata/cdk?style=for-the-badge&logo=opensourceinitiative&logoColor=white&color=blue" alt="License Apache-2.0" title="@lambdakata/cdk is licensed under Apache-2.0"></a>
</p>

<!-- Package -->
<p align="center">
  <a href="https://www.npmjs.com/package/@lambdakata/cdk" target="_blank"><img src="https://img.shields.io/npm/v/@lambdakata/cdk?style=for-the-badge&logo=npm&label=npm" alt="npm version" title="Latest @lambdakata/cdk version on npm"></a>
  <a href="https://www.npmjs.com/package/@lambdakata/cdk" target="_blank"><img src="https://img.shields.io/npm/dm/@lambdakata/cdk?style=for-the-badge&logo=npm&label=downloads" alt="npm downloads per month" title="@lambdakata/cdk monthly downloads"></a>
  <a href="https://www.npmjs.com/package/@lambdakata/cdk" target="_blank"><img src="https://img.shields.io/node/v/@lambdakata/cdk?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Required Node.js version" title="Minimum supported Node.js version"></a>
  <a href="https://www.typescriptlang.org" target="_blank"><img src="https://img.shields.io/npm/types/@lambdakata/cdk?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript types included" title="Ships with TypeScript type definitions"></a>
</p>

<!-- Platform & peers -->
<p align="center">
  <a href="https://docs.aws.amazon.com/cdk/v2/guide/home.html" target="_blank"><img src="https://img.shields.io/github/package-json/dependency-version/LambdaKata/cdk/peer/aws-cdk-lib?style=for-the-badge&logo=amazonwebservices&logoColor=white&label=aws-cdk-lib" alt="aws-cdk-lib peer dependency" title="Required aws-cdk-lib version"></a>
  <a href="https://github.com/aws/constructs" target="_blank"><img src="https://img.shields.io/github/package-json/dependency-version/LambdaKata/cdk/peer/constructs?style=for-the-badge&logo=amazonwebservices&logoColor=white&label=constructs" alt="constructs peer dependency" title="Required constructs version"></a>
  <a href="https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html" target="_blank"><img src="https://img.shields.io/badge/target%20runtime-python3.12-3776ab?style=for-the-badge&logo=python&logoColor=white" alt="Target runtime Python 3.12" title="kata() transforms functions to the python3.12 runtime"></a>
</p>


<!-- Build & quality -->
<p align="center">
  <a href="https://github.com/LambdaKata/cdk/actions/workflows/ci.yml" target="_blank"><img src="https://img.shields.io/github/actions/workflow/status/LambdaKata/cdk/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=CI" alt="CI status" title="CI workflow status on main"></a>
  <a href="https://github.com/LambdaKata/cdk/actions/workflows/release.yml" target="_blank"><img src="https://img.shields.io/github/actions/workflow/status/LambdaKata/cdk/release.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=release" alt="Release build status" title="Release workflow status"></a>
  <a href="https://jestjs.io" target="_blank"><img src="https://img.shields.io/badge/tested%20with-Jest%20%2B%20fast--check-99425b?style=for-the-badge&logo=jest&logoColor=white" alt="Tested with Jest and fast-check" title="Unit and property-based tests"></a>
  <a href="https://esbuild.github.io" target="_blank"><img src="https://img.shields.io/badge/built%20with-esbuild%20%2B%20tsc-ffcf00?style=for-the-badge&logo=esbuild&logoColor=black" alt="Built with esbuild and tsc" title="Bundled with esbuild, typed with tsc"></a>
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

On an entitled AWS account, the `kata()` wrapper transforms your Node.js Lambda function to run via the Lambda Kata runtime:

1. **Runtime Change**: Switches the runtime to Python 3.12
2. **Handler Update**: Sets the handler to `lambdakata.optimized_handler.lambda_handler`
3. **Customer Layer**: Attaches the customer-specific Lambda Kata layer (resolved from your Marketplace entitlement)
4. **Config Layer**: Creates a config layer with the original handler path at `/opt/.kata/original_handler.json`
5. **Node.js Runtime Layer**: Attaches a Node.js runtime layer (region-specific) so the runtime can execute your JavaScript
6. **SnapStart**: Enables SnapStart and publishes a `kata` alias for reduced cold starts

Your original JavaScript/TypeScript code remains unchanged - the Lambda Kata runtime executes it through an embedded Node.js engine.

If the account is **not** entitled, `kata()` leaves the function unchanged (Node.js runtime) and emits a warning by default. See `unlicensedBehavior` to fail synthesis instead.

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
- Node.js 20+
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

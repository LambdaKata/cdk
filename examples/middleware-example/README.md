# Middleware Example

This example demonstrates custom handler resolution for Lambda Kata using both approaches:
1. **Inline `handlerResolver`** (recommended) - function directly in CDK code
2. **`middlewarePath`** - separate TypeScript file

## Two Approaches

### Approach 1: Inline Handler Resolver (Recommended)

Write the resolver function directly in your CDK stack:

```typescript
kata(myFunction, {
  handlerResolver: (bundle, ctx) => {
    const handlerName = ctx.originalHandler.split('.').pop() as string;
    const handler = (bundle as Record<string, Function>)[handlerName];
    
    // Wrap with logging
    return async (event: unknown, lambdaCtx: unknown) => {
      console.log('Invocation started');
      const result = await handler(event, lambdaCtx);
      console.log('Invocation completed');
      return result;
    };
  },
});
```

**Benefits:**
- No separate file needed
- Handler resolution logic lives with your CDK stack
- Each Lambda can have its own resolver
- Full TypeScript support

### Approach 2: Middleware File

For complex middleware with multiple dependencies:

```typescript
kata(myFunction, {
  middlewarePath: path.join(__dirname, 'middleware.ts'),
});
```

**When to use:**
- Middleware has external dependencies
- Shared middleware across multiple projects
- Complex logic that benefits from separate file

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
| **Returns** | The resolved handler function |

## How It Works

### CDK Synthesis Time

1. **Inline `handlerResolver`**: Function is serialized to temporary `.ts` file
2. **`middlewarePath`**: Uses the provided file path
3. TypeScript is compiled with esbuild
4. Compiled middleware placed at `/opt/.kata/middleware.js` in config layer
5. Config JSON includes `has_middleware: true`

### Lambda Runtime

1. Bundle loaded from configured path
2. `/opt/.kata/middleware.js` loaded via `require()`
3. Middleware called with `(bundle, { originalHandler })`
4. Returned handler validated as function
5. Ready signal sent

## Common Patterns

### Pattern 1: Simple Resolution

```typescript
handlerResolver: (bundle, ctx) => {
  const handlerName = ctx.originalHandler.split('.').pop() as string;
  return (bundle as Record<string, Function>)[handlerName];
}
```

### Pattern 2: Logging Wrapper

```typescript
handlerResolver: (bundle, ctx) => {
  const handlerName = ctx.originalHandler.split('.').pop() as string;
  const handler = (bundle as Record<string, Function>)[handlerName];
  
  return async (event: unknown, lambdaCtx: unknown) => {
    const start = Date.now();
    console.log('Invocation started', { handler: handlerName });
    
    try {
      const result = await handler(event, lambdaCtx);
      console.log('Invocation completed', { durationMs: Date.now() - start });
      return result;
    } catch (error) {
      console.error('Invocation failed', { error });
      throw error;
    }
  };
}
```

### Pattern 3: Environment-based Selection

```typescript
handlerResolver: (bundle, ctx) => {
  const b = bundle as Record<string, Function>;
  const version = process.env.HANDLER_VERSION || 'v1';
  
  if (version === 'v2' && b['handlerV2']) {
    return b['handlerV2'];
  }
  
  const handlerName = ctx.originalHandler.split('.').pop() as string;
  return b[handlerName];
}
```

### Pattern 4: Multi-handler Routing

```typescript
handlerResolver: (bundle, ctx) => {
  const b = bundle as Record<string, Function>;
  
  if (ctx.originalHandler.includes('api')) {
    return b['apiHandler'];
  } else if (ctx.originalHandler.includes('worker')) {
    return b['workerHandler'];
  }
  
  const handlerName = ctx.originalHandler.split('.').pop() as string;
  return b[handlerName];
}
```

## Files in This Example

```
middleware-example/
├── middleware.ts  # Example middleware file (for middlewarePath approach)
├── handler.ts     # Lambda handler with multiple exports
├── stack.ts       # CDK stack using middlewarePath
└── README.md      # This file
```

## Important Notes

### Pure Functions Only

The `handlerResolver` function must be pure - no closures over external CDK variables:

```typescript
// ❌ BAD - closure over external variable
const prefix = 'MyApp';
kata(myFunction, {
  handlerResolver: (bundle, ctx) => {
    console.log(prefix); // This will fail!
    return bundle[ctx.originalHandler.split('.').pop()];
  },
});

// ✅ GOOD - self-contained function
kata(myFunction, {
  handlerResolver: (bundle, ctx) => {
    const prefix = 'MyApp'; // Define inside
    console.log(prefix);
    return (bundle as Record<string, Function>)[ctx.originalHandler.split('.').pop() as string];
  },
});
```

### Mutual Exclusivity

Cannot use both `middlewarePath` and `handlerResolver`:

```typescript
// ❌ This will throw an error
kata(myFunction, {
  middlewarePath: './middleware.ts',
  handlerResolver: (bundle, ctx) => bundle[ctx.originalHandler],
});
```

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `Cannot specify both middlewarePath and handlerResolver` | Both options provided | Use one or the other |
| `Middleware file not found` | `middlewarePath` points to non-existent file | Check file path |
| `Middleware must export a function` | Middleware doesn't export function | Ensure `export default function` |
| `Handler is not a function` | Resolver returned non-function | Return valid function |

## Related Documentation

- [CDK Integration Guide](../../README.md)
- [Example Stack](../example-stack.ts) - Shows inline `handlerResolver` examples
- [Config Layer Example](../config-layer-example/README.md)

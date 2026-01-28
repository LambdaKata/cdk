/**
 * Example Middleware for Lambda Kata
 *
 * This middleware demonstrates custom handler resolution patterns that can be
 * used with the Lambda Kata runtime. The middleware receives the loaded bundle
 * and context, and returns the resolved handler function.
 *
 * ## Middleware Function Signature
 *
 * ```typescript
 * type MiddlewareFunction = (bundle: any, context: { originalHandler: string }) => Function;
 * ```
 *
 * ## Use Cases Demonstrated
 *
 * 1. **Environment-based Handler Selection**: Choose different handlers based on
 *    environment variables (e.g., staging vs production)
 *
 * 2. **Handler Wrapping with Logging**: Wrap the handler with logging/metrics
 *    to track invocations and performance
 *
 * 3. **Multi-handler Routing**: Route to different handlers based on the
 *    original handler path pattern
 *
 * ## Requirements Validated
 *
 * - Requirement 2.4: Middleware module exports a function with signature (bundle, context) => handler
 * - Requirement 2.5: Context parameter includes originalHandler
 *
 * @module middleware-example
 */

/**
 * Context provided to the middleware function.
 */
interface MiddlewareContext {
    /**
     * The original handler path from the Lambda configuration.
     * Format: "module.function" (e.g., "index.handler")
     */
    originalHandler: string;
}

/**
 * Lambda handler function type.
 */
type LambdaHandler = (event: unknown, context: unknown) => Promise<unknown>;

/**
 * Example middleware that demonstrates custom handler resolution.
 *
 * This middleware showcases several patterns:
 *
 * 1. **Logging Wrapper**: Wraps the handler with logging to track invocations
 * 2. **Environment-based Selection**: Can select different handlers based on env vars
 * 3. **Handler Path Parsing**: Demonstrates parsing the originalHandler path
 *
 * @param bundle - The loaded JavaScript bundle (result of require())
 * @param context - Context object containing the original handler path
 * @returns The resolved handler function
 *
 * @example
 * ```typescript
 * // In your CDK stack:
 * kata(myFunction, {
 *   middlewarePath: path.join(__dirname, 'middleware.ts'),
 * });
 * ```
 */
export default function middleware(
    bundle: Record<string, unknown>,
    context: MiddlewareContext
): LambdaHandler {
    // Log middleware invocation for debugging
    console.log('[Middleware] Resolving handler', {
        originalHandler: context.originalHandler,
        bundleKeys: Object.keys(bundle),
    });

    // Parse the handler path to get the function name
    // Format: "module.function" -> extract "function"
    const handlerParts = context.originalHandler.split('.');
    const handlerName = handlerParts[handlerParts.length - 1];

    // Get the base handler from the bundle
    const baseHandler = bundle[handlerName];

    if (typeof baseHandler !== 'function') {
        throw new Error(
            `Handler "${handlerName}" not found in bundle. ` +
            `Available exports: ${Object.keys(bundle).join(', ')}`
        );
    }

    // ============================================================
    // Pattern 1: Environment-based Handler Selection
    // ============================================================
    //
    // You can select different handlers based on environment variables.
    // This is useful for A/B testing, feature flags, or environment-specific logic.
    //
    // Example:
    // const handlerVariant = process.env.HANDLER_VARIANT || 'default';
    // if (handlerVariant === 'v2' && bundle['handlerV2']) {
    //     return wrapWithLogging(bundle['handlerV2'] as LambdaHandler, 'v2');
    // }

    // ============================================================
    // Pattern 2: Handler Wrapping with Logging/Metrics
    // ============================================================
    //
    // Wrap the handler to add cross-cutting concerns like logging,
    // metrics, error handling, or request validation.
    //
    const wrappedHandler = wrapWithLogging(baseHandler as LambdaHandler, handlerName);

    console.log('[Middleware] Handler resolved successfully', {
        handlerName,
        wrapped: true,
    });

    return wrappedHandler;
}

/**
 * Wraps a handler with logging functionality.
 *
 * This demonstrates how middleware can add cross-cutting concerns
 * to handlers without modifying the original handler code.
 *
 * @param handler - The original handler function
 * @param handlerName - Name of the handler for logging
 * @returns Wrapped handler with logging
 */
function wrapWithLogging(
    handler: LambdaHandler,
    handlerName: string
): LambdaHandler {
    return async (event: unknown, lambdaContext: unknown): Promise<unknown> => {
        const startTime = Date.now();
        const requestId = (lambdaContext as { awsRequestId?: string })?.awsRequestId || 'unknown';

        console.log('[Middleware] Handler invocation started', {
            handlerName,
            requestId,
            timestamp: new Date().toISOString(),
        });

        try {
            // Call the original handler
            const result = await handler(event, lambdaContext);

            const duration = Date.now() - startTime;
            console.log('[Middleware] Handler invocation completed', {
                handlerName,
                requestId,
                durationMs: duration,
                success: true,
            });

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error('[Middleware] Handler invocation failed', {
                handlerName,
                requestId,
                durationMs: duration,
                error: error instanceof Error ? error.message : String(error),
            });

            // Re-throw the error to preserve original behavior
            throw error;
        }
    };
}

// ============================================================
// Alternative Export Styles
// ============================================================
//
// The middleware can also be exported using module.exports:
//
// module.exports = function(bundle, context) { ... };
//
// Or as a named export (though default export is preferred):
//
// export function resolveHandler(bundle, context) { ... };

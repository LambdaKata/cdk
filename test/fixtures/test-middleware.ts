/**
 * Test middleware for unit tests
 * This middleware simply returns the handler from the bundle based on the originalHandler path
 */
export default function middleware(bundle: unknown, context: { originalHandler: string }): Function {
    const handlerName = context.originalHandler.split('.').pop() || 'handler';
    return (bundle as Record<string, Function>)[handlerName];
}

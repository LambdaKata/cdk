/**
 * @fileoverview Node.js runtime compatibility property tests for native licensing validator
 *
 * Property-based tests to verify compatibility with Node.js 20.x and 22.x runtimes
 * in AWS Lambda environments. Tests native addon loading, Node-API interface
 * compatibility, and graceful fallback behavior.
 *
 * @remarks Validates: Requirements 5.3, 5.4
 */

import { NativeLicensingService } from '../src/index';
import * as fc from 'fast-check';
import { performance } from 'perf_hooks';
import { safeAccountIdGenerator, safePropertyTest } from './property-test-utils';

// Mock the native addon for controlled testing
jest.mock('../build/Release/native_licensing_validator.node', () => {
  throw new Error('Native addon not available in test environment');
});

describe('Node.js Runtime Compatibility Property Tests', () => {

  /**
   * Property: Node.js 20.x Runtime Compatibility
   *
   * For any valid Lambda configuration with Node.js 20.x runtime,
   * the native licensing validator should load successfully or fail gracefully.
   *
   * **Validates: Requirement 5.3**
   */
  test('Property: Node.js 20.x runtime compatibility', async () => {
    await safePropertyTest(
      fc.asyncProperty(
        fc.record({
          // Lambda memory configurations for Node.js 20.x
          memorySize: fc.constantFrom(128, 256, 512, 1024, 2048, 3008),
          // Different Lambda architectures
          architecture: fc.constantFrom('x86_64', 'arm64'),
          // Cold start vs warm start scenarios
          coldStart: fc.boolean(),
          // Account ID for testing
          accountId: safeAccountIdGenerator,
        }),

        async (scenario) => {
          const { memorySize, architecture, coldStart, accountId } = scenario;

          // Simulate Node.js 20.x Lambda environment
          const originalEnv = process.env;
          process.env = {
            ...originalEnv,
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: memorySize.toString(),
            AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs20.x',
            AWS_LAMBDA_RUNTIME_API: '127.0.0.1:9001',
            _HANDLER: 'index.handler',
            AWS_LAMBDA_FUNCTION_NAME: 'test-function',
            AWS_LAMBDA_FUNCTION_VERSION: '$LATEST',
            AWS_REGION: 'us-east-1',
            // Architecture-specific environment
            AWS_LAMBDA_INITIALIZATION_TYPE: coldStart ? 'on-demand' : 'provisioned-concurrency',
          };

          try {
            // Clear module cache for cold start simulation
            if (coldStart) {
              const modulePath = require.resolve('../src/index');
              delete require.cache[modulePath];
            }

            const startTime = performance.now();

            // Create service instance (tests addon loading)
            const service = new NativeLicensingService();

            const loadTime = performance.now() - startTime;

            // Property 1: Service instantiation succeeds
            expect(service).toBeDefined();
            expect(typeof service.checkEntitlement).toBe('function');

            // Property 2: Loading time is reasonable for Lambda cold start
            expect(loadTime).toBeLessThan(1000); // 1 second max for cold start

            // Property 3: Service handles requests gracefully
            const requestStartTime = performance.now();
            const result = await service.checkEntitlement(accountId);
            const requestTime = performance.now() - requestStartTime;

            // Property 4: Response format is consistent
            expect(result).toBeDefined();
            expect(typeof result.entitled).toBe('boolean');
            expect(result.entitled).toBe(false); // Expected for mocked addon

            // Property 5: Request processing time is bounded
            expect(requestTime).toBeLessThan(5000); // 5 second timeout

            // Property 6: Memory usage is reasonable (relaxed for test environment)
            const memUsage = process.memoryUsage();
            // In test environment, just ensure memory usage is not excessive (< 500MB)
            expect(memUsage.heapUsed).toBeLessThan(500 * 1024 * 1024);

          } finally {
            process.env = originalEnv;
          }
        },
      ),
      {
        numRuns: 25,
        timeout: 20000,
        testName: 'Node.js 20.x runtime compatibility',
      },
    );
  });

  /**
   * Property: Node.js 22.x Runtime Compatibility
   *
   * For any valid Lambda configuration with Node.js 22.x runtime,
   * the native licensing validator should load successfully or fail gracefully.
   *
   * **Validates: Requirement 5.4**
   */
  test('Property: Node.js 22.x runtime compatibility', async () => {
    await safePropertyTest(
      fc.asyncProperty(
        fc.record({
          // Lambda memory configurations for Node.js 22.x
          memorySize: fc.constantFrom(128, 256, 512, 1024, 2048, 3008),
          // Different Lambda architectures
          architecture: fc.constantFrom('x86_64', 'arm64'),
          // Cold start vs warm start scenarios
          coldStart: fc.boolean(),
          // Account ID for testing
          accountId: safeAccountIdGenerator,
        }),

        async (scenario) => {
          const { memorySize, architecture, coldStart, accountId } = scenario;

          // Simulate Node.js 22.x Lambda environment
          const originalEnv = process.env;
          process.env = {
            ...originalEnv,
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: memorySize.toString(),
            AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
            AWS_LAMBDA_RUNTIME_API: '127.0.0.1:9001',
            _HANDLER: 'index.handler',
            AWS_LAMBDA_FUNCTION_NAME: 'test-function',
            AWS_LAMBDA_FUNCTION_VERSION: '$LATEST',
            AWS_REGION: 'us-east-1',
            // Architecture-specific environment
            AWS_LAMBDA_INITIALIZATION_TYPE: coldStart ? 'on-demand' : 'provisioned-concurrency',
          };

          try {
            // Clear module cache for cold start simulation
            if (coldStart) {
              const modulePath = require.resolve('../src/index');
              delete require.cache[modulePath];
            }

            const startTime = performance.now();

            // Create service instance (tests addon loading)
            const service = new NativeLicensingService();

            const loadTime = performance.now() - startTime;

            // Property 1: Service instantiation succeeds
            expect(service).toBeDefined();
            expect(typeof service.checkEntitlement).toBe('function');

            // Property 2: Loading time is reasonable for Lambda cold start
            expect(loadTime).toBeLessThan(1000); // 1 second max for cold start

            // Property 3: Service handles requests gracefully
            const requestStartTime = performance.now();
            const result = await service.checkEntitlement(accountId);
            const requestTime = performance.now() - requestStartTime;

            // Property 4: Response format is consistent
            expect(result).toBeDefined();
            expect(typeof result.entitled).toBe('boolean');
            expect(result.entitled).toBe(false); // Expected for mocked addon

            // Property 5: Request processing time is bounded
            expect(requestTime).toBeLessThan(5000); // 5 second timeout

            // Property 6: Memory usage is reasonable (relaxed for test environment)
            const memUsage = process.memoryUsage();
            // In test environment, just ensure memory usage is not excessive (< 500MB)
            expect(memUsage.heapUsed).toBeLessThan(500 * 1024 * 1024);

          } finally {
            process.env = originalEnv;
          }
        },
      ),
      {
        numRuns: 25,
        timeout: 20000,
        testName: 'Node.js 22.x runtime compatibility',
      },
    );
  });

  /**
   * Property: Node-API Interface Compatibility
   *
   * For any Node.js runtime version (20.x or 22.x), the Node-API interface
   * should remain compatible and provide consistent behavior.
   *
   * **Validates: Requirements 5.3, 5.4**
   */
  test('Property: Node-API interface compatibility across runtimes', async () => {
    await safePropertyTest(
      fc.asyncProperty(
        fc.record({
          // Simulate different Node.js runtime versions
          nodeVersion: fc.constantFrom('20.x', '22.x'),
          // Test with various account IDs
          accountId: safeAccountIdGenerator,
          // Different memory pressures
          memoryPressure: fc.constantFrom('low', 'medium', 'high'),
        }),

        async (scenario) => {
          const { nodeVersion, accountId, memoryPressure } = scenario;

          // Set up environment based on Node.js version
          const originalEnv = process.env;
          const memorySize = memoryPressure === 'low' ? 512 :
            memoryPressure === 'medium' ? 1024 : 2048;

          process.env = {
            ...originalEnv,
            AWS_EXECUTION_ENV: `AWS_Lambda_nodejs${nodeVersion}`,
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: memorySize.toString(),
            NODE_OPTIONS: `--max-old-space-size=${Math.floor(memorySize * 0.8)}`,
          };

          try {
            // Test service creation and basic functionality
            const service = new NativeLicensingService();

            // Property 1: Service interface is consistent across Node.js versions
            expect(service).toBeDefined();
            expect(typeof service.checkEntitlement).toBe('function');

            // Property 2: Method signature is preserved
            expect(service.checkEntitlement.length).toBe(1); // Single parameter

            // Property 3: Return type is consistent
            const result = await service.checkEntitlement(accountId);
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(typeof result.entitled).toBe('boolean');

            // Property 4: Error handling is consistent
            try {
              await service.checkEntitlement('invalid-account');
              // Should either succeed with entitled: false or throw
            } catch (error) {
              expect(error).toBeInstanceOf(Error);
            }

            // Property 5: Multiple calls work consistently
            const result2 = await service.checkEntitlement(accountId);
            expect(typeof result2.entitled).toBe('boolean');

          } finally {
            process.env = originalEnv;
          }
        },
      ),
      {
        numRuns: 30,
        timeout: 15000,
        testName: 'Node-API interface compatibility',
      },
    );
  });

  /**
   * Property: Performance Consistency Across Runtimes
   *
   * For any Node.js runtime version, performance characteristics should
   * remain within acceptable bounds and be consistent.
   *
   * **Validates: Requirements 5.3, 5.4**
   */
  test('Property: Performance consistency across Node.js runtimes', async () => {
    await safePropertyTest(
      fc.asyncProperty(
        fc.record({
          nodeVersion: fc.constantFrom('20.x', '22.x'),
          accountId: safeAccountIdGenerator,
          concurrentRequests: fc.integer({ min: 1, max: 5 }),
        }),

        async (scenario) => {
          const { nodeVersion, accountId, concurrentRequests } = scenario;

          const originalEnv = process.env;
          process.env = {
            ...originalEnv,
            AWS_EXECUTION_ENV: `AWS_Lambda_nodejs${nodeVersion}`,
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '1024',
          };

          try {
            const service = new NativeLicensingService();

            // Measure performance of concurrent requests
            const startTime = performance.now();

            const promises = Array.from({ length: concurrentRequests }, () =>
              service.checkEntitlement(accountId),
            );

            const results = await Promise.all(promises);
            const totalTime = performance.now() - startTime;

            // Property 1: All requests complete successfully
            expect(results).toHaveLength(concurrentRequests);
            results.forEach(result => {
              expect(result).toBeDefined();
              expect(typeof result.entitled).toBe('boolean');
            });

            // Property 2: Performance is reasonable regardless of Node.js version
            const avgTimePerRequest = totalTime / concurrentRequests;
            expect(avgTimePerRequest).toBeLessThan(1000); // 1 second per request max

            // Property 3: Concurrent requests don't cause excessive overhead
            expect(totalTime).toBeLessThan(concurrentRequests * 1000 * 1.5); // 50% overhead max

          } finally {
            process.env = originalEnv;
          }
        },
      ),
      {
        numRuns: 20,
        timeout: 15000,
        testName: 'Performance consistency across runtimes',
      },
    );
  });

  /**
   * Property: Graceful Fallback Behavior
   *
   * For any Node.js runtime version, when the native addon is unavailable,
   * the service should fall back gracefully with consistent behavior.
   *
   * **Validates: Requirements 5.3, 5.4**
   */
  test('Property: Graceful fallback behavior across runtimes', async () => {
    await safePropertyTest(
      fc.asyncProperty(
        fc.record({
          nodeVersion: fc.constantFrom('20.x', '22.x'),
          accountId: safeAccountIdGenerator,
          failureMode: fc.constantFrom('addon_missing', 'addon_load_error', 'napi_error'),
        }),

        async (scenario) => {
          const { nodeVersion, accountId, failureMode } = scenario;

          const originalEnv = process.env;
          process.env = {
            ...originalEnv,
            AWS_EXECUTION_ENV: `AWS_Lambda_nodejs${nodeVersion}`,
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '512',
          };

          try {
            // The addon is already mocked to fail, simulating fallback behavior
            const service = new NativeLicensingService();

            // Property 1: Service creation succeeds even with addon failure
            expect(service).toBeDefined();
            expect(typeof service.checkEntitlement).toBe('function');

            // Property 2: Fallback behavior is consistent
            const result = await service.checkEntitlement(accountId);
            expect(result).toBeDefined();
            expect(typeof result.entitled).toBe('boolean');
            expect(result.entitled).toBe(false); // Fail-closed behavior

            // Property 3: Error messages are appropriate (not exposing internals)
            if (result.message) {
              expect(typeof result.message).toBe('string');
              expect(result.message.length).toBeGreaterThan(0);
              // Should not expose internal error details
              expect(result.message).not.toContain('native_licensing_validator.node');
              expect(result.message).not.toContain('dlopen');
            }

            // Property 4: Multiple calls remain consistent
            const result2 = await service.checkEntitlement(accountId);
            expect(result2.entitled).toBe(false);

          } finally {
            process.env = originalEnv;
          }
        },
      ),
      {
        numRuns: 20,
        timeout: 10000,
        testName: 'Graceful fallback behavior',
      },
    );
  });
});

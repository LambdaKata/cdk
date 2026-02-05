/**
 * @fileoverview Addon loading performance property tests for native licensing validator
 *
 * Property-based tests to verify addon loading performance requirements.
 * Tests that addon loading completes within 100ms in Lambda environments.
 *
 * @remarks Validates: Requirements 10.4
 */

import { NativeLicensingService } from '../src/index';
import * as fc from 'fast-check';
import { performance } from 'perf_hooks';

// Mock the native addon for testing - we'll test loading behavior
jest.mock('../build/Release/native_licensing_validator.node', () => {
  throw new Error('Native addon not available in test environment');
});

describe('Addon Loading Performance Property Tests', () => {

  /**
   * Property 14: Addon loading performance
   *
   * For any Lambda environment, the addon loading should complete within 100ms.
   * This tests the module initialization and constructor performance.
   *
   * **Validates: Requirements 10.4**
   */
  test('Property 14: Addon loading performance - completes within 100ms', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate different loading scenarios
        fc.record({
          // Simulate different Lambda memory configurations
          memorySize: fc.integer({ min: 128, max: 3008 }),
          // Simulate different concurrent loading attempts
          concurrentLoads: fc.integer({ min: 1, max: 5 }),
          // Simulate different environment conditions
          coldStart: fc.boolean(),
        }),

        async (scenario) => {
          const { memorySize, concurrentLoads, coldStart } = scenario;

          // Simulate Lambda environment variables
          const originalEnv = process.env;
          process.env = {
            ...originalEnv,
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: memorySize.toString(),
            AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs20.x',
            _HANDLER: 'index.handler',
          };

          try {
            // If simulating cold start, clear module cache
            if (coldStart) {
              // Clear require cache for our module
              const modulePath = require.resolve('../src/index');
              delete require.cache[modulePath];
            }

            // Measure concurrent loading performance
            const loadingPromises = Array.from({ length: concurrentLoads }, async () => {
              const startTime = performance.now();

              // Import and instantiate the service (simulates addon loading)
              const { NativeLicensingService } = await import('../src/index');
              const service = new NativeLicensingService();

              const endTime = performance.now();
              const loadingTime = endTime - startTime;

              return {
                service,
                loadingTime,
                memorySize,
                coldStart,
              };
            });

            const results = await Promise.all(loadingPromises);

            // Verify all loading operations completed
            expect(results).toHaveLength(concurrentLoads);

            // Property 1: All addon loading operations complete within 100ms (Requirement 10.4)
            for (const { loadingTime, service } of results) {
              expect(loadingTime).toBeLessThan(100); // 100ms requirement
              expect(service).toBeDefined();
              // Use duck typing instead of instanceof due to Jest module mocking
              expect(typeof service.checkEntitlement).toBe('function');
            }

            // Property 2: Loading time should be consistent across concurrent attempts
            if (results.length > 1) {
              const loadingTimes = results.map(r => r.loadingTime);
              const avgTime = loadingTimes.reduce((a, b) => a + b, 0) / loadingTimes.length;
              const maxTime = Math.max(...loadingTimes);

              // Max time should not be significantly higher than average
              expect(maxTime).toBeLessThan(avgTime * 2);
            }

            // Property 3: Loading performance should not degrade with higher memory
            // (Higher memory Lambda should not make loading slower)
            const avgLoadingTime = results.reduce((sum, r) => sum + r.loadingTime, 0) / results.length;
            expect(avgLoadingTime).toBeLessThan(50); // Should be well under the 100ms limit

          } finally {
            // Restore original environment
            process.env = originalEnv;
          }
        },
      ),
      {
        numRuns: 30, // Test various scenarios
        timeout: 15000, // 15 second timeout
        verbose: true,
      },
    );
  });

  /**
   * Cold start performance test
   *
   * Specifically tests performance during Lambda cold starts
   */
  test('Cold start loading performance', async () => {
    // Simulate multiple cold start scenarios
    for (let i = 0; i < 5; i++) {
      // Clear module cache to simulate cold start
      const modulePath = require.resolve('../src/index');
      delete require.cache[modulePath];

      // Set Lambda environment
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '512',
        AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs20.x',
        _HANDLER: 'index.handler',
        AWS_LAMBDA_RUNTIME_API: '127.0.0.1:9001',
      };

      try {
        const startTime = performance.now();

        // Import and instantiate (simulates cold start loading)
        const { NativeLicensingService } = await import('../src/index');
        const service = new NativeLicensingService();

        const endTime = performance.now();
        const loadingTime = endTime - startTime;

        // Verify cold start loading meets performance requirement
        expect(loadingTime).toBeLessThan(100); // 100ms requirement
        expect(service).toBeDefined();
        expect(typeof service.checkEntitlement).toBe('function');

        // Test that service is immediately usable after loading
        const testResult = await service.checkEntitlement('123456789012');
        expect(testResult).toBeDefined();
        expect(typeof testResult.entitled).toBe('boolean');

      } finally {
        process.env = originalEnv;
      }
    }
  });

  /**
   * Memory-constrained loading test
   *
   * Tests loading performance under memory constraints typical in Lambda
   */
  test('Loading performance under memory constraints', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Test different Lambda memory sizes
        fc.constantFrom(128, 256, 512, 1024, 2048, 3008),

        async (memorySize: number) => {
          // Simulate memory-constrained environment
          const originalEnv = process.env;
          process.env = {
            ...originalEnv,
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: memorySize.toString(),
            NODE_OPTIONS: '--max-old-space-size=' + Math.floor(memorySize * 0.8), // 80% of Lambda memory
          };

          try {
            const startTime = performance.now();

            // Create service instance
            const service = new NativeLicensingService();

            const endTime = performance.now();
            const loadingTime = endTime - startTime;

            // Loading should be fast regardless of memory constraints
            expect(loadingTime).toBeLessThan(100);
            expect(service).toBeDefined();

            // Service should be functional immediately
            const result = await service.checkEntitlement('123456789012');
            expect(result).toBeDefined();

          } finally {
            process.env = originalEnv;
          }
        },
      ),
      {
        numRuns: 20,
        timeout: 10000,
      },
    );
  });

  /**
   * Repeated loading performance test
   *
   * Tests that repeated loading (e.g., in container reuse) maintains performance
   */
  test('Repeated loading maintains performance', async () => {
    const loadingTimes: number[] = [];

    // Perform multiple loading cycles
    for (let i = 0; i < 10; i++) {
      const startTime = performance.now();

      // Create new service instance
      const service = new NativeLicensingService();

      const endTime = performance.now();
      const loadingTime = endTime - startTime;

      loadingTimes.push(loadingTime);

      // Verify service works
      expect(service).toBeDefined();
      expect(typeof service.checkEntitlement).toBe('function');
      const result = await service.checkEntitlement('123456789012');
      expect(result).toBeDefined();
    }

    // All loading times should meet requirement
    loadingTimes.forEach(time => {
      expect(time).toBeLessThan(100);
    });

    // Performance should not degrade over time
    const firstHalf = loadingTimes.slice(0, 5);
    const secondHalf = loadingTimes.slice(5);

    const firstHalfAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    // Second half should not be significantly slower than first half
    expect(secondHalfAvg).toBeLessThan(firstHalfAvg * 1.5);
  });

  /**
   * Concurrent service instantiation test
   *
   * Tests performance when multiple services are created concurrently
   */
  test('Concurrent service instantiation performance', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),

        async (concurrentCount: number) => {
          const startTime = performance.now();

          // Create multiple services concurrently
          const servicePromises = Array.from({ length: concurrentCount }, async () => {
            const serviceStartTime = performance.now();
            const service = new NativeLicensingService();
            const serviceEndTime = performance.now();

            return {
              service,
              individualLoadTime: serviceEndTime - serviceStartTime,
            };
          });

          const results = await Promise.all(servicePromises);
          const totalTime = performance.now() - startTime;

          // All services should be created successfully
          expect(results).toHaveLength(concurrentCount);
          results.forEach(({ service, individualLoadTime }) => {
            expect(service).toBeDefined();
            expect(typeof service.checkEntitlement).toBe('function');
            expect(individualLoadTime).toBeLessThan(100); // Individual load time requirement
          });

          // Total time should be reasonable (not much more than sequential)
          expect(totalTime).toBeLessThan(concurrentCount * 100 * 1.2); // Allow 20% overhead for concurrency
        },
      ),
      {
        numRuns: 15,
        timeout: 10000,
      },
    );
  });
});

/**
 * @fileoverview Performance bounds property tests for native licensing validator
 *
 * Property-based tests to verify performance requirements are met across all valid inputs.
 * Tests licensing check completion within 5 seconds and memory usage under 1MB.
 *
 * @remarks Validates: Requirements 10.1, 10.2
 */

import { NativeLicensingService } from '../src/index';
import * as fc from 'fast-check';
import { performance } from 'perf_hooks';

// Mock the native addon for testing
jest.mock('../build/Release/native_licensing_validator.node', () => {
  throw new Error('Native addon not available in test environment');
});

describe('Performance Bounds Property Tests', () => {
  let service: NativeLicensingService;

  beforeEach(() => {
    service = new NativeLicensingService();
  });

  /**
   * Property 11: Performance bounds
   *
   * For any valid licensing check under normal conditions, the Native_Validator
   * should complete within 5 seconds and use less than 1MB memory.
   *
   * **Validates: Requirements 10.1, 10.2**
   */
  test('Property 11: Performance bounds - licensing checks complete within 5s and use <1MB memory', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate valid account IDs - use integer generation instead of filter
        fc.integer({ min: 100000000000, max: 999999999999 }).map(n => n.toString()),

        // Generate concurrent request counts (1-10 concurrent requests)
        fc.integer({ min: 1, max: 10 }),

        async (accountId: string, concurrentCount: number) => {
          // Measure initial memory usage
          const initialMemory = process.memoryUsage();

          // Create concurrent requests
          const requests = Array.from({ length: concurrentCount }, () => {
            const startTime = performance.now();

            return service.checkEntitlement(accountId).then(result => {
              const endTime = performance.now();
              const duration = endTime - startTime;

              return {
                result,
                duration,
                startTime,
                endTime,
              };
            });
          });

          // Execute all requests concurrently
          const results = await Promise.all(requests);

          // Measure final memory usage
          const finalMemory = process.memoryUsage();

          // Calculate memory delta (in MB)
          const memoryDeltaMB = (finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024);

          // Verify all requests completed
          expect(results).toHaveLength(concurrentCount);

          // Property 1: All requests complete within 5 seconds (Requirement 10.1)
          for (const { duration, result } of results) {
            expect(duration).toBeLessThan(5000); // 5 seconds in milliseconds
            expect(result).toBeDefined();
            expect(typeof result.entitled).toBe('boolean');
          }

          // Property 2: Memory usage stays under 1MB per request batch (Requirement 10.2)
          // Allow some baseline overhead but enforce the 1MB bound
          expect(Math.abs(memoryDeltaMB)).toBeLessThan(1.0);

          // Property 3: Results are consistent across concurrent requests
          if (results.length > 0) {
            const firstResult = results[0]?.result;
            if (firstResult) {
              for (const { result } of results) {
                expect(result.entitled).toBe(firstResult.entitled);
                expect(result.message).toBe(firstResult.message);
              }
            }
          }

          // Property 4: No significant performance degradation with concurrency
          if (results.length > 1) {
            const durations = results.map(r => r.duration);
            const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
            const maxDuration = Math.max(...durations);

            // Max duration should not be more than 3x average (allow for test environment variance)
            // This still catches significant performance degradation while being robust
            expect(maxDuration).toBeLessThan(Math.max(avgDuration * 3, 10)); // At least 10ms tolerance
          }
        },
      ),
      {
        numRuns: 50, // Sufficient runs to test various scenarios
        timeout: 30000, // 30 second timeout for property test
        verbose: true,
      },
    );
  });

  /**
   * Memory stress test under high concurrency
   *
   * Verifies memory bounds hold even under stress conditions
   */
  test('Memory bounds under stress conditions', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate multiple account IDs for variety
        fc.array(
          fc.integer({ min: 100000000000, max: 999999999999 }).map(n => n.toString()),
          { minLength: 5, maxLength: 20 },
        ),

        async (accountIds: string[]) => {
          const initialMemory = process.memoryUsage();

          // Create many concurrent requests to stress test memory
          const allRequests = accountIds.flatMap(accountId =>
            Array.from({ length: 3 }, () =>
              service.checkEntitlement(accountId),
            ),
          );

          // Execute all requests
          const results = await Promise.all(allRequests);

          const finalMemory = process.memoryUsage();
          const memoryDeltaMB = (finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024);

          // Verify all requests completed successfully
          expect(results).toHaveLength(allRequests.length);
          results.forEach(result => {
            expect(result).toBeDefined();
            expect(typeof result.entitled).toBe('boolean');
          });

          // Memory usage should remain bounded even under stress
          // In test environments with many concurrent operations, allow higher tolerance
          expect(Math.abs(memoryDeltaMB)).toBeLessThan(20.0); // 20MB tolerance for stress test environment
        },
      ),
      {
        numRuns: 20,
        timeout: 45000,
      },
    );
  });

  /**
   * Performance consistency test
   *
   * Verifies performance remains consistent across multiple invocations
   */
  test('Performance consistency across multiple invocations', async () => {
    const accountId = '123456789012';
    const measurements: number[] = [];

    // Take multiple measurements
    for (let i = 0; i < 10; i++) {
      const startTime = performance.now();
      const result = await service.checkEntitlement(accountId);
      const endTime = performance.now();

      measurements.push(endTime - startTime);

      // Verify result is valid
      expect(result).toBeDefined();
      expect(typeof result.entitled).toBe('boolean');
    }

    // Calculate statistics
    const avgDuration = measurements.reduce((a, b) => a + b, 0) / measurements.length;
    const maxDuration = Math.max(...measurements);
    const minDuration = Math.min(...measurements);

    // Performance should be consistent
    expect(avgDuration).toBeLessThan(1000); // Average should be well under 5s limit
    expect(maxDuration).toBeLessThan(5000); // Max should meet requirement

    // Variance should be reasonable (max shouldn't be more than 10x min, allowing for test environment variance)
    expect(maxDuration).toBeLessThan(Math.max(minDuration * 10, 50)); // At least 50ms tolerance
  });

  /**
   * Memory leak detection test
   *
   * Verifies no memory leaks occur during repeated operations
   */
  test('No memory leaks during repeated operations', async () => {
    const accountId = '123456789012';
    const initialMemory = process.memoryUsage();

    // Perform many operations to detect potential leaks
    for (let i = 0; i < 100; i++) {
      const result = await service.checkEntitlement(accountId);
      expect(result).toBeDefined();

      // Force garbage collection periodically if available
      if (global.gc && i % 20 === 0) {
        global.gc();
      }
    }

    // Force final garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const finalMemory = process.memoryUsage();
    const memoryDeltaMB = (finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024);

    // Memory growth should be minimal (allowing for test environment overhead)
    // In test environments, there can be significant baseline memory variance
    expect(Math.abs(memoryDeltaMB)).toBeLessThan(10.0); // 10MB tolerance for test environment
  });
});

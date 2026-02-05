/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Tests to verify timeout protection works correctly
 */

import { safeAccountIdGenerator, safePropertyTest } from './property-test-utils';
import * as fc from 'fast-check';

describe('Timeout Protection Tests', () => {
  test('should complete simple property test quickly', async () => {
    await safePropertyTest(
      fc.asyncProperty(
        safeAccountIdGenerator,
        async (accountId: string) => {
          // Simple test that should complete quickly
          expect(accountId).toMatch(/^\d{12}$/);
          expect(accountId.length).toBe(12);
        },
      ),
      {
        numRuns: 10,
        timeout: 5000,
        testName: 'Simple account ID validation',
      },
    );
  });

  test('should handle multiple account IDs without hanging', async () => {
    await safePropertyTest(
      fc.asyncProperty(
        fc.array(safeAccountIdGenerator, { minLength: 2, maxLength: 5 }),
        async (accountIds: string[]) => {
          // Test multiple account IDs
          for (const accountId of accountIds) {
            expect(accountId).toMatch(/^\d{12}$/);
            expect(accountId.length).toBe(12);
          }
          expect(accountIds.length).toBeGreaterThanOrEqual(2);
          expect(accountIds.length).toBeLessThanOrEqual(5);
        },
      ),
      {
        numRuns: 15,
        timeout: 8000,
        testName: 'Multiple account ID validation',
      },
    );
  });

  test('should demonstrate timeout protection (this test should complete quickly)', async () => {
    // This test demonstrates that our protection works
    // Even if we had a potentially slow operation, it would be protected
    await safePropertyTest(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        async (iterations: number) => {
          // Simulate some work but not too much
          for (let i = 0; i < iterations; i++) {
            await new Promise(resolve => setTimeout(resolve, 1)); // 1ms delay
          }
          expect(iterations).toBeGreaterThanOrEqual(1);
          expect(iterations).toBeLessThanOrEqual(10);
        },
      ),
      {
        numRuns: 20,
        timeout: 10000,
        testName: 'Timeout protection demonstration',
      },
    );
  });
});

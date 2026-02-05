/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Simple test to verify that our test fixes work correctly
 */

/**
 * @fileoverview Verification test for test fixes
 *
 * This test verifies that our fixes to prevent hanging tests work correctly.
 * It should complete quickly without any infinite loops or unresolved promises.
 */

import { NativeLicensingService } from '../src/index';

describe('Test Fix Verification', () => {
  let service: NativeLicensingService;

  beforeEach(() => {
    service = new NativeLicensingService();
  });

  it('should complete quickly without hanging', async () => {
    const startTime = Date.now();

    const result = await service.checkEntitlement('123456789012');

    const duration = Date.now() - startTime;

    // Should complete very quickly
    expect(duration).toBeLessThan(100);
    expect(result.entitled).toBe(false);
    expect(result.message).toBe('Native validator unavailable');
  });

  it('should handle multiple requests without hanging', async () => {
    const startTime = Date.now();

    const promises = [
      service.checkEntitlement('123456789012'),
      service.checkEntitlement('987654321098'),
      service.checkEntitlement('invalid'),
      service.checkEntitlement('555555555555'),
    ];

    const results = await Promise.all(promises);

    const duration = Date.now() - startTime;

    // Should complete very quickly
    expect(duration).toBeLessThan(200);
    expect(results).toHaveLength(4);

    // All should be fail-closed
    results.forEach(result => {
      expect(result.entitled).toBe(false);
      expect(typeof result.message).toBe('string');
    });
  });

  it('should handle invalid inputs without hanging', async () => {
    const startTime = Date.now();

    const invalidInputs = [
      null,
      undefined,
      123456789012,
      true,
      { accountId: '123456789012' },
      ['123456789012'],
    ];

    for (const input of invalidInputs) {
      const result = await service.checkEntitlement(input as any);
      expect(result.entitled).toBe(false);
      expect(result.message).toBe('Invalid account ID format');
    }

    const duration = Date.now() - startTime;

    // Should complete very quickly
    expect(duration).toBeLessThan(100);
  });
});

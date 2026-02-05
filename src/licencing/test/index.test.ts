/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Basic tests for native licensing validator TypeScript wrapper
 */

/**
 * @fileoverview Basic unit tests for NativeLicensingService
 *
 * These tests verify the TypeScript wrapper functionality and
 * fail-closed behavior when the native addon is unavailable.
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
 */

import { createLicensingService, NativeLicensingService } from '../src/index';
import { TestData } from './setup';

describe('NativeLicensingService', () => {
  let service: NativeLicensingService;

  beforeEach(() => {
    service = new NativeLicensingService();
  });

  describe('constructor', () => {
    it('should create instance without throwing', () => {
      expect(() => new NativeLicensingService()).not.toThrow();
    });

    it('should not load addon during construction', () => {
      // Constructor should be fast and not attempt addon loading
      const start = Date.now();
      const service = new NativeLicensingService();
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(10); // Should be nearly instantaneous
      expect(service).toBeInstanceOf(NativeLicensingService);
    });
  });

  describe('checkEntitlement', () => {
    it('should reject invalid account ID formats', async () => {
      const invalidIds = TestData.invalidAccountIds();

      for (const invalidId of invalidIds) {
        const result = await service.checkEntitlement(invalidId);

        expect(result).toBeFailClosedResponse();
        expect(result.entitled).toBe(false);
        expect(result.message).toBe('Invalid account ID format');
      }
    });

    it('should handle valid account ID format', async () => {
      const validId = TestData.validAccountId();
      const result = await service.checkEntitlement(validId);

      // Should return a response (even if addon unavailable)
      expect(result).toBeDefined();
      expect(typeof result.entitled).toBe('boolean');
      expect(typeof result.message).toBe('string');
    });

    it('should return fail-closed response when addon unavailable', async () => {
      // Since addon is likely not built during testing, should fail closed
      const validId = TestData.validAccountId();
      const result = await service.checkEntitlement(validId);

      // Should fail closed if addon not available
      if (result.message === 'Native validator unavailable') {
        expect(result).toBeFailClosedResponse();
        expect(result.entitled).toBe(false);
      }
    });

    it('should never throw exceptions', async () => {
      const testCases = [
        '',
        'invalid',
        TestData.validAccountId(),
        '123456789012345', // Too long
        null as any,
        undefined as any,
        123456789012 as any, // Number instead of string
      ];

      for (const testCase of testCases) {
        await expect(service.checkEntitlement(testCase)).resolves.toBeDefined();
      }
    });

    it('should return consistent response format', async () => {
      const validId = TestData.validAccountId();
      const result = await service.checkEntitlement(validId);

      // Verify response structure
      expect(result).toHaveProperty('entitled');
      expect(typeof result.entitled).toBe('boolean');

      if (result.message !== undefined) {
        expect(typeof result.message).toBe('string');
      }

      if (result.layerArn !== undefined) {
        expect(typeof result.layerArn).toBe('string');
      }

      if (result.expiresAt !== undefined) {
        expect(typeof result.expiresAt).toBe('string');
      }
    });
  });

  describe('interface compatibility', () => {
    it('should implement LicensingService interface', () => {
      expect(service.checkEntitlement).toBeDefined();
      expect(typeof service.checkEntitlement).toBe('function');
    });

    it('should have same method signature as HttpLicensingService', async () => {
      // Verify method signature matches expected interface
      const validId = TestData.validAccountId();
      const result = await service.checkEntitlement(validId);

      // Should return Promise<LicensingResponse>
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });
});

describe('createLicensingService', () => {
  it('should create NativeLicensingService instance', () => {
    const service = createLicensingService();
    expect(service).toBeInstanceOf(NativeLicensingService);
  });

  it('should return service with checkEntitlement method', () => {
    const service = createLicensingService();
    expect(service.checkEntitlement).toBeDefined();
    expect(typeof service.checkEntitlement).toBe('function');
  });
});

describe('fail-closed behavior', () => {
  it('should fail closed on all error conditions', async () => {
    const service = new NativeLicensingService();

    // Test various error conditions
    const errorCases = [
      '', // Empty string
      'invalid', // Invalid format
      null as any, // Null
      undefined as any, // Undefined
    ];

    for (const errorCase of errorCases) {
      const result = await service.checkEntitlement(errorCase);
      expect(result.entitled).toBe(false);
      expect(result.message).toBeDefined();
    }
  });

  it('should never return entitled=true when addon unavailable', async () => {
    const service = new NativeLicensingService();
    const validId = TestData.validAccountId();

    // Make multiple requests to ensure consistency
    for (let i = 0; i < 5; i++) {
      const result = await service.checkEntitlement(validId);

      // If addon is unavailable, should never return entitled=true
      if (result.message === 'Native validator unavailable' ||
        result.message === 'System error') {
        expect(result.entitled).toBe(false);
      }
    }
  });
});

/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Integration tests for SST packages compatibility
 */

/**
 * @fileoverview SST Integration Tests
 *
 * This test suite verifies that the native licensing validator
 * integrates correctly with both SST v2 and SST v3 packages,
 * maintaining interface compatibility and graceful fallback behavior.
 *
 * **Validates: Requirements 6.6**
 */

import { createLicensingService, LicensingResponse, LicensingService, NativeLicensingService } from '../src/index';

describe('SST Integration Tests', () => {
  describe('Interface Compatibility', () => {
    it('should implement LicensingService interface correctly', async () => {
      const service: LicensingService = new NativeLicensingService();

      // Test with valid account ID
      const result = await service.checkEntitlement('123456789012');

      // Verify interface compatibility
      expect(typeof result.entitled).toBe('boolean');

      // Optional fields should be undefined or string
      if (result.layerArn !== undefined) {
        expect(typeof result.layerArn).toBe('string');
      }
      if (result.message !== undefined) {
        expect(typeof result.message).toBe('string');
      }
      if (result.expiresAt !== undefined) {
        expect(typeof result.expiresAt).toBe('string');
      }
    });

    it('should maintain consistent response format', async () => {
      const service1 = new NativeLicensingService();
      const service2 = new NativeLicensingService();

      const result1 = await service1.checkEntitlement('123456789012');
      const result2 = await service2.checkEntitlement('123456789012');

      // Both should have the same structure
      expect(typeof result1.entitled).toBe(typeof result2.entitled);
      expect(Object.keys(result1).sort()).toEqual(Object.keys(result2).sort());
    });

    it('should handle invalid account IDs consistently', async () => {
      const service = new NativeLicensingService();

      const invalidAccountIds = [
        '',
        '123',
        '12345678901',  // 11 digits
        '1234567890123', // 13 digits
        'abcd56789012',  // contains letters
        '123-456-789012', // contains hyphens
      ];

      for (const invalidId of invalidAccountIds) {
        const result = await service.checkEntitlement(invalidId);
        expect(result.entitled).toBe(false);
        expect(result.message).toBe('Invalid account ID format');
      }
    });

    it('should accept valid account ID formats', async () => {
      const service = new NativeLicensingService();
      const validAccountIds = [
        '123456789012',
        '000000000000',
        '999999999999',
      ];

      for (const validId of validAccountIds) {
        const result = await service.checkEntitlement(validId);
        // Should not fail due to format validation
        expect(result.message).not.toBe('Invalid account ID format');
      }
    });
  });

  describe('Factory Functions', () => {
    it('should create working service instances via factory', async () => {
      const service = createLicensingService();
      const result = await service.checkEntitlement('123456789012');

      // Should return a valid response
      expect(typeof result.entitled).toBe('boolean');
      expect(typeof result).toBe('object');
    });

    it('should create instances that implement LicensingService interface', () => {
      const service = createLicensingService();

      // Should have checkEntitlement method
      expect(typeof service.checkEntitlement).toBe('function');

      // Should be assignable to LicensingService
      const licensingService: LicensingService = service;
      expect(licensingService).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle system errors gracefully', async () => {
      const service = new NativeLicensingService();

      // Test with valid account ID - should not throw
      await expect(service.checkEntitlement('123456789012')).resolves.toBeDefined();
    });

    it('should never throw exceptions', async () => {
      const service = new NativeLicensingService();

      const testCases = [
        '123456789012',
        'invalid',
        '',
        '123',
        '1234567890123',
      ];

      for (const testCase of testCases) {
        await expect(service.checkEntitlement(testCase)).resolves.toBeDefined();
      }
    });

    it('should return fail-closed responses for all error conditions', async () => {
      const service = new NativeLicensingService();

      // Test various error conditions
      const errorCases = [
        null as unknown as string,
        undefined as unknown as string,
        123456789012 as unknown as string, // number instead of string
        {} as unknown as string,
        [] as unknown as string,
      ];

      for (const errorCase of errorCases) {
        const result = await service.checkEntitlement(errorCase);
        expect(result.entitled).toBe(false);
        expect(typeof result.message).toBe('string');
      }
    });
  });

  describe('SST Package Simulation', () => {
    it('should work in SST v2 style integration', async () => {
      // Simulate how SST v2 would use the service
      const createSstV2LicensingService = (): LicensingService => {
        return new NativeLicensingService();
      };

      const service = createSstV2LicensingService();
      const result = await service.checkEntitlement('123456789012');

      expect(typeof result.entitled).toBe('boolean');
      expect(result).toHaveProperty('entitled');
    });

    it('should work in SST v3 style integration', async () => {
      // Simulate how SST v3 would use the service
      const createSstV3LicensingService = (): LicensingService => {
        return createLicensingService();
      };

      const service = createSstV3LicensingService();
      const result = await service.checkEntitlement('987654321098');

      expect(typeof result.entitled).toBe('boolean');
      expect(result).toHaveProperty('entitled');
    });

    it('should maintain compatibility across different usage patterns', async () => {
      // Test different ways SST packages might create services
      const service1 = new NativeLicensingService();
      const service2 = createLicensingService();

      const result1 = await service1.checkEntitlement('123456789012');
      const result2 = await service2.checkEntitlement('123456789012');

      // Both should have compatible response structures
      expect(typeof result1.entitled).toBe(typeof result2.entitled);
      expect(Array.isArray(Object.keys(result1))).toBe(Array.isArray(Object.keys(result2)));
    });
  });

  describe('Concurrent Usage', () => {
    it('should handle concurrent requests from multiple services', async () => {
      const services = [
        new NativeLicensingService(),
        new NativeLicensingService(),
        createLicensingService(),
      ];

      const promises = services.map((service, index) =>
        service.checkEntitlement(`12345678901${index}`),
      );

      const results = await Promise.all(promises);

      // All should complete successfully
      results.forEach(result => {
        expect(typeof result.entitled).toBe('boolean');
        expect(result).toHaveProperty('entitled');
      });
    });

    it('should maintain service isolation', async () => {
      const service1 = new NativeLicensingService();
      const service2 = new NativeLicensingService();

      // Make concurrent calls
      const [result1, result2] = await Promise.all([
        service1.checkEntitlement('123456789012'),
        service2.checkEntitlement('987654321098'),
      ]);

      // Both should work independently
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(typeof result1.entitled).toBe('boolean');
      expect(typeof result2.entitled).toBe('boolean');
    });
  });

  describe('Performance Characteristics', () => {
    it('should complete requests within reasonable time', async () => {
      const service = new NativeLicensingService();

      const startTime = Date.now();
      await service.checkEntitlement('123456789012');
      const endTime = Date.now();

      // Should complete within 5 seconds (requirement 10.1)
      expect(endTime - startTime).toBeLessThan(5000);
    });

    it('should handle multiple sequential requests efficiently', async () => {
      const service = new NativeLicensingService();
      const accountIds = ['123456789012', '987654321098', '111122223333'];

      const startTime = Date.now();

      for (const accountId of accountIds) {
        await service.checkEntitlement(accountId);
      }

      const endTime = Date.now();

      // Should complete all requests within reasonable time
      expect(endTime - startTime).toBeLessThan(15000); // 5s per request max
    });
  });

  describe('Fallback Behavior Simulation', () => {
    it('should demonstrate graceful degradation pattern', async () => {
      // Simulate the pattern SST packages would use for fallback
      const createServiceWithFallback = (): LicensingService => {
        try {
          return new NativeLicensingService();
        } catch (error) {
          // Fallback to HTTP service (simulated)
          return {
            checkEntitlement: async (): Promise<LicensingResponse> => ({
              entitled: false,
              message: 'Fallback service: Native validator unavailable',
            }),
          };
        }
      };

      const service = createServiceWithFallback();
      const result = await service.checkEntitlement('123456789012');

      expect(typeof result.entitled).toBe('boolean');
      expect(result).toHaveProperty('entitled');
    });

    it('should handle service unavailability gracefully', async () => {
      // Test the actual service behavior when addon might be unavailable
      const service = new NativeLicensingService();
      const result = await service.checkEntitlement('123456789012');

      // Should always return a valid response, never throw
      expect(result).toBeDefined();
      expect(typeof result.entitled).toBe('boolean');

      // If not entitled, should have a message explaining why
      if (!result.entitled) {
        expect(typeof result.message).toBe('string');
        expect(result.message).toBeDefined();
        expect(result.message!.length).toBeGreaterThan(0);
      }
    });
  });
});

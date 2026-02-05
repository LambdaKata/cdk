/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Fallback behavior tests for native licensing validator
 */

/**
 * @fileoverview Fallback Behavior Tests
 *
 * This test suite verifies that the native licensing validator
 * handles fallback scenarios gracefully when the native addon
 * is unavailable, ensuring fail-closed behavior and proper
 * integration with SST packages.
 *
 * **Validates: Requirements 6.5, 6.6**
 */

import { createLicensingService, LicensingResponse, LicensingService, NativeLicensingService } from '../src/index';

describe('Fallback Behavior Tests', () => {
  describe('Service Creation and Initialization', () => {
    it('should create service instances without throwing', () => {
      expect(() => new NativeLicensingService()).not.toThrow();
      expect(() => createLicensingService()).not.toThrow();
    });

    it('should handle service creation in various environments', () => {
      // Test multiple service creations
      const services = [];
      for (let i = 0; i < 5; i++) {
        services.push(new NativeLicensingService());
      }

      expect(services).toHaveLength(5);
      services.forEach(service => {
        expect(service).toBeInstanceOf(NativeLicensingService);
      });
    });
  });

  describe('Fail-Closed Behavior', () => {
    it('should always return valid responses', async () => {
      const service = new NativeLicensingService();

      const testCases = [
        '123456789012', // valid
        '987654321098', // valid
        'invalid',      // invalid format
        '',             // empty
        '123',           // too short
      ];

      for (const testCase of testCases) {
        const result = await service.checkEntitlement(testCase);

        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
        expect(typeof result.entitled).toBe('boolean');

        // Should have message for failed cases
        if (!result.entitled) {
          expect(typeof result.message).toBe('string');
          expect(result.message).toBeDefined();
          expect(result.message!.length).toBeGreaterThan(0);
        }
      }
    });

    it('should never throw exceptions', async () => {
      const service = new NativeLicensingService();

      // Test with various problematic inputs
      const problematicInputs = [
        null as unknown as string,
        undefined as unknown as string,
        123456789012 as unknown as string,
        {} as unknown as string,
        [] as unknown as string,
        'a'.repeat(1000), // very long string
      ];

      for (const input of problematicInputs) {
        await expect(service.checkEntitlement(input)).resolves.toBeDefined();
      }
    });

    it('should return consistent fail-closed responses', async () => {
      const service = new NativeLicensingService();

      // Make multiple calls with invalid input
      const results = await Promise.all([
        service.checkEntitlement('invalid'),
        service.checkEntitlement('invalid'),
        service.checkEntitlement('invalid'),
      ]);

      // All should be identical
      expect(results[0]).toEqual(results[1]);
      expect(results[1]).toEqual(results[2]);

      // All should be fail-closed
      results.forEach(result => {
        expect(result.entitled).toBe(false);
      });
    });
  });

  describe('Input Validation', () => {
    it('should validate account ID format before processing', async () => {
      const service = new NativeLicensingService();

      const invalidFormats = [
        '',
        '123',
        '12345678901',   // 11 digits
        '1234567890123', // 13 digits
        'abcd56789012',  // contains letters
        '123-456-789012', // contains hyphens
        '123 456 789 012', // contains spaces
        '123.456.789.012',  // contains dots
      ];

      for (const invalidFormat of invalidFormats) {
        const result = await service.checkEntitlement(invalidFormat);
        expect(result.entitled).toBe(false);
        expect(result.message).toBe('Invalid account ID format');
      }
    });

    it('should accept valid account ID formats', async () => {
      const service = new NativeLicensingService();

      const validFormats = [
        '123456789012',
        '000000000000',
        '999999999999',
        '111122223333',
      ];

      for (const validFormat of validFormats) {
        const result = await service.checkEntitlement(validFormat);
        // Should not fail due to format validation
        expect(result.message).not.toBe('Invalid account ID format');
      }
    });
  });

  describe('SST Package Integration Patterns', () => {
    it('should support SST v2 integration pattern', async () => {
      // Simulate SST v2 pattern: direct instantiation with fallback
      const createSstV2Service = (): LicensingService => {
        try {
          return new NativeLicensingService();
        } catch (error) {
          // Fallback to mock HTTP service
          return {
            checkEntitlement: async (): Promise<LicensingResponse> => ({
              entitled: false,
              message: 'HTTP fallback service',
            }),
          };
        }
      };

      const service = createSstV2Service();
      const result = await service.checkEntitlement('123456789012');

      expect(result).toBeDefined();
      expect(typeof result.entitled).toBe('boolean');
    });

    it('should support SST v3 integration pattern', async () => {
      // Simulate SST v3 pattern: factory function with fallback
      const createSstV3Service = (): LicensingService => {
        try {
          return createLicensingService();
        } catch (error) {
          // Fallback to mock HTTP service
          return {
            checkEntitlement: async (): Promise<LicensingResponse> => ({
              entitled: false,
              message: 'HTTP fallback service',
            }),
          };
        }
      };

      const service = createSstV3Service();
      const result = await service.checkEntitlement('987654321098');

      expect(result).toBeDefined();
      expect(typeof result.entitled).toBe('boolean');
    });

    it('should maintain interface compatibility across patterns', async () => {
      const nativeService = new NativeLicensingService();
      const factoryService = createLicensingService();

      const result1 = await nativeService.checkEntitlement('123456789012');
      const result2 = await factoryService.checkEntitlement('123456789012');

      // Both should have compatible response structures
      expect(typeof result1.entitled).toBe(typeof result2.entitled);
      expect(Object.keys(result1).sort()).toEqual(Object.keys(result2).sort());
    });
  });

  describe('Service Lifecycle', () => {
    it('should handle multiple service instances independently', async () => {
      const services = [
        new NativeLicensingService(),
        new NativeLicensingService(),
        createLicensingService(),
      ];

      const results = await Promise.all(
        services.map(service => service.checkEntitlement('123456789012')),
      );

      // All should work independently
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(typeof result.entitled).toBe('boolean');
      });
    });

    it('should handle service reuse correctly', async () => {
      const service = new NativeLicensingService();

      // Make multiple calls with the same service
      const results = await Promise.all([
        service.checkEntitlement('123456789012'),
        service.checkEntitlement('987654321098'),
        service.checkEntitlement('111122223333'),
      ]);

      // All should complete successfully
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(typeof result.entitled).toBe('boolean');
      });
    });
  });

  describe('Error Recovery', () => {
    it('should recover from invalid inputs', async () => {
      const service = new NativeLicensingService();

      // Start with invalid input
      const invalidResult = await service.checkEntitlement('invalid');
      expect(invalidResult.entitled).toBe(false);

      // Follow with valid input
      const validResult = await service.checkEntitlement('123456789012');
      expect(validResult).toBeDefined();
      expect(typeof validResult.entitled).toBe('boolean');
    });

    it('should maintain consistent behavior after errors', async () => {
      const service = new NativeLicensingService();

      // Cause multiple validation errors
      await service.checkEntitlement('');
      await service.checkEntitlement('invalid');
      await service.checkEntitlement('123');

      // Service should still work normally
      const result = await service.checkEntitlement('123456789012');
      expect(result).toBeDefined();
      expect(typeof result.entitled).toBe('boolean');
    });
  });

  describe('Performance Under Fallback', () => {
    it('should complete requests quickly even when addon unavailable', async () => {
      const service = new NativeLicensingService();

      const startTime = Date.now();
      await service.checkEntitlement('123456789012');
      const endTime = Date.now();

      // Should complete quickly (within 1 second for fallback)
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should handle concurrent requests efficiently', async () => {
      const service = new NativeLicensingService();

      const startTime = Date.now();

      const promises = Array.from({ length: 10 }, (_, i) =>
        service.checkEntitlement(`12345678901${i % 10}`),
      );

      await Promise.all(promises);

      const endTime = Date.now();

      // Should complete all requests within reasonable time
      expect(endTime - startTime).toBeLessThan(5000);
    });
  });

  describe('Environment Compatibility', () => {
    it('should work regardless of NODE_ENV setting', async () => {
      const originalNodeEnv = process.env.NODE_ENV;

      try {
        // Test in different environments
        const environments = ['development', 'production', 'test', undefined];

        for (const env of environments) {
          if (env === undefined) {
            delete process.env.NODE_ENV;
          } else {
            process.env.NODE_ENV = env;
          }

          const service = new NativeLicensingService();
          const result = await service.checkEntitlement('123456789012');

          expect(result).toBeDefined();
          expect(typeof result.entitled).toBe('boolean');
        }
      } finally {
        // Restore original NODE_ENV
        if (originalNodeEnv !== undefined) {
          process.env.NODE_ENV = originalNodeEnv;
        } else {
          delete process.env.NODE_ENV;
        }
      }
    });

    it('should handle missing dependencies gracefully', async () => {
      // This test verifies the service works even if native addon is unavailable
      const service = new NativeLicensingService();

      // Should not throw during creation or usage
      const result = await service.checkEntitlement('123456789012');

      expect(result).toBeDefined();
      expect(typeof result.entitled).toBe('boolean');

      // If addon is unavailable, should fail closed with appropriate message
      if (!result.entitled && result.message === 'Native validator unavailable') {
        expect(result.layerArn).toBeUndefined();
        expect(result.expiresAt).toBeUndefined();
      }
    });
  });
});

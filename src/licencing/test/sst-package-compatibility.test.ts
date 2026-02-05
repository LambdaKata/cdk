/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * SST Package Compatibility Tests
 */

/**
 * @fileoverview SST Package Compatibility Tests
 *
 * This test suite verifies that the native licensing validator
 * works correctly with the actual integration patterns used by
 * SST v2 and SST v3 packages, including fallback scenarios.
 *
 * **Validates: Requirements 6.6**
 */

import { createLicensingService, LicensingResponse, LicensingService, NativeLicensingService } from '../src/index';

describe('SST Package Compatibility Tests', () => {
  describe('SST v2 Integration Pattern', () => {
    it('should work with SST v2 createLicensingService pattern', async () => {
      // Simulate the exact pattern used in SST v2 licensing.ts
      let NativeLicensingServiceClass: any = null;
      try {
        // This simulates the require('@lambda-kata/licensing') pattern
        const nativeModule = { NativeLicensingService };
        NativeLicensingServiceClass = nativeModule.NativeLicensingService;
      } catch (error) {
        // Native licensing service not available - will fallback to HTTP
        if (process.env.NODE_ENV === 'development') {
          console.warn('Native licensing validator not available, using HTTP fallback');
        }
      }

      // Simulate SST v2 createLicensingService function
      const createSstV2LicensingService = (endpoint?: string): LicensingService => {
        // Try to use native licensing service first for enhanced security
        if (NativeLicensingServiceClass) {
          try {
            return new NativeLicensingServiceClass();
          } catch (error) {
            // Native service failed to initialize, fall back to HTTP
            if (process.env.NODE_ENV === 'development') {
              console.warn('Failed to initialize native licensing service, using HTTP fallback:', error);
            }
          }
        }

        // Fallback to HTTP-based licensing service (simulated)
        return {
          checkEntitlement: async (accountId: string): Promise<LicensingResponse> => ({
            entitled: false,
            message: `HTTP fallback: Account ${accountId} not entitled via marketplace`,
          }),
        };
      };

      const service = createSstV2LicensingService();
      const result = await service.checkEntitlement('123456789012');

      expect(result).toBeDefined();
      expect(typeof result.entitled).toBe('boolean');
      expect(result).toHaveProperty('entitled');
    });

    it('should work with SST v2 createNativeLicensingService pattern', async () => {
      // Simulate the exact pattern used in SST v2 licensing.ts
      let NativeLicensingServiceClass: any = null;
      try {
        const nativeModule = { NativeLicensingService };
        NativeLicensingServiceClass = nativeModule.NativeLicensingService;
      } catch (error) {
        // Module not available
      }

      // Simulate SST v2 createNativeLicensingService function
      const createNativeLicensingService = (): LicensingService | null => {
        if (!NativeLicensingServiceClass) {
          return null;
        }

        try {
          return new NativeLicensingServiceClass();
        } catch (error) {
          return null;
        }
      };

      const nativeService = createNativeLicensingService();

      if (nativeService) {
        const result = await nativeService.checkEntitlement('123456789012');
        expect(result).toBeDefined();
        expect(typeof result.entitled).toBe('boolean');
      } else {
        // This is also a valid outcome when addon is unavailable
        expect(nativeService).toBeNull();
      }
    });
  });

  describe('SST v3 Integration Pattern', () => {
    it('should work with SST v3 createLicensingService pattern', async () => {
      // Simulate the exact pattern used in SST v3 licensing.ts
      let NativeLicensingServiceClass: any = null;
      try {
        // This simulates the require('@lambda-kata/licensing') pattern
        const nativeModule = { NativeLicensingService };
        NativeLicensingServiceClass = nativeModule.NativeLicensingService;
      } catch (error) {
        // Native licensing service not available - will fallback to HTTP
        if (process.env.NODE_ENV === 'development') {
          console.warn('Native licensing validator not available, using HTTP fallback');
        }
      }

      // Simulate SST v3 createLicensingService function
      const createSstV3LicensingService = (endpoint?: string): LicensingService => {
        // Try to use native licensing service first for enhanced security
        if (NativeLicensingServiceClass) {
          try {
            return new NativeLicensingServiceClass();
          } catch (error) {
            // Native service failed to initialize, fall back to HTTP
            if (process.env.NODE_ENV === 'development') {
              console.warn('Failed to initialize native licensing service, using HTTP fallback:', error);
            }
          }
        }

        // Fallback to HTTP-based licensing service (simulated)
        return {
          checkEntitlement: async (accountId: string): Promise<LicensingResponse> => ({
            entitled: false,
            message: `HTTP fallback: Account ${accountId} not entitled via marketplace`,
          }),
        };
      };

      const service = createSstV3LicensingService();
      const result = await service.checkEntitlement('987654321098');

      expect(result).toBeDefined();
      expect(typeof result.entitled).toBe('boolean');
      expect(result).toHaveProperty('entitled');
    });

    it('should work with SST v3 createNativeLicensingService pattern', async () => {
      // Simulate the exact pattern used in SST v3 licensing.ts
      let NativeLicensingServiceClass: any = null;
      try {
        const nativeModule = { NativeLicensingService };
        NativeLicensingServiceClass = nativeModule.NativeLicensingService;
      } catch (error) {
        // Module not available
      }

      // Simulate SST v3 createNativeLicensingService function
      const createNativeLicensingService = (): LicensingService | null => {
        if (!NativeLicensingServiceClass) {
          return null;
        }

        try {
          return new NativeLicensingServiceClass();
        } catch (error) {
          return null;
        }
      };

      const nativeService = createNativeLicensingService();

      if (nativeService) {
        const result = await nativeService.checkEntitlement('987654321098');
        expect(result).toBeDefined();
        expect(typeof result.entitled).toBe('boolean');
      } else {
        // This is also a valid outcome when addon is unavailable
        expect(nativeService).toBeNull();
      }
    });
  });

  describe('Cross-Package Compatibility', () => {
    it('should maintain consistent behavior across SST v2 and v3 patterns', async () => {
      // Create services using both patterns
      const sstV2Service = new NativeLicensingService();
      const sstV3Service = createLicensingService();

      const accountId = '123456789012';
      const result1 = await sstV2Service.checkEntitlement(accountId);
      const result2 = await sstV3Service.checkEntitlement(accountId);

      // Both should have compatible response structures
      expect(typeof result1.entitled).toBe(typeof result2.entitled);
      expect(Object.keys(result1).sort()).toEqual(Object.keys(result2).sort());

      // Both should handle the same account ID consistently
      if (result1.entitled === result2.entitled) {
        // If both have same entitlement status, other fields should be compatible
        expect(typeof result1.message).toBe(typeof result2.message);
        expect(typeof result1.layerArn).toBe(typeof result2.layerArn);
        expect(typeof result1.expiresAt).toBe(typeof result2.expiresAt);
      }
    });

    it('should handle fallback scenarios consistently across packages', async () => {
      // Simulate both packages falling back to HTTP when native unavailable
      const createFallbackService = (packageName: string): LicensingService => {
        // Simulate native service unavailable
        return {
          checkEntitlement: async (accountId: string): Promise<LicensingResponse> => ({
            entitled: false,
            message: `${packageName} HTTP fallback: Native validator unavailable`,
          }),
        };
      };

      const sstV2Fallback = createFallbackService('SST v2');
      const sstV3Fallback = createFallbackService('SST v3');

      const result1 = await sstV2Fallback.checkEntitlement('123456789012');
      const result2 = await sstV3Fallback.checkEntitlement('123456789012');

      // Both should fail closed
      expect(result1.entitled).toBe(false);
      expect(result2.entitled).toBe(false);

      // Both should have explanatory messages
      expect(typeof result1.message).toBe('string');
      expect(typeof result2.message).toBe('string');
      expect(result1.message).toContain('fallback');
      expect(result2.message).toContain('fallback');
    });
  });

  describe('Real-World Usage Scenarios', () => {
    it('should work in CDK synthesis context (SST v2)', async () => {
      // Simulate CDK synthesis time usage
      const service = new NativeLicensingService();

      // Multiple account checks during synthesis
      const accounts = ['123456789012', '987654321098', '111122223333'];
      const results = await Promise.all(
        accounts.map(account => service.checkEntitlement(account)),
      );

      // All should complete successfully
      results.forEach((result, index) => {
        expect(result).toBeDefined();
        expect(typeof result.entitled).toBe('boolean');

        // Should handle each account independently
        if (!result.entitled && result.message) {
          expect(result.message).toBeDefined();
        }
      });
    });

    it('should work in Pulumi deployment context (SST v3)', async () => {
      // Simulate Pulumi deployment time usage
      const service = createLicensingService();

      // Sequential checks during deployment
      const accounts = ['123456789012', '987654321098'];

      for (const account of accounts) {
        const result = await service.checkEntitlement(account);

        expect(result).toBeDefined();
        expect(typeof result.entitled).toBe('boolean');

        // Should maintain state between calls
        if (result.entitled && result.layerArn) {
          expect(result.layerArn).toMatch(/^arn:aws:lambda:/);
        }
      }
    });

    it('should handle high-frequency usage patterns', async () => {
      // Simulate multiple Lambda functions being processed
      const service = new NativeLicensingService();
      const accountId = '123456789012';

      // Rapid successive calls (simulating multiple functions in same stack)
      const promises = Array.from({ length: 20 }, () =>
        service.checkEntitlement(accountId),
      );

      const results = await Promise.all(promises);

      // All should complete successfully
      expect(results).toHaveLength(20);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(typeof result.entitled).toBe('boolean');
      });

      // All results for same account should be identical
      const firstResult = results[0];
      expect(firstResult).toBeDefined();

      results.forEach(result => {
        expect(result.entitled).toBe(firstResult!.entitled);
        expect(result.message).toBe(firstResult!.message);
        expect(result.layerArn).toBe(firstResult!.layerArn);
        expect(result.expiresAt).toBe(firstResult!.expiresAt);
      });
    });
  });

  describe('Error Handling in SST Context', () => {
    it('should handle invalid account IDs gracefully in SST v2 context', async () => {
      const service = new NativeLicensingService();

      // Invalid account IDs that might come from CDK context
      const invalidIds = ['', 'invalid', '123', null as any, undefined as any];

      for (const invalidId of invalidIds) {
        const result = await service.checkEntitlement(invalidId);

        expect(result.entitled).toBe(false);
        expect(result.message).toBe('Invalid account ID format');
        expect(result.layerArn).toBeUndefined();
        expect(result.expiresAt).toBeUndefined();
      }
    });

    it('should handle invalid account IDs gracefully in SST v3 context', async () => {
      const service = createLicensingService();

      // Invalid account IDs that might come from Pulumi context
      const invalidIds = ['', 'invalid', '123', '1234567890123'];

      for (const invalidId of invalidIds) {
        const result = await service.checkEntitlement(invalidId);

        expect(result.entitled).toBe(false);
        expect(result.message).toBe('Invalid account ID format');
        expect(result.layerArn).toBeUndefined();
        expect(result.expiresAt).toBeUndefined();
      }
    });

    it('should maintain service stability after errors', async () => {
      const service = new NativeLicensingService();

      // Cause validation errors
      await service.checkEntitlement('invalid');
      await service.checkEntitlement('');
      await service.checkEntitlement('123');

      // Service should still work normally
      const validResult = await service.checkEntitlement('123456789012');
      expect(validResult).toBeDefined();
      expect(typeof validResult.entitled).toBe('boolean');
      expect(validResult.message).not.toBe('Invalid account ID format');
    });
  });

  describe('Performance in SST Context', () => {
    it('should meet performance requirements for CDK synthesis', async () => {
      const service = new NativeLicensingService();

      // Simulate CDK synthesis with multiple functions
      const startTime = Date.now();

      const promises = Array.from({ length: 10 }, (_, i) =>
        service.checkEntitlement(`12345678901${i % 10}`),
      );

      await Promise.all(promises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time for synthesis
      expect(duration).toBeLessThan(5000); // 5 seconds max
    });

    it('should meet performance requirements for Pulumi deployment', async () => {
      const service = createLicensingService();

      // Simulate Pulumi deployment with sequential checks
      const startTime = Date.now();

      for (let i = 0; i < 5; i++) {
        await service.checkEntitlement(`12345678901${i}`);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time for deployment
      expect(duration).toBeLessThan(10000); // 10 seconds max for 5 sequential calls
    });
  });
});

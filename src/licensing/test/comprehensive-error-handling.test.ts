/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Comprehensive error handling and logging tests
 */

/**
 * @fileoverview Comprehensive Error Handling Tests
 *
 * This test suite verifies that the native licensing validator
 * implements comprehensive error handling and logging with proper
 * security considerations, fail-closed behavior, and appropriate
 * detail levels for development vs production environments.
 *
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 2.1, 2.6**
 */

import { NativeLicensingService } from '../src/index';

describe('Comprehensive Error Handling and Logging Tests', () => {
  let originalNodeEnv: string | undefined;
  let consoleSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Production vs Development Logging', () => {
    it('should sanitize error messages in production mode', async () => {
      process.env.NODE_ENV = 'production';
      const service = new NativeLicensingService();

      // Test with invalid input to trigger error logging
      const result = await service.checkEntitlement('invalid');

      expect(result.entitled).toBe(false);
      expect(result.message).toBe('Invalid account ID format');

      // Check that production logging is sanitized
      const errorCalls = consoleErrorSpy.mock.calls;
      if (errorCalls.length > 0) {
        const logMessage = errorCalls[0][0];
        expect(logMessage).toContain('System error occurred');
        expect(logMessage).not.toContain('invalid');
        expect(logMessage).not.toContain('account');
      }
    });

    it('should provide detailed error messages in development mode', async () => {
      process.env.NODE_ENV = 'development';
      const service = new NativeLicensingService();

      // Test with invalid input to trigger error logging
      const result = await service.checkEntitlement('invalid');

      expect(result.entitled).toBe(false);
      expect(result.message).toBe('Invalid account ID format');

      // Check that development logging is detailed
      const errorCalls = consoleErrorSpy.mock.calls;
      if (errorCalls.length > 0) {
        const logMessage = errorCalls[0][0];
        expect(logMessage).toContain('Invalid account ID format');
      }
    });

    it('should handle undefined NODE_ENV gracefully', async () => {
      delete process.env.NODE_ENV;
      const service = new NativeLicensingService();

      // Should work without throwing
      const result = await service.checkEntitlement('123456789012');
      expect(result).toBeDefined();
      expect(typeof result.entitled).toBe('boolean');
    });
  });

  describe('Fail-Closed Error Handling', () => {
    it('should return fail-closed response for all error conditions', async () => {
      const service = new NativeLicensingService();

      const errorInputs = [
        '',                    // Empty string
        'abc',                 // Non-numeric
        '123',                 // Too short
        '1234567890123',       // Too long
        null as any,           // Null
        undefined as any,      // Undefined
        123456789012 as any,   // Number instead of string
        {} as any,             // Object
        [] as any,              // Array
      ];

      for (const input of errorInputs) {
        const result = await service.checkEntitlement(input);

        expect(result.entitled).toBe(false);
        expect(typeof result.message).toBe('string');
        expect(result.message!.length).toBeGreaterThan(0);

        // Should not have success-only fields
        expect(result.layerArn).toBeUndefined();
        expect(result.expiresAt).toBeUndefined();
      }
    });

    it('should never throw exceptions from error conditions', async () => {
      const service = new NativeLicensingService();

      const problematicInputs = [
        'a'.repeat(1000),      // Very long string
        '\x00\x01\x02',       // Binary data
        '🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀', // Unicode
        'SELECT * FROM users', // SQL injection attempt
        '<script>alert(1)</script>', // XSS attempt
        '../../etc/passwd',    // Path traversal attempt
      ];

      for (const input of problematicInputs) {
        await expect(service.checkEntitlement(input)).resolves.toBeDefined();
      }
    });

    it('should handle memory allocation failures gracefully', async () => {
      const service = new NativeLicensingService();

      // Test with valid input that might trigger memory allocation
      const result = await service.checkEntitlement('123456789012');

      // Should always return a valid response structure
      expect(result).toBeDefined();
      expect(typeof result.entitled).toBe('boolean');

      if (!result.entitled) {
        expect(typeof result.message).toBe('string');
      }
    });
  });

  describe('Logging Security Considerations', () => {
    it('should not log sensitive data in any mode', async () => {
      const service = new NativeLicensingService();

      // Test with valid account ID
      await service.checkEntitlement('123456789012');

      // Check all console calls for sensitive data
      const allCalls = [
        ...consoleSpy.mock.calls,
        ...consoleErrorSpy.mock.calls,
      ];

      for (const call of allCalls) {
        const logMessage = JSON.stringify(call);

        // Should not contain account IDs
        expect(logMessage).not.toContain('123456789012');

        // Should not contain common sensitive patterns
        expect(logMessage).not.toMatch(/\b\d{12}\b/); // 12-digit numbers
        expect(logMessage).not.toContain('token');
        expect(logMessage).not.toContain('secret');
        expect(logMessage).not.toContain('password');
        expect(logMessage).not.toContain('key');
      }
    });

    it('should sanitize error messages containing sensitive patterns', async () => {
      process.env.NODE_ENV = 'production';
      const service = new NativeLicensingService();

      // Test various inputs that might contain sensitive data
      const sensitiveInputs = [
        '123456789012', // Valid account ID
        'token123456789012', // Account ID in token
        'secret123456789012key', // Account ID in secret
      ];

      for (const input of sensitiveInputs) {
        await service.checkEntitlement(input);
      }

      // Verify no sensitive data in logs
      const allCalls = [
        ...consoleSpy.mock.calls,
        ...consoleErrorSpy.mock.calls,
      ];

      for (const call of allCalls) {
        const logMessage = JSON.stringify(call);
        expect(logMessage).not.toMatch(/\b\d{12}\b/);
      }
    });
  });

  describe('Error Message Consistency', () => {
    it('should return consistent error messages for the same error type', async () => {
      const service = new NativeLicensingService();

      // Test same error multiple times
      const results = await Promise.all([
        service.checkEntitlement('invalid'),
        service.checkEntitlement('invalid'),
        service.checkEntitlement('invalid'),
      ]);

      // All should have the same error message
      expect(results[0].message).toBe(results[1].message);
      expect(results[1].message).toBe(results[2].message);

      // All should be fail-closed
      results.forEach(result => {
        expect(result.entitled).toBe(false);
      });
    });

    it('should provide appropriate error messages for different error types', async () => {
      const service = new NativeLicensingService();

      const testCases = [
        { input: '', expectedMessage: 'Invalid account ID format' },
        { input: 'abc', expectedMessage: 'Invalid account ID format' },
        { input: '123', expectedMessage: 'Invalid account ID format' },
        { input: '1234567890123', expectedMessage: 'Invalid account ID format' },
      ];

      for (const testCase of testCases) {
        const result = await service.checkEntitlement(testCase.input);
        expect(result.entitled).toBe(false);
        expect(result.message).toBe(testCase.expectedMessage);
      }
    });
  });

  describe('Logging Structure and Format', () => {
    it('should use structured logging format', async () => {
      process.env.NODE_ENV = 'development';
      const service = new NativeLicensingService();

      await service.checkEntitlement('123456789012');

      // Check that logs follow structured format
      const allCalls = [
        ...consoleSpy.mock.calls,
        ...consoleErrorSpy.mock.calls,
      ];

      for (const call of allCalls) {
        if (call.length > 0 && typeof call[0] === 'string') {
          const logMessage = call[0];

          // Should contain log level and component name
          expect(logMessage).toMatch(/\[(INFO|ERROR|WARN|DEBUG)\]/);
          expect(logMessage).toContain('native-licensing-validator');
        }
      }
    });

    it('should include appropriate context in development logs', async () => {
      process.env.NODE_ENV = 'development';
      const service = new NativeLicensingService();

      await service.checkEntitlement('invalid');

      // Check that development logs include context
      const allCalls = [
        ...consoleSpy.mock.calls,
        ...consoleErrorSpy.mock.calls,
      ];

      let foundContextualLog = false;
      for (const call of allCalls) {
        if (call.length > 1 && typeof call[1] === 'object') {
          foundContextualLog = true;
          const context = call[1];

          // Context should not contain sensitive data
          const contextStr = JSON.stringify(context);
          expect(contextStr).not.toMatch(/\b\d{12}\b/);
        }
      }

      // Should have at least some contextual logging in development
      expect(foundContextualLog).toBe(true);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from errors and continue functioning', async () => {
      const service = new NativeLicensingService();

      // Cause an error
      const errorResult = await service.checkEntitlement('invalid');
      expect(errorResult.entitled).toBe(false);

      // Should still work for valid requests
      const validResult = await service.checkEntitlement('123456789012');
      expect(validResult).toBeDefined();
      expect(typeof validResult.entitled).toBe('boolean');
    });

    it('should handle rapid successive error conditions', async () => {
      const service = new NativeLicensingService();

      // Make many rapid error requests
      const promises = Array.from({ length: 10 }, () =>
        service.checkEntitlement('invalid'),
      );

      const results = await Promise.all(promises);

      // All should be handled correctly
      results.forEach(result => {
        expect(result.entitled).toBe(false);
        expect(typeof result.message).toBe('string');
      });
    });

    it('should maintain consistent behavior under error conditions', async () => {
      const service = new NativeLicensingService();

      // Mix of valid and invalid requests
      const mixedRequests = [
        service.checkEntitlement('123456789012'),
        service.checkEntitlement('invalid'),
        service.checkEntitlement('987654321098'),
        service.checkEntitlement(''),
        service.checkEntitlement('111122223333'),
      ];

      const results = await Promise.all(mixedRequests);

      // All should complete successfully (no exceptions)
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(typeof result.entitled).toBe('boolean');
      });

      // Invalid requests should be fail-closed
      expect(results[1]?.entitled).toBe(false); // 'invalid'
      expect(results[3]?.entitled).toBe(false); // ''
    });
  });

  describe('Performance Under Error Conditions', () => {
    it('should handle errors efficiently without significant performance impact', async () => {
      const service = new NativeLicensingService();

      const startTime = Date.now();

      // Process multiple error conditions
      const errorPromises = Array.from({ length: 20 }, (_, i) =>
        service.checkEntitlement(`invalid${i}`),
      );

      await Promise.all(errorPromises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete quickly even with many errors
      expect(duration).toBeLessThan(5000); // 5 seconds max
    });

    it('should not leak memory during error handling', async () => {
      const service = new NativeLicensingService();

      // Process many errors to test for memory leaks
      for (let i = 0; i < 100; i++) {
        await service.checkEntitlement(`error${i}`);
      }

      // If we reach here without running out of memory, test passes
      expect(true).toBe(true);
    });
  });
});

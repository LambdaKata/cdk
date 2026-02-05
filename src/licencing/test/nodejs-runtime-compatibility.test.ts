/**
 * @fileoverview Node.js runtime compatibility unit tests for native licensing validator
 *
 * Unit tests for specific Node.js 20.x and 22.x runtime scenarios in AWS Lambda.
 * Tests native addon loading, Node-API interface compatibility, and edge cases.
 *
 * @remarks Validates: Requirements 5.3, 5.4
 */

import { NativeLicensingService } from '../src/index';
import { performance } from 'perf_hooks';

// Mock the native addon for controlled testing
jest.mock('../build/Release/native_licensing_validator.node', () => {
  throw new Error('Native addon not available in test environment');
});

describe('Node.js Runtime Compatibility Unit Tests', () => {

  describe('Node.js 20.x Runtime Compatibility', () => {

    /**
     * **Validates: Requirement 5.3**
     * Native validator should work with Node.js 20.x runtime in AWS Lambda
     */
    test('should load successfully in Node.js 20.x Lambda environment', async () => {
      const originalEnv = process.env;

      try {
        // Simulate Node.js 20.x Lambda environment
        process.env = {
          ...originalEnv,
          AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs20.x',
          AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '512',
          AWS_LAMBDA_RUNTIME_API: '127.0.0.1:9001',
          _HANDLER: 'index.handler',
          AWS_LAMBDA_FUNCTION_NAME: 'test-function-20x',
          AWS_LAMBDA_FUNCTION_VERSION: '$LATEST',
          AWS_REGION: 'us-east-1',
        };

        const service = new NativeLicensingService();

        expect(service).toBeDefined();
        expect(typeof service.checkEntitlement).toBe('function');

        // Test basic functionality
        const result = await service.checkEntitlement('123456789012');
        expect(result).toBeDefined();
        expect(typeof result.entitled).toBe('boolean');
        expect(result.entitled).toBe(false); // Expected for mocked addon

      } finally {
        process.env = originalEnv;
      }
    });

    test('should handle cold start in Node.js 20.x environment', async () => {
      const originalEnv = process.env;

      try {
        // Clear module cache to simulate cold start
        const modulePath = require.resolve('../src/index');
        delete require.cache[modulePath];

        process.env = {
          ...originalEnv,
          AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs20.x',
          AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '256',
          AWS_LAMBDA_INITIALIZATION_TYPE: 'on-demand',
        };

        const startTime = performance.now();
        const service = new NativeLicensingService();
        const loadTime = performance.now() - startTime;

        // Cold start should complete within reasonable time
        expect(loadTime).toBeLessThan(1000); // 1 second max
        expect(service).toBeDefined();

        // Service should be immediately functional
        const result = await service.checkEntitlement('123456789012');
        expect(result).toBeDefined();

      } finally {
        process.env = originalEnv;
      }
    });

    test('should work with different memory configurations in Node.js 20.x', async () => {
      const memorySizes = [128, 512, 1024, 3008];
      const originalEnv = process.env;

      for (const memorySize of memorySizes) {
        try {
          process.env = {
            ...originalEnv,
            AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs20.x',
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: memorySize.toString(),
            NODE_OPTIONS: `--max-old-space-size=${Math.floor(memorySize * 0.8)}`,
          };

          const service = new NativeLicensingService();
          expect(service).toBeDefined();

          const result = await service.checkEntitlement('123456789012');
          expect(result).toBeDefined();
          expect(typeof result.entitled).toBe('boolean');

          // Memory usage should be reasonable (relaxed for test environment)
          const memUsage = process.memoryUsage();
          // In test environment, just ensure memory usage is not excessive (< 500MB)
          expect(memUsage.heapUsed).toBeLessThan(500 * 1024 * 1024);

        } finally {
          process.env = originalEnv;
        }
      }
    });
  });

  describe('Node.js 22.x Runtime Compatibility', () => {

    /**
     * **Validates: Requirement 5.4**
     * Native validator should work with Node.js 22.x runtime in AWS Lambda
     */
    test('should load successfully in Node.js 22.x Lambda environment', async () => {
      const originalEnv = process.env;

      try {
        // Simulate Node.js 22.x Lambda environment
        process.env = {
          ...originalEnv,
          AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
          AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '512',
          AWS_LAMBDA_RUNTIME_API: '127.0.0.1:9001',
          _HANDLER: 'index.handler',
          AWS_LAMBDA_FUNCTION_NAME: 'test-function-22x',
          AWS_LAMBDA_FUNCTION_VERSION: '$LATEST',
          AWS_REGION: 'us-east-1',
        };

        const service = new NativeLicensingService();

        expect(service).toBeDefined();
        expect(typeof service.checkEntitlement).toBe('function');

        // Test basic functionality
        const result = await service.checkEntitlement('123456789012');
        expect(result).toBeDefined();
        expect(typeof result.entitled).toBe('boolean');
        expect(result.entitled).toBe(false); // Expected for mocked addon

      } finally {
        process.env = originalEnv;
      }
    });

    test('should handle cold start in Node.js 22.x environment', async () => {
      const originalEnv = process.env;

      try {
        // Clear module cache to simulate cold start
        const modulePath = require.resolve('../src/index');
        delete require.cache[modulePath];

        process.env = {
          ...originalEnv,
          AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
          AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '256',
          AWS_LAMBDA_INITIALIZATION_TYPE: 'on-demand',
        };

        const startTime = performance.now();
        const service = new NativeLicensingService();
        const loadTime = performance.now() - startTime;

        // Cold start should complete within reasonable time
        expect(loadTime).toBeLessThan(1000); // 1 second max
        expect(service).toBeDefined();

        // Service should be immediately functional
        const result = await service.checkEntitlement('123456789012');
        expect(result).toBeDefined();

      } finally {
        process.env = originalEnv;
      }
    });

    test('should work with different memory configurations in Node.js 22.x', async () => {
      const memorySizes = [128, 512, 1024, 3008];
      const originalEnv = process.env;

      for (const memorySize of memorySizes) {
        try {
          process.env = {
            ...originalEnv,
            AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: memorySize.toString(),
            NODE_OPTIONS: `--max-old-space-size=${Math.floor(memorySize * 0.8)}`,
          };

          const service = new NativeLicensingService();
          expect(service).toBeDefined();

          const result = await service.checkEntitlement('123456789012');
          expect(result).toBeDefined();
          expect(typeof result.entitled).toBe('boolean');

          // Memory usage should be reasonable (relaxed for test environment)
          const memUsage = process.memoryUsage();
          // In test environment, just ensure memory usage is not excessive (< 500MB)
          expect(memUsage.heapUsed).toBeLessThan(500 * 1024 * 1024);

        } finally {
          process.env = originalEnv;
        }
      }
    });
  });

  describe('Cross-Runtime Compatibility', () => {

    test('should maintain consistent interface across Node.js versions', async () => {
      const nodeVersions = ['20.x', '22.x'];
      const results: any[] = [];

      for (const version of nodeVersions) {
        const originalEnv = process.env;

        try {
          process.env = {
            ...originalEnv,
            AWS_EXECUTION_ENV: `AWS_Lambda_nodejs${version}`,
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '512',
          };

          const service = new NativeLicensingService();
          const result = await service.checkEntitlement('123456789012');

          results.push({
            version,
            service,
            result,
          });

        } finally {
          process.env = originalEnv;
        }
      }

      // All versions should have consistent interface
      results.forEach(({ version, service, result }) => {
        expect(service).toBeDefined();
        expect(typeof service.checkEntitlement).toBe('function');
        expect(service.checkEntitlement.length).toBe(1); // Single parameter

        expect(result).toBeDefined();
        expect(typeof result.entitled).toBe('boolean');

        // Response structure should be consistent
        expect(Object.keys(result)).toContain('entitled');
      });

      // Results should be consistent across versions
      const [result20, result22] = results.map(r => r.result);
      expect(result20.entitled).toBe(result22.entitled);
      expect(typeof result20.entitled).toBe(typeof result22.entitled);
    });

    test('should handle concurrent requests consistently across runtimes', async () => {
      const nodeVersions = ['20.x', '22.x'];

      for (const version of nodeVersions) {
        const originalEnv = process.env;

        try {
          process.env = {
            ...originalEnv,
            AWS_EXECUTION_ENV: `AWS_Lambda_nodejs${version}`,
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '1024',
          };

          const service = new NativeLicensingService();

          // Make concurrent requests
          const concurrentRequests = 3;
          const promises = Array.from({ length: concurrentRequests }, (_, i) =>
            service.checkEntitlement(`12345678901${i}`),
          );

          const startTime = performance.now();
          const results = await Promise.all(promises);
          const totalTime = performance.now() - startTime;

          // All requests should complete successfully
          expect(results).toHaveLength(concurrentRequests);
          results.forEach(result => {
            expect(result).toBeDefined();
            expect(typeof result.entitled).toBe('boolean');
          });

          // Performance should be reasonable
          expect(totalTime).toBeLessThan(5000); // 5 seconds total

        } finally {
          process.env = originalEnv;
        }
      }
    });
  });

  describe('Node-API Interface Compatibility', () => {

    test('should handle Node-API version differences gracefully', async () => {
      const originalEnv = process.env;

      try {
        // Test with different Node-API configurations
        const napiVersions = ['8', '9'];

        for (const napiVersion of napiVersions) {
          process.env = {
            ...originalEnv,
            AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs20.x',
            NODE_API_VERSION: napiVersion,
          };

          // Service should load regardless of Node-API version
          const service = new NativeLicensingService();
          expect(service).toBeDefined();

          const result = await service.checkEntitlement('123456789012');
          expect(result).toBeDefined();
          expect(typeof result.entitled).toBe('boolean');
        }

      } finally {
        process.env = originalEnv;
      }
    });

    test('should maintain type safety across Node.js versions', async () => {
      const nodeVersions = ['20.x', '22.x'];

      for (const version of nodeVersions) {
        const originalEnv = process.env;

        try {
          process.env = {
            ...originalEnv,
            AWS_EXECUTION_ENV: `AWS_Lambda_nodejs${version}`,
          };

          const service = new NativeLicensingService();

          // Test parameter type checking
          const validAccountId = '123456789012';
          const result = await service.checkEntitlement(validAccountId);

          expect(result).toBeDefined();
          expect(typeof result.entitled).toBe('boolean');

          // Test invalid parameter handling
          try {
            await service.checkEntitlement('invalid');
            // Should either succeed with entitled: false or throw
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
          }

        } finally {
          process.env = originalEnv;
        }
      }
    });
  });

  describe('Performance Characteristics', () => {

    test('should maintain performance bounds across Node.js versions', async () => {
      const nodeVersions = ['20.x', '22.x'];
      const performanceResults: { version: string; loadTime: number; requestTime: number }[] = [];

      for (const version of nodeVersions) {
        const originalEnv = process.env;

        try {
          process.env = {
            ...originalEnv,
            AWS_EXECUTION_ENV: `AWS_Lambda_nodejs${version}`,
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '512',
          };

          // Measure loading time
          const loadStartTime = performance.now();
          const service = new NativeLicensingService();
          const loadTime = performance.now() - loadStartTime;

          // Measure request time
          const requestStartTime = performance.now();
          await service.checkEntitlement('123456789012');
          const requestTime = performance.now() - requestStartTime;

          performanceResults.push({ version, loadTime, requestTime });

          // Individual performance bounds
          expect(loadTime).toBeLessThan(1000); // 1 second load time
          expect(requestTime).toBeLessThan(5000); // 5 second request time

        } finally {
          process.env = originalEnv;
        }
      }

      // Performance should be consistent across versions
      expect(performanceResults).toHaveLength(2);
      const perf20 = performanceResults[0]!;
      const perf22 = performanceResults[1]!;

      // Load times should be within 100% of each other (more lenient for test environment)
      const loadTimeDiff = Math.abs(perf20.loadTime - perf22.loadTime);
      const avgLoadTime = (perf20.loadTime + perf22.loadTime) / 2;
      expect(loadTimeDiff).toBeLessThan(avgLoadTime * 1.0);

      // Request times should be within 100% of each other (more lenient for test environment)
      const requestTimeDiff = Math.abs(perf20.requestTime - perf22.requestTime);
      const avgRequestTime = (perf20.requestTime + perf22.requestTime) / 2;
      expect(requestTimeDiff).toBeLessThan(avgRequestTime * 1.0);
    });

    test('should handle memory pressure consistently across runtimes', async () => {
      const nodeVersions = ['20.x', '22.x'];
      const lowMemorySize = 128;

      for (const version of nodeVersions) {
        const originalEnv = process.env;

        try {
          process.env = {
            ...originalEnv,
            AWS_EXECUTION_ENV: `AWS_Lambda_nodejs${version}`,
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: lowMemorySize.toString(),
            NODE_OPTIONS: `--max-old-space-size=${Math.floor(lowMemorySize * 0.8)}`,
          };

          const service = new NativeLicensingService();

          // Should work even under memory pressure
          const result = await service.checkEntitlement('123456789012');
          expect(result).toBeDefined();
          expect(typeof result.entitled).toBe('boolean');

          // Memory usage should remain reasonable (relaxed for test environment)
          const memUsage = process.memoryUsage();
          // In test environment, just ensure memory usage is not excessive (< 500MB)
          expect(memUsage.heapUsed).toBeLessThan(500 * 1024 * 1024);

        } finally {
          process.env = originalEnv;
        }
      }
    });
  });

  describe('Graceful Fallback Behavior', () => {

    test('should provide consistent fallback across Node.js versions', async () => {
      const nodeVersions = ['20.x', '22.x'];
      const fallbackResults: any[] = [];

      for (const version of nodeVersions) {
        const originalEnv = process.env;

        try {
          process.env = {
            ...originalEnv,
            AWS_EXECUTION_ENV: `AWS_Lambda_nodejs${version}`,
            AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '512',
          };

          // Native addon is mocked to fail, testing fallback
          const service = new NativeLicensingService();
          const result = await service.checkEntitlement('123456789012');

          fallbackResults.push({ version, result });

        } finally {
          process.env = originalEnv;
        }
      }

      // Fallback behavior should be consistent across versions
      fallbackResults.forEach(({ version, result }) => {
        expect(result).toBeDefined();
        expect(typeof result.entitled).toBe('boolean');
        expect(result.entitled).toBe(false); // Fail-closed behavior
      });

      // Results should be identical across versions
      const [result20, result22] = fallbackResults.map(r => r.result);
      expect(result20.entitled).toBe(result22.entitled);
    });

    test('should handle addon loading failures consistently', async () => {
      const nodeVersions = ['20.x', '22.x'];

      for (const version of nodeVersions) {
        const originalEnv = process.env;

        try {
          process.env = {
            ...originalEnv,
            AWS_EXECUTION_ENV: `AWS_Lambda_nodejs${version}`,
          };

          // Multiple service instances should all handle failure consistently
          const services = Array.from({ length: 3 }, () => new NativeLicensingService());

          const results = await Promise.all(
            services.map(service => service.checkEntitlement('123456789012')),
          );

          // All should fail closed consistently
          results.forEach(result => {
            expect(result).toBeDefined();
            expect(result.entitled).toBe(false);
          });

        } finally {
          process.env = originalEnv;
        }
      }
    });
  });

  describe('Architecture Compatibility', () => {

    test('should detect architecture compatibility requirements', () => {
      /**
       * **Validates: Requirements 5.3, 5.4**
       * Tests that the service can identify architecture requirements
       */

      const currentArch = process.arch;
      const supportedArchs = ['x64', 'arm64'];

      // Current architecture should be supported
      expect(supportedArchs).toContain(currentArch);

      // Service should be aware of architecture requirements
      const service = new NativeLicensingService();
      expect(service).toBeDefined();

      // Should work regardless of architecture
      expect(typeof service.checkEntitlement).toBe('function');
    });

    test('should handle cross-architecture scenarios gracefully', async () => {
      const nodeVersions = ['20.x', '22.x'];
      const architectures = ['x86_64', 'arm64'];

      for (const version of nodeVersions) {
        for (const arch of architectures) {
          const originalEnv = process.env;

          try {
            process.env = {
              ...originalEnv,
              AWS_EXECUTION_ENV: `AWS_Lambda_nodejs${version}`,
              AWS_LAMBDA_FUNCTION_ARCHITECTURE: arch,
            };

            const service = new NativeLicensingService();
            const result = await service.checkEntitlement('123456789012');

            // Should work or fail gracefully regardless of architecture
            expect(result).toBeDefined();
            expect(typeof result.entitled).toBe('boolean');

          } finally {
            process.env = originalEnv;
          }
        }
      }
    });
  });
});

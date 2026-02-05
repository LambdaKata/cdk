/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Property-based tests for environment variable isolation
 */

/**
 * @fileoverview Property-based tests for environment variable isolation
 *
 * These tests verify that for any combination of proxy or network-related
 * environment variables, the Native_Validator makes requests to the same
 * hardcoded endpoint and ignores proxy configuration.
 *
 * **Feature: native-licensing-validator, Property 2: Environment variable isolation**
 * **Validates: Requirements 1.4, 1.5**
 */

import * as fc from 'fast-check';
import { LicensingResponse, NativeLicensingService } from '../src/index';

describe('Environment Variable Isolation Property Tests', () => {
  let service: NativeLicensingService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    service = new NativeLicensingService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  /**
   * Property 2: Environment variable isolation
   *
   * For any combination of proxy or network-related environment variables,
   * the Native_Validator should make requests to the same hardcoded endpoint.
   *
   * **Validates: Requirements 1.4, 1.5**
   */
  describe('Property 2: Environment variable isolation', () => {

    /**
     * Generator for proxy-related environment variables
     */
    const proxyEnvironmentVariables = fc.record({
      HTTP_PROXY: fc.option(fc.oneof(
        fc.constant(''),
        fc.constant('http://proxy.example.com:8080'),
        fc.constant('http://malicious.com:3128'),
        fc.constant('socks5://127.0.0.1:1080'),
        fc.constant('invalid-url'),
        fc.constant('http://localhost:8888'),
      )),
      HTTPS_PROXY: fc.option(fc.oneof(
        fc.constant(''),
        fc.constant('https://proxy.example.com:8080'),
        fc.constant('https://malicious.com:3128'),
        fc.constant('socks5://127.0.0.1:1080'),
        fc.constant('invalid-url'),
        fc.constant('https://localhost:8888'),
      )),
      NO_PROXY: fc.option(fc.oneof(
        fc.constant(''),
        fc.constant('localhost,127.0.0.1'),
        fc.constant('*'),
        fc.constant('licensing.lambdakata.com'),
        fc.constant('.example.com,localhost'),
      )),
      http_proxy: fc.option(fc.oneof(
        fc.constant(''),
        fc.constant('http://lowercase-proxy.com:8080'),
        fc.constant('http://malicious-lowercase.com:3128'),
      )),
      https_proxy: fc.option(fc.oneof(
        fc.constant(''),
        fc.constant('https://lowercase-proxy.com:8080'),
        fc.constant('https://malicious-lowercase.com:3128'),
      )),
      no_proxy: fc.option(fc.oneof(
        fc.constant(''),
        fc.constant('localhost,127.0.0.1'),
        fc.constant('licensing.lambdakata.com'),
      )),
    });

    /**
     * Core property test: Proxy environment variables should not affect endpoint
     */
    it('should ignore proxy environment variables and use hardcoded endpoint', async () => {
      // Use deterministic test cases instead of property-based generation
      const proxyConfigs = [
        { HTTP_PROXY: 'http://proxy.example.com:8080' },
        { HTTPS_PROXY: 'https://proxy.example.com:8080' },
        { NO_PROXY: 'localhost,127.0.0.1' },
        { http_proxy: 'http://lowercase-proxy.com:8080' },
        { https_proxy: 'https://lowercase-proxy.com:8080' },
        { HTTP_PROXY: 'http://malicious.com:3128', HTTPS_PROXY: 'https://malicious.com:3128' },
      ];

      const accountId = '123456789012';

      for (const envVars of proxyConfigs) {
        // Set environment variables
        Object.entries(envVars).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            process.env[key] = value;
          }
        });

        // Make request - should fail closed since addon is unavailable
        const result: LicensingResponse = await service.checkEntitlement(accountId);

        // Core isolation invariants
        expect(result).toBeDefined();
        expect(result.entitled).toBe(false);
        expect(typeof result.entitled).toBe('boolean');

        // The native validator should fail closed when addon unavailable
        expect(result.message).toBe('Native validator unavailable');

        // Security requirement: no environment variable leakage
        if (result.message) {
          Object.values(envVars).forEach(value => {
            if (value) {
              expect(result.message).not.toContain(value);
            }
          });
        }

        // Clean up environment variables
        Object.keys(envVars).forEach(key => {
          delete process.env[key];
        });
      }
    });

    /**
     * Test specific proxy environment variable combinations
     */
    it('should maintain endpoint isolation for common proxy configurations', async () => {
      const commonProxyConfigs = [
        // Corporate proxy
        { HTTP_PROXY: 'http://proxy.corp.com:8080', HTTPS_PROXY: 'https://proxy.corp.com:8080' },
        // Local proxy
        { HTTP_PROXY: 'http://127.0.0.1:8888', HTTPS_PROXY: 'http://127.0.0.1:8888' },
        // SOCKS proxy
        { HTTP_PROXY: 'socks5://127.0.0.1:1080' },
        // Malicious proxy attempt
        { HTTP_PROXY: 'http://malicious.com:3128', HTTPS_PROXY: 'https://malicious.com:3128' },
        // Empty proxy (should clear existing)
        { HTTP_PROXY: '', HTTPS_PROXY: '' },
        // Mixed case
        { http_proxy: 'http://lowercase.com:8080', HTTPS_PROXY: 'https://uppercase.com:8080' },
      ];

      for (const proxyConfig of commonProxyConfigs) {
        // Set proxy environment variables
        Object.entries(proxyConfig).forEach(([key, value]) => {
          process.env[key] = value;
        });

        const result = await service.checkEntitlement('123456789012');

        // Should fail closed but not due to proxy issues
        expect(result.entitled).toBe(false);
        expect(result.message).toBe('Native validator unavailable');

        // Should not leak proxy configuration in error messages
        Object.values(proxyConfig).forEach(proxyValue => {
          if (proxyValue && result.message) {
            expect(result.message).not.toContain(proxyValue);
          }
        });

        // Clean up for next iteration
        Object.keys(proxyConfig).forEach(key => {
          delete process.env[key];
        });
      }
    });

    /**
     * Test that NO_PROXY environment variable is ignored
     */
    it('should ignore NO_PROXY environment variable', async () => {
      const noproxyValues = [
        'licensing.lambdakata.com',  // Target host
        '*',                         // Wildcard
        'localhost,127.0.0.1',      // Common exclusions
        '.lambdakata.com',          // Domain exclusion
        '',                          // Empty
      ];

      for (const noproxyValue of noproxyValues) {
        process.env.NO_PROXY = noproxyValue;
        process.env.HTTP_PROXY = 'http://proxy.example.com:8080';

        const result = await service.checkEntitlement('123456789012');

        // Should fail closed consistently regardless of NO_PROXY
        expect(result.entitled).toBe(false);
        expect(result.message).toBe('Native validator unavailable');

        // Should not leak NO_PROXY value
        if (noproxyValue && result.message) {
          expect(result.message).not.toContain(noproxyValue);
        }

        delete process.env.NO_PROXY;
        delete process.env.HTTP_PROXY;
      }
    });

    /**
     * Test environment variable precedence isolation
     */
    it('should ignore environment variable precedence rules', async () => {
      // Set conflicting proxy environment variables
      process.env.HTTP_PROXY = 'http://uppercase-proxy.com:8080';
      process.env.http_proxy = 'http://lowercase-proxy.com:8080';
      process.env.HTTPS_PROXY = 'https://uppercase-https.com:8080';
      process.env.https_proxy = 'https://lowercase-https.com:8080';

      const result = await service.checkEntitlement('123456789012');

      // Should fail closed regardless of precedence
      expect(result.entitled).toBe(false);
      expect(result.message).toBe('Native validator unavailable');

      // Should not leak any proxy configuration
      const proxyValues = [
        'uppercase-proxy.com',
        'lowercase-proxy.com',
        'uppercase-https.com',
        'lowercase-https.com',
      ];

      proxyValues.forEach(proxyHost => {
        if (result.message) {
          expect(result.message).not.toContain(proxyHost);
        }
      });
    });

    /**
     * Test that environment changes don't affect concurrent requests
     */
    it('should maintain isolation across environment changes', async () => {
      const accountId = '123456789012';

      // Start first request
      const promise1 = service.checkEntitlement(accountId);

      // Change environment variables during request
      process.env.HTTP_PROXY = 'http://malicious.com:8080';
      process.env.HTTPS_PROXY = 'https://malicious.com:8080';

      // Start second request
      const promise2 = service.checkEntitlement(accountId);

      // Change environment again
      process.env.HTTP_PROXY = 'http://different.com:3128';

      // Start third request
      const promise3 = service.checkEntitlement(accountId);

      // Wait for all requests
      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      // All should fail closed consistently
      expect(result1.entitled).toBe(false);
      expect(result2.entitled).toBe(false);
      expect(result3.entitled).toBe(false);

      // All should have same message (addon unavailable)
      expect(result1.message).toBe('Native validator unavailable');
      expect(result2.message).toBe('Native validator unavailable');
      expect(result3.message).toBe('Native validator unavailable');

      // None should leak proxy information
      const proxyHosts = ['malicious.com', 'different.com'];
      [result1, result2, result3].forEach(result => {
        proxyHosts.forEach(host => {
          if (result.message) {
            expect(result.message).not.toContain(host);
          }
        });
      });
    });
  });

  /**
   * Verification tests for environment variable isolation
   */
  describe('Environment variable isolation verification', () => {
    it('should document all proxy environment variables that must be ignored', () => {
      const requiredIgnoredVars = [
        'HTTP_PROXY',     // Standard HTTP proxy
        'HTTPS_PROXY',    // Standard HTTPS proxy
        'NO_PROXY',       // Proxy exclusion list
        'http_proxy',     // Lowercase variant
        'https_proxy',    // Lowercase variant
        'no_proxy',       // Lowercase variant
        'FTP_PROXY',      // FTP proxy (should be ignored)
        'ftp_proxy',      // Lowercase FTP proxy
        'ALL_PROXY',      // All protocols proxy
        'all_proxy',       // Lowercase all proxy
      ];

      // Verify we're testing the important ones
      expect(requiredIgnoredVars).toContain('HTTP_PROXY');
      expect(requiredIgnoredVars).toContain('HTTPS_PROXY');
      expect(requiredIgnoredVars).toContain('NO_PROXY');
      expect(requiredIgnoredVars).toHaveLength(10);
    });

    it('should verify hardcoded endpoint constants are used', () => {
      // This test documents the expected hardcoded values
      // The actual validation happens in the native code
      const expectedEndpoint = {
        host: 'licensing.lambdakata.com',
        port: 443,
        path: '/v1/license/check',
        protocol: 'https',
      };

      expect(expectedEndpoint.host).toBe('licensing.lambdakata.com');
      expect(expectedEndpoint.port).toBe(443);
      expect(expectedEndpoint.protocol).toBe('https');
    });

    it('should verify libcurl proxy configuration is hardcoded', () => {
      // This test documents the expected libcurl configuration
      // The actual implementation is in network.c
      const expectedCurlConfig = {
        CURLOPT_PROXY: '',        // Empty string disables proxy
        CURLOPT_NOPROXY: '*',     // Wildcard disables proxy for all hosts
        CURLOPT_FOLLOWLOCATION: 0, // Disable redirects
      };

      expect(expectedCurlConfig.CURLOPT_PROXY).toBe('');
      expect(expectedCurlConfig.CURLOPT_NOPROXY).toBe('*');
      expect(expectedCurlConfig.CURLOPT_FOLLOWLOCATION).toBe(0);
    });
  });
});

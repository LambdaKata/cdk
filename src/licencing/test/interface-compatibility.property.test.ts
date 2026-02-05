/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Property-based tests for interface compatibility
 */

/**
 * @fileoverview Property-based tests for interface compatibility
 *
 * **Feature: native-licensing-validator, Property 10: Interface compatibility**
 *
 * This test verifies that the NativeLicensingService returns the same
 * LicensingResponse format as the original HttpLicensingService across
 * all valid inputs and scenarios.
 *
 * **Validates: Requirements 6.3**
 */

import { LicensingResponse, LicensingService, NativeLicensingService } from '../src/index';

describe('Property 10: Interface Compatibility', () => {
  let nativeService: NativeLicensingService;
  let mockHttpService: LicensingService;

  beforeEach(() => {
    nativeService = new NativeLicensingService();

    // Create a mock HTTP service that implements the same interface
    // This simulates HttpLicensingService behavior without network calls
    mockHttpService = {
      async checkEntitlement(accountId: string): Promise<LicensingResponse> {
        // Validate account ID format like HttpLicensingService does
        if (!isValidAccountId(accountId)) {
          return {
            entitled: false,
            message: `Invalid AWS account ID format: ${accountId}. Expected 12-digit string.`,
          };
        }

        // Mock network error scenario (like HttpLicensingService would)
        return {
          entitled: false,
          message: 'Lambda Kata licensing service unreachable: Network error. Lambda will use original Node.js runtime.',
        };
      },
    };
  });

  /**
   * Property: Response Structure Compatibility
   *
   * For any valid account ID, both services should return responses
   * with identical structure and field types.
   */
  test('should return responses with identical structure', async () => {
    const validAccountIds = ['123456789012', '000000000000', '999999999999', '111111111111', '555555555555'];

    for (const accountId of validAccountIds) {
      const nativeResponse = await nativeService.checkEntitlement(accountId);
      const mockHttpResponse = await mockHttpService.checkEntitlement(accountId);

      // Both responses should have the same required fields
      expect(nativeResponse).toHaveProperty('entitled');
      expect(mockHttpResponse).toHaveProperty('entitled');

      expect(typeof nativeResponse.entitled).toBe('boolean');
      expect(typeof mockHttpResponse.entitled).toBe('boolean');

      // Optional fields should have consistent types when present
      if (nativeResponse.layerArn !== undefined) {
        expect(typeof nativeResponse.layerArn).toBe('string');
      }
      if (mockHttpResponse.layerArn !== undefined) {
        expect(typeof mockHttpResponse.layerArn).toBe('string');
      }

      if (nativeResponse.message !== undefined) {
        expect(typeof nativeResponse.message).toBe('string');
      }
      if (mockHttpResponse.message !== undefined) {
        expect(typeof mockHttpResponse.message).toBe('string');
      }

      if (nativeResponse.expiresAt !== undefined) {
        expect(typeof nativeResponse.expiresAt).toBe('string');
      }
      if (mockHttpResponse.expiresAt !== undefined) {
        expect(typeof mockHttpResponse.expiresAt).toBe('string');
      }

      // Both should conform to LicensingResponse interface
      validateLicensingResponse(nativeResponse);
      validateLicensingResponse(mockHttpResponse);
    }
  });

  /**
   * Property: Fail-Closed Behavior Compatibility
   *
   * When services are unavailable or encounter errors, both should
   * return fail-closed responses with consistent structure.
   */
  test('should have compatible fail-closed behavior', async () => {
    const testInputs = [
      // Valid account IDs
      '123456789012',
      '000000000000',
      // Invalid account IDs that should trigger fail-closed
      '',
      'invalid',
      '123456789012345', // Too long
      '12345678901a', // Contains letter
    ];

    for (const accountId of testInputs) {
      const nativeResponse = await nativeService.checkEntitlement(accountId);
      const mockHttpResponse = await mockHttpService.checkEntitlement(accountId);

      // For invalid inputs, both should fail closed
      if (!isValidAccountId(accountId)) {
        expect(nativeResponse.entitled).toBe(false);
        expect(mockHttpResponse.entitled).toBe(false);

        expect(nativeResponse.message).toBeDefined();
        expect(mockHttpResponse.message).toBeDefined();

        expect(typeof nativeResponse.message).toBe('string');
        expect(typeof mockHttpResponse.message).toBe('string');
      }

      // Both responses should always have valid structure
      validateLicensingResponse(nativeResponse);
      validateLicensingResponse(mockHttpResponse);
    }
  });

  /**
   * Property: Method Signature Compatibility
   *
   * Both services should have identical method signatures and
   * return Promise<LicensingResponse>.
   */
  test('should have identical method signatures', () => {
    // Both should have checkEntitlement method
    expect(nativeService.checkEntitlement).toBeDefined();
    expect(mockHttpService.checkEntitlement).toBeDefined();

    expect(typeof nativeService.checkEntitlement).toBe('function');
    expect(typeof mockHttpService.checkEntitlement).toBe('function');

    // Method should accept string parameter
    expect(nativeService.checkEntitlement.length).toBe(1);
    expect(mockHttpService.checkEntitlement.length).toBe(1);
  });

  /**
   * Property: Error Handling Compatibility
   *
   * Both services should handle errors gracefully and return
   * valid LicensingResponse objects, never throwing exceptions.
   */
  test('should handle errors compatibly without throwing', async () => {
    const invalidInputs = [
      'valid123456789012', // Invalid - too long
      null as any, // Null input
      undefined as any, // Undefined input
      123456789012 as any, // Number input
      {} as any, // Object input
      [] as any, // Array input
    ];

    for (const input of invalidInputs) {
      // Neither service should throw exceptions
      let nativeResponse: LicensingResponse;
      let mockHttpResponse: LicensingResponse;

      try {
        nativeResponse = await nativeService.checkEntitlement(input);
        expect(nativeResponse).toBeDefined();
        validateLicensingResponse(nativeResponse);
      } catch (error) {
        fail(`NativeLicensingService threw exception: ${error}`);
      }

      try {
        mockHttpResponse = await mockHttpService.checkEntitlement(input);
        expect(mockHttpResponse).toBeDefined();
        validateLicensingResponse(mockHttpResponse);
      } catch (error) {
        fail(`MockHttpLicensingService threw exception: ${error}`);
      }

      // For invalid inputs, both should fail closed
      if (!isValidAccountId(input)) {
        expect(nativeResponse!.entitled).toBe(false);
        expect(mockHttpResponse!.entitled).toBe(false);
      }
    }
  });

  /**
   * Property: Interface Contract Compliance
   *
   * Both services should implement the LicensingService interface
   * with identical contracts and behavior patterns.
   */
  test('should comply with LicensingService interface contract', async () => {
    const testAccountIds = [
      '123456789012',
      '000000000000', // All zeros
      '999999999999', // All nines
    ];

    for (const accountId of testAccountIds) {
      const nativeResponse = await nativeService.checkEntitlement(accountId);
      const mockHttpResponse = await mockHttpService.checkEntitlement(accountId);

      // Both should return objects with at least 'entitled' property
      expect(nativeResponse).toMatchObject({
        entitled: expect.any(Boolean),
      });

      expect(mockHttpResponse).toMatchObject({
        entitled: expect.any(Boolean),
      });

      // Both should have consistent behavior for same inputs
      // (In this case, both should fail closed since addon is unavailable)
      if (isValidAccountId(accountId)) {
        // For valid account IDs, both should return structured responses
        expect(nativeResponse.entitled).toBe(false); // Addon unavailable
        expect(mockHttpResponse.entitled).toBe(false); // Mock network error

        expect(nativeResponse.message).toBeDefined();
        expect(mockHttpResponse.message).toBeDefined();
      }
    }
  });
});

/**
 * Validate that a response conforms to the LicensingResponse interface
 *
 * @param response - Response to validate
 * @throws AssertionError if response doesn't conform to interface
 */
function validateLicensingResponse(response: any): asserts response is LicensingResponse {
  expect(response).toBeDefined();
  expect(typeof response).toBe('object');
  expect(response).not.toBeNull();

  // Required field: entitled must be boolean
  expect(response).toHaveProperty('entitled');
  expect(typeof response.entitled).toBe('boolean');

  // Optional fields - if present, must be non-empty strings
  if (response.layerArn !== undefined) {
    expect(typeof response.layerArn).toBe('string');
    expect(response.layerArn.length).toBeGreaterThan(0);
  }

  if (response.message !== undefined) {
    expect(typeof response.message).toBe('string');
    expect(response.message.length).toBeGreaterThan(0);
  }

  if (response.expiresAt !== undefined) {
    expect(typeof response.expiresAt).toBe('string');
    expect(response.expiresAt.length).toBeGreaterThan(0);
  }

  // Should not have unexpected properties
  const allowedProperties = ['entitled', 'layerArn', 'message', 'expiresAt'];
  const actualProperties = Object.keys(response);

  for (const prop of actualProperties) {
    expect(allowedProperties).toContain(prop);
  }
}

/**
 * Validate AWS account ID format
 *
 * @param accountId - Value to validate
 * @returns true if accountId is a valid 12-digit string
 */
function isValidAccountId(accountId: any): accountId is string {
  return typeof accountId === 'string' &&
    accountId.length === 12 &&
    /^\d{12}$/.test(accountId);
}

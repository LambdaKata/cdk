/**
 * Licensing Service for Lambda Kata CDK Integration
 *
 * This module provides the interface and implementation for validating
 * AWS Marketplace entitlements at CDK synthesis/deploy time.
 *
 * @module licensing
 */

import { LicensingResponse } from './types';

/**
 * Default licensing service endpoint for Lambda Kata.
 */
const DEFAULT_LICENSING_ENDPOINT = 'https://licensing.lambdakata.com/v1';

/**
 * Interface for the Lambda Kata licensing service.
 *
 * Implementations of this interface are responsible for validating
 * AWS account entitlements and returning customer-specific Layer ARNs.
 *
 * @example
 * ```typescript
 * const licensingService = new HttpLicensingService();
 * const response = await licensingService.checkEntitlement('123456789012');
 * if (response.entitled) {
 *   console.log(`Layer ARN: ${response.layerArn}`);
 * }
 * ```
 */
export interface LicensingService {
  /**
   * Check if an AWS account is entitled to use Lambda Kata.
   *
   * @param accountId - The AWS account ID to check (12-digit string)
   * @returns Promise resolving to entitlement status and Layer ARN if entitled
   *
   * @remarks
   * - If the account is entitled, the response will include the customer-specific Layer ARN
   * - If the account is not entitled, the response will have `entitled: false`
   * - Network errors are handled gracefully and treated as unlicensed (Requirement 6.5)
   */
  checkEntitlement(accountId: string): Promise<LicensingResponse>;
}

/**
 * HTTP-based implementation of the LicensingService interface.
 *
 * This implementation calls the Lambda Kata licensing backend to validate
 * AWS Marketplace entitlements. Network errors are handled gracefully
 * by treating unreachable services as unlicensed (per Requirement 6.5).
 *
 * @example
 * ```typescript
 * // Use default endpoint
 * const service = new HttpLicensingService();
 *
 * // Use custom endpoint
 * const customService = new HttpLicensingService('https://custom.endpoint.com');
 * ```
 */
export class HttpLicensingService implements LicensingService {
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  /**
   * Creates a new HttpLicensingService instance.
   *
   * @param endpoint - Optional custom licensing endpoint URL
   * @param timeoutMs - Optional request timeout in milliseconds (default: 5000)
   */
  constructor(endpoint?: string, timeoutMs: number = 5000) {
    this.endpoint = endpoint ?? DEFAULT_LICENSING_ENDPOINT;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Check if an AWS account is entitled to use Lambda Kata.
   *
   * Makes an HTTP request to the licensing service to validate the account's
   * AWS Marketplace entitlement. If the service is unreachable or returns
   * an error, the account is treated as unlicensed (Requirement 6.5).
   *
   * @param accountId - The AWS account ID to check (12-digit string)
   * @returns Promise resolving to entitlement status and Layer ARN if entitled
   *
   * @remarks
   * Validates: Requirements 3.2, 3.3, 6.5
   * - 3.2: Calls the Licensing_Service to validate the account's entitlement
   * - 3.3: Returns the customer-specific Layer_ARN if entitled
   * - 6.5: Treats unreachable service as unlicensed with appropriate warning
   */
  async checkEntitlement(accountId: string): Promise<LicensingResponse> {
    // Validate account ID format (12 digits)
    if (!isValidAccountId(accountId)) {
      return {
        entitled: false,
        message: `Invalid AWS account ID format: ${accountId}. Expected 12-digit string.`,
      };
    }

    try {
      const response = await this.makeRequest(accountId);
      return response;
    } catch (error) {
      // Handle network errors gracefully - treat as unlicensed (Requirement 6.5)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        entitled: false,
        message: `Lambda Kata licensing service unreachable: ${errorMessage}. Lambda will use original Node.js runtime.`,
      };
    }
  }

  /**
   * Makes the HTTP request to the licensing service.
   *
   * @param accountId - The AWS account ID to check
   * @returns Promise resolving to the licensing response
   * @throws Error if the request fails or times out
   */
  private async makeRequest(accountId: string): Promise<LicensingResponse> {
    const url = `${this.endpoint}/entitlement/${accountId}`;

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': '@lambda-kata/cdk',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Non-2xx response - treat as not entitled
        if (response.status === 404) {
          return {
            entitled: false,
            message: 'Lambda Kata not enabled: AWS account is not entitled. Subscribe via AWS Marketplace to enable.',
          };
        }

        // Other error responses
        return {
          entitled: false,
          message: `Lambda Kata licensing check failed (HTTP ${response.status}). Lambda will use original Node.js runtime.`,
        };
      }

      // Parse successful response
      const data = await response.json() as LicensingResponse;

      // Validate response structure
      if (typeof data.entitled !== 'boolean') {
        return {
          entitled: false,
          message: 'Lambda Kata licensing check failed: Invalid response format. Lambda will use original Node.js runtime.',
        };
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle abort (timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timed out after ${this.timeoutMs}ms`);
      }

      // Re-throw other errors
      throw error;
    }
  }
}

/**
 * Validates that an AWS account ID is in the correct format.
 *
 * @param accountId - The account ID to validate
 * @returns true if the account ID is a valid 12-digit string
 */
export function isValidAccountId(accountId: string): boolean {
  // AWS account IDs are exactly 12 digits
  return /^\d{12}$/.test(accountId);
}

/**
 * Creates a default LicensingService instance.
 *
 * This factory function provides a convenient way to create a licensing
 * service with default configuration.
 *
 * @param endpoint - Optional custom licensing endpoint URL
 * @returns A new LicensingService instance
 *
 * @example
 * ```typescript
 * const service = createLicensingService();
 * const response = await service.checkEntitlement('123456789012');
 * ```
 */
export function createLicensingService(endpoint?: string): LicensingService {
  return new HttpLicensingService(endpoint);
}

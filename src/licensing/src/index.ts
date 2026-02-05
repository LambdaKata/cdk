/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * TypeScript wrapper for native licensing validator
 */

import { applyGlobalOptimizations, PerformanceOptimizer } from './performance-optimizations';

// Apply global optimizations on module load
applyGlobalOptimizations();

/**
 * @fileoverview Native Licensing Validator
 *
 * This module provides a tamper - resistant native licensing validator
 * for the Lambda Kata SST Integration workspace.It implements the
 * existing LicensingService interface while providing enhanced security
 * through native C implementation.
 *
 * @example
 * ```typescript
 * import { NativeLicensingService } from '@lambda-kata/licensing';
 *
 * const service = new NativeLicensingService();
 * const result = await service.checkEntitlement('123456789012');
 * console.log(result.entitled); // true or false
 * ```
 */

/**
 * @interface LicensingResponse
 *
 * Response format for licensing validation checks.
 * Compatible with existing HttpLicensingService interface.
 */
export interface LicensingResponse {
  /** Whether the account is entitled to use Lambda Kata */
  entitled: boolean;
  /** Customer-specific Lambda Layer ARN (if entitled) */
  layerArn?: string;
  /** Human-readable status message */
  message?: string;
  /** ISO 8601 expiration timestamp (if applicable) */
  expiresAt?: string;
}

/**
 * @interface LicensingService
 *
 * Interface for licensing validation services.
 * Maintains compatibility with existing SST integration packages.
 */
export interface LicensingService {
  /**
   * Check entitlement for an AWS account (async)
   *
   * @param accountId - 12-digit AWS account ID
   * @returns Promise resolving to licensing response
   */
  checkEntitlement(accountId: string): Promise<LicensingResponse>;

  /**
   * Check entitlement for an AWS account (sync)
   * 
   * WARNING: This method blocks the Node.js event loop.
   * Use only when async operations are not possible (e.g., CDK synthesis).
   *
   * This method is optional for backward compatibility with existing
   * implementations that only provide async validation.
   *
   * @param accountId - 12-digit AWS account ID
   * @returns Licensing response (synchronous)
   */
  checkEntitlementSync?(accountId: string): LicensingResponse;
}

/**
 * @interface NativeAddon
 *
 * Interface for the native addon module.
 * Internal interface - not exported.
 */
interface NativeAddon {
  checkEntitlement(accountId: string): Promise<LicensingResponse>;
  checkEntitlementSync(accountId: string): LicensingResponse;
}

/**
 * @class NativeLicensingService
 *
 * Tamper-resistant native licensing validator implementation.
 *
 * This class provides a secure implementation of the LicensingService
 * interface using a native C addon. It implements fail-closed security
 * where any error condition results in denying access.
 *
 * @remarks Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 *
 * @example
 * ```typescript
 * const service = new NativeLicensingService();
 *
 * // Check entitlement for an account
 * const result = await service.checkEntitlement('123456789012');
 * if (result.entitled) {
 *   console.log(`Layer ARN: ${result.layerArn}`);
 * }
 * ```
 */
export class NativeLicensingService implements LicensingService {
  private addon: NativeAddon | null = null;
  private addonLoadAttempted = false;
  private performanceOptimizer: PerformanceOptimizer;

  /**
   * Create a new NativeLicensingService instance
   *
   * The native addon is loaded lazily on first use to avoid
   * blocking the constructor if the addon is unavailable.
   */
  constructor() {
    // Initialize performance optimizer
    this.performanceOptimizer = PerformanceOptimizer.getInstance();

    // Addon loaded lazily in checkEntitlement
  }

  /**
   * Check entitlement for an AWS account
   *
   * This method validates the account ID format and delegates to the
   * native addon for secure validation. If the addon is unavailable,
   * it returns a fail-closed response.
   *
   * @param accountId - 12-digit AWS account ID string
   * @returns Promise resolving to licensing response
   *
   * @throws Never throws - all errors result in fail-closed response
   *
   * @example
   * ```typescript
   * const service = new NativeLicensingService();
   * const result = await service.checkEntitlement('123456789012');
   * ```
   */
  async checkEntitlement(accountId: string): Promise<LicensingResponse> {
    // Track request start for performance monitoring
    this.performanceOptimizer.trackRequestStart();

    try {
      // Validate input parameters in JavaScript layer first
      if (!this.isValidAccountId(accountId)) {
        this.logError('Invalid account ID format provided', {
          accountIdLength: typeof accountId === 'string' ? accountId.length : 'not-string',
          accountIdType: typeof accountId,
        });
        this.performanceOptimizer.trackRequestEnd(false);
        return {
          entitled: false,
          message: 'Invalid account ID format',
        };
      }

      // Load addon if not already attempted
      if (!this.addonLoadAttempted) {
        this.loadAddon();
      }

      // If addon unavailable, return fail-closed response
      if (!this.addon) {
        this.logError('Native validator unavailable', {
          addonLoadAttempted: this.addonLoadAttempted,
        });
        this.performanceOptimizer.trackRequestEnd(false);
        return {
          entitled: false,
          message: 'Native validator unavailable',
        };
      }

      // Delegate to native addon
      const result = await this.addon.checkEntitlement(accountId);

      // Log successful validation (without sensitive data)
      this.logInfo('Validation completed', {
        entitled: result.entitled,
        hasLayerArn: !!result.layerArn,
        hasMessage: !!result.message,
        hasExpiresAt: !!result.expiresAt,
      });

      // Track successful request (assume cache hit if response is fast)
      const metrics = this.performanceOptimizer.getMetrics();
      const cacheHit = metrics.cacheHitRate > 0.3; // Heuristic based on historical performance
      this.performanceOptimizer.trackRequestEnd(cacheHit);

      return result;

    } catch (error) {
      // Fail closed on any unexpected error
      this.logError('Unexpected error during validation', {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: this.sanitizeErrorMessage(error),
      });

      this.performanceOptimizer.trackRequestEnd(false);
      return {
        entitled: false,
        message: 'System error',
      };
    }
  }

  /**
   * Check entitlement for an AWS account SYNCHRONOUSLY
   *
   * WARNING: This method blocks the Node.js event loop.
   * Use only when async operations are not possible (e.g., CDK synthesis).
   *
   * This method validates the account ID format and delegates to the
   * native addon for secure validation. If the addon is unavailable,
   * it returns a fail-closed response.
   *
   * @param accountId - 12-digit AWS account ID string
   * @returns Licensing response (synchronous)
   *
   * @throws Never throws - all errors result in fail-closed response
   *
   * @example
   * ```typescript
   * const service = new NativeLicensingService();
   * const result = service.checkEntitlementSync('123456789012');
   * ```
   */
  checkEntitlementSync(accountId: string): LicensingResponse {
    // Track request start for performance monitoring
    this.performanceOptimizer.trackRequestStart();

    try {
      // Validate input parameters in JavaScript layer first
      if (!this.isValidAccountId(accountId)) {
        this.logError('Invalid account ID format provided (sync)', {
          accountIdLength: typeof accountId === 'string' ? accountId.length : 'not-string',
          accountIdType: typeof accountId,
        });
        this.performanceOptimizer.trackRequestEnd(false);
        return {
          entitled: false,
          message: 'Invalid account ID format',
        };
      }

      // Load addon if not already attempted
      if (!this.addonLoadAttempted) {
        this.loadAddon();
      }

      // If addon unavailable, return fail-closed response
      if (!this.addon) {
        this.logError('Native validator unavailable (sync)', {
          addonLoadAttempted: this.addonLoadAttempted,
        });
        this.performanceOptimizer.trackRequestEnd(false);
        return {
          entitled: false,
          message: 'Native validator unavailable',
        };
      }

      // Delegate to native addon SYNCHRONOUSLY
      const result = this.addon.checkEntitlementSync(accountId);

      // Log successful validation (without sensitive data)
      this.logInfo('Sync validation completed', {
        entitled: result.entitled,
        hasLayerArn: !!result.layerArn,
        hasMessage: !!result.message,
        hasExpiresAt: !!result.expiresAt,
      });

      // Track successful request
      this.performanceOptimizer.trackRequestEnd(true);

      return result;

    } catch (error) {
      // Fail closed on any unexpected error
      this.logError('Unexpected error during sync validation', {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: this.sanitizeErrorMessage(error),
      });

      this.performanceOptimizer.trackRequestEnd(false);
      return {
        entitled: false,
        message: 'System error',
      };
    }
  }

  /**
   * Get current performance metrics
   *
   * @returns Current performance metrics including memory usage and timing
   */
  getPerformanceMetrics() {
    return this.performanceOptimizer.getMetrics();
  }

  /**
   * Validate account ID format
   *
   * Checks that the account ID is a 12-digit string.
   * This validation is performed in JavaScript for fail-fast behavior.
   *
   * @param accountId - Account ID to validate
   * @returns True if valid format, false otherwise
   *
   * @private
   */
  private isValidAccountId(accountId: string): boolean {
    if (typeof accountId !== 'string') {
      return false;
    }

    if (accountId.length !== 12) {
      return false;
    }

    // Check that all characters are digits
    return /^\d{12}$/.test(accountId);
  }

  /**
   * Load the native addon
   *
   * Attempts to load the native addon module. If loading fails,
   * the addon remains null and all requests will fail closed.
   *
   * @private
   */
  private loadAddon(): void {
    this.addonLoadAttempted = true;

    try {
      // Try to load the native addon
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.addon = require('../build/Release/native_licensing_validator.node');

      this.logInfo('Native addon loaded successfully', {});

    } catch (error) {
      // Addon loading failed - log appropriately based on environment
      this.logError('Failed to load native licensing validator', {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: this.sanitizeErrorMessage(error),
      });

      this.addon = null;
    }
  }

  /**
   * Check if running in production mode
   *
   * @returns True if production mode, false otherwise
   * @private
   */
  private isProductionMode(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  /**
   * Sanitize error message for logging
   *
   * Removes potentially sensitive information from error messages
   * in production mode.
   *
   * @param error - Error object or message
   * @returns Sanitized error message
   * @private
   */
  private sanitizeErrorMessage(error: unknown): string {
    if (this.isProductionMode()) {
      // In production, use generic error messages
      if (error instanceof Error) {
        // Only log error type, not message content
        return `${error.constructor.name} occurred`;
      }
      return 'Unknown error occurred';
    }

    // In development, provide more detail
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return String(error);
  }

  /**
   * Log informational message
   *
   * @param message - Log message
   * @param context - Additional context (will be sanitized)
   * @private
   */
  private logInfo(message: string, context: Record<string, unknown>): void {
    if (this.isProductionMode()) {
      // Minimal logging in production
      console.log(`[INFO] native-licensing-validator: ${message}`);
    } else {
      // Detailed logging in development
      console.log(`[INFO] native-licensing-validator: ${message}`, context);
    }
  }

  /**
   * Log error message
   *
   * @param message - Error message
   * @param context - Additional context (will be sanitized)
   * @private
   */
  private logError(message: string, context: Record<string, unknown>): void {
    if (this.isProductionMode()) {
      // Generic error message in production
      console.error(`[ERROR] native-licensing-validator: System error occurred`);
    } else {
      // Detailed error message in development
      console.error(`[ERROR] native-licensing-validator: ${message}`, context);
    }
  }
}

/**
 * Default export for convenience
 */
export default NativeLicensingService;

/**
 * Create a new NativeLicensingService instance
 *
 * Factory function for creating licensing service instances.
 *
 * @returns New NativeLicensingService instance
 *
 * @example
 * ```typescript
 * import { createLicensingService } from '@lambda-kata/licensing';
 *
 * const service = createLicensingService();
 * const result = await service.checkEntitlement('123456789012');
 * ```
 */
export function createLicensingService(): LicensingService {
  return new NativeLicensingService();
}

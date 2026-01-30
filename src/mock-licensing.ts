/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Mock Licensing Service for Lambda Kata CDK Integration Testing
 *
 * This module provides a mock implementation of the LicensingService interface
 * for testing the kata() wrapper without making real network calls.
 *
 * @module mock-licensing
 */

import { LicensingService } from './licensing';
import { LicensingResponse } from './types';

/**
 * Mock implementation of the LicensingService interface for testing.
 *
 * This class allows programmatic control over entitlement status,
 * enabling comprehensive testing of the kata() wrapper behavior
 * for both entitled and non-entitled accounts.
 *
 * @example
 * ```typescript
 * const mockService = new MockLicensingService();
 *
 * // Set up an entitled account
 * mockService.setEntitled('123456789012', 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1');
 *
 * // Check entitlement
 * const response = await mockService.checkEntitlement('123456789012');
 * console.log(response.entitled); // true
 * console.log(response.layerArn); // 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1'
 *
 * // Non-entitled account
 * const response2 = await mockService.checkEntitlement('000000000000');
 * console.log(response2.entitled); // false
 * ```
 *
 * @remarks
 * Validates: Requirements 3.2, 3.3
 * - 3.2: Provides mock validation of account entitlements
 * - 3.3: Returns customer-specific Layer_ARN for entitled accounts
 */
export class MockLicensingService implements LicensingService {
    /**
     * Map of AWS account IDs to their entitled Layer ARNs.
     * Accounts not in this map are considered non-entitled.
     */
    private entitlements: Map<string, string> = new Map();

    /**
     * Map of AWS account IDs to custom messages (for non-entitled accounts).
     */
    private customMessages: Map<string, string> = new Map();

    /**
     * Optional custom message to return for entitled accounts.
     */
    private entitledMessage: string = 'Entitled';

    /**
     * Optional custom message to return for non-entitled accounts.
     * Default matches the expected warning message from Requirement 6.4.
     */
    private notEntitledMessage: string = 'Lambda Kata not enabled: AWS account is not entitled. Subscribe via AWS Marketplace to enable.';

    /**
     * Optional expiration date for entitlements.
     */
    private expiresAt?: string;

    /**
     * Flag to simulate service unavailability.
     */
    private simulateServiceError: boolean = false;

    /**
     * Custom error message when simulating service errors.
     */
    private serviceErrorMessage: string = 'Lambda Kata licensing service unreachable. Lambda will use original Node.js runtime.';

    /**
     * Sets an account as entitled with a specific Layer ARN.
     *
     * @param accountId - The AWS account ID (12-digit string)
     * @param layerArn - The customer-specific Lambda Layer ARN
     *
     * @example
     * ```typescript
     * mockService.setEntitled('123456789012', 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1');
     * ```
     */
    setEntitled(accountId: string, layerArn: string): void {
        this.entitlements.set(accountId, layerArn);
    }

    /**
     * Removes entitlement for an account.
     *
     * @param accountId - The AWS account ID to remove entitlement for
     *
     * @example
     * ```typescript
     * mockService.removeEntitlement('123456789012');
     * ```
     */
    removeEntitlement(accountId: string): void {
        this.entitlements.delete(accountId);
    }

    /**
     * Clears all entitlements.
     *
     * @example
     * ```typescript
     * mockService.clearEntitlements();
     * ```
     */
    clearEntitlements(): void {
        this.entitlements.clear();
    }

    /**
     * Sets a custom message for entitled accounts.
     *
     * @param message - The message to return for entitled accounts
     */
    setEntitledMessage(message: string): void {
        this.entitledMessage = message;
    }

    /**
     * Sets a custom message for non-entitled accounts.
     *
     * @param message - The message to return for non-entitled accounts
     */
    setNotEntitledMessage(message: string): void {
        this.notEntitledMessage = message;
    }

    /**
     * Sets a custom message for a specific non-entitled account.
     * This allows testing per-account custom error messages from the licensing service.
     *
     * @param accountId - The AWS account ID
     * @param message - The custom message to return for this account
     *
     * @example
     * ```typescript
     * mockService.setCustomMessage('123456789012', 'Custom licensing error: Account suspended');
     * ```
     */
    setCustomMessage(accountId: string, message: string): void {
        this.customMessages.set(accountId, message);
    }

    /**
     * Sets the expiration date for entitlements.
     *
     * @param expiresAt - ISO 8601 formatted expiration date
     */
    setExpiresAt(expiresAt: string): void {
        this.expiresAt = expiresAt;
    }

    /**
     * Configures the mock to simulate service unavailability.
     *
     * @param simulate - Whether to simulate service errors
     * @param errorMessage - Optional custom error message
     *
     * @example
     * ```typescript
     * // Simulate service being down
     * mockService.setSimulateServiceError(true);
     *
     * // With custom error message
     * mockService.setSimulateServiceError(true, 'Connection refused');
     * ```
     */
    setSimulateServiceError(simulate: boolean, errorMessage?: string): void {
        this.simulateServiceError = simulate;
        if (errorMessage) {
            this.serviceErrorMessage = errorMessage;
        }
    }

    /**
     * Check if an AWS account is entitled to use Lambda Kata.
     *
     * This mock implementation returns entitlement status based on
     * accounts configured via setEntitled().
     *
     * @param accountId - The AWS account ID to check (12-digit string)
     * @returns Promise resolving to entitlement status and Layer ARN if entitled
     *
     * @remarks
     * Validates: Requirements 3.2, 3.3
     * - 3.2: Validates the account's entitlement based on configured entitlements
     * - 3.3: Returns the customer-specific Layer_ARN if entitled
     */
    async checkEntitlement(accountId: string): Promise<LicensingResponse> {
        // Simulate service error if configured
        if (this.simulateServiceError) {
            return {
                entitled: false,
                message: this.serviceErrorMessage,
            };
        }

        const layerArn = this.entitlements.get(accountId);

        if (layerArn) {
            // Account is entitled
            const response: LicensingResponse = {
                entitled: true,
                layerArn,
                message: this.entitledMessage,
            };

            // Include expiration if set
            if (this.expiresAt) {
                response.expiresAt = this.expiresAt;
            }

            return response;
        }

        // Account is not entitled
        // Use per-account custom message if set, otherwise use global message
        const message = this.customMessages.get(accountId) ?? this.notEntitledMessage;
        return {
            entitled: false,
            message,
        };
    }

    /**
     * Returns the number of entitled accounts.
     *
     * @returns The count of entitled accounts
     */
    getEntitlementCount(): number {
        return this.entitlements.size;
    }

    /**
     * Checks if a specific account is entitled (without async).
     *
     * @param accountId - The AWS account ID to check
     * @returns true if the account is entitled
     */
    isEntitled(accountId: string): boolean {
        return this.entitlements.has(accountId);
    }

    /**
     * Gets the Layer ARN for an entitled account (without async).
     *
     * @param accountId - The AWS account ID
     * @returns The Layer ARN if entitled, undefined otherwise
     */
    getLayerArn(accountId: string): string | undefined {
        return this.entitlements.get(accountId);
    }
}

/**
 * Creates a MockLicensingService with pre-configured entitlements.
 *
 * @param entitlements - Map of account IDs to Layer ARNs
 * @returns A new MockLicensingService instance with the specified entitlements
 *
 * @example
 * ```typescript
 * const mockService = createMockLicensingService({
 *   '123456789012': 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1',
 *   '987654321098': 'arn:aws:lambda:us-west-2:999999999999:layer:LambdaKata:2',
 * });
 * ```
 */
export function createMockLicensingService(
    entitlements?: Record<string, string>
): MockLicensingService {
    const service = new MockLicensingService();

    if (entitlements) {
        for (const [accountId, layerArn] of Object.entries(entitlements)) {
            service.setEntitled(accountId, layerArn);
        }
    }

    return service;
}

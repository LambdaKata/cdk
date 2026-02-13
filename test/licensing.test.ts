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
 * Tests for the Licensing Service
 *
 * These tests verify the LicensingService interface and HttpLicensingService
 * implementation, including network error handling (Requirement 6.5).
 */

import {
    LicensingService,
    LicenseCheckParams,
    HttpLicensingService,
    createLicensingService,
    isValidAccountId,
} from '../src/licensing';
import { LicensingResponse } from '../src/types';

describe('LicensingService', () => {
    describe('isValidAccountId', () => {
        it('should return true for valid 12-digit account IDs', () => {
            expect(isValidAccountId('123456789012')).toBe(true);
            expect(isValidAccountId('000000000000')).toBe(true);
            expect(isValidAccountId('999999999999')).toBe(true);
        });

        it('should return false for invalid account IDs', () => {
            // Too short
            expect(isValidAccountId('12345678901')).toBe(false);
            // Too long
            expect(isValidAccountId('1234567890123')).toBe(false);
            // Contains letters
            expect(isValidAccountId('12345678901a')).toBe(false);
            // Empty string
            expect(isValidAccountId('')).toBe(false);
            // Contains special characters
            expect(isValidAccountId('123456789-12')).toBe(false);
        });
    });

    describe('HttpLicensingService', () => {
        describe('checkEntitlement', () => {
            it('should return not entitled for invalid account ID format', async () => {
                const service = new HttpLicensingService();
                const response = await service.checkEntitlement('invalid');

                expect(response.entitled).toBe(false);
                expect(response.message).toContain('Invalid AWS account ID format');
            });

            it('should accept LicenseCheckParams object', async () => {
                const service = new HttpLicensingService();
                const params: LicenseCheckParams = {
                    accountId: 'invalid',
                    nodeVersion: '20',
                    architecture: 'x86_64',
                };
                const response = await service.checkEntitlement(params);

                expect(response.entitled).toBe(false);
                expect(response.message).toContain('Invalid AWS account ID format');
            });

            it('should accept string accountId for backward compatibility', async () => {
                const service = new HttpLicensingService();
                const response = await service.checkEntitlement('invalid');

                expect(response.entitled).toBe(false);
                expect(response.message).toContain('Invalid AWS account ID format');
            });

            it('should handle network errors gracefully (Requirement 6.5)', async () => {
                // Use a non-existent endpoint to simulate network error
                const service = new HttpLicensingService('http://localhost:99999', 100);
                const response = await service.checkEntitlement('123456789012');

                expect(response.entitled).toBe(false);
                expect(response.message).toContain('licensing service unreachable');
            });

            it('should handle timeout errors gracefully', async () => {
                // Create a service with very short timeout
                const service = new HttpLicensingService('http://10.255.255.1', 1);
                const response = await service.checkEntitlement('123456789012');

                expect(response.entitled).toBe(false);
                expect(response.message).toContain('licensing service unreachable');
            });
        });
    });

    describe('createLicensingService', () => {
        it('should create an HttpLicensingService instance', () => {
            const service = createLicensingService();
            expect(service).toBeInstanceOf(HttpLicensingService);
        });

        it('should accept custom endpoint', () => {
            const customEndpoint = 'https://custom.endpoint.com';
            const service = createLicensingService(customEndpoint);
            expect(service).toBeInstanceOf(HttpLicensingService);
        });
    });

    describe('LicensingService interface compliance', () => {
        it('should implement checkEntitlement method', () => {
            const service: LicensingService = new HttpLicensingService();
            expect(typeof service.checkEntitlement).toBe('function');
        });

        it('should return LicensingResponse structure', async () => {
            const service = new HttpLicensingService();
            // Use invalid account to get a predictable response without network call
            const response = await service.checkEntitlement('invalid');

            // Verify response structure
            expect(typeof response.entitled).toBe('boolean');
            expect(response.message === undefined || typeof response.message === 'string').toBe(true);
            expect(response.layerArn === undefined || typeof response.layerArn === 'string').toBe(true);
            expect(response.expiresAt === undefined || typeof response.expiresAt === 'string').toBe(true);
        });
    });
});

/**
 * Mock implementation tests - verifying the interface can be mocked
 * This is important for testing the kata() wrapper without network calls.
 */
describe('MockLicensingService (interface compliance)', () => {
    class TestMockLicensingService implements LicensingService {
        private entitlements: Map<string, string> = new Map();

        setEntitled(accountId: string, layerArn: string): void {
            this.entitlements.set(accountId, layerArn);
        }

        async checkEntitlement(accountId: string): Promise<LicensingResponse> {
            const layerArn = this.entitlements.get(accountId);
            return {
                entitled: !!layerArn,
                layerArn,
                message: layerArn ? 'Entitled' : 'Not entitled',
            };
        }
    }

    it('should return entitled status for registered accounts', async () => {
        const mockService = new TestMockLicensingService();
        const testLayerArn = 'arn:aws:lambda:us-east-1:123456789012:layer:lambda-kata:1';
        mockService.setEntitled('123456789012', testLayerArn);

        const response = await mockService.checkEntitlement('123456789012');

        expect(response.entitled).toBe(true);
        expect(response.layerArn).toBe(testLayerArn);
        expect(response.message).toBe('Entitled');
    });

    it('should return not entitled for unregistered accounts', async () => {
        const mockService = new TestMockLicensingService();

        const response = await mockService.checkEntitlement('999999999999');

        expect(response.entitled).toBe(false);
        expect(response.layerArn).toBeUndefined();
        expect(response.message).toBe('Not entitled');
    });
});

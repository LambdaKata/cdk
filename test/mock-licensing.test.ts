/*
 * MIT
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the MIT; see the LICENSE file
 * or https://choosealicense.com/licenses/mit/ for details.
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for MockLicensingService
 *
 * These tests verify that the MockLicensingService correctly implements
 * the LicensingService interface and supports programmatic control of
 * entitlement status for testing purposes.
 *
 * Validates: Requirements 3.2, 3.3
 */

import { MockLicensingService, createMockLicensingService } from '../src/mock-licensing';
import { LicensingService } from '../src/licensing';

describe('MockLicensingService', () => {
    let mockService: MockLicensingService;

    beforeEach(() => {
        mockService = new MockLicensingService();
    });

    describe('implements LicensingService interface', () => {
        it('should implement LicensingService interface', () => {
            // Verify the mock implements the interface
            const service: LicensingService = mockService;
            expect(service.checkEntitlement).toBeDefined();
            expect(typeof service.checkEntitlement).toBe('function');
        });
    });

    describe('setEntitled', () => {
        it('should set an account as entitled with a Layer ARN', async () => {
            const accountId = '123456789012';
            const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';

            mockService.setEntitled(accountId, layerArn);

            const response = await mockService.checkEntitlement(accountId);

            expect(response.entitled).toBe(true);
            expect(response.layerArn).toBe(layerArn);
            expect(response.message).toBe('Entitled');
        });

        it('should support multiple entitled accounts', async () => {
            const account1 = '123456789012';
            const layer1 = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
            const account2 = '987654321098';
            const layer2 = 'arn:aws:lambda:us-west-2:999999999999:layer:LambdaKata:2';

            mockService.setEntitled(account1, layer1);
            mockService.setEntitled(account2, layer2);

            const response1 = await mockService.checkEntitlement(account1);
            const response2 = await mockService.checkEntitlement(account2);

            expect(response1.entitled).toBe(true);
            expect(response1.layerArn).toBe(layer1);
            expect(response2.entitled).toBe(true);
            expect(response2.layerArn).toBe(layer2);
        });

        it('should overwrite existing entitlement for same account', async () => {
            const accountId = '123456789012';
            const oldLayerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
            const newLayerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:2';

            mockService.setEntitled(accountId, oldLayerArn);
            mockService.setEntitled(accountId, newLayerArn);

            const response = await mockService.checkEntitlement(accountId);

            expect(response.entitled).toBe(true);
            expect(response.layerArn).toBe(newLayerArn);
        });
    });

    describe('checkEntitlement', () => {
        it('should return not entitled for unknown accounts', async () => {
            const response = await mockService.checkEntitlement('000000000000');

            expect(response.entitled).toBe(false);
            expect(response.layerArn).toBeUndefined();
            // Default message matches Requirement 6.4
            expect(response.message).toContain('not entitled');
        });

        it('should return entitled status for configured accounts', async () => {
            const accountId = '123456789012';
            const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';

            mockService.setEntitled(accountId, layerArn);

            const response = await mockService.checkEntitlement(accountId);

            expect(response.entitled).toBe(true);
            expect(response.layerArn).toBe(layerArn);
        });

        it('should include expiresAt when set', async () => {
            const accountId = '123456789012';
            const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
            const expiresAt = '2025-12-31T23:59:59Z';

            mockService.setEntitled(accountId, layerArn);
            mockService.setExpiresAt(expiresAt);

            const response = await mockService.checkEntitlement(accountId);

            expect(response.entitled).toBe(true);
            expect(response.expiresAt).toBe(expiresAt);
        });
    });

    describe('removeEntitlement', () => {
        it('should remove entitlement for an account', async () => {
            const accountId = '123456789012';
            const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';

            mockService.setEntitled(accountId, layerArn);
            mockService.removeEntitlement(accountId);

            const response = await mockService.checkEntitlement(accountId);

            expect(response.entitled).toBe(false);
            expect(response.layerArn).toBeUndefined();
        });

        it('should not throw when removing non-existent entitlement', () => {
            expect(() => {
                mockService.removeEntitlement('000000000000');
            }).not.toThrow();
        });
    });

    describe('clearEntitlements', () => {
        it('should clear all entitlements', async () => {
            mockService.setEntitled('123456789012', 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1');
            mockService.setEntitled('987654321098', 'arn:aws:lambda:us-west-2:999999999999:layer:LambdaKata:2');

            mockService.clearEntitlements();

            const response1 = await mockService.checkEntitlement('123456789012');
            const response2 = await mockService.checkEntitlement('987654321098');

            expect(response1.entitled).toBe(false);
            expect(response2.entitled).toBe(false);
        });
    });

    describe('custom messages', () => {
        it('should use custom entitled message', async () => {
            const accountId = '123456789012';
            const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
            const customMessage = 'Account is fully entitled';

            mockService.setEntitled(accountId, layerArn);
            mockService.setEntitledMessage(customMessage);

            const response = await mockService.checkEntitlement(accountId);

            expect(response.message).toBe(customMessage);
        });

        it('should use custom not entitled message', async () => {
            const customMessage = 'Please subscribe via AWS Marketplace';

            mockService.setNotEntitledMessage(customMessage);

            const response = await mockService.checkEntitlement('000000000000');

            expect(response.message).toBe(customMessage);
        });
    });

    describe('service error simulation', () => {
        it('should simulate service unavailability', async () => {
            mockService.setSimulateServiceError(true);

            const response = await mockService.checkEntitlement('123456789012');

            expect(response.entitled).toBe(false);
            expect(response.message).toContain('unreachable');
        });

        it('should use custom error message when simulating errors', async () => {
            const customError = 'Connection refused';

            mockService.setSimulateServiceError(true, customError);

            const response = await mockService.checkEntitlement('123456789012');

            expect(response.entitled).toBe(false);
            expect(response.message).toBe(customError);
        });

        it('should return error even for entitled accounts when simulating errors', async () => {
            const accountId = '123456789012';
            const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';

            mockService.setEntitled(accountId, layerArn);
            mockService.setSimulateServiceError(true);

            const response = await mockService.checkEntitlement(accountId);

            expect(response.entitled).toBe(false);
        });
    });

    describe('utility methods', () => {
        it('should return entitlement count', () => {
            expect(mockService.getEntitlementCount()).toBe(0);

            mockService.setEntitled('123456789012', 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1');
            expect(mockService.getEntitlementCount()).toBe(1);

            mockService.setEntitled('987654321098', 'arn:aws:lambda:us-west-2:999999999999:layer:LambdaKata:2');
            expect(mockService.getEntitlementCount()).toBe(2);
        });

        it('should check entitlement synchronously', () => {
            const accountId = '123456789012';
            const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';

            expect(mockService.isEntitled(accountId)).toBe(false);

            mockService.setEntitled(accountId, layerArn);

            expect(mockService.isEntitled(accountId)).toBe(true);
        });

        it('should get Layer ARN synchronously', () => {
            const accountId = '123456789012';
            const layerArn = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';

            expect(mockService.getLayerArn(accountId)).toBeUndefined();

            mockService.setEntitled(accountId, layerArn);

            expect(mockService.getLayerArn(accountId)).toBe(layerArn);
        });
    });
});

describe('createMockLicensingService', () => {
    it('should create an empty MockLicensingService', async () => {
        const service = createMockLicensingService();

        const response = await service.checkEntitlement('123456789012');

        expect(response.entitled).toBe(false);
    });

    it('should create a MockLicensingService with pre-configured entitlements', async () => {
        const entitlements = {
            '123456789012': 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1',
            '987654321098': 'arn:aws:lambda:us-west-2:999999999999:layer:LambdaKata:2',
        };

        const service = createMockLicensingService(entitlements);

        const response1 = await service.checkEntitlement('123456789012');
        const response2 = await service.checkEntitlement('987654321098');
        const response3 = await service.checkEntitlement('000000000000');

        expect(response1.entitled).toBe(true);
        expect(response1.layerArn).toBe(entitlements['123456789012']);
        expect(response2.entitled).toBe(true);
        expect(response2.layerArn).toBe(entitlements['987654321098']);
        expect(response3.entitled).toBe(false);
    });
});

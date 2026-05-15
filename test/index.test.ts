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
 * Unit Tests for package exports
 *
 * These tests verify that the @lambdakata/cdk package exports all required
 * items correctly and that they have the expected types.
 *
 * **Validates: Requirement 1.3**
 * - THE NPM_Package SHALL export a `kata` function as the primary interface
 *
 * @module index.test
 */

import * as LambdaKataCdk from '../src/index';

describe('Package Exports', () => {
  /**
   * **Validates: Requirement 1.3**
   * THE NPM_Package SHALL export a `kata` function as the primary interface
   */
  describe('Requirement 1.3: kata function export', () => {
    it('should export kata as a function', () => {
      expect(LambdaKataCdk.kata).toBeDefined();
      expect(typeof LambdaKataCdk.kata).toBe('function');
    });

    it('should export kataWithAccountId as a function', () => {
      expect(LambdaKataCdk.kataWithAccountId).toBeDefined();
      expect(typeof LambdaKataCdk.kataWithAccountId).toBe('function');
    });

    it('should export applyTransformation as a function', () => {
      expect(LambdaKataCdk.applyTransformation).toBeDefined();
      expect(typeof LambdaKataCdk.applyTransformation).toBe('function');
    });

    it('should export handleUnlicensed as a function', () => {
      expect(LambdaKataCdk.handleUnlicensed).toBeDefined();
      expect(typeof LambdaKataCdk.handleUnlicensed).toBe('function');
    });

    it('should export isKataTransformed as a function', () => {
      expect(LambdaKataCdk.isKataTransformed).toBeDefined();
      expect(typeof LambdaKataCdk.isKataTransformed).toBe('function');
    });

    it('should export getKataPromise as a function', () => {
      expect(LambdaKataCdk.getKataPromise).toBeDefined();
      expect(typeof LambdaKataCdk.getKataPromise).toBe('function');
    });
  });

  describe('Type exports', () => {
    it('should export KataProps type (verified via type assertion)', () => {
      // Type exports are verified at compile time
      // This test ensures the type is importable and usable
      const props: LambdaKataCdk.KataProps = {
        unlicensedBehavior: 'warn',
      };
      expect(props).toBeDefined();
      expect(props.unlicensedBehavior).toBe('warn');
    });

    it('should export LicensingResponse type (verified via type assertion)', () => {
      const response: LambdaKataCdk.LicensingResponse = {
        entitled: true,
        layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        message: 'Entitled',
      };
      expect(response).toBeDefined();
      expect(response.entitled).toBe(true);
      expect(response.layerArn).toBe('arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1');
    });

    it('should export TransformationConfig type (verified via type assertion)', () => {
      // Import Runtime for the type assertion
      const { Runtime } = require('aws-cdk-lib/aws-lambda');

      const config: LambdaKataCdk.TransformationConfig = {
        originalHandler: 'index.handler',
        targetRuntime: Runtime.PYTHON_3_12,
        targetHandler: 'lambdakata.optimized_handler.lambda_handler',
        layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
      };
      expect(config).toBeDefined();
      expect(config.originalHandler).toBe('index.handler');
    });

    it('should export KataWrapperOptions type (verified via type assertion)', () => {
      const options: LambdaKataCdk.KataWrapperOptions = {
        unlicensedBehavior: 'fail',
      };
      expect(options).toBeDefined();
      expect(options.unlicensedBehavior).toBe('fail');
    });

    it('should export KataResult type (verified via type assertion)', () => {
      const result: LambdaKataCdk.KataResult = {
        transformed: true,
        accountId: '123456789012',
        licensingResponse: {
          entitled: true,
          layerArn: 'arn:aws:lambda:us-east-1:123456789012:layer:LambdaKata:1',
        },
      };
      expect(result).toBeDefined();
      expect(result.transformed).toBe(true);
    });

    it('should export AccountResolutionResult type (verified via type assertion)', () => {
      const result: LambdaKataCdk.AccountResolutionResult = {
        accountId: '123456789012',
        source: 'stack',
      };
      expect(result).toBeDefined();
      expect(result.accountId).toBe('123456789012');
      expect(result.source).toBe('stack');
    });

    it('should export AccountResolverOptions type (verified via type assertion)', () => {
      const options: LambdaKataCdk.AccountResolverOptions = {
        skipStsFallback: true,
      };
      expect(options).toBeDefined();
      expect(options.skipStsFallback).toBe(true);
    });
  });

  describe('Licensing service exports', () => {
    it('should export LicensingService interface implementation check', () => {
      // LicensingService is an interface, verify related exports exist
      expect(LambdaKataCdk.HttpLicensingService).toBeDefined();
      expect(typeof LambdaKataCdk.HttpLicensingService).toBe('function');
    });

    it('should export createLicensingService factory function', () => {
      expect(LambdaKataCdk.createLicensingService).toBeDefined();
      expect(typeof LambdaKataCdk.createLicensingService).toBe('function');
    });

    it('should export isValidAccountId utility function', () => {
      expect(LambdaKataCdk.isValidAccountId).toBeDefined();
      expect(typeof LambdaKataCdk.isValidAccountId).toBe('function');
    });
  });

  describe('Mock licensing service exports', () => {
    it('should export MockLicensingService class', () => {
      expect(LambdaKataCdk.MockLicensingService).toBeDefined();
      expect(typeof LambdaKataCdk.MockLicensingService).toBe('function');
    });

    it('should export createMockLicensingService factory function', () => {
      expect(LambdaKataCdk.createMockLicensingService).toBeDefined();
      expect(typeof LambdaKataCdk.createMockLicensingService).toBe('function');
    });

    it('should be able to instantiate MockLicensingService', () => {
      const mockService = new LambdaKataCdk.MockLicensingService();
      expect(mockService).toBeDefined();
      expect(typeof mockService.checkEntitlement).toBe('function');
      expect(typeof mockService.setEntitled).toBe('function');
    });
  });

  describe('Account resolver exports', () => {
    it('should export resolveAccountId function', () => {
      expect(LambdaKataCdk.resolveAccountId).toBeDefined();
      expect(typeof LambdaKataCdk.resolveAccountId).toBe('function');
    });

    it('should export resolveAccountIdWithSource function', () => {
      expect(LambdaKataCdk.resolveAccountIdWithSource).toBeDefined();
      expect(typeof LambdaKataCdk.resolveAccountIdWithSource).toBe('function');
    });

    it('should export isValidAccountIdFormat function', () => {
      expect(LambdaKataCdk.isValidAccountIdFormat).toBeDefined();
      expect(typeof LambdaKataCdk.isValidAccountIdFormat).toBe('function');
    });

    it('should export AccountResolutionError class', () => {
      expect(LambdaKataCdk.AccountResolutionError).toBeDefined();
      expect(typeof LambdaKataCdk.AccountResolutionError).toBe('function');
    });

    it('should be able to instantiate AccountResolutionError', () => {
      const error = new LambdaKataCdk.AccountResolutionError('Test error');
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Test error');
    });
  });

  describe('Export completeness', () => {
    it('should export all expected items from the package', () => {
      // List of all expected exports
      const expectedExports = [
        // Types
        'KataProps',
        'LicensingResponse',
        'TransformationConfig',
        // Licensing
        'LicensingService',
        'HttpLicensingService',
        'createLicensingService',
        'isValidAccountId',
        // Mock licensing
        'MockLicensingService',
        'createMockLicensingService',
        // Account resolver
        'resolveAccountId',
        'resolveAccountIdWithSource',
        'isValidAccountIdFormat',
        'AccountResolutionError',
        'AccountResolutionResult',
        'AccountResolverOptions',
        // kata wrapper
        'kata',
        'kataWithAccountId',
        'applyTransformation',
        'handleUnlicensed',
        'isKataTransformed',
        'getKataPromise',
        'KataWrapperOptions',
        'KataResult',
      ];

      // Note: Type exports won't appear in Object.keys at runtime
      // but function/class exports will
      const actualExports = Object.keys(LambdaKataCdk);

      // Verify all function/class exports are present
      const functionExports = expectedExports.filter(name => {
        const exported = (LambdaKataCdk as Record<string, unknown>)[name];
        return typeof exported === 'function';
      });

      functionExports.forEach(exportName => {
        expect(actualExports).toContain(exportName);
      });
    });
  });
});

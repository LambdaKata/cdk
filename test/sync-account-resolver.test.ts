/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit Tests for sync-account-resolver module
 *
 * Tests the synchronous account ID resolution implementation.
 */

import { App, Stack } from 'aws-cdk-lib';
import {
  resolveAccountIdSync,
  resolveAccountIdSyncWithSource,
  resolveRegionSync,
  SyncAccountResolutionError,
} from '../src/sync-account-resolver';

describe('SyncAccountResolver', () => {
  describe('resolveAccountIdSync', () => {
    it('should resolve account ID from CDK context', () => {
      const app = new App({
        context: {
          'aws:cdk:account': '123456789012',
        },
      });
      const stack = new Stack(app, 'TestStack');

      const accountId = resolveAccountIdSync(stack);

      expect(accountId).toBe('123456789012');
    });

    it('should resolve account ID from Stack env', () => {
      const app = new App();
      const stack = new Stack(app, 'TestStack', {
        env: {
          account: '987654321098',
          region: 'us-east-1',
        },
      });

      const accountId = resolveAccountIdSync(stack);

      expect(accountId).toBe('987654321098');
    });

    it('should prefer context over stack env', () => {
      const app = new App({
        context: {
          'aws:cdk:account': '111111111111',
        },
      });
      const stack = new Stack(app, 'TestStack', {
        env: {
          account: '222222222222',
          region: 'us-east-1',
        },
      });

      const accountId = resolveAccountIdSync(stack);

      expect(accountId).toBe('111111111111');
    });

    it('should throw SyncAccountResolutionError when account cannot be resolved', () => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');

      // Skip STS fallback to force error
      expect(() => {
        resolveAccountIdSync(stack, { skipStsFallback: true });
      }).toThrow(SyncAccountResolutionError);
    });
  });

  describe('resolveAccountIdSyncWithSource', () => {
    it('should return source as "context" when resolved from context', () => {
      const app = new App({
        context: {
          'aws:cdk:account': '123456789012',
        },
      });
      const stack = new Stack(app, 'TestStack');

      const result = resolveAccountIdSyncWithSource(stack);

      expect(result.accountId).toBe('123456789012');
      expect(result.source).toBe('context');
    });

    it('should return source as "stack" when resolved from stack env', () => {
      const app = new App();
      const stack = new Stack(app, 'TestStack', {
        env: {
          account: '987654321098',
          region: 'us-east-1',
        },
      });

      const result = resolveAccountIdSyncWithSource(stack);

      expect(result.accountId).toBe('987654321098');
      expect(result.source).toBe('stack');
    });
  });

  describe('resolveRegionSync', () => {
    it('should resolve region from Stack env', () => {
      const app = new App();
      const stack = new Stack(app, 'TestStack', {
        env: {
          account: '123456789012',
          region: 'eu-west-1',
        },
      });

      const region = resolveRegionSync(stack);

      expect(region).toBe('eu-west-1');
    });

    it('should resolve region from CDK context', () => {
      const app = new App({
        context: {
          'aws:cdk:region': 'ap-southeast-1',
        },
      });
      const stack = new Stack(app, 'TestStack');

      const region = resolveRegionSync(stack);

      expect(region).toBe('ap-southeast-1');
    });

    it('should return default region when not specified', () => {
      const app = new App();
      const stack = new Stack(app, 'TestStack');

      // Clear environment variables for this test
      const originalRegion = process.env.AWS_REGION;
      const originalDefaultRegion = process.env.AWS_DEFAULT_REGION;
      const originalCdkRegion = process.env.CDK_DEFAULT_REGION;

      delete process.env.AWS_REGION;
      delete process.env.AWS_DEFAULT_REGION;
      delete process.env.CDK_DEFAULT_REGION;

      try {
        const region = resolveRegionSync(stack);
        // Should return default 'us-east-1' or whatever is configured
        expect(typeof region).toBe('string');
        expect(region.length).toBeGreaterThan(0);
      } finally {
        // Restore environment variables
        if (originalRegion) process.env.AWS_REGION = originalRegion;
        if (originalDefaultRegion) process.env.AWS_DEFAULT_REGION = originalDefaultRegion;
        if (originalCdkRegion) process.env.CDK_DEFAULT_REGION = originalCdkRegion;
      }
    });
  });
});

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
 * Basic test to verify the test infrastructure is working
 */

describe('CDK Integration Setup', () => {
    it('should have jest configured correctly', () => {
        expect(true).toBe(true);
    });

    it('should have fast-check available for property-based testing', () => {
        const fc = require('fast-check');
        expect(fc).toBeDefined();
        expect(typeof fc.assert).toBe('function');
        expect(typeof fc.property).toBe('function');
    });

    it('should have aws-cdk-lib available', () => {
        const cdk = require('aws-cdk-lib');
        expect(cdk).toBeDefined();
        expect(cdk.Stack).toBeDefined();
    });

    it('should have constructs available', () => {
        const constructs = require('constructs');
        expect(constructs).toBeDefined();
        expect(constructs.Construct).toBeDefined();
    });
});

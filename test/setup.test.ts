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

/**
 * Simple test to verify Jest and fast-check work together
 */

import * as fc from 'fast-check';

describe('Simple Concurrent Test', () => {
    it('should run a basic property test', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 10 }),
                async (num) => {
                    expect(num).toBeGreaterThan(0);
                    expect(num).toBeLessThanOrEqual(10);
                }
            ),
            { numRuns: 5, timeout: 1000 }
        );
    });

    it('should handle concurrent promises', async () => {
        const mockFn = jest.fn().mockResolvedValue('success');

        const promises = Array.from({ length: 3 }, () => mockFn());
        const results = await Promise.all(promises);

        expect(results).toEqual(['success', 'success', 'success']);
        expect(mockFn).toHaveBeenCalledTimes(3);
    });
});
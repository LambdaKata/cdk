/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 */

import { extractBundlePathFromHandler } from '../src/kata-wrapper';

describe('extractBundlePathFromHandler', () => {
    describe('standard handler formats', () => {
        it('should extract bundle path from simple handler', () => {
            expect(extractBundlePathFromHandler('index.handler')).toBe('/var/task/index.js');
        });

        it('should extract bundle path from handler with path', () => {
            expect(extractBundlePathFromHandler('src/app.handler')).toBe('/var/task/src/app.js');
        });

        it('should extract bundle path from nested path handler', () => {
            expect(extractBundlePathFromHandler('dist/handlers/api.handler')).toBe('/var/task/dist/handlers/api.js');
        });

        it('should extract bundle path from handler with custom function name', () => {
            expect(extractBundlePathFromHandler('index.myCustomHandler')).toBe('/var/task/index.js');
        });

        it('should handle handler with multiple dots in path', () => {
            expect(extractBundlePathFromHandler('src/my.module.handler')).toBe('/var/task/src/my.module.js');
        });
    });

    describe('edge cases', () => {
        it('should return /var/task/index.js for empty string', () => {
            expect(extractBundlePathFromHandler('')).toBe('/var/task/index.js');
        });

        it('should return /var/task/index.js for whitespace-only string', () => {
            expect(extractBundlePathFromHandler('   ')).toBe('/var/task/index.js');
        });

        it('should handle handler without dot (module name only)', () => {
            expect(extractBundlePathFromHandler('bundle')).toBe('/var/task/bundle.js');
        });

        it('should return /var/task/index.js for handler starting with dot', () => {
            expect(extractBundlePathFromHandler('.handler')).toBe('/var/task/index.js');
        });
    });

    describe('real-world examples', () => {
        it('should handle AWS CDK NodejsFunction default handler', () => {
            // NodejsFunction typically uses index.handler
            expect(extractBundlePathFromHandler('index.handler')).toBe('/var/task/index.js');
        });

        it('should handle bundled output handler', () => {
            expect(extractBundlePathFromHandler('bundle.handler')).toBe('/var/task/bundle.js');
        });

        it('should handle TypeScript compiled handler', () => {
            expect(extractBundlePathFromHandler('dist/index.handler')).toBe('/var/task/dist/index.js');
        });

        it('should handle monorepo handler path', () => {
            expect(extractBundlePathFromHandler('packages/api/dist/handler.main')).toBe('/var/task/packages/api/dist/handler.js');
        });
    });
});

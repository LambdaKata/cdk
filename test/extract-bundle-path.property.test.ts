/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 */

import * as fc from 'fast-check';
import { extractBundlePathFromHandler } from '../src/kata-wrapper';

describe('extractBundlePathFromHandler property tests', () => {
  describe('invariants', () => {
    it('should always return a string starting with /var/task/', () => {
      return fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          (handler) => {
            const result = extractBundlePathFromHandler(handler);
            return result.startsWith('/var/task/');
          },
        ),
        { numRuns: 15 },
      );
    });

    it('should always return a string ending with .js', () => {
      return fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          (handler) => {
            const result = extractBundlePathFromHandler(handler);
            return result.endsWith('.js');
          },
        ),
        { numRuns: 15 },
      );
    });

    it('should never return empty string', () => {
      return fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          (handler) => {
            const result = extractBundlePathFromHandler(handler);
            return result.length > 0;
          },
        ),
        { numRuns: 15 },
      );
    });

    it('should return /var/task/index.js for empty or whitespace-only input', () => {
      return fc.assert(
        fc.property(
          fc.stringOf(fc.constant(' ')),
          (whitespace) => {
            const result = extractBundlePathFromHandler(whitespace);
            return result === '/var/task/index.js';
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe('handler format: module.function', () => {
    it('should extract module name from valid handler format', () => {
      return fc.assert(
        fc.property(
          // Generate valid module names (alphanumeric, no dots)
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'), { minLength: 1, maxLength: 20 }),
          // Generate valid function names
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'), { minLength: 1, maxLength: 20 }),
          (moduleName, functionName) => {
            const handler = `${moduleName}.${functionName}`;
            const result = extractBundlePathFromHandler(handler);
            return result === `/var/task/${moduleName}.js`;
          },
        ),
        { numRuns: 15 },
      );
    });

    it('should extract path/module from handler with path', () => {
      return fc.assert(
        fc.property(
          // Generate path segments
          fc.array(
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'), { minLength: 1, maxLength: 10 }),
            { minLength: 1, maxLength: 3 },
          ),
          // Generate function name
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'), { minLength: 1, maxLength: 10 }),
          (pathSegments, functionName) => {
            const modulePath = pathSegments.join('/');
            const handler = `${modulePath}.${functionName}`;
            const result = extractBundlePathFromHandler(handler);
            return result === `/var/task/${modulePath}.js`;
          },
        ),
        { numRuns: 15 },
      );
    });
  });

  describe('idempotence', () => {
    it('should be deterministic - same input always produces same output', () => {
      return fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 100 }),
          (handler) => {
            const result1 = extractBundlePathFromHandler(handler);
            const result2 = extractBundlePathFromHandler(handler);
            return result1 === result2;
          },
        ),
        { numRuns: 15 },
      );
    });
  });
});

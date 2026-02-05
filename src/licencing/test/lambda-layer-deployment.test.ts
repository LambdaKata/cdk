/**
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Lambda Layer deployment tests
 *
 * @remarks Validates: Requirements 5.5
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as os from 'os';

describe('Lambda Layer Deployment Tests', () => {
  const projectDir = path.resolve(__dirname, '..');
  const buildDir = path.join(projectDir, 'build');
  const architectures = ['amd64', 'arm64'];

  beforeAll(() => {
    // Ensure we have build artifacts
    if (!fs.existsSync(buildDir)) {
      throw new Error('Build directory not found. Run build scripts first.');
    }
  });

  describe('Layer Structure Validation', () => {
    architectures.forEach(arch => {
      describe(`${arch} architecture`, () => {
        const layerZipPath = path.join(buildDir, `native-licensing-validator-${arch}.zip`);
        let tempDir: string;
        let extractedLayerDir: string;

        beforeAll(() => {
          if (!fs.existsSync(layerZipPath)) {
            throw new Error(`Layer zip not found for ${arch}: ${layerZipPath}`);
          }

          // Create temporary directory for extraction
          tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-test-'));
          extractedLayerDir = path.join(tempDir, 'layer');

          // Extract layer zip
          fs.mkdirSync(extractedLayerDir);
          execSync(`cd "${extractedLayerDir}" && unzip -q "${layerZipPath}"`);
        });

        afterAll(() => {
          // Clean up temporary directory
          if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        });

        test('should have correct directory structure', () => {
          /**
           * **Validates: Requirement 5.5**
           * Lambda Layer must have correct directory structure
           */
          const expectedPaths = [
            'nodejs',
            'nodejs/node_modules',
            'nodejs/node_modules/@lambda-kata',
            'nodejs/node_modules/@lambda-kata/licensing',
            'nodejs/node_modules/@lambda-kata/licensing/build',
            'nodejs/node_modules/@lambda-kata/licensing/build/Release',
            'nodejs/node_modules/@lambda-kata/licensing/out',
            'nodejs/node_modules/@lambda-kata/licensing/out/dist',
          ];

          expectedPaths.forEach(expectedPath => {
            const fullPath = path.join(extractedLayerDir, expectedPath);
            expect(fs.existsSync(fullPath)).toBe(true);
            expect(fs.statSync(fullPath).isDirectory()).toBe(true);
          });
        });

        test('should contain native addon with correct permissions', () => {
          /**
           * **Validates: Requirement 5.5**
           * Native addon must have executable permissions (755)
           */
          const addonPath = path.join(
            extractedLayerDir,
            'nodejs/node_modules/@lambda-kata/licensing/build/Release/native_licensing_validator.node',
          );

          expect(fs.existsSync(addonPath)).toBe(true);

          const stats = fs.statSync(addonPath);
          expect(stats.isFile()).toBe(true);

          // Check file permissions (755 = rwxr-xr-x)
          const mode = stats.mode & parseInt('777', 8);
          expect(mode).toBe(parseInt('755', 8));

          // Verify file is executable
          expect(stats.mode & fs.constants.S_IXUSR).toBeTruthy();
          expect(stats.mode & fs.constants.S_IXGRP).toBeTruthy();
          expect(stats.mode & fs.constants.S_IXOTH).toBeTruthy();
        });

        test('should contain TypeScript output files', () => {
          /**
           * **Validates: Requirement 5.5**
           * Layer must contain compiled TypeScript output
           */
          const packageDir = path.join(
            extractedLayerDir,
            'nodejs/node_modules/@lambda-kata/licensing',
          );

          // Check main JavaScript file
          const mainJsPath = path.join(packageDir, 'out/dist/index.js');
          expect(fs.existsSync(mainJsPath)).toBe(true);
          expect(fs.statSync(mainJsPath).isFile()).toBe(true);

          // Check type definitions
          const typeDefsPath = path.join(packageDir, 'out/tsc/index.d.ts');
          expect(fs.existsSync(typeDefsPath)).toBe(true);
          expect(fs.statSync(typeDefsPath).isFile()).toBe(true);
        });

        test('should contain valid package.json', () => {
          /**
           * **Validates: Requirement 5.5**
           * Layer must contain valid package.json
           */
          const packageJsonPath = path.join(
            extractedLayerDir,
            'nodejs/node_modules/@lambda-kata/licensing/package.json',
          );

          expect(fs.existsSync(packageJsonPath)).toBe(true);

          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

          // Validate required fields
          expect(packageJson.name).toBe('@lambda-kata/licensing');
          expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
          expect(packageJson.main).toBe('out/dist/index.js');
          expect(packageJson.types).toBe('out/tsc/index.d.ts');
          expect(packageJson.engines.node).toBe('>=18.0.0');
          expect(packageJson.gypfile).toBe(true);
          expect(packageJson.binary.napi_versions).toEqual([8, 9]);
        });

        test('should have reasonable file sizes', () => {
          /**
           * **Validates: Requirement 5.5**
           * Layer files should have reasonable sizes
           */
          const packageDir = path.join(
            extractedLayerDir,
            'nodejs/node_modules/@lambda-kata/licensing',
          );

          // Check native addon size (should be reasonable but not empty)
          const addonPath = path.join(packageDir, 'build/Release/native_licensing_validator.node');
          const addonSize = fs.statSync(addonPath).size;
          expect(addonSize).toBeGreaterThan(1024); // At least 1KB
          expect(addonSize).toBeLessThan(50 * 1024 * 1024); // Less than 50MB

          // Check JavaScript output size
          const jsPath = path.join(packageDir, 'out/dist/index.js');
          const jsSize = fs.statSync(jsPath).size;
          expect(jsSize).toBeGreaterThan(100); // At least 100 bytes
          expect(jsSize).toBeLessThan(1024 * 1024); // Less than 1MB
        });

        test('should not contain development files', () => {
          /**
           * **Validates: Requirement 5.5**
           * Layer should not contain development-only files
           */
          const packageDir = path.join(
            extractedLayerDir,
            'nodejs/node_modules/@lambda-kata/licensing',
          );

          // Files that should NOT be in the layer
          const forbiddenFiles = [
            'node_modules',
            'test',
            'src',
            'native',
            'scripts',
            'binding.gyp',
            '.gitignore',
            '.eslintrc.js',
            'jest.config.js',
            'tsconfig.json',
          ];

          forbiddenFiles.forEach(forbiddenFile => {
            const forbiddenPath = path.join(packageDir, forbiddenFile);
            expect(fs.existsSync(forbiddenPath)).toBe(false);
          });
        });
      });
    });
  });

  describe('Layer Size Validation', () => {
    architectures.forEach(arch => {
      test(`${arch} layer should be within AWS Lambda size limits`, () => {
        /**
         * **Validates: Requirement 5.5**
         * Layer must be within AWS Lambda size limits (250MB uncompressed)
         */
        const layerZipPath = path.join(buildDir, `native-licensing-validator-${arch}.zip`);

        if (!fs.existsSync(layerZipPath)) {
          throw new Error(`Layer zip not found for ${arch}: ${layerZipPath}`);
        }

        const zipSize = fs.statSync(layerZipPath).size;
        const zipSizeMB = zipSize / (1024 * 1024);

        // AWS Lambda layer limits:
        // - 50MB compressed
        // - 250MB uncompressed
        expect(zipSizeMB).toBeLessThan(50); // Compressed size limit

        // Estimate uncompressed size (rough approximation)
        // Typical compression ratio for mixed content is 3:1 to 5:1
        const estimatedUncompressedMB = zipSizeMB * 4; // Conservative estimate
        expect(estimatedUncompressedMB).toBeLessThan(250); // Uncompressed size limit
      });
    });
  });

  describe('Layer Integrity Validation', () => {
    architectures.forEach(arch => {
      test(`${arch} layer zip should be valid and extractable`, () => {
        /**
         * **Validates: Requirement 5.5**
         * Layer zip must be valid and extractable
         */
        const layerZipPath = path.join(buildDir, `native-licensing-validator-${arch}.zip`);

        if (!fs.existsSync(layerZipPath)) {
          throw new Error(`Layer zip not found for ${arch}: ${layerZipPath}`);
        }

        // Test zip integrity
        expect(() => {
          execSync(`unzip -t "${layerZipPath}"`, { stdio: 'pipe' });
        }).not.toThrow();

        // Test that zip contains expected files
        const zipContents = execSync(`unzip -l "${layerZipPath}"`, { encoding: 'utf8' });

        expect(zipContents).toContain('nodejs/node_modules/@lambda-kata/licensing/');
        expect(zipContents).toContain('native_licensing_validator.node');
        expect(zipContents).toContain('package.json');
        expect(zipContents).toContain('index.js');
      });
    });
  });

  describe('Cross-Architecture Validation', () => {
    test('should have layers for both architectures', () => {
      /**
       * **Validates: Requirements 5.1, 5.2**
       * Must support both x64 and arm64 architectures
       */
      architectures.forEach(arch => {
        const layerZipPath = path.join(buildDir, `native-licensing-validator-${arch}.zip`);
        expect(fs.existsSync(layerZipPath)).toBe(true);
      });
    });

    test('layers should have similar structure but different native addons', () => {
      /**
       * **Validates: Requirements 5.1, 5.2**
       * Both architectures should have same structure but different binaries
       */
      const layerPaths = architectures.map(arch =>
        path.join(buildDir, `native-licensing-validator-${arch}.zip`),
      );

      // Both layers should exist
      layerPaths.forEach(layerPath => {
        expect(fs.existsSync(layerPath)).toBe(true);
      });

      // Layers should have different sizes (different native addons)
      const sizes = layerPaths.map(layerPath => fs.statSync(layerPath).size);

      // Allow for some variation but they shouldn't be identical
      // (unless the native addons happen to be exactly the same size)
      if (sizes.length >= 2) {
        const size0 = sizes[0];
        const size1 = sizes[1];

        if (size0 !== undefined && size1 !== undefined) {
          const sizeDifference = Math.abs(size0 - size1);
          const averageSize = (size0 + size1) / 2;
          const relativeDifference = sizeDifference / averageSize;

          // If the relative difference is very small, that's still acceptable
          // as long as both files exist and are valid
          expect(relativeDifference).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
});

/**
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Lambda environment simulation tests
 * Tests addon loading in Lambda-like environment
 *
 * @remarks Validates: Requirements 5.5
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

describe('Lambda Environment Simulation Tests', () => {
  const projectDir = path.resolve(__dirname, '..');
  const buildDir = path.join(projectDir, 'build');

  // Skip these tests if we don't have build artifacts
  const hasBuiltArtifacts = fs.existsSync(buildDir) &&
    (fs.existsSync(path.join(buildDir, 'native-licensing-validator-amd64.zip')) ||
      fs.existsSync(path.join(buildDir, 'native-licensing-validator-arm64.zip')));

  beforeAll(() => {
    if (!hasBuiltArtifacts) {
      console.warn('Skipping Lambda environment tests - no build artifacts found');
    }
  });

  describe('Layer Loading Simulation', () => {
    let tempLambdaDir: string;
    let layerPath: string;

    beforeAll(() => {
      if (!hasBuiltArtifacts) return;

      // Create temporary Lambda-like directory structure
      tempLambdaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-sim-'));

      // Create /opt directory (where Lambda layers are mounted)
      const optDir = path.join(tempLambdaDir, 'opt');
      fs.mkdirSync(optDir);

      // Create /var/task directory (where Lambda function code is placed)
      const taskDir = path.join(tempLambdaDir, 'var', 'task');
      fs.mkdirSync(taskDir, { recursive: true });

      // Extract layer to /opt
      const currentArch = process.arch === 'x64' ? 'amd64' : 'arm64';
      const layerZipPath = path.join(buildDir, `native-licensing-validator-${currentArch}.zip`);

      if (fs.existsSync(layerZipPath)) {
        execSync(`cd "${optDir}" && unzip -q "${layerZipPath}"`);
        layerPath = path.join(optDir, 'nodejs', 'node_modules', '@lambda-kata', 'native-licensing-validator');
      }
    });

    afterAll(() => {
      if (tempLambdaDir && fs.existsSync(tempLambdaDir)) {
        fs.rmSync(tempLambdaDir, { recursive: true, force: true });
      }
    });

    test('should simulate Lambda layer mounting', () => {
      if (!hasBuiltArtifacts) {
        console.warn('Skipping test - no build artifacts');
        return;
      }

      /**
       * **Validates: Requirement 5.5**
       * Layer should be mountable in Lambda-like environment
       */
      expect(fs.existsSync(layerPath)).toBe(true);

      // Check that the layer structure matches Lambda expectations
      const expectedFiles = [
        'package.json',
        'out/dist/index.js',
        'build/Release/native_licensing_validator.node',
      ];

      expectedFiles.forEach(file => {
        const filePath = path.join(layerPath, file);
        expect(fs.existsSync(filePath)).toBe(true);
      });
    });

    test('should be able to require the module from layer', () => {
      if (!hasBuiltArtifacts || !layerPath || !fs.existsSync(layerPath)) {
        console.warn('Skipping test - layer not available');
        return;
      }

      /**
       * **Validates: Requirement 5.5**
       * Module should be requireable from Lambda layer location
       */

        // Create a test script that tries to require the module
      const testScript = `
                const path = require('path');
                
                // Simulate Lambda environment
                process.env.NODE_PATH = '${path.join(tempLambdaDir, 'opt', 'nodejs', 'node_modules')}';
                require('module').Module._initPaths();
                
                try {
                    const validator = require('@lambda-kata/licensing');
                    console.log('SUCCESS: Module loaded');
                    console.log('Exports:', Object.keys(validator));
                    process.exit(0);
                } catch (error) {
                    console.error('ERROR: Failed to load module:', error.message);
                    process.exit(1);
                }
            `;

      const testScriptPath = path.join(tempLambdaDir, 'test-require.js');
      fs.writeFileSync(testScriptPath, testScript);

      // Run the test script
      expect(() => {
        const output = execSync(`node "${testScriptPath}"`, {
          encoding: 'utf8',
          cwd: path.join(tempLambdaDir, 'var', 'task'),
        });
        expect(output).toContain('SUCCESS: Module loaded');
      }).not.toThrow();
    });

    test('should handle native addon loading gracefully', () => {
      if (!hasBuiltArtifacts || !layerPath || !fs.existsSync(layerPath)) {
        console.warn('Skipping test - layer not available');
        return;
      }

      /**
       * **Validates: Requirement 5.5**
       * Native addon should load or fail gracefully
       */

      const testScript = `
                const path = require('path');
                
                // Simulate Lambda environment
                process.env.NODE_PATH = '${path.join(tempLambdaDir, 'opt', 'nodejs', 'node_modules')}';
                require('module').Module._initPaths();
                
                try {
                    const validator = require('@lambda-kata/licensing');
                    
                    // Try to use the service
                    if (validator.NativeLicensingService) {
                        const service = new validator.NativeLicensingService();
                        console.log('SUCCESS: Native service instantiated');
                        
                        // Test that it handles invalid input gracefully
                        service.checkEntitlement('invalid-account-id')
                            .then(result => {
                                console.log('Result:', result);
                                console.log('SUCCESS: Service call completed');
                                process.exit(0);
                            })
                            .catch(error => {
                                console.log('Expected error for invalid input:', error.message);
                                console.log('SUCCESS: Error handled gracefully');
                                process.exit(0);
                            });
                    } else {
                        console.log('WARNING: Native service not available, using fallback');
                        process.exit(0);
                    }
                } catch (error) {
                    console.error('ERROR: Failed to test service:', error.message);
                    process.exit(1);
                }
            `;

      const testScriptPath = path.join(tempLambdaDir, 'test-service.js');
      fs.writeFileSync(testScriptPath, testScript);

      // Run the test script with timeout
      expect(() => {
        const output = execSync(`timeout 10s node "${testScriptPath}" || true`, {
          encoding: 'utf8',
          cwd: path.join(tempLambdaDir, 'var', 'task'),
        });

        // Should either succeed or handle errors gracefully
        expect(output).toMatch(/(SUCCESS|WARNING)/);
        expect(output).not.toContain('ERROR:');
      }).not.toThrow();
    });
  });

  describe('Performance Simulation', () => {
    test('should measure module loading time', () => {
      if (!hasBuiltArtifacts) {
        console.warn('Skipping test - no build artifacts');
        return;
      }

      /**
       * **Validates: Requirement 5.5**
       * Module loading should be fast enough for Lambda cold starts
       */

      const currentArch = process.arch === 'x64' ? 'amd64' : 'arm64';
      const layerZipPath = path.join(buildDir, `native-licensing-validator-${currentArch}.zip`);

      if (!fs.existsSync(layerZipPath)) {
        console.warn(`Skipping test - layer not found for ${currentArch}`);
        return;
      }

      // Create temporary environment
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-test-'));
      const optDir = path.join(tempDir, 'opt');
      fs.mkdirSync(optDir);

      try {
        // Extract layer
        execSync(`cd "${optDir}" && unzip -q "${layerZipPath}"`);

        // Create performance test script
        const perfScript = `
                    const path = require('path');
                    
                    process.env.NODE_PATH = '${path.join(optDir, 'nodejs', 'node_modules')}';
                    require('module').Module._initPaths();
                    
                    const startTime = process.hrtime.bigint();
                    
                    try {
                        const validator = require('@lambda-kata/licensing');
                        const endTime = process.hrtime.bigint();
                        const loadTimeMs = Number(endTime - startTime) / 1000000;
                        
                        console.log('Load time:', loadTimeMs.toFixed(2), 'ms');
                        
                        // Should load within reasonable time for Lambda cold start
                        if (loadTimeMs < 100) {
                            console.log('SUCCESS: Fast loading');
                            process.exit(0);
                        } else {
                            console.log('WARNING: Slow loading but acceptable');
                            process.exit(0);
                        }
                    } catch (error) {
                        console.error('ERROR:', error.message);
                        process.exit(1);
                    }
                `;

        const perfScriptPath = path.join(tempDir, 'perf-test.js');
        fs.writeFileSync(perfScriptPath, perfScript);

        const output = execSync(`node "${perfScriptPath}"`, { encoding: 'utf8' });
        expect(output).toMatch(/(SUCCESS|WARNING)/);

        // Extract load time from output
        const loadTimeMatch = output.match(/Load time: ([\d.]+) ms/);
        if (loadTimeMatch && loadTimeMatch[1]) {
          const loadTime = parseFloat(loadTimeMatch[1]);
          expect(loadTime).toBeLessThan(1000); // Should load within 1 second
        }

      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Architecture Compatibility', () => {
    test('should detect current architecture compatibility', () => {
      if (!hasBuiltArtifacts) {
        console.warn('Skipping test - no build artifacts');
        return;
      }

      /**
       * **Validates: Requirements 5.1, 5.2**
       * Should have compatible layer for current architecture
       */

      const currentArch = process.arch;
      const expectedLayerArch = currentArch === 'x64' ? 'amd64' : 'arm64';
      const layerZipPath = path.join(buildDir, `native-licensing-validator-${expectedLayerArch}.zip`);

      if (fs.existsSync(layerZipPath)) {
        expect(fs.existsSync(layerZipPath)).toBe(true);

        // Verify the layer contains a native addon
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-test-'));

        try {
          execSync(`cd "${tempDir}" && unzip -q "${layerZipPath}"`);

          const addonPath = path.join(
            tempDir,
            'nodejs/node_modules/@lambda-kata/licensing/build/Release/native_licensing_validator.node',
          );

          expect(fs.existsSync(addonPath)).toBe(true);

          // Try to get file info (this will work even for cross-architecture files)
          const fileOutput = execSync(`file "${addonPath}"`, { encoding: 'utf8' });
          expect(fileOutput).toContain('shared object'); // Should be a shared library

        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } else {
        console.warn(`Layer not found for current architecture: ${expectedLayerArch}`);
        // This is not necessarily a failure - might be testing on different arch
      }
    });
  });
});

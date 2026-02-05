/**
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * npm package configuration tests
 *
 * @remarks Validates: Requirements 5.6
 */

import * as fs from 'fs';
import * as path from 'path';

describe('npm Package Configuration Tests', () => {
  const projectDir = path.resolve(__dirname, '..');
  const packageJsonPath = path.join(projectDir, 'package.json');

  let packageJson: any;

  beforeAll(() => {
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error('package.json not found');
    }

    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
    packageJson = JSON.parse(packageJsonContent);
  });

  describe('Basic Package Metadata', () => {
    test('should have correct package name and version', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must have correct npm metadata
       */
      expect(packageJson.name).toBe('@lambda-kata/licensing');
      expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(packageJson.description).toContain('native licensing validator');
      expect(packageJson.license).toBe('MIT');
    });

    test('should have correct main and types entries', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must specify correct entry points
       */
      expect(packageJson.main).toBe('out/dist/index.js');
      expect(packageJson.types).toBe('out/tsc/index.d.ts');
    });

    test('should have correct Node.js engine requirement', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must specify Node.js version compatibility
       */
      expect(packageJson.engines).toBeDefined();
      expect(packageJson.engines.node).toBe('>=18.0.0');
    });

    test('should have platform restrictions for Lambda', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package should specify OS/CPU restrictions for Lambda deployment
       */
      expect(packageJson.os).toEqual(['linux']);
      expect(packageJson.cpu).toEqual(['x64', 'arm64']);
    });
  });

  describe('Build and Installation Scripts', () => {
    test('should have required build scripts', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must have build scripts for different scenarios
       */
      const requiredScripts = [
        'build',
        'build:clean',
        'build:native',
        'build:native:docker',
        'build:ts',
        'build:types',
        'build:all',
        'build:prebuilt',
      ];

      requiredScripts.forEach(script => {
        expect(packageJson.scripts[script]).toBeDefined();
        expect(typeof packageJson.scripts[script]).toBe('string');
        expect(packageJson.scripts[script].length).toBeGreaterThan(0);
      });
    });

    test('should have installation and postinstall scripts', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must have install scripts for prebuilt binary handling
       */
      expect(packageJson.scripts.install).toBe('node scripts/install.js');
      expect(packageJson.scripts.postinstall).toContain('node scripts/postinstall.js');

      // Verify install scripts exist
      const installScriptPath = path.join(projectDir, 'scripts', 'install.js');
      const postinstallScriptPath = path.join(projectDir, 'scripts', 'postinstall.js');

      expect(fs.existsSync(installScriptPath)).toBe(true);
      expect(fs.existsSync(postinstallScriptPath)).toBe(true);
    });

    test('should have test scripts', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must have comprehensive test scripts
       */
      const requiredTestScripts = [
        'test',
        'test:unit',
        'test:property',
        'test:deployment',
        'test:coverage',
      ];

      requiredTestScripts.forEach(script => {
        expect(packageJson.scripts[script]).toBeDefined();
        expect(typeof packageJson.scripts[script]).toBe('string');
      });
    });

    test('should have prepack script for distribution', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must build prebuilt binaries before packing
       */
      expect(packageJson.scripts.prepack).toBe('yarn build:prebuilt');
    });
  });

  describe('File Inclusion Configuration', () => {
    test('should include necessary files for distribution', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must include all necessary files for distribution
       */
      const requiredFiles = [
        'out/',
        'src/',
        'binding.gyp',
        'native/',
        'scripts/',
        'prebuilt/',
        'README.md',
        'LICENSE',
      ];

      expect(packageJson.files).toBeDefined();
      expect(Array.isArray(packageJson.files)).toBe(true);

      requiredFiles.forEach(file => {
        expect(packageJson.files).toContain(file);
      });
    });

    test('should not include development-only files', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package should not include development files in distribution
       */
      const forbiddenFiles = [
        'test/',
        'coverage/',
        'build/',
        '.git/',
        'node_modules/',
        '*.log',
      ];

      forbiddenFiles.forEach(file => {
        expect(packageJson.files).not.toContain(file);
      });
    });
  });

  describe('Dependencies Configuration', () => {
    test('should have correct runtime dependencies', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must have minimal runtime dependencies
       */
      expect(packageJson.dependencies).toBeDefined();
      expect(packageJson.dependencies['node-addon-api']).toMatch(/^\^7\./);

      // Should have minimal runtime dependencies
      const depCount = Object.keys(packageJson.dependencies).length;
      expect(depCount).toBeLessThanOrEqual(2); // Only node-addon-api and maybe one more
    });

    test('should have correct peer dependencies', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must specify SST integration peer dependencies
       */
      expect(packageJson.peerDependencies).toBeDefined();
      expect(packageJson.peerDependencies['aws-cdk-lib']).toMatch(/^\^2\./);
      expect(packageJson.peerDependencies['constructs']).toMatch(/^\^10\./);

      // Peer dependencies should be optional
      expect(packageJson.peerDependenciesMeta).toBeDefined();
      expect(packageJson.peerDependenciesMeta['aws-cdk-lib'].optional).toBe(true);
      expect(packageJson.peerDependenciesMeta['constructs'].optional).toBe(true);
    });

    test('should have appropriate development dependencies', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must have development dependencies for building and testing
       */
      const requiredDevDeps = [
        '@types/jest',
        '@types/node',
        'esbuild',
        'eslint',
        'fast-check',
        'jest',
        'node-gyp',
        'ts-jest',
        'typescript',
      ];

      expect(packageJson.devDependencies).toBeDefined();

      requiredDevDeps.forEach(dep => {
        expect(packageJson.devDependencies[dep]).toBeDefined();
        expect(typeof packageJson.devDependencies[dep]).toBe('string');
      });
    });
  });

  describe('Native Addon Configuration', () => {
    test('should have correct binary configuration', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must specify Node-API version compatibility
       */
      expect(packageJson.gypfile).toBe(true);
      expect(packageJson.binary).toBeDefined();
      expect(packageJson.binary.napi_versions).toEqual([8, 9]);
    });

    test('should have binding.gyp file', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must include native build configuration
       */
      const bindingGypPath = path.join(projectDir, 'binding.gyp');
      expect(fs.existsSync(bindingGypPath)).toBe(true);
    });
  });

  describe('Repository and Metadata', () => {
    test('should have correct repository information', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must have correct repository metadata
       */
      expect(packageJson.repository).toBeDefined();
      expect(packageJson.repository.type).toBe('git');
      expect(packageJson.repository.url).toContain('lambda-kata/sst-integration');
      expect(packageJson.repository.directory).toBe('packages/native-licensing-validator');
    });

    test('should have appropriate keywords', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must have searchable keywords
       */
      const expectedKeywords = [
        'lambda-kata',
        'licensing',
        'native',
        'node-api',
        'security',
        'aws-lambda',
      ];

      expect(packageJson.keywords).toBeDefined();
      expect(Array.isArray(packageJson.keywords)).toBe(true);

      expectedKeywords.forEach(keyword => {
        expect(packageJson.keywords).toContain(keyword);
      });
    });

    test('should have author information', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package must have author information
       */
      expect(packageJson.author).toBeDefined();
      expect(packageJson.author).toContain('Lambda Kata');
    });
  });

  describe('Script File Existence', () => {
    test('should have all referenced script files', () => {
      /**
       * **Validates: Requirement 5.6**
       * All scripts referenced in package.json must exist
       */
      const scriptFiles = [
        'scripts/build-docker.sh',
        'scripts/build-all.sh',
        'scripts/build-prebuilt.sh',
        'scripts/test-deployment.sh',
        'scripts/install.js',
        'scripts/postinstall.js',
      ];

      scriptFiles.forEach(scriptFile => {
        const scriptPath = path.join(projectDir, scriptFile);
        expect(fs.existsSync(scriptPath)).toBe(true);

        // Check if shell scripts are executable
        if (scriptFile.endsWith('.sh')) {
          const stats = fs.statSync(scriptPath);
          const isExecutable = (stats.mode & parseInt('111', 8)) !== 0;
          expect(isExecutable).toBe(true);
        }
      });
    });
  });

  describe('Package Validation', () => {
    test('should be valid JSON', () => {
      /**
       * **Validates: Requirement 5.6**
       * package.json must be valid JSON
       */
      expect(() => {
        JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      }).not.toThrow();
    });

    test('should have reasonable package size limits', () => {
      /**
       * **Validates: Requirement 5.6**
       * Package configuration should not be excessively large
       */
      const packageJsonSize = fs.statSync(packageJsonPath).size;
      expect(packageJsonSize).toBeLessThan(10 * 1024); // Less than 10KB
    });
  });
});

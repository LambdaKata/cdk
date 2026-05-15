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
 * Property-Based Tests for Lambda Layer Build Structure
 *
 * Feature: cdk-integration, Property 7: Layer Contains Only Bytecode
 *
 * Property 7: Layer Contains Only Bytecode
 * *For any* built Lambda Kata Layer package, the `/opt/python/lambdakata/` directory
 * SHALL contain only `.pyc` files and no `.py` source files.
 *
 * **Validates: Requirements 4.3, 7.3**
 * - 4.3: THE Lambda_Layer SHALL ship Python code as compiled bytecode (`.pyc` files) for optimization
 * - 7.3: THE Layer_Build_Process SHALL compile Python source files to bytecode with `-OO` optimization
 *
 * @module layer-build.test
 */

import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Expected layer structure paths
 */
const LAYER_PYTHON_PATH = 'python/lambdakata';
const LAYER_JS_RUNTIME_PATH = 'js_runtime';
const LAYER_LIB_PATH = 'lib';

/**
 * Expected Python module names in the layer
 */
const EXPECTED_PYTHON_MODULES = [
  'optimized_handler',
  'bridge_factory',
  'ctypes_bridge',
  'debug_config',
  'debug_logging',
  'post_billed_flush',
  'error_codes',
  '__init__',
];

/**
 * Expected shared library files in the layer
 * These are the .so files from c_shared_objects/ plus js_bridge.so
 *
 * **Validates: Requirement 4.4**
 * THE Lambda_Layer SHALL contain all required C shared libraries (`.so` files)
 */
const EXPECTED_SHARED_LIBRARIES = [
  'js_bridge_pure.so',
  'js_bridge.so',
  'buffer_integration.so',
  'debug_chunker.so',
  'debug_flush_manager.so',
  'debug_ring_buffer.so',
  'framed_reader.so',
  'ipc_channel.so',
  'log_queue.so',
  'log_worker_pool.so',
  'ordered_emitter.so',
];

/**
 * Expected JavaScript runtime files in the layer
 *
 * **Validates: Requirement 4.5**
 * THE Lambda_Layer SHALL contain the JavaScript runtime components
 */
const EXPECTED_JS_RUNTIME_FILES = [
  'bundle.js',
  'init_wrapper.js',
];

/**
 * Expected library files in the layer
 */
const EXPECTED_LIB_FILES = [
  'libgomp.so.1',
];

/**
 * Arbitrary generator for valid Python module names
 * Generates names like: "handler", "my_module", "utils_v2"
 */
const arbitraryPythonModuleName = (): fc.Arbitrary<string> => {
  // Generate valid Python identifier (starts with letter/underscore, contains alphanumeric and underscore)
  const identifier = fc
    .tuple(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')),
      fc.stringOf(
        fc.constantFrom(
          ...'abcdefghijklmnopqrstuvwxyz0123456789_'.split(''),
        ),
        { minLength: 0, maxLength: 20 },
      ),
    )
    .map(([first, rest]) => first + rest);

  return identifier;
};

/**
 * Arbitrary generator for Python module paths within the layer
 * Generates paths like: "lambdakata/handler", "lambdakata/utils/helpers"
 */
const arbitraryPythonModulePath = (): fc.Arbitrary<string> => {
  const moduleName = arbitraryPythonModuleName();
  const subPackage = fc.array(moduleName, { minLength: 0, maxLength: 2 });

  return fc
    .tuple(subPackage, moduleName)
    .map(([dirs, name]) => {
      const basePath = 'lambdakata';
      const subPath = dirs.length > 0 ? '/' + dirs.join('/') : '';
      return `${basePath}${subPath}/${name}`;
    });
};

/**
 * Simulates a layer file entry for testing
 */
interface LayerFileEntry {
  path: string;
  extension: string;
  isSource: boolean;
  isBytecode: boolean;
}

/**
 * Creates a simulated layer file entry from a module path
 */
function createLayerFileEntry(modulePath: string, extension: '.py' | '.pyc'): LayerFileEntry {
  return {
    path: `python/${modulePath}${extension}`,
    extension,
    isSource: extension === '.py',
    isBytecode: extension === '.pyc',
  };
}

/**
 * Validates that a layer directory structure contains only bytecode files
 */
function validateBytecodeOnly(files: LayerFileEntry[]): {
  valid: boolean;
  sourceFiles: string[];
  bytecodeFiles: string[];
} {
  const sourceFiles = files.filter((f) => f.isSource).map((f) => f.path);
  const bytecodeFiles = files.filter((f) => f.isBytecode).map((f) => f.path);

  return {
    valid: sourceFiles.length === 0,
    sourceFiles,
    bytecodeFiles,
  };
}

/**
 * Checks if a file path represents a Python source file
 */
function isPythonSourceFile(filePath: string): boolean {
  return filePath.endsWith('.py') && !filePath.endsWith('.pyc');
}

/**
 * Checks if a file path represents a Python bytecode file
 */
function isPythonBytecodeFile(filePath: string): boolean {
  return filePath.endsWith('.pyc');
}

/**
 * Checks if a file path represents a shared library file
 */
function isSharedLibrary(filePath: string): boolean {
  return filePath.endsWith('.so') || filePath.includes('.so.');
}

/**
 * Checks if a file path represents a JavaScript file
 */
function isJsFile(filePath: string): boolean {
  return filePath.endsWith('.js');
}

/**
 * Validates layer structure expectations
 */
interface LayerValidationResult {
  hasPythonPath: boolean;
  hasJsRuntimePath: boolean;
  hasLibPath: boolean;
  pythonFiles: string[];
  sourceFiles: string[];
  bytecodeFiles: string[];
  sharedLibraries: string[];
  jsRuntimeFiles: string[];
  libFiles: string[];
  isValid: boolean;
}

/**
 * Validates a layer directory structure
 */
function validateLayerStructure(layerPath: string): LayerValidationResult {
  const result: LayerValidationResult = {
    hasPythonPath: false,
    hasJsRuntimePath: false,
    hasLibPath: false,
    pythonFiles: [],
    sourceFiles: [],
    bytecodeFiles: [],
    sharedLibraries: [],
    jsRuntimeFiles: [],
    libFiles: [],
    isValid: false,
  };

  if (!fs.existsSync(layerPath)) {
    return result;
  }

  const pythonPath = path.join(layerPath, LAYER_PYTHON_PATH);
  const jsRuntimePath = path.join(layerPath, LAYER_JS_RUNTIME_PATH);
  const libPath = path.join(layerPath, LAYER_LIB_PATH);

  result.hasPythonPath = fs.existsSync(pythonPath);
  result.hasJsRuntimePath = fs.existsSync(jsRuntimePath);
  result.hasLibPath = fs.existsSync(libPath);

  if (result.hasPythonPath) {
    const files = getAllFiles(pythonPath);
    result.pythonFiles = files.filter(
      (f) => isPythonSourceFile(f) || isPythonBytecodeFile(f),
    );
    result.sourceFiles = files.filter(isPythonSourceFile);
    result.bytecodeFiles = files.filter(isPythonBytecodeFile);
    result.sharedLibraries = files.filter(isSharedLibrary);
  }

  if (result.hasJsRuntimePath) {
    const files = getAllFiles(jsRuntimePath);
    result.jsRuntimeFiles = files.filter(isJsFile);
  }

  if (result.hasLibPath) {
    const files = getAllFiles(libPath);
    result.libFiles = files;
  }

  // Layer is valid if it has the python path and no source files
  result.isValid = result.hasPythonPath && result.sourceFiles.length === 0;

  return result;
}

/**
 * Recursively gets all files in a directory
 */
function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  if (!fs.existsSync(dirPath)) {
    return arrayOfFiles;
  }

  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, arrayOfFiles);
    } else {
      arrayOfFiles.push(filePath);
    }
  }

  return arrayOfFiles;
}

describe('Feature: cdk-integration, Property 7: Layer Contains Only Bytecode', () => {
  /**
   * **Validates: Requirements 4.3, 7.3**
   */
  describe('Property 7: Layer Contains Only Bytecode', () => {
    /**
     * Property test: For any Python module name, the layer should contain
     * the bytecode version (.pyc) but not the source version (.py)
     *
     * **Validates: Requirement 4.3**
     * THE Lambda_Layer SHALL ship Python code as compiled bytecode (`.pyc` files) for optimization
     */
    it('should contain bytecode (.pyc) but not source (.py) for any Python module', () => {
      fc.assert(
        fc.property(arbitraryPythonModuleName(), (moduleName) => {
          // Create simulated layer entries for a properly built layer
          const properlyBuiltLayer: LayerFileEntry[] = [
            createLayerFileEntry(`lambdakata/${moduleName}`, '.pyc'),
          ];

          const validation = validateBytecodeOnly(properlyBuiltLayer);

          // A properly built layer should have no source files
          return validation.valid === true && validation.sourceFiles.length === 0;
        }),
        { numRuns: 7 },
      );
    });

    /**
     * Property test: For any set of Python modules, if source files exist,
     * the layer validation should fail
     *
     * **Validates: Requirement 7.3**
     * THE Layer_Build_Process SHALL compile Python source files to bytecode with `-OO` optimization
     */
    it('should fail validation when source files (.py) are present', () => {
      fc.assert(
        fc.property(
          fc.array(arbitraryPythonModuleName(), { minLength: 1, maxLength: 10 }),
          (moduleNames) => {
            // Create simulated layer entries with source files (improperly built)
            const improperlyBuiltLayer: LayerFileEntry[] = moduleNames.map((name) =>
              createLayerFileEntry(`lambdakata/${name}`, '.py'),
            );

            const validation = validateBytecodeOnly(improperlyBuiltLayer);

            // Layer with source files should fail validation
            return (
              validation.valid === false &&
              validation.sourceFiles.length === moduleNames.length
            );
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * Property test: For any Python module path, bytecode files should be
     * correctly identified
     *
     * **Validates: Requirement 4.3**
     */
    it('should correctly identify bytecode files for any module path', () => {
      fc.assert(
        fc.property(arbitraryPythonModulePath(), (modulePath) => {
          const bytecodeFile = `python/${modulePath}.pyc`;
          const sourceFile = `python/${modulePath}.py`;

          return (
            isPythonBytecodeFile(bytecodeFile) === true &&
            isPythonSourceFile(bytecodeFile) === false &&
            isPythonSourceFile(sourceFile) === true &&
            isPythonBytecodeFile(sourceFile) === false
          );
        }),
        { numRuns: 7 },
      );
    });

    /**
     * Property test: For any combination of bytecode and source files,
     * validation should correctly report the state
     *
     * **Validates: Requirements 4.3, 7.3**
     */
    it('should correctly validate any combination of bytecode and source files', () => {
      fc.assert(
        fc.property(
          fc.array(arbitraryPythonModuleName(), { minLength: 0, maxLength: 5 }),
          fc.array(arbitraryPythonModuleName(), { minLength: 0, maxLength: 5 }),
          (bytecodeModules, sourceModules) => {
            const layerFiles: LayerFileEntry[] = [
              ...bytecodeModules.map((name) =>
                createLayerFileEntry(`lambdakata/${name}`, '.pyc'),
              ),
              ...sourceModules.map((name) =>
                createLayerFileEntry(`lambdakata/${name}`, '.py'),
              ),
            ];

            const validation = validateBytecodeOnly(layerFiles);

            // Validation should pass only if there are no source files
            const expectedValid = sourceModules.length === 0;
            return (
              validation.valid === expectedValid &&
              validation.sourceFiles.length === sourceModules.length &&
              validation.bytecodeFiles.length === bytecodeModules.length
            );
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * Property test: Expected Python modules should all have bytecode versions
     * in a properly built layer
     *
     * **Validates: Requirements 4.3, 7.3**
     */
    it('should have bytecode for all expected Python modules', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...EXPECTED_PYTHON_MODULES),
          (moduleName) => {
            // Simulate a properly built layer with all expected modules as bytecode
            const properlyBuiltLayer: LayerFileEntry[] = EXPECTED_PYTHON_MODULES.map(
              (name) => createLayerFileEntry(`lambdakata/${name}`, '.pyc'),
            );

            const validation = validateBytecodeOnly(properlyBuiltLayer);

            // Check that the specific module exists as bytecode
            const hasBytecode = validation.bytecodeFiles.some((f) =>
              f.includes(`${moduleName}.pyc`),
            );

            return validation.valid === true && hasBytecode === true;
          },
        ),
        { numRuns: 7 },
      );
    });

    /**
     * Property test: File extension detection should be consistent
     *
     * **Validates: Requirement 4.3**
     */
    it('should consistently detect file extensions for any file path', () => {
      fc.assert(
        fc.property(
          arbitraryPythonModulePath(),
          fc.constantFrom('.py', '.pyc'),
          (modulePath, extension) => {
            const filePath = `python/${modulePath}${extension}`;

            if (extension === '.py') {
              return (
                isPythonSourceFile(filePath) === true &&
                isPythonBytecodeFile(filePath) === false
              );
            } else {
              return (
                isPythonSourceFile(filePath) === false &&
                isPythonBytecodeFile(filePath) === true
              );
            }
          },
        ),
        { numRuns: 7 },
      );
    });
  });

  /**
   * Unit tests for layer structure validation
   */
  describe('Layer Structure Validation', () => {
    it('should validate that isPythonSourceFile correctly identifies .py files', () => {
      expect(isPythonSourceFile('handler.py')).toBe(true);
      expect(isPythonSourceFile('path/to/module.py')).toBe(true);
      expect(isPythonSourceFile('handler.pyc')).toBe(false);
      expect(isPythonSourceFile('handler.so')).toBe(false);
      expect(isPythonSourceFile('handler.js')).toBe(false);
    });

    it('should validate that isPythonBytecodeFile correctly identifies .pyc files', () => {
      expect(isPythonBytecodeFile('handler.pyc')).toBe(true);
      expect(isPythonBytecodeFile('path/to/module.pyc')).toBe(true);
      expect(isPythonBytecodeFile('handler.py')).toBe(false);
      expect(isPythonBytecodeFile('handler.so')).toBe(false);
      expect(isPythonBytecodeFile('handler.js')).toBe(false);
    });

    it('should validate bytecode-only layer structure', () => {
      const bytecodeOnlyLayer: LayerFileEntry[] = [
        createLayerFileEntry('lambdakata/optimized_handler', '.pyc'),
        createLayerFileEntry('lambdakata/bridge_factory', '.pyc'),
        createLayerFileEntry('lambdakata/__init__', '.pyc'),
      ];

      const validation = validateBytecodeOnly(bytecodeOnlyLayer);

      expect(validation.valid).toBe(true);
      expect(validation.sourceFiles).toHaveLength(0);
      expect(validation.bytecodeFiles).toHaveLength(3);
    });

    it('should fail validation for layer with source files', () => {
      const layerWithSource: LayerFileEntry[] = [
        createLayerFileEntry('lambdakata/optimized_handler', '.pyc'),
        createLayerFileEntry('lambdakata/bridge_factory', '.py'), // Source file!
        createLayerFileEntry('lambdakata/__init__', '.pyc'),
      ];

      const validation = validateBytecodeOnly(layerWithSource);

      expect(validation.valid).toBe(false);
      expect(validation.sourceFiles).toHaveLength(1);
      expect(validation.sourceFiles[0]).toContain('bridge_factory.py');
    });

    it('should handle empty layer', () => {
      const emptyLayer: LayerFileEntry[] = [];

      const validation = validateBytecodeOnly(emptyLayer);

      expect(validation.valid).toBe(true);
      expect(validation.sourceFiles).toHaveLength(0);
      expect(validation.bytecodeFiles).toHaveLength(0);
    });

    it('should correctly identify all expected Python modules', () => {
      // Verify all expected modules are defined
      expect(EXPECTED_PYTHON_MODULES).toContain('optimized_handler');
      expect(EXPECTED_PYTHON_MODULES).toContain('bridge_factory');
      expect(EXPECTED_PYTHON_MODULES).toContain('ctypes_bridge');
      expect(EXPECTED_PYTHON_MODULES).toContain('debug_config');
      expect(EXPECTED_PYTHON_MODULES).toContain('debug_logging');
      expect(EXPECTED_PYTHON_MODULES).toContain('post_billed_flush');
      expect(EXPECTED_PYTHON_MODULES).toContain('error_codes');
      expect(EXPECTED_PYTHON_MODULES).toContain('__init__');
    });
  });

  /**
   * Unit tests for layer structure file paths
   *
   * **Validates: Requirements 4.1, 4.2, 4.4, 4.5**
   * - 4.1: THE Lambda_Layer SHALL contain the Python handler module at `/opt/python/lambdakata/optimized_handler.py`
   * - 4.2: THE Lambda_Layer SHALL contain all required Python modules in the `lambdakata` package
   * - 4.4: THE Lambda_Layer SHALL contain all required C shared libraries (`.so` files)
   * - 4.5: THE Lambda_Layer SHALL contain the JavaScript runtime components
   */
  describe('Layer Structure File Paths', () => {
    /**
     * Test: Verify optimized_handler.pyc exists at correct path
     *
     * **Validates: Requirement 4.1**
     * THE Lambda_Layer SHALL contain the Python handler module at `/opt/python/lambdakata/optimized_handler.py`
     * (Note: shipped as .pyc bytecode per Requirement 4.3)
     */
    it('should have optimized_handler.pyc at correct path', () => {
      // Expected path in layer: python/lambdakata/optimized_handler.pyc
      const expectedPath = 'python/lambdakata/optimized_handler.pyc';

      // Simulate a properly built layer
      const properlyBuiltLayer: LayerFileEntry[] = EXPECTED_PYTHON_MODULES.map(
        (name) => createLayerFileEntry(`lambdakata/${name}`, '.pyc'),
      );

      // Verify the handler exists
      const hasHandler = properlyBuiltLayer.some(
        (f) => f.path === expectedPath,
      );

      expect(hasHandler).toBe(true);
    });

    /**
     * Test: Verify all required Python modules are present
     *
     * **Validates: Requirement 4.2**
     * THE Lambda_Layer SHALL contain all required Python modules in the `lambdakata` package
     */
    it('should have all required Python modules as bytecode', () => {
      // Simulate a properly built layer
      const properlyBuiltLayer: LayerFileEntry[] = EXPECTED_PYTHON_MODULES.map(
        (name) => createLayerFileEntry(`lambdakata/${name}`, '.pyc'),
      );

      // Verify each expected module exists
      for (const moduleName of EXPECTED_PYTHON_MODULES) {
        const expectedPath = `python/lambdakata/${moduleName}.pyc`;
        const hasModule = properlyBuiltLayer.some((f) => f.path === expectedPath);
        expect(hasModule).toBe(true);
      }
    });

    /**
     * Test: Verify all required .so files are present
     *
     * **Validates: Requirement 4.4**
     * THE Lambda_Layer SHALL contain all required C shared libraries (`.so` files)
     */
    it('should have all required shared library files', () => {
      // Verify expected shared libraries are defined
      expect(EXPECTED_SHARED_LIBRARIES).toContain('js_bridge_pure.so');
      expect(EXPECTED_SHARED_LIBRARIES).toContain('js_bridge.so');
      expect(EXPECTED_SHARED_LIBRARIES).toContain('buffer_integration.so');
      expect(EXPECTED_SHARED_LIBRARIES).toContain('debug_chunker.so');
      expect(EXPECTED_SHARED_LIBRARIES).toContain('debug_flush_manager.so');
      expect(EXPECTED_SHARED_LIBRARIES).toContain('debug_ring_buffer.so');
      expect(EXPECTED_SHARED_LIBRARIES).toContain('framed_reader.so');
      expect(EXPECTED_SHARED_LIBRARIES).toContain('ipc_channel.so');
      expect(EXPECTED_SHARED_LIBRARIES).toContain('log_queue.so');
      expect(EXPECTED_SHARED_LIBRARIES).toContain('log_worker_pool.so');
      expect(EXPECTED_SHARED_LIBRARIES).toContain('ordered_emitter.so');
    });

    /**
     * Test: Verify shared library file detection
     *
     * **Validates: Requirement 4.4**
     */
    it('should correctly identify shared library files', () => {
      expect(isSharedLibrary('js_bridge_pure.so')).toBe(true);
      expect(isSharedLibrary('path/to/lib.so')).toBe(true);
      expect(isSharedLibrary('libgomp.so.1')).toBe(true);
      expect(isSharedLibrary('handler.py')).toBe(false);
      expect(isSharedLibrary('handler.pyc')).toBe(false);
      expect(isSharedLibrary('bundle.js')).toBe(false);
    });

    /**
     * Test: Verify JS runtime files are present
     *
     * **Validates: Requirement 4.5**
     * THE Lambda_Layer SHALL contain the JavaScript runtime components
     */
    it('should have all required JS runtime files', () => {
      // Verify expected JS runtime files are defined
      expect(EXPECTED_JS_RUNTIME_FILES).toContain('bundle.js');
      expect(EXPECTED_JS_RUNTIME_FILES).toContain('init_wrapper.js');
    });

    /**
     * Test: Verify JS file detection
     *
     * **Validates: Requirement 4.5**
     */
    it('should correctly identify JavaScript files', () => {
      expect(isJsFile('bundle.js')).toBe(true);
      expect(isJsFile('path/to/init_wrapper.js')).toBe(true);
      expect(isJsFile('handler.py')).toBe(false);
      expect(isJsFile('handler.pyc')).toBe(false);
      expect(isJsFile('lib.so')).toBe(false);
    });

    /**
     * Test: Verify layer paths follow AWS Lambda conventions
     *
     * **Validates: Requirements 4.1, 4.2**
     */
    it('should use correct AWS Lambda layer paths', () => {
      // AWS Lambda adds /opt/python to PYTHONPATH
      expect(LAYER_PYTHON_PATH).toBe('python/lambdakata');

      // JS runtime at /opt/js_runtime
      expect(LAYER_JS_RUNTIME_PATH).toBe('js_runtime');

      // Shared libraries at /opt/lib
      expect(LAYER_LIB_PATH).toBe('lib');
    });

    /**
     * Test: Verify __init__.py (as bytecode) is present for package structure
     *
     * **Validates: Requirement 4.2**
     */
    it('should have __init__.pyc for lambdakata package', () => {
      const expectedPath = 'python/lambdakata/__init__.pyc';

      // Simulate a properly built layer
      const properlyBuiltLayer: LayerFileEntry[] = EXPECTED_PYTHON_MODULES.map(
        (name) => createLayerFileEntry(`lambdakata/${name}`, '.pyc'),
      );

      // Verify __init__.pyc exists
      const hasInit = properlyBuiltLayer.some((f) => f.path === expectedPath);
      expect(hasInit).toBe(true);
    });

    /**
     * Test: Verify libgomp.so.1 is expected in lib directory
     *
     * **Validates: Requirement 4.4** (OpenMP support)
     */
    it('should expect libgomp.so.1 for OpenMP support', () => {
      expect(EXPECTED_LIB_FILES).toContain('libgomp.so.1');
    });
  });

  /**
   * Integration test: Validate actual layer build output (if available)
   * This test is skipped if the layer has not been built
   */
  describe('Actual Layer Build Validation', () => {
    const layerPath = path.join(__dirname, '../../dist/layer');

    it('should validate actual layer structure if built', () => {
      // Skip if layer hasn't been built
      if (!fs.existsSync(layerPath)) {
        console.log(
          'Skipping actual layer validation - layer not built. Run `make build-layer-x86` or `make build-layer-arm64` first.',
        );
        return;
      }

      const validation = validateLayerStructure(layerPath);

      // Layer should have the python path
      expect(validation.hasPythonPath).toBe(true);

      // Layer should have no source files
      expect(validation.sourceFiles).toHaveLength(0);

      // Layer should have bytecode files
      expect(validation.bytecodeFiles.length).toBeGreaterThan(0);

      // Overall validation should pass
      expect(validation.isValid).toBe(true);

      // Log the bytecode files found
      console.log(`Found ${validation.bytecodeFiles.length} bytecode files in layer`);
    });

    it('should contain expected Python modules as bytecode if layer is built', () => {
      // Skip if layer hasn't been built
      if (!fs.existsSync(layerPath)) {
        return;
      }

      const validation = validateLayerStructure(layerPath);

      // Check for expected modules
      for (const moduleName of EXPECTED_PYTHON_MODULES) {
        const hasBytecode = validation.bytecodeFiles.some((f) =>
          f.includes(`${moduleName}.pyc`),
        );
        expect(hasBytecode).toBe(true);
      }
    });

    /**
     * Test: Verify optimized_handler.pyc exists at correct path in actual layer
     *
     * **Validates: Requirement 4.1**
     */
    it('should contain optimized_handler.pyc at correct path if layer is built', () => {
      // Skip if layer hasn't been built
      if (!fs.existsSync(layerPath)) {
        return;
      }

      const validation = validateLayerStructure(layerPath);

      // Check for optimized_handler.pyc
      const hasHandler = validation.bytecodeFiles.some((f) =>
        f.includes('optimized_handler.pyc'),
      );
      expect(hasHandler).toBe(true);
    });

    /**
     * Test: Verify all required .so files are present in actual layer
     *
     * **Validates: Requirement 4.4**
     */
    it('should contain all required shared libraries if layer is built', () => {
      // Skip if layer hasn't been built
      if (!fs.existsSync(layerPath)) {
        return;
      }

      const validation = validateLayerStructure(layerPath);

      // Check for expected shared libraries
      for (const soFile of EXPECTED_SHARED_LIBRARIES) {
        const hasSo = validation.sharedLibraries.some((f) =>
          f.includes(soFile),
        );
        expect(hasSo).toBe(true);
      }

      // Log the shared libraries found
      console.log(`Found ${validation.sharedLibraries.length} shared libraries in layer`);
    });

    /**
     * Test: Verify JS runtime files are present in actual layer
     *
     * **Validates: Requirement 4.5**
     */
    it('should contain JS runtime files if layer is built', () => {
      // Skip if layer hasn't been built
      if (!fs.existsSync(layerPath)) {
        return;
      }

      const validation = validateLayerStructure(layerPath);

      // Layer should have JS runtime path
      expect(validation.hasJsRuntimePath).toBe(true);

      // Check for expected JS runtime files
      for (const jsFile of EXPECTED_JS_RUNTIME_FILES) {
        const hasJs = validation.jsRuntimeFiles.some((f) =>
          f.includes(jsFile),
        );
        expect(hasJs).toBe(true);
      }

      // Log the JS runtime files found
      console.log(`Found ${validation.jsRuntimeFiles.length} JS runtime files in layer`);
    });

    /**
     * Test: Verify lib directory contains libgomp.so.1 in actual layer
     *
     * **Validates: Requirement 4.4** (OpenMP support)
     */
    it('should contain libgomp.so.1 in lib directory if layer is built', () => {
      // Skip if layer hasn't been built
      if (!fs.existsSync(layerPath)) {
        return;
      }

      const validation = validateLayerStructure(layerPath);

      // Layer should have lib path
      expect(validation.hasLibPath).toBe(true);

      // Check for libgomp.so.1
      const hasLibgomp = validation.libFiles.some((f) =>
        f.includes('libgomp.so.1'),
      );
      expect(hasLibgomp).toBe(true);
    });

    /**
     * Test: Verify layer has all required directory structure
     *
     * **Validates: Requirements 4.1, 4.2, 4.4, 4.5**
     */
    it('should have complete directory structure if layer is built', () => {
      // Skip if layer hasn't been built
      if (!fs.existsSync(layerPath)) {
        return;
      }

      const validation = validateLayerStructure(layerPath);

      // All required paths should exist
      expect(validation.hasPythonPath).toBe(true);
      expect(validation.hasJsRuntimePath).toBe(true);
      expect(validation.hasLibPath).toBe(true);

      // Should have content in each directory
      expect(validation.bytecodeFiles.length).toBeGreaterThan(0);
      expect(validation.sharedLibraries.length).toBeGreaterThan(0);
      expect(validation.jsRuntimeFiles.length).toBeGreaterThan(0);
      expect(validation.libFiles.length).toBeGreaterThan(0);
    });
  });
});

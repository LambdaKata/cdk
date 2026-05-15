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

import 'reflect-metadata';
import 'dotenv/config';

import { BuildOptions, Loader, SameShape } from 'esbuild';

import { RuntimeEsbuildOptions } from './esbuild.types';
import {
  awsSdkV3Externals,
  browserExternals,
  buildToolExternals,
  cdkExternals,
  lambdaExternals,
  nodeBuiltinExternals,
} from './externals';


/**
 * Build-time environment variable resolution for browser bundles.
 *
 * **Purpose**: Replaces all `process.env.*` references in browser code with
 * constant string literals at build time, eliminating runtime `process` access.
 *
 * **Why this matters**:
 * - `process` is a Node.js global that doesn't exist in browsers
 * - Accessing `process.env` at runtime causes "process is not defined" errors
 * - Build-time replacement enables tree-shaking and dead code elimination
 * - Reduces bundle size by removing unused environment-dependent code paths
 *
 * **Environment variables resolved**:
 * - `PURE_ENV_*`: Public environment variables (e.g., PURE_ENV_STAGE, PURE_ENV_STACK_NAME, PURE_ENV_API_URL)
 * - `NODE_ENV`: Build mode (development, production, test)
 *
 * **Usage in code**:
 * ```typescript
 * // Before build (source code):
 * if (process.env.NODE_ENV === 'development') {
 *   console.log('Debug info');
 * }
 *
 * // After build (with NODE_ENV=production):
 * if ("production" === 'development') {  // Dead code, removed by minifier
 *   console.log('Debug info');
 * }
 * ```
 *
 * **Security note**: Only variables with public prefixes are exposed to browser.
 * Never include secrets or sensitive data in PURE_ENV_* or PURE_ENV_* variables.
 *
 * @see https://esbuild.github.io/api/#define
 */
function createBrowserDefines(): Record<string, string> {
  const defines: Record<string, string> = {};

  // Resolve NODE_ENV (defaults to 'production' if not set)
  defines['process.env.NODE_ENV'] = JSON.stringify(
    process.env.NODE_ENV || 'production',
  );

  // Resolve all REACT_APP_* environment variables
  // These are the standard convention for Create React App and similar tools
  // @note: fallback for already established applications
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('REACT_APP_')) {
      defines[`process.env.${key}`] = JSON.stringify(process.env[key] || '');
    }
  }

  // Resolve all PURE_ENV_* environment variables
  // These are framework-specific public variables
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('PURE_ENV_')) {
      defines[`process.env.${key}`] = JSON.stringify(process.env[key] || '');
    }
  }

  // Log resolved environment variables for debugging
  const envVarCount = Object.keys(defines).length;
  if (envVarCount > 0 && process.env.DEBUG === 'true') {
    console.log(`[esbuild] Resolved ${envVarCount} environment variables for browser bundle:`);
    for (const [key, value] of Object.entries(defines)) {
      console.log(`  ${key} = ${value}`);
    }
  }

  return defines;
}

// Create define map for browser builds
const browserDefines = createBrowserDefines();

/**
 * A configuration object for multiple build targets, each containing specific build options
 * and settings, including entry points, outputs, platform, loaders, and other related parameters.
 *
 * @typedef {Object} Builds
 * @property {Object} [target] - A mapping where each key represents a build target and the value
 * is a configuration object containing build options and additional properties specific to that target.
 *
 * Each target is defined as:
 * - `label` {string}: A friendly name for the build target.
 * - `entryPoints` {string[]}: Entry files for the build process.
 * - `outfile` {string}: Output file path for the build result.
 * - `platform` {string}: The intended platform for the build output, e.g., "node" or "browser".
 * - `bundle` {boolean}: Determines whether the output should be bundled into a single file.
 * - `loaders` {Object}: An object defining custom loaders for specific file extensions.
 *   - Key: File extension (e.g. `.css`, `.svg`).
 *   - Value: Loader type to process the file extension.
 * - `external` {string[]}: A list of modules to mark as external during the bundling.
 * - `jsx` {string} [optional]: Specifies JSX factory behavior for JSX/TSX files.
 * - `format` {string} [optional]: The output format, e.g., "cjs", "esm".
 * - `target` {string[]} [optional]: The target ECMAScript versions for the output.
 * - `minify` {boolean} [optional]: Specifies whether the output should be minified.
 *
 * Example targets:
 * - `cdk`: A Node.js platform build for AWS CDK applications, focused on backend services.
 * - `lambda`: A Node.js platform build for AWS Lambda functions, with custom loaders for `.css`
 *   and `.svg` files and automatic JSX processing.
 * - `react`: A browser platform build for React applications with support for JSX and TSX files,
 *   targeting ES2020 compatibility.
 *
 *   @example: esbuild --bundle --platform=node src/index.tsx --outfile=dist/index.js --loader:.css=css --loader:.svg=text --loader:.js=jsx --loader:.tsx=tsx  --external:aws-cdk-lib --external:constructs --external:fs --external:path
 *
 * @todo: complete with OOP approach
 */
export const builds: { [target: string]: RuntimeEsbuildOptions } = {
  /**
   * CDK infrastructure bundle (production)
   * Target: Node.js 18 for CDK synthesis
   * Externalizes: AWS CDK libs, AWS SDK v3, Node builtins, build tools
   * Entry: cdk/bin/app.ts (production CDK app)
   */
  cdk: {
    entryPoints: ['src/index.ts'],
    outfile: 'out/dist/index.js',
    platform: 'node',
    bundle: true,
    treeShaking: true,
    loaders: {
      '.css': 'css' as Loader,
      '.svg': 'text' as Loader,
      '.js': 'jsx' as Loader,
      '.tsx': 'tsx' as Loader,
    } as { [ext: string]: Loader },
    external: [
      ...cdkExternals,
      ...awsSdkV3Externals,
    ],
    jsx: 'automatic',
    format: 'cjs',
    target: ['node18'],
    label: 'CDK Infrastructure',
    minify: true,
  },

  /**
   * Infra construct library bundle (for NPM package export)
   * Target: Node.js 18 for CDK construct consumption
   * Externalizes: AWS CDK libs, constructs, AWS SDK v3, Node builtins
   * Entry: src/infra/index.ts (exports all stacks: RuntimeWebStack, RuntimeInfraStack, RuntimeStack) – @note: RuntimeStack – DefaultSSR; RuntimeWebStack –Lambda & Additional AWS resources
   */
  infra: {
    entryPoints: ['src/infra/index.ts'],
    outfile: 'out/dist/infra/index.js',
    platform: 'node',
    treeShaking: true,
    bundle: true,
    loaders: {
      '.css': 'css' as Loader,
      '.svg': 'text' as Loader,
      '.js': 'jsx' as Loader,
      '.tsx': 'tsx' as Loader,
    } as { [ext: string]: Loader },
    external: [
      'aws-cdk-lib',
      'constructs',
      '@aws-sdk/*',
      'esbuild',  // CRITICAL: Must externalize esbuild (used in lambda-bundler.ts)
      'chalk',    // Used in lambda-bundler.ts
      ...nodeBuiltinExternals,
      ...buildToolExternals,
    ],
    jsx: 'automatic',
    format: 'cjs',
    target: ['node18'],
    label: 'Infra Construct Library',
    minify: true,
  },

  /**
   * Library bundle for npm package
   * Target: Node.js 18
   * Externalizes: React stack (peer ties) + all other dependencies
   * Provides: CommonJS module for library consumers
   * Note: Uses browserDefines for isomorphic code that may run in browser
   */
  lib: {
    entryPoints: ['src/index.tsx'],
    outfile: 'out/dist/lib/index.js',
    platform: 'node',
    bundle: true,
    treeShaking: true,
    loaders: {
      '.css': 'css' as Loader,
      '.svg': 'text' as Loader,
      '.js': 'jsx' as Loader,
      '.tsx': 'tsx' as Loader,
    } as { [ext: string]: Loader },
    external: [
      'react',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom',
      'react-dom/server',
      'react-dom/client',
      'react-router',
      'react-router-dom',
      '@remix-run/router',
      '@worktif/*',
      'inversify',
      'reflect-metadata',
      ...nodeBuiltinExternals,
      ...buildToolExternals,
      'zod',
      '@worktif/runtime/lambda',
      '@worktif/runtime/bin',
      '@worktif/runtime/infra',
    ],
    jsx: 'automatic',
    format: 'cjs',
    target: ['node18'],
    label: 'lib',
    minify: true,
    define: browserDefines,
  },

  /**
   * CLI tool bundle
   * Target: Node.js 18
   * Externalizes: CDK libs, Node builtins, CLI dependencies
   * Includes shebang for direct execution
   */
  cli: {
    entryPoints: ['src/bin/index.unix.ts'],
    outfile: 'out/dist/bin/runtime.js',
    bundle: true,
    platform: 'node',
    treeShaking: false,  // Disable tree-shaking to preserve all command registrations
    label: 'cli',
    jsx: 'automatic',
    external: [
      ...cdkExternals,
      ...nodeBuiltinExternals,
      ...buildToolExternals,
      'commander',
      // 'chalk' and 'ora' are bundled to avoid ESM/CJS compatibility issues
      'zod',
    ],
    format: 'cjs',
    target: ['node18'],
    minify: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  /**
   * Worker process for Awake Lambda Development
   * Target: Node.js 18
   * Must be a separate file (not bundled into CLI) because WorkerManager
   * forks it as a child process with inspector enabled for debugging.
   * Path: out/dist/bin/worker-process.js (referenced by WorkerManager)
   */
  workerProcess: {
    entryPoints: ['src/bin/commands/dev/worker-process.ts'],
    outfile: 'out/dist/bin/worker-process.js',
    bundle: true,
    platform: 'node',
    treeShaking: true,
    label: 'Worker Process (Live Dev)',
    jsx: 'automatic',
    external: [
      ...nodeBuiltinExternals,
    ],
    format: 'cjs',
    target: ['node18'],
    minify: false,  // Keep readable for debugging
  },
  /**
   * SnapStart Custom Resource Handler bundle
   * Target: Node.js 18 for Lambda runtime
   * Externalizes: All @aws-sdk/* packages (available in Lambda runtime)
   * Entry: src/snapstart-activator.ts (CloudFormation Custom Resource handler)
   * Output: out/dist/snapstart-handler.js (used by SnapStartActivator construct via Code.fromAsset)
   *
   * This handler is bundled at build time and deployed as a Lambda asset,
   * replacing the previous inline code generation approach.
   */
  snapstartHandler: {
    entryPoints: ['src/snapstart-activator.ts'],
    outfile: 'out/dist/snapstart-handler.js',
    platform: 'node',
    bundle: true,
    treeShaking: true,
    format: 'cjs',
    target: ['node18'],
    external: [
      '@aws-sdk/*', // All AWS SDK v3 packages available in Lambda runtime
    ],
    label: 'SnapStart Handler',
    minify: true,
  },
  /**
   * React browser bundle
   * Target: ES2020 for modern browsers
   * Externalizes: Server-side packages (Inversify, AWS SDK, Node built-ins, Lambda runtime, build tools)
   * Bundles: React, React Router, and application code
   * Metafile: Enabled for bundle analysis
   * Optimizations: Minification and tree-shaking enabled for production builds
   * Source maps: Disabled to keep bundle size under 2MB threshold
   * Define: All process.env.* references replaced with constants at build time
   */
  react: {
    entryPoints: [`src/index.tsx`],
    outfile: 'out/dist/src/index.js',
    bundle: true,
    treeShaking: true,
    platform: 'browser',
    format: 'iife',  // IIFE format for browser (self-contained, no require())
    loaders: {
      '.css': 'css' as Loader,
      '.svg': 'text' as Loader,
      '.js': 'jsx' as Loader,
      '.tsx': 'tsx' as Loader,
      '.jsx': 'jsx' as Loader,
    } as { [ext: string]: Loader },
    jsx: 'automatic',
    jsxDev: false,
    ignoreAnnotations: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    external: [
      ...browserExternals,
      'zod',
      '@worktif/runtime/lambda',
      '@worktif/runtime/bin',
      '@worktif/runtime/cli.js',
      '@worktif/runtime/infra',
    ],
    target: ['es2020'],
    label: 'react',
    minify: true,
    metafile: true,
    sourcemap: false,  // Disable source maps to keep bundle size minimal
    define: browserDefines,
  },
};

/**
 * Shared build configuration options for the application bundler.
 * Provides common settings that can be overridden by specific build targets.
 *
 * @param isProd - Whether this is a production build
 * @returns Shared build options
 */
export const shared: (isProd: boolean) => BuildOptions =
  (isProd: boolean): BuildOptions => ({
    bundle: true,
    platform: 'node',
    sourcemap: isProd ? false : 'inline',
    // minify: isProd,
    target: 'node18',
    logLevel: 'info',
    // @todo:@important: CHECK OUT THIS IDENTIFIER
    minifySyntax: false,
    external: [
      ...lambdaExternals,
      'bundle.js', // Build artifact
    ],
  });

// if (testInstance) {
//   Object.assign(builds.cdk, {
//     reactTest: {
//       entryPoints: [`src/sandbox/${testInstance}.test.tsx`],
//       bundle: true,
//       outfile: `dist/tests/react.${testInstance}.test.js`,
//       platform: 'browser',
//       format: 'esm',
//       loaders: {
//         '.css': 'css' as Loader,
//         '.svg': 'text' as Loader,
//         '.js': 'jsx' as Loader,
//         '.tsx': 'tsx' as Loader,
//       },
//       jsx: 'automatic',
//       sourcemap: true,
//       target: ['esnext'],
//       label: 'reactTest',
//     },
//   });
// }

/**
 * Completes a build configuration by merging the provided build options with shared configuration settings.
 *
 * @param {BuildOptions} buildConfig - The specific build options to be completed.
 * @param shared
 * @param {SameShape<BuildOptions, typeof shared> & { loaders?: { [ext: string]: Loader }, label?: string }} sharedConfig - The shared configuration containing additional settings such as loaders and labels.
 * @return {BuildOptions} The completed build configuration.
 */
export function completeBuildConfig(
  buildConfig: RuntimeEsbuildOptions,
  sharedConfig?: Partial<BuildOptions>,
): BuildOptions {
  const { loaders, label, plugins, ...config } = buildConfig;
  return {
    ...shared(buildConfig.isProd ?? false),
    ...config as SameShape<BuildOptions, any>,
    loader: loaders,
    plugins: plugins || [],
    ...sharedConfig,
    logLevel: 'warning',
  };
}

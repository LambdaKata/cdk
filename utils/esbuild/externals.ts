/*
 * Elastic License 2.0
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: worktif.runtime.cdk <worktif_runtime_cdk>.
 * Use of this software is governed by the Elastic License 2.0; see the LICENSE file
 * or https://www.elastic.co/licensing/elastic-license for details.
 *
 * Re-licensing notice:
 *   This file was previously distributed under the Business Source License 1.1 (BUSL-1.1).
 *   As of 2025-09-22, it is re-licensed under Elastic License 2.0.
 *
 * SPDX-License-Identifier: Elastic-2.0
 */

/**
 * # External Dependencies Configuration
 *
 * This file defines which dependencies should be externalized (not bundled) for different build targets.
 * Externalizing dependencies reduces bundle size, improves build times, and prevents duplicate code.
 *
 * ## Build Targets
 *
 * - **Lambda**: Server-side handlers deployed to AWS Lambda
 * - **Browser/React**: Client-side JavaScript bundle served to web browsers
 * - **CDK**: Infrastructure-as-code constructs (runs locally, not deployed)
 *
 * ## When to Add Packages to External Lists
 *
 * ### Add to `browserExternals` when:
 * - Package is server-side only (uses Node.js APIs like fs, path, crypto)
 * - Package is AWS-specific (AWS SDK, Lambda runtime packages)
 * - Package is a dependency injection container (Inversify)
 * - Package is build tooling (esbuild, webpack, typescript)
 * - Package would bloat the browser bundle unnecessarily
 *
 * ### Add to `lambdaExternals` when:
 * - Package is available in Lambda runtime (AWS SDK v3)
 * - Package is provided via Lambda Layer (React, React Router)
 * - Package is build tooling not needed at runtime
 * - Package is CDK-related (only needed for infrastructure)
 *
 * ### Add to `cdkExternals` when:
 * - Package is AWS CDK or constructs library
 * - Package is Node.js built-in module
 * - Package is build tooling
 *
 * ## Common Package Categories
 *
 * ### Server-Side Only
 * - Node.js built-ins: fs, path, crypto, http, https, stream, buffer
 * - AWS SDK v3: @aws-sdk/client-*, @aws-sdk/lib-*
 * - Lambda runtime: aws-lambda, @aws-lambda-powertools/*, @middy/*
 * - Dependency injection: inversify, @inversifyjs/*, reflect-metadata
 *
 * ### Build-Time Only
 * - Bundlers: esbuild, webpack, rollup, vite
 * - Compilers: typescript, @babel/*, @swc/*
 * - Infrastructure: aws-cdk-lib, constructs, @aws-cdk/*
 *
 * ### Isomorphic (Can Run Anywhere)
 * - React: react, react-dom (provided via Lambda Layer for Lambda, bundled for browser)
 * - Utilities: lodash, date-fns, uuid
 * - Validation: zod, yup, joi
 *
 * ## Performance Impact
 *
 * - Lambda bundle size limit: 10MB compressed (AWS hard limit)
 * - Browser bundle target: <2MB uncompressed for fast page loads
 * - Externalizing large packages (>1MB) significantly reduces cold start times
 *
 * ## Troubleshooting
 *
 * ### "Cannot find module 'X'" at runtime
 * - Package was incorrectly externalized
 * - Remove from external list or ensure it's available in runtime environment
 *
 * ### Bundle size too large
 * - Check if server-side packages are being bundled in browser
 * - Add server-side packages to `browserExternals`
 * - Use bundle analysis tool: `yarn cli:build --target=react --analyze`
 *
 * ### Duplicate React instances
 * - Ensure React is externalized in Lambda bundles (provided via Layer)
 * - Check that React is NOT in `browserExternals` (should be bundled for browser)
 */

import { builtinModules } from 'module';

/**
 * AWS SDK v3 client packages that should be externalized in Lambda bundles.
 *
 * **Why externalize**: AWS SDK v3 is available in the Lambda runtime environment,
 * so bundling it would waste space and increase cold start times.
 *
 * **When to add**: Add any new @aws-sdk/* package you use in Lambda handlers.
 *
 * **Examples**:
 * - S3 operations: @aws-sdk/client-s3
 * - DynamoDB operations: @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb
 * - CloudFront operations: @aws-sdk/client-cloudfront
 * - Event-driven: @aws-sdk/client-sqs, @aws-sdk/client-sns, @aws-sdk/client-eventbridge
 *
 * **Note**: Always use AWS SDK v3 modular imports (@aws-sdk/client-*), never v2 (aws-sdk).
 */
export const awsSdkV3Externals: string[] = [
  '@aws-sdk/client-s3',
  '@aws-sdk/client-dynamodb',
  '@aws-sdk/client-cloudfront',
  '@aws-sdk/client-lambda',
  '@aws-sdk/client-sqs',
  '@aws-sdk/client-sns',
  '@aws-sdk/client-eventbridge',
  '@aws-sdk/lib-dynamodb',
  '@aws-sdk/smithy-client',
  '@aws-sdk/types',
  '@aws-sdk/util-dynamodb',
  '@aws-sdk/credential-providers',
];

/**
 * AWS CDK packages that should be externalized (not needed in Lambda runtime).
 *
 * **Why externalize**: CDK packages are only used for infrastructure definition
 * at build/deploy time, never at runtime.
 *
 * **When to add**: Add any aws-cdk-lib or @aws-cdk/* package used in CDK constructs.
 *
 * **Examples**:
 * - Core CDK: aws-cdk-lib, constructs
 * - CDK modules: @aws-cdk/aws-s3, @aws-cdk/aws-lambda (v1 only, v2 uses aws-cdk-lib)
 *
 * **Note**: These should be externalized in ALL build targets (Lambda, browser, CDK).
 */
export const awsCdkExternals: string[] = [
  'aws-cdk-lib',
  'constructs',
];

/**
 * Node.js built-in modules that should be externalized.
 *
 * **Why externalize**: Built-in modules are provided by the Node.js runtime
 * and cannot be bundled. They're server-side only and don't exist in browsers.
 *
 * **When to add**: Automatically includes all Node.js built-ins via `builtinModules`.
 * No manual additions needed unless Node.js adds new built-in modules.
 *
 * **Examples**:
 * - File system: fs, fs/promises, path
 * - Networking: http, https, net, dns
 * - Cryptography: crypto
 * - Streams: stream, buffer
 * - Process: process, child_process
 *
 * **Note**: Includes both standard (fs) and node: prefixed (node:fs) versions
 * for compatibility with different import styles.
 */
export const nodeBuiltinExternals: string[] = [
  ...builtinModules,
  ...builtinModules.map((m: string) => `node:${m}`),
];

/**
 * Build tools that should be externalized (not needed in runtime).
 *
 * **Why externalize**: Build tools are only used during development and build time,
 * never at runtime. Including them would massively bloat bundles.
 *
 * **When to add**: Add any bundler, compiler, or build tool dependency.
 *
 * **Examples**:
 * - Bundlers: esbuild, webpack, rollup, vite, parcel
 * - Compilers: typescript, @babel/core, @swc/core
 * - Type checkers: ts-node, tsx
 * - Linters: eslint, prettier
 *
 * **Note**: These should be externalized in ALL build targets.
 *
 * **IMPORTANT**: Do NOT add chalk here - it's used in CLI (src/bin/) and must be bundled.
 */
export const buildToolExternals: string[] = [
  'esbuild',
  'webpack',
  'typescript',
  'ts-node',
];

/**
 * React stack packages provided by Lambda Layer node_modules.
 *
 * **Why externalize**: React and React Router are provided via Lambda Layer
 * at /opt/nodejs/node_modules/ to ensure a single React instance across all
 * Lambda handlers and prevent "multiple React instances" errors.
 *
 * **When to add**: Add any package that's installed in the Lambda Layer
 * (see lambda-scaling/package.json).
 *
 * **Examples**:
 * - React core: react, react/jsx-runtime, react/jsx-dev-runtime
 * - React DOM: react-dom, react-dom/server, react-dom/client
 * - Routing: react-router, react-router-dom, @remix-run/router
 * - Layer bundle: /opt/nodejs/bundle (custom runtime code)
 *
 * **Critical**: These MUST be externalized in Lambda bundles but should NOT
 * be in browserExternals (React needs to be bundled for browser).
 *
 * **Note**: Lambda Layer is mounted at /opt/nodejs/ and automatically added
 * to NODE_PATH, making these packages available at runtime.
 */
export const lambdaLayerExternals: string[] = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/server',
  'react-dom/client',
  'react-router',
  'react-router-dom',
  '@remix-run/router',
  '/opt/nodejs/bundle', // Layer bundle with runtime
];

/**
 * Path aliases that should be externalized (not bundled into Lambda).
 *
 * **Why externalize**: These path aliases reference code that is only used
 * at build/deploy time, never at Lambda runtime.
 *
 * **When to add**: Add any path alias that references build-time only code.
 *
 * **Examples**:
 * - @infra/*: CDK constructs and infrastructure code (build-time only)
 * - @bin/*: CLI and build scripts (local Node.js only)
 *
 * **Note**: These are NOT npm packages, but TypeScript path aliases that
 * resolve to local source code directories.
 */
export const pathAliasExternals: string[] = [
  '@infra/*',
  '@bin/*',
];

/**
 * Complete list of dependencies that should be externalized for Lambda bundles.
 *
 * **Purpose**: Optimizes Lambda bundle size and reduces cold start times by
 * excluding packages that are available in the runtime environment.
 *
 * **Composition**:
 * - AWS SDK v3 clients (available in Lambda runtime)
 * - AWS CDK packages (build-time only)
 * - Node.js built-in modules (provided by runtime)
 * - Build tools (not needed at runtime)
 * - React/Router packages (provided via Lambda Layer)
 * - Path aliases (build-time code like @infra/*, @bin/*)
 *
 * **Target bundle size**: <10MB compressed (AWS hard limit)
 * **Typical bundle size**: 2-5MB compressed with proper externalization
 *
 * **When to modify**: Add new packages to the appropriate category list above
 * (awsSdkV3Externals, lambdaLayerExternals, etc.) rather than directly to this array.
 *
 * **Verification**: After adding dependencies, run `yarn cli:build:lambda` and
 * check bundle size in .serverless/*.zip to ensure it stays under 10MB.
 */
export const lambdaExternals: string[] = [
  ...awsSdkV3Externals,
  ...awsCdkExternals,
  ...nodeBuiltinExternals,
  ...buildToolExternals,
  ...lambdaLayerExternals,
  ...pathAliasExternals,
];

/**
 * Dependencies that should be externalized for CDK bundles.
 *
 * **Purpose**: CDK constructs run locally during deployment, not in Lambda.
 * Externalize packages that are available in the local Node.js environment.
 *
 * **Composition**:
 * - AWS CDK packages (available in node_modules)
 * - Node.js built-in modules (provided by local runtime)
 * - Build tools (available in node_modules)
 *
 * **When to modify**: Add packages that are used in CDK constructs but should
 * not be bundled (typically large libraries or those available in node_modules).
 *
 * **Note**: CDK bundles have no size limit since they run locally, but
 * externalizing still improves build times.
 */
export const cdkExternals: string[] = [
  ...awsCdkExternals,
  ...nodeBuiltinExternals,
  ...buildToolExternals,
];

/**
 * Dependencies that should be externalized for browser bundles.
 *
 * **Purpose**: Prevents server-side packages from being bundled in the React
 * browser bundle, which would cause massive bundle size bloat and runtime errors.
 *
 * **Critical Rule**: ONLY server-side packages should be in this list.
 * Client-side packages (React, React Router, lodash, etc.) should NOT be here
 * as they need to be bundled for the browser.
 *
 * **Target bundle size**: <2MB uncompressed for fast page loads
 * **Typical bundle size**: 1-1.5MB uncompressed with proper externalization
 *
 * **When to add packages**:
 * 1. Package uses Node.js APIs (fs, path, crypto, etc.)
 * 2. Package is AWS-specific (AWS SDK, Lambda runtime)
 * 3. Package is dependency injection (Inversify)
 * 4. Package is build tooling (esbuild, webpack)
 * 5. Package would bloat browser bundle unnecessarily
 *
 * **When NOT to add packages**:
 * - React, React Router (needed in browser)
 * - UI libraries (unless server-side only like Material-UI in ErrorBoundary)
 * - Utility libraries (lodash, date-fns, uuid)
 * - Validation libraries (zod, yup)
 *
 * **Verification**: After modifying, run `yarn cli:build --target=react` and
 * check bundle size. Use bundle analysis to verify no server packages included.
 *
 * **Categories**:
 * - Build tools: esbuild, webpack, typescript (not needed at runtime)
 * - Inversify DI: inversify, @inversifyjs/*, reflect-metadata (Lambda-only)
 * - AWS SDK v3: @aws-sdk/* (Lambda-only)
 * - Lambda runtime: aws-lambda, @aws-lambda-powertools/*, @middy/* (Lambda-only)
 * - Node.js built-ins: fs, path, crypto, etc. (server-only)
 * - AWS CDK: aws-cdk-lib, constructs (build-time only)
 */
export const browserExternals: string[] = [
  // Build tools (not needed at runtime)
  ...buildToolExternals,

  // Inversify DI container (Lambda-only)
  // Used in src/core/ for dependency injection in Lambda handlers
  // NEVER import these in src/lib/ or src/index.tsx (breaks browser compatibility)
  'inversify',
  '@inversifyjs/common',
  '@inversifyjs/container',
  '@inversifyjs/core',
  '@inversifyjs/plugin',
  '@inversifyjs/reflect-metadata-utils',
  'reflect-metadata',

  // AWS SDK v3 (Lambda-only)
  // Used in src/core/ for AWS service interactions
  // NEVER import these in src/lib/ or src/index.tsx (breaks browser compatibility)
  ...awsSdkV3Externals,

  // Lambda runtime packages (server-only)
  // Used in src/core/ for Lambda handler middleware and utilities
  // NEVER import these in src/lib/ or src/index.tsx (breaks browser compatibility)
  'aws-lambda',
  '@aws-lambda-powertools/logger',
  '@aws-lambda-powertools/tracer',
  '@aws-lambda-powertools/metrics',
  '@middy/core',
  '@middy/http-json-body-parser',
  '@middy/http-error-handler',
  '@middy/http-cors',
  'zod',

  // Node.js built-in modules (server-only)
  // These don't exist in browser environments
  // NEVER import these in src/lib/ or src/index.tsx (breaks browser compatibility)
  ...nodeBuiltinExternals,

  // AWS CDK (build-time only)
  // Only used for infrastructure definition, never at runtime
  ...awsCdkExternals,
];

/**
 * Get externals for a specific build target.
 *
 * **Usage**: Use this helper function in esbuild configurations to get the
 * correct external dependencies for each build target.
 *
 * **Example**:
 * ```typescript
 * import { getExternalsForTarget } from './externals';
 *
 * const config = {
 *   entryPoints: ['src/index.tsx'],
 *   external: getExternalsForTarget('react'),
 *   // ... other config
 * };
 * ```
 *
 * @param target - The build target ('lambda', 'cdk', 'browser', 'react')
 * @returns Array of external dependencies for the target
 *
 * **Build Targets**:
 * - `lambda`: Server-side handlers (excludes AWS SDK, React Layer, Node built-ins)
 * - `cdk`: Infrastructure constructs (excludes CDK packages, Node built-ins)
 * - `browser`/`react`: Client-side bundle (excludes server-side packages only)
 */
export function getExternalsForTarget(target: 'lambda' | 'cdk' | 'browser' | 'react'): string[] {
  switch (target) {
    case 'lambda':
      return lambdaExternals;
    case 'cdk':
      return cdkExternals;
    case 'browser':
    case 'react':
      return browserExternals;
    default:
      return [];
  }
}

/**
 * Legacy export for backward compatibility.
 * @deprecated Use lambdaExternals instead
 */
export const excludeDependencies = lambdaExternals;

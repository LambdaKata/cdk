/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

/**
 * Represents a violation of import rules in browser code.
 */
export interface ImportViolation {
  /** The file path where the violation was found */
  file: string;
  /** The line number where the violation occurs */
  line: number;
  /** The import statement that violates the rules */
  import: string;
  /** The reason why this import is not allowed */
  reason: string;
}

/**
 * Parsed import statement information.
 */
interface ParsedImport {
  /** The source module being imported */
  source: string;
  /** The line number where the import appears */
  line: number;
  /** The full import statement text */
  statement: string;
}

/**
 * Server-side packages that should not be imported in browser code.
 */
const FORBIDDEN_PACKAGES = {
  inversify: ['inversify', '@inversifyjs/', 'reflect-metadata'],
  awsSdk: ['@aws-sdk/'],
  lambda: ['aws-lambda', '@aws-lambda-powertools/', '@middy/'],
  nodeBuiltins: [
    'fs', 'path', 'crypto', 'http', 'https', 'net', 'tls', 'dgram',
    'dns', 'os', 'stream', 'zlib', 'child_process', 'cluster', 'worker_threads',
    'perf_hooks', 'async_hooks', 'inspector', 'v8', 'vm', 'repl',
    'node:fs', 'node:path', 'node:crypto', 'node:http', 'node:https',
    'node:net', 'node:tls', 'node:dgram', 'node:dns', 'node:os',
    'node:stream', 'node:zlib', 'node:child_process', 'node:cluster',
    'node:worker_threads', 'node:perf_hooks', 'node:async_hooks',
    'node:inspector', 'node:v8', 'node:vm', 'node:repl',
  ],
  core: ['src/core/', '@core/'],
};

/**
 * Parse import statements from TypeScript/JavaScript source code.
 * Handles various import syntaxes:
 * - import X from 'module'
 * - import { X } from 'module'
 * - import * as X from 'module'
 * - const X = require('module')
 * - import('module') - dynamic imports
 *
 * Ignores commented-out imports.
 *
 * @param content - The source code content
 * @returns Array of parsed import statements
 */
export function parseImports(content: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    const trimmedLine = line.trim();

    // Skip commented lines
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || trimmedLine.startsWith('*')) {
      continue;
    }

    // Match ES6 import statements
    // import X from 'module'
    // import { X, Y } from 'module'
    // import * as X from 'module'
    const es6ImportMatch = line.match(/import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/);
    if (es6ImportMatch) {
      imports.push({
        source: es6ImportMatch[1],
        line: lineNumber,
        statement: line.trim(),
      });
      continue;
    }

    // Match CommonJS require statements
    // const X = require('module')
    // require('module')
    const requireMatch = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch) {
      imports.push({
        source: requireMatch[1],
        line: lineNumber,
        statement: line.trim(),
      });
      continue;
    }

    // Match dynamic imports
    // import('module')
    const dynamicImportMatch = line.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (dynamicImportMatch) {
      imports.push({
        source: dynamicImportMatch[1],
        line: lineNumber,
        statement: line.trim(),
      });
    }
  }

  return imports;
}

/**
 * Check if an import source matches any forbidden package pattern.
 *
 * @param source - The import source to check
 * @returns Object with match status and reason if forbidden
 */
export function checkForbiddenImport(source: string): { forbidden: boolean; reason?: string } {
  // Check for Inversify imports
  for (const pattern of FORBIDDEN_PACKAGES.inversify) {
    if (source.includes(pattern)) {
      return {
        forbidden: true,
        reason: 'Browser code cannot import Inversify DI container (Lambda-only)',
      };
    }
  }

  // Check for AWS SDK imports
  for (const pattern of FORBIDDEN_PACKAGES.awsSdk) {
    if (source.includes(pattern)) {
      return {
        forbidden: true,
        reason: 'Browser code cannot import AWS SDK (Lambda-only)',
      };
    }
  }

  // Check for Lambda runtime imports
  for (const pattern of FORBIDDEN_PACKAGES.lambda) {
    if (source.includes(pattern)) {
      return {
        forbidden: true,
        reason: 'Browser code cannot import AWS Lambda runtime packages (server-only)',
      };
    }
  }

  // Check for Node.js built-in imports
  for (const builtin of FORBIDDEN_PACKAGES.nodeBuiltins) {
    // Exact match for built-ins (to avoid false positives like 'path-to-regexp')
    if (source === builtin || source.startsWith(builtin + '/')) {
      return {
        forbidden: true,
        reason: 'Browser code cannot import Node.js built-in modules (server-only)',
      };
    }
  }

  // Check for src/core/ imports
  for (const pattern of FORBIDDEN_PACKAGES.core) {
    if (source.includes(pattern)) {
      return {
        forbidden: true,
        reason: 'Browser code cannot import server-side code from src/core/ (breaks browser compatibility)',
      };
    }
  }

  return { forbidden: false };
}

/**
 * Check if a file should be validated (is it browser code?).
 * Browser code includes:
 * - src/lib/ (public API, isomorphic)
 * - src/index.tsx (main entry point)
 *
 * @param filePath - The file path to check
 * @returns True if the file should be validated
 */
export function shouldValidateFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Check if file is in src/lib/
  if (normalizedPath.includes('src/lib/')) {
    return true;
  }

  // Check if file is src/index.tsx
  if (normalizedPath.endsWith('src/index.tsx') || normalizedPath.endsWith('src/index.ts')) {
    return true;
  }

  return false;
}

/**
 * Recursively find all TypeScript/JavaScript files in a directory.
 *
 * @param dir - The directory to search
 * @param fileList - Accumulator for found files
 * @returns Array of file paths
 */
export function findSourceFiles(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // Skip node_modules, build output, and test directories
      const skipDirs = [
        'node_modules',
        'dist',
        'out',
        'build',
        'cdk.out',
        '.serverless',
        '__tests__',
        'test',
        'tests',
        'coverage',
      ];
      if (!skipDirs.includes(file)) {
        findSourceFiles(filePath, fileList);
      }
    } else if (stat.isFile()) {
      // Include .ts, .tsx, .js, .jsx files
      if (/\.(ts|tsx|js|jsx)$/.test(file)) {
        fileList.push(filePath);
      }
    }
  }

  return fileList;
}

/**
 * Validate imports in a single file.
 *
 * @param filePath - The file to validate
 * @returns Array of import violations found in the file
 */
export function validateFileImports(filePath: string): ImportViolation[] {
  const violations: ImportViolation[] = [];

  // Only validate browser code
  if (!shouldValidateFile(filePath)) {
    return violations;
  }

  // Read file content
  const content = fs.readFileSync(filePath, 'utf-8');

  // Parse imports
  const imports = parseImports(content);

  // Check each import
  for (const imp of imports) {
    const check = checkForbiddenImport(imp.source);
    if (check.forbidden) {
      violations.push({
        file: filePath,
        line: imp.line,
        import: imp.statement,
        reason: check.reason!,
      });
    }
  }

  return violations;
}

/**
 * Validate imports across all files in a directory.
 *
 * @param rootDir - The root directory to validate (defaults to current working directory)
 * @returns Array of all import violations found
 */
export function validateImports(rootDir: string = process.cwd()): ImportViolation[] {
  const violations: ImportViolation[] = [];

  // Find all source files
  const files = findSourceFiles(rootDir);

  // Validate each file
  for (const file of files) {
    const fileViolations = validateFileImports(file);
    violations.push(...fileViolations);
  }

  return violations;
}

/**
 * Format violations for display.
 *
 * @param violations - Array of violations to format
 * @returns Formatted string for console output
 */
export function formatViolations(violations: ImportViolation[]): string {
  if (violations.length === 0) {
    return '✓ No import violations found';
  }

  let output = `\n${chalk.red('✗')} Found ${violations.length} import violation(s):\n\n`;

  for (const violation of violations) {
    output += `  ${violation.file}:${violation.line}\n`;
    output += `    → ${violation.import}\n`;
    output += `    → ${violation.reason}\n\n`;
  }

  output += 'Fix: Remove these imports or move code to src/core/\n';

  return output;
}

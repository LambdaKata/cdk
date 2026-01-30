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

import { Metafile } from 'esbuild';

/**
 * Information about a package included in the bundle.
 */
export interface PackageInfo {
  /** Package name (e.g., 'react', '@aws-sdk/client-s3') */
  name: string;
  /** Size in bytes contributed by this package */
  size: number;
  /** Percentage of total bundle size */
  percentage: number;
}

/**
 * Complete bundle analysis report.
 */
export interface BundleAnalysis {
  /** Total bundle size in bytes */
  totalSize: number;
  /** List of packages with their sizes, sorted by size descending */
  packages: PackageInfo[];
  /** Warnings about unexpected or problematic packages */
  warnings: string[];
}

/**
 * Server-side packages that should not appear in browser bundles.
 */
const SERVER_SIDE_PACKAGES = [
  'inversify',
  '@inversifyjs/',
  'reflect-metadata',
  '@aws-sdk/',
  'aws-lambda',
  '@aws-lambda-powertools/',
  '@middy/',
  '@aws-cdk/',
  'aws-cdk-lib',
  'constructs',
];

/**
 * Large UI libraries that may indicate bundle bloat.
 */
const LARGE_UI_LIBRARIES = [
  '@mui/material',
  '@mui/icons-material',
  '@emotion/react',
  '@emotion/styled',
  'material-ui',
];

/**
 * Extract package name from a node_modules path.
 * Handles both regular packages and scoped packages.
 *
 * Examples:
 * - 'node_modules/react/index.js' -> 'react'
 * - 'node_modules/@aws-sdk/client-s3/dist/index.js' -> '@aws-sdk/client-s3'
 * - 'src/lib/component.tsx' -> null
 *
 * @param inputPath - The file path from the metafile
 * @returns Package name or null if not from node_modules
 */
export function extractPackageName(inputPath: string): string | null {
  // Match node_modules/ followed by package name
  // For scoped packages: @scope/package
  // For regular packages: package
  const scopedMatch = inputPath.match(/node_modules\/(@[^/]+\/[^/]+)/);
  if (scopedMatch) {
    return scopedMatch[1];
  }

  const regularMatch = inputPath.match(/node_modules\/([^/]+)/);
  if (regularMatch) {
    return regularMatch[1];
  }

  return null;
}

/**
 * Check if a package is a server-side package that shouldn't be in browser bundles.
 *
 * @param packageName - The package name to check
 * @returns True if this is a server-side package
 */
export function isServerSidePackage(packageName: string): boolean {
  return SERVER_SIDE_PACKAGES.some(pattern => packageName.includes(pattern));
}

/**
 * Check if a package is a large UI library.
 *
 * @param packageName - The package name to check
 * @returns True if this is a large UI library
 */
export function isLargeUILibrary(packageName: string): boolean {
  return LARGE_UI_LIBRARIES.some(pattern => packageName.includes(pattern));
}

/**
 * Format bytes as human-readable size string.
 *
 * @param bytes - Size in bytes
 * @returns Formatted string (e.g., '1.2 MB', '450 KB')
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Analyze an esbuild metafile to extract package information and generate warnings.
 *
 * @param metafile - The esbuild metafile object
 * @returns Bundle analysis report
 */
export function analyzeBundleMetafile(metafile: Metafile): BundleAnalysis {
  const packages = new Map<string, number>();

  // Parse metafile outputs to extract package sizes
  for (const [outputPath, output] of Object.entries(metafile.outputs)) {
    if (!output.inputs) {
      continue;
    }

    for (const [inputPath, inputInfo] of Object.entries(output.inputs)) {
      const packageName = extractPackageName(inputPath);

      if (packageName) {
        const currentSize = packages.get(packageName) || 0;
        packages.set(packageName, currentSize + inputInfo.bytesInOutput);
      }
    }
  }

  // Convert to array and sort by size descending
  const packageList: PackageInfo[] = Array.from(packages.entries())
    .map(([name, size]) => ({
      name,
      size,
      percentage: 0, // Will be calculated after we know total size
    }))
    .sort((a, b) => b.size - a.size);

  // Calculate total size and percentages
  const totalSize = packageList.reduce((sum, pkg) => sum + pkg.size, 0);
  packageList.forEach(pkg => {
    pkg.percentage = totalSize > 0 ? (pkg.size / totalSize) * 100 : 0;
  });

  // Generate warnings
  const warnings: string[] = [];

  // Check for unexpected server-side packages
  for (const pkg of packageList) {
    if (isServerSidePackage(pkg.name)) {
      warnings.push(
        `Unexpected server-side package: ${pkg.name} (${formatSize(pkg.size)}) - should be externalized`,
      );
    }
  }

  // Check for large UI libraries
  for (const pkg of packageList) {
    if (isLargeUILibrary(pkg.name)) {
      warnings.push(
        `Large UI library detected: ${pkg.name} (${formatSize(pkg.size)}) - consider removing or tree-shaking`,
      );
    }
  }

  // Check total bundle size thresholds
  const MB = 1024 * 1024;
  if (totalSize > 2 * MB) {
    warnings.push(
      `Bundle size ${formatSize(totalSize)} exceeds 2MB target - consider optimizations`,
    );
  } else if (totalSize > 1.5 * MB) {
    warnings.push(
      `Bundle size ${formatSize(totalSize)} approaching 2MB target - monitor closely`,
    );
  }

  return {
    totalSize,
    packages: packageList,
    warnings,
  };
}

/**
 * Format bundle analysis as human-readable report.
 *
 * @param analysis - The bundle analysis to format
 * @param targetName - Name of the build target (e.g., 'React', 'Lambda')
 * @param topN - Number of top packages to display (default: 10)
 * @returns Formatted report string
 */
export function formatBundleAnalysis(
  analysis: BundleAnalysis,
  targetName: string = 'Bundle',
  topN: number = 10,
): string {
  let output = `\n${targetName} Bundle Analysis\n`;
  output += '='.repeat(targetName.length + 16) + '\n\n';

  output += `Total Size: ${formatSize(analysis.totalSize)}\n\n`;

  if (analysis.packages.length > 0) {
    output += `Top ${Math.min(topN, analysis.packages.length)} Packages:\n`;

    const displayPackages = analysis.packages.slice(0, topN);
    for (let i = 0; i < displayPackages.length; i++) {
      const pkg = displayPackages[i];
      const num = `${i + 1}.`.padEnd(4);
      const name = pkg.name.padEnd(30);
      const size = formatSize(pkg.size).padStart(10);
      const pct = `(${pkg.percentage.toFixed(1)}%)`.padStart(8);
      output += `  ${num}${name}${size}  ${pct}\n`;
    }

    if (analysis.packages.length > topN) {
      output += `  ... and ${analysis.packages.length - topN} more packages\n`;
    }
  } else {
    output += 'No packages found in bundle\n';
  }

  if (analysis.warnings.length > 0) {
    output += `\nWarnings:\n`;
    for (const warning of analysis.warnings) {
      output += `  ⚠ ${warning}\n`;
    }
  } else {
    output += `\n✓ No warnings\n`;
  }

  output += '\n';

  return output;
}

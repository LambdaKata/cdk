/*
 * MIT
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the MIT; see the LICENSE file
 * or https://choosealicense.com/licenses/mit/ for details.
 *
 * SPDX-License-Identifier: MIT
 */

import 'reflect-metadata';

import { build } from 'esbuild';

import { Maybe } from '@worktif/utils';

import { builds, completeBuildConfig } from './esbuild.config';
import { RuntimeEsbuildOptions } from './esbuild.types';
import { formatViolations, validateImports } from './validate-imports';
import { analyzeBundleMetafile, formatBundleAnalysis } from './analyze-bundle';
import chalk from 'chalk';

/**
 * An array of command-line arguments passed to the Node.js process, excluding the first two arguments (node binary and script path).
 * This typically contains user-defined input arguments provided when the script is executed.
 */
const args: string[] = process.argv.slice(2);

/**
 * A variable that holds the target argument retrieved from the list of arguments.
 * If the argument list contains a string that starts with '--target=', this variable
 * will store that string; otherwise, it will be undefined.
 *
 * The argument is typically used to specify a target configuration or destination value
 * for an operation.
 *
 * @type {string | undefined}
 */
const targetArg: Maybe<string> = args.find(arg => arg.startsWith('--target='));

/**
 * Represents an optional argument extracted from the input arguments that starts with '--test='.
 *
 * This variable's value is either a string containing the matched argument or `undefined` if no match is found.
 *
 * @type {Maybe<>> undefined}
 */
const testArg: Maybe<string> = args.find(arg => arg.startsWith('--test='));

/**
 * Extracts the value after the '=' character in the `targetArg` string, if it exists,
 * and casts it to be a key of the `builds` object.
 *
 * @type {keyof typeof builds | undefined}
 * Represents a key of the `builds` object or undefined if `targetArg` is not valid or does not contain '='.
 */
const target: Maybe<keyof typeof builds> = targetArg?.split('=')[1] as keyof typeof builds;

/**
 * A boolean variable indicating whether the application is running
 * in production mode. The value is determined by checking if the
 * `NODE_ENV` environment variable is set to 'production'.
 */
// const isProd: boolean = process.env.NODE_ENV === 'production';

const stageFilters = {
  keys: (key: string) => !['app', 'cdk', 'react'].includes(key),
};

const versionBuilds = {
  ...Object.fromEntries(
    Object.keys(builds)
      .filter(stageFilters.keys)
      .map((key: string) => [
        key,
        Object.assign(
          {},
          builds[key], {
            /* optional extra values */
          }),
      ]),
  ),
};


/**
 * A variable representing the selected builds based on the given target.
 *
 * If a target is specified, the selectedBuilds variable will contain
 * an object with a single property, where the key is the target and
 * the value is the corresponding entry from the builds object.
 *
 * If no target is specified, selectedBuilds will default to the
 * content of the versionBuilds variable.
 *
 * @type {Object}
 */
export const selectedBuilds: RuntimeEsbuildOptions = target
  ? { [target]: builds[target] }
  : versionBuilds;


/**
 * Asynchronously iterates through a collection of build configurations and executes the build process for each entry.
 *
 * For every configuration in `selectedBuilds`, the method:
 * - Logs an error and exits the process if the configuration is invalid or undefined.
 * - Runs import validation for React builds to prevent server-side code in browser bundles.
 * - Logs a build start message for the specific target.
 * - Executes the `build` function with shared and specific configuration properties.
 * - Logs a success message upon build completion.
 *
 * Assumes `selectedBuilds` is an object where keys represent target names and values are configuration objects.
 *
 * Each configuration object may include the following optional properties:
 * - `entryPoints`: An array or object specifying the entry point(s) for the build.
 * - `outfile`: A string indicating the output file path for the build.
 * - `loaders`: An object specifying loaders for different file extensions.
 *
 * Utilizes a shared configuration object, `shared`, which provides global build settings.
 */
(async () => {
  const fs = await import('fs');
  const startTime = Date.now();
  const results: Array<{ name: string; outfile: string; size: number }> = [];

  for (const [name, config] of Object.entries(selectedBuilds)) {
    if (!config) {
      console.error(`Unknown target: ${name}`);
      process.exit(1);
    }

    // Run import validation before React build
    if (name === 'react') {
      console.log('Validating imports for browser bundle...');
      const violations = validateImports();

      if (violations.length > 0) {
        console.error(formatViolations(violations));
        console.error(`\n ${chalk.red('✗')} Build failed: Import validation errors must be fixed before building React bundle `);
        process.exit(1);
      }

      console.log('✓ Import validation passed\n');
    }

    console.log(`Building ${name}...`);
    const { loaders, label, ...buildConfig } = config;
    const result = await build(
      completeBuildConfig(buildConfig),
    );

    // Save metafile if generated (for bundle analysis)
    if (result.metafile && config.outfile) {
      const metafilePath = config.outfile.replace(/\.(js|cjs)$/, '.meta.json');
      fs.writeFileSync(metafilePath, JSON.stringify(result.metafile, null, 2));
      console.log(`  Metafile saved: ${metafilePath}`);

      // Run bundle analysis for React builds
      if (name === 'react') {
        console.log('\nAnalyzing React bundle...');
        const analysis = analyzeBundleMetafile(result.metafile);
        const report = formatBundleAnalysis(analysis, 'React');
        console.log(report);

        // Display warnings prominently if bundle size exceeds threshold
        if (analysis.warnings.length > 0) {
          const sizeWarnings = analysis.warnings.filter(w => w.includes('exceeds') || w.includes('approaching'));
          if (sizeWarnings.length > 0) {
            console.log(`${chalk.yellow('!')} Bundle Size Warning:`);
            sizeWarnings.forEach(w => console.log(`   ${w}`));
            console.log('');
          }
        }
      }
    }

    // Get file size
    let size = 0;
    try {
      const stats = fs.statSync(config.outfile);
      size = stats.size;
    } catch {
      // File size unavailable
    }

    results.push({ name, outfile: config.outfile, size });
  }

  // Display summary
  const duration = Date.now() - startTime;
  console.log(`\nBuild complete (${(duration / 1000).toFixed(1)}s)\n`);
  console.log('Artifacts:');

  for (const result of results) {
    const sizeStr = formatSize(result.size);
    console.log(`  ${result.outfile} (${sizeStr})`);
  }
  console.log('');
})().catch((e) => {
  console.error('Build failed:', e);
  process.exit(1);
});

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}


// /**
//  * Represents the value extracted and parsed from the second portion of a string
//  * split by the "=" character.
//  *
//  * The value of `testInstance` is derived by checking if `testArg` is defined
//  * or not (`testArg?.`). If `testArg` is defined, it is split at the "="
//  * character, and the second part of the split (index 1) is assigned to
//  * `testInstance`. It is then explicitly cast to a string type.
//  *
//  * This variable is useful for parsing key-value pairs or similar string
//  * structures where the equal sign serves as a delimiter.
//  */
// const testInstance: string = testArg?.split('=')[1] as string;

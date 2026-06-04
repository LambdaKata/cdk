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

/**
 * Guard test — the run-time runner package (`src/benchmark/runner/`) MUST remain
 * free of `aws-cdk-lib` and `constructs` imports (Req 18 host, task 16).
 *
 * This is the "build/lint guard or test" the task requires. The runner is the
 * standalone, CDK-free half of the harness (it imports the AWS SDK only); any
 * `aws-cdk-lib`/`constructs` import would collapse the two-compilation-worlds
 * boundary and pull CDK into the runner. The test statically scans every `.ts`
 * source file under the runner subtree and fails — naming the offending file —
 * if a forbidden import appears in either `import ... from '...'` or
 * `require('...')` form.
 *
 * **Validates: Requirements 10.3, 18 (host)**
 *
 * @module benchmark-runner-cdk-free.test
 */

import * as fs from 'fs';
import * as path from 'path';

/** Absolute path to the run-time runner subtree, resolved from the test file. */
const RUNNER_DIR = path.resolve(__dirname, '..', 'src', 'benchmark', 'runner');

/** Modules the runner package is forbidden from importing (Req 18 host). */
const FORBIDDEN_MODULES = ['aws-cdk-lib', 'constructs'] as const;

/**
 * Recursively collect every `.ts` file under `dir`.
 */
function collectTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Build a matcher for a forbidden module that catches both bare imports and
 * subpath imports (e.g. `aws-cdk-lib` and `aws-cdk-lib/aws-s3`), in either
 * `import ... from '...'`/`import '...'` or `require('...')` form, with single
 * or double quotes.
 */
function forbiddenImportPattern(moduleName: string): RegExp {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // module specifier: the bare name optionally followed by a `/subpath`.
  const specifier = `${escaped}(?:/[^'"]*)?`;
  // `from '<spec>'` | `import '<spec>'` | `require('<spec>')`.
  return new RegExp(
    `(?:from|import)\\s*['"]${specifier}['"]|require\\(\\s*['"]${specifier}['"]\\s*\\)`,
  );
}

describe('runner package is CDK-free (Req 18 host)', () => {
  const files = collectTsFiles(RUNNER_DIR);

  it('finds runner source files to scan', () => {
    // Guard against the scan silently passing because it found nothing.
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN_MODULES)(
    'no file under src/benchmark/runner/ imports %s',
    (moduleName) => {
      const pattern = forbiddenImportPattern(moduleName);
      const offenders = files.filter((file) =>
        pattern.test(fs.readFileSync(file, 'utf8')),
      );

      expect(offenders).toEqual([]);
      // Belt-and-suspenders: an explicit, named failure message if it regresses.
      if (offenders.length > 0) {
        const relative = offenders
          .map((file) => path.relative(RUNNER_DIR, file))
          .join(', ');
        throw new Error(
          `Forbidden import of '${moduleName}' found in runner file(s): ${relative}. ` +
          'The runner package must remain free of aws-cdk-lib / constructs.',
        );
      }
    },
  );
});

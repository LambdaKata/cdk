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

import { formatViolations, validateImports } from './validate-imports';

/**
 * CLI tool to run import validation on the codebase.
 * Usage: ts-node bin/deploy/cloud.build/run-validation.ts
 */
function main() {
  console.log('  Validating imports in browser code...\n');

  const violations = validateImports();

  console.log(formatViolations(violations));

  if (violations.length > 0) {
    process.exit(1);
  }
}

main();

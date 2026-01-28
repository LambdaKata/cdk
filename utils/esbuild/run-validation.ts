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

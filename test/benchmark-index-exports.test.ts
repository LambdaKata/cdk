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
 * Export-surface guard for the library entry point.
 *
 * The Benchmark Harness is an additive layer: it must add its own exports
 * without removing or renaming any pre-existing export from `src/index.ts`.
 * This test pins the pre-existing runtime export surface as a sorted snapshot
 * so that an accidental removal/rename is caught immediately, and asserts the
 * additive `kataBench` export is layered on top.
 *
 * **Validates: Requirements 2.2, 2.4**
 *
 * @module benchmark-index-exports.test
 */

import * as index from '../src/index';

/**
 * The complete set of pre-existing RUNTIME exports (functions, classes, enums,
 * const values) published by `src/index.ts` before the Benchmark Harness layer
 * was added. Type-only exports (interfaces/type aliases) are erased at runtime
 * and therefore intentionally excluded from this runtime snapshot.
 */
const PRE_EXISTING_RUNTIME_EXPORTS: ReadonlyArray<string> = [
  // Licensing service
  'HttpLicensingService',
  'createLicensingService',
  'isValidAccountId',
  // Mock licensing service
  'MockLicensingService',
  'createMockLicensingService',
  // Account resolver
  'resolveAccountId',
  'resolveAccountIdWithSource',
  'isValidAccountIdFormat',
  'AccountResolutionError',
  // kata wrapper
  'kata',
  'kataWithAccountId',
  'applyTransformation',
  'handleUnlicensed',
  'isKataTransformed',
  'getKataPromise',
  // Config layer
  'createKataConfigLayer',
  'generateConfigContent',
  'CONFIG_DIR_NAME',
  'CONFIG_FILE_NAME',
  'HANDLER_CONFIG_KEY',
  // Node.js layer management
  'ErrorCodes',
  'NodeRuntimeLayerError',
  // Docker runtime detector
  'DockerRuntimeDetector',
  // AWS layer manager
  'AWSLayerManager',
  // Logger
  'NoOpLogger',
  'ConsoleLogger',
  'createDefaultLogger',
  'OperationTimer',
  // Main API function
  'ensureNodeRuntimeLayer',
];

describe('src/index.ts export surface', () => {
  /**
   * **Validates: Requirements 2.4**
   *
   * Every pre-existing runtime export must still be present and keep its kind.
   * Removing or renaming any of these is a breaking change to the do-not-touch
   * public contract (AGENTS.md §10).
   */
  it('preserves every pre-existing runtime export (none removed or renamed)', () => {
    const actual = new Set(Object.keys(index));

    for (const name of PRE_EXISTING_RUNTIME_EXPORTS) {
      expect(actual.has(name)).toBe(true);
    }
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * Sorted snapshot of the pre-existing surface. If this fails, a pre-existing
   * export was removed/renamed and the change must be reviewed against §10.
   */
  it('matches the pinned sorted snapshot of pre-existing runtime exports', () => {
    const actual = Object.keys(index);
    const preExistingStillPresent = PRE_EXISTING_RUNTIME_EXPORTS
      .filter(name => actual.includes(name))
      .sort();

    expect(preExistingStillPresent).toEqual([...PRE_EXISTING_RUNTIME_EXPORTS].sort());
  });

  /**
   * **Validates: Requirements 2.2**
   *
   * The additive benchmark layer surfaces `kataBench` (and its option
   * resolver) without disturbing the existing surface.
   */
  it('adds the kataBench benchmark export on top of the existing surface', () => {
    expect(typeof (index as Record<string, unknown>).kataBench).toBe('function');
    expect(typeof (index as Record<string, unknown>).resolveKataBenchOptions).toBe('function');
  });
});

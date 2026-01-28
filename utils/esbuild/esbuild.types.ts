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

import 'reflect-metadata';
import { BuildOptions, Loader, Plugin } from 'esbuild';

/**
 * Represents the configuration options for a RuntimeEsbuild build process.
 * This type extends the `BuildOptions` interface and includes additional
 * properties to further customize the behavior.
 *
 * @typedef {BuildOptions} RuntimeEsbuildOptions
 *
 * @property {Object.<string, Loader>} [loaders] - An optional mapping of file extensions
 * to loaders, where the key is the file extension, and the value is the specific loader to use.
 *
 * @property {string} [label] - An optional label for the build process, which can be used for
 * logging or identification purposes.
 */
export type RuntimeEsbuildOptions = BuildOptions & {
  isProd?: boolean;
  loaders?: { [ext: string]: Loader };
  label?: string;
  plugins?: Plugin[];
}

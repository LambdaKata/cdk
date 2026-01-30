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

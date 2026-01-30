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

/**
 * Test middleware for unit tests
 * This middleware simply returns the handler from the bundle based on the originalHandler path
 */
export default function middleware(bundle: unknown, context: { originalHandler: string }): Function {
    const handlerName = context.originalHandler.split('.').pop() || 'handler';
    return (bundle as Record<string, Function>)[handlerName];
}

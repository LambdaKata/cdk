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

/*
 * Simple test handler for integration tests
 */

export const handler = async (event: any, context: any) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Hello from Lambda Kata!',
      event,
      context: {
        requestId: context.requestId,
        functionName: context.functionName,
      },
    }),
  };
};

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
 * Layer C — Lambda Function URL trigger adapter (Req 8.7, 9.1, 9.3, 9.4, 7.3).
 *
 * Function URL is a Request_Response_Source: no poll-based event source is
 * provisioned and no `Enabled` flag is toggled. The run-time generator issues
 * HTTPS requests to the variant under test. When the clone already exposes a
 * Function URL, the adapter repoints it at the SnapStart alias via its
 * `Qualifier` — mirroring the InvokePathRewriter (task 6) — so the
 * request-response benchmark exercises SnapStart rather than `$LATEST`
 * (Req 7.3). Creating a brand-new Function URL is out of scope here; the adapter
 * wires the alias qualifier onto an existing clone URL when present.
 *
 * @remarks
 * Validates: Requirements 8.7, 9.1, 9.3, 9.4, 7.3
 *
 * @module benchmark/triggers/function-url
 */

import { CfnUrl } from 'aws-cdk-lib/aws-lambda';

import { AbstractTriggerAdapter } from './adapter-base';
import { DEFAULT_KATA_ALIAS_NAME } from '../invoke-path-rewriter';
import type { AdapterProvisionResult, AdapterSynthContext, FunctionUrlTrigger } from './types';

/**
 * Lambda Function URL adapter (request-response, Req 8.7, 9.4, 7.3).
 */
export class FunctionUrlTriggerAdapter extends AbstractTriggerAdapter<FunctionUrlTrigger> {
  /** The trigger discriminant this adapter handles. */
  public readonly type = 'functionUrl' as const;

  /**
   * Repoint an existing clone Function URL at the alias qualifier and report
   * the request-response contract; no benchmark source is created.
   *
   * @param context - The synth-time context.
   * @param _declaration - The Function URL declaration.
   * @returns The request-response provision result (no source, no mappings).
   */
  public provision(
    context: AdapterSynthContext,
    _declaration: FunctionUrlTrigger,
  ): AdapterProvisionResult {
    const kataFunction = this.requireKataFunction(context);

    // If the clone owns a Function URL, point it at the alias via Qualifier so
    // the benchmark exercises SnapStart (Req 7.3). The URL is a descendant of
    // the function construct; absent one, nothing is rewritten.
    if (context.kataAliasArnRef !== undefined) {
      for (const node of kataFunction.node.findAll()) {
        if (CfnUrl.isCfnUrl(node)) {
          node.qualifier = DEFAULT_KATA_ALIAS_NAME;
        }
      }
    }

    return { routingClass: 'request-response', isolated: false };
  }
}

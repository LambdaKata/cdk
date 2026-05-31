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
 * Documentation-as-tests.
 *
 * Compiles every TypeScript code block from the project README files against
 * the real public API using the repository's strict tsconfig. This guarantees
 * that a snippet copied verbatim from the docs type-checks in the same context
 * a user would paste it into.
 *
 * - Positive blocks (module / declaration / resolverProperty / statement) MUST
 *   compile with zero diagnostics.
 * - Negative blocks (documented anti-patterns marked with ❌) MUST fail to
 *   compile, keeping "this will throw / fail" guidance honest.
 *
 * @module readme-docs.test
 */

import * as path from 'path';

import {
  CompiledBlock,
  compileDocBlocks,
  discoverReadmeFiles,
  extractTsBlocks,
} from './doc-compiler';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Renders diagnostics with README file:line coordinates for actionable failures. */
function formatDiagnostics(block: CompiledBlock): string {
  const header = `Code block ${block.id} (${block.relFile}, kind=${block.kind}) failed to compile:`;
  const lines = block.diagnostics.map((d) => `  - ${block.relFile}:${d.readmeLine}: ${d.message}`);
  return [header, ...lines].join('\n');
}

describe('README documentation compiles against the real API', () => {
  const readmeFiles = discoverReadmeFiles(REPO_ROOT);
  const allBlocks = readmeFiles.flatMap((file) => extractTsBlocks(file, REPO_ROOT));
  const compiled = compileDocBlocks(allBlocks, REPO_ROOT);

  it('discovers README files and TypeScript blocks to verify', () => {
    expect(readmeFiles.length).toBeGreaterThan(0);
    expect(compiled.length).toBeGreaterThan(0);
  });

  const positives = compiled.filter((b) => b.kind !== 'negative');
  const negatives = compiled.filter((b) => b.kind === 'negative');

  describe('positive examples must type-check verbatim', () => {
    it.each(positives.map((b) => [b.id, b] as const))(
      'compiles %s',
      (_id, block) => {
        if (block.diagnostics.length > 0) {
          throw new Error(formatDiagnostics(block));
        }
        expect(block.diagnostics).toHaveLength(0);
      },
    );
  });

  describe('documented anti-patterns must NOT type-check', () => {
    it.each(negatives.map((b) => [b.id, b] as const))(
      'rejects %s',
      (_id, block) => {
        expect(block.diagnostics.length).toBeGreaterThan(0);
      },
    );
  });
});

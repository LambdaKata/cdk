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
 * Documentation-as-tests harness.
 *
 * This module extracts every TypeScript fenced code block from the project's
 * README files and compiles each one against the REAL public API (the
 * `@lambdakata/cdk` entry point is mapped to `src/index.ts`) using the exact
 * compiler options from the repository `tsconfig.json` (strict mode included).
 *
 * The goal is a char-for-char guarantee: a snippet shown in the docs must
 * compile in the same context a user would copy-paste it into. Snippets come
 * in several shapes, so each block is placed into a minimal, realistic context
 * WITHOUT modifying the block's own characters:
 *
 * - `module`           — a self-contained block with its own imports; compiled verbatim.
 * - `declaration`      — a `type`/`interface` definition; compiled verbatim (module-scoped).
 * - `resolverProperty` — a bare `handlerResolver: ...` property; wrapped in `kata(fn, { ... })`
 *                        so the resolver receives its documented contextual types.
 * - `statement`        — a `kata(myFunction, { ... })` call; given a tiny preamble that
 *                        declares `kata`, `myFunction`, and `path`.
 * - `negative`         — a documented anti-pattern (marked with the ❌ glyph); asserted to
 *                        NOT compile, which keeps the "this will fail" guidance honest.
 *
 * @module doc-compiler
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/** The classification of a documentation code block. */
export type BlockKind = 'module' | 'declaration' | 'resolverProperty' | 'statement' | 'negative';

/** A TypeScript code block extracted from a README file. */
export interface DocBlock {
  /** Stable identifier: `<relativeFile>#<indexWithinFile>`. */
  id: string;
  /** Absolute path to the source README. */
  file: string;
  /** Path relative to the repository root (for readable diagnostics). */
  relFile: string;
  /** 1-based line number in the README of the first line of code inside the fence. */
  contentStartLine: number;
  /** The verbatim block content (exactly as written between the fences). */
  code: string;
  /** How the block is compiled. */
  kind: BlockKind;
}

/** A single TypeScript diagnostic mapped back to README coordinates. */
export interface DocDiagnostic {
  /** 1-based line number in the original README. */
  readmeLine: number;
  /** Flattened compiler message. */
  message: string;
}

/** A doc block after compilation, including any diagnostics it produced. */
export interface CompiledBlock extends DocBlock {
  /** Synthetic file name used inside the in-memory program. */
  syntheticName: string;
  /** Number of preamble lines prepended before the verbatim block content. */
  preambleLineCount: number;
  /** Diagnostics produced by the block, mapped back to README lines. */
  diagnostics: DocDiagnostic[];
}

/** Preamble for `statement` (and `negative`) blocks. */
const STATEMENT_PREAMBLE: readonly string[] = [
  "import { kata } from '@lambdakata/cdk';",
  "import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';",
  "import * as path from 'path';",
  'declare const myFunction: LambdaFunction;',
];

/** Head lines wrapped around a `resolverProperty` block (closed with `});`). */
const RESOLVER_PREAMBLE: readonly string[] = [
  "import { kata } from '@lambdakata/cdk';",
  "import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';",
  'declare const __fn: LambdaFunction;',
  'kata(__fn, {',
];

/**
 * Classifies a code block based purely on its content.
 *
 * @param code - The verbatim block content.
 * @returns The block kind used to select a compilation context.
 */
export function classify(code: string): BlockKind {
  if (code.includes('❌')) {
    return 'negative';
  }
  const trimmed = code.replace(/^\s+/, '');
  if (/^import\s/m.test(code)) {
    return 'module';
  }
  if (trimmed.startsWith('type ') || trimmed.startsWith('interface ')) {
    return 'declaration';
  }
  if (trimmed.startsWith('handlerResolver:')) {
    return 'resolverProperty';
  }
  return 'statement';
}

/**
 * Extracts all TypeScript fenced code blocks from a single README file.
 *
 * @param absFile - Absolute path to the README.
 * @param repoRoot - Absolute path to the repository root.
 * @returns The list of extracted blocks in document order.
 */
export function extractTsBlocks(absFile: string, repoRoot: string): DocBlock[] {
  const text = fs.readFileSync(absFile, 'utf-8');
  const lines = text.split('\n');
  const relFile = path.relative(repoRoot, absFile);
  const blocks: DocBlock[] = [];
  let counter = 0;
  let i = 0;

  while (i < lines.length) {
    const fence = /^```(\w*)\s*$/.exec(lines[i]);
    if (!fence) {
      i++;
      continue;
    }

    const lang = fence[1].toLowerCase();
    const start = i + 1; // 0-based index of the first content line
    let j = start;
    while (j < lines.length && !/^```\s*$/.test(lines[j])) {
      j++;
    }

    if (lang === 'ts' || lang === 'typescript') {
      const code = lines.slice(start, j).join('\n');
      blocks.push({
        id: `${relFile}#${counter++}`,
        file: absFile,
        relFile,
        contentStartLine: start + 1, // convert to 1-based
        code,
        kind: classify(code),
      });
    }

    i = j + 1;
  }

  return blocks;
}

/**
 * Recursively discovers README files that document the public API.
 *
 * Scope: the root README and every README under `examples/`.
 *
 * @param repoRoot - Absolute path to the repository root.
 * @returns Absolute paths to the discovered README files.
 */
export function discoverReadmeFiles(repoRoot: string): string[] {
  const found: string[] = [];

  const rootReadme = path.join(repoRoot, 'README.md');
  if (fs.existsSync(rootReadme)) {
    found.push(rootReadme);
  }

  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === 'README.md') {
        found.push(full);
      }
    }
  };

  walk(path.join(repoRoot, 'examples'));
  return found;
}

/** Builds the synthetic source for a block and reports the preamble size. */
function buildSynthetic(block: DocBlock): { source: string; preambleLineCount: number } {
  switch (block.kind) {
    case 'module':
      return { source: block.code, preambleLineCount: 0 };
    case 'declaration':
      // Append an empty export so each declaration is module-scoped and
      // identically-named types across files do not collide in global scope.
      return { source: `${block.code}\nexport {};`, preambleLineCount: 0 };
    case 'resolverProperty': {
      const head = RESOLVER_PREAMBLE.join('\n');
      return { source: `${head}\n${block.code}\n});`, preambleLineCount: RESOLVER_PREAMBLE.length };
    }
    case 'statement':
    case 'negative': {
      const head = STATEMENT_PREAMBLE.join('\n');
      return { source: `${head}\n${block.code}`, preambleLineCount: STATEMENT_PREAMBLE.length };
    }
  }
}

/** Loads compiler options from the repo tsconfig and points the package at src. */
function loadCompilerOptions(repoRoot: string): ts.CompilerOptions {
  const configPath = path.join(repoRoot, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, repoRoot);
  return {
    ...parsed.options,
    noEmit: true,
    declaration: false,
    baseUrl: repoRoot,
    paths: {
      '@lambdakata/cdk': ['src/index.ts'],
      '@lambdakata/cdk/*': ['src/*'],
    },
  };
}

/**
 * Compiles all blocks in a single in-memory TypeScript program and maps any
 * diagnostics back to README coordinates.
 *
 * @param blocks - Blocks extracted from the README files.
 * @param repoRoot - Absolute path to the repository root.
 * @returns The blocks enriched with their diagnostics.
 * @throws If the compiler reports a global (non file-bound) diagnostic.
 */
export function compileDocBlocks(blocks: DocBlock[], repoRoot: string): CompiledBlock[] {
  const synthDir = path.join(repoRoot, '__doctests_virtual__');
  const fileContents = new Map<string, string>();
  const prepared: Omit<CompiledBlock, 'diagnostics'>[] = [];

  blocks.forEach((block, index) => {
    const { source, preambleLineCount } = buildSynthetic(block);
    const syntheticName = path.join(synthDir, `block_${index}.ts`);
    fileContents.set(syntheticName, source);
    prepared.push({ ...block, syntheticName, preambleLineCount });
  });

  const options = loadCompilerOptions(repoRoot);
  const host = ts.createCompilerHost(options);

  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreate) => {
    const synthetic = fileContents.get(fileName);
    if (synthetic !== undefined) {
      return ts.createSourceFile(fileName, synthetic, ts.ScriptTarget.ES2022, true);
    }
    return originalGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreate);
  };

  const originalFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => fileContents.has(fileName) || originalFileExists(fileName);

  const originalReadFile = host.readFile.bind(host);
  host.readFile = (fileName) => (fileContents.has(fileName) ? fileContents.get(fileName) : originalReadFile(fileName));

  const program = ts.createProgram(Array.from(fileContents.keys()), options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const byFile = new Map<string, ts.Diagnostic[]>();
  const globals: ts.Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.file) {
      const bucket = byFile.get(diagnostic.file.fileName) ?? [];
      bucket.push(diagnostic);
      byFile.set(diagnostic.file.fileName, bucket);
    } else {
      globals.push(diagnostic);
    }
  }

  if (globals.length > 0) {
    const messages = globals.map((g) => ts.flattenDiagnosticMessageText(g.messageText, '\n')).join('; ');
    throw new Error(`Doctest harness produced global TypeScript diagnostics: ${messages}`);
  }

  return prepared.map((block) => {
    const fileDiagnostics = byFile.get(block.syntheticName) ?? [];
    const mapped: DocDiagnostic[] = fileDiagnostics.map((diagnostic) => {
      const sourceFile = diagnostic.file as ts.SourceFile;
      const { line } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      const readmeLine = block.contentStartLine + line - block.preambleLineCount;
      return {
        readmeLine,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      };
    });
    return { ...block, diagnostics: mapped };
  });
}

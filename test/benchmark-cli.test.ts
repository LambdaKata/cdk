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
 * Smoke tests for the `lambda-kata-bench` CLI (Layer D, task 24).
 *
 * Tests exercise the CLI command handlers with MOCKED dependencies — no AWS, no
 * network, no CDK. Each test verifies correct argument parsing, mode resolution,
 * and delegation to the injected subsystems.
 *
 * **Validates: Requirements 18.5, 18.6, 18.7**
 *
 * @module benchmark-cli.test
 */

import {
  parseArgs,
  handleRun,
  handleReport,
  handleCleanup,
  CliError,
  type ParsedArgs,
  type RunDependencies,
  type ReportDependencies,
  type CleanupDependencies,
} from '../src/benchmark/runner/cli';
import type { BenchmarkManifest } from '../src/benchmark/manifest';
import type { RunnerOptions } from '../src/benchmark/runner/runner';

// ── Test fixtures ────────────────────────────────────────────────────────────

/** Minimal valid manifest for tests. */
const FIXTURE_MANIFEST: BenchmarkManifest = {
  schemaVersion: 1,
  benchRunSeed: 'test-run-id-123',
  region: 'us-east-1',
  fidelity: 'L0' as BenchmarkManifest['fidelity'],
  sideEffectPolicy: 'unsafe',
  ownershipTag: { key: 'lambda-kata:bench-run-id', value: 'test-run-id-123' },
  variants: [
    {
      constructPath: 'Stack/MyFunc',
      baseline: {
        functionName: 'my-func',
        functionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-func',
        logGroup: '/aws/lambda/my-func',
      },
      kata: {
        functionName: 'my-func-kata',
        functionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-func-kata',
        aliasArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-func-kata:kata',
        version: '1',
        logGroup: '/aws/lambda/my-func-kata',
      },
    },
  ],
  runDesign: {} as BenchmarkManifest['runDesign'],
};

// ── parseArgs tests ──────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses a minimal run command', () => {
    const result = parseArgs(['run', '--manifest', 'my-param']);
    expect(result.command).toBe('run');
    expect(result.manifest).toBe('my-param');
    expect(result.observeOnly).toBe(false);
    expect(result.benchmark).toBe(false);
    expect(result.productionCanary).toBe(false);
  });

  it('parses --observe-only flag', () => {
    const result = parseArgs(['run', '--manifest', 'p', '--observe-only']);
    expect(result.observeOnly).toBe(true);
  });

  it('parses --benchmark flag', () => {
    const result = parseArgs(['run', '--manifest', 'p', '--benchmark']);
    expect(result.benchmark).toBe(true);
  });

  it('parses --production-canary with --ack-production-canary', () => {
    const result = parseArgs([
      'run', '--manifest', 'p',
      '--production-canary', '--ack-production-canary',
    ]);
    expect(result.productionCanary).toBe(true);
    expect(result.ackProductionCanary).toBe(true);
  });

  it('parses optional flags: region, max-duration-ms, batch-size, concurrency', () => {
    const result = parseArgs([
      'run', '--manifest', 'p',
      '--region', 'eu-west-1',
      '--max-duration-ms', '60000',
      '--batch-size', '20',
      '--concurrency', '5',
    ]);
    expect(result.region).toBe('eu-west-1');
    expect(result.maxDurationMs).toBe(60000);
    expect(result.batchSize).toBe(20);
    expect(result.concurrency).toBe(5);
  });

  it('throws CliError for unknown command', () => {
    expect(() => parseArgs(['unknown', '--manifest', 'p'])).toThrow(CliError);
  });

  it('throws CliError for missing --manifest', () => {
    expect(() => parseArgs(['run'])).toThrow(CliError);
  });

  it('throws CliError for unknown flags', () => {
    expect(() => parseArgs(['run', '--manifest', 'p', '--unknown'])).toThrow(CliError);
  });
});

// ── handleRun tests ──────────────────────────────────────────────────────────

describe('handleRun', () => {
  let captured: RunnerOptions | undefined;
  let runDeps: RunDependencies;

  beforeEach(() => {
    captured = undefined;
    runDeps = {
      runBenchmark: async (opts: RunnerOptions) => {
        captured = opts;
      },
    };
  });

  it('defaults to observe-only mode when no mode flag (Req 18.5)', async () => {
    const args = parseArgs(['run', '--manifest', 'my-ssm-param']);
    await handleRun(args, runDeps);

    expect(captured).toBeDefined();
    expect(captured!.mode).toBe('observe-only');
    expect(captured!.manifestParameterName).toBe('my-ssm-param');
    expect(captured!.productionCanaryOptIn).toBeUndefined();
  });

  it('sets mode to benchmark when --benchmark is passed', async () => {
    const args = parseArgs(['run', '--manifest', 'p', '--benchmark']);
    await handleRun(args, runDeps);

    expect(captured!.mode).toBe('benchmark');
  });

  it('sets mode to production-canary with acknowledged opt-in when both flags present', async () => {
    const args = parseArgs([
      'run', '--manifest', 'p',
      '--production-canary', '--ack-production-canary',
    ]);
    await handleRun(args, runDeps);

    expect(captured!.mode).toBe('production-canary');
    expect(captured!.productionCanaryOptIn).toEqual({ acknowledged: true });
  });

  it('throws CliError when --production-canary is used WITHOUT --ack-production-canary (Req 18.7)', async () => {
    const args = parseArgs([
      'run', '--manifest', 'p', '--production-canary',
    ]);

    await expect(handleRun(args, runDeps)).rejects.toThrow(CliError);
    expect(captured).toBeUndefined(); // runBenchmark was NOT called
  });

  it('passes region, maxDurationMs, batchSize, concurrency to runBenchmark', async () => {
    const args = parseArgs([
      'run', '--manifest', 'p',
      '--region', 'ap-south-1',
      '--max-duration-ms', '30000',
      '--batch-size', '50',
      '--concurrency', '10',
    ]);
    await handleRun(args, runDeps);

    expect(captured!.region).toBe('ap-south-1');
    expect(captured!.maxRunDurationMs).toBe(30000);
    expect(captured!.batchSize).toBe(50);
    expect(captured!.concurrency).toBe(10);
  });
});

// ── handleReport tests ───────────────────────────────────────────────────────

describe('handleReport', () => {
  it('loads manifest, collects metrics from each variant log group, renders report', async () => {
    const readCalls: string[] = [];
    const reportDeps: ReportDependencies = {
      loadManifest: async () => FIXTURE_MANIFEST,
      readLogEvents: async (query) => {
        readCalls.push(query.logGroupName);
        // Return a sample REPORT line.
        return [
          'REPORT RequestId: abc-123\tDuration: 50.00 ms\tBilled Duration: 100 ms\tMemory Size: 128 MB\tMax Memory Used: 64 MB\n',
        ];
      },
      renderReport: (samples) => ({
        json: JSON.stringify({ sampleCount: samples.length }),
        html: '<html></html>',
      }),
    };

    const args = parseArgs(['report', '--manifest', 'my-param']);
    // Suppress console.log output during test.
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
    await handleReport(args, reportDeps);
    consoleSpy.mockRestore();

    // Should have read both baseline and kata log groups.
    expect(readCalls).toEqual(['/aws/lambda/my-func', '/aws/lambda/my-func-kata']);
  });
});

// ── handleCleanup tests ──────────────────────────────────────────────────────

describe('handleCleanup', () => {
  it('loads manifest and calls cleanupRun with the bench run seed', async () => {
    let cleanedBenchRunId: string | undefined;
    const cleanupDeps: CleanupDependencies = {
      loadManifest: async () => FIXTURE_MANIFEST,
      cleanupRun: async (benchRunId) => {
        cleanedBenchRunId = benchRunId;
      },
    };

    const args = parseArgs(['cleanup', '--manifest', 'my-param']);
    await handleCleanup(args, cleanupDeps);

    expect(cleanedBenchRunId).toBe('test-run-id-123');
  });
});

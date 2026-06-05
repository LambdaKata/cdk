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
 * Layer D — `lambda-kata-bench` CLI entry (run-time, CDK-free).
 *
 * Wires the run / report / cleanup commands over the runner subsystems, reading
 * the manifest by SSM pointer and exposing observe-only as the default mode.
 * Uses dependency injection for testability: command handlers accept a
 * dependencies object; `main` wires production defaults.
 *
 * @remarks
 * Validates: Requirements 18.5, 18.6, 18.7
 *
 * @module benchmark/runner/cli
 */

import { runBenchmark, type RunMode, type RunnerOptions, type ProductionCanaryOptIn } from './runner';
import { ManifestLoader } from './manifest-loader';
import { collectMetrics } from './metrics-collector';
import { renderReport } from './report-renderer';
import { cleanupRun } from './lifecycle-manager';
import type { BenchmarkManifest } from '../manifest';
import type { ReportSample } from './types';
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';

// ── CliError ─────────────────────────────────────────────────────────────────

/**
 * Named error class for CLI-specific failures — invalid arguments, missing
 * flags, or gating violations (e.g. production-canary without acknowledgement).
 */
export class CliError extends Error {
  public readonly name = 'CliError';

  public constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, CliError.prototype);
  }
}

// ── Parsed CLI arguments ─────────────────────────────────────────────────────

/** Parsed CLI arguments from argv. */
export interface ParsedArgs {
  readonly command: 'run' | 'report' | 'cleanup';
  readonly manifest: string;
  readonly observeOnly: boolean;
  readonly benchmark: boolean;
  readonly productionCanary: boolean;
  readonly ackProductionCanary: boolean;
  readonly region?: string;
  readonly maxDurationMs?: number;
  readonly batchSize?: number;
  readonly concurrency?: number;
}

// ── Dependencies (DI for testability) ────────────────────────────────────────

/** Dependencies injected into the `run` command handler. */
export interface RunDependencies {
  readonly runBenchmark: (options: RunnerOptions) => Promise<unknown>;
}

/** Dependencies injected into the `report` command handler. */
export interface ReportDependencies {
  readonly loadManifest: (parameterName: string) => Promise<BenchmarkManifest>;
  readonly readLogEvents: (query: { logGroupName: string }) => Promise<string[]>;
  readonly renderReport: (samples: ReadonlyArray<ReportSample>) => { json: string; html: string };
}

/** Dependencies injected into the `cleanup` command handler. */
export interface CleanupDependencies {
  readonly loadManifest: (parameterName: string) => Promise<BenchmarkManifest>;
  readonly cleanupRun: (benchRunId: string) => Promise<unknown>;
}

// ── Argument parsing ─────────────────────────────────────────────────────────

/**
 * Parse raw argv into structured CLI arguments.
 *
 * @param argv - The raw argument vector (no node binary or script path).
 * @throws {CliError} When required arguments are missing or invalid.
 */
export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const args = [...argv];

  // First positional argument is the command.
  const command = args[0];
  if (command !== 'run' && command !== 'report' && command !== 'cleanup') {
    throw new CliError(
      `Unknown or missing command: '${command ?? ''}'. ` +
      'Expected one of: run, report, cleanup.',
    );
  }

  let manifest: string | undefined;
  let observeOnly = false;
  let benchmark = false;
  let productionCanary = false;
  let ackProductionCanary = false;
  let region: string | undefined;
  let maxDurationMs: number | undefined;
  let batchSize: number | undefined;
  let concurrency: number | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--manifest':
        manifest = args[++i];
        if (manifest === undefined) {
          throw new CliError('--manifest requires a value.');
        }
        break;
      case '--observe-only':
        observeOnly = true;
        break;
      case '--benchmark':
        benchmark = true;
        break;
      case '--production-canary':
        productionCanary = true;
        break;
      case '--ack-production-canary':
        ackProductionCanary = true;
        break;
      case '--region':
        region = args[++i];
        if (region === undefined) {
          throw new CliError('--region requires a value.');
        }
        break;
      case '--max-duration-ms':
        maxDurationMs = Number(args[++i]);
        if (Number.isNaN(maxDurationMs)) {
          throw new CliError('--max-duration-ms requires a numeric value.');
        }
        break;
      case '--batch-size':
        batchSize = Number(args[++i]);
        if (Number.isNaN(batchSize)) {
          throw new CliError('--batch-size requires a numeric value.');
        }
        break;
      case '--concurrency':
        concurrency = Number(args[++i]);
        if (Number.isNaN(concurrency)) {
          throw new CliError('--concurrency requires a numeric value.');
        }
        break;
      default:
        throw new CliError(`Unknown flag: '${arg}'.`);
    }
  }

  if (manifest === undefined) {
    throw new CliError('--manifest is required for all commands.');
  }

  return {
    command,
    manifest,
    observeOnly,
    benchmark,
    productionCanary,
    ackProductionCanary,
    region,
    maxDurationMs,
    batchSize,
    concurrency,
  };
}

// ── Command handlers ─────────────────────────────────────────────────────────

/**
 * Resolve the run mode from parsed flags (Req 18.5, 18.6).
 *
 * When no mode flag is set, defaults to `'observe-only'` (Req 18.5).
 * When `--production-canary` is set without `--ack-production-canary`, throws
 * a CliError and does NOT proceed (Req 18.7).
 */
function resolveRunMode(args: ParsedArgs): {
  mode: RunMode;
  productionCanaryOptIn?: ProductionCanaryOptIn;
} {
  if (args.productionCanary) {
    if (!args.ackProductionCanary) {
      throw new CliError(
        'The --production-canary mode requires --ack-production-canary to ' +
        'explicitly acknowledge that production triggers may be switched. ' +
        'This is a safety gate with no fallback (Req 18.7).',
      );
    }
    return {
      mode: 'production-canary',
      productionCanaryOptIn: { acknowledged: true },
    };
  }
  if (args.benchmark) {
    return { mode: 'benchmark' };
  }
  // Default: observe-only (Req 18.5).
  return { mode: 'observe-only' };
}

/**
 * Handle the `run` subcommand: invoke `runBenchmark` with the resolved options.
 *
 * @param args - Parsed CLI arguments.
 * @param deps - Injected dependencies (production: real runBenchmark).
 */
export async function handleRun(
  args: ParsedArgs,
  deps: RunDependencies,
): Promise<void> {
  const { mode, productionCanaryOptIn } = resolveRunMode(args);

  const options: RunnerOptions = {
    manifestParameterName: args.manifest,
    mode,
    ...(productionCanaryOptIn !== undefined ? { productionCanaryOptIn } : {}),
    ...(args.region !== undefined ? { region: args.region } : {}),
    ...(args.maxDurationMs !== undefined ? { maxRunDurationMs: args.maxDurationMs } : {}),
    ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
    ...(args.concurrency !== undefined ? { concurrency: args.concurrency } : {}),
  };

  await deps.runBenchmark(options);
}

/**
 * Handle the `report` subcommand: load manifest, collect metrics from each
 * variant's log group, render the report.
 *
 * @param args - Parsed CLI arguments.
 * @param deps - Injected dependencies.
 */
export async function handleReport(
  args: ParsedArgs,
  deps: ReportDependencies,
): Promise<void> {
  const manifest = await deps.loadManifest(args.manifest);
  const allSamples: ReportSample[] = [];

  for (const variant of manifest.variants) {
    // Collect baseline metrics.
    const baselineMessages = await deps.readLogEvents({
      logGroupName: variant.baseline.logGroup,
    });
    const baselineMetrics = collectMetrics('baseline', baselineMessages.join('\n'));
    allSamples.push(...baselineMetrics.samples);

    // Collect kata metrics.
    const kataMessages = await deps.readLogEvents({
      logGroupName: variant.kata.logGroup,
    });
    const kataMetrics = collectMetrics('kata', kataMessages.join('\n'));
    allSamples.push(...kataMetrics.samples);
  }

  const rendered = deps.renderReport(allSamples);

  // Output the rendered report (JSON to stdout).
  // eslint-disable-next-line no-console
  console.log(rendered.json);
}

/**
 * Handle the `cleanup` subcommand: load manifest and call cleanupRun.
 *
 * @param args - Parsed CLI arguments.
 * @param deps - Injected dependencies.
 */
export async function handleCleanup(
  args: ParsedArgs,
  deps: CleanupDependencies,
): Promise<void> {
  const manifest = await deps.loadManifest(args.manifest);
  await deps.cleanupRun(manifest.benchRunSeed);
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * CLI entry point dispatching the `lambda-kata-bench` subcommands.
 *
 * Parses `argv`, resolves the command, wires production dependencies, and
 * dispatches to the appropriate handler. This is the public contract re-exported
 * from `./index.ts`.
 *
 * @param argv - Process arguments (excluding the node binary + script path).
 * @returns A promise resolving when the command completes.
 *
 * @throws {CliError} On invalid arguments or safety gate violations.
 */
export async function main(argv: ReadonlyArray<string>): Promise<void> {
  const args = parseArgs(argv);

  switch (args.command) {
    case 'run': {
      await handleRun(args, { runBenchmark });
      break;
    }
    case 'report': {
      const loader = ManifestLoader.withDefaultClients(args.region);
      const cwlClient = new CloudWatchLogsClient(
        args.region !== undefined ? { region: args.region } : {},
      );
      await handleReport(args, {
        loadManifest: (name) => loader.loadManifest(name),
        readLogEvents: (query) => readAllLogEvents(cwlClient, query.logGroupName),
        renderReport,
      });
      break;
    }
    case 'cleanup': {
      const loader = ManifestLoader.withDefaultClients(args.region);
      await handleCleanup(args, {
        loadManifest: (name) => loader.loadManifest(name),
        cleanupRun: (benchRunId) => cleanupRun(benchRunId, { region: args.region }),
      });
      break;
    }
  }
}

/**
 * Read all log events from a CloudWatch Logs log group.
 *
 * @param client - The CloudWatch Logs client.
 * @param logGroupName - The log group to read from.
 * @returns An array of log event messages.
 *
 * @internal
 */
async function readAllLogEvents(
  client: CloudWatchLogsClient,
  logGroupName: string,
): Promise<string[]> {
  const messages: string[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new FilterLogEventsCommand({
        logGroupName,
        ...(nextToken !== undefined ? { nextToken } : {}),
      }),
    );

    if (response.events) {
      for (const event of response.events) {
        if (event.message !== undefined) {
          messages.push(event.message);
        }
      }
    }
    nextToken = response.nextToken;
  } while (nextToken !== undefined);

  return messages;
}

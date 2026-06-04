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
 * Layer D — {@link ManifestLoader}: the run-time half of the synth→run-time
 * manifest bridge (run-time, CDK-free) (Req 10.3).
 *
 * ## Responsibility
 *
 * The loader is the inverse of the synth-time `ManifestWriter`
 * (`../manifest-writer`). The writer persists the resolved
 * {@link BenchmarkManifest} body to a single SSM parameter — INLINE when the
 * serialized body fits the SSM Standard-tier limit, or spilled to S3 with the
 * parameter holding an `s3://bucket/key` pointer — and surfaces only that SSM
 * parameter name via a `CfnOutput`. The runner is handed that one parameter
 * name and the loader resolves it back to the parsed manifest:
 *
 * 1. read the SSM parameter value (`@aws-sdk/client-ssm` `GetParameterCommand`);
 * 2. if the value begins with `s3://`, parse `bucket`/`key` and fetch the object
 *    body (`@aws-sdk/client-s3` `GetObjectCommand`); otherwise the value IS the
 *    inline manifest body;
 * 3. parse the body with the CDK-free {@link parseManifest} from `../manifest`,
 *    which validates `schemaVersion` and throws {@link ManifestSchemaError} on a
 *    body this runner does not understand.
 *
 * The two-storage contract (inline ≤ limit, else S3) is owned by the writer; the
 * loader mirrors it exactly and reuses the writer's `s3://` object key
 * (`manifest.json` under a per-run prefix) implicitly by parsing whatever key
 * the pointer carries.
 *
 * ## CDK-free constraint
 *
 * This module imports ONLY `@aws-sdk/client-ssm`, `@aws-sdk/client-s3`, and the
 * CDK-free `../manifest` schema/codec. It MUST NOT import `aws-cdk-lib` or
 * `constructs` — that separation is what lets the runner ship without CDK and is
 * enforced by the guard test added in task 16.
 *
 * ## Testability — dependency inversion
 *
 * The SSM and S3 clients are injected via the constructor (an explicit
 * {@link ManifestLoaderClients} contract), so unit tests pass mocked clients and
 * never touch AWS. {@link ManifestLoader.withDefaultClients} constructs real
 * region-resolved clients for production callers.
 *
 * @remarks
 * Validates: Requirements 10.3
 *
 * @module benchmark/runner/manifest-loader
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

import { parseManifest, type BenchmarkManifest } from '../manifest';

/**
 * The `s3://` scheme prefix that distinguishes an SSM parameter holding an S3
 * pointer (large body) from one holding the manifest body inline (small body).
 *
 * Mirrors the literal the synth-time writer emits when it spills the body to S3.
 */
export const S3_POINTER_SCHEME = 's3://';

/**
 * The AWS-SDK clients the {@link ManifestLoader} depends on, injected to keep
 * the loader testable (dependency inversion): unit tests provide mocks and
 * never reach AWS.
 *
 * The loader needs the S3 client ONLY when a parameter points at an S3-spilled
 * body; callers that know their bodies are always inline may still inject a
 * client (it simply goes unused).
 */
export interface ManifestLoaderClients {
  /** Reads the SSM parameter that holds the manifest body or its S3 pointer. */
  readonly ssm: SSMClient;
  /** Fetches the manifest body from S3 when the parameter is an `s3://` pointer. */
  readonly s3: S3Client;
}

/**
 * A parsed `s3://bucket/key` location.
 *
 * @internal
 */
interface S3Location {
  readonly bucket: string;
  readonly key: string;
}

/**
 * Error raised when the manifest cannot be RESOLVED from its storage — a missing
 * or empty SSM parameter value, a malformed `s3://` pointer, or an empty S3
 * object body.
 *
 * This is distinct from {@link ManifestSchemaError} (thrown by
 * {@link parseManifest} for a malformed/unsupported body): a
 * {@link ManifestLoadError} means the loader could not obtain a body to parse,
 * whereas a `ManifestSchemaError` means the body was obtained but is not a
 * manifest this runner understands.
 */
export class ManifestLoadError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ManifestLoadError';
  }
}

/**
 * Run-time loader that resolves a single SSM parameter name into the parsed
 * {@link BenchmarkManifest}, transparently following an `s3://` pointer when the
 * body was spilled to S3 (Req 10.3).
 *
 * The loader is a small run-time subsystem with an explicit contract
 * ({@link loadManifest}) and injected dependencies ({@link ManifestLoaderClients}).
 * It is stateless across calls beyond its injected clients, so a single instance
 * can resolve multiple parameters.
 *
 * @remarks
 * Validates: Requirements 10.3
 */
export class ManifestLoader {
  private readonly ssm: SSMClient;
  private readonly s3: S3Client;

  /**
   * @param clients - The injected SSM and S3 clients. Required, so the loader is
   *   always constructed with explicit dependencies; use
   *   {@link ManifestLoader.withDefaultClients} to build real ones.
   */
  public constructor(clients: ManifestLoaderClients) {
    this.ssm = clients.ssm;
    this.s3 = clients.s3;
  }

  /**
   * Construct a loader with real region-resolved AWS SDK clients (production
   * default). Tests should use the constructor with mocked clients instead.
   *
   * @param region - Optional explicit region; when omitted the SDK resolves it
   *   from the standard provider chain (env/config).
   * @returns A loader backed by real `SSMClient` and `S3Client` instances.
   */
  public static withDefaultClients(region?: string): ManifestLoader {
    const config = region !== undefined ? { region } : {};
    return new ManifestLoader({
      ssm: new SSMClient(config),
      s3: new S3Client(config),
    });
  }

  /**
   * Resolve the manifest for a run from its SSM pointer (Req 10.3).
   *
   * Reads the SSM parameter `parameterName`; if its value is an `s3://` pointer
   * the body is fetched from S3, otherwise the value is treated as the inline
   * body. The body is then parsed (and schema-validated) by
   * {@link parseManifest}.
   *
   * @param parameterName - The SSM parameter name handed to the runner (the
   *   pointer the synth-time `CfnOutput` surfaced).
   * @returns The parsed, schema-validated manifest body.
   *
   * @throws {ManifestLoadError} If the parameter has no value, the `s3://`
   *   pointer is malformed, or the S3 object body is empty.
   * @throws {ManifestSchemaError} If the resolved body is not valid JSON or
   *   carries an unsupported `schemaVersion` (propagated from
   *   {@link parseManifest}).
   */
  public async loadManifest(parameterName: string): Promise<BenchmarkManifest> {
    const value = await this.readParameterValue(parameterName);
    const body = value.startsWith(S3_POINTER_SCHEME)
      ? await this.readBodyFromS3(parseS3Pointer(value))
      : value;
    return parseManifest(body);
  }

  /**
   * Read the raw string value of the SSM parameter.
   *
   * @internal
   */
  private async readParameterValue(parameterName: string): Promise<string> {
    const response = await this.ssm.send(
      new GetParameterCommand({ Name: parameterName }),
    );
    const value = response.Parameter?.Value;
    if (value === undefined || value.length === 0) {
      throw new ManifestLoadError(
        `SSM parameter '${parameterName}' has no value; cannot resolve the benchmark manifest.`,
      );
    }
    return value;
  }

  /**
   * Fetch a manifest body from S3 given a parsed `s3://` location.
   *
   * @internal
   */
  private async readBodyFromS3(location: S3Location): Promise<string> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: location.bucket, Key: location.key }),
    );
    const stream = response.Body;
    if (stream === undefined) {
      throw new ManifestLoadError(
        `S3 object 's3://${location.bucket}/${location.key}' returned an empty body; ` +
        'cannot resolve the benchmark manifest.',
      );
    }
    // The AWS SDK v3 Node stream exposes `transformToString()`; use it so the
    // loader stays runtime-agnostic about the concrete stream implementation.
    return stream.transformToString();
  }
}

/**
 * Parse an `s3://bucket/key` pointer into its bucket and key components.
 *
 * The key may itself contain `/` (the writer stores the object under a per-run
 * prefix), so only the first path segment after the scheme is the bucket and the
 * remainder is the (possibly nested) key.
 *
 * @param pointer - The `s3://bucket/key` string read from the SSM parameter.
 * @returns The parsed bucket and key.
 *
 * @throws {ManifestLoadError} If the pointer is missing a bucket or a key.
 *
 * @internal
 */
function parseS3Pointer(pointer: string): S3Location {
  const withoutScheme = pointer.slice(S3_POINTER_SCHEME.length);
  const firstSlash = withoutScheme.indexOf('/');
  if (firstSlash <= 0) {
    throw new ManifestLoadError(
      `Malformed S3 manifest pointer '${pointer}'; expected 's3://bucket/key'.`,
    );
  }
  const bucket = withoutScheme.slice(0, firstSlash);
  const key = withoutScheme.slice(firstSlash + 1);
  if (key.length === 0) {
    throw new ManifestLoadError(
      `Malformed S3 manifest pointer '${pointer}'; expected 's3://bucket/key'.`,
    );
  }
  return { bucket, key };
}

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
 * Layer C — {@link ManifestWriter}: the synth→run-time bridge that persists the
 * resolved Benchmark Manifest body and surfaces a pointer to it (Req 10.3,
 * 10.4, 17.5).
 *
 * ## Why this lives in its own module (not in `manifest.ts`)
 *
 * `manifest.ts` owns the **CDK-free** manifest schema + codec
 * ({@link serializeManifest}/`parseManifest`). That module is imported by the
 * Layer D runner (`runner/`), which by design depends on the AWS SDK only and
 * MUST NOT pull in `aws-cdk-lib`. The writer, by contrast, is a **synth-time
 * CDK construct**: it instantiates `aws-cdk-lib` resources (SSM parameter, S3
 * bucket + deployment, `CfnOutput`). Keeping the writer here preserves the
 * runner's "no `aws-cdk-lib`" guarantee while reusing the schema/serializer from
 * `manifest.ts` as the single source of truth for the body shape.
 *
 * ## The pointer-vs-body contract (companion guidance, Req 10.3, 10.4)
 *
 * The **`CfnOutput` carries only a pointer** — the SSM parameter name — never
 * the manifest body. The versioned body (resolved function/alias ARNs, log
 * group names, and the event-source-mapping UUID attribute tokens the runner
 * needs for `UpdateEventSourceMapping` toggling) is stored:
 *
 * - **inline in the SSM parameter** when the serialized body fits within the
 *   SSM Standard-tier value limit ({@link SSM_INLINE_MAX_BYTES}); or
 * - **in S3** when the body is larger, with the SSM parameter holding an
 *   `s3://bucket/key` pointer to the deployed object.
 *
 * Either way the run-time runner reads ONE SSM parameter name (the pointer the
 * `CfnOutput` exposes) and then resolves the body from there, so the
 * synth→run-time seam is a single, stable indirection.
 *
 * Event-source-mapping UUIDs are CloudFormation attributes
 * (`CfnEventSourceMapping.attrId`) resolved at deploy time; because the body is
 * materialized through CDK (an SSM value or an S3 `Source.data` deployment with
 * marker substitution) those tokens are resolved into the deployed body
 * (Req 10.3, 10.4).
 *
 * @remarks
 * Validates: Requirements 10.3, 10.4, 17.5
 *
 * @module benchmark/manifest-writer
 */

import { CfnOutput, RemovalPolicy, Token } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BlockPublicAccess, Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

import {
  serializeManifest,
  type BenchmarkManifest,
  type ManifestStorageOptions,
  type ManifestWriteResult,
} from './manifest';

/**
 * Harness-owned SSM parameter-name prefix used when the caller does not supply
 * an explicit {@link ManifestStorageOptions.ssmParameterName}.
 *
 * Path-like (leading `/`) so multiple runs coexist under one namespace; the
 * per-run leaf is derived from the manifest `benchRunSeed`.
 */
export const DEFAULT_MANIFEST_PARAMETER_PREFIX = '/lambda-kata/bench/manifest';

/**
 * The maximum serialized manifest body size (in UTF-8 bytes) stored INLINE in
 * the SSM parameter before the writer spills the body to S3 (Req 17.5).
 *
 * Set to the AWS SSM **Standard-tier** value limit (4 KB) so the writer never
 * silently requires the Advanced (paid) tier: bodies at or below this fit
 * inline; larger bodies go to S3. This is a visible, intentional default rather
 * than a hidden constant.
 */
export const SSM_INLINE_MAX_BYTES = 4096;

/**
 * The S3 object key (relative to the bucket / a per-run prefix) under which a
 * large manifest body is deployed.
 */
export const MANIFEST_S3_OBJECT_KEY = 'manifest.json';

/** Construct id of the SSM parameter created by the {@link ManifestWriter}. */
const PARAMETER_CONSTRUCT_ID = 'Parameter';
/** Construct id of the S3 bucket created for large manifest bodies. */
const BUCKET_CONSTRUCT_ID = 'Bucket';
/** Construct id of the S3 deployment that writes a large manifest body. */
const DEPLOYMENT_CONSTRUCT_ID = 'Deployment';
/** Construct id of the pointer `CfnOutput`. */
const OUTPUT_CONSTRUCT_ID = 'Pointer';

/**
 * Construction properties for {@link ManifestWriter}.
 */
export interface ManifestWriterProps {
  /** The fully-resolved manifest body to persist (Req 10.3, 10.4, 17.5). */
  readonly manifest: BenchmarkManifest;
  /** Optional explicit storage configuration (SSM name / S3 bucket name). */
  readonly storage?: ManifestStorageOptions;
}

/**
 * Synth-time construct that persists a {@link BenchmarkManifest} and emits a
 * pointer to it (Req 10.3, 10.4, 17.5).
 *
 * The writer is the single owner of the synth→run-time manifest seam. It is a
 * `Construct` (not a `Stack` subclass) so it can be attached anywhere in the
 * Target_Stack tree, and it exposes the resolved {@link parameterName} pointer
 * the runner consumes. Storage placement (inline SSM vs S3 spill) is decided by
 * the serialized-body size against {@link SSM_INLINE_MAX_BYTES}; the decision is
 * surfaced via {@link storedInS3} for tooling/tests.
 *
 * @remarks
 * Validates: Requirements 10.3, 10.4, 17.5
 */
export class ManifestWriter extends Construct {
  /** The SSM parameter holding the manifest body (inline) or its S3 pointer. */
  public readonly parameter: StringParameter;
  /** The resolved SSM parameter name — the pointer the `CfnOutput` carries. */
  public readonly parameterName: string;
  /** Whether the body was spilled to S3 (`true`) or stored inline (`false`). */
  public readonly storedInS3: boolean;
  /** The S3 bucket holding the large manifest body, when one was created/used. */
  public readonly bucket?: IBucket;
  /** The pointer-only `CfnOutput` (never carries the manifest body). */
  public readonly output: CfnOutput;

  /**
   * @param scope - The construct scope (the Target_Stack or a child) to attach
   *   the manifest resources to.
   * @param id - The construct id for this writer.
   * @param props - The manifest body and optional storage configuration.
   */
  public constructor(scope: Construct, id: string, props: ManifestWriterProps) {
    super(scope, id);

    const { manifest, storage } = props;
    const body = serializeManifest(manifest);
    const resolvedParameterName = resolveParameterName(storage, manifest);

    // Decide placement on the serialized body's synth-time UTF-8 byte length
    // (Req 17.5). The body may embed deploy-time CDK tokens (e.g. an
    // event-source-mapping `attrId`); SSM renders those inline as `Fn::Join`
    // and S3 `Source.data` substitutes them into the deployed object, so the
    // marker-length measurement here is a safe proxy. Bodies at or below the SSM
    // Standard-tier limit are stored inline; larger bodies spill to S3 with the
    // parameter holding the pointer.
    const inlineEligible = Buffer.byteLength(body, 'utf8') <= SSM_INLINE_MAX_BYTES;

    let parameterValue: string;
    if (inlineEligible) {
      this.storedInS3 = false;
      parameterValue = body;
    } else {
      this.storedInS3 = true;
      const { bucket, objectUrl } = this.writeBodyToS3(body, storage, manifest);
      this.bucket = bucket;
      parameterValue = objectUrl;
    }

    // The SSM parameter holds the body (inline) or the s3:// pointer (large).
    this.parameter = new StringParameter(this, PARAMETER_CONSTRUCT_ID, {
      parameterName: resolvedParameterName,
      stringValue: parameterValue,
      description:
        'Lambda Kata benchmark manifest. Holds the resolved manifest body inline ' +
        '(small) or an s3:// pointer to the body (large). Read by lambda-kata-bench.',
    });
    this.parameterName = resolvedParameterName;

    // The CfnOutput carries ONLY the pointer (the SSM parameter name), never the
    // manifest body itself (companion guidance, Req 10.3, 10.4).
    this.output = new CfnOutput(this, OUTPUT_CONSTRUCT_ID, {
      value: resolvedParameterName,
      description:
        'SSM parameter name pointing at the Lambda Kata benchmark manifest ' +
        '(pointer only; the manifest body is not exported as an output).',
    });
  }

  /**
   * Deploy a large manifest body to S3 and return the bucket + `s3://` URL.
   *
   * Uses `Source.data` (with JSON-safe marker substitution) so any deploy-time
   * tokens in the body — e.g. `CfnEventSourceMapping.attrId` UUIDs — are
   * resolved into the deployed object (Req 10.3, 10.4). When the caller supplies
   * an explicit bucket name it is imported; otherwise a benchmark-owned bucket
   * is created (destroyed with the run, blocking public access).
   *
   * @internal
   */
  private writeBodyToS3(
    body: string,
    storage: ManifestStorageOptions | undefined,
    manifest: BenchmarkManifest,
  ): { bucket: IBucket; objectUrl: string } {
    const bucket: IBucket =
      storage?.s3BucketName !== undefined
        ? Bucket.fromBucketName(this, BUCKET_CONSTRUCT_ID, storage.s3BucketName)
        : new Bucket(this, BUCKET_CONSTRUCT_ID, {
          blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
          enforceSSL: true,
          removalPolicy: RemovalPolicy.DESTROY,
        });

    const keyPrefix = sanitizeSeedSegment(manifest.benchRunSeed);

    new BucketDeployment(this, DEPLOYMENT_CONSTRUCT_ID, {
      destinationBucket: bucket,
      destinationKeyPrefix: keyPrefix,
      sources: [Source.data(MANIFEST_S3_OBJECT_KEY, body, { jsonEscape: true })],
    });

    const objectUrl = `s3://${bucket.bucketName}/${keyPrefix}/${MANIFEST_S3_OBJECT_KEY}`;
    return { bucket, objectUrl };
  }
}

/**
 * Write the resolved manifest body to SSM/S3 and emit a `CfnOutput` pointer
 * (Req 10.3, 10.4, 17.5).
 *
 * Thin functional facade over {@link ManifestWriter}, preserving the call shape
 * the orchestrator (task 14) and the {@link ManifestWriteResult} contract
 * expect: it returns the resolved SSM parameter name the runner reads to locate
 * the manifest body.
 *
 * @param scope - The construct scope to attach the manifest resources to.
 * @param manifest - The resolved manifest body.
 * @param storage - Optional explicit storage configuration.
 * @returns The write result, including the SSM parameter name pointer.
 */
export function writeManifest(
  scope: Construct,
  manifest: BenchmarkManifest,
  storage?: ManifestStorageOptions,
): ManifestWriteResult {
  const writer = new ManifestWriter(scope, 'BenchmarkManifest', {
    manifest,
    ...(storage !== undefined ? { storage } : {}),
  });
  return { parameterName: writer.parameterName };
}

/**
 * Resolve the SSM parameter name: the explicit name when supplied, else a
 * harness-owned path-like name derived from the manifest `benchRunSeed`.
 *
 * @internal
 */
function resolveParameterName(
  storage: ManifestStorageOptions | undefined,
  manifest: BenchmarkManifest,
): string {
  if (storage?.ssmParameterName !== undefined) {
    return storage.ssmParameterName;
  }
  const leaf = sanitizeSeedSegment(manifest.benchRunSeed);
  return `${DEFAULT_MANIFEST_PARAMETER_PREFIX}/${leaf}`;
}

/**
 * Sanitize a caller-opaque seed into a name segment safe for BOTH an SSM
 * parameter name leaf and an S3 key prefix.
 *
 * SSM names and S3 keys both accept letters, numbers, and `.-_`; any other
 * character (including a token-derived `${...}`) is replaced with `-`. Falls
 * back to a stable literal when the seed is an unresolved token or empties out,
 * so a caller-opaque seed never yields an invalid name.
 *
 * @internal
 */
function sanitizeSeedSegment(seed: string): string {
  if (Token.isUnresolved(seed)) {
    return 'run';
  }
  const sanitized = seed.replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^-+|-+$/g, '');
  return sanitized.length > 0 ? sanitized : 'run';
}

/** Re-export for ergonomic single-import consumption by the orchestrator. */
export type { ManifestWriteResult } from './manifest';

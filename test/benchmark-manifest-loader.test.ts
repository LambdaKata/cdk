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
 * Unit tests for the run-time {@link ManifestLoader} (Layer D, task 16).
 *
 * The loader is the run-time half of the synth→run-time manifest bridge: it
 * resolves a single SSM parameter name into the parsed {@link BenchmarkManifest},
 * following an `s3://` pointer when the synth-time writer spilled a large body
 * to S3. These tests inject MOCKED SSM and S3 clients (no AWS access) and the
 * fixture manifest is generated in-test via the manifest factory so it stays
 * schema-synced with `src/benchmark/manifest.ts`.
 *
 * Coverage:
 *  - inline case: the SSM value IS the serialized body → deep-equal manifest;
 *  - S3 spill case: the SSM value is an `s3://bucket/key` pointer → body fetched
 *    from S3, and GetObject is called with the parsed bucket/key;
 *  - error case: an unsupported `schemaVersion` body propagates
 *    {@link ManifestSchemaError} from `parseManifest`.
 *
 * **Validates: Requirements 10.3, 17.5**
 *
 * @module benchmark-manifest-loader.test
 */

import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { SSMClient } from '@aws-sdk/client-ssm';
import type { S3Client } from '@aws-sdk/client-s3';

import {
  ManifestLoader,
  ManifestLoadError,
} from '../src/benchmark/runner/manifest-loader';
import {
  RunDesignAccumulator,
  buildBenchmarkManifest,
  serializeManifest,
  type BenchmarkManifest,
  type ManifestVariant,
} from '../src/benchmark/manifest';
import { FidelityLevel } from '../src/benchmark/options';

/** Build a representative resolved manifest variant for the fixture. */
function sampleVariant(): ManifestVariant {
  return {
    constructPath: 'Stack/OrderService/Handler',
    baseline: {
      functionName: 'order-service',
      functionArn: 'arn:aws:lambda:us-east-1:111122223333:function:order-service',
      logGroup: '/aws/lambda/order-service',
    },
    kata: {
      functionName: 'order-service-kata',
      functionArn: 'arn:aws:lambda:us-east-1:111122223333:function:order-service-kata',
      aliasArn: 'arn:aws:lambda:us-east-1:111122223333:function:order-service-kata:kata',
      version: '7',
      logGroup: '/aws/lambda/order-service-kata',
    },
  };
}

/** Generate the fixture manifest body via the factory (kept schema-synced). */
function buildFixtureManifest(): BenchmarkManifest {
  const runDesign = new RunDesignAccumulator({ fidelity: FidelityLevel.L1 })
    .recordEnvKeys('Stack/OrderService/Handler', ['TABLE_NAME'])
    .recordTriggerRouting({
      path: 'Stack/OrderService/Handler',
      type: 'sqs',
      routingClass: 'competing',
      correlation: 'window',
    })
    .build();

  return buildBenchmarkManifest({
    benchRunSeed: 'seed-loader-test',
    region: 'us-east-1',
    ownershipTag: { key: 'lambda-kata:bench-run-id', value: 'seed-loader-test' },
    variants: [sampleVariant()],
    runDesign,
  });
}

/** A minimal SSM stand-in exposing the single `send` the loader calls. */
function makeSsmClient(send: jest.Mock): SSMClient {
  return { send } as unknown as SSMClient;
}

/** A minimal S3 stand-in exposing the single `send` the loader calls. */
function makeS3Client(send: jest.Mock): S3Client {
  return { send } as unknown as S3Client;
}

describe('ManifestLoader — inline body (Req 10.3)', () => {
  it('returns the deep-equal parsed manifest when the SSM value is the body', async () => {
    const manifest = buildFixtureManifest();
    const body = serializeManifest(manifest);

    const ssmSend = jest.fn().mockResolvedValue({ Parameter: { Value: body } });
    // S3 must never be touched in the inline path.
    const s3Send = jest.fn().mockRejectedValue(new Error('S3 should not be called inline'));

    const loader = new ManifestLoader({
      ssm: makeSsmClient(ssmSend),
      s3: makeS3Client(s3Send),
    });

    const loaded = await loader.loadManifest('/lambda-kata/bench/manifest/seed-loader-test');

    expect(loaded).toEqual(manifest);
    expect(s3Send).not.toHaveBeenCalled();

    // The SSM read used GetParameterCommand with the given parameter name.
    expect(ssmSend).toHaveBeenCalledTimes(1);
    const sentCommand = ssmSend.mock.calls[0][0];
    expect(sentCommand).toBeInstanceOf(GetParameterCommand);
    expect(sentCommand.input).toEqual({ Name: '/lambda-kata/bench/manifest/seed-loader-test' });
  });
});

describe('ManifestLoader — S3-spilled body (Req 10.3)', () => {
  it('fetches the body from S3 and calls GetObject with the parsed bucket/key', async () => {
    const manifest = buildFixtureManifest();
    const body = serializeManifest(manifest);

    const bucket = 'bench-manifest-bucket';
    const key = 'seed-loader-test/manifest.json';
    const pointer = `s3://${bucket}/${key}`;

    const ssmSend = jest.fn().mockResolvedValue({ Parameter: { Value: pointer } });
    const s3Send = jest.fn().mockResolvedValue({
      Body: { transformToString: jest.fn().mockResolvedValue(body) },
    });

    const loader = new ManifestLoader({
      ssm: makeSsmClient(ssmSend),
      s3: makeS3Client(s3Send),
    });

    const loaded = await loader.loadManifest('/lambda-kata/bench/manifest/seed-loader-test');

    expect(loaded).toEqual(manifest);

    // S3 GetObject was issued with the bucket/key parsed from the pointer.
    expect(s3Send).toHaveBeenCalledTimes(1);
    const sentCommand = s3Send.mock.calls[0][0];
    expect(sentCommand).toBeInstanceOf(GetObjectCommand);
    expect(sentCommand.input).toEqual({ Bucket: bucket, Key: key });
  });

  it('throws ManifestLoadError on a malformed s3:// pointer', async () => {
    const ssmSend = jest.fn().mockResolvedValue({ Parameter: { Value: 's3://bucket-only' } });
    const s3Send = jest.fn();

    const loader = new ManifestLoader({
      ssm: makeSsmClient(ssmSend),
      s3: makeS3Client(s3Send),
    });

    await expect(loader.loadManifest('/param')).rejects.toBeInstanceOf(ManifestLoadError);
    expect(s3Send).not.toHaveBeenCalled();
  });
});

describe('ManifestLoader — error propagation (Req 10.3, 17.5)', () => {
  it('propagates ManifestSchemaError for an unsupported schemaVersion body', async () => {
    const manifest = buildFixtureManifest();
    const tampered = JSON.stringify({ ...manifest, schemaVersion: 99 });

    const ssmSend = jest.fn().mockResolvedValue({ Parameter: { Value: tampered } });
    const s3Send = jest.fn();

    const loader = new ManifestLoader({
      ssm: makeSsmClient(ssmSend),
      s3: makeS3Client(s3Send),
    });

    await expect(loader.loadManifest('/param')).rejects.toThrow(/Unsupported manifest schemaVersion/);
  });

  it('throws ManifestLoadError when the SSM parameter has no value', async () => {
    const ssmSend = jest.fn().mockResolvedValue({ Parameter: {} });
    const s3Send = jest.fn();

    const loader = new ManifestLoader({
      ssm: makeSsmClient(ssmSend),
      s3: makeS3Client(s3Send),
    });

    await expect(loader.loadManifest('/missing')).rejects.toBeInstanceOf(ManifestLoadError);
  });
});

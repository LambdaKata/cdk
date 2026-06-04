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
 * Unit tests for the Run_Design accumulator and the versioned
 * Benchmark Manifest schema (Layer C, task 12).
 *
 * These tests pin the three behaviours the task calls out:
 *
 * 1. the accumulator records env var KEYS only — never values (Property 9,
 *    Req 14.4, 14.5);
 * 2. the versioned manifest round-trips through serialize → parse (Req 17.5);
 * 3. the manifest captures event-source-mapping UUID attribute TOKENS (the
 *    unresolved `CfnEventSourceMapping.attrId` strings) verbatim (Req 10.3,
 *    10.4).
 *
 * **Validates: Requirements 5.7, 11.11, 13.6, 14.4, 14.5, 17.5**
 *
 * @module benchmark-manifest.test
 */

import {
  RunDesignAccumulator,
  buildBenchmarkManifest,
  serializeManifest,
  parseManifest,
  ManifestSchemaError,
  MANIFEST_SCHEMA_VERSION,
} from '../src/benchmark/manifest';
import type { BenchmarkManifest, ManifestVariant } from '../src/benchmark/manifest';
import { FidelityLevel } from '../src/benchmark/options';
import type { EligibilityResult } from '../src/benchmark/eligibility';
import type { PreflightFinding } from '../src/benchmark/preflight';
import type { FindingAcknowledgement } from '../src/benchmark/options';

const ELIGIBLE: EligibilityResult = { eligibility: 'cloneable', reasons: [] };

const EXTERNAL_FINDING: PreflightFinding = {
  id: 'finding-external-queue',
  kind: 'external-event-source',
  resource: 'arn:aws:sqs:us-east-1:111122223333:prod-queue',
  ownership: 'external',
  disposition: 'block',
  acknowledged: false,
  enabled: false,
  detail: 'The kata clone would attach to the external event source.',
};

/** Build a representative resolved manifest variant for round-trip tests. */
function sampleVariant(overrides: Partial<ManifestVariant> = {}): ManifestVariant {
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
    ...overrides,
  };
}

describe('RunDesignAccumulator — env KEYS only (Property 9, Req 14.4, 14.5)', () => {
  it('records only the env var keys it is given, never any values', () => {
    const runDesign = new RunDesignAccumulator()
      .recordEnvKeys('Stack/OrderService/Handler', ['TABLE_NAME', 'SECRET_ARN', 'API_KEY'])
      .build();

    expect(runDesign.envKeysCopied).toEqual({
      'Stack/OrderService/Handler': ['TABLE_NAME', 'SECRET_ARN', 'API_KEY'],
    });
  });

  it('keeps env var values out of the serialized manifest body', () => {
    // Simulate the CloneBuilder seam: only Object.keys(...) is ever passed in,
    // never the values. A representative secret value must never surface.
    const baselineEnvironment: Record<string, string> = {
      TABLE_NAME: 'orders-prod',
      SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:111122223333:secret:super-secret-value',
      DB_PASSWORD: 'hunter2-do-not-leak',
    };

    const runDesign = new RunDesignAccumulator()
      .recordEnvKeys('Stack/OrderService/Handler', Object.keys(baselineEnvironment))
      .build();

    const manifest = buildBenchmarkManifest({
      benchRunSeed: 'seed-abc',
      region: 'us-east-1',
      ownershipTag: { key: 'lambda-kata:bench-run-id', value: 'seed-abc' },
      variants: [sampleVariant()],
      runDesign,
    });

    const serialized = serializeManifest(manifest);

    // Keys are present; values are absent.
    expect(serialized).toContain('TABLE_NAME');
    expect(serialized).toContain('SECRET_ARN');
    expect(serialized).toContain('DB_PASSWORD');
    for (const secretValue of Object.values(baselineEnvironment)) {
      expect(serialized).not.toContain(secretValue);
    }
  });

  it('merges env keys across repeated records for the same path without duplicates', () => {
    const runDesign = new RunDesignAccumulator()
      .recordEnvKeys('Stack/Fn', ['A', 'B'])
      .recordEnvKeys('Stack/Fn', ['B', 'C'])
      .build();

    expect(runDesign.envKeysCopied['Stack/Fn']).toEqual(['A', 'B', 'C']);
  });

  it('exposes no API surface that accepts environment values (compile-time guarantee)', () => {
    // The accumulator only accepts ReadonlyArray<string> keys. This runtime
    // assertion documents the structural guarantee: recordEnvKeys is the sole
    // env-recording entry point and it is key-only.
    const accumulator = new RunDesignAccumulator();
    expect(typeof accumulator.recordEnvKeys).toBe('function');
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(accumulator)).filter((name) =>
        name.toLowerCase().includes('value'),
      ),
    ).toHaveLength(0);
  });
});

describe('RunDesignAccumulator — recording surfaces (Req 5.7, 11.11, 13.6)', () => {
  it('captures eligibility, findings, acknowledgements, triggers, and run-level fields', () => {
    const acknowledgement: FindingAcknowledgement = {
      findingId: 'finding-external-queue',
      acknowledgedBy: 'ops@example.com',
      reason: 'Benchmark-isolated queue confirmed.',
    };

    const runDesign = new RunDesignAccumulator({
      fidelity: FidelityLevel.L2,
      sideEffectPolicy: 'idempotent',
      roleMode: 'clone-role',
    })
      .recordEligibility('Stack/OrderService/Handler', ELIGIBLE)
      .recordFinding(EXTERNAL_FINDING)
      .recordAcknowledgement(acknowledgement)
      .recordTriggerRouting({
        path: 'Stack/OrderService/Handler',
        type: 'sqs',
        routingClass: 'competing',
        correlation: 'window',
      })
      .build();

    expect(runDesign.fidelity).toBe(FidelityLevel.L2);
    expect(runDesign.sideEffectPolicy).toBe('idempotent');
    expect(runDesign.roleMode).toBe('clone-role');
    expect(runDesign.eligibility).toEqual([
      { path: 'Stack/OrderService/Handler', result: ELIGIBLE },
    ]);
    expect(runDesign.findings).toEqual([EXTERNAL_FINDING]);
    expect(runDesign.acknowledgements).toEqual([acknowledgement]);
    expect(runDesign.perTrigger).toEqual([
      {
        path: 'Stack/OrderService/Handler',
        type: 'sqs',
        routingClass: 'competing',
        correlation: 'window',
      },
    ]);
  });

  it('applies the documented conservative defaults when no init is given', () => {
    const runDesign = new RunDesignAccumulator().build();
    expect(runDesign.fidelity).toBe(FidelityLevel.L0);
    expect(runDesign.sideEffectPolicy).toBe('unsafe');
    expect(runDesign.roleMode).toBe('reuse-role');
  });

  it('lets a later eligibility/trigger record for the same path replace the earlier one', () => {
    const warned: EligibilityResult = {
      eligibility: 'cloneable-with-warnings',
      reasons: [{ code: 'existing-version-or-alias', message: 'has alias' }],
    };

    const runDesign = new RunDesignAccumulator()
      .recordEligibility('Stack/Fn', ELIGIBLE)
      .recordEligibility('Stack/Fn', warned)
      .build();

    expect(runDesign.eligibility).toEqual([{ path: 'Stack/Fn', result: warned }]);
  });

  it('records the side-effect contribution (policy + acknowledgements) from the gate (Req 13.6)', () => {
    const runDesign = new RunDesignAccumulator()
      .recordSideEffectContribution({
        sideEffectPolicy: 'read-only',
        acknowledgements: [{ findingId: 'finding-1' }, { findingId: 'finding-2' }],
      })
      .build();

    expect(runDesign.sideEffectPolicy).toBe('read-only');
    expect(runDesign.acknowledgements).toEqual([
      { findingId: 'finding-1' },
      { findingId: 'finding-2' },
    ]);
  });
});

describe('BenchmarkManifest — versioned schema round-trip (Req 17.5)', () => {
  it('round-trips serialize → parse to a deep-equal manifest', () => {
    const runDesign = new RunDesignAccumulator({ fidelity: FidelityLevel.L1 })
      .recordEligibility('Stack/OrderService/Handler', ELIGIBLE)
      .recordEnvKeys('Stack/OrderService/Handler', ['TABLE_NAME'])
      .recordTriggerRouting({
        path: 'Stack/OrderService/Handler',
        type: 'sqs',
        routingClass: 'competing',
        correlation: 'window',
      })
      .build();

    const manifest = buildBenchmarkManifest({
      benchRunSeed: 'seed-abc',
      region: 'us-east-1',
      ownershipTag: { key: 'lambda-kata:bench-run-id', value: 'seed-abc' },
      variants: [sampleVariant()],
      runDesign,
    });

    const roundTripped = parseManifest(serializeManifest(manifest));
    expect(roundTripped).toEqual(manifest);
  });

  it('stamps the literal schema version 1 and derives top-level fidelity/policy from the run-design', () => {
    const runDesign = new RunDesignAccumulator({
      fidelity: FidelityLevel.L3,
      sideEffectPolicy: 'isolated-writes',
    }).build();

    const manifest = buildBenchmarkManifest({
      benchRunSeed: 'seed-xyz',
      region: 'eu-west-1',
      ownershipTag: { key: 'lambda-kata:bench-run-id', value: 'seed-xyz' },
      variants: [],
      runDesign,
    });

    expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.fidelity).toBe(FidelityLevel.L3);
    expect(manifest.sideEffectPolicy).toBe('isolated-writes');
  });

  it('rejects a manifest body with an unknown schema version', () => {
    const manifest = buildBenchmarkManifest({
      benchRunSeed: 'seed-abc',
      region: 'us-east-1',
      ownershipTag: { key: 'lambda-kata:bench-run-id', value: 'seed-abc' },
      variants: [],
      runDesign: new RunDesignAccumulator().build(),
    });

    const tampered = JSON.stringify({ ...manifest, schemaVersion: 99 });
    expect(() => parseManifest(tampered)).toThrow(ManifestSchemaError);
  });

  it('rejects a non-object / malformed manifest body', () => {
    expect(() => parseManifest('"not-an-object"')).toThrow(ManifestSchemaError);
    expect(() => parseManifest('null')).toThrow(ManifestSchemaError);
    expect(() => parseManifest('{ this is not json')).toThrow(ManifestSchemaError);
  });
});

describe('BenchmarkManifest — mapping UUID attribute tokens (Req 10.3, 10.4)', () => {
  it('captures synth-time event-source-mapping UUID tokens and round-trips them verbatim', () => {
    // At synth time, CfnEventSourceMapping.attrId is an unresolved CDK token —
    // an opaque string. The manifest must store it as-is and preserve it across
    // the serialize → parse round-trip.
    const baselineMappingUuid = '${Token[Stack.OrderServiceBaselineMapping.Id.1234]}';
    const kataMappingUuid = '${Token[Stack.OrderServiceKataMapping.Id.5678]}';

    const variant = sampleVariant({
      trigger: {
        type: 'sqs',
        routingClass: 'competing',
        baselineMappingUuid,
        kataMappingUuid,
        source: { isolated: true, ref: '${Token[Stack.BenchQueue.Arn.9012]}' },
      },
    });

    const manifest = buildBenchmarkManifest({
      benchRunSeed: 'seed-abc',
      region: 'us-east-1',
      ownershipTag: { key: 'lambda-kata:bench-run-id', value: 'seed-abc' },
      variants: [variant],
      runDesign: new RunDesignAccumulator().build(),
    });

    const roundTripped: BenchmarkManifest = parseManifest(serializeManifest(manifest));
    const trigger = roundTripped.variants[0]?.trigger;

    expect(trigger).toBeDefined();
    expect(trigger?.baselineMappingUuid).toBe(baselineMappingUuid);
    expect(trigger?.kataMappingUuid).toBe(kataMappingUuid);
    expect(trigger?.source).toEqual({ isolated: true, ref: '${Token[Stack.BenchQueue.Arn.9012]}' });
  });

  it('omits a baseline mapping UUID when no baseline mapping was created (push/req-resp)', () => {
    const variant = sampleVariant({
      trigger: {
        type: 'sns',
        routingClass: 'fan-out',
        kataMappingUuid: '${Token[Stack.KataMapping.Id.1]}',
        source: { isolated: true, ref: '${Token[Stack.BenchTopic.Arn.2]}' },
      },
    });

    const manifest = buildBenchmarkManifest({
      benchRunSeed: 'seed-abc',
      region: 'us-east-1',
      ownershipTag: { key: 'lambda-kata:bench-run-id', value: 'seed-abc' },
      variants: [variant],
      runDesign: new RunDesignAccumulator().build(),
    });

    const roundTripped = parseManifest(serializeManifest(manifest));
    expect(roundTripped.variants[0]?.trigger?.baselineMappingUuid).toBeUndefined();
    expect(roundTripped).toEqual(manifest);
  });
});

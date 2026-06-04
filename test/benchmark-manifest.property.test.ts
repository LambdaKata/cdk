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
 * Property-Based Tests for the Run_Design accumulator and the versioned
 * Benchmark Manifest schema (Layer C, task 12).
 *
 * Two invariants are proven across the input space rather than for hand-picked
 * examples:
 *
 * - **Property 9 (No secret leakage):** for ANY baseline environment map, the
 *   accumulator records the KEYS and the serialized manifest never contains a
 *   value that is not also a key (Req 14.4, 14.5).
 * - **Schema round-trip:** for ANY generated manifest, `parseManifest` of
 *   `serializeManifest` is deep-equal to the original and preserves the literal
 *   schema version (Req 17.5).
 *
 * **Validates: Requirements 14.4, 14.5, 17.5**
 *
 * @module benchmark-manifest.property.test
 */

import * as fc from 'fast-check';

import {
  RunDesignAccumulator,
  buildBenchmarkManifest,
  serializeManifest,
  parseManifest,
  MANIFEST_SCHEMA_VERSION,
} from '../src/benchmark/manifest';
import type { ManifestVariant } from '../src/benchmark/manifest';
import { FidelityLevel } from '../src/benchmark/options';
import type { SideEffectPolicy, RoleMode } from '../src/benchmark/options';
import type { RoutingClass, TriggerType } from '../src/benchmark/triggers/types';

/** An env var KEY: identifier-shaped, never empty. */
const envKeyArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Z][A-Z0-9_]{0,30}$/)
  .filter((key) => key.length > 0);

/**
 * A representative secret-like VALUE that is structurally distinct from a key
 * (contains characters a key never would), so a leak is detectable.
 */
const envValueArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((raw) => `secret::${raw}::value`);

const fidelityArb: fc.Arbitrary<FidelityLevel> = fc.constantFrom(
  FidelityLevel.L0,
  FidelityLevel.L1,
  FidelityLevel.L2,
  FidelityLevel.L3,
  FidelityLevel.L4,
);

const policyArb: fc.Arbitrary<SideEffectPolicy> = fc.constantFrom<SideEffectPolicy>(
  'read-only',
  'idempotent',
  'isolated-writes',
  'unsafe',
);

const roleModeArb: fc.Arbitrary<RoleMode> = fc.constantFrom<RoleMode>(
  'reuse-role',
  'clone-role',
  'provided-role',
);

const routingClassArb: fc.Arbitrary<RoutingClass> = fc.constantFrom<RoutingClass>(
  'competing',
  'fan-out',
  'shared-read',
  'request-response',
);

const triggerTypeArb: fc.Arbitrary<TriggerType> = fc.constantFrom<TriggerType>(
  'invoke',
  'apiGateway',
  'functionUrl',
  'sqs',
  'eventBridge',
  'sns',
  'kinesis',
  'dynamoDbStreams',
  'kafka',
);

/** A mapping UUID attribute TOKEN as it appears unresolved at synth time. */
const tokenArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((seed) => `\${Token[Stack.Mapping.Id.${seed}]}`);

const variantArb: fc.Arbitrary<ManifestVariant> = fc.record({
  constructPath: fc.string({ minLength: 1, maxLength: 40 }),
  baseline: fc.record({
    functionName: fc.string({ minLength: 1, maxLength: 30 }),
    functionArn: fc.string({ minLength: 1, maxLength: 60 }),
    logGroup: fc.string({ minLength: 1, maxLength: 40 }),
  }),
  kata: fc.record({
    functionName: fc.string({ minLength: 1, maxLength: 30 }),
    functionArn: fc.string({ minLength: 1, maxLength: 60 }),
    aliasArn: fc.string({ minLength: 1, maxLength: 60 }),
    version: fc.string({ minLength: 1, maxLength: 6 }),
    logGroup: fc.string({ minLength: 1, maxLength: 40 }),
  }),
});

const triggeredVariantArb: fc.Arbitrary<ManifestVariant> = fc
  .tuple(variantArb, triggerTypeArb, routingClassArb, tokenArb, tokenArb, fc.boolean())
  .map(([variant, type, routingClass, kataUuid, baselineUuid, hasBaseline]) => ({
    ...variant,
    trigger: {
      type,
      routingClass,
      kataMappingUuid: kataUuid,
      ...(hasBaseline ? { baselineMappingUuid: baselineUuid } : {}),
      source: { isolated: true, ref: kataUuid },
    },
  }));

describe('RunDesignAccumulator — Property 9 (env KEYS only, Req 14.4, 14.5)', () => {
  it('records exactly the keys of any environment map, never a value', () => {
    fc.assert(
      fc.property(
        fc.dictionary(envKeyArb, envValueArb, { minKeys: 0, maxKeys: 12 }),
        (environment) => {
          const expectedKeys = Object.keys(environment);
          const runDesign = new RunDesignAccumulator()
            .recordEnvKeys('Stack/Fn', expectedKeys)
            .build();

          const recorded = runDesign.envKeysCopied['Stack/Fn'] ?? [];
          // Recorded set equals the key set (order-independent).
          return (
            recorded.length === expectedKeys.length &&
            [...recorded].sort().join('|') === [...expectedKeys].sort().join('|')
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('never leaks an environment value into the serialized manifest', () => {
    fc.assert(
      fc.property(
        fc.dictionary(envKeyArb, envValueArb, { minKeys: 1, maxKeys: 12 }),
        (environment) => {
          const runDesign = new RunDesignAccumulator()
            .recordEnvKeys('Stack/Fn', Object.keys(environment))
            .build();

          const manifest = buildBenchmarkManifest({
            benchRunSeed: 'seed',
            region: 'us-east-1',
            ownershipTag: { key: 'lambda-kata:bench-run-id', value: 'seed' },
            variants: [],
            runDesign,
          });

          const serialized = serializeManifest(manifest);
          // No value (which is structurally distinct from any key) may appear.
          return Object.values(environment).every((value) => !serialized.includes(value));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('BenchmarkManifest — schema round-trip (Req 17.5)', () => {
  it('parse(serialize(manifest)) is deep-equal to the manifest for any generated manifest', () => {
    fc.assert(
      fc.property(
        fc.record({
          benchRunSeed: fc.string({ minLength: 1, maxLength: 20 }),
          region: fc.constantFrom('us-east-1', 'eu-west-1', 'ap-southeast-2'),
          fidelity: fidelityArb,
          sideEffectPolicy: policyArb,
          roleMode: roleModeArb,
          variants: fc.array(triggeredVariantArb, { maxLength: 5 }),
          envKeys: fc.array(envKeyArb, { maxLength: 8 }),
        }),
        (spec) => {
          const runDesign = new RunDesignAccumulator({
            fidelity: spec.fidelity,
            sideEffectPolicy: spec.sideEffectPolicy,
            roleMode: spec.roleMode,
          })
            .recordEnvKeys('Stack/Fn', spec.envKeys)
            .build();

          const manifest = buildBenchmarkManifest({
            benchRunSeed: spec.benchRunSeed,
            region: spec.region,
            ownershipTag: { key: 'lambda-kata:bench-run-id', value: spec.benchRunSeed },
            variants: spec.variants,
            runDesign,
          });

          const roundTripped = parseManifest(serializeManifest(manifest));
          return (
            roundTripped.schemaVersion === MANIFEST_SCHEMA_VERSION &&
            JSON.stringify(roundTripped) === JSON.stringify(manifest)
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

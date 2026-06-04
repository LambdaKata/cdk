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
 * Property-Based Test for the Preflight_Auditor — Property 11
 * (External-by-default-block / default-deny).
 *
 * Property 11: with default options, no Kata_Variant is attached to an external
 * event source and no shared external write path is enabled; such attachments
 * require a non-default disposition (`allow-with-explicit-ack`) PLUS a recorded
 * acknowledgement.
 *
 * The generator spans the full input space the auditor faces — owned vs external
 * references (Ref to in-template id, Fn::GetAtt, Fn::ImportValue, literal ARN,
 * parameter ref, dynamic reference), every configurable disposition, and the
 * presence/absence of a matching acknowledgement — so the invariant is proven
 * across the space rather than for hand-picked examples.
 *
 * **Validates: Requirements 11.7, 11.8, 11.10**
 *
 * @module benchmark-preflight.property.test
 */

import * as fc from 'fast-check';

import {
  auditPreflight,
  classifyResourceOwnership,
  computeEnablement,
  resolveFindingDisposition,
  type CfnReference,
  type PreflightFinding,
} from '../src/benchmark/preflight';
import type { PreflightDisposition } from '../src/benchmark/options';

/** Logical ids treated as "in this template" for the ownership kernel. */
const OWNED_IDS = new Set(['OwnedQueueAAAA', 'OwnedTableBBBB', 'OwnedTopicCCCC']);

/** References that the ownership kernel must classify as `owned`. */
const ownedReferenceArb: fc.Arbitrary<CfnReference> = fc.oneof(
  fc.constantFrom(...OWNED_IDS).map((id) => ({ Ref: id }) as CfnReference),
  fc.constantFrom(...OWNED_IDS).map((id) => ({ 'Fn::GetAtt': [id, 'Arn'] }) as CfnReference),
  fc.constantFrom(...OWNED_IDS).map((id) => ({ 'Fn::GetAtt': `${id}.Arn` }) as CfnReference),
);

/** References that the ownership kernel must classify as `external`. */
const externalReferenceArb: fc.Arbitrary<CfnReference> = fc.oneof(
  fc
    .string({ minLength: 1, maxLength: 12 })
    .map((s) => ({ 'Fn::ImportValue': `Import${s}` }) as CfnReference),
  fc.constantFrom(
    'arn:aws:sqs:us-east-1:999999999999:prod-queue',
    'arn:aws:dynamodb:us-east-1:999999999999:table/prod',
    '{{resolve:ssm:/prod/queue-arn:1}}',
    'prod-orders-queue',
  ),
  fc.constantFrom('SomeParameter', 'AWS::AccountId', 'NotInTemplate').map(
    (id) => ({ Ref: id }) as CfnReference,
  ),
);

const dispositionArb: fc.Arbitrary<PreflightDisposition> = fc.constantFrom(
  'block',
  'warn',
  'allow-with-explicit-ack',
);

describe('Preflight_Auditor — Property 11 (external-by-default-block)', () => {
  /**
   * **Validates: Requirements 11.7, 11.8**
   *
   * With DEFAULT options (no `externalResourceDisposition`, no
   * acknowledgements), every external write target and external event source
   * finding resolves to `block` and is never enabled.
   */
  it('never enables any external write target or event source under default options', () => {
    fc.assert(
      fc.property(
        externalReferenceArb,
        externalReferenceArb,
        fc.boolean(),
        (writeRef, eventRef, hasExistingConsumers) => {
          const findings = auditPreflight({
            ownedLogicalIds: OWNED_IDS,
            writeTargets: [
              { id: 'wt', reference: writeRef, resource: 'wt', sharedByBothVariants: true },
            ],
            eventSources: [
              {
                id: 'es',
                reference: eventRef,
                resource: 'es',
                cloneWouldAttach: true,
                hasExistingConsumers,
              },
            ],
          });

          const external = findings.filter(
            (f) => f.kind === 'external-write-target' || f.kind === 'external-event-source',
          );
          // Both external references must surface as findings, all blocked.
          return (
            external.length === 2 &&
            external.every((f) => f.disposition === 'block' && f.enabled === false)
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 11.10**
   *
   * An external finding is enabled IF AND ONLY IF its resolved disposition is
   * `allow-with-explicit-ack` AND a matching acknowledgement is recorded.
   */
  it('enables an external path iff disposition is allow-with-explicit-ack AND acknowledged', () => {
    fc.assert(
      fc.property(externalReferenceArb, dispositionArb, fc.boolean(), (writeRef, disposition, ack) => {
        const findings = auditPreflight({
          ownedLogicalIds: OWNED_IDS,
          writeTargets: [
            { id: 'wt', reference: writeRef, resource: 'wt', sharedByBothVariants: true },
          ],
          externalResourceDisposition: disposition,
          acknowledgements: ack ? [{ findingId: 'wt', acknowledgedBy: 'tester' }] : [],
        });

        const finding = findings.find((f) => f.kind === 'external-write-target');
        if (finding === undefined) {
          return false;
        }

        const expectedEnabled = disposition === 'allow-with-explicit-ack' && ack;
        return finding.enabled === expectedEnabled;
      }),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 11.1**
   *
   * Owned references never produce an external write-target / event-source
   * finding, for any disposition — sharing an OWNED resource is safe.
   */
  it('never emits an external finding for an owned reference', () => {
    fc.assert(
      fc.property(ownedReferenceArb, ownedReferenceArb, dispositionArb, (writeRef, eventRef, disposition) => {
        const findings: ReadonlyArray<PreflightFinding> = auditPreflight({
          ownedLogicalIds: OWNED_IDS,
          writeTargets: [
            { id: 'wt', reference: writeRef, resource: 'wt', sharedByBothVariants: true },
          ],
          eventSources: [
            { id: 'es', reference: eventRef, resource: 'es', cloneWouldAttach: true, hasExistingConsumers: true },
          ],
          externalResourceDisposition: disposition,
        });
        return findings.every(
          (f) => f.kind !== 'external-write-target' && f.kind !== 'external-event-source',
        );
      }),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 11.1**
   *
   * The ownership kernel agrees with the generators: owned arbitraries are
   * classified `owned`, external arbitraries `external`.
   */
  it('classifies generated owned/external references consistently', () => {
    fc.assert(
      fc.property(ownedReferenceArb, (ref) => classifyResourceOwnership(ref, OWNED_IDS) === 'owned'),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(externalReferenceArb, (ref) => classifyResourceOwnership(ref, OWNED_IDS) === 'external'),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 11.8, 11.9, 11.10**
   *
   * The pure enablement kernel: `block`/`warn` never enable; only
   * `allow-with-explicit-ack` + acknowledgement enables.
   */
  it('computeEnablement honours the disposition contract across all inputs', () => {
    fc.assert(
      fc.property(dispositionArb, fc.boolean(), (disposition, acknowledged) => {
        const enabled = computeEnablement(disposition, acknowledged);
        const expected = disposition === 'allow-with-explicit-ack' && acknowledged;
        return enabled === expected;
      }),
    );
  });

  /**
   * **Validates: Requirements 11.6, 11.7**
   *
   * External write/event-source dispositions always equal the configured
   * external disposition; the default (when omitted by `auditPreflight`) is
   * `block`.
   */
  it('resolves external dispositions to the configured value', () => {
    fc.assert(
      fc.property(dispositionArb, (configured) => {
        return (
          resolveFindingDisposition('external-write-target', configured) === configured &&
          resolveFindingDisposition('external-event-source', configured) === configured
        );
      }),
    );
  });
});

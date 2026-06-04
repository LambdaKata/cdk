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
 * Unit + CDK-assertion tests for the Preflight_Auditor (Layer C, Requirement
 * 11).
 *
 * The auditor classifies each referenced resource as owned vs external at synth
 * time (Req 11.1), emits the four finding kinds (Req 11.2–11.5), resolves each
 * finding's disposition — defaulting external write targets and external event
 * sources to `block` (Req 11.6, 11.7) — and computes enablement so that `block`
 * and `warn` never enable a path while `allow-with-explicit-ack` enables it only
 * with a recorded acknowledgement (Req 11.8–11.10). Property 11 (external by
 * default block / default-deny) is proven both here (default options) and in the
 * companion property test.
 *
 * **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8,
 * 11.9, 11.10, 11.11**
 *
 * @module benchmark-preflight.test
 */

import { App, CfnResource, Stack } from 'aws-cdk-lib';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Queue } from 'aws-cdk-lib/aws-sqs';

import {
  auditPreflight,
  classifyResourceOwnership,
  collectOwnedLogicalIds,
  computeEnablement,
  resolveFindingDisposition,
  EXPENSIVE_STATEFUL_RESOURCE_DISPOSITION,
  FIXED_PHYSICAL_NAME_DISPOSITION,
  type PreflightAuditRequest,
  type PreflightFinding,
  type PreflightFindingKind,
} from '../src/benchmark/preflight';
import type { PreflightDisposition } from '../src/benchmark/options';

const TEST_ENV = { account: '123456789012', region: 'us-east-1' };

const ALL_DISPOSITIONS: ReadonlyArray<PreflightDisposition> = [
  'block',
  'warn',
  'allow-with-explicit-ack',
];

/** A small owned-logical-id set used by the ownership unit tests. */
const OWNED_IDS = new Set(['OrdersQueue1234ABCD', 'BenchTable5678EFGH']);

/** Index findings by kind for convenient assertions. */
function byKind(findings: ReadonlyArray<PreflightFinding>): Map<PreflightFindingKind, PreflightFinding> {
  return new Map(findings.map((f) => [f.kind, f]));
}

describe('classifyResourceOwnership — owned vs external (Req 11.1)', () => {
  it('classifies a Ref to an in-template logical id as owned', () => {
    expect(classifyResourceOwnership({ Ref: 'OrdersQueue1234ABCD' }, OWNED_IDS)).toBe('owned');
  });

  it('classifies an Fn::GetAtt (array form) to an in-template logical id as owned', () => {
    expect(
      classifyResourceOwnership({ 'Fn::GetAtt': ['BenchTable5678EFGH', 'Arn'] }, OWNED_IDS),
    ).toBe('owned');
  });

  it('classifies an Fn::GetAtt (dotted-string form) to an in-template logical id as owned', () => {
    expect(classifyResourceOwnership({ 'Fn::GetAtt': 'OrdersQueue1234ABCD.Arn' }, OWNED_IDS)).toBe(
      'owned',
    );
  });

  it('classifies a Ref to a logical id NOT in the template as external (parameter ref)', () => {
    expect(classifyResourceOwnership({ Ref: 'SomeCfnParameter' }, OWNED_IDS)).toBe('external');
  });

  it('classifies a Ref to a pseudo parameter as external', () => {
    expect(classifyResourceOwnership({ Ref: 'AWS::AccountId' }, OWNED_IDS)).toBe('external');
  });

  it('classifies Fn::ImportValue (cross-stack export) as external', () => {
    expect(classifyResourceOwnership({ 'Fn::ImportValue': 'SharedQueueArn' }, OWNED_IDS)).toBe(
      'external',
    );
  });

  it('classifies a literal ARN/name string as external', () => {
    expect(
      classifyResourceOwnership('arn:aws:sqs:us-east-1:999999999999:prod-orders', OWNED_IDS),
    ).toBe('external');
  });

  it('classifies a dynamic reference string as external', () => {
    expect(
      classifyResourceOwnership('{{resolve:ssm:/prod/orders/queue-arn:1}}', OWNED_IDS),
    ).toBe('external');
  });

  it('classifies undefined / null references conservatively as external', () => {
    expect(classifyResourceOwnership(undefined, OWNED_IDS)).toBe('external');
    expect(classifyResourceOwnership(null, OWNED_IDS)).toBe('external');
  });

  it('classifies composite/ambiguous intrinsics (Fn::Sub, Fn::Join) conservatively as external', () => {
    expect(classifyResourceOwnership({ 'Fn::Sub': '${OrdersQueue1234ABCD.Arn}' }, OWNED_IDS)).toBe(
      'external',
    );
    expect(
      classifyResourceOwnership({ 'Fn::Join': ['', ['arn', { Ref: 'OrdersQueue1234ABCD' }]] }, OWNED_IDS),
    ).toBe('external');
  });
});

describe('collectOwnedLogicalIds — synth-time ownership inventory (Req 11.1)', () => {
  it('throws a descriptive error when not given a Stack', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => collectOwnedLogicalIds({} as any)).toThrow(/Stack/);
  });

  it('collects every in-template CfnResource logical id and classifies its own refs as owned', () => {
    const stack = new Stack(new App(), 'OwnershipStack', { env: TEST_ENV });
    const queue = new Queue(stack, 'OrdersQueue');
    new LambdaFunction(stack, 'Worker', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({});'),
    });

    const ownedIds = collectOwnedLogicalIds(stack);

    const queueLogicalId = stack.resolve((queue.node.defaultChild as CfnResource).ref) as { Ref: string };
    expect(ownedIds.has(queueLogicalId.Ref)).toBe(true);

    // A Ref to the in-template queue resolves to owned; a foreign ARN does not.
    expect(classifyResourceOwnership(stack.resolve(queue.queueArn), ownedIds)).toBe('owned');
    expect(
      classifyResourceOwnership('arn:aws:sqs:us-east-1:999999999999:external', ownedIds),
    ).toBe('external');
  });
});

describe('resolveFindingDisposition — per-kind disposition resolution (Req 11.6, 11.7)', () => {
  it('resolves external write targets and event sources to the configured external disposition', () => {
    for (const configured of ALL_DISPOSITIONS) {
      expect(resolveFindingDisposition('external-write-target', configured)).toBe(configured);
      expect(resolveFindingDisposition('external-event-source', configured)).toBe(configured);
    }
  });

  it('defaults external write targets and event sources to block (Req 11.7)', () => {
    expect(resolveFindingDisposition('external-write-target', 'block')).toBe('block');
    expect(resolveFindingDisposition('external-event-source', 'block')).toBe('block');
  });

  it('resolves a fixed-physical-name collision to block regardless of external config (Req 11.4)', () => {
    for (const configured of ALL_DISPOSITIONS) {
      expect(resolveFindingDisposition('fixed-physical-name', configured)).toBe(
        FIXED_PHYSICAL_NAME_DISPOSITION,
      );
    }
    expect(FIXED_PHYSICAL_NAME_DISPOSITION).toBe('block');
  });

  it('resolves an expensive-stateful-resource cost finding to warn (Req 11.5)', () => {
    for (const configured of ALL_DISPOSITIONS) {
      expect(resolveFindingDisposition('expensive-stateful-resource', configured)).toBe(
        EXPENSIVE_STATEFUL_RESOURCE_DISPOSITION,
      );
    }
    expect(EXPENSIVE_STATEFUL_RESOURCE_DISPOSITION).toBe('warn');
  });
});

describe('computeEnablement — disposition → enablement outcome (Req 11.8, 11.9, 11.10)', () => {
  it('block never enables, regardless of acknowledgement (Req 11.8)', () => {
    expect(computeEnablement('block', false)).toBe(false);
    expect(computeEnablement('block', true)).toBe(false);
  });

  it('warn keeps the path disabled, regardless of acknowledgement (Req 11.9)', () => {
    expect(computeEnablement('warn', false)).toBe(false);
    expect(computeEnablement('warn', true)).toBe(false);
  });

  it('allow-with-explicit-ack enables ONLY when an acknowledgement is recorded (Req 11.10)', () => {
    expect(computeEnablement('allow-with-explicit-ack', false)).toBe(false);
    expect(computeEnablement('allow-with-explicit-ack', true)).toBe(true);
  });
});

describe('auditPreflight — external-write-target finding (Req 11.2)', () => {
  const request = (
    overrides: Partial<PreflightAuditRequest> = {},
  ): PreflightAuditRequest => ({
    ownedLogicalIds: OWNED_IDS,
    writeTargets: [
      {
        id: 'wt-prod-orders',
        reference: 'arn:aws:dynamodb:us-east-1:999999999999:table/prod-orders',
        resource: 'prod-orders',
        sharedByBothVariants: true,
      },
    ],
    ...overrides,
  });

  it('reports a finding when both variants share an EXTERNAL write target', () => {
    const findings = auditPreflight(request());
    const finding = byKind(findings).get('external-write-target');
    expect(finding).toBeDefined();
    expect(finding?.ownership).toBe('external');
    expect(finding?.resource).toBe('prod-orders');
  });

  it('does NOT report a finding when the shared write target is OWNED', () => {
    const findings = auditPreflight(
      request({
        writeTargets: [
          {
            id: 'wt-owned',
            reference: { 'Fn::GetAtt': ['BenchTable5678EFGH', 'Arn'] },
            resource: 'BenchTable5678EFGH',
            sharedByBothVariants: true,
          },
        ],
      }),
    );
    expect(byKind(findings).has('external-write-target')).toBe(false);
  });

  it('does NOT report a finding when the external write target is not shared by both variants', () => {
    const findings = auditPreflight(
      request({
        writeTargets: [
          {
            id: 'wt-not-shared',
            reference: 'arn:aws:dynamodb:us-east-1:999999999999:table/prod-orders',
            resource: 'prod-orders',
            sharedByBothVariants: false,
          },
        ],
      }),
    );
    expect(byKind(findings).has('external-write-target')).toBe(false);
  });
});

describe('auditPreflight — external-event-source finding (Req 11.3)', () => {
  it('reports a competing-consumer finding for an external event source with existing consumers', () => {
    const findings = auditPreflight({
      ownedLogicalIds: OWNED_IDS,
      eventSources: [
        {
          id: 'es-prod-queue',
          reference: { 'Fn::ImportValue': 'ProdOrdersQueueArn' },
          resource: 'prod-orders-queue',
          cloneWouldAttach: true,
          hasExistingConsumers: true,
        },
      ],
    });
    const finding = byKind(findings).get('external-event-source');
    expect(finding).toBeDefined();
    expect(finding?.ownership).toBe('external');
    expect(finding?.detail.toLowerCase()).toContain('consumer');
  });

  it('reports an external event source finding even without existing consumers (default-deny posture, Req 11.7)', () => {
    const findings = auditPreflight({
      ownedLogicalIds: OWNED_IDS,
      eventSources: [
        {
          id: 'es-external-no-consumers',
          reference: 'arn:aws:sqs:us-east-1:999999999999:external-queue',
          resource: 'external-queue',
          cloneWouldAttach: true,
          hasExistingConsumers: false,
        },
      ],
    });
    expect(byKind(findings).has('external-event-source')).toBe(true);
  });

  it('does NOT report a finding for an OWNED event source', () => {
    const findings = auditPreflight({
      ownedLogicalIds: OWNED_IDS,
      eventSources: [
        {
          id: 'es-owned',
          reference: { Ref: 'OrdersQueue1234ABCD' },
          resource: 'OrdersQueue1234ABCD',
          cloneWouldAttach: true,
          hasExistingConsumers: true,
        },
      ],
    });
    expect(byKind(findings).has('external-event-source')).toBe(false);
  });

  it('does NOT report a finding when the clone would not attach', () => {
    const findings = auditPreflight({
      ownedLogicalIds: OWNED_IDS,
      eventSources: [
        {
          id: 'es-detached',
          reference: { 'Fn::ImportValue': 'ProdOrdersQueueArn' },
          resource: 'prod-orders-queue',
          cloneWouldAttach: false,
          hasExistingConsumers: true,
        },
      ],
    });
    expect(byKind(findings).has('external-event-source')).toBe(false);
  });
});

describe('auditPreflight — fixed-physical-name collision finding (Req 11.4)', () => {
  it('reports a deployment-collision finding when the kata variant requires the same fixed name', () => {
    const findings = auditPreflight({
      ownedLogicalIds: OWNED_IDS,
      fixedPhysicalNames: [
        {
          id: 'fpn-orders-queue',
          reference: { Ref: 'OrdersQueue1234ABCD' },
          resource: 'prod-orders-queue',
          physicalName: 'prod-orders-queue',
          requiredByKataVariant: true,
        },
      ],
    });
    const finding = byKind(findings).get('fixed-physical-name');
    expect(finding).toBeDefined();
    expect(finding?.disposition).toBe('block');
    expect(finding?.enabled).toBe(false);
  });

  it('does NOT report a collision when the kata variant does not require the fixed name', () => {
    const findings = auditPreflight({
      ownedLogicalIds: OWNED_IDS,
      fixedPhysicalNames: [
        {
          id: 'fpn-not-required',
          reference: { Ref: 'OrdersQueue1234ABCD' },
          resource: 'prod-orders-queue',
          physicalName: 'prod-orders-queue',
          requiredByKataVariant: false,
        },
      ],
    });
    expect(byKind(findings).has('fixed-physical-name')).toBe(false);
  });
});

describe('auditPreflight — expensive-stateful-resource cost finding (Req 11.5)', () => {
  it('reports a cost finding for a benchmark-relevant expensive stateful resource', () => {
    const findings = auditPreflight({
      ownedLogicalIds: OWNED_IDS,
      statefulResources: [
        {
          id: 'cost-rds-cluster',
          reference: { Ref: 'BenchTable5678EFGH' },
          resource: 'analytics-aurora-cluster',
          resourceType: 'AWS::RDS::DBCluster',
        },
      ],
    });
    const finding = byKind(findings).get('expensive-stateful-resource');
    expect(finding).toBeDefined();
    expect(finding?.disposition).toBe('warn');
    // A cost finding is advisory: it does not enable a path, but it does not
    // hard-block the run either (Req 11.9 — warn keeps disabled).
    expect(finding?.enabled).toBe(false);
    expect(finding?.detail).toContain('AWS::RDS::DBCluster');
  });
});

describe('auditPreflight — disposition outcomes for external findings (Req 11.8, 11.9, 11.10)', () => {
  const externalWriteTarget = {
    id: 'wt-prod',
    reference: 'arn:aws:dynamodb:us-east-1:999999999999:table/prod',
    resource: 'prod',
    sharedByBothVariants: true,
  } as const;

  it('block prevents enablement (Req 11.8)', () => {
    const [finding] = auditPreflight({
      ownedLogicalIds: OWNED_IDS,
      writeTargets: [externalWriteTarget],
      externalResourceDisposition: 'block',
    });
    expect(finding?.disposition).toBe('block');
    expect(finding?.enabled).toBe(false);
    expect(finding?.acknowledged).toBe(false);
  });

  it('warn keeps the path disabled and is surfaced as a finding (Req 11.9)', () => {
    const [finding] = auditPreflight({
      ownedLogicalIds: OWNED_IDS,
      writeTargets: [externalWriteTarget],
      externalResourceDisposition: 'warn',
    });
    expect(finding?.disposition).toBe('warn');
    expect(finding?.enabled).toBe(false);
  });

  it('allow-with-explicit-ack WITHOUT a recorded acknowledgement is treated as block (Req 11.10)', () => {
    const [finding] = auditPreflight({
      ownedLogicalIds: OWNED_IDS,
      writeTargets: [externalWriteTarget],
      externalResourceDisposition: 'allow-with-explicit-ack',
      acknowledgements: [],
    });
    expect(finding?.disposition).toBe('allow-with-explicit-ack');
    expect(finding?.acknowledged).toBe(false);
    expect(finding?.enabled).toBe(false);
  });

  it('allow-with-explicit-ack WITH a matching recorded acknowledgement enables the path (Req 11.10)', () => {
    const [finding] = auditPreflight({
      ownedLogicalIds: OWNED_IDS,
      writeTargets: [externalWriteTarget],
      externalResourceDisposition: 'allow-with-explicit-ack',
      acknowledgements: [{ findingId: 'wt-prod', acknowledgedBy: 'tech-lead' }],
    });
    expect(finding?.disposition).toBe('allow-with-explicit-ack');
    expect(finding?.acknowledged).toBe(true);
    expect(finding?.enabled).toBe(true);
  });

  it('an acknowledgement for a DIFFERENT finding id does not enable the path', () => {
    const [finding] = auditPreflight({
      ownedLogicalIds: OWNED_IDS,
      writeTargets: [externalWriteTarget],
      externalResourceDisposition: 'allow-with-explicit-ack',
      acknowledgements: [{ findingId: 'some-other-finding', acknowledgedBy: 'tech-lead' }],
    });
    expect(finding?.acknowledged).toBe(false);
    expect(finding?.enabled).toBe(false);
  });
});

describe('auditPreflight — default-deny / Property 11 (Req 11.7, 11.8)', () => {
  it('with default options, NO external write target or event source is enabled', () => {
    const findings = auditPreflight({
      ownedLogicalIds: OWNED_IDS,
      writeTargets: [
        {
          id: 'wt-prod',
          reference: 'arn:aws:dynamodb:us-east-1:999999999999:table/prod',
          resource: 'prod',
          sharedByBothVariants: true,
        },
      ],
      eventSources: [
        {
          id: 'es-prod',
          reference: { 'Fn::ImportValue': 'ProdQueueArn' },
          resource: 'prod-queue',
          cloneWouldAttach: true,
          hasExistingConsumers: true,
        },
      ],
      // externalResourceDisposition omitted → default block.
    });

    const external = findings.filter(
      (f) => f.kind === 'external-write-target' || f.kind === 'external-event-source',
    );
    expect(external.length).toBe(2);
    for (const finding of external) {
      expect(finding.disposition).toBe('block');
      expect(finding.enabled).toBe(false);
    }
  });

  it('records every finding and its disposition (Req 11.11) and emits no findings for an empty request', () => {
    expect(auditPreflight({ ownedLogicalIds: OWNED_IDS })).toEqual([]);
  });
});

describe('auditPreflight — argument validation', () => {
  it('throws a descriptive error when ownedLogicalIds is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => auditPreflight({} as any)).toThrow(/ownedLogicalIds/);
  });
});

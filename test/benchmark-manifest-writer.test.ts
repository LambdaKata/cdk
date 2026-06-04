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
 * CDK assertion tests for the {@link ManifestWriter} (Layer C, task 13):
 * {@link writeManifest}.
 *
 * The writer is the synth→run-time bridge: it writes the resolved manifest body
 * to SSM Parameter Store (small bodies) or S3 (large bodies) and emits a
 * `CfnOutput` carrying ONLY the pointer — never the manifest body itself. These
 * tests pin that contract against a synthesized template:
 *
 * - **(a) small body → SSM inline (Req 17.5):** a single `AWS::SSM::Parameter`
 *   is synthesized whose `Value` IS the serialized manifest body; no S3 object
 *   is created.
 * - **(b) CfnOutput pointer only (Req 10.3, 10.4):** exactly one `Output` is
 *   present and its value is the SSM parameter name (the pointer), NOT the
 *   manifest body.
 * - **(c) manifest body content (Req 10.3, 10.4, 17.5):** the SSM `Value`
 *   contains the variant function names, the kata alias ARN ref, the log group
 *   names, and the event-source-mapping UUID attribute tokens.
 * - **(d) large body → S3 (Req 17.5):** when the body exceeds the SSM inline
 *   threshold, the body is written to S3 (a bucket + a deployment) and the SSM
 *   parameter holds an `s3://` pointer rather than the body; the CfnOutput still
 *   carries only the SSM parameter-name pointer.
 * - **(e) deterministic resolved ids (Req 10.3, 10.4):** resolved function/alias
 *   ARNs, log group names, and mapping UUID tokens supplied in the manifest are
 *   present verbatim in the deployed body.
 *
 * **Validates: Requirements 10.3, 10.4, 17.5**
 *
 * @module benchmark-manifest-writer.test
 */

import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CfnEventSourceMapping } from 'aws-cdk-lib/aws-lambda';

import {
  buildBenchmarkManifest,
  serializeManifest,
  RunDesignAccumulator,
} from '../src/benchmark/manifest';
import type { BenchmarkManifest, ManifestVariant } from '../src/benchmark/manifest';
import {
  writeManifest,
  ManifestWriter,
  DEFAULT_MANIFEST_PARAMETER_PREFIX,
  SSM_INLINE_MAX_BYTES,
} from '../src/benchmark/manifest-writer';
import { FidelityLevel } from '../src/benchmark/options';

const TEST_ENV = { account: '123456789012', region: 'us-east-1' };

/** Create an isolated App + Stack for a single test case. */
function createStack(id = 'ManifestWriterStack'): Stack {
  return new Stack(new App(), id, { env: TEST_ENV });
}

/** A representative resolved manifest variant with a competing trigger. */
function sampleVariant(overrides: Partial<ManifestVariant> = {}): ManifestVariant {
  return {
    constructPath: 'Stack/OrderService/Handler',
    baseline: {
      functionName: 'order-service',
      functionArn: 'arn:aws:lambda:us-east-1:123456789012:function:order-service',
      logGroup: '/aws/lambda/order-service',
    },
    kata: {
      functionName: 'order-service-kata',
      functionArn: 'arn:aws:lambda:us-east-1:123456789012:function:order-service-kata',
      aliasArn: 'arn:aws:lambda:us-east-1:123456789012:function:order-service-kata:kata',
      version: '7',
      logGroup: '/aws/lambda/order-service-kata',
    },
    trigger: {
      type: 'sqs',
      routingClass: 'competing',
      baselineMappingUuid: 'a1b2c3d4-1111-2222-3333-444455556666',
      kataMappingUuid: 'f6e5d4c3-7777-8888-9999-aaaabbbbcccc',
      source: { isolated: true, ref: 'arn:aws:sqs:us-east-1:123456789012:bench-queue' },
    },
    ...overrides,
  };
}

/** Build a manifest from variants with a default run-design. */
function buildManifest(variants: ReadonlyArray<ManifestVariant>): BenchmarkManifest {
  return buildBenchmarkManifest({
    benchRunSeed: 'seed-abc',
    region: 'us-east-1',
    ownershipTag: { key: 'lambda-kata:bench-run-id', value: 'seed-abc' },
    variants,
    runDesign: new RunDesignAccumulator({ fidelity: FidelityLevel.L1 }).build(),
  });
}

describe('writeManifest — small body → SSM inline (Req 17.5)', () => {
  it('synthesizes exactly one SSM parameter whose Value is the serialized manifest body', () => {
    const stack = createStack();
    const manifest = buildManifest([sampleVariant()]);

    const result = writeManifest(stack, manifest);

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::SSM::Parameter', 1);
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Type: 'String',
      Value: serializeManifest(manifest),
    });
    // No S3 storage for a small body.
    template.resourceCountIs('AWS::S3::Bucket', 0);
    expect(result.parameterName).toBeDefined();
  });

  it('derives the parameter name under the harness-owned prefix when none is supplied', () => {
    const stack = createStack();
    const manifest = buildManifest([sampleVariant()]);

    writeManifest(stack, manifest);

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: Match.stringLikeRegexp(`^${DEFAULT_MANIFEST_PARAMETER_PREFIX}`),
    });
  });

  it('honours an explicit SSM parameter name from storage options', () => {
    const stack = createStack();
    const manifest = buildManifest([sampleVariant()]);

    const result = writeManifest(stack, manifest, {
      ssmParameterName: '/custom/bench/manifest',
    });

    expect(result.parameterName).toBe('/custom/bench/manifest');
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/custom/bench/manifest',
    });
  });
});

describe('writeManifest — CfnOutput carries only the pointer (Req 10.3, 10.4)', () => {
  it('emits exactly one Output whose value is the SSM parameter name, not the manifest body', () => {
    const stack = createStack();
    const manifest = buildManifest([sampleVariant()]);

    writeManifest(stack, manifest);

    const template = Template.fromStack(stack);
    const outputs = template.findOutputs('*');
    const outputValues = Object.values(outputs);

    expect(outputValues).toHaveLength(1);

    const serialized = serializeManifest(manifest);
    const renderedOutput = JSON.stringify(outputValues[0]?.Value);
    // The pointer must NOT be the manifest body.
    expect(renderedOutput).not.toContain('order-service-kata');
    expect(renderedOutput.length).toBeLessThan(serialized.length);
  });
});

describe('writeManifest — manifest body content (Req 10.3, 10.4, 17.5)', () => {
  it('stores variant names, alias ARN ref, log groups, and mapping UUID tokens in the body', () => {
    const stack = createStack();
    const variant = sampleVariant();
    const manifest = buildManifest([variant]);

    writeManifest(stack, manifest);

    const template = Template.fromStack(stack);
    const params = template.findResources('AWS::SSM::Parameter');
    const value = Object.values(params)[0]?.Properties?.Value as string;

    expect(value).toContain(variant.baseline.functionName);
    expect(value).toContain(variant.kata.functionName);
    expect(value).toContain(variant.kata.aliasArn);
    expect(value).toContain(variant.baseline.logGroup);
    expect(value).toContain(variant.kata.logGroup);
    expect(value).toContain(variant.trigger?.baselineMappingUuid as string);
    expect(value).toContain(variant.trigger?.kataMappingUuid as string);
  });

  it('resolves a real deploy-time CfnEventSourceMapping.attrId token into the deployed SSM body (Req 10.3, 10.4)', () => {
    const stack = createStack();

    // A genuine event source mapping whose UUID is a CloudFormation attribute
    // resolved at deploy time (Req 10.3, 10.4).
    const mapping = new CfnEventSourceMapping(stack, 'KataMapping', {
      functionName: 'order-service-kata',
      eventSourceArn: 'arn:aws:sqs:us-east-1:123456789012:bench-queue',
      enabled: false,
    });

    const variant = sampleVariant({
      trigger: {
        type: 'sqs',
        routingClass: 'competing',
        kataMappingUuid: mapping.attrId,
        source: { isolated: true, ref: 'arn:aws:sqs:us-east-1:123456789012:bench-queue' },
      },
    });
    const manifest = buildManifest([variant]);

    writeManifest(stack, manifest);

    const template = Template.fromStack(stack);
    const params = template.findResources('AWS::SSM::Parameter');
    const value = Object.values(params)[0]?.Properties?.Value;

    // The unresolved attrId token is rendered into the SSM Value as an intrinsic
    // (Fn::Join over a Fn::GetAtt of the mapping's Id) — i.e. the deploy-time
    // UUID is embedded in the manifest body, not a literal placeholder.
    const rendered = JSON.stringify(value);
    expect(rendered).toContain('Fn::Join');
    expect(rendered).toContain('KataMapping');
    expect(rendered).toContain('Id');
    // The variant names are still present as literals in the same body.
    expect(rendered).toContain('order-service-kata');
  });
});

describe('writeManifest — large body → S3 with SSM pointer (Req 17.5)', () => {
  it('writes the body to S3 and stores an s3:// pointer in SSM when the body exceeds the inline threshold', () => {
    const stack = createStack();

    const { manifest } = buildOversizedManifest();

    const result = writeManifest(stack, manifest);

    const template = Template.fromStack(stack);
    // The body lives in S3 (bucket present); the SSM parameter holds a pointer.
    template.resourceCountIs('AWS::S3::Bucket', 1);
    const params = template.findResources('AWS::SSM::Parameter');
    const value = Object.values(params)[0]?.Properties?.Value;

    // The SSM value is an `s3://` pointer (a Fn::Join over the bucket-name
    // token), NOT the manifest body itself.
    const renderedValue = JSON.stringify(value);
    expect(renderedValue).toContain('s3://');
    expect(renderedValue).not.toContain('order-service-kata');
    expect(renderedValue.length).toBeLessThan(serializeManifest(manifest).length);

    // The CfnOutput still carries only the SSM parameter-name pointer.
    const outputs = template.findOutputs('*');
    expect(Object.values(outputs)).toHaveLength(1);
    expect(result.parameterName).toBeDefined();
  });

  it('exposes storedInS3=false for a small body and storedInS3=true for a large body (ManifestWriter)', () => {
    const smallStack = createStack('SmallBodyStack');
    const smallWriter = new ManifestWriter(smallStack, 'BenchmarkManifest', {
      manifest: buildManifest([sampleVariant()]),
    });
    expect(smallWriter.storedInS3).toBe(false);
    expect(smallWriter.bucket).toBeUndefined();

    const largeStack = createStack('LargeBodyStack');
    const largeWriter = new ManifestWriter(largeStack, 'BenchmarkManifest', {
      manifest: buildOversizedManifest().manifest,
    });
    expect(largeWriter.storedInS3).toBe(true);
    expect(largeWriter.bucket).toBeDefined();
  });
});

/** Build a manifest whose serialized body exceeds {@link SSM_INLINE_MAX_BYTES}. */
function buildOversizedManifest(): { manifest: BenchmarkManifest } {
  const variants: ManifestVariant[] = [];
  let index = 0;
  let manifest = buildManifest([sampleVariant()]);
  while (serializeManifest(manifest).length <= SSM_INLINE_MAX_BYTES) {
    variants.push(sampleVariant({ constructPath: `Stack/Service${index}/Handler` }));
    index += 1;
    manifest = buildManifest(variants);
  }
  return { manifest };
}

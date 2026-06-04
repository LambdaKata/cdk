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
 * CDK assertion tests for the InvokePathRewriter (Layer B, task 6):
 * {@link rewriteInvokePaths}.
 *
 * These prove that after `kata()` publishes a SnapStart version + `kata` alias
 * on a clone, every invoke path the rewriter owns is redirected at the
 * alias/published version rather than `$LATEST`, and that any path the rewriter
 * cannot reach is recorded so the SnapStart exercise is flagged "not
 * guaranteed":
 *
 * - **(a) event source mappings (Req 7.2):** a clone `CfnEventSourceMapping`
 *   `FunctionName` is repointed from the clone `$LATEST` ref to the alias ARN.
 * - **(b) synchronous integrations + permissions (Req 7.3):** a clone
 *   `AWS::Lambda::Permission` `FunctionName` and a clone `AWS::Lambda::Url`
 *   qualifier are repointed at the alias.
 * - **(c) fresh invoke permission (Req 7.3):** a resource-based invoke
 *   permission is created fresh against the clone alias (never inherited).
 * - **(d) Property 14 (Req 7.4):** an invoke path the rewriter cannot redirect
 *   is recorded in `unrewritablePaths` and `snapStartGuaranteed` becomes false.
 * - **(e) Property 14 (Req 7.1):** when every owned path is rewritten and none
 *   is un-rewritable, `snapStartGuaranteed` is true and `unrewritablePaths` is
 *   empty.
 *
 * Entitlement is forced via the native licensing module mock — the SAME seam
 * the clone-builder and example-synth tests use — so `kata()` actually
 * transforms the clone and attaches the `SnapStartActivator` whose
 * `aliasArnRef` the rewriter targets.
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
 *
 * @module benchmark-invoke-path-rewriter.test
 */

import * as path from 'path';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  CfnEventSourceMapping,
  CfnPermission,
  CfnUrl,
  Code,
  Function as LambdaFunction,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';

// Imported after the mock is declared (jest hoists the mock above imports).
import { NativeLicensingService } from '@lambda-kata/licensing';

import { buildKataClone, KataCloneResult } from '../src/benchmark/clone-builder';
import { rewriteInvokePaths } from '../src/benchmark/invoke-path-rewriter';

const TEST_ACCOUNT = '123456789012';
const TEST_REGION = 'us-east-1';
const TEST_LAYER_ARN = 'arn:aws:lambda:us-east-1:999999999999:layer:LambdaKata:1';
const TEST_ENV = { account: TEST_ACCOUNT, region: TEST_REGION };
const FIXTURE_ASSET_DIR = path.join(__dirname, 'fixtures');
const BASELINE_HANDLER = 'simple-handler.handler';

// Force the native licensing module response so the synchronous kata() path
// transforms the clone and attaches the SnapStartActivator (alias) the rewriter
// targets. This is the only transformation path; the harness adds no alternate.
jest.mock('@lambda-kata/licensing', () => ({
  NativeLicensingService: jest.fn().mockImplementation(() => ({
    checkEntitlementSync: jest.fn(),
  })),
}));

const mockNativeLicensingService = NativeLicensingService as jest.Mock;

/** Configure the mock to report the test account as ENTITLED. */
function mockEntitled(): void {
  mockNativeLicensingService.mockImplementation(() => ({
    checkEntitlementSync: jest.fn().mockReturnValue({
      entitled: true,
      layerVersionArn: TEST_LAYER_ARN,
    }),
  }));
}

beforeEach(() => {
  mockNativeLicensingService.mockClear();
  mockEntitled();
});

/** Create an isolated App + Stack for a single test case. */
function createStack(id = 'InvokePathStack'): Stack {
  return new Stack(new App({ context: { 'aws:cdk:account': TEST_ACCOUNT } }), id, { env: TEST_ENV });
}

/** Create an asset-backed Node.js baseline Lambda. */
function createBaseline(stack: Stack, id: string): LambdaFunction {
  return new LambdaFunction(stack, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: BASELINE_HANDLER,
    code: Code.fromAsset(FIXTURE_ASSET_DIR),
  });
}

/** Build a transformed kata clone whose alias is available to the rewriter. */
function buildClone(stack: Stack, baselineId: string, cloneId: string): KataCloneResult {
  const baseline = createBaseline(stack, baselineId);
  const result = buildKataClone(stack, cloneId, baseline.node.defaultChild as never, 'reuse-role');
  // Precondition for every rewriter test: the clone really got an alias.
  expect(result.transformed).toBe(true);
  expect(result.aliasArnRef).toBeDefined();
  return result;
}

describe('rewriteInvokePaths — (a) event source mappings target the alias (Req 7.2)', () => {
  it('repoints a clone CfnEventSourceMapping FunctionName from $LATEST to the alias ARN', () => {
    const stack = createStack('EsmStack');
    const clone = buildClone(stack, 'Orders', 'OrdersClone');

    const esm = clone.cloneFunction.addEventSourceMapping('Sqs', {
      eventSourceArn: `arn:aws:sqs:${TEST_REGION}:${TEST_ACCOUNT}:bench-queue`,
    });
    const esmCfn = esm.node.defaultChild as CfnEventSourceMapping;

    // Before the rewrite the mapping points at the clone function ($LATEST).
    const cloneNameRef = stack.resolve(clone.cloneFunction.functionName);
    expect(stack.resolve(esmCfn.functionName)).toEqual(cloneNameRef);

    const result = rewriteInvokePaths({ cloneFunction: clone.cloneFunction }, clone.aliasArnRef as string);

    // After the rewrite it targets the alias ARN, not $LATEST.
    expect(stack.resolve(esmCfn.functionName)).toEqual(stack.resolve(clone.aliasArnRef));
    expect(stack.resolve(esmCfn.functionName)).not.toEqual(cloneNameRef);
    expect(result.rewrittenPaths).toContain(esmCfn.node.path);
    expect(result.snapStartGuaranteed).toBe(true);
  });
});

describe('rewriteInvokePaths — (b) synchronous integrations + permissions target the alias (Req 7.3)', () => {
  it('repoints a clone CfnPermission FunctionName to the alias ARN', () => {
    const stack = createStack('PermissionStack');
    const clone = buildClone(stack, 'Orders', 'OrdersClone');

    clone.cloneFunction.addPermission('ApiInvoke', {
      principal: new ServicePrincipal('apigateway.amazonaws.com'),
    });
    const permCfn = clone.cloneFunction.node.findChild('ApiInvoke') as CfnPermission;

    const cloneArnRef = stack.resolve(clone.cloneFunction.functionArn);
    expect(stack.resolve(permCfn.functionName)).toEqual(cloneArnRef);

    const result = rewriteInvokePaths({ cloneFunction: clone.cloneFunction }, clone.aliasArnRef as string);

    expect(stack.resolve(permCfn.functionName)).toEqual(stack.resolve(clone.aliasArnRef));
    expect(stack.resolve(permCfn.functionName)).not.toEqual(cloneArnRef);
    expect(result.rewrittenPaths).toContain(permCfn.node.path);
  });

  it('repoints a clone Function URL at the alias via the qualifier', () => {
    const stack = createStack('FunctionUrlStack');
    const clone = buildClone(stack, 'Orders', 'OrdersClone');

    const url = clone.cloneFunction.addFunctionUrl();
    const urlCfn = url.node.defaultChild as CfnUrl;

    // CDK wires the URL at the unqualified function ($LATEST) by default.
    expect(urlCfn.qualifier).toBeUndefined();

    const result = rewriteInvokePaths(
      { cloneFunction: clone.cloneFunction, aliasName: 'kata' },
      clone.aliasArnRef as string,
    );

    expect(urlCfn.qualifier).toBe('kata');
    expect(result.rewrittenPaths).toContain(urlCfn.node.path);
  });
});

describe('rewriteInvokePaths — (c) fresh invoke permission for the clone alias (Req 7.3)', () => {
  it('creates a NEW AWS::Lambda::Permission targeting the alias (not inherited)', () => {
    const stack = createStack('FreshPermissionStack');
    const clone = buildClone(stack, 'Orders', 'OrdersClone');

    // No clone-owned permission exists before the rewrite creates the fresh one.
    expect(stack.node.tryFindChild('OrdersCloneApiGwInvoke')).toBeUndefined();

    const result = rewriteInvokePaths(
      {
        cloneFunction: clone.cloneFunction,
        freshInvokePermissions: [
          {
            id: 'ApiGwInvoke',
            principal: 'apigateway.amazonaws.com',
            sourceArn: `arn:aws:execute-api:${TEST_REGION}:${TEST_ACCOUNT}:abc123/*/*/*`,
          },
        ],
      },
      clone.aliasArnRef as string,
    );

    // The fresh permission is a SIBLING of the clone (namespaced by clone id)
    // so it never forms a dependency cycle with the SnapStartActivator.
    const fresh = stack.node.findChild('OrdersCloneApiGwInvoke') as CfnPermission;
    expect(fresh).toBeInstanceOf(CfnPermission);
    expect(fresh.principal).toBe('apigateway.amazonaws.com');
    expect(stack.resolve(fresh.functionName)).toEqual(stack.resolve(clone.aliasArnRef));
    expect(result.rewrittenPaths).toContain(fresh.node.path);

    // Synthesize ONCE, after the tree is final: the fresh permission targeting
    // the alias is present in the template.
    const permissions = Template.fromStack(stack).findResources('AWS::Lambda::Permission');
    const freshInTemplate = Object.values(permissions).filter(
      (p) => (p as { Properties: { Principal?: string } }).Properties.Principal ===
        'apigateway.amazonaws.com',
    );
    expect(freshInTemplate).toHaveLength(1);
  });
});

describe('rewriteInvokePaths — Property 14: SnapStart-exercised or flagged (Req 7.1, 7.4)', () => {
  it('(d) records an un-rewritable invoke path and marks SnapStart not guaranteed', () => {
    const stack = createStack('UnrewritableStack');
    const clone = buildClone(stack, 'Orders', 'OrdersClone');

    // A rewritable path PLUS an opaque cross-stack consumer the rewriter cannot
    // reach (surfaced by the orchestrator). The latter must be recorded.
    clone.cloneFunction.addEventSourceMapping('Sqs', {
      eventSourceArn: `arn:aws:sqs:${TEST_REGION}:${TEST_ACCOUNT}:bench-queue`,
    });
    const opaquePath = 'CrossStackConsumer:arn:aws:states:us-east-1:123456789012:stateMachine:legacy';

    const result = rewriteInvokePaths(
      { cloneFunction: clone.cloneFunction, externalInvokePaths: [opaquePath] },
      clone.aliasArnRef as string,
    );

    expect(result.unrewritablePaths).toContain(opaquePath);
    expect(result.snapStartGuaranteed).toBe(false);
    // The reachable path was still rewritten.
    expect(result.rewrittenPaths.length).toBeGreaterThan(0);
  });

  it('(e) guarantees SnapStart when every owned path is rewritten and none is un-rewritable', () => {
    const stack = createStack('GuaranteedStack');
    const clone = buildClone(stack, 'Orders', 'OrdersClone');

    clone.cloneFunction.addEventSourceMapping('Sqs', {
      eventSourceArn: `arn:aws:sqs:${TEST_REGION}:${TEST_ACCOUNT}:bench-queue`,
    });
    clone.cloneFunction.addPermission('ApiInvoke', {
      principal: new ServicePrincipal('apigateway.amazonaws.com'),
    });

    const result = rewriteInvokePaths({ cloneFunction: clone.cloneFunction }, clone.aliasArnRef as string);

    expect(result.unrewritablePaths).toEqual([]);
    expect(result.snapStartGuaranteed).toBe(true);
    expect(result.rewrittenPaths.length).toBeGreaterThanOrEqual(2);
  });
});

describe('rewriteInvokePaths — precondition + isolation', () => {
  it('throws a descriptive error when the alias ARN reference is empty', () => {
    const stack = createStack('NoAliasStack');
    const clone = buildClone(stack, 'Orders', 'OrdersClone');

    expect(() => rewriteInvokePaths({ cloneFunction: clone.cloneFunction }, '')).toThrow(/alias/i);
  });

  it('does not rewrite invoke paths that target a different function', () => {
    const stack = createStack('IsolationStack');
    const clone = buildClone(stack, 'Orders', 'OrdersClone');

    // A second, unrelated function with its own permission must be left alone.
    const other = createBaseline(stack, 'Other');
    other.addPermission('OtherInvoke', {
      principal: new ServicePrincipal('sns.amazonaws.com'),
    });
    const otherPerm = other.node.findChild('OtherInvoke') as CfnPermission;
    const otherBefore = stack.resolve(otherPerm.functionName);

    rewriteInvokePaths({ cloneFunction: clone.cloneFunction }, clone.aliasArnRef as string);

    expect(stack.resolve(otherPerm.functionName)).toEqual(otherBefore);
    expect(stack.resolve(otherPerm.functionName)).not.toEqual(stack.resolve(clone.aliasArnRef));
  });
});

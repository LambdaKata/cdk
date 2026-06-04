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
 * CDK assertion tests for the CloneBuilder L1 prop reader + clone materializer
 * (Layer B, Requirement 4, 14 — task 5.1 only).
 *
 * These exercise {@link readBaselineFunctionProps} and
 * {@link materializeCloneFunction} against fixture stacks containing real
 * Lambda functions, pinning the clone-from-L1 seam:
 *
 * - the clone reuses the SAME code asset location (no re-upload, Req 4.5);
 * - the clone reuses the SAME execution role (reuse-role default, Req 14.2)
 *   without provisioning a new IAM role;
 * - the clone is a sibling within the same stack as its baseline;
 * - the clone function name is derived through the NamingResolver (Req 6);
 * - role-mode reuse-role / clone-role / provided-role behave per Req 14;
 * - L1 scalar/struct props (runtime, handler, timeout, memory, architectures,
 *   environment, and when-present ephemeralStorage / fileSystemConfigs /
 *   kmsKeyArn / tracingConfig / vpcConfig) are copied onto the clone
 *   (Req 4.2, 4.3);
 * - the documented L2-facade fallback records an eligibility warning for each
 *   prop that cannot be represented by the L2 facade (vpc/EFS/KMS);
 * - environment KEYS are recorded without their values (Req 14.4, 14.5);
 * - layers are reused through the L2 API so a later kata()-style addLayers()
 *   still merges (so task 5.2 can cleanly call kata() on the result).
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.5, 14.1, 14.2, 14.3**
 *
 * @module benchmark-clone-builder.test
 */

import * as path from 'path';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  Architecture,
  CfnFunction,
  Code,
  Function as LambdaFunction,
  LayerVersion,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';

import { NamingResolver } from '../src/benchmark/naming';
import {
  materializeCloneFunction,
  readBaselineFunctionProps,
} from '../src/benchmark/clone-builder';

const TEST_ENV = { account: '123456789012', region: 'us-east-1' };
const FIXTURE_ASSET_DIR = path.join(__dirname, 'fixtures');

/** Create an isolated App + Stack for a single test case. */
function createStack(id = 'CloneBuilderStack'): Stack {
  return new Stack(new App(), id, { env: TEST_ENV });
}

/** Create an asset-backed Node.js Lambda (so the code is a real S3 asset). */
function createAssetLambda(
  scope: Stack,
  id: string,
  props: Partial<{
    functionName: string;
    environment: Record<string, string>;
    role: Role;
    memorySize: number;
    architecture: Architecture;
  }> = {},
): LambdaFunction {
  return new LambdaFunction(scope, id, {
    runtime: Runtime.NODEJS_20_X,
    handler: 'simple-handler.handler',
    code: Code.fromAsset(FIXTURE_ASSET_DIR),
    ...(props.functionName ? { functionName: props.functionName } : {}),
    ...(props.environment ? { environment: props.environment } : {}),
    ...(props.role ? { role: props.role } : {}),
    ...(props.memorySize ? { memorySize: props.memorySize } : {}),
    ...(props.architecture ? { architecture: props.architecture } : {}),
  });
}

/** Read the synthesized L1 `CfnFunction` of a baseline. */
function l1Of(fn: LambdaFunction): CfnFunction {
  return fn.node.defaultChild as CfnFunction;
}

describe('readBaselineFunctionProps — L1 prop reader (Req 4.2, 4.3)', () => {
  it('reads the core props copied onto every clone (Req 4.2)', () => {
    const stack = createStack('ReaderCoreStack');
    const baseline = createAssetLambda(stack, 'Orders', {
      environment: { TABLE_NAME: 'orders', ENDPOINT: 'https://x' },
      memorySize: 1024,
    });

    const props = readBaselineFunctionProps(l1Of(baseline));

    expect(props.handler).toBe('simple-handler.handler');
    expect(props.runtime).toBe('nodejs20.x');
    expect(props.memorySize).toBe(1024);
    expect(props.roleArn).toBeDefined();
    expect(props.code).toBeDefined();
    expect(props.environment).toBeDefined();
  });

  it('reads the when-present props (Req 4.3) and omits absent ones', () => {
    const stack = createStack('ReaderOptionalStack');
    const baseline = createAssetLambda(stack, 'Optional');
    const cfn = l1Of(baseline);
    cfn.ephemeralStorage = { size: 1024 };
    cfn.kmsKeyArn = 'arn:aws:kms:us-east-1:123456789012:key/abc';
    cfn.fileSystemConfigs = [
      { arn: 'arn:aws:elasticfilesystem:us-east-1:123456789012:access-point/fsap-1', localMountPath: '/mnt/efs' },
    ];
    cfn.tracingConfig = { mode: 'Active' };
    cfn.vpcConfig = { subnetIds: ['subnet-1'], securityGroupIds: ['sg-1'] };

    const props = readBaselineFunctionProps(cfn);

    expect(props.ephemeralStorage).toBeDefined();
    expect(props.kmsKeyArn).toBe('arn:aws:kms:us-east-1:123456789012:key/abc');
    expect(props.fileSystemConfigs).toBeDefined();
    expect(props.tracingConfig).toBeDefined();
    expect(props.vpcConfig).toBeDefined();
  });

  it('omits when-present props that are absent on the baseline', () => {
    const stack = createStack('ReaderAbsentStack');
    const baseline = createAssetLambda(stack, 'Plain');

    const props = readBaselineFunctionProps(l1Of(baseline));

    expect(props.ephemeralStorage).toBeUndefined();
    expect(props.kmsKeyArn).toBeUndefined();
    expect(props.fileSystemConfigs).toBeUndefined();
    expect(props.tracingConfig).toBeUndefined();
    expect(props.vpcConfig).toBeUndefined();
  });
});

describe('materializeCloneFunction — same code asset + same role reuse (Req 4.5, 14.2)', () => {
  it('reuses the SAME code asset location as the baseline (no re-upload)', () => {
    const stack = createStack('SameAssetStack');
    const baseline = createAssetLambda(stack, 'Orders');

    const result = materializeCloneFunction(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    const template = Template.fromStack(stack);
    const functions = template.findResources('AWS::Lambda::Function');
    const codes = Object.values(functions).map((f) => JSON.stringify(f.Properties.Code));

    // Exactly two functions; both reference the identical S3 asset location.
    expect(Object.keys(functions)).toHaveLength(2);
    expect(new Set(codes).size).toBe(1);
    expect(result.cloneFunction).toBeInstanceOf(LambdaFunction);
  });

  it('reuses the SAME execution role and provisions no new IAM role (reuse-role default, Req 14.2)', () => {
    const stack = createStack('SameRoleStack');
    const baseline = createAssetLambda(stack, 'Orders');

    materializeCloneFunction(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    const template = Template.fromStack(stack);
    // Only the baseline's auto-created service role exists — none for the clone.
    template.resourceCountIs('AWS::IAM::Role', 1);

    const functions = template.findResources('AWS::Lambda::Function');
    const roleRefs = Object.values(functions).map((f) => JSON.stringify(f.Properties.Role));
    // Both functions point at the SAME (single) role reference, which is the
    // baseline's service role resolved in the synthesized template.
    expect(Object.keys(functions)).toHaveLength(2);
    expect(new Set(roleRefs).size).toBe(1);
    expect(roleRefs[0]).toContain('Fn::GetAtt');
    expect(roleRefs[0]).toContain('ServiceRole');
  });

  it('places the clone as a sibling within the baseline stack', () => {
    const stack = createStack('SiblingStack');
    const baseline = createAssetLambda(stack, 'Orders');

    const result = materializeCloneFunction(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    expect(Stack.of(result.cloneFunction)).toBe(stack);
    expect(Stack.of(result.cloneFunction)).toBe(Stack.of(baseline));
  });
});

describe('materializeCloneFunction — naming via NamingResolver (Req 6)', () => {
  it('derives the clone name through the provided NamingResolver', () => {
    const stack = createStack('NamingStack');
    const baseline = createAssetLambda(stack, 'Orders', { functionName: 'orders-fn' });
    const naming = new NamingResolver();

    const result = materializeCloneFunction(stack, 'OrdersClone', l1Of(baseline), 'reuse-role', {
      naming,
      baselineName: 'orders-fn',
      identity: baseline.node.path,
    });

    expect(result.cloneName).toBe('orders-fn-kata');
    expect(l1Of(result.cloneFunction).functionName).toBe('orders-fn-kata');
  });

  it('honours a custom suffix and stays deterministic across repeated synthesis', () => {
    const buildName = (): string => {
      const stack = createStack('DeterministicNamingStack');
      const baseline = createAssetLambda(stack, 'Orders', { functionName: 'orders-fn' });
      const result = materializeCloneFunction(stack, 'OrdersClone', l1Of(baseline), 'reuse-role', {
        nameSuffix: 'bench',
        baselineName: 'orders-fn',
        identity: baseline.node.path,
      });
      return result.cloneName;
    };

    expect(buildName()).toBe('orders-fn-bench');
    expect(buildName()).toBe(buildName());
  });
});

describe('materializeCloneFunction — role-handling modes (Req 14.1, 14.2, 14.3)', () => {
  it('clone-role reuses the same baseline role ARN (mutable import, no new role)', () => {
    const stack = createStack('CloneRoleStack');
    const baseline = createAssetLambda(stack, 'Orders');

    materializeCloneFunction(stack, 'OrdersClone', l1Of(baseline), 'clone-role');

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::IAM::Role', 1);
  });

  it('provided-role assigns the user-supplied role to the clone (Req 14.3)', () => {
    const stack = createStack('ProvidedRoleStack');
    const baseline = createAssetLambda(stack, 'Orders');
    const provided = new Role(stack, 'ProvidedRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    });

    const result = materializeCloneFunction(stack, 'OrdersClone', l1Of(baseline), 'provided-role', {
      providedRole: provided,
    });

    expect(result.cloneFunction.role).toBe(provided);
    const template = Template.fromStack(stack);
    // baseline service role + provided role.
    template.resourceCountIs('AWS::IAM::Role', 2);
  });

  it('throws a descriptive error when provided-role is selected without a role', () => {
    const stack = createStack('ProvidedRoleMissingStack');
    const baseline = createAssetLambda(stack, 'Orders');

    expect(() =>
      materializeCloneFunction(stack, 'OrdersClone', l1Of(baseline), 'provided-role'),
    ).toThrow(/provided-role/);
  });
});

describe('materializeCloneFunction — L1 prop copy (Req 4.2, 4.3)', () => {
  it('copies runtime, handler, memory, architectures, and environment onto the clone (Req 4.2)', () => {
    const stack = createStack('CopyCoreStack');
    const baseline = createAssetLambda(stack, 'Orders', {
      environment: { TABLE_NAME: 'orders', ENDPOINT: 'https://x' },
      memorySize: 768,
      architecture: Architecture.ARM_64,
    });

    const result = materializeCloneFunction(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');
    const cloneCfn = l1Of(result.cloneFunction);

    expect(cloneCfn.runtime).toBe('nodejs20.x');
    expect(cloneCfn.handler).toBe('simple-handler.handler');
    expect(cloneCfn.memorySize).toBe(768);
    expect(cloneCfn.architectures).toEqual([Architecture.ARM_64.name]);

    const template = Template.fromStack(stack);
    const functions = template.findResources('AWS::Lambda::Function');
    const cloneResource = Object.values(functions).find(
      (f) => f.Properties.FunctionName !== undefined,
    );
    expect(cloneResource?.Properties.Environment).toEqual({
      Variables: { TABLE_NAME: 'orders', ENDPOINT: 'https://x' },
    });
  });

  it('copies the when-present props onto the clone (Req 4.3)', () => {
    const stack = createStack('CopyOptionalStack');
    const baseline = createAssetLambda(stack, 'Orders');
    const baseCfn = l1Of(baseline);
    baseCfn.ephemeralStorage = { size: 2048 };
    baseCfn.kmsKeyArn = 'arn:aws:kms:us-east-1:123456789012:key/abc';
    baseCfn.fileSystemConfigs = [
      { arn: 'arn:aws:elasticfilesystem:us-east-1:123456789012:access-point/fsap-1', localMountPath: '/mnt/efs' },
    ];
    baseCfn.tracingConfig = { mode: 'Active' };
    baseCfn.vpcConfig = { subnetIds: ['subnet-1'], securityGroupIds: ['sg-1'] };

    const result = materializeCloneFunction(stack, 'OrdersClone', baseCfn, 'reuse-role');
    const cloneCfn = l1Of(result.cloneFunction);

    expect(cloneCfn.ephemeralStorage).toEqual({ size: 2048 });
    expect(cloneCfn.kmsKeyArn).toBe('arn:aws:kms:us-east-1:123456789012:key/abc');
    expect(cloneCfn.fileSystemConfigs).toEqual(baseCfn.fileSystemConfigs);
    expect(cloneCfn.tracingConfig).toEqual({ mode: 'Active' });
    expect(cloneCfn.vpcConfig).toEqual({ subnetIds: ['subnet-1'], securityGroupIds: ['sg-1'] });
  });
});

describe('materializeCloneFunction — documented L2-facade fallback warnings (design note, Req 4.6)', () => {
  it('records a warning for each leaky prop copied via the raw CfnFunction fallback', () => {
    const stack = createStack('FallbackWarnStack');
    const baseline = createAssetLambda(stack, 'Orders');
    const baseCfn = l1Of(baseline);
    baseCfn.vpcConfig = { subnetIds: ['subnet-1'], securityGroupIds: ['sg-1'] };
    baseCfn.kmsKeyArn = 'arn:aws:kms:us-east-1:123456789012:key/abc';
    baseCfn.fileSystemConfigs = [
      { arn: 'arn:aws:elasticfilesystem:us-east-1:123456789012:access-point/fsap-1', localMountPath: '/mnt/efs' },
    ];

    const result = materializeCloneFunction(stack, 'OrdersClone', baseCfn, 'reuse-role');
    const codes = new Set(result.warnings.map((w) => w.code));

    expect(codes.has('l2-facade-fallback-vpc-config')).toBe(true);
    expect(codes.has('l2-facade-fallback-kms-key')).toBe(true);
    expect(codes.has('l2-facade-fallback-file-system-configs')).toBe(true);
    // Every warning carries a human-readable message (Req 5.7 reuse).
    result.warnings.forEach((w) => expect(w.message.trim().length).toBeGreaterThan(0));
  });

  it('records no fallback warnings for a plain function with none of the leaky props', () => {
    const stack = createStack('NoFallbackStack');
    const baseline = createAssetLambda(stack, 'Orders');

    const result = materializeCloneFunction(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    expect(result.warnings).toHaveLength(0);
  });
});

describe('materializeCloneFunction — env KEYS recorded without values (Req 14.4, 14.5)', () => {
  it('records environment variable keys only, never their values', () => {
    const stack = createStack('EnvKeysStack');
    const baseline = createAssetLambda(stack, 'Orders', {
      environment: { TABLE_NAME: 'super-secret-table', API_KEY: 'shhh' },
    });

    const result = materializeCloneFunction(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    expect(new Set(result.envKeysCopied)).toEqual(new Set(['TABLE_NAME', 'API_KEY']));
    const serialized = JSON.stringify(result.envKeysCopied);
    expect(serialized).not.toContain('super-secret-table');
    expect(serialized).not.toContain('shhh');
  });

  it('records an empty key list when the baseline has no environment', () => {
    const stack = createStack('NoEnvStack');
    const baseline = createAssetLambda(stack, 'Orders');

    const result = materializeCloneFunction(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    expect(result.envKeysCopied).toEqual([]);
  });
});

describe('materializeCloneFunction — layers reused through the L2 API (kata() compatibility for 5.2)', () => {
  it('reuses baseline layers and still merges a later addLayers() onto the clone', () => {
    const stack = createStack('LayersStack');
    const layer = new LayerVersion(stack, 'SharedLayer', {
      code: Code.fromAsset(FIXTURE_ASSET_DIR),
      compatibleRuntimes: [Runtime.NODEJS_20_X],
    });
    const baseline = createAssetLambda(stack, 'Orders');
    baseline.addLayers(layer);

    const result = materializeCloneFunction(stack, 'OrdersClone', l1Of(baseline), 'reuse-role');

    // Simulate what kata() does in 5.2: append an additional layer via the L2 API.
    const extraLayer = LayerVersion.fromLayerVersionArn(
      stack,
      'ExtraLayer',
      'arn:aws:lambda:us-east-1:123456789012:layer:extra:1',
    );
    result.cloneFunction.addLayers(extraLayer);

    const template = Template.fromStack(stack);
    const functions = template.findResources('AWS::Lambda::Function');
    const cloneResource = Object.values(functions).find(
      (f) => f.Properties.FunctionName !== undefined,
    );
    const cloneLayers = JSON.stringify(cloneResource?.Properties.Layers ?? []);

    // The clone carries BOTH the reused baseline layer and the later-added one.
    expect(cloneResource?.Properties.Layers).toHaveLength(2);
    expect(cloneLayers).toContain('arn:aws:lambda:us-east-1:123456789012:layer:extra:1');
  });
});

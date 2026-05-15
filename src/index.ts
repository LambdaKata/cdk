/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @lambdakata/cdk - AWS CDK integration for Lambda Kata
 *
 * This package provides CDK constructs to transform Node.js Lambda functions
 * to run via the Lambda Kata runtime.
 *
 * @example
 * ```typescript
 * import { kata } from '@lambdakata/cdk';
 * import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
 *
 * const myFunction = new NodejsFunction(this, 'MyFunction', {
 *   entry: 'src/handler.ts',
 * });
 *
 * // Transform to use Lambda Kata runtime
 * kata(myFunction);
 * ```
 */

// Type exports
export { KataProps, LicensingResponse, TransformationConfig } from './types';

// Licensing service exports
export {
    LicensingService,
    HttpLicensingService,
    createLicensingService,
    isValidAccountId,
} from './licensing';

// Mock licensing service for testing
export {
    MockLicensingService,
    createMockLicensingService,
} from './mock-licensing';

// Account resolver exports
export {
    resolveAccountId,
    resolveAccountIdWithSource,
    isValidAccountIdFormat,
    AccountResolutionError,
    AccountResolutionResult,
    AccountResolverOptions,
} from './account-resolver';

// kata wrapper exports
export {
    kata,
    kataWithAccountId,
    applyTransformation,
    handleUnlicensed,
    isKataTransformed,
    getKataPromise,
    KataWrapperOptions,
    KataResult,
} from './kata-wrapper';

// Config layer exports
export {
    createKataConfigLayer,
    generateConfigContent,
    KataConfigLayerProps,
    CONFIG_DIR_NAME,
    CONFIG_FILE_NAME,
    HANDLER_CONFIG_KEY,
} from './config-layer';

// Node.js Layer Management exports
export {
    EnsureNodeRuntimeLayerOptions,
    EnsureNodeRuntimeLayerResult,
    NodeVersionInfo,
    LayerInfo,
    LayerSearchOptions,
    LayerRequirements,
    LayerCreationOptions,
    Logger,
    RuntimeDetector,
    LayerManager,
    ErrorCodes,
    NodeRuntimeLayerError,
    VersionCacheEntry,
    LayerMetadata,
    // New deployment functionality exports
    NodejsLayerDeploymentOptions,
    NodejsLayerDeploymentResult,
    MultiArchitectureDeploymentResult,
} from './nodejs-layer-manager';

// Docker Runtime Detector exports
export {
    DockerRuntimeDetector,
    DockerRuntimeDetectorOptions,
} from './docker-runtime-detector';

// AWS Layer Manager exports
export {
    AWSLayerManager,
    AWSLayerManagerOptions,
} from './aws-layer-manager';

// Logger exports
export {
    NoOpLogger,
    ConsoleLogger,
    createDefaultLogger,
    OperationTimer,
} from './logger';

// Main API function export
export { ensureNodeRuntimeLayer } from './ensure-node-runtime-layer';

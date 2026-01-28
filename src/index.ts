/**
 * @lambda-kata/cdk - AWS CDK integration for Lambda Kata
 *
 * This package provides CDK constructs to transform Node.js Lambda functions
 * to run via the Lambda Kata runtime.
 *
 * @example
 * ```typescript
 * import { kata } from '@lambda-kata/cdk';
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

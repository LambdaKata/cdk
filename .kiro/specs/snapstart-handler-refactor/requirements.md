# Requirements Document

## Introduction

This document specifies the requirements for refactoring the SnapStart Custom Resource Handler in the `@lambdakata/cdk` library. The current implementation uses a `generateHandlerCode()` method that returns ~120 lines of JavaScript as a string literal passed to `Code.fromInline()`. This approach lacks type-checking, IDE support, and duplicates logic already present in `snapstart-activator.ts`. The refactoring will bundle the existing TypeScript handler at build time and use `Code.fromAsset()` for deployment.

## Glossary

- **SnapStart_Handler**: The Lambda function code that handles CloudFormation Custom Resource events for SnapStart activation
- **Build_System**: The esbuild-based build pipeline that bundles TypeScript source into distributable JavaScript
- **CDK_Construct**: The `SnapStartActivator` class in `snapstart-construct.ts` that creates the Custom Resource infrastructure
- **Custom_Resource_Provider**: The CDK Provider framework that invokes the SnapStart_Handler during CloudFormation operations
- **Handler_Bundle**: The standalone JavaScript file (`snapstart-handler.js`) produced by bundling `snapstart-activator.ts`
- **NPM_Package**: The distributable `@lambdakata/cdk` package published to npm

## Requirements

### Requirement 1: Build-Time Handler Bundling

**User Story:** As a library maintainer, I want the SnapStart handler to be bundled at build time, so that the handler code has type-checking and IDE support during development.

#### Acceptance Criteria

1. WHEN `yarn build` is executed, THE Build_System SHALL produce a `snapstart-handler.js` file in the `out/dist/` directory
2. THE Build_System SHALL bundle `src/snapstart-activator.ts` as a standalone CommonJS module targeting Node.js 18
3. THE Build_System SHALL mark all `@aws-sdk/*` packages as external dependencies (available in Lambda runtime)
4. THE Build_System SHALL NOT invoke esbuild at CDK synthesis time (runtime)
5. THE Handler_Bundle SHALL export a `handler` function compatible with the CloudFormation Custom Resource Provider framework

### Requirement 2: NPM Package Distribution

**User Story:** As a library consumer, I want the bundled handler included in the npm package, so that the SnapStart construct works without additional setup.

#### Acceptance Criteria

1. THE NPM_Package SHALL include the `snapstart-handler.js` file in the `out/dist/` directory
2. WHEN `npm pack` is executed after `yarn build`, THE resulting tarball SHALL contain `out/dist/snapstart-handler.js`
3. THE `package.json` files field SHALL include the handler bundle path

### Requirement 3: Construct Refactoring

**User Story:** As a library maintainer, I want to remove the inline handler code generation, so that the codebase has a single source of truth for the SnapStart activation logic.

#### Acceptance Criteria

1. THE CDK_Construct SHALL NOT contain a `generateHandlerCode()` method
2. THE CDK_Construct SHALL use `Code.fromAsset()` instead of `Code.fromInline()` for the provider Lambda
3. THE CDK_Construct SHALL reference the Handler_Bundle directory relative to `__dirname` (accounting for `out/dist/` package structure)
4. THE CDK_Construct SHALL set the Lambda handler to `snapstart-handler.handler`
5. WHEN the CDK_Construct is synthesized, THE CloudFormation template SHALL contain a Lambda function with Code pointing to an asset (not inline ZipFile)

### Requirement 4: Handler Compatibility

**User Story:** As a library maintainer, I want the bundled handler to be compatible with the CDK Provider framework, so that CloudFormation Custom Resource operations work correctly.

#### Acceptance Criteria

1. THE SnapStart_Handler SHALL export an async `handler` function that accepts a `CustomResourceEvent` parameter
2. THE SnapStart_Handler SHALL return an object (not an S3 URL response) as the Provider framework handles response formatting
3. WHEN a Create or Update event is received, THE SnapStart_Handler SHALL perform the SnapStart activation cycle and return version/alias information
4. WHEN a Delete event is received, THE SnapStart_Handler SHALL return a success response without performing any Lambda modifications
5. IF an error occurs during Update, THEN THE SnapStart_Handler SHALL return SUCCESS to prevent CloudFormation rollback deadlock

### Requirement 5: Backward Compatibility

**User Story:** As a library consumer, I want the refactored construct to behave identically to the current implementation, so that my existing CDK stacks continue to work.

#### Acceptance Criteria

1. THE CDK_Construct public API SHALL remain unchanged (same props interface, same output references)
2. THE Custom_Resource_Provider behavior SHALL be identical (same IAM permissions, same timeout calculation, same dependency management)
3. WHEN an existing stack is updated with the refactored library, THE CloudFormation update SHALL succeed without resource replacement (unless the handler logic changes)
4. THE SnapStart activation cycle (enable SnapStart → publish version → wait for snapshot → create/update alias) SHALL produce identical results

### Requirement 6: Test Coverage

**User Story:** As a library maintainer, I want comprehensive tests for the refactored implementation, so that regressions are caught early.

#### Acceptance Criteria

1. THE test suite SHALL verify that `snapstart-handler.js` exists at the expected path after build
2. THE test suite SHALL update expectations for `Code.fromAsset` instead of `Code.fromInline`
3. THE existing `snapstart-activator.test.ts` tests SHALL continue to pass without modification (handler logic unchanged)
4. WHEN `yarn test` is executed, THE test suite SHALL pass with all existing and new tests

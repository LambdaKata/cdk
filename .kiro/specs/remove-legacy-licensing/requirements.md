# Requirements Document

## Introduction

Refactoring of Lambda Kata CDK licensing system: removal of legacy HTTP-based licensing code and complete transition to native C-module `@lambda-kata/licensing`. This simplifies the architecture, removes unnecessary code, and makes licensing fully controlled through the native module.

## Glossary

- **Native_Licensing_Module**: C-module `@lambda-kata/licensing` containing all licensing logic (endpoint, security, validation)
- **Legacy_HTTP_Service**: Deprecated `HttpLicensingService` in `src/licensing.ts`, NOT used in production
- **Mock_Licensing_Service**: Test mock in `src/mock-licensing.ts` for simulating licensing service
- **kata_Wrapper**: Main function `kata()` in `src/kata-wrapper.ts` that transforms Lambda functions
- **KataWrapperInternalOptions**: Internal interface with `licensingService` parameter for testing
- **kataWithAccountId**: Async function for testing with explicit accountId and licensingService

## Requirements

### Requirement 1: Remove Legacy HTTP Licensing Service

**User Story:** As a maintainer, I want to remove unused HTTP licensing code, so that the codebase is simpler and all licensing is controlled by the native module.

#### Acceptance Criteria

1. THE System SHALL delete the file `src/licensing.ts` completely
2. THE System SHALL delete the file `src/mock-licensing.ts` completely
3. THE System SHALL remove all imports of `LicensingService`, `HttpLicensingService`, `createLicensingService` from `src/kata-wrapper.ts`
4. THE System SHALL remove all imports of `MockLicensingService` from test files
5. THE System SHALL remove exports of licensing-related types from `src/index.ts`

### Requirement 2: Remove Internal Testing Interface

**User Story:** As a maintainer, I want to remove the internal testing interface that allowed injecting custom licensing services, so that licensing cannot be bypassed.

#### Acceptance Criteria

1. THE System SHALL delete the `KataWrapperInternalOptions` interface from `src/kata-wrapper.ts`
2. THE System SHALL remove the `licensingService` parameter from `kataWithAccountId` function
3. THE System SHALL remove the `syncLicensingService` parameter from `performKataTransformationSync` function
4. WHEN `kataWithAccountId` is called, THE System SHALL use only the Native_Licensing_Module for entitlement checks
5. THE System SHALL keep `kataWithAccountId` as internal function (not exported from `src/index.ts`)

### Requirement 3: Refactor Tests to Use jest.mock

**User Story:** As a developer, I want tests to mock the native licensing module via jest.mock, so that tests don't depend on deleted mock classes.

#### Acceptance Criteria

1. WHEN testing entitled scenarios, THE Test SHALL mock `@lambda-kata/licensing` to return `{ entitled: true, layerVersionArn: '...' }`
2. WHEN testing non-entitled scenarios, THE Test SHALL mock `@lambda-kata/licensing` to return `{ entitled: false, message: '...' }`
3. THE Test SHALL use `jest.mock('@lambda-kata/licensing')` at the top of test files
4. THE Test SHALL NOT import `MockLicensingService` or `createMockLicensingService`
5. THE Test SHALL delete `test/licensing.test.ts` file (tests legacy HTTP service)
6. THE Test SHALL delete `test/mock-licensing.test.ts` file (tests deleted mock class)

### Requirement 4: Preserve kata() Functionality

**User Story:** As a user, I want the kata() function to work exactly as before, so that my existing code continues to work.

#### Acceptance Criteria

1. THE kata_Wrapper SHALL continue to use Native_Licensing_Module via `NativeLicensingService.checkEntitlementSync()`
2. WHEN Native_Licensing_Module returns entitled with layerVersionArn, THE kata_Wrapper SHALL apply transformation
3. WHEN Native_Licensing_Module returns not entitled, THE kata_Wrapper SHALL emit warning and skip transformation
4. IF Native_Licensing_Module throws an error, THEN THE kata_Wrapper SHALL treat account as unlicensed
5. THE kata_Wrapper SHALL NOT have any HTTP fallback mechanism

### Requirement 5: Update Public API

**User Story:** As a maintainer, I want the public API to not expose any licensing internals, so that users cannot configure or bypass licensing.

#### Acceptance Criteria

1. THE System SHALL NOT export `LicensingService` interface from `src/index.ts`
2. THE System SHALL NOT export `HttpLicensingService` class from `src/index.ts`
3. THE System SHALL NOT export `createLicensingService` function from `src/index.ts`
4. THE System SHALL NOT export `MockLicensingService` class from `src/index.ts`
5. THE System SHALL NOT export `kataWithAccountId` function from `src/index.ts` (keep internal only)
6. THE System SHALL continue to export `LicensingResponse` type from `src/types.ts` (used in KataResult)

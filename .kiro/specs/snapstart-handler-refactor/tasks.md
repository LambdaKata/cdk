# Implementation Plan: SnapStart Handler Refactor

## Overview

This plan refactors the SnapStart Custom Resource Handler from inline code generation to a pre-bundled asset approach. The implementation follows an incremental approach: first adding the build configuration, then modifying the construct, and finally updating tests.

## Tasks

- [ ] 1. Add esbuild configuration for snapstart handler
  - [ ] 1.1 Add `snapstartHandler` build target to `utils/esbuild/esbuild.config.ts`
    - Entry point: `src/snapstart-activator.ts`
    - Output: `out/dist/snapstart-handler.js`
    - Format: CommonJS, target: node18, bundle: true, minify: true
    - External: `@aws-sdk/client-lambda` and other AWS SDK packages
    - _Requirements: 1.1, 1.2, 1.3_
  
  - [ ] 1.2 Ensure `snapstartHandler` is included in default build (not filtered by stageFilters)
    - Verify the target key is not in the filter exclusion list
    - _Requirements: 1.4_

- [ ] 2. Checkpoint - Verify build produces handler bundle
  - Run `yarn build` and verify `out/dist/snapstart-handler.js` exists
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Refactor snapstart-construct.ts to use asset-based code
  - [ ] 3.1 Add `path` import to `snapstart-construct.ts`
    - Import `path` from Node.js built-ins
    - _Requirements: 3.3_
  
  - [ ] 3.2 Remove `generateHandlerCode()` method entirely
    - Delete the entire method (~120 lines)
    - _Requirements: 3.1_
  
  - [ ] 3.3 Modify `createProviderFunction()` to use `Code.fromAsset()`
    - Resolve handler directory using `path.join(__dirname)`
    - Use `Code.fromAsset()` with exclude pattern to only include `snapstart-handler.js`
    - Change handler from `index.handler` to `snapstart-handler.handler`
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

- [ ] 4. Checkpoint - Verify CDK synthesis works
  - Run a test CDK synth to verify the construct synthesizes correctly
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Update snapstart-construct tests
  - [ ] 5.1 Update test expectations for asset-based code
    - Change assertions from `Code.ZipFile` to checking for asset-based code
    - Update handler assertion from `index.handler` to `snapstart-handler.handler`
    - Remove test that checks for inline code content (`SNAPSTART ACTIVATION CYCLE`)
    - _Requirements: 6.2_
  
  - [ ]* 5.2 Write property test for asset-based code deployment
    - **Property 1: Asset-Based Code Deployment**
    - **Validates: Requirements 3.2, 3.4, 3.5**
  
  - [ ]* 5.3 Write property test for backward compatible API
    - **Property 3: Backward Compatible API**
    - **Validates: Requirements 5.1, 5.2**

- [ ] 6. Add build verification tests
  - [ ] 6.1 Create `test/snapstart-handler-build.test.ts`
    - Test that `snapstart-handler.js` exists at expected path
    - Test that module exports a `handler` function
    - Test that AWS SDK is externalized (not bundled)
    - _Requirements: 6.1, 1.5, 4.1_
  
  - [ ]* 6.2 Write property test for handler bundle exports
    - **Property 4: Handler Bundle Exports**
    - **Validates: Requirements 1.5, 4.1**

- [ ] 7. Final checkpoint - Full verification
  - Run `yarn build` - verify success and `snapstart-handler.js` created
  - Run `yarn test` - verify all tests pass
  - Run `yarn lint` - verify no errors
  - Run `npm pack --dry-run` - verify `snapstart-handler.js` in package
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based tests that can be skipped for faster MVP
- The existing `snapstart-activator.test.ts` and `snapstart-activator.property.test.ts` should pass without modification since handler logic is unchanged
- The `package.json` files field already includes `out/dist/**/*`, so no changes needed there
- Property tests use fast-check library with minimum 100 iterations

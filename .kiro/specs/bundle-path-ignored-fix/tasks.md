# Implementation Plan

- [ ] 1. Write exploration test for bug condition
  - **Property 1: Fault Condition** - User-provided bundlePath is ignored
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms bug existence
  - **DO NOT attempt to fix the test or code when it fails**
  - **NOTE**: This test encodes expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Find counterexamples demonstrating bug existence
  - **Scoped PBT Approach**: Limit property to specific failing cases: any non-empty bundlePath
  - Create file `test/bundle-path-fix.property.test.ts`
  - Use fast-check to generate random bundlePath paths
  - Test: for any non-empty bundlePath, calling kata() should write this value to Lambda Layer config as bundle_path
  - Verify that `configLayer.bundle_path === input.bundlePath` (from Fault Condition in design)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - proves bug existence)
  - Document found counterexamples for root cause understanding
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Default bundlePath computation
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for cases without bundlePath
  - Observe: kata() without bundlePath computes bundle_path from originalHandler via extractBundlePathFromHandler()
  - Observe: kata() with bundlePath: undefined uses computed value
  - Observe: kata() with bundlePath: '' (empty string) uses computed value
  - Write property-based test: for all calls without bundlePath, result bundle_path equals extractBundlePathFromHandler(originalHandler) (from Preservation Requirements in design)
  - Verify that test PASSES on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior for preservation)
  - Mark task complete when tests are written, run, and pass on unfixed code
  - _Requirements: 3.1, 3.5_

- [ ] 3. Fix bundlePath ignored bug

  - [ ] 3.1 Investigate bundlePath passing chain
    - Verify bundlePath passing: kata() → performKataTransformationSync() → applyTransformation() → createKataConfigLayer()
    - Find where value is lost or overwritten
    - Document found root cause
    - _Bug_Condition: isBugCondition(input) where input.bundlePath !== undefined && input.bundlePath !== ''_
    - _Requirements: 1.1, 1.2_

  - [ ] 3.2 Implement fix
    - Fix bundlePath passing logic at found location
    - Ensure user-provided bundlePath takes priority over computed value
    - Logic: `effectiveBundlePath = bundlePath !== undefined && bundlePath !== '' ? bundlePath : extractBundlePathFromHandler(originalHandler)`
    - _Bug_Condition: isBugCondition(input) where input.bundlePath !== undefined && input.bundlePath !== ''_
    - _Expected_Behavior: configLayer.bundle_path === input.bundlePath when bundlePath is specified_
    - _Preservation: When bundlePath is not specified, use extractBundlePathFromHandler(originalHandler)_
    - _Requirements: 2.1, 2.2, 2.3, 3.1_

  - [ ] 3.3 Verify exploration test now passes
    - **Property 1: Expected Behavior** - User-provided bundlePath is used
    - **IMPORTANT**: Re-run THE SAME test from task 1 - DO NOT write a new test
    - Test from task 1 encodes expected behavior
    - When this test passes, it confirms expected behavior is achieved
    - Run exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2_

  - [ ] 3.4 Verify preservation tests still pass
    - **Property 2: Preservation** - Default bundlePath computation
    - **IMPORTANT**: Re-run THE SAME tests from task 2 - DO NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Ensure all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.5_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Run `yarn test` to verify all tests
  - Run `yarn lint` to verify code quality
  - Run `yarn build` to verify build
  - Ensure all tests pass, ask user if questions arise

# Implementation Plan: SnapStart Activation

## Overview

This implementation plan covers the SnapStart activation feature for Lambda Kata CDK. The existing implementation in `src/snapstart-construct.ts` and `src/snapstart-activator.ts` provides a foundation. This plan focuses on ensuring completeness, adding property-based tests, and verifying integration with the `kata()` wrapper.

## Tasks

- [x] 1. Review and validate existing SnapStart implementation
  - [x] 1.1 Audit existing snapstart-construct.ts for completeness against requirements
    - Verify SnapStartActivator construct creates Custom Resource
    - Verify provider Lambda has correct runtime, timeout, and permissions
    - Verify Custom Resource depends on target function
    - _Requirements: 4.1, 4.2, 4.5, 6.1-6.6_
  
  - [x] 1.2 Audit existing snapstart-activator.ts for completeness against requirements
    - Verify activation cycle ordering (wait → config → wait → publish → poll → alias)
    - Verify SnapStart configuration uses ApplyOn: PublishedVersions
    - Verify alias create/update logic handles ResourceNotFoundException
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3, 3.1, 3.3, 3.4_
  
  - [x] 1.3 Verify integration with kata() wrapper in kata-wrapper.ts
    - Confirm SnapStartActivator is created in applyTransformation
    - Verify default alias name is "kata"
    - Verify default timeout is 180 seconds
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 2. Enhance error handling and edge cases
  - [x] 2.1 Add explicit error handling for function not found
    - Catch ResourceNotFoundException from waiters
    - Return descriptive error message
    - _Requirements: 9.1_
  
  - [x] 2.2 Add explicit error handling for permission errors
    - Catch AccessDeniedException
    - Include required permissions in error message
    - _Requirements: 9.4_
  
  - [x] 2.3 Ensure snapshot failure includes StateReason
    - Verify error message includes StateReason when State='Failed'
    - _Requirements: 2.5, 9.3_

- [x] 3. Checkpoint - Verify existing tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add property-based tests for activation logic
  - [x] 4.1 Write property test for activation cycle ordering
    - **Property 1: Activation Cycle Ordering**
    - Verify operations occur in correct sequence for any function name
    - _Requirements: 1.2, 1.3, 2.1, 2.3, 3.1_
    - **Validates: Requirements 1.2, 1.3, 2.1, 2.3, 3.1**
  
  - [x] 4.2 Write property test for SnapStart configuration correctness
    - **Property 2: SnapStart Configuration Correctness**
    - Verify UpdateFunctionConfiguration always includes correct SnapStart config
    - _Requirements: 1.1_
    - **Validates: Requirements 1.1**
  
  - [x] 4.3 Write property test for alias management idempotency
    - **Property 3: Alias Management Idempotency**
    - Verify alias create vs update logic for any alias name
    - _Requirements: 3.2, 3.3, 3.4, 5.2_
    - **Validates: Requirements 3.2, 3.3, 3.4, 5.2**
  
  - [x] 4.4 Write property test for error propagation
    - **Property 4: Error Propagation**
    - Verify FAILED status and error message for any AWS error
    - _Requirements: 5.4, 9.2_
    - **Validates: Requirements 5.4, 9.2**

- [x] 5. Add property-based tests for timeout and polling
  - [x] 5.1 Write property test for timeout and polling behavior
    - **Property 5: Timeout and Polling Behavior**
    - Verify polling respects timeout configuration
    - Verify progress logging at correct intervals
    - _Requirements: 2.4, 7.1, 7.2, 7.4, 7.5_
    - **Validates: Requirements 2.4, 7.1, 7.2, 7.4, 7.5**
  
  - [x] 5.2 Write property test for operation descriptions
    - **Property 6: Operation Descriptions**
    - Verify PublishVersion and alias commands include correct descriptions
    - _Requirements: 2.2, 3.5_
    - **Validates: Requirements 2.2, 3.5**

- [x] 6. Add property-based tests for delete and failure handling
  - [x] 6.1 Write property test for delete request handling
    - **Property 7: Delete Request Handling**
    - Verify no Lambda API calls on Delete request
    - Verify SUCCESS status returned
    - _Requirements: 4.4, 5.5_
    - **Validates: Requirements 4.4, 5.5**
  
  - [x] 6.2 Write property test for snapshot failure handling
    - **Property 8: Snapshot Failure Handling**
    - Verify error includes StateReason when State='Failed'
    - _Requirements: 2.5, 9.3_
    - **Validates: Requirements 2.5, 9.3**

- [x] 7. Checkpoint - Verify all property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Add CDK construct unit tests
  - [x] 8.1 Add tests for Custom Resource properties
    - Verify FunctionName, AliasName, Timestamp in synthesized template
    - _Requirements: 5.3_
  
  - [x] 8.2 Add tests for IAM permissions
    - Verify all required permissions are granted
    - Verify permissions are scoped to target function ARN
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  
  - [x] 8.3 Add tests for handler timeout configuration
    - Verify timeout is snapshotTimeoutSeconds + 60
    - _Requirements: 7.3_
  
  - [x] 8.4 Add tests for construct output attributes
    - Verify versionRef, aliasArnRef, aliasName are exposed
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 9. Verify kata() integration
  - [x] 9.1 Add integration test for kata() with SnapStart
    - Verify SnapStartActivator is created when kata() transforms a function
    - Verify correct parent-child relationship
    - _Requirements: 10.1, 10.2_
  
  - [x] 9.2 Add test for default configuration values
    - Verify default alias name is "kata"
    - Verify default timeout is 180 seconds
    - _Requirements: 10.3, 10.4_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Update exports and documentation
  - [x] 11.1 Verify SnapStartActivator is exported from src/index.ts
    - Add export if missing
    - _Requirements: 4.1_
  
  - [x] 11.2 Add JSDoc comments to public interfaces
    - Document SnapStartActivatorProps
    - Document SnapStartActivator class
    - _Requirements: 8.1, 8.2, 8.3_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The existing implementation provides a solid foundation; focus is on validation and testing
- Property tests use fast-check library (already in devDependencies)
- Each property test should run minimum 100 iterations
- CDK template assertions use aws-cdk-lib/assertions

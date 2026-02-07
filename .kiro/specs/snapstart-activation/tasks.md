# Implementation Plan: SnapStart Activation

## Overview

This implementation plan covers the SnapStart activation feature for Lambda Kata CDK. The existing implementation in `src/snapstart-construct.ts` and `src/snapstart-activator.ts` provides a foundation. This plan focuses on ensuring completeness, adding property-based tests, and verifying integration with the `kata()` wrapper.

## Tasks

- [ ] 1. Review and validate existing SnapStart implementation
  - [ ] 1.1 Audit existing snapstart-construct.ts for completeness against requirements
    - Verify SnapStartActivator construct creates Custom Resource
    - Verify provider Lambda has correct runtime, timeout, and permissions
    - Verify Custom Resource depends on target function
    - _Requirements: 4.1, 4.2, 4.5, 6.1-6.6_
  
  - [ ] 1.2 Audit existing snapstart-activator.ts for completeness against requirements
    - Verify activation cycle ordering (wait → config → wait → publish → poll → alias)
    - Verify SnapStart configuration uses ApplyOn: PublishedVersions
    - Verify alias create/update logic handles ResourceNotFoundException
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3, 3.1, 3.3, 3.4_
  
  - [ ] 1.3 Verify integration with kata() wrapper in kata-wrapper.ts
    - Confirm SnapStartActivator is created in applyTransformation
    - Verify default alias name is "kata"
    - Verify default timeout is 180 seconds
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ] 2. Enhance error handling and edge cases
  - [ ] 2.1 Add explicit error handling for function not found
    - Catch ResourceNotFoundException from waiters
    - Return descriptive error message
    - _Requirements: 9.1_
  
  - [ ] 2.2 Add explicit error handling for permission errors
    - Catch AccessDeniedException
    - Include required permissions in error message
    - _Requirements: 9.4_
  
  - [ ] 2.3 Ensure snapshot failure includes StateReason
    - Verify error message includes StateReason when State='Failed'
    - _Requirements: 2.5, 9.3_

- [ ] 3. Checkpoint - Verify existing tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Add property-based tests for activation logic
  - [ ] 4.1 Write property test for activation cycle ordering
    - **Property 1: Activation Cycle Ordering**
    - Verify operations occur in correct sequence for any function name
    - _Requirements: 1.2, 1.3, 2.1, 2.3, 3.1_
    - **Validates: Requirements 1.2, 1.3, 2.1, 2.3, 3.1**
  
  - [ ] 4.2 Write property test for SnapStart configuration correctness
    - **Property 2: SnapStart Configuration Correctness**
    - Verify UpdateFunctionConfiguration always includes correct SnapStart config
    - _Requirements: 1.1_
    - **Validates: Requirements 1.1**
  
  - [ ] 4.3 Write property test for alias management idempotency
    - **Property 3: Alias Management Idempotency**
    - Verify alias create vs update logic for any alias name
    - _Requirements: 3.2, 3.3, 3.4, 5.2_
    - **Validates: Requirements 3.2, 3.3, 3.4, 5.2**
  
  - [ ] 4.4 Write property test for error propagation
    - **Property 4: Error Propagation**
    - Verify FAILED status and error message for any AWS error
    - _Requirements: 5.4, 9.2_
    - **Validates: Requirements 5.4, 9.2**

- [ ] 5. Add property-based tests for timeout and polling
  - [ ] 5.1 Write property test for timeout and polling behavior
    - **Property 5: Timeout and Polling Behavior**
    - Verify polling respects timeout configuration
    - Verify progress logging at correct intervals
    - _Requirements: 2.4, 7.1, 7.2, 7.4, 7.5_
    - **Validates: Requirements 2.4, 7.1, 7.2, 7.4, 7.5**
  
  - [ ] 5.2 Write property test for operation descriptions
    - **Property 6: Operation Descriptions**
    - Verify PublishVersion and alias commands include correct descriptions
    - _Requirements: 2.2, 3.5_
    - **Validates: Requirements 2.2, 3.5**

- [ ] 6. Add property-based tests for delete and failure handling
  - [ ] 6.1 Write property test for delete request handling
    - **Property 7: Delete Request Handling**
    - Verify no Lambda API calls on Delete request
    - Verify SUCCESS status returned
    - _Requirements: 4.4, 5.5_
    - **Validates: Requirements 4.4, 5.5**
  
  - [ ] 6.2 Write property test for snapshot failure handling
    - **Property 8: Snapshot Failure Handling**
    - Verify error includes StateReason when State='Failed'
    - _Requirements: 2.5, 9.3_
    - **Validates: Requirements 2.5, 9.3**

- [ ] 7. Checkpoint - Verify all property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Add CDK construct unit tests
  - [ ] 8.1 Add tests for Custom Resource properties
    - Verify FunctionName, AliasName, Timestamp in synthesized template
    - _Requirements: 5.3_
  
  - [ ] 8.2 Add tests for IAM permissions
    - Verify all required permissions are granted
    - Verify permissions are scoped to target function ARN
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  
  - [ ] 8.3 Add tests for handler timeout configuration
    - Verify timeout is snapshotTimeoutSeconds + 60
    - _Requirements: 7.3_
  
  - [ ] 8.4 Add tests for construct output attributes
    - Verify versionRef, aliasArnRef, aliasName are exposed
    - _Requirements: 8.1, 8.2, 8.3_

- [ ] 9. Verify kata() integration
  - [ ] 9.1 Add integration test for kata() with SnapStart
    - Verify SnapStartActivator is created when kata() transforms a function
    - Verify correct parent-child relationship
    - _Requirements: 10.1, 10.2_
  
  - [ ] 9.2 Add test for default configuration values
    - Verify default alias name is "kata"
    - Verify default timeout is 180 seconds
    - _Requirements: 10.3, 10.4_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Update exports and documentation
  - [ ] 11.1 Verify SnapStartActivator is exported from src/index.ts
    - Add export if missing
    - _Requirements: 4.1_
  
  - [ ] 11.2 Add JSDoc comments to public interfaces
    - Document SnapStartActivatorProps
    - Document SnapStartActivator class
    - _Requirements: 8.1, 8.2, 8.3_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The existing implementation provides a solid foundation; focus is on validation and testing
- Property tests use fast-check library (already in devDependencies)
- Each property test should run minimum 100 iterations
- CDK template assertions use aws-cdk-lib/assertions

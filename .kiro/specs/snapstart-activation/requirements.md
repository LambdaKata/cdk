# Requirements Document

## Introduction

This document specifies the requirements for implementing SnapStart activation and readiness waiting during AWS CDK deployment for Lambda Kata. The system will ensure that Python Lambda functions deployed with SnapStart become ready immediately after deployment by publishing a version, waiting for snapshot creation, and creating an alias. This prevents first-user invocations from hitting SnapStartNotReadyException errors.

## Glossary

- **SnapStart**: AWS Lambda feature that improves cold start performance by creating and caching execution environment snapshots
- **SnapStart_Activator**: CDK construct that manages SnapStart enablement and readiness waiting via Custom Resource
- **Custom_Resource**: CloudFormation resource backed by a Lambda function that executes custom logic during stack deployment
- **Lambda_Version**: An immutable, numbered snapshot of a Lambda function's code and configuration
- **Lambda_Alias**: A named pointer to a specific Lambda version, enabling stable routing
- **Optimization_Status**: SnapStart status indicating whether snapshot creation is complete ("On", "Off", or "Unknown")
- **Function_State**: Lambda function state indicating readiness ("Active", "Pending", "Failed")
- **FunctionActiveV2_Waiter**: AWS SDK waiter that polls until a Lambda function reaches Active state
- **FunctionUpdatedV2_Waiter**: AWS SDK waiter that polls until a Lambda function configuration update completes

## Requirements

### Requirement 1: SnapStart Configuration Enablement

**User Story:** As a developer deploying Lambda functions with Lambda Kata, I want SnapStart to be automatically enabled on my transformed functions, so that I benefit from improved cold start performance without manual configuration.

#### Acceptance Criteria

1. WHEN a Lambda function is transformed by kata(), THE SnapStart_Activator SHALL enable SnapStart with ApplyOn set to "PublishedVersions"
2. WHEN enabling SnapStart, THE SnapStart_Activator SHALL wait for the function to reach Active state before proceeding
3. WHEN enabling SnapStart, THE SnapStart_Activator SHALL wait for the configuration update to complete before publishing a version
4. IF the function is not in Active state within 60 seconds, THEN THE SnapStart_Activator SHALL return a descriptive error

### Requirement 2: Version Publishing and Snapshot Creation

**User Story:** As a developer, I want a new Lambda version to be published after SnapStart is enabled, so that a snapshot is created and cached for fast cold starts.

#### Acceptance Criteria

1. WHEN SnapStart configuration is applied, THE SnapStart_Activator SHALL publish a new Lambda version
2. WHEN publishing a version, THE SnapStart_Activator SHALL include a description with timestamp for traceability
3. WHEN a version is published, THE SnapStart_Activator SHALL poll the version's state until it becomes Active
4. WHEN polling for snapshot readiness, THE SnapStart_Activator SHALL use a configurable timeout (default: 180 seconds)
5. IF snapshot creation fails (State = "Failed"), THEN THE SnapStart_Activator SHALL return an error with the StateReason

### Requirement 3: Alias Management

**User Story:** As a developer, I want an alias pointing to the SnapStart-enabled version, so that I have a stable endpoint for invoking my function with optimal cold start performance.

#### Acceptance Criteria

1. WHEN a version is published and ready, THE SnapStart_Activator SHALL create or update an alias pointing to that version
2. THE SnapStart_Activator SHALL use a configurable alias name (default: "kata")
3. WHEN an alias with the same name exists, THE SnapStart_Activator SHALL update it to point to the new version
4. WHEN an alias does not exist, THE SnapStart_Activator SHALL create a new alias
5. WHEN creating or updating an alias, THE SnapStart_Activator SHALL include a description indicating Lambda Kata SnapStart enablement

### Requirement 4: Custom Resource Implementation

**User Story:** As a CDK developer, I want SnapStart activation to happen during stack deployment via a Custom Resource, so that the function is ready immediately after cdk deploy completes.

#### Acceptance Criteria

1. THE SnapStart_Activator SHALL be implemented as a CDK construct that creates a CloudFormation Custom Resource
2. THE Custom_Resource SHALL depend on the target Lambda function to ensure correct deployment ordering
3. WHEN the Custom_Resource receives a Create or Update request, THE handler SHALL execute the full SnapStart activation cycle
4. WHEN the Custom_Resource receives a Delete request, THE handler SHALL return success without action (Lambda deletion handled by CloudFormation)
5. THE Custom_Resource handler SHALL be implemented as inline Lambda code to avoid external dependencies

### Requirement 5: Idempotency and Update Safety

**User Story:** As a developer running repeated deployments, I want SnapStart activation to be idempotent and safe on updates, so that re-deployments don't break my function or create unnecessary resources.

#### Acceptance Criteria

1. WHEN the Custom_Resource is updated, THE SnapStart_Activator SHALL re-run the activation cycle to ensure the latest version has SnapStart
2. WHEN re-running activation, THE SnapStart_Activator SHALL update the existing alias rather than creating duplicates
3. THE Custom_Resource SHALL include a timestamp property to force updates on each deployment
4. WHEN activation fails, THE Custom_Resource SHALL return FAILED status with a descriptive error message
5. THE SnapStart_Activator SHALL not modify or delete resources created by previous deployments

### Requirement 6: IAM Permissions

**User Story:** As a security-conscious developer, I want the Custom Resource handler to have minimal required permissions, so that the principle of least privilege is maintained.

#### Acceptance Criteria

1. THE Custom_Resource handler SHALL have permission to call lambda:GetFunction on the target function
2. THE Custom_Resource handler SHALL have permission to call lambda:GetFunctionConfiguration on the target function and its versions
3. THE Custom_Resource handler SHALL have permission to call lambda:UpdateFunctionConfiguration on the target function
4. THE Custom_Resource handler SHALL have permission to call lambda:PublishVersion on the target function
5. THE Custom_Resource handler SHALL have permission to call lambda:GetAlias, lambda:CreateAlias, and lambda:UpdateAlias on the target function
6. THE permissions SHALL be scoped to the target function ARN and its versions/aliases (not wildcard)

### Requirement 7: Timeout and Polling Configuration

**User Story:** As a developer with varying deployment requirements, I want configurable timeout and polling settings, so that I can adjust for functions with longer snapshot creation times.

#### Acceptance Criteria

1. THE SnapStart_Activator SHALL accept a snapshotTimeoutSeconds parameter (default: 180 seconds)
2. THE SnapStart_Activator SHALL poll for snapshot readiness at 2-second intervals
3. THE Custom_Resource handler timeout SHALL be set to snapshotTimeoutSeconds plus 60 seconds buffer
4. WHEN the snapshot timeout is exceeded, THE SnapStart_Activator SHALL log a warning and proceed with alias creation
5. THE SnapStart_Activator SHALL log progress every 10 polling attempts for visibility

### Requirement 8: Output and Observability

**User Story:** As a developer, I want access to the created version and alias information, so that I can reference them in other parts of my infrastructure.

#### Acceptance Criteria

1. THE SnapStart_Activator construct SHALL expose the created version number as an attribute
2. THE SnapStart_Activator construct SHALL expose the alias ARN as an attribute
3. THE SnapStart_Activator construct SHALL expose the alias name as a property
4. THE Custom_Resource handler SHALL log detailed progress at each step of the activation cycle
5. WHEN activation completes, THE handler SHALL log a summary including version, alias, and optimization status

### Requirement 9: Error Handling

**User Story:** As a developer, I want clear error messages when SnapStart activation fails, so that I can quickly diagnose and resolve issues.

#### Acceptance Criteria

1. WHEN the target function is not found, THE SnapStart_Activator SHALL return an error indicating the function does not exist
2. WHEN AWS API calls fail, THE SnapStart_Activator SHALL include the AWS error message in the response
3. WHEN snapshot creation fails, THE SnapStart_Activator SHALL include the StateReason in the error message
4. WHEN permissions are insufficient, THE SnapStart_Activator SHALL return an error indicating required permissions
5. THE Custom_Resource SHALL return FAILED status with Reason field populated for all error cases

### Requirement 10: Integration with kata() Wrapper

**User Story:** As a Lambda Kata user, I want SnapStart activation to be automatically applied when I use kata(), so that I get optimal performance without additional configuration.

#### Acceptance Criteria

1. WHEN kata() transforms a Lambda function, THE kata() function SHALL create a SnapStart_Activator construct
2. THE SnapStart_Activator SHALL be created as a child of the target Lambda function construct
3. THE SnapStart_Activator SHALL use "kata" as the default alias name for consistency
4. THE SnapStart_Activator SHALL use 180 seconds as the default snapshot timeout
5. THE SnapStart_Activator creation SHALL not block CDK synthesis (activation happens during CloudFormation deployment)

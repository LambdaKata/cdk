# Product Overview

**@lambdakata/cdk** is an AWS CDK integration library for Lambda Kata, enabling Node.js Lambda functions to run via the Lambda Kata runtime.

## Core Functionality

The library provides a `kata()` wrapper function that transforms Node.js Lambda functions to:
- Switch runtime from Node.js to Python 3.12
- Set handler to `lambdakata.optimized_handler.lambda_handler`
- Attach customer-specific Lambda Kata Layer ARN
- Create configuration layers with handler path information

## Key Features

- **Runtime Transformation**: Seamlessly converts Node.js Lambdas to use Lambda Kata Python runtime
- **Handler Resolution**: Supports custom handler resolution via inline functions or middleware files
- **Licensing Integration**: Validates AWS Marketplace subscriptions and account entitlements
- **Property Preservation**: Maintains all original Lambda properties (memory, timeout, IAM roles, triggers)
- **CDK Integration**: Native AWS CDK v2 support with TypeScript

## Target Users

- AWS developers using CDK for Lambda deployments
- Teams wanting to optimize Node.js Lambda performance via Lambda Kata runtime
- Organizations with AWS Marketplace Lambda Kata subscriptions

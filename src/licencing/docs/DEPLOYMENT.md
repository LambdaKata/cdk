# Lambda Layer Deployment Guide

**Validates: Requirement 12.2**

This document provides comprehensive procedures for deploying the Native Licensing Validator as AWS Lambda Layers, including packaging, deployment, verification, and operational considerations.

## Overview

The Native Licensing Validator is distributed as AWS Lambda Layers to provide:

- **Isolation**: Native addon separated from application code
- **Reusability**: Single layer shared across multiple functions
- **Security**: Immutable layer with proper permissions
- **Performance**: Optimized loading and caching

## Layer Architecture

### Layer Structure

```
Layer ARN: arn:aws:lambda:region:account:layer:native-licensing-validator:version
├── nodejs/
│   └── node_modules/
│       └── @lambda-kata/
│           └── native-licensing-validator/
│               ├── build/Release/
│               │   └── native_licensing_validator.node  (755 permissions)
│               ├── out/dist/
│               │   └── index.js
│               ├── out/tsc/
│               │   └── index.d.ts
│               └── package.json
```

### Layer Specifications

| Property | Value | Notes |
|----------|-------|-------|
| Runtime Compatibility | nodejs18.x, nodejs20.x, nodejs22.x | Node.js 18+ required |
| Architecture | x86_64, arm64 | Separate layers per architecture |
| Max Size | 250 MB | Current size ~5-10 MB |
| File Permissions | 755 for .node files | Required for Lambda execution |

## Prerequisites

### AWS CLI Configuration

```bash
# Install AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Configure credentials
aws configure
# AWS Access Key ID: [Your Access Key]
# AWS Secret Access Key: [Your Secret Key]
# Default region name: us-east-1
# Default output format: json

# Verify configuration
aws sts get-caller-identity
```

### Required Permissions

Your AWS credentials must have the following permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "lambda:PublishLayerVersion",
                "lambda:GetLayerVersion",
                "lambda:DeleteLayerVersion",
                "lambda:ListLayerVersions",
                "lambda:AddLayerVersionPermission",
                "lambda:RemoveLayerVersionPermission",
                "lambda:GetLayerVersionPolicy"
            ],
            "Resource": "arn:aws:lambda:*:*:layer:native-licensing-validator*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "lambda:ListLayers"
            ],
            "Resource": "*"
        }
    ]
}
```

### Build Artifacts

Ensure you have built the layer packages:

```bash
cd packages/native-licensing-validator

# Build for all architectures
./scripts/build-docker.sh

# Verify build artifacts
ls -la build/native-licensing-validator-*.zip
```

## Deployment Procedures

### Method 1: AWS CLI Deployment

#### Deploy x64 Layer

```bash
# Set deployment variables
LAYER_NAME="native-licensing-validator"
REGION="us-east-1"
DESCRIPTION="Native Licensing Validator for Lambda Kata SST Integration"

# Deploy x64 layer
aws lambda publish-layer-version \
    --layer-name "${LAYER_NAME}-x64" \
    --description "${DESCRIPTION} (x64)" \
    --zip-file fileb://build/native-licensing-validator-amd64.zip \
    --compatible-runtimes nodejs18.x nodejs20.x nodejs22.x \
    --compatible-architectures x86_64 \
    --region "${REGION}"

# Capture layer ARN
X64_LAYER_ARN=$(aws lambda list-layer-versions \
    --layer-name "${LAYER_NAME}-x64" \
    --region "${REGION}" \
    --query 'LayerVersions[0].LayerVersionArn' \
    --output text)

echo "x64 Layer ARN: ${X64_LAYER_ARN}"
```

#### Deploy arm64 Layer

```bash
# Deploy arm64 layer
aws lambda publish-layer-version \
    --layer-name "${LAYER_NAME}-arm64" \
    --description "${DESCRIPTION} (arm64)" \
    --zip-file fileb://build/native-licensing-validator-arm64.zip \
    --compatible-runtimes nodejs18.x nodejs20.x nodejs22.x \
    --compatible-architectures arm64 \
    --region "${REGION}"

# Capture layer ARN
ARM64_LAYER_ARN=$(aws lambda list-layer-versions \
    --layer-name "${LAYER_NAME}-arm64" \
    --region "${REGION}" \
    --query 'LayerVersions[0].LayerVersionArn' \
    --output text)

echo "arm64 Layer ARN: ${ARM64_LAYER_ARN}"
```

### Method 2: AWS CDK Deployment

```typescript
import { LayerVersion, Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export class NativeLicensingValidatorLayers extends Construct {
  public readonly x64Layer: LayerVersion;
  public readonly arm64Layer: LayerVersion;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // x64 Layer
    this.x64Layer = new LayerVersion(this, 'NativeLicensingValidatorX64', {
      layerVersionName: 'native-licensing-validator-x64',
      description: 'Native Licensing Validator for Lambda Kata SST Integration (x64)',
      code: Code.fromAsset('packages/native-licensing-validator/build/native-licensing-validator-amd64.zip'),
      compatibleRuntimes: [
        Runtime.NODEJS_18_X,
        Runtime.NODEJS_20_X,
        Runtime.NODEJS_22_X,
      ],
      compatibleArchitectures: [Architecture.X86_64],
    });

    // arm64 Layer
    this.arm64Layer = new LayerVersion(this, 'NativeLicensingValidatorArm64', {
      layerVersionName: 'native-licensing-validator-arm64',
      description: 'Native Licensing Validator for Lambda Kata SST Integration (arm64)',
      code: Code.fromAsset('packages/native-licensing-validator/build/native-licensing-validator-arm64.zip'),
      compatibleRuntimes: [
        Runtime.NODEJS_18_X,
        Runtime.NODEJS_20_X,
        Runtime.NODEJS_22_X,
      ],
      compatibleArchitectures: [Architecture.ARM_64],
    });
  }
}
```

### Method 3: Terraform Deployment

```hcl
# x64 Layer
resource "aws_lambda_layer_version" "native_licensing_validator_x64" {
  layer_name          = "native-licensing-validator-x64"
  description         = "Native Licensing Validator for Lambda Kata SST Integration (x64)"
  filename            = "packages/native-licensing-validator/build/native-licensing-validator-amd64.zip"
  source_code_hash    = filebase64sha256("packages/native-licensing-validator/build/native-licensing-validator-amd64.zip")
  
  compatible_runtimes = ["nodejs18.x", "nodejs20.x", "nodejs22.x"]
  compatible_architectures = ["x86_64"]
}

# arm64 Layer
resource "aws_lambda_layer_version" "native_licensing_validator_arm64" {
  layer_name          = "native-licensing-validator-arm64"
  description         = "Native Licensing Validator for Lambda Kata SST Integration (arm64)"
  filename            = "packages/native-licensing-validator/build/native-licensing-validator-arm64.zip"
  source_code_hash    = filebase64sha256("packages/native-licensing-validator/build/native-licensing-validator-arm64.zip")
  
  compatible_runtimes = ["nodejs18.x", "nodejs20.x", "nodejs22.x"]
  compatible_architectures = ["arm64"]
}

# Outputs
output "x64_layer_arn" {
  value = aws_lambda_layer_version.native_licensing_validator_x64.arn
}

output "arm64_layer_arn" {
  value = aws_lambda_layer_version.native_licensing_validator_arm64.arn
}
```

### Method 4: Automated Deployment Script

```bash
#!/bin/bash
# deploy-layers.sh

set -euo pipefail

# Configuration
LAYER_NAME="native-licensing-validator"
DESCRIPTION="Native Licensing Validator for Lambda Kata SST Integration"
REGIONS=("us-east-1" "us-west-2" "eu-west-1" "ap-southeast-1")
RUNTIMES=("nodejs18.x" "nodejs20.x" "nodejs22.x")

# Deploy to multiple regions
for region in "${REGIONS[@]}"; do
    echo "Deploying to region: $region"
    
    # Deploy x64 layer
    aws lambda publish-layer-version \
        --layer-name "${LAYER_NAME}-x64" \
        --description "${DESCRIPTION} (x64)" \
        --zip-file fileb://build/native-licensing-validator-amd64.zip \
        --compatible-runtimes "${RUNTIMES[@]}" \
        --compatible-architectures x86_64 \
        --region "$region" \
        --output table
    
    # Deploy arm64 layer
    aws lambda publish-layer-version \
        --layer-name "${LAYER_NAME}-arm64" \
        --description "${DESCRIPTION} (arm64)" \
        --zip-file fileb://build/native-licensing-validator-arm64.zip \
        --compatible-runtimes "${RUNTIMES[@]}" \
        --compatible-architectures arm64 \
        --region "$region" \
        --output table
done

echo "Deployment complete!"
```

## Layer Verification

### Automated Verification

```bash
# Run deployment verification tests
npm run test:lambda-layer-deployment

# Test layer loading in Lambda environment
npm run test:lambda-environment-simulation
```

### Manual Verification

#### Layer Information

```bash
# List layer versions
aws lambda list-layer-versions \
    --layer-name "native-licensing-validator-x64" \
    --region "us-east-1"

# Get specific layer version details
aws lambda get-layer-version \
    --layer-name "native-licensing-validator-x64" \
    --version-number 1 \
    --region "us-east-1"
```

#### Layer Content Verification

```bash
# Download layer for inspection
aws lambda get-layer-version \
    --layer-name "native-licensing-validator-x64" \
    --version-number 1 \
    --region "us-east-1" \
    --query 'Content.Location' \
    --output text | xargs curl -o layer-download.zip

# Extract and inspect
unzip layer-download.zip -d layer-inspect/
find layer-inspect -name "*.node" -exec file {} \;
find layer-inspect -name "*.node" -exec ls -la {} \;
```

#### Test Function Deployment

Create a test Lambda function to verify layer functionality:

```javascript
// test-function/index.js
const { NativeLicensingService } = require('@lambda-kata/licensing');

exports.handler = async (event) => {
    try {
        console.log('Testing native licensing validator...');
        
        const service = new NativeLicensingService();
        const result = await service.checkEntitlement('123456789012');
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                result: result,
                message: 'Native validator loaded successfully'
            })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    }
};
```

Deploy test function:

```bash
# Package test function
cd test-function
zip -r ../test-function.zip .
cd ..

# Create test function
aws lambda create-function \
    --function-name "test-native-licensing-validator" \
    --runtime "nodejs20.x" \
    --role "arn:aws:iam::ACCOUNT:role/lambda-execution-role" \
    --handler "index.handler" \
    --zip-file fileb://test-function.zip \
    --layers "${X64_LAYER_ARN}" \
    --architecture "x86_64" \
    --timeout 30

# Test function
aws lambda invoke \
    --function-name "test-native-licensing-validator" \
    --payload '{}' \
    response.json

# Check response
cat response.json
```

## Layer Management

### Version Management

```bash
# List all versions
aws lambda list-layer-versions \
    --layer-name "native-licensing-validator-x64" \
    --region "us-east-1"

# Delete old version
aws lambda delete-layer-version \
    --layer-name "native-licensing-validator-x64" \
    --version-number 1 \
    --region "us-east-1"

# Update layer (creates new version)
aws lambda publish-layer-version \
    --layer-name "native-licensing-validator-x64" \
    --description "Updated Native Licensing Validator (x64)" \
    --zip-file fileb://build/native-licensing-validator-amd64.zip \
    --compatible-runtimes nodejs18.x nodejs20.x nodejs22.x \
    --compatible-architectures x86_64 \
    --region "us-east-1"
```

### Permission Management

```bash
# Make layer public (if needed)
aws lambda add-layer-version-permission \
    --layer-name "native-licensing-validator-x64" \
    --version-number 1 \
    --statement-id "public-access" \
    --action "lambda:GetLayerVersion" \
    --principal "*" \
    --region "us-east-1"

# Grant access to specific account
aws lambda add-layer-version-permission \
    --layer-name "native-licensing-validator-x64" \
    --version-number 1 \
    --statement-id "account-access" \
    --action "lambda:GetLayerVersion" \
    --principal "123456789012" \
    --region "us-east-1"

# Remove permission
aws lambda remove-layer-version-permission \
    --layer-name "native-licensing-validator-x64" \
    --version-number 1 \
    --statement-id "public-access" \
    --region "us-east-1"
```

## Integration with Lambda Functions

### SST v2 Integration

```typescript
import { Function } from 'sst/constructs';
import { kataSstV2 } from '@lambda-kata/sst-v2';

// Create function with native licensing validator layer
const myFunction = new Function(this, 'MyFunction', {
  handler: 'src/handler.main',
  runtime: 'nodejs20.x',
  architecture: 'x86_64',
  layers: [
    'arn:aws:lambda:us-east-1:ACCOUNT:layer:native-licensing-validator-x64:1'
  ]
});

// Transform with Lambda Kata (will use native validator)
kataSstV2(myFunction);
```

### SST v3 Integration

```typescript
import { withLambdaKata } from '@lambda-kata/sst-v3';

// Function with native licensing validator layer
export const myFunction = new sst.aws.Function("MyFunction", withLambdaKata({
  handler: "src/handler.main",
  runtime: "nodejs20.x",
  architecture: "x86_64",
  layers: [
    "arn:aws:lambda:us-east-1:ACCOUNT:layer:native-licensing-validator-x64:1"
  ]
}));
```

### Direct Lambda Function

```typescript
import { Function, LayerVersion } from 'aws-cdk-lib/aws-lambda';

const nativeValidatorLayer = LayerVersion.fromLayerVersionArn(
  this,
  'NativeValidatorLayer',
  'arn:aws:lambda:us-east-1:ACCOUNT:layer:native-licensing-validator-x64:1'
);

const myFunction = new Function(this, 'MyFunction', {
  runtime: Runtime.NODEJS_20_X,
  architecture: Architecture.X86_64,
  handler: 'index.handler',
  code: Code.fromAsset('lambda'),
  layers: [nativeValidatorLayer]
});
```

## Monitoring and Observability

### CloudWatch Metrics

Monitor layer usage through CloudWatch:

```bash
# Get layer invocation metrics
aws cloudwatch get-metric-statistics \
    --namespace "AWS/Lambda" \
    --metric-name "Invocations" \
    --dimensions Name=LayerName,Value=native-licensing-validator-x64 \
    --start-time "2024-01-01T00:00:00Z" \
    --end-time "2024-01-02T00:00:00Z" \
    --period 3600 \
    --statistics Sum
```

### Layer Usage Tracking

```javascript
// Add to Lambda function for usage tracking
const { NativeLicensingService } = require('@lambda-kata/licensing');

exports.handler = async (event, context) => {
    // Log layer usage
    console.log('Layer ARN:', context.invokedFunctionArn);
    console.log('Runtime:', process.version);
    console.log('Architecture:', process.arch);
    
    const service = new NativeLicensingService();
    // ... rest of handler
};
```

## Security Considerations

### Layer Security

- **Immutable**: Layer versions are immutable once published
- **Permissions**: Control access through IAM policies
- **Encryption**: Layers are encrypted at rest by default
- **Integrity**: AWS validates layer integrity

### Operational Security

```bash
# Verify layer integrity
aws lambda get-layer-version \
    --layer-name "native-licensing-validator-x64" \
    --version-number 1 \
    --region "us-east-1" \
    --query 'Content.CodeSha256'

# Compare with local build
sha256sum build/native-licensing-validator-amd64.zip
```

### Access Control

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowLayerAccess",
            "Effect": "Allow",
            "Principal": {
                "AWS": "arn:aws:iam::ACCOUNT:root"
            },
            "Action": "lambda:GetLayerVersion",
            "Resource": "arn:aws:lambda:*:*:layer:native-licensing-validator*"
        }
    ]
}
```

## Cost Optimization

### Layer Size Optimization

- Current layer size: ~5-10 MB
- Optimization techniques:
  - Strip debug symbols
  - Compress binaries
  - Remove unnecessary files
  - Use minimal dependencies

### Regional Deployment Strategy

Deploy layers only in regions where you have Lambda functions:

```bash
# Get regions with Lambda functions
aws lambda list-functions --query 'Functions[].FunctionArn' --output text | \
    grep -o 'arn:aws:lambda:[^:]*' | \
    cut -d: -f4 | \
    sort -u
```

## Troubleshooting

### Common Deployment Issues

**Layer Size Exceeded**:
```bash
# Error: Layer size exceeds 250MB limit
# Solution: Optimize layer contents
du -sh build/layer-*/
```

**Permission Denied**:
```bash
# Error: User is not authorized to perform lambda:PublishLayerVersion
# Solution: Add required IAM permissions
aws iam attach-user-policy --user-name USERNAME --policy-arn arn:aws:iam::aws:policy/AWSLambda_FullAccess
```

**Architecture Mismatch**:
```bash
# Error: Layer architecture doesn't match function architecture
# Solution: Deploy separate layers for each architecture
aws lambda get-function --function-name FUNCTION_NAME --query 'Configuration.Architectures'
```

### Layer Loading Issues

**Native Addon Not Found**:
```javascript
// Error: Cannot find module './build/Release/native_licensing_validator.node'
// Check layer structure and permissions
console.log('Layer path:', process.env.LAMBDA_TASK_ROOT);
console.log('Layer contents:', require('fs').readdirSync('/opt'));
```

**Permission Denied**:
```bash
# Error: Permission denied when loading .node file
# Verify file permissions in layer
find /opt -name "*.node" -exec ls -la {} \;
```

## Rollback Procedures

### Version Rollback

```bash
# List layer versions
aws lambda list-layer-versions \
    --layer-name "native-licensing-validator-x64" \
    --region "us-east-1"

# Update function to use previous layer version
aws lambda update-function-configuration \
    --function-name "my-function" \
    --layers "arn:aws:lambda:us-east-1:ACCOUNT:layer:native-licensing-validator-x64:1"
```

### Emergency Rollback

```bash
# Remove layer from function (fallback to HTTP validator)
aws lambda update-function-configuration \
    --function-name "my-function" \
    --layers ""
```

## Best Practices

### Deployment Best Practices

1. **Test in staging**: Always test layers in staging environment first
2. **Version management**: Use semantic versioning for layer descriptions
3. **Regional consistency**: Deploy same version to all required regions
4. **Monitoring**: Set up CloudWatch alarms for layer usage
5. **Documentation**: Maintain deployment logs and version history

### Operational Best Practices

1. **Automated deployment**: Use CI/CD pipelines for layer deployment
2. **Health checks**: Implement layer health verification
3. **Rollback plan**: Always have a rollback strategy
4. **Security scanning**: Regularly scan layers for vulnerabilities
5. **Cost monitoring**: Track layer storage and transfer costs

## Next Steps

After successful deployment:

1. **Update functions**: Migrate Lambda functions to use the new layer
2. **Monitor performance**: Track layer loading times and memory usage
3. **Update documentation**: Document layer ARNs and usage patterns
4. **Set up alerts**: Configure monitoring for layer-related issues

## Layer ARN Reference

After deployment, document your layer ARNs:

```
# x64 Layers
us-east-1: arn:aws:lambda:us-east-1:ACCOUNT:layer:native-licensing-validator-x64:VERSION
us-west-2: arn:aws:lambda:us-west-2:ACCOUNT:layer:native-licensing-validator-x64:VERSION
eu-west-1: arn:aws:lambda:eu-west-1:ACCOUNT:layer:native-licensing-validator-x64:VERSION

# arm64 Layers
us-east-1: arn:aws:lambda:us-east-1:ACCOUNT:layer:native-licensing-validator-arm64:VERSION
us-west-2: arn:aws:lambda:us-west-2:ACCOUNT:layer:native-licensing-validator-arm64:VERSION
eu-west-1: arn:aws:lambda:eu-west-1:ACCOUNT:layer:native-licensing-validator-arm64:VERSION
```

Replace `ACCOUNT` with your AWS account ID and `VERSION` with the deployed version number.

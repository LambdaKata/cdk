# Lambda Kata Node.js Layer Management - Developer Guide

## Overview

Lambda Kata's Node.js Layer Management system automatically provides Node.js runtime binaries to Lambda functions running under the Lambda Kata Python runtime. This enables Node.js code to execute within the Lambda Kata performance-optimized environment while maintaining full Node.js compatibility.

## How It Works

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Lambda Function Runtime                      │
├─────────────────────────────────────────────────────────────────┤
│ Python 3.12 Runtime (Lambda Kata)                              │
│ ├─ lambdakata.optimized_handler.lambda_handler                 │
│ ├─ Embedded Node.js Engine                                     │
│ └─ Your JavaScript/TypeScript Code                             │
├─────────────────────────────────────────────────────────────────┤
│                        Lambda Layers                           │
│ ├─ Lambda Kata Layer (Customer-specific)                       │
│ ├─ Config Layer (Handler path + middleware)                    │
│ └─ Node.js Runtime Layer (Auto-managed)                        │
├─────────────────────────────────────────────────────────────────┤
│                    AWS Lambda Service                          │
└─────────────────────────────────────────────────────────────────┘
```

### Layer Functionality

The **Node.js Runtime Layer** provides:

1. **Exact Node.js Binaries**: Contains the precise Node.js version used by AWS Lambda runtimes
2. **Architecture Compatibility**: Supports both x86_64 and arm64 architectures
3. **Minimal Footprint**: Only includes essential Node.js binaries (~15-25MB)
4. **Version Matching**: Automatically detects and matches AWS Lambda runtime versions

### Automatic Layer Management

When you use `kata()` with a Node.js Lambda function:

1. **Runtime Detection**: System detects your Lambda's Node.js runtime (nodejs18.x, nodejs20.x, nodejs22.x)
2. **Version Resolution**: Pulls AWS Lambda Docker image to determine exact Node.js version
3. **Layer Search**: Checks if compatible layer already exists in your AWS account
4. **Layer Creation**: Creates new layer if none exists (idempotent operation)
5. **Layer Attachment**: Automatically attaches layer to your Lambda function

## System Requirements

### Development Environment

#### Required Dependencies

```json
{
  "dependencies": {
    "@lambda-kata/cdk": "^1.0.0",
    "aws-cdk-lib": "^2.0.0",
    "constructs": "^10.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^18.0.0"
  }
}
```

#### Docker Requirements

**Docker must be available during CDK synthesis** for Node.js version detection:

```bash
# Verify Docker is installed and running
docker --version
docker info

# Test AWS Lambda image access
docker pull public.ecr.aws/lambda/nodejs:20-x86_64
```

**Docker Configuration:**
- Docker Engine 20.10+ recommended
- Network access to `public.ecr.aws`
- Minimum 2GB available disk space for image caching

#### AWS Permissions

Your AWS credentials must have the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:ListLayers",
        "lambda:ListLayerVersions",
        "lambda:GetLayerVersion",
        "lambda:PublishLayerVersion",
        "lambda:DeleteLayerVersion"
      ],
      "Resource": [
        "arn:aws:lambda:*:*:layer:lambda-kata-nodejs-*"
      ]
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

### CI/CD Pipeline Requirements

#### Build Environment Setup

**GitHub Actions Example:**

```yaml
name: Deploy Lambda Kata Functions
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Docker is required for Node.js version detection
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      # Pre-warm Docker cache (optional but recommended)
      - name: Pre-warm Node.js runtime images
        run: |
          docker pull public.ecr.aws/lambda/nodejs:18-x86_64
          docker pull public.ecr.aws/lambda/nodejs:20-x86_64
          docker pull public.ecr.aws/lambda/nodejs:22-x86_64
      
      - name: Deploy CDK stack
        run: |
          npm run build
          npx cdk deploy --require-approval never
```

**AWS CodeBuild Example:**

```yaml
version: 0.2
phases:
  install:
    runtime-versions:
      nodejs: 18
      docker: 20
  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws
      - echo Pre-warming Docker images...
      - docker pull public.ecr.aws/lambda/nodejs:20-x86_64
  build:
    commands:
      - echo Build started on `date`
      - npm ci
      - npm run build
      - npx cdk deploy --require-approval never
```

#### Pipeline Considerations

1. **Docker Availability**: Ensure Docker daemon is available in build environment
2. **Network Access**: Build agents need access to `public.ecr.aws` and AWS APIs
3. **Caching Strategy**: Consider caching Docker images to reduce build times
4. **Parallel Builds**: Layer creation is idempotent, safe for parallel deployments
5. **Error Handling**: Implement retry logic for transient Docker/AWS API failures

## Usage Examples

### Basic Usage

```typescript
import { kata } from '@lambda-kata/cdk';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Architecture } from 'aws-cdk-lib/aws-lambda';

// Node.js 20.x function with automatic layer management
const myFunction = new NodejsFunction(this, 'MyFunction', {
  entry: 'src/handler.ts',
  runtime: Runtime.NODEJS_20_X,
  architecture: Architecture.X86_64,
});

// Automatically creates and attaches Node.js runtime layer
kata(myFunction);
```

### Multi-Architecture Support

```typescript
// x86_64 function
const x86Function = new NodejsFunction(this, 'X86Function', {
  entry: 'src/handler.ts',
  runtime: Runtime.NODEJS_20_X,
  architecture: Architecture.X86_64,
});

// arm64 function (different layer will be created)
const armFunction = new NodejsFunction(this, 'ArmFunction', {
  entry: 'src/handler.ts',
  runtime: Runtime.NODEJS_20_X,
  architecture: Architecture.ARM_64,
});

kata(x86Function);
kata(armFunction);
```

### Custom AWS Configuration

```typescript
kata(myFunction, {
  awsSdkConfig: {
    region: 'eu-west-1',
    maxAttempts: 5,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  },
});
```

## Layer Naming and Management

### Naming Convention

Node.js runtime layers follow a strict naming pattern:

```
lambda-kata-nodejs-{runtimeName}-{architecture}
```

**Examples:**
- `lambda-kata-nodejs-nodejs18.x-x86_64`
- `lambda-kata-nodejs-nodejs20.x-arm64`
- `lambda-kata-nodejs-nodejs22.x-x86_64`

### Layer Lifecycle

1. **Creation**: Layers are created on-demand during first deployment
2. **Reuse**: Subsequent deployments reuse existing compatible layers
3. **Versioning**: Each layer creation increments the version number
4. **Retention**: Layers persist until manually deleted (no automatic cleanup)

### Layer Contents

Each Node.js runtime layer contains:

```
/opt/nodejs/bin/node          # Node.js binary executable
```

**What's NOT included:**
- npm/npx binaries
- Node.js documentation
- Header files
- Development tools
- Package managers

## Supported Runtimes and Architectures

### Supported Node.js Runtimes

| Runtime | Node.js Version | Status |
|---------|----------------|--------|
| `nodejs18.x` | 18.19.0+ | ✅ Supported |
| `nodejs20.x` | 20.10.0+ | ✅ Supported |
| `nodejs22.x` | 22.1.0+ | ✅ Supported |
| `nodejs16.x` | 16.x | ❌ Not supported |

### Supported Architectures

| Architecture | Description | Status |
|-------------|-------------|--------|
| `x86_64` | Intel/AMD 64-bit | ✅ Supported |
| `arm64` | ARM 64-bit (Graviton) | ✅ Supported |

### Version Detection

The system automatically detects exact Node.js versions by:

1. Pulling official AWS Lambda Docker images: `public.ecr.aws/lambda/nodejs:{version}-{arch}`
2. Executing `node --version` within the container
3. Caching results to avoid repeated Docker operations
4. Falling back to known version mappings if Docker fails

## Restrictions and Limitations

### Docker Dependencies

**Critical Limitation**: Docker must be available during CDK synthesis.

**Impact:**
- CDK synthesis fails if Docker is unavailable
- Network connectivity to `public.ecr.aws` required
- Build environments must support Docker operations

**Mitigation:**
- Use Docker-enabled CI/CD environments
- Implement fallback version detection (automatic)
- Pre-warm Docker images in build cache

### AWS Account Limits

**Layer Limits per Account:**
- Maximum 75 layers per region
- Maximum 5 layer versions per layer (for concurrent access)
- Maximum layer size: 250MB (unzipped)

**Quota Management:**
- Monitor layer usage across regions
- Clean up unused layer versions periodically
- Request quota increases if needed

### Network Requirements

**Required Connectivity:**
- `public.ecr.aws` (Docker image registry)
- AWS Lambda API endpoints
- Standard AWS API endpoints

**Firewall Configuration:**
```
Outbound HTTPS (443):
- *.amazonaws.com
- public.ecr.aws
- *.docker.io (for Docker daemon)
```

### Performance Considerations

**Layer Creation Time:**
- First deployment: 2-5 minutes (includes Docker operations)
- Subsequent deployments: 10-30 seconds (layer reuse)

**Layer Size Impact:**
- Node.js layers: ~15-25MB per architecture
- Minimal impact on Lambda cold start times
- Layers are cached by AWS Lambda service

### Regional Limitations

**Layer Scope:**
- Layers are region-specific
- Must create separate layers in each deployment region
- Cross-region layer sharing not supported

**Multi-Region Strategy:**
```typescript
// Deploy to multiple regions
const regions = ['us-east-1', 'eu-west-1', 'ap-southeast-1'];

regions.forEach(region => {
  new MyStack(app, `MyStack-${region}`, {
    env: { region, account: process.env.CDK_DEFAULT_ACCOUNT },
  });
});
```

## Troubleshooting

### Common Issues

#### Docker Not Available

**Error:**
```
NodeRuntimeLayerError: Failed to detect Node.js version from Docker image
Code: VERSION_DETECTION_FAILED
```

**Solutions:**
1. Install Docker: `curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh`
2. Start Docker daemon: `sudo systemctl start docker`
3. Add user to docker group: `sudo usermod -aG docker $USER`
4. Verify access: `docker run hello-world`

#### AWS Permissions

**Error:**
```
NodeRuntimeLayerError: AWS API operation failed
Code: AWS_API_ERROR
```

**Solutions:**
1. Verify AWS credentials: `aws sts get-caller-identity`
2. Check Lambda permissions: `aws iam simulate-principal-policy`
3. Ensure region access: `aws lambda list-layers --region us-east-1`

#### Layer Size Exceeded

**Error:**
```
NodeRuntimeLayerError: Layer size exceeds AWS limits
Code: LAYER_SIZE_EXCEEDED
```

**Solutions:**
1. This should not occur with Node.js layers (they're minimal)
2. Check for corrupted Docker images: `docker system prune`
3. Verify layer contents: Contact support if issue persists

### Debugging

#### Enable Debug Logging

```typescript
import { createDefaultLogger } from '@lambda-kata/cdk';

kata(myFunction, {
  logger: createDefaultLogger('debug'),
});
```

#### Check Layer Status

```bash
# List all Lambda Kata layers
aws lambda list-layers --query 'Layers[?starts_with(LayerName, `lambda-kata-nodejs`)]'

# Get specific layer details
aws lambda get-layer-version \
  --layer-name lambda-kata-nodejs-nodejs20.x-x86_64 \
  --version-number 1
```

#### Verify Docker Images

```bash
# Test Docker image access
docker pull public.ecr.aws/lambda/nodejs:20-x86_64

# Test Node.js version detection
docker run --rm public.ecr.aws/lambda/nodejs:20-x86_64 node --version
```

## Best Practices

### Development Workflow

1. **Local Development**: Use Docker Desktop for consistent local environment
2. **Testing**: Test with multiple Node.js runtimes and architectures
3. **Staging**: Deploy to staging environment first
4. **Production**: Use infrastructure-as-code for reproducible deployments

### CI/CD Optimization

1. **Docker Caching**: Cache Docker images between builds
2. **Parallel Deployment**: Layer creation is safe for parallel execution
3. **Error Handling**: Implement retry logic for transient failures
4. **Monitoring**: Track layer creation and reuse metrics

### Cost Optimization

1. **Layer Reuse**: Leverage automatic layer reuse across functions
2. **Regional Strategy**: Deploy layers only in required regions
3. **Cleanup**: Periodically remove unused layer versions
4. **Monitoring**: Track AWS Lambda layer storage costs

### Security Considerations

1. **Minimal Layers**: Layers contain only Node.js binaries (no additional tools)
2. **Version Pinning**: Layers use exact Node.js versions from AWS Lambda
3. **Access Control**: Restrict layer management permissions
4. **Audit Trail**: Monitor layer creation and modification events

## Migration Guide

### From Manual Layer Management

If you previously managed Node.js layers manually:

1. **Identify Existing Layers**: List current Node.js layers
2. **Update CDK Code**: Replace manual layer references with `kata()`
3. **Test Compatibility**: Verify function behavior with auto-managed layers
4. **Clean Up**: Remove old manual layers after successful migration

### From Other Runtimes

When migrating from other Lambda runtimes:

1. **Update Runtime**: Change Lambda runtime to supported Node.js version
2. **Apply Kata**: Add `kata()` wrapper to function definition
3. **Test Functionality**: Verify all features work with Lambda Kata
4. **Monitor Performance**: Compare performance metrics

## Support and Resources

### Documentation
- [Lambda Kata CDK API Reference](./API.md)
- [Examples Repository](../examples/)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)

### Community
- GitHub Issues: Report bugs and feature requests
- Discussions: Community support and best practices

### Enterprise Support
- Email: [raman@worktif.com](mailto:raman@worktif.com)
- Priority support for AWS Marketplace subscribers
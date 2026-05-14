# Lambda Kata Node.js Layer Management - Quick Reference

## Essential Setup

### Installation
```bash
npm install @lambdakata/cdk aws-cdk-lib constructs
```

### Basic Usage
```typescript
import { kata } from '@lambdakata/cdk';
import { NodejsFunction, Runtime, Architecture } from 'aws-cdk-lib/aws-lambda-nodejs';

const myFunction = new NodejsFunction(this, 'MyFunction', {
  entry: 'src/handler.ts',
  runtime: Runtime.NODEJS_20_X,
  architecture: Architecture.X86_64,
});

kata(myFunction); // Automatic Node.js layer management
```

## System Requirements Checklist

### ✅ Development Environment
- [ ] Docker installed and running (`docker --version`)
- [ ] AWS CLI configured (`aws sts get-caller-identity`)
- [ ] Node.js 18+ (`node --version`)
- [ ] Network access to `public.ecr.aws`

### ✅ AWS Permissions
```json
{
  "Effect": "Allow",
  "Action": [
    "lambda:ListLayers",
    "lambda:GetLayerVersion", 
    "lambda:PublishLayerVersion"
  ],
  "Resource": "*"
}
```

### ✅ CI/CD Requirements
- Docker daemon available
- AWS credentials configured
- Network connectivity to AWS APIs and Docker registry

## Supported Configurations

| Runtime | Node.js Version | Architecture | Status |
|---------|----------------|--------------|--------|
| `nodejs18.x` | 18.19.0+ | `x86_64`, `arm64` | ✅ |
| `nodejs20.x` | 20.10.0+ | `x86_64`, `arm64` | ✅ |
| `nodejs22.x` | 22.1.0+ | `x86_64`, `arm64` | ✅ |

## Layer Management

### Automatic Layer Creation
- **Naming**: `lambda-kata-nodejs-{runtime}-{architecture}`
- **Contents**: Node.js binary at `/opt/nodejs/bin/node`
- **Size**: ~15-25MB per architecture
- **Lifecycle**: Created on-demand, reused across deployments

### Layer Reuse Logic
1. Check for existing compatible layer
2. Validate Node.js version and architecture match
3. Reuse if compatible, create new if not
4. Attach to Lambda function automatically

## Common Patterns

### Multi-Architecture Deployment
```typescript
// x86_64 function
const x86Function = new NodejsFunction(this, 'X86Function', {
  architecture: Architecture.X86_64,
});

// arm64 function (separate layer created)
const armFunction = new NodejsFunction(this, 'ArmFunction', {
  architecture: Architecture.ARM_64,
});

kata(x86Function);
kata(armFunction);
```

### Custom Handler Resolution
```typescript
kata(myFunction, {
  handlerResolver: (bundle, ctx) => {
    const handlerName = ctx.originalHandler.split('.').pop();
    return bundle[handlerName];
  },
});
```

### Error Handling
```typescript
kata(myFunction, {
  unlicensedBehavior: 'fail', // Fail deployment if not licensed
});
```

## Troubleshooting Quick Fixes

| Error | Quick Fix |
|-------|-----------|
| `VERSION_DETECTION_FAILED` | `sudo systemctl start docker` |
| `AWS_API_ERROR` | Check AWS credentials and permissions |
| `RUNTIME_UNSUPPORTED` | Use nodejs18.x, nodejs20.x, or nodejs22.x |
| `DOCKER_UNAVAILABLE` | Install Docker and add user to docker group |

## CI/CD Templates

### GitHub Actions
```yaml
- name: Set up Docker
  uses: docker/setup-buildx-action@v3

- name: Configure AWS
  uses: aws-actions/configure-aws-credentials@v4
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: us-east-1

- name: Deploy
  run: npx cdk deploy
```

### AWS CodeBuild
```yaml
version: 0.2
phases:
  install:
    runtime-versions:
      nodejs: 18
      docker: 20
  build:
    commands:
      - npm ci
      - npx cdk deploy
```

## Performance Optimization

### Docker Image Caching
```bash
# Pre-warm common images
docker pull public.ecr.aws/lambda/nodejs:18-x86_64
docker pull public.ecr.aws/lambda/nodejs:20-x86_64
docker pull public.ecr.aws/lambda/nodejs:22-x86_64
```

### Build Time Optimization
- Cache Docker images between builds
- Use faster build agents with SSD storage
- Implement parallel deployment for independent functions

## Monitoring and Debugging

### Enable Debug Logging
```typescript
import { createDefaultLogger } from '@lambdakata/cdk';

kata(myFunction, {
  logger: createDefaultLogger('debug'),
});
```

### Check Layer Status
```bash
# List Lambda Kata layers
aws lambda list-layers --query 'Layers[?starts_with(LayerName, `lambda-kata-nodejs`)]'

# Get layer details
aws lambda get-layer-version \
  --layer-name lambda-kata-nodejs-nodejs20.x-x86_64 \
  --version-number 1
```

## Restrictions and Limitations

### ❌ Not Supported
- Node.js 16.x and earlier runtimes
- Custom Node.js installations
- Cross-region layer sharing
- Manual layer version management

### ⚠️ Requirements
- Docker must be available during CDK synthesis
- Network access to AWS APIs and Docker registry
- AWS Lambda layer quotas (75 layers per region)
- Layer size limit: 250MB unzipped

## Best Practices

### ✅ Do
- Use supported Node.js runtimes (18.x, 20.x, 22.x)
- Test with Docker locally before CI/CD
- Monitor AWS Lambda layer quotas
- Implement proper error handling
- Cache Docker images in CI/CD

### ❌ Don't
- Manually manage Node.js layers
- Assume layer creation is instant (first deployment takes 2-5 minutes)
- Deploy without Docker availability
- Ignore AWS permission requirements
- Mix manual and automatic layer management

## Migration Checklist

### From Manual Layer Management
- [ ] Identify existing Node.js layers
- [ ] Update CDK code to use `kata()`
- [ ] Test with automatic layer management
- [ ] Remove manual layer references
- [ ] Clean up old layers

### New Implementation
- [ ] Install dependencies
- [ ] Configure Docker and AWS credentials
- [ ] Add `kata()` wrapper to Node.js functions
- [ ] Test deployment in staging environment
- [ ] Monitor layer creation and reuse
- [ ] Deploy to production

## Support Resources

- **Documentation**: [Full Developer Guide](./NODEJS_LAYER_MANAGEMENT.md)
- **Troubleshooting**: [Detailed Error Resolution](./TROUBLESHOOTING.md)
- **API Reference**: [Complete API Documentation](./API.md)
- **Examples**: [Code Examples](../examples/)
- **Support**: [raman@worktif.com](mailto:raman@worktif.com)

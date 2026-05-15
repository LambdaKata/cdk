# Node.js Layer Management - Quick Start Guide

## 🚀 5-Minute Setup

### Prerequisites Checklist

```bash
# ✅ Check Node.js version
node --version  # Should be 18+ 

# ✅ Check Docker installation
docker --version
docker ps  # Should not error

# ✅ Check AWS CLI configuration
aws sts get-caller-identity
```

### Installation

```bash
# Install the package
npm install @lambdakata/cdk aws-cdk-lib constructs

# Install development dependencies
npm install --save-dev @types/node typescript
```

## 🎯 Basic Usage (30 seconds)

### Option 1: Automatic with kata() wrapper (Recommended)

```typescript
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { kata } from '@lambdakata/cdk';

// Just wrap your Lambda function with kata()
const myFunction = kata(new lambda.Function(this, 'MyFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,  // ← Automatically detected
  architecture: lambda.Architecture.X86_64,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('src'),
}));

// That's it! Node.js layer is automatically created and attached
```

### Option 2: Manual control

```typescript
import { ensureNodeRuntimeLayer } from '@lambdakata/cdk';

const result = await ensureNodeRuntimeLayer({
  runtimeName: 'nodejs20.x',
  architecture: 'x86_64', 
  region: 'us-east-1',
  accountId: '123456789012',
});

console.log(`Layer ARN: ${result.layerArn}`);
console.log(`Created: ${result.created}`); // true if new, false if reused
```

## 📋 Common Patterns

### Multi-Runtime Application

```typescript
// Different Node.js versions for different purposes
const apiHandler = kata(new lambda.Function(this, 'API', {
  runtime: lambda.Runtime.NODEJS_20_X,  // Latest features
  architecture: lambda.Architecture.ARM_64, // Cost optimization
  handler: 'api.handler',
  code: lambda.Code.fromAsset('src'),
}));

const legacyProcessor = kata(new lambda.Function(this, 'Legacy', {
  runtime: lambda.Runtime.NODEJS_18_X,  // Compatibility
  architecture: lambda.Architecture.X86_64,
  handler: 'legacy.handler', 
  code: lambda.Code.fromAsset('src'),
}));
```

### Custom Configuration

```typescript
const result = await ensureNodeRuntimeLayer({
  runtimeName: 'nodejs20.x',
  architecture: 'arm64',
  region: 'us-west-2',
  accountId: process.env.AWS_ACCOUNT_ID!,
  awsSdkConfig: {
    region: 'us-west-2',
    maxAttempts: 3,
  },
  logger: console, // Use console for simple logging
});
```

## 🔧 Troubleshooting

### Issue: "Docker daemon not running"
```bash
# macOS
open -a Docker

# Linux
sudo systemctl start docker

# Verify
docker ps
```

### Issue: "AWS credentials not configured"
```bash
# Quick setup
aws configure

# Or environment variables
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_DEFAULT_REGION=us-east-1
```

### Issue: "Permission denied"
Add these permissions to your AWS user/role:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "lambda:ListLayers",
      "lambda:PublishLayerVersion",
      "lambda:GetLayerVersion"
    ],
    "Resource": "*"
  }]
}
```

## 📊 What Happens Behind the Scenes

```mermaid
graph LR
    A[Your Lambda Function] --> B[kata() wrapper]
    B --> C[Detect Node.js Runtime]
    C --> D[Find/Create Layer]
    D --> E[Attach Layer]
    E --> F[Switch to Python Runtime]
    F --> G[Optimized Function]
```

1. **Runtime Detection**: Extracts exact Node.js version (e.g., `20.10.0`)
2. **Layer Search**: Looks for existing compatible layer
3. **Layer Creation**: Creates new layer if none found (idempotent)
4. **Layer Attachment**: Adds Node.js layer to your function
5. **Runtime Switch**: Changes runtime to Python 3.12 for Lambda Kata
6. **Optimization**: Your function now runs with Lambda Kata performance benefits

## 🎯 Supported Configurations

| Runtime | Architecture | Status |
|---------|-------------|--------|
| nodejs20.x | x86_64 | ✅ Supported |
| nodejs20.x | arm64 | ✅ Supported |
| nodejs22.x | x86_64 | ✅ Supported |
| nodejs22.x | arm64 | ✅ Supported |

## 🚀 Next Steps

1. **Read the [Technical Guide](NODEJS_LAYER_MANAGEMENT_GUIDE.md)** for detailed implementation
2. **Check [Practical Examples](PRACTICAL_EXAMPLES.md)** for real-world patterns
3. **Set up monitoring** with CloudWatch dashboards
4. **Integrate with CI/CD** for automated deployments

## 💡 Pro Tips

- **Use ARM64** for cost savings (up to 20% cheaper)
- **Layer reuse** is automatic - same runtime+architecture = same layer
- **Caching** makes subsequent deployments faster
- **Error handling** is built-in with automatic retries
- **Logging** can be customized for debugging

## 🆘 Need Help?

- Check the troubleshooting section above
- Enable debug logging: `logger: console` 
- Review AWS CloudWatch logs
- Verify Docker and AWS CLI are working

---

**Ready to optimize your Node.js Lambdas? Start with `kata()` wrapper and you're done! 🎉**

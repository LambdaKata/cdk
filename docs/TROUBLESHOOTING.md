# Lambda Kata Node.js Layer Management - Troubleshooting Guide

## Quick Diagnosis

### Check System Status

```bash
# 1. Verify Docker availability
docker --version && docker info

# 2. Test AWS connectivity
aws sts get-caller-identity

# 3. Check Lambda permissions
aws lambda list-layers --max-items 1

# 4. Test Node.js image access
docker pull public.ecr.aws/lambda/nodejs:20-x86_64
```

### Common Error Patterns

| Error Code | Typical Cause | Quick Fix |
|------------|---------------|-----------|
| `VERSION_DETECTION_FAILED` | Docker unavailable | Install/start Docker |
| `AWS_API_ERROR` | Missing permissions | Update IAM policy |
| `RUNTIME_UNSUPPORTED` | Invalid runtime | Use nodejs18.x/20.x/22.x |
| `LAYER_CREATION_FAILED` | Network/quota issues | Check connectivity/quotas |

## Detailed Error Resolution

### Docker-Related Issues

#### Error: Docker Daemon Not Running

```
NodeRuntimeLayerError: Failed to detect Node.js version from Docker image
Cause: Cannot connect to the Docker daemon at unix:///var/run/docker.sock
Code: VERSION_DETECTION_FAILED
```

**Resolution:**

```bash
# Linux/macOS
sudo systemctl start docker
# or
sudo service docker start

# macOS with Docker Desktop
open -a Docker

# Windows
Start-Service docker
```

**Verification:**
```bash
docker run hello-world
```

#### Error: Docker Image Pull Timeout

```
NodeRuntimeLayerError: Docker pull timeout after 30000ms
Code: VERSION_DETECTION_FAILED
```

**Resolution:**

1. **Check Network Connectivity:**
```bash
curl -I https://public.ecr.aws
ping public.ecr.aws
```

2. **Configure Docker Timeout:**
```bash
# Increase Docker timeout
export DOCKER_CLIENT_TIMEOUT=120
export COMPOSE_HTTP_TIMEOUT=120
```

3. **Use Docker Registry Mirror (if available):**
```bash
# Configure Docker daemon with registry mirror
sudo nano /etc/docker/daemon.json
{
  "registry-mirrors": ["https://your-mirror.com"]
}
sudo systemctl restart docker
```

#### Error: Permission Denied (Docker)

```
NodeRuntimeLayerError: permission denied while trying to connect to Docker daemon
Code: VERSION_DETECTION_FAILED
```

**Resolution:**

```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Apply group changes
newgrp docker

# Or run with sudo (not recommended for CI/CD)
sudo npm run deploy
```

### AWS API Issues

#### Error: Access Denied

```
NodeRuntimeLayerError: User is not authorized to perform: lambda:ListLayers
Code: AWS_API_ERROR
```

**Resolution:**

1. **Update IAM Policy:**
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
        "lambda:PublishLayerVersion"
      ],
      "Resource": "*"
    }
  ]
}
```

2. **Verify Credentials:**
```bash
aws sts get-caller-identity
aws iam get-user
```

#### Error: Rate Limiting

```
NodeRuntimeLayerError: Rate exceeded
Code: AWS_API_ERROR
```

**Resolution:**

1. **Automatic Retry**: The system includes exponential backoff retry logic
2. **Manual Retry**: Wait 1-2 minutes and retry deployment
3. **Reduce Concurrency**: Deploy functions sequentially instead of parallel

#### Error: Layer Quota Exceeded

```
NodeRuntimeLayerError: Too many layers in account
Code: QUOTA_EXCEEDED
```

**Resolution:**

1. **Check Current Usage:**
```bash
aws lambda list-layers --query 'length(Layers)'
```

2. **Clean Up Unused Layers:**
```bash
# List Lambda Kata layers
aws lambda list-layers --query 'Layers[?starts_with(LayerName, `lambda-kata-nodejs`)]'

# Delete specific layer version
aws lambda delete-layer-version \
  --layer-name lambda-kata-nodejs-nodejs18.x-x86_64 \
  --version-number 1
```

3. **Request Quota Increase:**
   - AWS Console → Service Quotas → AWS Lambda → Layers per account

### Runtime and Architecture Issues

#### Error: Unsupported Runtime

```
NodeRuntimeLayerError: Unsupported runtime: nodejs16.x
Code: RUNTIME_UNSUPPORTED
```

**Resolution:**

Update your Lambda function to use a supported runtime:

```typescript
// ❌ Unsupported
const myFunction = new NodejsFunction(this, 'MyFunction', {
  runtime: Runtime.NODEJS_16_X, // Not supported
});

// ✅ Supported
const myFunction = new NodejsFunction(this, 'MyFunction', {
  runtime: Runtime.NODEJS_20_X, // Supported
});
```

#### Error: Invalid Architecture

```
NodeRuntimeLayerError: Unsupported architecture: arm32
Code: INVALID_ARCHITECTURE
```

**Resolution:**

Use supported architectures:

```typescript
// ✅ Supported architectures
Architecture.X86_64  // Intel/AMD 64-bit
Architecture.ARM_64  // ARM 64-bit (Graviton)
```

### Layer Creation Issues

#### Error: Layer Size Exceeded

```
NodeRuntimeLayerError: Layer size exceeds AWS limits (250MB unzipped)
Code: LAYER_SIZE_EXCEEDED
```

**Resolution:**

This should not occur with Node.js layers. If it does:

1. **Check Docker Image:**
```bash
docker images | grep nodejs
docker system prune -f
```

2. **Verify Layer Contents:**
```bash
# Check layer size
aws lambda get-layer-version \
  --layer-name lambda-kata-nodejs-nodejs20.x-x86_64 \
  --version-number 1 \
  --query 'CodeSize'
```

3. **Contact Support**: This indicates a system issue

#### Error: Network Connectivity

```
NodeRuntimeLayerError: socket hang up
Code: AWS_API_ERROR
```

**Resolution:**

1. **Check Network:**
```bash
curl -I https://lambda.us-east-1.amazonaws.com
```

2. **Configure Proxy (if needed):**
```bash
export HTTPS_PROXY=http://proxy.company.com:8080
export HTTP_PROXY=http://proxy.company.com:8080
```

3. **Retry with Backoff**: The system automatically retries, but manual retry may help

## CI/CD Specific Issues

### GitHub Actions

#### Error: Docker Not Available

```yaml
# ❌ Missing Docker setup
- name: Deploy
  run: npx cdk deploy

# ✅ Proper Docker setup
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3

- name: Deploy
  run: npx cdk deploy
```

#### Error: AWS Credentials

```yaml
# ✅ Proper AWS credential setup
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: us-east-1
```

### AWS CodeBuild

#### Error: Docker Service Unavailable

```yaml
# ✅ Proper CodeBuild configuration
version: 0.2
phases:
  install:
    runtime-versions:
      nodejs: 18
      docker: 20  # Ensure Docker runtime
  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws
```

### Jenkins

#### Error: Docker Permission Issues

```groovy
// ✅ Proper Jenkins pipeline
pipeline {
    agent {
        docker {
            image 'node:18'
            args '-v /var/run/docker.sock:/var/run/docker.sock'
        }
    }
    stages {
        stage('Deploy') {
            steps {
                sh 'npm ci'
                sh 'npx cdk deploy'
            }
        }
    }
}
```

## Performance Issues

### Slow Layer Creation

**Symptoms:**
- First deployment takes 5+ minutes
- Docker operations timeout

**Resolution:**

1. **Pre-warm Docker Cache:**
```bash
# In CI/CD pre-build step
docker pull public.ecr.aws/lambda/nodejs:18-x86_64
docker pull public.ecr.aws/lambda/nodejs:20-x86_64
docker pull public.ecr.aws/lambda/nodejs:22-x86_64
```

2. **Use Faster Build Agents:**
   - Increase CPU/memory allocation
   - Use SSD storage
   - Ensure good network connectivity

3. **Implement Caching:**
```yaml
# GitHub Actions example
- name: Cache Docker images
  uses: actions/cache@v3
  with:
    path: /tmp/.buildx-cache
    key: ${{ runner.os }}-buildx-${{ github.sha }}
    restore-keys: |
      ${{ runner.os }}-buildx-
```

### Memory Issues

**Symptoms:**
- Docker operations fail with OOM
- Build process crashes

**Resolution:**

1. **Increase Memory Limits:**
```bash
# Docker daemon configuration
echo '{"default-ulimits":{"memlock":{"Hard":-1,"Name":"memlock","Soft":-1}}}' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

2. **Monitor Resource Usage:**
```bash
docker stats
free -h
df -h
```

## Debugging Tools

### Enable Debug Logging

```typescript
import { createDefaultLogger } from '@lambdakata/cdk';

kata(myFunction, {
  logger: createDefaultLogger('debug'),
});
```

### Manual Layer Operations

```bash
# List all layers
aws lambda list-layers

# Get layer details
aws lambda get-layer-version \
  --layer-name lambda-kata-nodejs-nodejs20.x-x86_64 \
  --version-number 1

# Download layer for inspection
aws lambda get-layer-version \
  --layer-name lambda-kata-nodejs-nodejs20.x-x86_64 \
  --version-number 1 \
  --query 'Content.Location' \
  --output text | xargs curl -o layer.zip
```

### Docker Debugging

```bash
# Test Node.js version detection manually
docker run --rm public.ecr.aws/lambda/nodejs:20-x86_64 node --version

# Inspect Docker image
docker run -it --rm public.ecr.aws/lambda/nodejs:20-x86_64 /bin/bash

# Check Docker logs
docker logs $(docker ps -q)
```

## Environment-Specific Solutions

### Corporate Networks

**Common Issues:**
- Proxy configuration
- Certificate validation
- Firewall restrictions

**Solutions:**

1. **Configure Proxy:**
```bash
export HTTP_PROXY=http://proxy.company.com:8080
export HTTPS_PROXY=http://proxy.company.com:8080
export NO_PROXY=localhost,127.0.0.1,.company.com
```

2. **Certificate Issues:**
```bash
# Add corporate certificates
export NODE_EXTRA_CA_CERTS=/path/to/corporate-certs.pem
```

3. **Docker Proxy:**
```json
// ~/.docker/config.json
{
  "proxies": {
    "default": {
      "httpProxy": "http://proxy.company.com:8080",
      "httpsProxy": "http://proxy.company.com:8080"
    }
  }
}
```

### Air-Gapped Environments

**Limitations:**
- Cannot access `public.ecr.aws`
- No automatic version detection

**Workarounds:**

1. **Use Fallback Mode**: System automatically falls back to known versions
2. **Mirror Registry**: Set up internal Docker registry mirror
3. **Pre-built Layers**: Create layers manually in connected environment

## Getting Help

### Before Contacting Support

1. **Collect Debug Information:**
```bash
# System information
docker --version
aws --version
node --version
npm --version

# Error logs
npx cdk deploy --verbose 2>&1 | tee deploy.log

# Layer status
aws lambda list-layers --query 'Layers[?starts_with(LayerName, `lambda-kata-nodejs`)]'
```

2. **Test Minimal Example:**
```typescript
// Minimal reproduction case
const testFunction = new NodejsFunction(this, 'TestFunction', {
  entry: 'test/handler.ts',
  runtime: Runtime.NODEJS_20_X,
});

kata(testFunction);
```

### Support Channels

1. **GitHub Issues**: [Report bugs and feature requests](https://github.com/lambda-kata/cdk/issues)
2. **Community Discussions**: [Community support](https://github.com/lambda-kata/cdk/discussions)
3. **Enterprise Support**: [raman@worktif.com](mailto:raman@worktif.com)

### Information to Include

- Error messages (full stack trace)
- System information (OS, Docker version, AWS CLI version)
- CDK code (minimal reproduction case)
- Environment details (CI/CD platform, network configuration)
- Debug logs (with sensitive information redacted)

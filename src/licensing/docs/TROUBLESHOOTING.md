# Troubleshooting Guide

**Validates: Requirement 12.3**

This guide provides comprehensive troubleshooting procedures for common issues encountered with the Native Licensing Validator, including build problems, deployment issues, runtime errors, and performance concerns.

## Quick Diagnosis

### Health Check Commands

```bash
# Check if native addon is available
node -e "
try {
  const addon = require('./build/Release/native_licensing_validator.node');
  console.log('✅ Native addon loaded successfully');
  console.log('Exports:', Object.keys(addon));
} catch (error) {
  console.log('❌ Native addon failed to load:', error.message);
}
"

# Check TypeScript wrapper
node -e "
try {
  const { NativeLicensingService } = require('./out/dist/index.js');
  const service = new NativeLicensingService();
  console.log('✅ TypeScript wrapper loaded successfully');
} catch (error) {
  console.log('❌ TypeScript wrapper failed to load:', error.message);
}
"

# Test basic functionality
node -e "
const { NativeLicensingService } = require('./out/dist/index.js');
const service = new NativeLicensingService();
service.checkEntitlement('123456789012').then(result => {
  console.log('✅ Basic functionality test passed');
  console.log('Result:', result);
}).catch(error => {
  console.log('❌ Basic functionality test failed:', error.message);
});
"
```

### Environment Information

```bash
# System information
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"
echo "Platform: $(node -p 'process.platform')"
echo "Architecture: $(node -p 'process.arch')"
echo "Node.js executable: $(which node)"

# Build environment
echo "GCC version: $(gcc --version | head -1)"
echo "Python version: $(python3 --version)"
echo "node-gyp version: $(node-gyp --version)"

# Library availability
pkg-config --exists libcurl && echo "✅ libcurl available" || echo "❌ libcurl missing"
pkg-config --exists openssl && echo "✅ openssl available" || echo "❌ openssl missing"
pkg-config --exists json-c && echo "✅ json-c available" || echo "❌ json-c missing"
```

## Build Issues

### Issue: Native Addon Build Fails

**Symptoms**:
```
gyp ERR! build error
gyp ERR! stack Error: `make` failed with exit code: 2
```

**Diagnosis**:
```bash
# Check build dependencies
npm run build:native 2>&1 | tee build.log
grep -i error build.log
```

**Solutions**:

#### Missing Build Tools
```bash
# Amazon Linux 2023
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y gcc gcc-c++ make

# Ubuntu/Debian
sudo apt update
sudo apt install -y build-essential

# macOS
xcode-select --install
```

#### Missing Libraries
```bash
# Amazon Linux 2023
sudo dnf install -y libcurl-devel openssl-devel json-c-devel

# Ubuntu/Debian
sudo apt install -y libcurl4-openssl-dev libssl-dev libjson-c-dev

# CentOS/RHEL
sudo yum install -y libcurl-devel openssl-devel json-c-devel
```

#### Node.js Version Incompatibility
```bash
# Check Node.js version
node --version

# Install compatible version (18.0.0+)
nvm install 20
nvm use 20

# Or update system Node.js
sudo dnf install -y nodejs npm  # Amazon Linux
sudo apt install -y nodejs npm  # Ubuntu
```

#### Python Version Issues
```bash
# Check Python version
python3 --version

# Set Python path for node-gyp
export PYTHON=/usr/bin/python3
npm config set python /usr/bin/python3

# Install Python development headers
sudo dnf install -y python3-devel  # Amazon Linux
sudo apt install -y python3-dev    # Ubuntu
```

### Issue: Docker Build Fails

**Symptoms**:
```
docker: Error response from daemon: failed to create shim task
```

**Diagnosis**:
```bash
# Check Docker status
docker info
docker version

# Check available space
df -h
docker system df
```

**Solutions**:

#### Docker Daemon Issues
```bash
# Restart Docker daemon
sudo systemctl restart docker

# Check Docker logs
sudo journalctl -u docker.service -f
```

#### Insufficient Disk Space
```bash
# Clean Docker cache
docker system prune -a

# Remove unused images
docker image prune -a

# Check available space
df -h /var/lib/docker
```

#### Architecture Mismatch
```bash
# Check supported architectures
docker buildx ls

# Enable multi-architecture support
docker buildx create --use --name multiarch
docker buildx inspect --bootstrap
```

### Issue: Linking Errors

**Symptoms**:
```
/usr/bin/ld: cannot find -lcurl
/usr/bin/ld: cannot find -lssl
```

**Diagnosis**:
```bash
# Check library locations
find /usr -name "libcurl*" 2>/dev/null
find /usr -name "libssl*" 2>/dev/null
pkg-config --libs libcurl openssl
```

**Solutions**:

#### Library Path Issues
```bash
# Set library paths
export LDFLAGS="-L/usr/lib64 -L/usr/local/lib"
export PKG_CONFIG_PATH="/usr/lib64/pkgconfig:/usr/local/lib/pkgconfig"

# For Ubuntu/Debian
export LDFLAGS="-L/usr/lib/x86_64-linux-gnu"
export PKG_CONFIG_PATH="/usr/lib/x86_64-linux-gnu/pkgconfig"
```

#### Development Package Missing
```bash
# Install development packages
sudo dnf install -y libcurl-devel openssl-devel  # Amazon Linux
sudo apt install -y libcurl4-openssl-dev libssl-dev  # Ubuntu
```

## Runtime Issues

### Issue: Native Addon Loading Fails

**Symptoms**:
```javascript
Error: Cannot find module './build/Release/native_licensing_validator.node'
```

**Diagnosis**:
```bash
# Check if addon exists
ls -la build/Release/native_licensing_validator.node

# Check file permissions
stat build/Release/native_licensing_validator.node

# Check binary compatibility
file build/Release/native_licensing_validator.node
ldd build/Release/native_licensing_validator.node
```

**Solutions**:

#### File Not Found
```bash
# Rebuild native addon
npm run build:native

# Check build output
ls -la build/Release/
```

#### Permission Issues
```bash
# Fix permissions
chmod 755 build/Release/native_licensing_validator.node

# Check ownership
ls -la build/Release/native_licensing_validator.node
```

#### Architecture Mismatch
```bash
# Check binary architecture
file build/Release/native_licensing_validator.node

# Expected output for x64:
# native_licensing_validator.node: ELF 64-bit LSB shared object, x86-64

# Expected output for arm64:
# native_licensing_validator.node: ELF 64-bit LSB shared object, aarch64
```

#### Missing Dependencies
```bash
# Check dynamic dependencies
ldd build/Release/native_licensing_validator.node

# Install missing libraries
sudo dnf install -y libcurl openssl-libs json-c  # Amazon Linux
sudo apt install -y libcurl4 libssl3 libjson-c5  # Ubuntu
```

### Issue: Licensing Validation Fails

**Symptoms**:
```javascript
{
  entitled: false,
  message: "Network error"
}
```

**Diagnosis**:
```bash
# Test network connectivity
curl -v https://licensing.lambdakata.com/v1/license/check

# Check DNS resolution
nslookup licensing.lambdakata.com

# Test with verbose logging
NODE_ENV=development node -e "
const { NativeLicensingService } = require('./out/dist/index.js');
const service = new NativeLicensingService();
service.checkEntitlement('123456789012').then(console.log);
"
```

**Solutions**:

#### Network Connectivity Issues
```bash
# Check internet connectivity
ping -c 4 8.8.8.8

# Check DNS resolution
dig licensing.lambdakata.com

# Test HTTPS connectivity
openssl s_client -connect licensing.lambdakata.com:443 -servername licensing.lambdakata.com
```

#### Firewall/Proxy Issues
```bash
# Check proxy settings
echo $HTTP_PROXY
echo $HTTPS_PROXY
echo $NO_PROXY

# Test without proxy
unset HTTP_PROXY HTTPS_PROXY
```

#### TLS/SSL Issues
```bash
# Check TLS version support
openssl version

# Test TLS connection
openssl s_client -connect licensing.lambdakata.com:443 -tls1_2
```

### Issue: Performance Problems

**Symptoms**:
- Slow licensing validation (>5 seconds)
- High memory usage
- Addon loading timeouts

**Diagnosis**:
```bash
# Memory usage monitoring
node --max-old-space-size=128 -e "
const { NativeLicensingService } = require('./out/dist/index.js');
const service = new NativeLicensingService();
console.log('Initial memory:', process.memoryUsage());
service.checkEntitlement('123456789012').then(() => {
  console.log('Final memory:', process.memoryUsage());
});
"

# Timing analysis
time node -e "
const { NativeLicensingService } = require('./out/dist/index.js');
const service = new NativeLicensingService();
service.checkEntitlement('123456789012').then(console.log);
"
```

**Solutions**:

#### Memory Optimization
```bash
# Check for memory leaks
valgrind --tool=memcheck --leak-check=full node -e "
const { NativeLicensingService } = require('./out/dist/index.js');
const service = new NativeLicensingService();
service.checkEntitlement('123456789012').then(() => process.exit(0));
"

# Optimize build flags
export CFLAGS="-O3 -march=native"
export CXXFLAGS="-O3 -march=native"
npm run build:native
```

#### Network Optimization
```bash
# Test with connection reuse
node -e "
const { NativeLicensingService } = require('./out/dist/index.js');
const service = new NativeLicensingService();
Promise.all([
  service.checkEntitlement('123456789012'),
  service.checkEntitlement('123456789012'),
  service.checkEntitlement('123456789012')
]).then(results => {
  console.log('All requests completed');
  console.log(results);
});
"
```

## Lambda Layer Issues

### Issue: Layer Deployment Fails

**Symptoms**:
```
An error occurred (InvalidParameterValueException) when calling the PublishLayerVersion operation
```

**Diagnosis**:
```bash
# Check layer size
ls -lh build/native-licensing-validator-*.zip

# Check layer structure
unzip -l build/native-licensing-validator-amd64.zip | head -20

# Validate zip integrity
unzip -t build/native-licensing-validator-amd64.zip
```

**Solutions**:

#### Layer Size Too Large
```bash
# Check current size
du -sh build/layer-*

# Optimize layer size
strip --strip-unneeded build/*/build/Release/native_licensing_validator.node

# Remove unnecessary files
find build/layer-* -name "*.md" -delete
find build/layer-* -name "test" -type d -exec rm -rf {} +
```

#### Invalid Layer Structure
```bash
# Verify layer structure
unzip -l build/native-licensing-validator-amd64.zip | grep -E "(nodejs/|node_modules/)"

# Rebuild layer with correct structure
./scripts/package-layer.sh amd64
```

#### Permission Issues
```bash
# Check AWS credentials
aws sts get-caller-identity

# Check IAM permissions
aws iam simulate-principal-policy \
    --policy-source-arn $(aws sts get-caller-identity --query Arn --output text) \
    --action-names lambda:PublishLayerVersion \
    --resource-arns "arn:aws:lambda:us-east-1:*:layer:*"
```

### Issue: Layer Loading in Lambda

**Symptoms**:
```
Runtime.ImportModuleError: Error: Cannot find module '@lambda-kata/licensing'
```

**Diagnosis**:
```bash
# Test layer locally
mkdir -p test-layer/opt
unzip build/native-licensing-validator-amd64.zip -d test-layer/opt/

# Test module loading
NODE_PATH=test-layer/opt/nodejs/node_modules node -e "
console.log(require('@lambda-kata/licensing'));
"
```

**Solutions**:

#### Module Path Issues
```javascript
// In Lambda function, check module paths
console.log('NODE_PATH:', process.env.NODE_PATH);
console.log('Module paths:', require('module').globalPaths);
console.log('Layer contents:', require('fs').readdirSync('/opt'));
```

#### Layer Architecture Mismatch
```bash
# Check function architecture
aws lambda get-function --function-name YOUR_FUNCTION --query 'Configuration.Architectures'

# Use matching layer
# For x86_64 functions: use native-licensing-validator-x64 layer
# For arm64 functions: use native-licensing-validator-arm64 layer
```

#### Layer Version Issues
```bash
# Check layer versions
aws lambda list-layer-versions --layer-name native-licensing-validator-x64

# Update function to use correct version
aws lambda update-function-configuration \
    --function-name YOUR_FUNCTION \
    --layers "arn:aws:lambda:REGION:ACCOUNT:layer:native-licensing-validator-x64:VERSION"
```

## Development Issues

### Issue: TypeScript Compilation Fails

**Symptoms**:
```
error TS2307: Cannot find module '@lambda-kata/licensing'
```

**Diagnosis**:
```bash
# Check TypeScript configuration
cat tsconfig.json

# Check build output
ls -la out/dist/
ls -la out/tsc/
```

**Solutions**:

#### Missing Build Output
```bash
# Build TypeScript
npm run build:ts
npm run build:types

# Verify output
ls -la out/dist/index.js
ls -la out/tsc/index.d.ts
```

#### Type Definition Issues
```bash
# Check type definitions
cat out/tsc/index.d.ts

# Rebuild types
npm run build:types
```

### Issue: Test Failures

**Symptoms**:
```
FAIL test/native-licensing-validator.test.ts
```

**Diagnosis**:
```bash
# Run tests with verbose output
npm test -- --verbose

# Run specific test file
npm test -- test/native-licensing-validator.test.ts

# Check test environment
NODE_ENV=test npm test
```

**Solutions**:

#### Test Environment Issues
```bash
# Set up test environment
export NODE_ENV=test
export MOCK_LICENSING_SERVICE=true

# Run tests
npm test
```

#### Mock Service Issues
```bash
# Check mock server
node -e "
const { MockLicensingService } = require('./test/mocks/mock-licensing-service');
const service = new MockLicensingService();
console.log('Mock service created');
"
```

## Production Issues

### Issue: High Error Rate in Lambda

**Symptoms**:
- Increased error rate in CloudWatch metrics
- "Native validator unavailable" messages in logs

**Diagnosis**:
```bash
# Check CloudWatch logs
aws logs filter-log-events \
    --log-group-name "/aws/lambda/YOUR_FUNCTION" \
    --filter-pattern "ERROR" \
    --start-time $(date -d '1 hour ago' +%s)000

# Check function configuration
aws lambda get-function --function-name YOUR_FUNCTION
```

**Solutions**:

#### Layer Loading Issues
```javascript
// Add diagnostic logging to Lambda function
console.log('Layer path:', process.env.LAMBDA_TASK_ROOT);
console.log('Available layers:', process.env.AWS_LAMBDA_RUNTIME_API);

try {
    const addon = require('@lambda-kata/licensing');
    console.log('Native validator loaded successfully');
} catch (error) {
    console.error('Native validator loading failed:', error);
    // Fallback to HTTP validator
}
```

#### Memory/Timeout Issues
```bash
# Increase Lambda memory
aws lambda update-function-configuration \
    --function-name YOUR_FUNCTION \
    --memory-size 512

# Increase timeout
aws lambda update-function-configuration \
    --function-name YOUR_FUNCTION \
    --timeout 30
```

### Issue: Performance Degradation

**Symptoms**:
- Increased duration in CloudWatch metrics
- Timeout errors

**Diagnosis**:
```bash
# Analyze performance metrics
aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name Duration \
    --dimensions Name=FunctionName,Value=YOUR_FUNCTION \
    --start-time $(date -d '24 hours ago' --iso-8601) \
    --end-time $(date --iso-8601) \
    --period 3600 \
    --statistics Average,Maximum
```

**Solutions**:

#### Cold Start Optimization
```javascript
// Initialize service outside handler
const { NativeLicensingService } = require('@lambda-kata/licensing');
const service = new NativeLicensingService();

exports.handler = async (event) => {
    // Service already initialized
    const result = await service.checkEntitlement(accountId);
    return result;
};
```

#### Connection Pooling
```javascript
// Enable connection reuse
process.env.AWS_NODEJS_CONNECTION_REUSE_ENABLED = '1';
```

## Diagnostic Tools

### Log Analysis Script

```bash
#!/bin/bash
# analyze-logs.sh

FUNCTION_NAME=$1
HOURS_BACK=${2:-1}

if [ -z "$FUNCTION_NAME" ]; then
    echo "Usage: $0 <function-name> [hours-back]"
    exit 1
fi

echo "Analyzing logs for $FUNCTION_NAME (last $HOURS_BACK hours)"

# Get recent error logs
aws logs filter-log-events \
    --log-group-name "/aws/lambda/$FUNCTION_NAME" \
    --filter-pattern "ERROR" \
    --start-time $(date -d "$HOURS_BACK hours ago" +%s)000 \
    --query 'events[*].[timestamp,message]' \
    --output table

# Get native validator specific logs
aws logs filter-log-events \
    --log-group-name "/aws/lambda/$FUNCTION_NAME" \
    --filter-pattern "native" \
    --start-time $(date -d "$HOURS_BACK hours ago" +%s)000 \
    --query 'events[*].[timestamp,message]' \
    --output table
```

### Health Check Script

```javascript
// health-check.js
const { NativeLicensingService } = require('@lambda-kata/licensing');

async function healthCheck() {
    console.log('Starting health check...');
    
    try {
        // Test service creation
        const service = new NativeLicensingService();
        console.log('✅ Service created successfully');
        
        // Test basic functionality
        const result = await service.checkEntitlement('123456789012');
        console.log('✅ Basic functionality test passed');
        console.log('Result:', result);
        
        // Test error handling
        try {
            await service.checkEntitlement('invalid');
        } catch (error) {
            console.log('✅ Error handling test passed');
        }
        
        console.log('Health check completed successfully');
        
    } catch (error) {
        console.error('❌ Health check failed:', error);
        process.exit(1);
    }
}

healthCheck();
```

### Performance Benchmark Script

```javascript
// benchmark.js
const { NativeLicensingService } = require('@lambda-kata/licensing');

async function benchmark() {
    const service = new NativeLicensingService();
    const iterations = 100;
    const accountId = '123456789012';
    
    console.log(`Running benchmark with ${iterations} iterations...`);
    
    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    
    const promises = [];
    for (let i = 0; i < iterations; i++) {
        promises.push(service.checkEntitlement(accountId));
    }
    
    const results = await Promise.all(promises);
    
    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    
    const duration = endTime - startTime;
    const avgDuration = duration / iterations;
    const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;
    
    console.log(`Total duration: ${duration}ms`);
    console.log(`Average per request: ${avgDuration.toFixed(2)}ms`);
    console.log(`Memory delta: ${(memoryDelta / 1024 / 1024).toFixed(2)}MB`);
    console.log(`Success rate: ${results.filter(r => r.entitled !== undefined).length}/${iterations}`);
}

benchmark().catch(console.error);
```

## Getting Help

### Information to Collect

When reporting issues, please provide:

1. **Environment Information**:
   ```bash
   node --version
   npm --version
   uname -a
   ```

2. **Build Information**:
   ```bash
   npm run build:native 2>&1 | tail -50
   file build/Release/native_licensing_validator.node
   ldd build/Release/native_licensing_validator.node
   ```

3. **Error Logs**:
   ```bash
   NODE_ENV=development npm test 2>&1 | tail -100
   ```

4. **Configuration**:
   ```bash
   cat package.json | grep -A 10 -B 10 "native-licensing-validator"
   cat binding.gyp
   ```

### Support Channels

1. **Documentation**: Check [README.md](../README.md) and other documentation files
2. **GitHub Issues**: Search existing issues and create new ones with detailed information
3. **Community**: Join discussions in the project repository

### Emergency Procedures

If the native validator is causing production issues:

1. **Immediate Fallback**:
   ```javascript
   // Disable native validator temporarily
   process.env.DISABLE_NATIVE_VALIDATOR = 'true';
   ```

2. **Remove Layer**:
   ```bash
   aws lambda update-function-configuration \
       --function-name YOUR_FUNCTION \
       --layers ""
   ```

3. **Rollback to Previous Version**:
   ```bash
   aws lambda update-function-configuration \
       --function-name YOUR_FUNCTION \
       --layers "arn:aws:lambda:REGION:ACCOUNT:layer:native-licensing-validator-x64:PREVIOUS_VERSION"
   ```

Remember: The native validator implements fail-closed behavior, so any issues will result in `{entitled: false}` responses rather than crashes or security vulnerabilities.

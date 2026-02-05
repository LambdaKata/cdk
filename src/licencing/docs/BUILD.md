# Build Instructions

**Validates: Requirement 12.1**

This document provides comprehensive build instructions for the Native Licensing Validator across all supported architectures and environments.

## Overview

The Native Licensing Validator requires compilation for Amazon Linux 2023 to ensure compatibility with AWS Lambda. We support two primary build methods:

- **Docker Build** (Recommended): Cross-platform builds using Amazon Linux 2023 containers
- **Local Build**: Direct compilation on compatible Linux systems

## Supported Architectures

| Architecture | AWS Lambda Support | Docker Platform | Node.js Arch |
|--------------|-------------------|-----------------|--------------|
| linux-x64    | ✅ Yes            | linux/amd64     | x64          |
| linux-arm64  | ✅ Yes            | linux/arm64     | arm64        |

## Prerequisites

### System Requirements

**All Platforms**:
- Node.js 18.0.0 or higher
- npm 8.0.0 or higher
- Git

**Docker Build** (Recommended):
- Docker 20.10.0 or higher
- Docker daemon running
- 4GB available disk space
- Internet connection for base image download

**Local Build** (Amazon Linux 2023 only):
- GCC 11.0 or higher
- libcurl-devel 7.76.0 or higher
- openssl-devel 1.1.1 or higher
- json-c-devel 0.15 or higher
- python3 3.9 or higher
- node-gyp 9.0.0 or higher

### Dependency Installation

#### Amazon Linux 2023
```bash
# Update system packages
sudo dnf update -y

# Install development tools
sudo dnf groupinstall -y "Development Tools"

# Install required libraries
sudo dnf install -y \
    nodejs npm \
    libcurl-devel \
    openssl-devel \
    json-c-devel \
    python3 \
    python3-pip

# Install node-gyp globally
sudo npm install -g node-gyp
```

#### Ubuntu/Debian
```bash
# Update package list
sudo apt update

# Install development tools
sudo apt install -y build-essential

# Install required libraries
sudo apt install -y \
    nodejs npm \
    libcurl4-openssl-dev \
    libssl-dev \
    libjson-c-dev \
    python3 \
    python3-pip

# Install node-gyp globally
sudo npm install -g node-gyp
```

#### macOS (Development Only)
```bash
# Install Xcode command line tools
xcode-select --install

# Install dependencies via Homebrew
brew install node curl openssl json-c python3

# Install node-gyp globally
npm install -g node-gyp
```

**Note**: macOS builds are for development only. Lambda deployment requires Linux builds.

## Docker Build (Recommended)

Docker builds provide consistent, reproducible results across all platforms and are the recommended approach for production Lambda Layers.

### Quick Start

```bash
# Navigate to package directory
cd packages/native-licensing-validator

# Build for all architectures
./scripts/build-docker.sh

# Build for specific architecture
./scripts/build-docker.sh x64     # x64 only
./scripts/build-docker.sh arm64   # arm64 only
```

### Detailed Docker Build Process

#### Step 1: Prepare Build Environment

```bash
# Ensure Docker is running
docker info

# Clean any previous builds
rm -rf build/

# Verify project structure
ls -la binding.gyp native/ src/
```

#### Step 2: Build Native Addon

```bash
# Build for x64 architecture
./scripts/build-docker.sh x64
```

This process:
1. Creates Amazon Linux 2023 container
2. Installs build dependencies
3. Compiles native addon with proper linking
4. Extracts build artifacts
5. Validates binary compatibility

#### Step 3: Verify Build Output

```bash
# Check build artifacts
ls -la build/amd64/build/Release/
file build/amd64/build/Release/native_licensing_validator.node

# Expected output:
# native_licensing_validator.node: ELF 64-bit LSB shared object, x86-64
```

#### Step 4: Package Lambda Layer

```bash
# Package layer for deployment
./scripts/package-layer.sh x64

# Verify layer structure
unzip -l build/native-licensing-validator-amd64.zip | head -20
```

### Docker Build Configuration

The Docker build uses the following configuration:

```dockerfile
FROM amazonlinux:2023

# Install build dependencies
RUN dnf update -y && \
    dnf groupinstall -y "Development Tools" && \
    dnf install -y \
        nodejs npm \
        libcurl-devel \
        openssl-devel \
        json-c-devel \
        python3 \
        python3-pip \
        git

# Security hardening
RUN dnf clean all && \
    rm -rf /var/cache/dnf

# Build configuration
ENV NODE_ENV=production
ENV PYTHON=/usr/bin/python3
```

### Multi-Architecture Build

```bash
# Build for both architectures
./scripts/build-docker.sh all

# Verify both builds
ls -la build/
# Expected:
# build/amd64/build/Release/native_licensing_validator.node
# build/arm64/build/Release/native_licensing_validator.node
# build/native-licensing-validator-amd64.zip
# build/native-licensing-validator-arm64.zip
```

## Local Build

Local builds are faster for development but require a compatible Linux environment.

### Prerequisites Verification

```bash
# Check Node.js version
node --version  # Should be >= 18.0.0

# Check GCC version
gcc --version   # Should be >= 11.0

# Check required libraries
pkg-config --exists libcurl
pkg-config --exists openssl
pkg-config --exists json-c

# Check Python version
python3 --version  # Should be >= 3.9
```

### Build Process

#### Step 1: Install Dependencies

```bash
cd packages/native-licensing-validator

# Install npm dependencies
npm install
```

#### Step 2: Build TypeScript

```bash
# Clean previous builds
npm run build:clean

# Build TypeScript components
npm run build:ts
npm run build:types
```

#### Step 3: Build Native Addon

```bash
# Configure build environment
export CC=gcc
export CXX=g++
export PYTHON=/usr/bin/python3

# Build native addon
npm run build:native

# Alternative: Direct node-gyp build
node-gyp configure build --verbose
```

#### Step 4: Verify Build

```bash
# Check build output
ls -la build/Release/
file build/Release/native_licensing_validator.node

# Test addon loading
node -e "console.log(require('./build/Release/native_licensing_validator.node'))"
```

### Local Build Troubleshooting

**Missing Dependencies**:
```bash
# Error: Package 'libcurl' not found
sudo dnf install libcurl-devel  # Amazon Linux
sudo apt install libcurl4-openssl-dev  # Ubuntu

# Error: Package 'openssl' not found
sudo dnf install openssl-devel  # Amazon Linux
sudo apt install libssl-dev  # Ubuntu
```

**Compilation Errors**:
```bash
# Error: node-gyp not found
npm install -g node-gyp

# Error: Python not found
export PYTHON=/usr/bin/python3
```

**Linking Errors**:
```bash
# Error: cannot find -lcurl
export LDFLAGS="-L/usr/lib64"  # Amazon Linux
export LDFLAGS="-L/usr/lib/x86_64-linux-gnu"  # Ubuntu

# Error: cannot find -lssl
export PKG_CONFIG_PATH="/usr/lib64/pkgconfig"
```

## Complete Build Script

For automated builds, use the comprehensive build script:

```bash
# Full build with all steps
./scripts/build-all.sh

# Build modes
./scripts/build-all.sh deps          # Install dependencies only
./scripts/build-all.sh ts            # Build TypeScript only
./scripts/build-all.sh native-local  # Build native addon locally
./scripts/build-all.sh native-docker # Build native addon with Docker
./scripts/build-all.sh package       # Package Lambda Layers
./scripts/build-all.sh test          # Run tests
./scripts/build-all.sh full          # Complete build (default)

# Architecture-specific builds
./scripts/build-all.sh full x64      # Full build for x64 only
./scripts/build-all.sh full arm64    # Full build for arm64 only
```

## Build Verification

### Automated Verification

```bash
# Run build verification tests
npm run test:build-verification

# Check binary compatibility
npm run test:compatibility
```

### Manual Verification

#### Binary Analysis

```bash
# Check ELF header
readelf -h build/Release/native_licensing_validator.node

# Check dynamic dependencies
ldd build/Release/native_licensing_validator.node

# Expected dependencies (Amazon Linux 2023):
# libcurl.so.4 => /lib64/libcurl.so.4
# libssl.so.3 => /lib64/libssl.so.3
# libcrypto.so.3 => /lib64/libcrypto.so.3
# libc.so.6 => /lib64/libc.so.6
```

#### Functional Testing

```bash
# Test addon loading
node -e "
const addon = require('./build/Release/native_licensing_validator.node');
console.log('Addon loaded successfully');
console.log('Exports:', Object.keys(addon));
"

# Test basic functionality
node -e "
const { NativeLicensingService } = require('./out/dist/index.js');
const service = new NativeLicensingService();
console.log('Service created successfully');
"
```

#### Lambda Layer Testing

```bash
# Extract and test layer
mkdir -p test-layer
unzip build/native-licensing-validator-amd64.zip -d test-layer/

# Verify layer structure
find test-layer -name "*.node" -exec file {} \;

# Test in Lambda-like environment
docker run --rm -v $(pwd)/test-layer:/opt amazonlinux:2023 \
  /bin/bash -c "
    dnf install -y nodejs npm && \
    cd /opt && \
    node -e 'console.log(require(\"./nodejs/node_modules/@lambda-kata/licensing/build/Release/native_licensing_validator.node\"))'
  "
```

## Performance Optimization

### Build Optimization Flags

The build system uses optimized compilation flags:

```gyp
# binding.gyp configuration
'cflags': [
  '-O3',                    # Maximum optimization
  '-march=native',          # Architecture-specific optimizations
  '-flto',                  # Link-time optimization
  '-ffunction-sections',    # Function-level linking
  '-fdata-sections',        # Data-level linking
  '-fvisibility=hidden',    # Symbol visibility
],
'ldflags': [
  '-Wl,--gc-sections',      # Dead code elimination
  '-Wl,--strip-all',        # Strip debug symbols
]
```

### Size Optimization

```bash
# Check binary size
ls -lh build/Release/native_licensing_validator.node

# Strip additional symbols (if needed)
strip --strip-unneeded build/Release/native_licensing_validator.node

# Compress for distribution
gzip -9 build/Release/native_licensing_validator.node
```

## Continuous Integration

### GitHub Actions Configuration

```yaml
name: Build Native Addon

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        arch: [x64, arm64]
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v3
    
    - name: Build for ${{ matrix.arch }}
      run: |
        cd packages/native-licensing-validator
        ./scripts/build-docker.sh ${{ matrix.arch }}
    
    - name: Upload artifacts
      uses: actions/upload-artifact@v4
      with:
        name: native-addon-${{ matrix.arch }}
        path: packages/native-licensing-validator/build/
```

### Build Caching

```bash
# Enable Docker layer caching
export DOCKER_BUILDKIT=1

# Cache npm dependencies
npm ci --cache .npm --prefer-offline

# Cache node-gyp builds
export npm_config_cache=/tmp/.npm
export npm_config_node_gyp=/usr/local/lib/node_modules/node-gyp/bin/node-gyp.js
```

## Security Considerations

### Build Environment Security

- Use official Amazon Linux 2023 base images
- Verify image signatures before use
- Scan dependencies for vulnerabilities
- Use minimal privilege containers
- Clean build artifacts of sensitive data

### Binary Security

```bash
# Check for hardcoded secrets
strings build/Release/native_licensing_validator.node | grep -E "(password|secret|key|token)"

# Verify no debug symbols
objdump -h build/Release/native_licensing_validator.node | grep debug

# Check security features
checksec --file=build/Release/native_licensing_validator.node
```

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for detailed troubleshooting procedures.

## Next Steps

After successful build:

1. **Test the build**: Run the test suite to verify functionality
2. **Deploy Lambda Layer**: Follow [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment procedures
3. **Integration**: Follow [MIGRATION.md](./MIGRATION.md) for integration with existing code

## Build Artifacts

Successful builds produce:

```
build/
├── amd64/
│   └── build/Release/native_licensing_validator.node
├── arm64/
│   └── build/Release/native_licensing_validator.node
├── native-licensing-validator-amd64.zip
├── native-licensing-validator-arm64.zip
└── layer-*/
    └── nodejs/node_modules/@lambda-kata/licensing/
```

These artifacts are ready for Lambda Layer deployment and npm distribution.

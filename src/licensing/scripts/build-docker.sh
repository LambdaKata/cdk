#!/bin/bash
#
# MIT License
#
# Copyright (c) 2024 Lambda Kata Team
#
# Docker-based build script for Amazon Linux 2023 (x64 and arm64)
#
# @remarks Validates: Requirements 7.2, 7.3

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build"
DOCKER_IMAGE="amazonlinux:2023"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is available
check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        exit 1
    fi
}

# Build for specific architecture
build_arch() {
    local arch=$1
    local node_arch=$2

    log_info "Building for architecture: $arch (Node.js: $node_arch)"

    # Create build directory
    mkdir -p "$BUILD_DIR/$arch"

    # Create Dockerfile for this architecture
    cat > "$BUILD_DIR/Dockerfile.$arch" << EOF
FROM --platform=linux/$arch $DOCKER_IMAGE

# Install build dependencies
RUN dnf update -y && \\
    dnf groupinstall -y "Development Tools" && \\
    dnf install -y \\
        nodejs npm \\
        libcurl-devel \\
        openssl-devel \\
        json-c-devel \\
        python3 \\
        python3-pip \\
        git && \\
    dnf clean all

# Install node-gyp globally
RUN npm install -g node-gyp

# Set working directory
WORKDIR /build

# Copy package files
COPY package.json binding.gyp ./
COPY native/ ./native/
COPY src/ ./src/
COPY scripts/ ./scripts/

# Install dependencies
RUN npm install --production=false

# Build native addon
RUN npm run build:native

CMD ["sh", "-c", "mkdir -p /output/build/Release && cp build/Release/*.node /output/build/Release/ && cp -r out/ /output/ 2>/dev/null || true"]
EOF

    # Build Docker image
    log_info "Building Docker image for $arch..."
    docker build --platform=linux/$arch -f "$BUILD_DIR/Dockerfile.$arch" -t "native-validator-builder:$arch" "$PROJECT_DIR"

    # Run container and extract artifacts
    log_info "Extracting build artifacts for $arch..."
    docker run --platform=linux/$arch --rm -v "$BUILD_DIR/$arch:/output" "native-validator-builder:$arch"

    # Verify build output
    if [ -f "$BUILD_DIR/$arch/build/Release/native_licensing_validator.node" ]; then
        log_info "Successfully built native addon for $arch"

        # Show file info
        file "$BUILD_DIR/$arch/build/Release/native_licensing_validator.node" || true
        ls -la "$BUILD_DIR/$arch/build/Release/native_licensing_validator.node"
    else
        log_error "Build failed for $arch - native addon not found"
        return 1
    fi

    # Clean up Docker image
    docker rmi "native-validator-builder:$arch" || true
}

# Package Lambda Layer
package_layer() {
    local arch=$1
    local layer_dir="$BUILD_DIR/layer-$arch"
    local package_dir="$layer_dir/nodejs/node_modules/@lambda-kata/licensing"

    log_info "Packaging Lambda Layer for $arch..."

    # Create layer directory structure following AWS Lambda Layer conventions
    mkdir -p "$package_dir/build/Release"
    mkdir -p "$package_dir/out/dist"
    mkdir -p "$package_dir/out/tsc"

    # Copy native addon with proper permissions
    cp "$BUILD_DIR/$arch/build/Release/native_licensing_validator.node" \
       "$package_dir/build/Release/"

    # Set executable permissions for native addon (required for Lambda)
    chmod 755 "$package_dir/build/Release/native_licensing_validator.node"

    # Copy TypeScript compiled output
    if [ -d "$PROJECT_DIR/out/dist" ]; then
        cp -r "$PROJECT_DIR/out/dist/"* "$package_dir/out/dist/"
    fi

    if [ -d "$PROJECT_DIR/out/tsc" ]; then
        cp -r "$PROJECT_DIR/out/tsc/"* "$package_dir/out/tsc/"
    fi

    # Copy essential files
    cp "$PROJECT_DIR/package.json" "$package_dir/"
    cp "$PROJECT_DIR/README.md" "$package_dir/" 2>/dev/null || true
    cp "$PROJECT_DIR/LICENSE" "$package_dir/" 2>/dev/null || true

    # Create a minimal package.json for the layer (production dependencies only)
    cat > "$package_dir/package.json" << EOF
{
    "name": "@lambda-kata/licensing",
    "version": "$(node -p "require('$PROJECT_DIR/package.json').version")",
    "description": "Tamper-resistant native licensing validator for Lambda Kata SST Integration",
    "main": "out/dist/index.js",
    "types": "out/tsc/index.d.ts",
    "license": "MIT",
    "engines": {
        "node": ">=18.0.0"
    },
    "gypfile": true,
    "binary": {
        "napi_versions": [8, 9]
    }
}
EOF

    # Verify layer structure
    log_info "Verifying layer structure..."
    if [ ! -f "$package_dir/build/Release/native_licensing_validator.node" ]; then
        log_error "Native addon missing from layer"
        return 1
    fi

    if [ ! -f "$package_dir/out/dist/index.js" ]; then
        log_warn "TypeScript output missing from layer - building now..."
        cd "$PROJECT_DIR"
        npm run build:ts || log_error "Failed to build TypeScript"
        cd - > /dev/null

        # Retry copying TypeScript output
        if [ -d "$PROJECT_DIR/out/dist" ]; then
            cp -r "$PROJECT_DIR/out/dist/"* "$package_dir/out/dist/"
        fi
    fi

    # Show layer contents for verification
    log_info "Layer contents:"
    find "$layer_dir" -type f -exec ls -la {} \; | head -20

    # Create layer zip with proper compression
    cd "$layer_dir"
    zip -r9 "../native-licensing-validator-$arch.zip" . -x "*.DS_Store" "*/.*"
    cd - > /dev/null

    # Verify zip file
    local zip_size=$(stat -f%z "$BUILD_DIR/native-licensing-validator-$arch.zip" 2>/dev/null || stat -c%s "$BUILD_DIR/native-licensing-validator-$arch.zip")
    log_info "Lambda Layer packaged: $BUILD_DIR/native-licensing-validator-$arch.zip (${zip_size} bytes)"

    # Test zip integrity
    if ! unzip -t "$BUILD_DIR/native-licensing-validator-$arch.zip" > /dev/null 2>&1; then
        log_error "Layer zip file is corrupted"
        return 1
    fi

    log_info "Layer zip integrity verified"
}

# Main execution
main() {
    local target_arch="${1:-all}"

    log_info "Starting Docker-based build for Amazon Linux 2023"
    log_info "Target architecture: $target_arch"

    check_docker

    # Clean build directory
    rm -rf "$BUILD_DIR"
    mkdir -p "$BUILD_DIR"

    case "$target_arch" in
        "x64"|"amd64")
            build_arch "amd64" "x64"
            package_layer "amd64"
            ;;
        "arm64"|"aarch64")
            build_arch "arm64" "arm64"
            package_layer "arm64"
            ;;
        "all")
            build_arch "amd64" "x64"
            package_layer "amd64"

            build_arch "arm64" "arm64"
            package_layer "arm64"
            ;;
        *)
            log_error "Unsupported architecture: $target_arch"
            log_error "Supported architectures: x64, arm64, all"
            exit 1
            ;;
    esac

    log_info "Build complete!"
    log_info "Artifacts available in: $BUILD_DIR"
}

# Show usage if no arguments
if [ $# -eq 0 ]; then
    echo "Usage: $0 [x64|arm64|all]"
    echo ""
    echo "Build native licensing validator for Amazon Linux 2023"
    echo ""
    echo "Arguments:"
    echo "  x64     Build for x64 architecture only"
    echo "  arm64   Build for arm64 architecture only"
    echo "  all     Build for both architectures (default)"
    echo ""
    echo "Examples:"
    echo "  $0 x64      # Build for x64 only"
    echo "  $0 arm64    # Build for arm64 only"
    echo "  $0          # Build for all architectures"
    exit 0
fi

main "$@"

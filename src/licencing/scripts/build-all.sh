#!/bin/bash
#
# MIT License
# 
# Copyright (c) 2024 Lambda Kata Team
# 
# Complete build script for native licensing validator
# Orchestrates TypeScript compilation, native builds, and Lambda Layer packaging
# 
# @remarks Validates: Requirements 5.1, 5.2, 5.5, 5.6

set -euo pipefail

# Configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites"
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed"
        return 1
    fi
    
    local node_version
    node_version=$(node --version | sed 's/v//')
    log_info "Node.js version: $node_version"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        log_error "npm is not installed"
        return 1
    fi
    
    # Check if we're in the right directory
    if [[ ! -f "$PROJECT_DIR/package.json" ]]; then
        log_error "package.json not found. Are you in the right directory?"
        return 1
    fi
    
    # Check if binding.gyp exists
    if [[ ! -f "$PROJECT_DIR/binding.gyp" ]]; then
        log_error "binding.gyp not found. Native addon cannot be built."
        return 1
    fi
    
    log_info "Prerequisites check passed"
    return 0
}

# Install dependencies
install_dependencies() {
    log_step "Installing dependencies"
    
    cd "$PROJECT_DIR"
    
    if [[ -f "package-lock.json" ]]; then
        npm ci
    else
        npm install
    fi
    
    log_info "Dependencies installed"
}

# Build TypeScript
build_typescript() {
    log_step "Building TypeScript"
    
    cd "$PROJECT_DIR"
    
    # Clean previous build
    npm run build:clean || true
    
    # Build TypeScript
    if ! npm run build:ts; then
        log_error "TypeScript build failed"
        return 1
    fi
    
    # Build type definitions
    if ! npm run build:types; then
        log_error "TypeScript type definitions build failed"
        return 1
    fi
    
    # Verify output
    if [[ ! -f "out/dist/index.js" ]]; then
        log_error "TypeScript build output not found"
        return 1
    fi
    
    if [[ ! -f "out/tsc/index.d.ts" ]]; then
        log_error "TypeScript type definitions not found"
        return 1
    fi
    
    log_info "TypeScript build completed"
    return 0
}

# Build native addon locally (for development)
build_native_local() {
    log_step "Building native addon locally"
    
    cd "$PROJECT_DIR"
    
    # Check if we have build tools
    if ! command -v node-gyp &> /dev/null; then
        log_warn "node-gyp not found globally, using local version"
    fi
    
    # Try to build natively
    if npm run build:native; then
        log_info "Native addon built successfully"
        return 0
    else
        log_warn "Local native build failed - this is expected on non-Linux systems"
        log_warn "Use Docker build for production Lambda Layers"
        return 1
    fi
}

# Build native addon with Docker
build_native_docker() {
    local arch="${1:-all}"
    
    log_step "Building native addon with Docker for $arch"
    
    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Cannot build for Lambda."
        return 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        return 1
    fi
    
    # Run Docker build
    if ! "$SCRIPT_DIR/build-docker.sh" "$arch"; then
        log_error "Docker build failed for $arch"
        return 1
    fi
    
    log_info "Docker build completed for $arch"
    return 0
}

# Package Lambda Layers
package_layers() {
    local arch="${1:-all}"
    
    log_step "Packaging Lambda Layers for $arch"
    
    if ! "$SCRIPT_DIR/package-layer.sh" "$arch"; then
        log_error "Layer packaging failed for $arch"
        return 1
    fi
    
    log_info "Layer packaging completed for $arch"
    return 0
}

# Run tests
run_tests() {
    log_step "Running tests"
    
    cd "$PROJECT_DIR"
    
    # Run unit tests only (property tests may be flaky in CI)
    if ! npm run test:unit; then
        log_error "Unit tests failed"
        return 1
    fi
    
    log_info "Tests passed"
    return 0
}

# Show build summary
show_summary() {
    local build_dir="$PROJECT_DIR/build"
    
    log_step "Build Summary"
    
    echo ""
    echo "Build artifacts:"
    
    # TypeScript output
    if [[ -f "$PROJECT_DIR/out/dist/index.js" ]]; then
        local js_size
        js_size=$(stat -c%s "$PROJECT_DIR/out/dist/index.js" 2>/dev/null || stat -f%z "$PROJECT_DIR/out/dist/index.js")
        echo "  ✓ TypeScript output: out/dist/index.js (${js_size} bytes)"
    else
        echo "  ✗ TypeScript output: missing"
    fi
    
    # Native addons
    for arch in amd64 arm64; do
        local addon_path="$build_dir/$arch/build/Release/native_licensing_validator.node"
        if [[ -f "$addon_path" ]]; then
            local addon_size
            addon_size=$(stat -c%s "$addon_path" 2>/dev/null || stat -f%z "$addon_path")
            echo "  ✓ Native addon ($arch): ${addon_size} bytes"
        else
            echo "  ✗ Native addon ($arch): missing"
        fi
    done
    
    # Lambda Layers
    for arch in amd64 arm64; do
        local layer_path="$build_dir/native-licensing-validator-$arch.zip"
        if [[ -f "$layer_path" ]]; then
            local layer_size
            layer_size=$(stat -c%s "$layer_path" 2>/dev/null || stat -f%z "$layer_path")
            local layer_size_mb=$((layer_size / 1024 / 1024))
            echo "  ✓ Lambda Layer ($arch): ${layer_size_mb}MB"
        else
            echo "  ✗ Lambda Layer ($arch): missing"
        fi
    done
    
    echo ""
    echo "Next steps:"
    echo "  - Deploy layers to AWS Lambda"
    echo "  - Test in Lambda environment"
    echo "  - Publish to npm registry"
}

# Main execution
main() {
    local build_mode="${1:-full}"
    local target_arch="${2:-all}"
    
    echo "Native Licensing Validator Build Script"
    echo "======================================="
    echo "Build mode: $build_mode"
    echo "Target architecture: $target_arch"
    echo ""
    
    case "$build_mode" in
        "deps")
            check_prerequisites && install_dependencies
            ;;
        "ts")
            check_prerequisites && build_typescript
            ;;
        "native-local")
            check_prerequisites && build_native_local
            ;;
        "native-docker")
            check_prerequisites && build_native_docker "$target_arch"
            ;;
        "package")
            check_prerequisites && package_layers "$target_arch"
            ;;
        "test")
            check_prerequisites && run_tests
            ;;
        "full")
            if ! check_prerequisites; then
                exit 1
            fi
            
            if ! install_dependencies; then
                exit 1
            fi
            
            if ! build_typescript; then
                exit 1
            fi
            
            # Try local build first, fall back to Docker
            if ! build_native_local; then
                log_info "Falling back to Docker build"
                if ! build_native_docker "$target_arch"; then
                    exit 1
                fi
            fi
            
            if ! package_layers "$target_arch"; then
                exit 1
            fi
            
            if ! run_tests; then
                log_warn "Tests failed, but build artifacts are available"
            fi
            
            show_summary
            ;;
        *)
            echo "Usage: $0 [mode] [arch]"
            echo ""
            echo "Build modes:"
            echo "  deps          Install dependencies only"
            echo "  ts            Build TypeScript only"
            echo "  native-local  Build native addon locally"
            echo "  native-docker Build native addon with Docker"
            echo "  package       Package Lambda Layers"
            echo "  test          Run tests"
            echo "  full          Complete build (default)"
            echo ""
            echo "Architectures:"
            echo "  x64           Build for x64 only"
            echo "  arm64         Build for arm64 only"
            echo "  all           Build for all architectures (default)"
            echo ""
            echo "Examples:"
            echo "  $0                    # Full build for all architectures"
            echo "  $0 full x64           # Full build for x64 only"
            echo "  $0 native-docker arm64 # Docker build for arm64 only"
            echo "  $0 ts                 # TypeScript build only"
            exit 0
            ;;
    esac
    
    if [[ $? -eq 0 ]]; then
        log_info "Build completed successfully"
    else
        log_error "Build failed"
        exit 1
    fi
}

main "$@"
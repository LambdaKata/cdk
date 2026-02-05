#!/bin/bash
#
# MIT License
#
# Copyright (c) 2024 Lambda Kata Team
#
# Lambda Layer packaging script for native licensing validator
#
# @remarks Validates: Requirements 5.1, 5.2, 5.5

set -euo pipefail

# Configuration constants
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
readonly BUILD_DIR="$PROJECT_DIR/build"

# Layer structure constants (AWS Lambda Layer conventions)
readonly LAYER_NODEJS_PATH="nodejs/node_modules/@lambda-kata/licensing"
readonly REQUIRED_PERMISSIONS=755
readonly MAX_LAYER_SIZE_MB=250

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Validate prerequisites
validate_prerequisites() {
    local arch=$1

    # Check if native addon exists
    if [[ ! -f "$BUILD_DIR/$arch/build/Release/native_licensing_validator.node" ]]; then
        log_error "Native addon not found for $arch: $BUILD_DIR/$arch/build/Release/native_licensing_validator.node"
        return 1
    fi

    # Check if TypeScript output exists
    if [[ ! -f "$PROJECT_DIR/out/dist/index.js" ]]; then
        log_error "TypeScript output not found: $PROJECT_DIR/out/dist/index.js"
        log_error "Run 'npm run build:ts' first"
        return 1
    fi

    # Check if package.json exists
    if [[ ! -f "$PROJECT_DIR/package.json" ]]; then
        log_error "package.json not found: $PROJECT_DIR/package.json"
        return 1
    fi

    return 0
}

# Create layer directory structure
create_layer_structure() {
    local arch=$1
    local layer_dir="$BUILD_DIR/layer-$arch"
    local package_dir="$layer_dir/$LAYER_NODEJS_PATH"

    log_info "Creating layer structure for $arch"

    # Remove existing layer directory
    rm -rf "$layer_dir"

    # Create directory structure
    mkdir -p "$package_dir/build/Release"
    mkdir -p "$package_dir/out/dist"
    mkdir -p "$package_dir/out/tsc"

    echo "$layer_dir"
}

# Copy and validate native addon
copy_native_addon() {
    local arch=$1
    local package_dir=$2
    local source_addon="$BUILD_DIR/$arch/build/Release/native_licensing_validator.node"
    local target_addon="$package_dir/build/Release/native_licensing_validator.node"

    log_info "Copying native addon for $arch"

    # Copy with preservation of metadata
    cp "$source_addon" "$target_addon"

    # Set required permissions (Lambda requires 755 for .node files)
    chmod $REQUIRED_PERMISSIONS "$target_addon"

    # Verify permissions
    local actual_perms=$(stat -c "%a" "$target_addon" 2>/dev/null || stat -f "%A" "$target_addon" | tail -c 4)
    if [[ "$actual_perms" != "$REQUIRED_PERMISSIONS" ]]; then
        log_error "Failed to set permissions on native addon: expected $REQUIRED_PERMISSIONS, got $actual_perms"
        return 1
    fi

    # Verify file is executable
    if [[ ! -x "$target_addon" ]]; then
        log_error "Native addon is not executable: $target_addon"
        return 1
    fi

    log_info "Native addon copied with correct permissions ($REQUIRED_PERMISSIONS)"
    return 0
}

# Copy TypeScript output
copy_typescript_output() {
    local package_dir=$1

    log_info "Copying TypeScript output"

    # Copy compiled JavaScript
    if [[ -d "$PROJECT_DIR/out/dist" ]]; then
        cp -r "$PROJECT_DIR/out/dist/"* "$package_dir/out/dist/"
    else
        log_error "TypeScript dist output not found"
        return 1
    fi

    # Copy type definitions
    if [[ -d "$PROJECT_DIR/out/tsc" ]]; then
        cp -r "$PROJECT_DIR/out/tsc/"* "$package_dir/out/tsc/"
    else
        log_warn "TypeScript declaration output not found"
    fi

    return 0
}

# Create production package.json
create_production_package_json() {
    local package_dir=$1
    local version

    # Extract version from main package.json
    version=$(node -p "require('$PROJECT_DIR/package.json').version" 2>/dev/null || echo "1.0.0")

    log_info "Creating production package.json (version: $version)"

    # Create minimal package.json for Lambda Layer
    cat > "$package_dir/package.json" << EOF
{
    "name": "@lambda-kata/licensing",
    "version": "$version",
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

    return 0
}

# Validate layer structure
validate_layer_structure() {
    local layer_dir=$1
    local package_dir="$layer_dir/$LAYER_NODEJS_PATH"

    log_info "Validating layer structure"

    # Check required files exist
    local required_files=(
        "$package_dir/build/Release/native_licensing_validator.node"
        "$package_dir/out/dist/index.js"
        "$package_dir/package.json"
    )

    for file in "${required_files[@]}"; do
        if [[ ! -f "$file" ]]; then
            log_error "Required file missing: $file"
            return 1
        fi
    done

    # Check native addon permissions
    local addon_perms=$(stat -c "%a" "$package_dir/build/Release/native_licensing_validator.node" 2>/dev/null || stat -f "%A" "$package_dir/build/Release/native_licensing_validator.node" | tail -c 4)
    if [[ "$addon_perms" != "$REQUIRED_PERMISSIONS" ]]; then
        log_error "Native addon has incorrect permissions: $addon_perms (expected $REQUIRED_PERMISSIONS)"
        return 1
    fi

    log_info "Layer structure validation passed"
    return 0
}

# Create and validate zip file
create_layer_zip() {
    local arch=$1
    local layer_dir=$2
    local zip_file="$BUILD_DIR/native-licensing-validator-$arch.zip"

    log_info "Creating layer zip for $arch"

    # Create zip with optimal compression, excluding system files
    cd "$layer_dir"
    zip -r9 "$zip_file" . -x "*.DS_Store" "*/.*" "__pycache__/*" "*.pyc"
    cd - > /dev/null

    # Validate zip integrity
    if ! unzip -t "$zip_file" > /dev/null 2>&1; then
        log_error "Layer zip file is corrupted: $zip_file"
        return 1
    fi

    # Check zip size
    local zip_size_bytes
    zip_size_bytes=$(stat -c%s "$zip_file" 2>/dev/null || stat -f%z "$zip_file")
    local zip_size_mb=$((zip_size_bytes / 1024 / 1024))

    if [[ $zip_size_mb -gt $MAX_LAYER_SIZE_MB ]]; then
        log_error "Layer zip too large: ${zip_size_mb}MB (max: ${MAX_LAYER_SIZE_MB}MB)"
        return 1
    fi

    log_info "Layer zip created: $zip_file (${zip_size_mb}MB)"

    # Show zip contents for verification
    log_info "Layer zip contents:"
    unzip -l "$zip_file" | head -20

    return 0
}

# Package layer for specific architecture
package_layer_arch() {
    local arch=$1

    log_info "Packaging Lambda Layer for $arch"

    # Validate prerequisites
    if ! validate_prerequisites "$arch"; then
        return 1
    fi

    # Create layer structure
    local layer_dir
    layer_dir=$(create_layer_structure "$arch")
    local package_dir="$layer_dir/$LAYER_NODEJS_PATH"

    # Copy components
    if ! copy_native_addon "$arch" "$package_dir"; then
        return 1
    fi

    if ! copy_typescript_output "$package_dir"; then
        return 1
    fi

    if ! create_production_package_json "$package_dir"; then
        return 1
    fi

    # Validate structure
    if ! validate_layer_structure "$layer_dir"; then
        return 1
    fi

    # Create zip
    if ! create_layer_zip "$arch" "$layer_dir"; then
        return 1
    fi

    log_info "Successfully packaged layer for $arch"
    return 0
}

# Main execution
main() {
    local target_arch="${1:-all}"

    log_info "Lambda Layer packaging script"
    log_info "Target architecture: $target_arch"

    case "$target_arch" in
        "x64"|"amd64")
            package_layer_arch "amd64"
            ;;
        "arm64"|"aarch64")
            package_layer_arch "arm64"
            ;;
        "all")
            if ! package_layer_arch "amd64"; then
                log_error "Failed to package layer for amd64"
                exit 1
            fi

            if ! package_layer_arch "arm64"; then
                log_error "Failed to package layer for arm64"
                exit 1
            fi
            ;;
        *)
            log_error "Unsupported architecture: $target_arch"
            log_error "Supported architectures: x64, arm64, all"
            exit 1
            ;;
    esac

    log_info "Layer packaging complete!"
    log_info "Artifacts available in: $BUILD_DIR"
}

# Show usage if no arguments
if [[ $# -eq 0 ]]; then
    echo "Usage: $0 [x64|arm64|all]"
    echo ""
    echo "Package native licensing validator into AWS Lambda Layers"
    echo ""
    echo "Arguments:"
    echo "  x64     Package for x64 architecture only"
    echo "  arm64   Package for arm64 architecture only"
    echo "  all     Package for both architectures (default)"
    echo ""
    echo "Prerequisites:"
    echo "  - Native addon must be built (run build-docker.sh first)"
    echo "  - TypeScript must be compiled (npm run build:ts)"
    echo ""
    echo "Examples:"
    echo "  $0 x64      # Package for x64 only"
    echo "  $0 arm64    # Package for arm64 only"
    echo "  $0          # Package for all architectures"
    exit 0
fi

main "$@"

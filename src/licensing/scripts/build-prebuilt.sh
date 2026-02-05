#!/bin/bash
#
# MIT License
#
# Copyright (c) 2024 Lambda Kata Team
#
# Build prebuilt binaries for npm distribution
#
# @remarks Validates: Requirements 5.6

set -euo pipefail

# Configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
readonly BUILD_DIR="$PROJECT_DIR/build"
readonly PREBUILT_DIR="$PROJECT_DIR/prebuilt"

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

# Build TypeScript first
build_typescript() {
    log_step "Building TypeScript"

    cd "$PROJECT_DIR"

    # Clean and build TypeScript
    npm run build:clean || true
    npm run build:ts
    npm run build:types

    # Verify output
    if [[ ! -f "out/dist/index.js" ]]; then
        log_error "TypeScript build failed - index.js not found"
        return 1
    fi

    if [[ ! -f "out/tsc/index.d.ts" ]]; then
        log_error "TypeScript build failed - index.d.ts not found"
        return 1
    fi

    log_info "TypeScript build completed"
}

# Build native addons using Docker
build_native_addons() {
    log_step "Building native addons"

    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        log_error "Docker is required for building prebuilt binaries"
        return 1
    fi

    # Build for all architectures
    if ! "$SCRIPT_DIR/build-docker.sh" all; then
        log_error "Docker build failed"
        return 1
    fi

    # Verify build outputs
    for arch in amd64 arm64; do
        local addon_path="$BUILD_DIR/$arch/build/Release/native_licensing_validator.node"
        if [[ ! -f "$addon_path" ]]; then
            log_error "Native addon not found for $arch: $addon_path"
            return 1
        fi

        local addon_size
        addon_size=$(stat -c%s "$addon_path" 2>/dev/null || stat -f%z "$addon_path")
        log_info "Native addon for $arch: ${addon_size} bytes"
    done

    log_info "Native addon build completed"
}

# Create prebuilt directory structure
create_prebuilt_structure() {
    log_step "Creating prebuilt directory structure"

    # Clean prebuilt directory
    rm -rf "$PREBUILT_DIR"
    mkdir -p "$PREBUILT_DIR"

    # Create architecture-specific directories
    for arch in amd64 arm64; do
        local arch_dir="$PREBUILT_DIR/$arch"
        mkdir -p "$arch_dir/build/Release"

        # Copy native addon
        local source_addon="$BUILD_DIR/$arch/build/Release/native_licensing_validator.node"
        local target_addon="$arch_dir/build/Release/native_licensing_validator.node"

        if [[ -f "$source_addon" ]]; then
            cp "$source_addon" "$target_addon"
            chmod 755 "$target_addon"
            log_info "Copied prebuilt binary for $arch"
        else
            log_warn "Prebuilt binary not available for $arch"
        fi
    done

    log_info "Prebuilt directory structure created"
}

# Update package.json for prebuilt distribution
update_package_json() {
    log_step "Updating package.json for prebuilt distribution"

    # Create a backup
    cp "$PROJECT_DIR/package.json" "$PROJECT_DIR/package.json.backup"

    # Update files array to include prebuilt binaries
    local temp_package
    temp_package=$(mktemp)

    node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('$PROJECT_DIR/package.json', 'utf8'));

        // Update files array
        pkg.files = pkg.files || [];
        if (!pkg.files.includes('prebuilt/')) {
            pkg.files.push('prebuilt/');
        }

        // Ensure scripts are present
        pkg.scripts = pkg.scripts || {};
        pkg.scripts.install = pkg.scripts.install || 'node scripts/install.js';
        pkg.scripts.postinstall = pkg.scripts.postinstall || 'node scripts/postinstall.js || echo \"Postinstall script failed, using fallback mode\"';

        // Update binary configuration
        pkg.binary = pkg.binary || {};
        pkg.binary.napi_versions = [8, 9];

        // Add os/cpu restrictions for Lambda
        pkg.os = ['linux'];
        pkg.cpu = ['x64', 'arm64'];

        fs.writeFileSync('$temp_package', JSON.stringify(pkg, null, 4));
    "

    # Replace package.json
    mv "$temp_package" "$PROJECT_DIR/package.json"

    log_info "package.json updated for prebuilt distribution"
}

# Create npm package tarball
create_npm_package() {
    log_step "Creating npm package"

    cd "$PROJECT_DIR"

    # Create package tarball
    npm pack

    # Find the created tarball
    local tarball
    tarball=$(ls -t lambda-kata-native-licensing-validator-*.tgz 2>/dev/null | head -1 || echo "")

    if [[ -n "$tarball" && -f "$tarball" ]]; then
        local tarball_size
        tarball_size=$(stat -c%s "$tarball" 2>/dev/null || stat -f%z "$tarball")
        local tarball_size_mb=$((tarball_size / 1024 / 1024))

        log_info "npm package created: $tarball (${tarball_size_mb}MB)"

        # Move to build directory
        mv "$tarball" "$BUILD_DIR/"

        # Show package contents
        log_info "Package contents:"
        tar -tzf "$BUILD_DIR/$tarball" | head -20

        return 0
    else
        log_error "Failed to create npm package"
        return 1
    fi
}

# Test package installation
test_package_installation() {
    log_step "Testing package installation"

    local test_dir
    test_dir=$(mktemp -d)

    cd "$test_dir"

    # Initialize test package
    npm init -y > /dev/null

    # Install from tarball
    local tarball
    tarball=$(ls "$BUILD_DIR"/lambda-kata-native-licensing-validator-*.tgz | head -1)

    if [[ -z "$tarball" ]]; then
        log_error "No package tarball found for testing"
        rm -rf "$test_dir"
        return 1
    fi

    log_info "Testing installation from: $(basename "$tarball")"

    if npm install "$tarball" --silent; then
        log_info "Package installation successful"

        # Test require
        if node -e "
            try {
                const validator = require('@lambda-kata/licensing');
                console.log('✓ Module loaded successfully');
                console.log('✓ Exports:', Object.keys(validator));
                process.exit(0);
            } catch (error) {
                console.error('✗ Module load failed:', error.message);
                process.exit(1);
            }
        "; then
            log_info "Package require test successful"
        else
            log_error "Package require test failed"
            rm -rf "$test_dir"
            return 1
        fi
    else
        log_error "Package installation failed"
        rm -rf "$test_dir"
        return 1
    fi

    # Clean up
    rm -rf "$test_dir"

    log_info "Package installation test completed"
}

# Generate distribution report
generate_report() {
    log_step "Generating distribution report"

    local report_file="$BUILD_DIR/distribution-report.txt"

    cat > "$report_file" << EOF
Native Licensing Validator - Distribution Report
===============================================
Generated: $(date)
Build Directory: $BUILD_DIR

Package Artifacts:
EOF

    # List tarballs
    for tarball in "$BUILD_DIR"/lambda-kata-native-licensing-validator-*.tgz; do
        if [[ -f "$tarball" ]]; then
            local size
            size=$(stat -c%s "$tarball" 2>/dev/null || stat -f%z "$tarball")
            local size_mb=$((size / 1024 / 1024))
            echo "  ✓ $(basename "$tarball"): ${size_mb}MB" >> "$report_file"
        fi
    done

    # List prebuilt binaries
    echo "" >> "$report_file"
    echo "Prebuilt Binaries:" >> "$report_file"

    for arch in amd64 arm64; do
        local addon_path="$PREBUILT_DIR/$arch/build/Release/native_licensing_validator.node"
        if [[ -f "$addon_path" ]]; then
            local size
            size=$(stat -c%s "$addon_path" 2>/dev/null || stat -f%z "$addon_path")
            local size_kb=$((size / 1024))
            echo "  ✓ $arch: ${size_kb}KB" >> "$report_file"
        else
            echo "  ✗ $arch: missing" >> "$report_file"
        fi
    done

    cat >> "$report_file" << EOF

Publishing Instructions:
1. Test the package locally: npm install ./build/lambda-kata-native-licensing-validator-*.tgz
2. Publish to npm registry: npm publish ./build/lambda-kata-native-licensing-validator-*.tgz
3. Verify published package: npm info @lambda-kata/licensing

Installation Commands:
npm install @lambda-kata/licensing
EOF

    log_info "Distribution report generated: $report_file"
}

# Main execution
main() {
    local build_mode="${1:-full}"

    echo "Native Licensing Validator - Prebuilt Distribution Build"
    echo "======================================================="
    echo "Build mode: $build_mode"
    echo ""

    case "$build_mode" in
        "ts")
            build_typescript
            ;;
        "native")
            build_native_addons
            ;;
        "package")
            create_prebuilt_structure
            update_package_json
            create_npm_package
            ;;
        "test")
            test_package_installation
            ;;
        "full")
            if ! build_typescript; then
                exit 1
            fi

            if ! build_native_addons; then
                exit 1
            fi

            if ! create_prebuilt_structure; then
                exit 1
            fi

            if ! update_package_json; then
                exit 1
            fi

            if ! create_npm_package; then
                exit 1
            fi

            if ! test_package_installation; then
                log_warn "Package installation test failed, but artifacts are available"
            fi

            generate_report
            ;;
        *)
            echo "Usage: $0 [mode]"
            echo ""
            echo "Build modes:"
            echo "  ts        Build TypeScript only"
            echo "  native    Build native addons only"
            echo "  package   Create npm package only"
            echo "  test      Test package installation"
            echo "  full      Complete build (default)"
            echo ""
            echo "Examples:"
            echo "  $0              # Full build"
            echo "  $0 ts           # TypeScript only"
            echo "  $0 package      # Package only"
            exit 0
            ;;
    esac

    if [[ $? -eq 0 ]]; then
        log_info "Prebuilt distribution build completed successfully"
    else
        log_error "Prebuilt distribution build failed"
        exit 1
    fi
}

main "$@"

#!/bin/bash
#
# MIT License
#
# Copyright (c) 2024 Lambda Kata Team
#
# Manual deployment testing script
# Tests Lambda Layer deployment in various scenarios
#
# @remarks Validates: Requirements 5.5

set -euo pipefail

# Configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
readonly BUILD_DIR="$PROJECT_DIR/build"

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

# Test layer structure
test_layer_structure() {
    local arch=$1
    local layer_zip="$BUILD_DIR/native-licensing-validator-$arch.zip"

    log_step "Testing layer structure for $arch"

    if [[ ! -f "$layer_zip" ]]; then
        log_error "Layer zip not found: $layer_zip"
        return 1
    fi

    # Create temporary directory
    local temp_dir
    temp_dir=$(mktemp -d)

    # Extract layer
    cd "$temp_dir"
    unzip -q "$layer_zip"

    # Check structure
    local package_dir="nodejs/node_modules/@lambda-kata/licensing"

    if [[ ! -d "$package_dir" ]]; then
        log_error "Package directory not found: $package_dir"
        rm -rf "$temp_dir"
        return 1
    fi

    # Check required files
    local required_files=(
        "$package_dir/package.json"
        "$package_dir/out/dist/index.js"
        "$package_dir/build/Release/native_licensing_validator.node"
    )

    for file in "${required_files[@]}"; do
        if [[ ! -f "$file" ]]; then
            log_error "Required file missing: $file"
            rm -rf "$temp_dir"
            return 1
        fi
    done

    # Check native addon permissions
    local addon_file="$package_dir/build/Release/native_licensing_validator.node"
    local perms
    perms=$(stat -c "%a" "$addon_file" 2>/dev/null || stat -f "%A" "$addon_file" | tail -c 4)

    if [[ "$perms" != "755" ]]; then
        log_error "Native addon has incorrect permissions: $perms (expected 755)"
        rm -rf "$temp_dir"
        return 1
    fi

    # Check package.json validity
    if ! node -e "JSON.parse(require('fs').readFileSync('$package_dir/package.json', 'utf8'))" 2>/dev/null; then
        log_error "Invalid package.json"
        rm -rf "$temp_dir"
        return 1
    fi

    # Clean up
    rm -rf "$temp_dir"

    log_info "Layer structure test passed for $arch"
    return 0
}

# Test layer loading
test_layer_loading() {
    local arch=$1
    local layer_zip="$BUILD_DIR/native-licensing-validator-$arch.zip"

    log_step "Testing layer loading for $arch"

    if [[ ! -f "$layer_zip" ]]; then
        log_error "Layer zip not found: $layer_zip"
        return 1
    fi

    # Create Lambda-like environment
    local lambda_dir
    lambda_dir=$(mktemp -d)
    local opt_dir="$lambda_dir/opt"
    local task_dir="$lambda_dir/var/task"

    mkdir -p "$opt_dir" "$task_dir"

    # Extract layer to /opt
    cd "$opt_dir"
    unzip -q "$layer_zip"

    # Create test handler
    cat > "$task_dir/test-handler.js" << 'EOF'
const path = require('path');

// Simulate Lambda environment
process.env.NODE_PATH = '/opt/nodejs/node_modules';
require('module').Module._initPaths();

exports.handler = async (event, context) => {
    try {
        console.log('Loading native licensing validator...');
        const validator = require('@lambda-kata/licensing');

        console.log('Module loaded successfully');
        console.log('Available exports:', Object.keys(validator));

        // Test service instantiation
        if (validator.NativeLicensingService) {
            console.log('Creating native service instance...');
            const service = new validator.NativeLicensingService();
            console.log('Native service created successfully');

            // Test with invalid account ID (should fail gracefully)
            try {
                const result = await service.checkEntitlement('invalid-account');
                console.log('Service call result:', result);
            } catch (error) {
                console.log('Expected error for invalid input:', error.message);
            }
        } else {
            console.log('Native service not available (fallback mode)');
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Layer loading test successful',
                exports: Object.keys(validator)
            })
        };
    } catch (error) {
        console.error('Error loading module:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message,
                stack: error.stack
            })
        };
    }
};
EOF

    # Test the handler
    cd "$task_dir"

    local test_result
    if test_result=$(timeout 30s node -e "
        const handler = require('./test-handler.js');
        handler.handler({}, {})
            .then(result => {
                console.log('Handler result:', JSON.stringify(result, null, 2));
                process.exit(result.statusCode === 200 ? 0 : 1);
            })
            .catch(error => {
                console.error('Handler error:', error);
                process.exit(1);
            });
    " 2>&1); then
        log_info "Layer loading test passed for $arch"
        echo "$test_result" | grep -E "(Layer loading test successful|Native service|Module loaded)" || true
    else
        log_error "Layer loading test failed for $arch"
        echo "$test_result"
        rm -rf "$lambda_dir"
        return 1
    fi

    # Clean up
    rm -rf "$lambda_dir"
    return 0
}

# Test layer size limits
test_layer_size() {
    local arch=$1
    local layer_zip="$BUILD_DIR/native-licensing-validator-$arch.zip"

    log_step "Testing layer size limits for $arch"

    if [[ ! -f "$layer_zip" ]]; then
        log_error "Layer zip not found: $layer_zip"
        return 1
    fi

    local zip_size
    zip_size=$(stat -c%s "$layer_zip" 2>/dev/null || stat -f%z "$layer_zip")
    local zip_size_mb=$((zip_size / 1024 / 1024))

    log_info "Layer zip size: ${zip_size_mb}MB"

    # AWS Lambda limits
    if [[ $zip_size_mb -gt 50 ]]; then
        log_error "Layer zip too large: ${zip_size_mb}MB (AWS limit: 50MB compressed)"
        return 1
    fi

    # Estimate uncompressed size
    local temp_dir
    temp_dir=$(mktemp -d)
    cd "$temp_dir"
    unzip -q "$layer_zip"

    local uncompressed_size
    uncompressed_size=$(du -sm . | cut -f1)

    log_info "Estimated uncompressed size: ${uncompressed_size}MB"

    if [[ $uncompressed_size -gt 250 ]]; then
        log_error "Layer uncompressed too large: ${uncompressed_size}MB (AWS limit: 250MB uncompressed)"
        rm -rf "$temp_dir"
        return 1
    fi

    rm -rf "$temp_dir"

    log_info "Layer size test passed for $arch"
    return 0
}

# Test cross-architecture compatibility
test_cross_arch() {
    log_step "Testing cross-architecture compatibility"

    local architectures=("amd64" "arm64")
    local available_layers=()

    # Check which layers are available
    for arch in "${architectures[@]}"; do
        local layer_zip="$BUILD_DIR/native-licensing-validator-$arch.zip"
        if [[ -f "$layer_zip" ]]; then
            available_layers+=("$arch")
        fi
    done

    if [[ ${#available_layers[@]} -eq 0 ]]; then
        log_error "No layer zips found"
        return 1
    fi

    log_info "Available layers: ${available_layers[*]}"

    # If we have both architectures, compare them
    if [[ ${#available_layers[@]} -eq 2 ]]; then
        local amd64_size arm64_size
        amd64_size=$(stat -c%s "$BUILD_DIR/native-licensing-validator-amd64.zip" 2>/dev/null || stat -f%z "$BUILD_DIR/native-licensing-validator-amd64.zip")
        arm64_size=$(stat -c%s "$BUILD_DIR/native-licensing-validator-arm64.zip" 2>/dev/null || stat -f%z "$BUILD_DIR/native-licensing-validator-arm64.zip")

        log_info "AMD64 layer size: $((amd64_size / 1024 / 1024))MB"
        log_info "ARM64 layer size: $((arm64_size / 1024 / 1024))MB"

        # Sizes should be reasonably similar but not identical
        local size_diff=$((amd64_size > arm64_size ? amd64_size - arm64_size : arm64_size - amd64_size))
        local avg_size=$(((amd64_size + arm64_size) / 2))
        local relative_diff=$((size_diff * 100 / avg_size))

        log_info "Size difference: ${relative_diff}%"

        # Allow up to 50% difference (native addons can vary significantly)
        if [[ $relative_diff -gt 50 ]]; then
            log_warn "Large size difference between architectures: ${relative_diff}%"
        fi
    fi

    log_info "Cross-architecture test passed"
    return 0
}

# Generate deployment report
generate_report() {
    log_step "Generating deployment report"

    local report_file="$BUILD_DIR/deployment-report.txt"

    cat > "$report_file" << EOF
Native Licensing Validator - Deployment Report
==============================================
Generated: $(date)
Build Directory: $BUILD_DIR

Layer Artifacts:
EOF

    for arch in amd64 arm64; do
        local layer_zip="$BUILD_DIR/native-licensing-validator-$arch.zip"
        if [[ -f "$layer_zip" ]]; then
            local size
            size=$(stat -c%s "$layer_zip" 2>/dev/null || stat -f%z "$layer_zip")
            local size_mb=$((size / 1024 / 1024))
            echo "  ✓ $arch: ${size_mb}MB" >> "$report_file"
        else
            echo "  ✗ $arch: missing" >> "$report_file"
        fi
    done

    cat >> "$report_file" << EOF

Deployment Instructions:
1. Upload layer zips to AWS Lambda
2. Create Lambda Layer versions
3. Attach layers to Lambda functions
4. Test in Lambda environment

AWS CLI Commands:
EOF

    for arch in amd64 arm64; do
        local layer_zip="$BUILD_DIR/native-licensing-validator-$arch.zip"
        if [[ -f "$layer_zip" ]]; then
            local aws_arch
            aws_arch=$([ "$arch" = "amd64" ] && echo "x86_64" || echo "arm64")

            cat >> "$report_file" << EOF

# Create layer for $arch
aws lambda publish-layer-version \\
    --layer-name native-licensing-validator-$arch \\
    --description "Native licensing validator for Lambda Kata ($arch)" \\
    --zip-file fileb://$layer_zip \\
    --compatible-runtimes nodejs18.x nodejs20.x \\
    --compatible-architectures $aws_arch
EOF
        fi
    done

    log_info "Deployment report generated: $report_file"
}

# Main execution
main() {
    local test_mode="${1:-all}"

    echo "Native Licensing Validator - Deployment Testing"
    echo "==============================================="
    echo "Test mode: $test_mode"
    echo ""

    # Check if build directory exists
    if [[ ! -d "$BUILD_DIR" ]]; then
        log_error "Build directory not found: $BUILD_DIR"
        log_error "Run build scripts first"
        exit 1
    fi

    local success=true

    case "$test_mode" in
        "structure")
            for arch in amd64 arm64; do
                if ! test_layer_structure "$arch"; then
                    success=false
                fi
            done
            ;;
        "loading")
            for arch in amd64 arm64; do
                if ! test_layer_loading "$arch"; then
                    success=false
                fi
            done
            ;;
        "size")
            for arch in amd64 arm64; do
                if ! test_layer_size "$arch"; then
                    success=false
                fi
            done
            ;;
        "cross-arch")
            if ! test_cross_arch; then
                success=false
            fi
            ;;
        "all")
            for arch in amd64 arm64; do
                if ! test_layer_structure "$arch"; then
                    success=false
                fi

                if ! test_layer_loading "$arch"; then
                    success=false
                fi

                if ! test_layer_size "$arch"; then
                    success=false
                fi
            done

            if ! test_cross_arch; then
                success=false
            fi

            generate_report
            ;;
        *)
            echo "Usage: $0 [test_mode]"
            echo ""
            echo "Test modes:"
            echo "  structure   Test layer directory structure"
            echo "  loading     Test layer loading in Lambda-like environment"
            echo "  size        Test layer size limits"
            echo "  cross-arch  Test cross-architecture compatibility"
            echo "  all         Run all tests and generate report (default)"
            echo ""
            echo "Examples:"
            echo "  $0              # Run all tests"
            echo "  $0 structure    # Test structure only"
            echo "  $0 loading      # Test loading only"
            exit 0
            ;;
    esac

    echo ""
    if [[ "$success" == "true" ]]; then
        log_info "All deployment tests passed!"
        exit 0
    else
        log_error "Some deployment tests failed"
        exit 1
    fi
}

main "$@"

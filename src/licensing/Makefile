# Makefile for Native Licensing Validator
# Unified build orchestration for native addon development and distribution
#
# MIT License
# Copyright (c) 2024 Lambda Kata Team

.PHONY: help clean install build build-ts build-native build-docker build-prebuilt test lint package publish

# Configuration
NODE := node
NPM := npm
DOCKER := docker
ARCH ?= all

# Directories
BUILD_DIR := build
OUT_DIR := out
PREBUILT_DIR := prebuilt

# Colors for output
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[1;33m
BLUE := \033[0;34m
NC := \033[0m

# Default target
help:
	@echo "Native Licensing Validator - Build System"
	@echo "=========================================="
	@echo ""
	@echo "Development targets:"
	@echo "  make install          Install dependencies"
	@echo "  make build            Full development build (TS + native)"
	@echo "  make build-ts         Build TypeScript only"
	@echo "  make build-native     Build native addon locally"
	@echo "  make test             Run all tests"
	@echo "  make test-unit        Run unit tests only"
	@echo "  make test-property    Run property-based tests only"
	@echo "  make lint             Run linter"
	@echo "  make clean            Clean build artifacts"
	@echo ""
	@echo "Production targets:"
	@echo "  make build-docker     Build native addon with Docker (for Lambda)"
	@echo "  make build-prebuilt   Build prebuilt binaries for npm distribution"
	@echo "  make package          Create npm package tarball"
	@echo "  make publish          Publish to npm registry"
	@echo ""
	@echo "Architecture options:"
	@echo "  make build-docker ARCH=x64     Build for x64 only"
	@echo "  make build-docker ARCH=arm64   Build for arm64 only"
	@echo "  make build-docker ARCH=all     Build for all (default)"
	@echo ""

# Clean build artifacts
clean:
	@echo "$(BLUE)[CLEAN]$(NC) Removing build artifacts"
	@rm -rf $(BUILD_DIR) $(OUT_DIR) $(PREBUILT_DIR)
	@rm -f *.tgz
	@echo "$(GREEN)[DONE]$(NC) Clean completed"

# Install dependencies
install:
	@echo "$(BLUE)[INSTALL]$(NC) Installing dependencies"
	@$(NPM) install
	@echo "$(GREEN)[DONE]$(NC) Dependencies installed"

# Build TypeScript
build-ts: clean
	@echo "$(BLUE)[BUILD-TS]$(NC) Building TypeScript"
	@$(NPM) run build:ts
	@$(NPM) run build:types
	@echo "$(GREEN)[DONE]$(NC) TypeScript build completed"

# Build native addon locally (development)
build-native:
	@echo "$(BLUE)[BUILD-NATIVE]$(NC) Building native addon locally"
	@$(NPM) run build:native || echo "$(YELLOW)[WARN]$(NC) Local build failed - use Docker for Lambda"
	@echo "$(GREEN)[DONE]$(NC) Native build completed"

# Full development build
build: build-ts build-native
	@echo "$(GREEN)[DONE]$(NC) Full development build completed"

# Build native addon with Docker (for Lambda)
build-docker:
	@echo "$(BLUE)[BUILD-DOCKER]$(NC) Building native addon with Docker for $(ARCH)"
	@if ! command -v $(DOCKER) >/dev/null 2>&1; then \
		echo "$(RED)[ERROR]$(NC) Docker is not installed"; \
		exit 1; \
	fi
	@./scripts/build-docker.sh $(ARCH)
	@echo "$(GREEN)[DONE]$(NC) Docker build completed"

# Build prebuilt binaries for npm distribution
build-prebuilt: build-ts build-docker
	@echo "$(BLUE)[BUILD-PREBUILT]$(NC) Building prebuilt binaries"
	@./scripts/build-prebuilt.sh full
	@echo "$(GREEN)[DONE]$(NC) Prebuilt binaries ready"

# Run all tests
test:
	@echo "$(BLUE)[TEST]$(NC) Running all tests"
	@$(NPM) run test
	@echo "$(GREEN)[DONE]$(NC) Tests completed"

# Run unit tests only
test-unit:
	@echo "$(BLUE)[TEST-UNIT]$(NC) Running unit tests"
	@$(NPM) run test:unit
	@echo "$(GREEN)[DONE]$(NC) Unit tests completed"

# Run property-based tests only
test-property:
	@echo "$(BLUE)[TEST-PROPERTY]$(NC) Running property-based tests"
	@$(NPM) run test:property
	@echo "$(GREEN)[DONE]$(NC) Property tests completed"

# Run tests with coverage
test-coverage:
	@echo "$(BLUE)[TEST-COVERAGE]$(NC) Running tests with coverage"
	@$(NPM) run test:coverage
	@echo "$(GREEN)[DONE]$(NC) Coverage report generated"

# Run linter
lint:
	@echo "$(BLUE)[LINT]$(NC) Running linter"
	@$(NPM) run lint
	@echo "$(GREEN)[DONE]$(NC) Linting completed"

# Fix linting issues
lint-fix:
	@echo "$(BLUE)[LINT-FIX]$(NC) Fixing linting issues"
	@$(NPM) run lint:fix
	@echo "$(GREEN)[DONE]$(NC) Linting fixes applied"

# Create npm package tarball
package: build-prebuilt
	@echo "$(BLUE)[PACKAGE]$(NC) Creating npm package"
	@$(NPM) pack
	@echo "$(GREEN)[DONE]$(NC) Package created"

# Publish to npm registry
publish: package
	@echo "$(BLUE)[PUBLISH]$(NC) Publishing to npm registry"
	@echo "$(YELLOW)[WARN]$(NC) This will publish to npm. Press Ctrl+C to cancel."
	@sleep 3
	@$(NPM) publish --access public
	@echo "$(GREEN)[DONE]$(NC) Published to npm"

# Verify package contents
verify-package:
	@echo "$(BLUE)[VERIFY]$(NC) Verifying package contents"
	@if [ -f *.tgz ]; then \
		tar -tzf *.tgz | grep -E '\.(node|js|d\.ts)$$' || true; \
		echo ""; \
		echo "Checking for unwanted files:"; \
		tar -tzf *.tgz | grep -E '\.(c|h|sh)$$' && echo "$(RED)[ERROR]$(NC) Source files found in package!" || echo "$(GREEN)[OK]$(NC) No source files in package"; \
	else \
		echo "$(RED)[ERROR]$(NC) No package tarball found. Run 'make package' first."; \
	fi

# Development workflow
dev: clean install build test
	@echo "$(GREEN)[DONE]$(NC) Development build and test completed"

# Production workflow
prod: clean install build-prebuilt test package verify-package
	@echo "$(GREEN)[DONE]$(NC) Production build completed"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Test package: npm install ./lambda-kata-licensing-*.tgz"
	@echo "  2. Publish: make publish"

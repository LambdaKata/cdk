# Native Licensing Validator - Packaging Strategy

## Problem Statement

**Why C source files should NOT be in npm package:**

1. **Security & IP Protection**: C source code reveals implementation details of licensing validation logic, including:
   - SPKI pinning implementation
   - Network security hardening
   - Cache invalidation strategies
   - Memory optimization techniques

2. **Attack Surface**: Shipping source code allows attackers to:
   - Analyze validation logic for bypass opportunities
   - Identify timing attack vectors
   - Reverse-engineer security mechanisms

3. **Package Size**: Source files (C, TypeScript, build configs) add unnecessary bloat:
   - `native/*.c` + `native/include/*.h`: ~50KB
   - `src/*.ts`: ~20KB
   - `binding.gyp`, `Makefile`, build scripts: ~30KB
   - Total waste: ~100KB per package

4. **No Compilation Needed**: Users should receive prebuilt binaries, not source:
   - Faster installation (no node-gyp rebuild)
   - No build toolchain required (gcc, make, python)
   - Consistent binaries across environments

## Solution: Prebuilt-Only Distribution

### What Gets Published to npm

```
@lambda-kata/licensing/
├── out/                          # Compiled JavaScript + TypeScript definitions
│   ├── dist/
│   │   └── index.js             # Bundled JS with fallback logic
│   └── tsc/
│       └── index.d.ts           # TypeScript definitions
├── prebuilt/                     # Precompiled native addons
│   ├── amd64/
│   │   └── build/Release/
│   │       └── native_licensing_validator.node
│   └── arm64/
│       └── build/Release/
│           └── native_licensing_validator.node
├── scripts/
│   ├── install.js               # Architecture detection + binary selection
│   └── postinstall.js           # Fallback verification
├── README.md
└── LICENSE
```

**Total package size**: ~500KB (vs ~1.5MB with source)

### What Gets Excluded

Excluded via `package.json` `files` array (whitelist approach):

- `native/` - C source files (*.c, *.h)
- `src/` - TypeScript source files
- `binding.gyp` - node-gyp build configuration
- `test/` - Test files
- `scripts/build-*.sh` - Build orchestration scripts
- `scripts/test-*.sh` - Test scripts
- `Makefile` - Build system
- Development configs (`.eslintrc.js`, `jest.config.js`, `tsconfig.json`)

## Build System Architecture

### Makefile as Single Entry Point

The `Makefile` serves as the **single source of truth** for all build operations:

```bash
make help           # Show all available targets
make build          # Development build (TS + native local)
make build-docker   # Production build (Docker cross-compile)
make build-prebuilt # Create npm-ready package with prebuilt binaries
make test           # Run all tests
make package        # Create npm tarball
make publish        # Publish to npm registry
```

### Bash Scripts as Implementation

Bash scripts in `scripts/` provide **complex build logic**:

- `build-docker.sh` - Docker-based cross-compilation for Lambda (x64/arm64)
- `build-prebuilt.sh` - Orchestrates full prebuilt distribution build
- `build-all.sh` - Development build with local + Docker
- `test-deployment.sh` - Lambda Layer deployment testing
- `install.js` - Runtime: architecture detection + binary selection
- `postinstall.js` - Runtime: fallback verification

**Why both Makefile and bash scripts?**

- **Makefile**: User-facing interface, simple targets, dependency management
- **Bash scripts**: Complex logic (Docker orchestration, multi-arch builds, testing)
- **Separation of concerns**: Makefile = "what to build", bash = "how to build"

### Build Workflow

```
Developer                 Makefile              Bash Scripts           Docker
    |                        |                       |                    |
    |-- make build-prebuilt->|                       |                    |
    |                        |-- build-ts ---------->|                    |
    |                        |   (npm run build:ts)  |                    |
    |                        |                       |                    |
    |                        |-- build-docker ------>|                    |
    |                        |   (./scripts/         |                    |
    |                        |    build-docker.sh)   |-- docker build --->|
    |                        |                       |<-- *.node ---------|
    |                        |                       |                    |
    |                        |-- package ----------->|                    |
    |                        |   (./scripts/         |                    |
    |                        |    build-prebuilt.sh) |                    |
    |                        |                       |                    |
    |<-- *.tgz --------------|<----------------------|                    |
```

## Installation Flow

### User Installs Package

```bash
npm install @lambda-kata/licensing
```

### npm Lifecycle Hooks

1. **preinstall**: (none - no compilation needed)
2. **install**: `scripts/install.js` runs
   - Detects architecture (x64 vs arm64)
   - Detects platform (linux vs darwin)
   - Copies appropriate `prebuilt/{arch}/build/Release/*.node` to `build/Release/`
3. **postinstall**: `scripts/postinstall.js` runs
   - Verifies native addon loads correctly
   - Falls back to JS-only mode if addon unavailable
   - Logs warnings if fallback mode activated

### Runtime Loading

```javascript
// out/dist/index.js
let nativeAddon;
try {
  nativeAddon = require('../build/Release/native_licensing_validator.node');
} catch (error) {
  console.warn('Native addon unavailable, using fallback mode');
  nativeAddon = null;
}

export function validateLicense(params) {
  if (nativeAddon) {
    return nativeAddon.validateLicense(params);
  } else {
    return fallbackValidation(params);
  }
}
```

## Security Considerations

### Why Prebuilt Binaries Are Secure

1. **Obfuscation**: Compiled *.node files are binary blobs, not human-readable
2. **Tamper Resistance**: Any modification breaks the binary (crashes on load)
3. **Reproducible Builds**: Docker ensures consistent compilation environment
4. **Checksum Verification**: npm integrity checks prevent tampering in transit

### Why Source Code Is a Risk

1. **Logic Exposure**: Attackers can read validation algorithms
2. **Timing Attacks**: Source reveals timing-sensitive operations
3. **Bypass Opportunities**: Understanding implementation aids exploitation
4. **IP Theft**: Competitors can copy implementation details

## Verification

### Before Publishing

```bash
# Build package
make build-prebuilt

# Verify package contents
make verify-package

# Expected output:
# ✓ prebuilt/amd64/build/Release/native_licensing_validator.node
# ✓ prebuilt/arm64/build/Release/native_licensing_validator.node
# ✓ out/dist/index.js
# ✓ out/tsc/index.d.ts
# ✓ scripts/install.js
# ✓ scripts/postinstall.js
# ✗ No .c files found (good!)
# ✗ No .ts files found (good!)
# ✗ No binding.gyp found (good!)
```

### After Publishing

```bash
# Install from npm
npm install @lambda-kata/licensing

# Verify no source files
ls node_modules/@lambda-kata/licensing/
# Should NOT contain: native/, src/, binding.gyp, Makefile

# Verify prebuilt binaries exist
ls node_modules/@lambda-kata/licensing/prebuilt/
# Should contain: amd64/, arm64/

# Test loading
node -e "require('@lambda-kata/licensing')"
# Should load without errors
```

## Troubleshooting

### "Native addon not found"

**Cause**: Architecture mismatch or install script failed

**Solution**:
```bash
cd node_modules/@lambda-kata/licensing
node scripts/install.js
```

### "Module did not self-register"

**Cause**: Node.js version mismatch (addon compiled for different Node version)

**Solution**: Rebuild package with correct Node version:
```bash
# In package development
make build-docker  # Uses Node 18 (Lambda default)
```

### "Package contains source files"

**Cause**: `package.json` `files` array includes source directories

**Solution**: Verify `files` array:
```json
{
  "files": [
    "out/",
    "prebuilt/",
    "scripts/install.js",
    "scripts/postinstall.js",
    "README.md",
    "LICENSE"
  ]
}
```

## References

- [npm package.json files](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#files)
- [node-gyp prebuilt binaries](https://github.com/nodejs/node-gyp#readme)
- [AWS Lambda Node.js runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html)

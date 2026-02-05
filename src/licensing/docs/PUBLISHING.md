# Publishing Native Licensing Validator to npm

## Current State Analysis

### ❌ BROKEN: What's Missing

The package currently has **NO `prebuilt/` directory**, which means:

1. **npm package contains**: Only `out/` (compiled JS) + scripts
2. **npm package MISSING**: Native addon binaries (*.node files)
3. **Result**: Users get JavaScript fallback only, no native validation

### ✅ FIXED: What Changed

1. **package.json `files` array**: Now correctly excludes source code
2. **install.js**: Fixed to look in `prebuilt/` directory (not `build/`)
3. **prepack hook**: Runs `build:prebuilt` before `npm pack`

## Publishing Workflow

### Prerequisites

- Docker installed (for cross-compilation)
- Node.js >= 18.0.0
- Build tools: make, bash

### Step 1: Build Prebuilt Binaries

```bash
cd packages/native-licensing-validator

# Full build: TypeScript + Docker cross-compile + package
make build-prebuilt

# This creates:
# - out/dist/index.js (compiled JavaScript)
# - out/tsc/index.d.ts (TypeScript definitions)
# - prebuilt/amd64/build/Release/native_licensing_validator.node (x64 binary)
# - prebuilt/arm64/build/Release/native_licensing_validator.node (arm64 binary)
```

**What happens**:
1. Cleans `out/`, `build/`, `prebuilt/`
2. Compiles TypeScript → `out/`
3. Runs Docker builds for x64 and arm64 → `build/amd64/`, `build/arm64/`
4. Copies binaries to `prebuilt/amd64/`, `prebuilt/arm64/`
5. Creates npm tarball

### Step 2: Verify Package Contents

```bash
# Verify prebuilt directory exists
ls -la prebuilt/
# Expected:
# prebuilt/amd64/build/Release/native_licensing_validator.node
# prebuilt/arm64/build/Release/native_licensing_validator.node

# Create package
npm pack

# Verify package contents
tar -tzf lambda-kata-licensing-*.tgz | grep -E '\.(node|js|d\.ts)$'

# Expected output:
# package/out/dist/index.js
# package/out/tsc/index.d.ts
# package/prebuilt/amd64/build/Release/native_licensing_validator.node
# package/prebuilt/arm64/build/Release/native_licensing_validator.node
# package/scripts/install.js
# package/scripts/postinstall.js

# Verify NO source files
tar -tzf lambda-kata-licensing-*.tgz | grep -E '\.(c|h|ts)$'
# Expected: NO OUTPUT (empty)
```

### Step 3: Test Local Installation

```bash
# Create test directory
mkdir -p /tmp/test-licensing
cd /tmp/test-licensing

# Initialize package
npm init -y

# Install from tarball
npm install /path/to/packages/native-licensing-validator/lambda-kata-licensing-*.tgz

# Verify installation
node -e "
  const validator = require('@lambda-kata/licensing');
  console.log('✓ Module loaded');
  console.log('Exports:', Object.keys(validator));
"

# Check if native addon loaded
ls -la node_modules/@lambda-kata/licensing/build/Release/
# Expected: native_licensing_validator.node (copied from prebuilt/)
```

### Step 4: Publish to npm

```bash
cd packages/native-licensing-validator

# Dry run (see what would be published)
npm publish --dry-run

# Publish to npm registry
npm publish --access public

# Or use Makefile
make publish
```

## Installation Flow (User Perspective)

### User runs: `npm install @lambda-kata/licensing`

1. **npm downloads package** containing:
   - `out/dist/index.js` (compiled JS)
   - `prebuilt/amd64/*.node` (x64 binary)
   - `prebuilt/arm64/*.node` (arm64 binary)
   - `scripts/install.js`

2. **npm runs `install` hook** → `node scripts/install.js`:
   - Detects platform: `linux-x64` or `linux-arm64`
   - Maps to: `amd64` or `arm64`
   - Copies from: `prebuilt/{arch}/build/Release/*.node`
   - To: `build/Release/*.node`

3. **npm runs `postinstall` hook** → `node scripts/postinstall.js`:
   - Verifies native addon loads
   - Falls back to JS-only mode if addon unavailable

4. **User imports module**:
   ```javascript
   const validator = require('@lambda-kata/licensing');
   // Native addon loaded from build/Release/native_licensing_validator.node
   ```

## Directory Structure

### Development (before build)

```
packages/native-licensing-validator/
├── native/              # C source files (NOT in npm)
│   ├── validator.c
│   ├── security.c
│   └── ...
├── src/                 # TypeScript source (NOT in npm)
│   └── index.ts
├── binding.gyp          # Build config (NOT in npm)
├── Makefile             # Build system (NOT in npm)
└── scripts/
    ├── build-prebuilt.sh   # Build orchestration (NOT in npm)
    ├── install.js          # Runtime script (IN npm)
    └── postinstall.js      # Runtime script (IN npm)
```

### After `make build-prebuilt`

```
packages/native-licensing-validator/
├── out/                 # ✅ IN npm package
│   ├── dist/
│   │   └── index.js
│   └── tsc/
│       └── index.d.ts
├── prebuilt/            # ✅ IN npm package
│   ├── amd64/
│   │   └── build/Release/native_licensing_validator.node
│   └── arm64/
│       └── build/Release/native_licensing_validator.node
├── build/               # ❌ NOT in npm (build artifacts)
│   ├── amd64/
│   └── arm64/
└── scripts/
    ├── install.js       # ✅ IN npm package
    └── postinstall.js   # ✅ IN npm package
```

### After user installs from npm

```
node_modules/@lambda-kata/licensing/
├── out/
│   ├── dist/index.js
│   └── tsc/index.d.ts
├── prebuilt/            # Shipped with package
│   ├── amd64/
│   └── arm64/
├── build/               # Created by install.js
│   └── Release/
│       └── native_licensing_validator.node  # Copied from prebuilt/
└── scripts/
    ├── install.js
    └── postinstall.js
```

## Troubleshooting

### "prebuilt/ directory not found"

**Cause**: `make build-prebuilt` not run before publishing

**Solution**:
```bash
make build-prebuilt
npm pack
```

### "Native addon not found after install"

**Cause**: `install.js` failed to copy from `prebuilt/`

**Debug**:
```bash
# Check if prebuilt exists in package
npm pack
tar -tzf *.tgz | grep prebuilt

# Check install.js logs
npm install --verbose
```

### "Module did not self-register"

**Cause**: Node.js version mismatch

**Solution**: Rebuild with correct Node version:
```bash
# In Docker build, ensure Node 18 is used
docker run --rm -v $(pwd):/workspace node:18-alpine sh -c "
  cd /workspace && 
  npm install && 
  npm run build:native
"
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Publish to npm

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      
      - name: Install dependencies
        run: npm install
      
      - name: Build prebuilt binaries
        run: |
          cd packages/native-licensing-validator
          make build-prebuilt
      
      - name: Verify package
        run: |
          cd packages/native-licensing-validator
          make verify-package
      
      - name: Publish to npm
        run: |
          cd packages/native-licensing-validator
          npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Security Considerations

### What's Protected

- ✅ C source code NOT in package (IP protection)
- ✅ Build scripts NOT in package (no attack surface)
- ✅ Only compiled binaries shipped (obfuscation)

### What's Exposed

- ⚠️ Compiled binaries can be reverse-engineered (but difficult)
- ⚠️ JavaScript fallback logic visible (but limited functionality)

### Mitigation

- Native addon uses SPKI pinning (hardcoded in binary)
- Timing-sensitive operations in C (harder to analyze)
- Fail-closed behavior (invalid = reject)

## References

- [npm package.json files](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#files)
- [npm lifecycle scripts](https://docs.npmjs.com/cli/v10/using-npm/scripts#life-cycle-scripts)
- [node-gyp prebuilt binaries](https://github.com/nodejs/node-gyp#readme)

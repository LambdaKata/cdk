# Project Structure

## Root Directory Layout

```
├── src/                    # Source code
├── test/                   # Test files
├── examples/               # Usage examples and demos
├── utils/                  # Build utilities
├── docs/                   # Documentation configuration
├── out/                    # Build output
├── dist/                   # Intermediate build artifacts
└── node_modules/           # Dependencies
```

## Source Code Organization (`src/`)

### Core Modules
- `index.ts`: Main entry point with all exports
- `kata-wrapper.ts`: Core transformation logic and `kata()` function
- `types.ts`: TypeScript type definitions
- `config-layer.ts`: CDK Layer creation for configuration
- `account-resolver.ts`: AWS account ID resolution utilities
- `licensing.ts`: Production licensing service integration
- `mock-licensing.ts`: Mock licensing service for testing

### Module Responsibilities
- **kata-wrapper**: Primary transformation logic, handles Lambda modifications
- **config-layer**: Creates CDK layers containing handler configuration
- **account-resolver**: Resolves AWS account IDs from various sources
- **licensing**: Validates AWS Marketplace entitlements
- **types**: Shared TypeScript interfaces and types

## Test Organization (`test/`)

### Test Categories
- `*.test.ts`: Unit tests for specific modules
- `*.property.test.ts`: Property-based tests using fast-check
- `fixtures/`: Test data and helper files

### Test Naming Convention
- Unit tests: `{module-name}.test.ts`
- Property tests: `{module-name}.property.test.ts`
- Integration tests: `{feature-name}.test.ts`

### Key Test Files
- `kata-wrapper.property.test.ts`: Comprehensive property-based tests
- `config-layer.test.ts`: CDK layer creation tests
- `licensing.test.ts`: Licensing service validation tests

## Examples Directory (`examples/`)

### Example Categories
- `example-stack.ts`: Basic usage demonstration
- `config-layer-example/`: Configuration layer usage
- `middleware-example/`: Custom handler resolution
- `handlers/`: Sample Lambda handler implementations

### Example Structure
Each example includes:
- `README.md`: Usage instructions
- `stack.ts`: CDK stack definition
- `handler.ts`: Lambda function code
- `middleware.ts`: Custom middleware (where applicable)

## Build System (`utils/`)

### Build Utilities
- `esbuild/`: esbuild configuration and build scripts
- Build scripts handle bundling for both CDK distribution and development

## Documentation (`docs/`)

### Documentation Configuration
- `docs.config/`: TypeDoc configuration files
- `typedoc.html.json`: HTML documentation settings
- `typedoc.md.json`: Markdown documentation settings

## Output Directories

### Build Outputs
- `out/dist/`: Final bundled JavaScript for npm distribution
- `out/tsc/src/`: TypeScript declaration files
- `dist/`: Intermediate build artifacts (not distributed)

### File Exports
Package exports only include:
- `out/dist/**/*`: Bundled JavaScript
- `out/tsc/src/**/*.d.ts`: Type definitions

## Configuration Files

### Root Configuration
- `package.json`: Package metadata and scripts
- `tsconfig.json`: TypeScript compiler configuration
- `jest.config.js`: Jest testing configuration
- `.gitignore`: Git ignore patterns
- `yarn.lock`: Dependency lock file

### Code Quality
- ESLint configuration embedded in package.json
- TypeScript strict mode enabled
- Jest coverage collection configured
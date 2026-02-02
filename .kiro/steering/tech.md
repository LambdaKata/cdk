# Technology Stack

## Core Technologies

- **Language**: TypeScript 5.3+
- **Runtime**: Node.js 18+
- **Framework**: AWS CDK v2
- **Build System**: esbuild + TypeScript compiler
- **Package Manager**: Yarn

## Dependencies

### Production Dependencies
- `@aws-sdk/client-sts`: AWS STS client for account resolution
- `dotenv`: Environment variable management
- `reflect-metadata`: Metadata reflection support

### Peer Dependencies
- `aws-cdk-lib`: AWS CDK v2 library
- `constructs`: CDK constructs library

### Development Dependencies
- `jest`: Testing framework with ts-jest preset
- `fast-check`: Property-based testing library
- `esbuild`: Fast JavaScript bundler
- `eslint`: Code linting with TypeScript support
- `typedoc`: Documentation generation

## Build System

### Build Commands
```bash
# Full build (clean + compile + bundle + types)
yarn build

# Development watch mode
yarn watch

# Clean build artifacts
yarn clean
```

### Build Process
1. **Config Build**: Bundle esbuild configuration with `esbuild`
2. **CDK Build**: Bundle source code for CDK distribution
3. **Type Generation**: Generate TypeScript declarations with `tsc`
4. **Alias Resolution**: Resolve TypeScript path aliases with `tsc-alias`

### Output Structure
- `out/dist/`: Bundled JavaScript for distribution
- `out/tsc/src/`: TypeScript declaration files
- `dist/`: Intermediate build artifacts

## Testing

### Test Commands
```bash
# Run all tests
yarn test

# Watch mode for development
yarn test:watch

# Linting
yarn lint
```

### Testing Strategy
- **Unit Tests**: Jest with ts-jest preset
- **Property-Based Tests**: fast-check for comprehensive input validation
- **CDK Template Tests**: AWS CDK assertions for CloudFormation validation
- **Mock Services**: Custom mock implementations for licensing service

### Test Configuration
- Test timeout: 30 seconds
- Coverage collection from `src/**/*.ts`
- Test files: `test/**/*.test.ts`

## Documentation

### Documentation Commands
```bash
# Generate all documentation
yarn docs

# Markdown documentation
yarn docs:md

# HTML documentation  
yarn docs:html
```

### Documentation Tools
- **TypeDoc**: API documentation generation
- **Configuration**: Separate configs for HTML and Markdown output
- **Output**: `docs/` directory

## Code Quality

### Linting
- **ESLint**: TypeScript-specific rules
- **Parser**: @typescript-eslint/parser
- **Rules**: @typescript-eslint/eslint-plugin

### TypeScript Configuration
- **Target**: ES2022
- **Module**: CommonJS
- **Strict Mode**: Enabled with comprehensive checks
- **Decorators**: Experimental decorators enabled
- **Source Maps**: Inline source maps for debugging
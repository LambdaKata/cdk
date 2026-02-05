# Native Licensing Validator

A tamper-resistant native licensing validator for the Lambda Kata SST Integration workspace. This package provides enhanced security through a native C implementation that replaces the existing TypeScript-based licensing validation.

## Features

- **Tamper-Resistant**: Native C implementation prevents JavaScript-based tampering
- **Fail-Closed Security**: All error conditions result in denying access
- **Hardened Network**: Compile-time hardcoded endpoints with strict TLS validation
- **AWS Lambda Compatible**: Optimized for Amazon Linux 2023 (x64 and arm64)
- **Drop-in Replacement**: Compatible with existing `LicensingService` interface

## Installation

```bash
npm install @lambda-kata/licensing
```

## Usage

### Basic Usage

```typescript
import { NativeLicensingService } from '@lambda-kata/licensing';

const service = new NativeLicensingService();
const result = await service.checkEntitlement('123456789012');

if (result.entitled) {
  console.log(`Layer ARN: ${result.layerArn}`);
} else {
  console.log(`Not entitled: ${result.message}`);
}
```

### Factory Function

```typescript
import { createLicensingService } from '@lambda-kata/licensing';

const service = createLicensingService();
const result = await service.checkEntitlement('123456789012');
```

### Integration with SST Packages

The native validator is designed to be a drop-in replacement for the existing HTTP-based licensing service:

```typescript
// Before (HTTP-based)
import { HttpLicensingService } from '@lambda-kata/sst-v2';

// After (Native-based)
import { NativeLicensingService } from '@lambda-kata/licensing';

// Same interface, enhanced security
const service = new NativeLicensingService();
```

## Security Features

### Fail-Closed Architecture

The validator implements a fail-closed security model where any error condition results in denying access:

- Network timeouts or connection failures
- TLS certificate validation failures
- Invalid response formats
- Native addon loading failures
- Invalid input parameters

### Hardened Network Communication

- **Compile-time endpoints**: Network destinations cannot be modified at runtime
- **No proxy support**: Ignores proxy environment variables
- **Strict TLS**: Requires TLS 1.2+ with certificate validation
- **No redirects**: HTTP redirects are completely disabled
- **Response authenticity**: Verifies response signatures or certificate pinning

### Minimal Attack Surface

- **Single function interface**: Only `checkEntitlement(accountId: string)` is exposed
- **Input validation**: Account ID format validated in both JavaScript and native code
- **No configuration**: All security settings are compile-time constants

## Building

### Prerequisites

- Node.js 18+ with npm/yarn
- C compiler (gcc/clang)
- libcurl development headers
- OpenSSL development headers
- json-c development headers (Linux only)

### Local Development Build

```bash
# Install dependencies
yarn install

# Build native addon
yarn build:native

# Build TypeScript
yarn build:ts

# Build everything
yarn build
```

### Docker-based Build (Recommended for Lambda)

```bash
# Build for all architectures
./scripts/build-docker.sh

# Build for specific architecture
./scripts/build-docker.sh x64
./scripts/build-docker.sh arm64
```

The Docker build produces Lambda Layer packages ready for deployment.

## Testing

```bash
# Run all tests
yarn test

# Run tests with coverage
yarn test:coverage

# Run tests in watch mode
yarn test:watch
```

### Test Categories

- **Unit Tests**: Specific examples and edge cases
- **Property-Based Tests**: Universal properties using fast-check
- **Integration Tests**: End-to-end validation with mock servers
- **Security Tests**: Tampering resistance and fail-closed behavior

## API Reference

### NativeLicensingService

#### `checkEntitlement(accountId: string): Promise<LicensingResponse>`

Validates licensing entitlement for an AWS account.

**Parameters:**
- `accountId` - 12-digit AWS account ID string

**Returns:**
- `Promise<LicensingResponse>` - Licensing validation result

**Example:**
```typescript
const result = await service.checkEntitlement('123456789012');
```

### LicensingResponse

```typescript
interface LicensingResponse {
  entitled: boolean;           // Entitlement status
  layerArn?: string;          // Customer Lambda Layer ARN (if entitled)
  message?: string;           // Human-readable status message
  expiresAt?: string;         // ISO 8601 expiration timestamp
}
```

## Error Handling

The validator never throws exceptions. All errors result in a fail-closed response:

```typescript
{
  entitled: false,
  message: "Error description"
}
```

Common error messages:
- `"Invalid account ID format"` - Account ID is not a 12-digit string
- `"Native validator unavailable"` - Native addon failed to load
- `"Network error"` - Network communication failed
- `"Security error"` - TLS or authenticity verification failed
- `"System error"` - Unexpected system error

## Performance

- **Validation time**: < 5 seconds under normal conditions
- **Memory usage**: < 1MB heap usage
- **Addon loading**: < 100ms in Lambda environment
- **Caching**: 5-minute TTL for successful responses
- **Connection reuse**: HTTP connections are pooled and reused

## Deployment

### Lambda Layer

The package includes pre-built Lambda Layer packages for both x64 and arm64 architectures:

```bash
# Extract from build artifacts
unzip build/native-licensing-validator-amd64.zip -d layer/
```

Layer structure:
```
nodejs/
└── node_modules/
    └── @lambda-kata/
        └── native-licensing-validator/
            ├── build/Release/native_licensing_validator.node
            ├── out/dist/index.js
            └── package.json
```

### npm Package

The package includes prebuilt binaries for supported platforms:

```json
{
  "binary": {
    "napi_versions": [8, 9]
  }
}
```

## Documentation

Comprehensive documentation is available in the [docs/](./docs/) directory:

### Quick Links
- **[API Reference](./docs/API.md)** - Complete API documentation and usage examples
- **[Build Instructions](./docs/BUILD.md)** - Build procedures for all architectures
- **[Deployment Guide](./docs/DEPLOYMENT.md)** - Lambda Layer deployment procedures
- **[Migration Guide](./docs/MIGRATION.md)** - Migration from TypeScript implementation
- **[Troubleshooting](./docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Security Model](./docs/SECURITY.md)** - Threat model and security considerations
- **[Performance Benchmarks](./docs/PERFORMANCE.md)** - Performance analysis and optimization

### Documentation Overview

| Document | Purpose | Audience |
|----------|---------|----------|
| [API Reference](./docs/API.md) | Complete API documentation | Developers |
| [Build Instructions](./docs/BUILD.md) | Build procedures and requirements | Build Engineers |
| [Deployment Guide](./docs/DEPLOYMENT.md) | Lambda Layer deployment | DevOps Engineers |
| [Migration Guide](./docs/MIGRATION.md) | TypeScript to Native migration | Developers |
| [Troubleshooting](./docs/TROUBLESHOOTING.md) | Issue diagnosis and resolution | All Users |
| [Security Model](./docs/SECURITY.md) | Security architecture and threats | Security Teams |
| [Performance](./docs/PERFORMANCE.md) | Benchmarks and optimization | Performance Engineers |

## Quick Troubleshooting

### Common Issues

**Native Addon Loading Fails**:
```typescript
// Check if addon loaded successfully
const service = new NativeLicensingService();
const result = await service.checkEntitlement('123456789012');

if (result.message === 'Native validator unavailable') {
  console.warn('Native addon not available, using fail-closed fallback');
}
```

**Build Issues**:
- Missing dependencies → Install libcurl-devel, openssl-devel
- Architecture mismatch → Use Docker build for Lambda compatibility  
- Node.js version → Ensure Node.js 18+ is installed

**For detailed troubleshooting**, see [Troubleshooting Guide](./docs/TROUBLESHOOTING.md).

## Security Overview

The validator implements defense-in-depth security:

- **Tamper Resistance**: Core logic in compiled native code
- **Network Security**: Hardcoded endpoints, strict TLS, certificate pinning
- **Fail-Closed Design**: All errors result in denial of access
- **Environment Isolation**: Ignores proxy and environment variables

**For complete security analysis**, see [Security Considerations](./docs/SECURITY.md).

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Run the full test suite
5. Submit a pull request

All contributions must maintain the security properties and fail-closed behavior of the validator.

## Support

For issues and questions:

1. Check the [troubleshooting guide](#troubleshooting)
2. Review existing [GitHub issues](https://github.com/lambda-kata/sst-integration/issues)
3. Create a new issue with detailed reproduction steps

Security issues should be reported privately to the maintainers.

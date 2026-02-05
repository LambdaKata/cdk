# API Reference

This document provides comprehensive API reference documentation for the Native Licensing Validator, including interfaces, methods, types, error handling, and usage examples.

## Overview

The Native Licensing Validator provides a tamper-resistant licensing validation service through a simple, secure API. It implements the same `LicensingService` interface as the TypeScript implementation while providing enhanced security and performance through native C code.

## Core Interfaces

### LicensingService

The main interface for licensing validation operations.

```typescript
interface LicensingService {
  /**
   * Validates licensing entitlement for an AWS account
   * @param accountId - 12-digit AWS account ID string
   * @returns Promise resolving to licensing validation result
   */
  checkEntitlement(accountId: string): Promise<LicensingResponse>;
}
```

### LicensingResponse

The response format for licensing validation requests.

```typescript
interface LicensingResponse {
  /** Whether the account is entitled to use Lambda Kata */
  entitled: boolean;
  
  /** Customer-specific Lambda Layer ARN (if entitled) */
  layerArn?: string;
  
  /** Human-readable status message */
  message?: string;
  
  /** ISO 8601 timestamp when entitlement expires */
  expiresAt?: string;
}
```

## Classes

### NativeLicensingService

The main implementation class that provides tamper-resistant licensing validation.

```typescript
class NativeLicensingService implements LicensingService {
  /**
   * Creates a new native licensing service instance
   * @throws {Error} If native addon fails to load
   */
  constructor();
  
  /**
   * Validates licensing entitlement for an AWS account
   * @param accountId - 12-digit AWS account ID string
   * @returns Promise resolving to licensing validation result
   * @throws Never throws - all errors result in fail-closed responses
   */
  async checkEntitlement(accountId: string): Promise<LicensingResponse>;
}
```

#### Constructor

```typescript
const service = new NativeLicensingService();
```

**Behavior**:
- Loads the native addon on first instantiation
- Initializes connection pool and cache
- Validates native addon compatibility
- Falls back gracefully if addon unavailable

**Error Handling**:
- If native addon fails to load, constructor throws an error
- Calling code should handle this and fall back to alternative implementation

**Example**:
```typescript
try {
  const service = new NativeLicensingService();
  console.log('Native validator initialized successfully');
} catch (error) {
  console.error('Native validator unavailable:', error.message);
  // Fall back to HttpLicensingService
}
```

#### checkEntitlement Method

```typescript
async checkEntitlement(accountId: string): Promise<LicensingResponse>
```

**Parameters**:
- `accountId` (string): Must be exactly 12 digits, representing a valid AWS account ID

**Returns**:
- `Promise<LicensingResponse>`: Always resolves, never rejects

**Validation Rules**:
- Account ID must be exactly 12 characters
- Account ID must contain only digits (0-9)
- Account ID cannot be null, undefined, or empty

**Example**:
```typescript
const service = new NativeLicensingService();

// Valid usage
const result = await service.checkEntitlement('123456789012');
console.log('Entitled:', result.entitled);

// Invalid account ID - returns fail-closed response
const invalidResult = await service.checkEntitlement('invalid');
console.log('Result:', invalidResult); // { entitled: false, message: "Invalid account ID format" }
```

## Factory Functions

### createLicensingService

Factory function that creates an appropriate licensing service instance.

```typescript
function createLicensingService(): LicensingService;
```

**Returns**:
- `LicensingService`: Native service if available, otherwise throws

**Behavior**:
- Attempts to create `NativeLicensingService`
- Throws error if native addon unavailable
- Does not provide fallback (use `createLicensingServiceWithFallback` for fallback)

**Example**:
```typescript
import { createLicensingService } from '@lambda-kata/licensing';

try {
  const service = createLicensingService();
  const result = await service.checkEntitlement('123456789012');
} catch (error) {
  console.error('Native validator not available');
}
```

### createLicensingServiceWithFallback

Factory function with automatic fallback to HTTP implementation.

```typescript
function createLicensingServiceWithFallback(): LicensingService;
```

**Returns**:
- `LicensingService`: Native service if available, HTTP service as fallback

**Behavior**:
- First attempts to create `NativeLicensingService`
- Falls back to `HttpLicensingService` if native addon unavailable
- Always returns a working service instance

**Example**:
```typescript
import { createLicensingServiceWithFallback } from '@lambda-kata/licensing';

// Always succeeds
const service = createLicensingServiceWithFallback();
const result = await service.checkEntitlement('123456789012');
```

## Response Types

### Successful Entitlement Response

```typescript
{
  entitled: true,
  layerArn: "arn:aws:lambda:us-east-1:123456789012:layer:lambda-kata:1",
  message: "Account entitled until 2025-12-31",
  expiresAt: "2025-12-31T23:59:59Z"
}
```

### Failed Entitlement Response

```typescript
{
  entitled: false,
  message: "Account not entitled to Lambda Kata"
}
```

### Error Response (Fail-Closed)

```typescript
{
  entitled: false,
  message: "Network error"
}
```

## Error Handling

### Fail-Closed Design

The native validator implements a fail-closed security model where **all errors result in denial of access**:

```typescript
// All these scenarios return { entitled: false }
await service.checkEntitlement('invalid-id');     // Invalid input
await service.checkEntitlement('123456789012');   // Network timeout
await service.checkEntitlement('123456789012');   // TLS failure
await service.checkEntitlement('123456789012');   // Invalid response
```

### Error Categories

#### Input Validation Errors

```typescript
// Invalid account ID format
const result = await service.checkEntitlement('abc123');
// Returns: { entitled: false, message: "Invalid account ID format" }

// Empty account ID
const result = await service.checkEntitlement('');
// Returns: { entitled: false, message: "Invalid account ID format" }

// Wrong length
const result = await service.checkEntitlement('12345');
// Returns: { entitled: false, message: "Invalid account ID format" }
```

#### Network Errors

```typescript
// Network timeout
const result = await service.checkEntitlement('123456789012');
// Returns: { entitled: false, message: "Network timeout" }

// DNS resolution failure
const result = await service.checkEntitlement('123456789012');
// Returns: { entitled: false, message: "Network error" }

// TLS handshake failure
const result = await service.checkEntitlement('123456789012');
// Returns: { entitled: false, message: "Security error" }
```

#### System Errors

```typescript
// Native addon unavailable
const result = await service.checkEntitlement('123456789012');
// Returns: { entitled: false, message: "Native validator unavailable" }

// Unexpected system error
const result = await service.checkEntitlement('123456789012');
// Returns: { entitled: false, message: "System error" }
```

### Error Message Reference

| Error Type | Message | Cause |
|------------|---------|-------|
| **Input Validation** | "Invalid account ID format" | Account ID not 12 digits |
| **Network Timeout** | "Network timeout" | Request exceeded timeout |
| **Network Error** | "Network error" | Connection or DNS failure |
| **Security Error** | "Security error" | TLS or certificate validation failed |
| **System Error** | "System error" | Unexpected internal error |
| **Addon Unavailable** | "Native validator unavailable" | Native addon failed to load |

## Usage Examples

### Basic Usage

```typescript
import { NativeLicensingService } from '@lambda-kata/licensing';

async function validateLicense(accountId: string) {
  const service = new NativeLicensingService();
  const result = await service.checkEntitlement(accountId);
  
  if (result.entitled) {
    console.log(`Account ${accountId} is entitled`);
    console.log(`Layer ARN: ${result.layerArn}`);
    console.log(`Expires: ${result.expiresAt}`);
    return result.layerArn;
  } else {
    console.log(`Account ${accountId} is not entitled: ${result.message}`);
    return null;
  }
}

// Usage
const layerArn = await validateLicense('123456789012');
```

### Error Handling

```typescript
import { NativeLicensingService } from '@lambda-kata/licensing';

async function robustValidation(accountId: string) {
  try {
    const service = new NativeLicensingService();
    const result = await service.checkEntitlement(accountId);
    
    // Note: checkEntitlement never throws, always returns a result
    return result;
    
  } catch (error) {
    // This only catches constructor errors (addon loading failure)
    console.error('Failed to initialize native validator:', error.message);
    
    // Return fail-closed response
    return {
      entitled: false,
      message: 'Native validator unavailable'
    };
  }
}
```

### Caching and Performance

```typescript
import { NativeLicensingService } from '@lambda-kata/licensing';

class CachedLicensingService {
  private service: NativeLicensingService;
  private cache = new Map<string, { result: LicensingResponse; expires: number }>();
  
  constructor() {
    this.service = new NativeLicensingService();
  }
  
  async checkEntitlement(accountId: string): Promise<LicensingResponse> {
    // Check local cache first
    const cached = this.cache.get(accountId);
    if (cached && Date.now() < cached.expires) {
      return cached.result;
    }
    
    // Use native validator (which has its own internal cache)
    const result = await this.service.checkEntitlement(accountId);
    
    // Cache successful results for 5 minutes
    if (result.entitled) {
      this.cache.set(accountId, {
        result,
        expires: Date.now() + 5 * 60 * 1000
      });
    }
    
    return result;
  }
}
```

### Lambda Integration

```typescript
// Lambda function using native validator
import { NativeLicensingService } from '@lambda-kata/licensing';

// Initialize outside handler for connection reuse
const licensingService = new NativeLicensingService();

export const handler = async (event: any) => {
  try {
    const accountId = event.accountId || '123456789012';
    
    // Validate licensing
    const result = await licensingService.checkEntitlement(accountId);
    
    if (!result.entitled) {
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: 'Not entitled to Lambda Kata',
          message: result.message
        })
      };
    }
    
    // Process request with Lambda Kata
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Request processed with Lambda Kata',
        layerArn: result.layerArn
      })
    };
    
  } catch (error) {
    // This should never happen with native validator
    console.error('Unexpected error:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error'
      })
    };
  }
};
```

### SST Integration

```typescript
// SST v2 integration
import { Function } from 'sst/constructs';
import { kataSstV2 } from '@lambda-kata/sst-v2';

const myFunction = new Function(this, 'MyFunction', {
  handler: 'src/handler.main',
  runtime: 'nodejs20.x',
  layers: [
    'arn:aws:lambda:us-east-1:ACCOUNT:layer:native-licensing-validator-x64:1'
  ]
});

// Transform with Lambda Kata (automatically uses native validator)
kataSstV2(myFunction);
```

```typescript
// SST v3 integration
import { withLambdaKata } from '@lambda-kata/sst-v3';

export const myFunction = new sst.aws.Function("MyFunction", withLambdaKata({
  handler: "src/handler.main",
  runtime: "nodejs20.x",
  layers: [
    "arn:aws:lambda:us-east-1:ACCOUNT:layer:native-licensing-validator-x64:1"
  ]
}));
```

## Performance Characteristics

### Timing Expectations

| Operation | Typical Time | Maximum Time | Notes |
|-----------|--------------|--------------|-------|
| **Constructor** | 20-50ms | 100ms | One-time addon loading |
| **First Request** | 200-400ms | 5000ms | Network request |
| **Cached Request** | 5-10ms | 20ms | Cache lookup |
| **Invalid Input** | 1-2ms | 5ms | Input validation |

### Memory Usage

| Component | Memory Usage | Notes |
|-----------|--------------|-------|
| **Native Addon** | 200-500KB | Compiled code and data |
| **Connection Pool** | 50-100KB | HTTP connections |
| **Cache Storage** | 10-50KB | Cached responses |
| **Total Overhead** | 300-700KB | Per service instance |

### Concurrency

The native validator is **thread-safe** and supports concurrent requests:

```typescript
const service = new NativeLicensingService();

// Concurrent requests are safe
const promises = [
  service.checkEntitlement('123456789012'),
  service.checkEntitlement('234567890123'),
  service.checkEntitlement('345678901234')
];

const results = await Promise.all(promises);
```

## Security Considerations

### Input Sanitization

All inputs are validated and sanitized:

```typescript
// Safe - input validation prevents injection
await service.checkEntitlement('123456789012');

// Safe - invalid input rejected immediately
await service.checkEntitlement('../../etc/passwd');
// Returns: { entitled: false, message: "Invalid account ID format" }
```

### Network Security

- **Hardcoded endpoints**: Cannot be modified at runtime
- **TLS 1.2+ enforcement**: Strong encryption required
- **Certificate validation**: Strict certificate chain validation
- **No redirects**: HTTP redirects completely disabled
- **No proxy support**: Ignores proxy environment variables

### Fail-Closed Behavior

All error conditions result in denial of access:

```typescript
// Network errors
await service.checkEntitlement('123456789012'); // Network timeout
// Returns: { entitled: false, message: "Network timeout" }

// Security errors
await service.checkEntitlement('123456789012'); // Invalid certificate
// Returns: { entitled: false, message: "Security error" }

// System errors
await service.checkEntitlement('123456789012'); // Unexpected error
// Returns: { entitled: false, message: "System error" }
```

## Debugging and Diagnostics

### Debug Logging

Enable debug logging for troubleshooting:

```typescript
// Set environment variable for debug output
process.env.NODE_ENV = 'development';

const service = new NativeLicensingService();
const result = await service.checkEntitlement('123456789012');
// Outputs detailed logging to console
```

### Health Check

```typescript
async function healthCheck() {
  try {
    const service = new NativeLicensingService();
    console.log('✅ Native validator initialized');
    
    const result = await service.checkEntitlement('123456789012');
    console.log('✅ Basic functionality working');
    
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}
```

### Performance Monitoring

```typescript
async function monitoredRequest(accountId: string) {
  const service = new NativeLicensingService();
  
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  
  const result = await service.checkEntitlement(accountId);
  
  const endTime = Date.now();
  const endMemory = process.memoryUsage().heapUsed;
  
  console.log(`Request took ${endTime - startTime}ms`);
  console.log(`Memory delta: ${endMemory - startMemory} bytes`);
  
  return result;
}
```

## Migration from HttpLicensingService

The native validator is a drop-in replacement:

```typescript
// Before
import { HttpLicensingService } from '@lambda-kata/sst-v2';
const service = new HttpLicensingService();

// After
import { NativeLicensingService } from '@lambda-kata/licensing';
const service = new NativeLicensingService();

// Same API, enhanced security and performance
const result = await service.checkEntitlement('123456789012');
```

## TypeScript Definitions

Complete TypeScript definitions are provided:

```typescript
// Type definitions included in package
import type {
  LicensingService,
  LicensingResponse,
  NativeLicensingService
} from '@lambda-kata/licensing';

// Full type safety
const service: LicensingService = new NativeLicensingService();
const result: LicensingResponse = await service.checkEntitlement('123456789012');
```

## Compatibility

### Node.js Versions

| Version | Support | Notes |
|---------|---------|-------|
| Node.js 18.x | ✅ Full | Recommended minimum |
| Node.js 20.x | ✅ Full | Recommended |
| Node.js 22.x | ✅ Full | Latest support |
| Node.js 16.x | ❌ No | End of life |

### AWS Lambda Runtimes

| Runtime | Support | Notes |
|---------|---------|-------|
| nodejs18.x | ✅ Full | Minimum supported |
| nodejs20.x | ✅ Full | Recommended |
| nodejs22.x | ✅ Full | Latest |

### Architectures

| Architecture | Support | Layer Required |
|--------------|---------|----------------|
| x86_64 | ✅ Full | native-licensing-validator-x64 |
| arm64 | ✅ Full | native-licensing-validator-arm64 |

This API reference provides complete documentation for integrating and using the Native Licensing Validator in your applications.

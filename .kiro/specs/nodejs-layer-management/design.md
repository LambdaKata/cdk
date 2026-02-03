# Design Document: Node.js Runtime-Aware Lambda Layer Management

## Overview

This design extends the existing Lambda Kata CDK integration library to automatically detect Node.js Lambda runtime versions and manage corresponding Node.js Lambda Layers. The system provides seamless Node.js runtime support while maintaining the performance benefits of the Lambda Kata runtime transformation.

The core architecture follows a modular approach with clear separation of concerns:
- **Runtime Detection**: Extracts exact Node.js versions from AWS Lambda Docker images
- **Layer Management**: Creates, finds, and manages Node.js Lambda Layers with idempotent operations
- **CDK Integration**: Provides type-safe TypeScript API that integrates with existing kata() wrapper

Key design principles:
- **Correctness**: All operations are idempotent and maintain consistency
- **Security**: Minimal attack surface with proper input validation and AWS credential handling
- **Performance**: Efficient caching and minimal Docker operations
- **Maintainability**: Clear interfaces and comprehensive error handling

## Architecture

### System Boundaries

```mermaid
graph TB
    subgraph "CDK Application"
        A[kata() wrapper] --> B[ensureNodeRuntimeLayer()]
    end
    
    subgraph "Node.js Layer Management System"
        B --> C[RuntimeDetector]
        B --> D[LayerManager]
        C --> E[Docker Runtime Images]
        D --> F[AWS Lambda API]
        D --> G[Layer Cache]
    end
    
    subgraph "External Dependencies"
        E --> H[public.ecr.aws/lambda/nodejs]
        F --> I[AWS SDK v3]
        G --> J[In-Memory Cache]
    end
```

### Component Interaction Flow

1. **Detection Phase**: RuntimeDetector pulls AWS Lambda Docker image and extracts Node.js version
2. **Layer Resolution Phase**: LayerManager checks for existing compatible layers
3. **Creation Phase**: If needed, LayerManager creates new layer with Node.js binaries
4. **Integration Phase**: Layer ARN is returned for CDK integration

### Error Boundaries

- **Docker Operations**: Graceful fallback to known version mappings
- **AWS API Failures**: Exponential backoff with circuit breaker pattern
- **Layer Creation**: Atomic operations with cleanup on failure
- **Input Validation**: Comprehensive validation with descriptive error messages

## Components and Interfaces

### Core Interfaces

```typescript
// Primary API Interface
interface EnsureNodeRuntimeLayerOptions {
  runtimeName: string;            // e.g. "nodejs20.x"
  architecture: "x86_64" | "arm64";
  region: string;
  accountId: string;
  awsSdkConfig?: LambdaClientConfig;
  logger?: Logger;
}

interface EnsureNodeRuntimeLayerResult {
  layerArn: string;
  layerName: string;
  runtimeName: string;
  nodeVersion: string;           // e.g. "20.10.0"
  architecture: "x86_64" | "arm64";
  created: boolean;              // true if new layer created
}

// Runtime Detection Interface
interface RuntimeDetector {
  detectNodeVersion(runtimeName: string, architecture: string): Promise<NodeVersionInfo>;
}

interface NodeVersionInfo {
  version: string;               // e.g. "20.10.0"
  runtimeName: string;          // e.g. "nodejs20.x"
  dockerImage: string;          // e.g. "public.ecr.aws/lambda/nodejs:20-x86_64"
}

// Layer Management Interface
interface LayerManager {
  findExistingLayer(options: LayerSearchOptions): Promise<LayerInfo | null>;
  createNodeLayer(options: LayerCreationOptions): Promise<LayerInfo>;
  validateLayerCompatibility(layer: LayerInfo, requirements: LayerRequirements): boolean;
}

interface LayerInfo {
  arn: string;
  name: string;
  version: number;
  nodeVersion: string;
  architecture: string;
  createdDate: Date;
}

// Error Types
class NodeRuntimeLayerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'NodeRuntimeLayerError';
  }
}

// Logger Interface
interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

### RuntimeDetector Component

**Responsibilities:**
- Pull AWS Lambda Docker images for specific runtimes and architectures
- Execute `node --version` within containers to extract exact versions
- Maintain version cache to avoid repeated Docker operations
- Provide fallback version mappings when Docker is unavailable

**Implementation Strategy:**
```typescript
class DockerRuntimeDetector implements RuntimeDetector {
  private versionCache = new Map<string, NodeVersionInfo>();
  
  async detectNodeVersion(runtimeName: string, architecture: string): Promise<NodeVersionInfo> {
    const cacheKey = `${runtimeName}-${architecture}`;
    
    // Check cache first
    if (this.versionCache.has(cacheKey)) {
      return this.versionCache.get(cacheKey)!;
    }
    
    try {
      // Pull and run Docker image
      const dockerImage = this.buildDockerImageName(runtimeName, architecture);
      const version = await this.extractNodeVersionFromDocker(dockerImage);
      
      const versionInfo: NodeVersionInfo = {
        version,
        runtimeName,
        dockerImage
      };
      
      this.versionCache.set(cacheKey, versionInfo);
      return versionInfo;
    } catch (error) {
      // Fallback to known mappings
      return this.getFallbackVersion(runtimeName, architecture);
    }
  }
}
```

**Docker Image Naming Convention:**
- Base: `public.ecr.aws/lambda/nodejs`
- Format: `{base}:{majorVersion}-{architecture}`
- Examples: 
  - `public.ecr.aws/lambda/nodejs:20-x86_64`
  - `public.ecr.aws/lambda/nodejs:22-arm64`

### LayerManager Component

**Responsibilities:**
- Search for existing compatible Node.js layers in AWS account
- Create new layers when none exist or are incompatible
- Manage layer naming and versioning
- Handle AWS API interactions with proper error handling and retries

**Layer Naming Strategy:**
- Format: `lambda-kata-nodejs-{runtimeName}-{architecture}`
- Examples:
  - `lambda-kata-nodejs-nodejs20.x-x86_64`
  - `lambda-kata-nodejs-nodejs22.x-arm64`

**Layer Compatibility Logic:**
```typescript
class AWSLayerManager implements LayerManager {
  async findExistingLayer(options: LayerSearchOptions): Promise<LayerInfo | null> {
    const layers = await this.listLayersByName(options.layerName);
    
    for (const layer of layers) {
      if (this.validateLayerCompatibility(layer, options.requirements)) {
        return layer;
      }
    }
    
    return null;
  }
  
  validateLayerCompatibility(layer: LayerInfo, requirements: LayerRequirements): boolean {
    return (
      layer.nodeVersion === requirements.nodeVersion &&
      layer.architecture === requirements.architecture &&
      this.isLayerRecent(layer.createdDate)
    );
  }
}
```

**Layer Creation Process:**
1. Extract Node.js binary from Docker image
2. Package binary in Lambda Layer directory structure (`/opt/nodejs/bin/`)
3. Create ZIP archive with proper permissions
4. Upload to AWS Lambda using PublishLayerVersion API
5. Set compatible runtimes and architectures metadata

## Data Models

### Layer Directory Structure
```
layer.zip
└── opt/
    └── nodejs/
        └── bin/
            └── node          # Node.js binary executable
```

### Version Cache Schema
```typescript
interface VersionCacheEntry {
  version: string;
  runtimeName: string;
  dockerImage: string;
  cachedAt: Date;
  ttl: number;              // Time-to-live in milliseconds
}
```

### AWS Layer Metadata
```typescript
interface LayerMetadata {
  layerName: string;
  description: string;
  compatibleRuntimes: string[];      // ["python3.12"] for Lambda Kata
  compatibleArchitectures: string[]; // ["x86_64"] or ["arm64"]
  licenseInfo?: string;
}
```

### Error Classification
```typescript
enum ErrorCodes {
  DOCKER_UNAVAILABLE = 'DOCKER_UNAVAILABLE',
  RUNTIME_UNSUPPORTED = 'RUNTIME_UNSUPPORTED',
  AWS_API_ERROR = 'AWS_API_ERROR',
  LAYER_CREATION_FAILED = 'LAYER_CREATION_FAILED',
  INVALID_ARCHITECTURE = 'INVALID_ARCHITECTURE',
  VERSION_DETECTION_FAILED = 'VERSION_DETECTION_FAILED'
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis and property reflection, the following properties ensure system correctness:

### Property 1: Runtime Version Resolution Consistency
*For any* supported AWS Lambda Node.js runtime (nodejs18.x, nodejs20.x, nodejs22.x), the Runtime_Detector should consistently resolve it to a valid semantic version string that matches the runtime family
**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Docker Image Source Validation  
*For any* runtime and architecture combination, the Runtime_Detector should use official AWS Lambda Docker images following the pattern `public.ecr.aws/lambda/nodejs:{majorVersion}-{architecture}`
**Validates: Requirements 1.4, 8.1**

### Property 3: Error Handling for Invalid Runtimes
*For any* unsupported or malformed runtime specification, the Runtime_Detector should return a descriptive NodeRuntimeLayerError with appropriate error code and troubleshooting information
**Validates: Requirements 1.5, 8.5**

### Property 4: Layer Idempotency
*For any* identical set of layer requirements (runtime, architecture, region, account), multiple calls to ensureNodeRuntimeLayer should return the same Layer ARN without creating duplicate layers
**Validates: Requirements 2.2, 9.1**

### Property 5: Layer Naming Convention Consistency
*For any* layer creation request, the generated layer name should follow the exact pattern `lambda-kata-nodejs-${runtimeName}-${architecture}` and be unique across different runtime/architecture combinations
**Validates: Requirements 2.4, 3.4**

### Property 6: Architecture Compatibility
*For any* specified architecture (x86_64 or arm64), the Layer_Manager should create or find layers that are compatible with that architecture and extract binaries from the corresponding architecture-specific Docker images
**Validates: Requirements 3.1, 3.2, 3.3**

### Property 7: API Contract Compliance
*For any* valid call to ensureNodeRuntimeLayer, the returned result object should contain all required properties (layerArn, layerName, runtimeName, nodeVersion, architecture, created) with correct types and valid values
**Validates: Requirements 4.2**

### Property 8: Optional Parameter Handling
*For any* call to ensureNodeRuntimeLayer with or without optional parameters (awsSdkConfig, logger), the function should execute successfully and respect the provided configuration when present
**Validates: Requirements 4.3, 4.4**

### Property 9: Layer Content Minimization
*For any* created Node.js layer, the layer package should contain only the Node.js binary in the standard directory structure (/opt/nodejs/bin/) and exclude unnecessary files like documentation or development tools
**Validates: Requirements 5.1, 5.2, 5.3**

### Property 10: Layer Size Validation
*For any* layer creation attempt, if the resulting layer size exceeds AWS Lambda layer limits (250MB unzipped), the Layer_Manager should return a descriptive error before attempting to publish
**Validates: Requirements 5.5**

### Property 11: AWS API Retry Logic
*For any* retryable AWS API failure (throttling, temporary service errors), the Layer_Manager should implement exponential backoff retry logic with appropriate jitter and maximum retry limits
**Validates: Requirements 6.1, 6.5**

### Property 12: Resource Cleanup on Failure
*For any* layer creation operation that fails after partial completion, the Layer_Manager should clean up any temporary resources (local files, partial uploads) to prevent resource leaks
**Validates: Requirements 6.3**

### Property 13: Comprehensive Error Reporting
*For any* operation failure (Docker, AWS API, authentication), the system should return NodeRuntimeLayerError instances with descriptive messages, appropriate error codes, and actionable troubleshooting guidance
**Validates: Requirements 6.2, 6.4**

### Property 14: Operation Logging Completeness
*For any* layer management operation, the system should log operation start (with parameters), completion status (success/failure), timing information, and relevant metadata (Layer ARN, creation status)
**Validates: Requirements 7.1, 7.2, 7.5**

### Property 15: Version Caching Efficiency
*For any* runtime version detection request, subsequent requests for the same runtime and architecture should use cached results without performing additional Docker operations, until cache TTL expires
**Validates: Requirements 8.4**

### Property 16: Fallback Version Resolution
*For any* runtime version detection that fails due to Docker unavailability, the Runtime_Detector should provide fallback version information based on known AWS Lambda runtime mappings
**Validates: Requirements 8.3**

### Property 17: Layer Compatibility Assessment
*For any* existing layer evaluation, the compatibility check should consider runtime version, architecture, and layer age to determine if the layer meets current requirements
**Validates: Requirements 9.2**

### Property 18: Concurrent Operation Safety
*For any* concurrent calls to ensureNodeRuntimeLayer with identical parameters, the system should coordinate to prevent duplicate layer creation while ensuring all callers receive valid results
**Validates: Requirements 9.5**

### Property 19: SDK Configuration Flexibility
*For any* custom AWS SDK configuration provided, the Layer_Manager should use the specified credentials, region, and endpoint settings for all AWS API operations
**Validates: Requirements 10.2**

### Property 20: Pagination Handling
*For any* layer listing operation that returns paginated results, the Layer_Manager should automatically handle pagination to retrieve all relevant layers for compatibility checking
**Validates: Requirements 10.4**

## Error Handling

### Error Classification and Recovery

The system implements a comprehensive error handling strategy with clear error boundaries and recovery mechanisms:

**Docker Operation Errors:**
- **Cause**: Docker daemon unavailable, image pull failures, container execution errors
- **Recovery**: Automatic fallback to known version mappings
- **Error Code**: `DOCKER_UNAVAILABLE`, `VERSION_DETECTION_FAILED`
- **User Action**: Install Docker or accept fallback versions

**AWS API Errors:**
- **Cause**: Authentication failures, rate limiting, service unavailability, permission issues
- **Recovery**: Exponential backoff retry for transient errors, immediate failure for auth/permission issues
- **Error Code**: `AWS_API_ERROR`, `LAYER_CREATION_FAILED`
- **User Action**: Check credentials, permissions, and service status

**Input Validation Errors:**
- **Cause**: Invalid runtime names, unsupported architectures, malformed parameters
- **Recovery**: Immediate failure with descriptive error messages
- **Error Code**: `RUNTIME_UNSUPPORTED`, `INVALID_ARCHITECTURE`
- **User Action**: Correct input parameters based on error guidance

**Resource Limit Errors:**
- **Cause**: Layer size exceeds AWS limits, account quotas exceeded
- **Recovery**: Immediate failure with optimization suggestions
- **Error Code**: `LAYER_SIZE_EXCEEDED`, `QUOTA_EXCEEDED`
- **User Action**: Optimize layer content or request quota increases

### Error Propagation Strategy

```typescript
// Error hierarchy ensures proper error handling at each level
try {
  const result = await ensureNodeRuntimeLayer(options);
  return result;
} catch (error) {
  if (error instanceof NodeRuntimeLayerError) {
    // Known error with proper context and recovery guidance
    logger.error('Layer management failed', { 
      code: error.code, 
      message: error.message,
      cause: error.cause 
    });
    throw error;
  } else {
    // Unexpected error - wrap with context
    throw new NodeRuntimeLayerError(
      'Unexpected error during layer management',
      'INTERNAL_ERROR',
      error
    );
  }
}
```

### Circuit Breaker Pattern

For AWS API operations, the system implements a circuit breaker to prevent cascading failures:
- **Closed State**: Normal operation with failure tracking
- **Open State**: Fast-fail for configured duration after failure threshold
- **Half-Open State**: Limited requests to test service recovery

## Testing Strategy

### Dual Testing Approach

The testing strategy combines unit tests and property-based tests to ensure comprehensive coverage:

**Unit Tests:**
- Specific examples demonstrating correct behavior
- Edge cases and boundary conditions  
- Error condition handling
- Integration points between components
- Mock AWS API responses and Docker operations

**Property-Based Tests:**
- Universal properties across all valid inputs
- Comprehensive input coverage through randomization
- Invariant validation under various conditions
- Minimum 100 iterations per property test
- Each test tagged with corresponding design property

### Property-Based Testing Configuration

Using `fast-check` library for TypeScript property-based testing:

```typescript
// Example property test structure
describe('Node.js Layer Management Properties', () => {
  it('Property 1: Runtime Version Resolution Consistency', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant('nodejs18.x'),
          fc.constant('nodejs20.x'), 
          fc.constant('nodejs22.x')
        ),
        fc.oneof(fc.constant('x86_64'), fc.constant('arm64')),
        async (runtime, architecture) => {
          const detector = new DockerRuntimeDetector();
          const result = await detector.detectNodeVersion(runtime, architecture);
          
          // Verify version format and runtime family consistency
          expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
          expect(result.runtimeName).toBe(runtime);
          
          // Verify version matches runtime family
          const majorVersion = result.version.split('.')[0];
          const expectedMajor = runtime.replace('nodejs', '').replace('.x', '');
          expect(majorVersion).toBe(expectedMajor);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

**Test Tag Format:**
Each property test includes a comment tag referencing the design document:
```typescript
// Feature: nodejs-layer-management, Property 1: Runtime Version Resolution Consistency
```

### Integration Testing Strategy

**CDK Integration Tests:**
- Test kata() wrapper integration with ensureNodeRuntimeLayer
- Verify Layer ARN attachment to Lambda functions
- Test CDK synthesis and deployment scenarios

**AWS API Integration Tests:**
- Test against real AWS Lambda service (with cleanup)
- Verify layer creation, listing, and compatibility checking
- Test error handling with actual AWS error responses

**Docker Integration Tests:**
- Test with real AWS Lambda Docker images
- Verify Node.js version extraction accuracy
- Test fallback behavior when Docker is unavailable

### Test Environment Requirements

**Development Environment:**
- Docker daemon available for runtime detection tests
- AWS credentials configured for integration tests
- Test AWS account with Lambda permissions

**CI/CD Environment:**
- Docker-in-Docker capability for container tests
- AWS test account with isolated resources
- Automated cleanup of test layers and resources

**Performance Testing:**
- Layer creation time benchmarks
- Cache effectiveness measurements
- AWS API rate limit handling validation
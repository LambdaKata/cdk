# bundlePath Ignored Fix - Design

## Overview

Fix for a bug where the `bundlePath` parameter passed to the `kata()` function is ignored. Instead of the user-specified path, a default value computed from `originalHandler` is used.

Fix strategy: verify and fix the logic of passing `bundlePath` through the call chain `kata()` → `performKataTransformationSync()` → `applyTransformation()` → `createKataConfigLayer()`.

## Glossary

- **Bug_Condition (C)**: The condition under which the bug manifests — when user specifies `bundlePath` in `kata()` options, but the Lambda Layer config contains the computed value instead of the specified one
- **Property (P)**: The desired behavior — when `bundlePath` is specified, it should be used as-is in the Lambda Layer config
- **Preservation**: Existing behavior that must remain unchanged — computing `bundle_path` from `originalHandler` when `bundlePath` is not specified
- **kata()**: Main function in `src/kata-wrapper.ts` that transforms Node.js Lambda to use Lambda Kata runtime
- **createKataConfigLayer()**: Function in `src/config-layer.ts` that creates Lambda Layer with configuration
- **extractBundlePathFromHandler()**: Function in `src/kata-wrapper.ts` that computes bundle path from handler string

## Bug Details

### Fault Condition

The bug manifests when user passes `bundlePath` in `kata()` options. The `applyTransformation` function computes `effectiveBundlePath` and passes it to `createKataConfigLayer`, but the user-provided value is ignored.

**Formal specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type KataWrapperOptions
  OUTPUT: boolean
  
  RETURN input.bundlePath IS NOT undefined
         AND input.bundlePath IS NOT empty string
         AND configLayerOutput.bundle_path != input.bundlePath
END FUNCTION
```

### Examples

- User specifies `bundlePath: '/var/task/index.mjs'` → config contains `bundle_path: "index.js"` (INCORRECT)
- User specifies `bundlePath: '/opt/custom/bundle.js'` → config contains `bundle_path: "index.js"` (INCORRECT)
- User specifies `bundlePath: '/var/task/dist/bundle.js'` → config contains `bundle_path: "index.js"` (INCORRECT)
- User does not specify `bundlePath` → config contains computed value (CORRECT, expected behavior)

## Expected Behavior

### Preservation Requirements

**Unchanged behavior:**
- When `bundlePath` is not specified, the system must continue to compute `bundle_path` from `originalHandler` via `extractBundlePathFromHandler()`
- When `middlewarePath` is specified together with `bundlePath`, both parameters must be handled correctly
- When `handlerResolver` is specified together with `bundlePath`, both parameters must be handled correctly
- When Lambda function is not licensed, transformation must not be applied

**Scope:**
All inputs that do NOT include an explicitly specified `bundlePath` must be completely unaffected by this fix. This includes:
- Calls to `kata()` without options
- Calls to `kata()` with other options but without `bundlePath`
- Calls to `kata()` with `bundlePath: undefined`
- Calls to `kata()` with `bundlePath: ''` (empty string)

## Hypothesized Root Cause

Based on code analysis, the most likely causes are:

1. **Mismatch between documentation and implementation of `extractBundlePathFromHandler`**: The function documentation says it returns an absolute path with `/var/task/` prefix, but the implementation returns a relative path without the prefix. This may cause confusion in the logic.

2. **Problem in `applyTransformation` logic**: In lines 971-974 of `kata-wrapper.ts`:
   ```typescript
   const effectiveBundlePath = config.bundlePath ?? extractBundlePathFromHandler(config.originalHandler);
   const configLayer = createKataConfigLayer(lambda, 'KataConfigLayer', {
     originalHandler: config.originalHandler,
     bundlePath: effectiveBundlePath,
   ```
   The logic looks correct, but possibly `config.bundlePath` is not being passed correctly from the calling code.

3. **Value loss in call chain**: Possibly somewhere in the chain `kata()` → `performKataTransformationSync()` → `applyTransformation()` the `bundlePath` value is lost or overwritten.

4. **Type mismatch**: Possibly there is a mismatch between `KataWrapperOptions` and `TransformationConfig` types that causes value loss.

## Correctness Properties

Property 1: Fault Condition - User-provided bundlePath is used

_For any_ call to `kata()` where `bundlePath` is specified and is not an empty string, the fixed function SHALL write the specified value to the Lambda Layer config as `bundle_path`.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Default bundlePath computation

_For any_ call to `kata()` where `bundlePath` is NOT specified (undefined) or is an empty string, the fixed function SHALL compute `bundle_path` from `originalHandler` via `extractBundlePathFromHandler()`, preserving existing behavior.

**Validates: Requirements 3.1, 3.5**

## Fix Implementation

### Required Changes

Assuming our root cause analysis is correct:

**File**: `src/kata-wrapper.ts`

**Function**: `applyTransformation`

**Specific changes**:

1. **Verify bundlePath passing**: Add logging for debugging to ensure `config.bundlePath` is passed correctly.

2. **Fix effectiveBundlePath logic**: Ensure user-provided `bundlePath` takes priority over computed value:
   ```typescript
   // Current logic (possibly problematic):
   const effectiveBundlePath = config.bundlePath ?? extractBundlePathFromHandler(config.originalHandler);
   
   // Fixed logic (if needed):
   const effectiveBundlePath = config.bundlePath !== undefined && config.bundlePath !== ''
     ? config.bundlePath
     : extractBundlePathFromHandler(config.originalHandler);
   ```

3. **Verify call chain**: Ensure `bundlePath` is correctly passed through all functions:
   - `kata()` → `performKataTransformationSync()`: `bundlePath: props?.bundlePath`
   - `performKataTransformationSync()` → `applyTransformation()`: `bundlePath: props?.bundlePath`
   - `applyTransformation()` → `createKataConfigLayer()`: `bundlePath: effectiveBundlePath`

4. **Update tests**: Add tests that verify user-provided `bundlePath` is used correctly.

5. **Update documentation**: Fix `extractBundlePathFromHandler()` documentation to match implementation.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first find counterexamples demonstrating the bug on unfixed code, then verify that the fix works correctly and preserves existing behavior.

### Exploratory Fault Condition Checking

**Goal**: Find counterexamples demonstrating the bug BEFORE implementing the fix. Confirm or refute the root cause analysis.

**Test plan**: Write tests that call `kata()` with explicitly specified `bundlePath` and verify that this value is written to the Lambda Layer config. Run these tests on UNFIXED code to observe failures and understand the root cause.

**Test cases**:
1. **Test with absolute path**: Call `kata()` with `bundlePath: '/var/task/index.mjs'` (should fail on unfixed code)
2. **Test with custom path**: Call `kata()` with `bundlePath: '/opt/custom/bundle.js'` (should fail on unfixed code)
3. **Test with subfolder path**: Call `kata()` with `bundlePath: '/var/task/dist/bundle.js'` (should fail on unfixed code)

**Expected counterexamples**:
- Lambda Layer config contains computed value instead of user-specified one
- Possible causes: value loss in call chain, incorrect logic in `applyTransformation`

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := kata_fixed(lambda, input)
  configLayer := extractConfigFromLayer(result)
  ASSERT configLayer.bundle_path == input.bundlePath
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT kata_original(lambda, input) == kata_fixed(lambda, input)
END FOR
```

**Testing approach**: Property-based testing is recommended for preservation checking because:
- It automatically generates many test cases across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior has not changed for all non-buggy inputs

**Test plan**: Observe behavior on UNFIXED code first for cases without `bundlePath`, then write property-based tests capturing this behavior.

**Test cases**:
1. **Preservation without bundlePath**: Verify that calling `kata()` without `bundlePath` continues to compute `bundle_path` from `originalHandler`
2. **Preservation with empty bundlePath**: Verify that calling `kata()` with `bundlePath: ''` uses computed value
3. **Preservation with undefined bundlePath**: Verify that calling `kata()` with `bundlePath: undefined` uses computed value
4. **Preservation of other options**: Verify that `middlewarePath` and `handlerResolver` continue to work correctly

### Unit Tests

- Test passing `bundlePath` through call chain
- Test `effectiveBundlePath` logic in `applyTransformation`
- Test writing `bundle_path` to Lambda Layer config
- Test edge cases (empty string, undefined, special characters in path)

### Property-Based Tests

- Generate random paths and verify they are correctly written to config
- Generate random handler strings and verify computed `bundle_path` is correct
- Test that all non-bundlePath inputs continue to work correctly

### Integration Tests

- Full flow with `kata()` and verify resulting CloudFormation template
- Test with various option combinations (`bundlePath` + `middlewarePath`, `bundlePath` + `handlerResolver`)
- Test with various Lambda function types (NodejsFunction, Function)

# Bugfix Requirements Document

## Introduction

Fix for a bug where the `bundlePath` parameter passed to the `kata()` function is ignored. Instead of the user-specified path, a default value computed from `originalHandler` is used.

**Bug Impact:**
- Lambda Kata runtime uses `bundle_path` to locate the user's JavaScript bundle
- If the path is wrong, the Lambda function will fail to execute
- The user explicitly provides a custom path but it is not applied

**Example:**
```typescript
kata<lambda.Function>(this.benchmarkFunction, {
  bundlePath: '/var/task/index.mjs',
});
```

**Expected result in Lambda Layer config:**
```json
{"original_js_handler": "index.handler", "bundle_path": "/var/task/index.mjs"}
```

**Actual result:**
```json
{"original_js_handler": "index.handler", "bundle_path": "index.js"}
```

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN user passes `bundlePath` in `kata()` options THEN the system ignores the passed value and uses the default value computed from `originalHandler`

1.2 WHEN `bundlePath` equals `/var/task/index.mjs` THEN the Lambda Layer config contains `bundle_path: "index.js"` instead of `/var/task/index.mjs`

### Expected Behavior (Correct)

2.1 WHEN user passes `bundlePath` in `kata()` options THEN the system SHALL use the passed value in the Lambda Layer config as `bundle_path`

2.2 WHEN `bundlePath` equals `/var/task/index.mjs` THEN the system SHALL write `bundle_path: "/var/task/index.mjs"` to the Lambda Layer config

2.3 WHEN `bundlePath` is not specified (undefined) THEN the system SHALL use the default value computed from `originalHandler` via `extractBundlePathFromHandler()`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `bundlePath` is not specified in `kata()` options THEN the system SHALL CONTINUE TO compute `bundle_path` from `originalHandler` via `extractBundlePathFromHandler()`

3.2 WHEN `middlewarePath` is specified together with `bundlePath` THEN the system SHALL CONTINUE TO correctly handle both parameters

3.3 WHEN `handlerResolver` is specified together with `bundlePath` THEN the system SHALL CONTINUE TO correctly handle both parameters

3.4 WHEN Lambda function is not licensed THEN the system SHALL CONTINUE TO not apply transformation and not create config layer

3.5 WHEN `originalHandler` has a complex path (e.g., `src/handlers/myHandler.processEvent`) THEN the system SHALL CONTINUE TO correctly compute default `bundle_path` as `src/handlers/myHandler.js`

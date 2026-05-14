# AGENTS.md

## 0. Agent scope & identity

You are an AI coding agent working inside this repository only.

Your primary goals:
- Implement features and fixes as requested.
- Preserve existing architecture and public contracts.
- Maintain reliability, security, and performance.

You must:
- Prefer small, reviewable changes.
- Explain non-trivial decisions in comments or commit messages (if available).
- Ask for clarification when a change would break explicit constraints below.

## 1. Project overview

**Purpose of this repo:**
- `@lambdakata/cdk` is an AWS CDK integration library that transforms Node.js Lambda functions to run via the Lambda Kata runtime
- Provides the `kata()` wrapper function that modifies Lambda constructs at CDK synthesis time
- Validates AWS Marketplace licensing entitlements before applying transformations
- Creates configuration layers containing handler path information for the Lambda Kata runtime

**Core domains / bounded contexts:**
- **Kata Wrapper** (`kata-wrapper.ts`): Core transformation logic, runtime switching, layer attachment
- **Licensing** (`licensing.ts`, `mock-licensing.ts`): AWS Marketplace entitlement validation via native C module and HTTP fallback
- **Config Layer** (`config-layer.ts`): CDK Layer creation for handler configuration and middleware compilation
- **Node.js Layer Management** (`nodejs-layer-manager.ts`, `aws-layer-manager.ts`, `ensure-node-runtime-layer.ts`): Automatic Node.js runtime layer deployment
- **Account Resolution** (`account-resolver.ts`, `sync-account-resolver.ts`): AWS account ID resolution from various sources

**Critical invariants:**
- Licensing checks must never be bypassed; unlicensed accounts must not receive Lambda Kata transformations
- Original Lambda properties (memory, timeout, IAM roles, triggers) must be preserved during transformation
- The `kata()` function must be synchronous to work correctly with CDK synthesis
- Layer ARNs returned from licensing service must include version numbers for AWS Lambda compatibility
- Config layer JSON must use UTF-8 encoding and follow the exact schema expected by Lambda Kata runtime

## 2. Environment & assumptions

**Runtime:**
- Node.js: 18.0.0 or higher (specified in `engines` field)
- TypeScript: 5.3.3 or higher with strict mode enabled

**Package manager:**
- Yarn (use `yarn` for all dependency operations; `yarn.lock` is the lockfile)

**Local services:**
- Docker (optional): Required only for Node.js layer creation via Docker extraction fallback
- AWS credentials: Required for licensing validation and layer deployment during CDK synthesis

**Do not assume internet access** unless explicitly granted. The licensing service requires network access during CDK synthesis, but failures are handled gracefully by treating unreachable services as unlicensed.

## 3. Setup & commands

Always use these commands when working with the project:

**Install dependencies:**
```bash
yarn install
```

**Run unit tests:**
```bash
yarn test
```

**Run tests in watch mode (development):**
```bash
yarn test:watch
```

**Lint / format:**
```bash
yarn lint
```

**Build:**
```bash
yarn build
```

**Clean build artifacts:**
```bash
yarn clean
```

**Generate documentation:**
```bash
yarn docs
```

**Rule:** Before you propose final changes, run `yarn lint` and `yarn test` to verify correctness.

## 4. Repository & architecture map

**High-level structure:**
```
src/           — Core library source code (TypeScript)
test/          — Test files (unit and property-based tests)
examples/      — Usage examples and demos
utils/         — Build utilities (esbuild configuration)
docs/          — Documentation and TypeDoc configuration
out/           — Build output (bundled JS and type declarations)
dist/          — Intermediate build artifacts
```

**Key entrypoints:**
- **Library entry:** `src/index.ts` — All public exports
- **Core transformation:** `src/kata-wrapper.ts` — The `kata()` function
- **Config layer:** `src/config-layer.ts` — `createKataConfigLayer()` function
- **Licensing:** `src/licensing.ts` — `LicensingService` interface and `HttpLicensingService`
- **Node.js layers:** `src/ensure-node-runtime-layer.ts` — `ensureNodeRuntimeLayer()` function
- **Build config:** `utils/esbuild/esbuild.build.ts` — esbuild bundler configuration

## 5. Coding conventions

**Language:**
- TypeScript strict mode: `true` (do not weaken typings)
- Target: ES2022, Module: CommonJS

**Style:**
- Quotes: single quotes for strings
- Semicolons: required
- Import order: Node.js built-ins, then external packages, then internal modules
- Prefer pure functions where possible; side effects in adapters/handlers
- Use explicit type annotations for public API functions

**Error handling:**
- Use `NodeRuntimeLayerError` with `ErrorCodes` enum for layer management errors
- Use `AccountResolutionError` and `SyncAccountResolutionError` for account resolution failures
- Licensing errors are handled gracefully by returning `{ entitled: false }` responses
- Never throw raw strings; always use Error subclasses with descriptive messages

**Logging:**
- Use the `Logger` interface for structured logging in layer management
- Use `console.log`/`console.warn`/`console.error` with `[Lambda Kata]` prefix for kata-wrapper operations
- Do not log secrets, AWS credentials, or PII

## 6. Testing strategy

When you change code:
- Always add or update tests covering:
  - Happy path
  - Relevant edge cases
  - Regressions you are fixing

**Test locations:**
- Unit tests: `test/*.test.ts`
- Property-based tests: `test/*.property.test.ts` (using fast-check)
- Test fixtures: `test/fixtures/`

**Test naming convention:**
- Unit tests: `{module-name}.test.ts`
- Property tests: `{module-name}.property.test.ts`
- Integration tests: `{feature-name}.test.ts`

**Commands:**
- All tests: `yarn test`
- Watch mode: `yarn test:watch`

If tests fail, fix them or revert the change. Do not silence or delete failing tests without reason.

## 7. Workflow rules

**Branching:**
- Use branches like `feature/...`, `fix/...`, `chore/...`

**Commits:**
- Keep commits small and focused
- Examples:
  - `feat: add support for custom middleware paths`
  - `fix: handle missing layer ARN in licensing response`
  - `chore: update TypeScript to 5.4`

**Pull requests:**
- Title format: `[scope] short description`
- PR must include:
  - Summary of changes
  - Risks and mitigations
  - How to test (commands + steps)

## 8. Safety, secrets & destructive operations

**Never hardcode secrets, tokens or passwords.**

**Do not read or modify:**
- `.env*` files, secret stores, or credentials in CI configs
- AWS credentials files or environment variables containing secrets
- The `@lambda-kata/licensing` native module internals

**Destructive operations** (data loss, dropping tables, truncating logs, deleting resources) are forbidden unless:
- The user explicitly asks for such operations and confirms understanding of the risk

**Do not add code that:**
- Sends production data to external services not already configured
- Weakens authentication or authorization checks
- Bypasses licensing validation
- Modifies Lambda functions without proper entitlement checks

If you are unsure whether a change might be destructive, ask before proceeding.

## 9. Tooling & integrations

**Internal CLI:**
- `yarn build` — Full build pipeline (clean, bundle, types)
- `yarn build:cdk` — Bundle source for CDK distribution
- `yarn build:config` — Bundle esbuild configuration

**Cloud / platform tools:**
- AWS CDK v2 — Infrastructure as code framework (peer dependency)
- AWS SDK v3 — Used for Lambda layer management and STS operations
- esbuild — Fast JavaScript bundler for middleware compilation and distribution builds

**Native module:**
- `@lambda-kata/licensing` — Native C module for synchronous licensing validation (do not modify)

Do not introduce new tools or services without a clear justification and minimal footprint.

## 10. Constraints / do-not-touch areas

**Do not change, unless a task explicitly requires it:**

**Public API contracts:**
- The `kata()` function signature and return type
- The `KataWrapperOptions` interface
- The `LicensingResponse` interface
- The `createKataConfigLayer()` function signature
- All exports from `src/index.ts`

**Config layer schema:**
- The JSON structure at `/opt/.kata/original_handler.json`
- The `original_js_handler`, `bundle_path`, and `has_middleware` keys

**Licensing integration:**
- The native licensing module integration in `performKataTransformationSync()`
- The licensing endpoint URL and request format

**Shared libraries with many dependants:**
- Changes must be backwards compatible
- Tests must be added or updated across all affected packages

**Generated or vendor files:**
- Do not manually edit:
  - `out/` directory contents
  - `dist/` directory contents
  - `yarn.lock` (unless the change is a direct result of dependency install)

## 11. Performance & resource guidelines

**Avoid algorithms worse than O(n log n)** for large collections unless justified.

**Be mindful of:**
- Additional network roundtrips (licensing checks should be minimal)
- Docker operations during CDK synthesis (can be slow)
- Layer ZIP file sizes (AWS Lambda has 250MB unzipped limit)
- Cold-start overhead in Lambda functions

**Performance-critical paths:**
- `performKataTransformationSync()` — Must be synchronous and fast
- `resolveAccountIdSync()` — Must not make network calls
- `createKataConfigLayer()` — esbuild compilation should be minimal

If a task touches performance-critical paths, summarize your reasoning and trade-offs.

## 12. Monorepo & nested AGENTS.md

This repository is not currently a monorepo. Nested AGENTS.md files are not used.

**Rule:** If nested AGENTS.md files are added in the future, follow the instructions of the closest AGENTS.md to the file you are editing.

**Global constraints in this root file still apply for:**
- Security
- Secrets handling
- Destructive operations

## 13. Multi-agent / personas (if applicable)

If you are a specialized agent, follow your persona rules in addition to this file:

- **@dev-agent:** Focus on implementation and tests.
- **@test-agent:** Focus on test coverage and edge cases; do not change runtime code unless fixing flakiness.
- **@security-agent:** Focus on security review and hardening; minimize functional changes.

If rules conflict: **security > correctness > convenience**.

## 14. Definition of Done (checklist)

Before considering a task complete, ensure:

- [ ] Code compiles: `yarn build` succeeds
- [ ] Tests pass: `yarn test` succeeds
- [ ] Lint/format pass: `yarn lint` succeeds
- [ ] No constraints from section 10 are violated
- [ ] New/changed behavior is covered by tests (unit and/or property-based)
- [ ] Changes are documented (changelog/docs/PR description)
- [ ] No secrets or sensitive data added to the repo
- [ ] Public API contracts remain backwards compatible (unless explicitly requested)

If any item is not satisfied, the task is not done.

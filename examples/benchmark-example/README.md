# Benchmark Harness Example

This example demonstrates the **Lambda Kata Benchmark Harness**: a single
`kataBench(stack)` call that clones each eligible Lambda in your stack into a
`Baseline_Variant` (your untouched function) and a `Kata_Variant` (the clone
transformed by the same public `kata()` wrapper), wires isolated benchmark
triggers, and emits a benchmark manifest pointer.

The harness has two halves:

| Half | When it runs | Imports `aws-cdk-lib`? |
|------|--------------|------------------------|
| `kataBench(stack)` | CDK **synth** time | Yes (it builds constructs) |
| `lambda-kata-bench` CLI | **Run** time, against the deployed stack | No (CDK-free) |

## Safe by Default

`kataBench()` is conservative unless you opt into more:

- **fidelity `L0`** — synthetic handler measuring pure runtime overhead;
- **side-effect policy `unsafe`** — blocks parallel fan-out;
- **role mode `reuse-role`** — the clone reuses the baseline role;
- **external-resource disposition `block`** — default-deny;
- **clone triggers created DISABLED** — nothing fires at deploy time.

Deploying the stack does **not** run a benchmark or enable any benchmark
trigger. Running a benchmark is a separate, explicit run-time step whose default
mode is **observe-only**.

## What `kataBench(stack)` does at synth time

When you call `kataBench(this)` on an entitled AWS account:

1. **Discovers** every Lambda in the stack and **classifies** each as
   cloneable / cloneable-with-warnings / unsupported.
2. **Skips** unsupported Lambdas (recorded in the returned `KataBenchResult`)
   without aborting the rest of the run.
3. **Clones** each eligible Lambda — the baseline is left byte-identical, and
   the clone is transformed through the unchanged `kata()` path.
4. **Provisions** isolated benchmark trigger sources and creates both event
   source mappings **DISABLED**.
5. **Writes** a versioned manifest (SSM pointer + S3 body) and emits a
   `CfnOutput` carrying only the pointer.

The returned `KataBenchResult` exposes:

```typescript
import { KataBenchResult, VariantPair, SkippedLambda, PreflightFinding } from '@lambdakata/cdk';

type _Result = KataBenchResult;
type _Pair = VariantPair;
type _Skip = SkippedLambda;
type _Finding = PreflightFinding;
```

## Files

```
benchmark-example/
├── stack.ts    # CDK stack demonstrating kataBench(this)
└── README.md   # This file
```

The stack reuses the shared handlers under `../handlers/`.

## Deployment

### Prerequisites

1. AWS credentials configured for the target account
2. Node.js 20+ installed
3. AWS CDK v2 CLI installed (`npm install -g aws-cdk`)
4. An active Lambda Kata AWS Marketplace subscription for the AWS account
   (entitlement is validated during CDK synthesis; the clone transformation
   flows only through `kata()`, so an unentitled account simply leaves the
   clone untransformed)

### Code Example

```typescript
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { kataBench, FidelityLevel } from '@lambdakata/cdk';

export class BenchmarkExampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Define your Lambdas as usual — do NOT call kata() yourself.
    new NodejsFunction(this, 'ApiHandler', {
      entry: 'examples/handlers/api-handler.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
    });

    // One call clones each eligible Lambda and writes the manifest.
    const result = kataBench(this, {
      fidelity: FidelityLevel.L0,        // conservative default
      sideEffectPolicy: 'unsafe',        // blocks parallel fan-out
      roleMode: 'reuse-role',
      externalResourceDisposition: 'block',
    });

    console.log(`Manifest pointer: ${result.manifestParameterName}`);
  }
}
```

### Deploy the Stack

```bash
# Install the package in your CDK application
npm install @lambdakata/cdk

# Deploy the stack (creates baseline+clone pairs and the manifest pointer)
npx cdk deploy BenchmarkExampleStack
```

## Run-Time CLI Flow (Observe-Only)

The deployed stack carries DISABLED benchmark triggers and a manifest pointer.
The CDK-free `lambda-kata-bench` CLI reads that pointer to drive a run. The
**default mode is observe-only**: it reads CloudWatch `REPORT` metrics for the
already-deployed variants and renders a report **without** generating load or
toggling any trigger.

```bash
# 1. Read the manifest pointer emitted as a stack output
aws cloudformation describe-stacks \
  --stack-name BenchmarkExampleStack \
  --query "Stacks[0].Outputs[?OutputKey=='BenchmarkManifestParameter'].OutputValue" \
  --output text

# 2. Drive a run in the DEFAULT observe-only mode (no load, no trigger toggling)
npx lambda-kata-bench run --manifest <ssm-parameter-name> --observe-only

# 3. Render the layered report (Runtime Cold-Start, Handler Execution,
#    Trigger Delivery) as HTML + JSON
npx lambda-kata-bench report --manifest <ssm-parameter-name>

# 4. Tear down only the benchmark-owned resources for this run (tag-scoped)
npx lambda-kata-bench cleanup --manifest <ssm-parameter-name>
```

Other modes (`--benchmark`, `--production-canary`) generate load and toggle
benchmark-owned triggers. They are **explicit opt-ins** and are never the
default — observe-only is always the safe starting point.

## Cleanup

```bash
# Remove only the benchmark-owned resources tagged for this run
npx lambda-kata-bench cleanup --manifest <ssm-parameter-name>

# Then destroy the stack
npx cdk destroy BenchmarkExampleStack
```

## Related Documentation

- [CDK Integration Guide](../../README.md)
- [Config Layer Example](../config-layer-example/README.md)
- [Middleware Example](../middleware-example/README.md)

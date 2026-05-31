# End-to-End (real AWS) verification

This harness deploys a real example stack to a **real, entitled AWS account**,
invokes the transformed Lambda, asserts the runtime result, and tears the stack
down. Unlike the synth tests, this exercises the actual Lambda Kata runtime
(real licensing, real layers, real invocation).

It is intentionally **not** part of `yarn test` / CI, because it:

- creates billable AWS resources,
- requires an AWS account with an active Lambda Kata Marketplace subscription,
- requires AWS credentials and CDK bootstrap in the target account.

## What it does

The harness drives the **built** package (`out/dist`) — exactly what a user
installs from npm — so the SnapStart custom-resource handler asset resolves
correctly. It:

1. Synthesizes `app.js`, which instantiates the real example handler wrapped by
   `kata()` from the built package.
2. `cdk deploy` to the target account/region.
3. `aws lambda invoke` and asserts the response reflects the Lambda Kata runtime
   (config layer present, original handler path `index.handler`).
4. `cdk destroy` to clean up.

## Prerequisites

- A built package: `yarn build`
- AWS credentials for an entitled account (e.g. via `AWS_PROFILE`)
- CDK bootstrap in the target account/region

## Usage

```bash
# From the repository root, with credentials for the entitled account active:
yarn build

LK_E2E_ACCOUNT=<account-id> \
LK_E2E_REGION=eu-central-1 \
AWS_PROFILE=<entitled-profile> \
bash test/e2e/run-e2e.sh
```

The script refuses to run unless `LK_E2E_ACCOUNT` matches the active AWS
credentials, to avoid deploying into the wrong account.

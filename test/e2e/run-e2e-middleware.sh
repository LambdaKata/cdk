#!/usr/bin/env bash
#
# Apache-2.0
# Copyright (C) 2025-present Raman Marozau, Target Insight Function. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Real-AWS end-to-end verification for the MIDDLEWARE FILE variant.
#
# Proves the documented "Option 2: Middleware File" practice works on a real,
# entitled account: the middleware compiled to /opt/.kata/middleware.js is
# actually loaded and run at invocation time.
#
# Stages: guard -> synth -> deploy -> invoke -> assert(body) -> assert(logs) -> destroy
#
# Required env:
#   LK_E2E_ACCOUNT   target (entitled) AWS account id
# Optional env:
#   LK_E2E_REGION    default: eu-central-1
#   LK_E2E_KEEP      if "1", skip destroy

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"

REGION="${LK_E2E_REGION:-eu-central-1}"
FUNCTION_NAME="LambdaKataE2EMiddlewareFunction"
STACK_NAME="LambdaKataE2EMiddlewareStack"

export LK_E2E_REGION="${REGION}"
export LK_E2E_FUNCTION_NAME="${FUNCTION_NAME}"
export LK_E2E_STACK_NAME="${STACK_NAME}"

log() { printf '\n=== %s ===\n' "$1"; }
fail() { printf '\nE2E (middleware) FAILED: %s\n' "$1" >&2; exit 1; }

log "Guard"
[ -n "${LK_E2E_ACCOUNT:-}" ] || fail "LK_E2E_ACCOUNT is required"
ACTIVE_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Requested account : ${LK_E2E_ACCOUNT}"
echo "Active credentials: ${ACTIVE_ACCOUNT}"
echo "Region            : ${REGION}"
[ "${ACTIVE_ACCOUNT}" = "${LK_E2E_ACCOUNT}" ] || fail "Active AWS account (${ACTIVE_ACCOUNT}) != LK_E2E_ACCOUNT (${LK_E2E_ACCOUNT})"

log "Verify build artifact"
[ -f "${REPO_ROOT}/out/dist/index.js" ] || fail "Missing out/dist/index.js — run 'yarn build' first"
[ -f "${REPO_ROOT}/out/dist/snapstart-handler.js" ] || fail "Missing out/dist/snapstart-handler.js — run 'yarn build' first"

CDK_BIN="${REPO_ROOT}/node_modules/.bin/cdk"
if [ ! -x "${CDK_BIN}" ]; then
  if command -v npx >/dev/null 2>&1; then
    CDK_BIN="npx --yes cdk"
  else
    fail "cdk CLI not found"
  fi
fi

CDK_APP="node app-middleware.js"

log "Synth"
( cd "${HERE}" && ${CDK_BIN} --app "${CDK_APP}" synth --quiet )

log "Deploy (creates real resources)"
( cd "${HERE}" && ${CDK_BIN} --app "${CDK_APP}" deploy --require-approval never )

cleanup() {
  if [ "${LK_E2E_KEEP:-}" = "1" ]; then
    log "LK_E2E_KEEP=1 — leaving stack ${STACK_NAME} in place"
    return
  fi
  log "Destroy (cleanup)"
  ( cd "${HERE}" && ${CDK_BIN} --app "${CDK_APP}" destroy --force ) || echo "WARN: destroy failed; manual cleanup may be required for ${STACK_NAME}"
}
trap cleanup EXIT

log "Invoke"
OUT_FILE="$(mktemp)"
INVOKE_TS="$(date -u +%s)000"
aws lambda invoke \
  --function-name "${FUNCTION_NAME}" \
  --cli-binary-format raw-in-base64-out \
  --payload '{}' \
  --region "${REGION}" \
  "${OUT_FILE}" >/dev/null

echo "Raw response:"
cat "${OUT_FILE}"
echo

log "Assert (response body)"
node "${HERE}/assert-middleware-response.js" "${OUT_FILE}" || fail "Response assertions failed"

log "Assert (CloudWatch logs prove middleware executed)"
# Give logs a moment to propagate.
sleep 8
LOG_GROUP="/aws/lambda/${FUNCTION_NAME}"
FOUND=""
for attempt in 1 2 3 4 5 6; do
  EVENTS="$(aws logs filter-log-events \
    --log-group-name "${LOG_GROUP}" \
    --start-time "${INVOKE_TS}" \
    --region "${REGION}" \
    --query 'events[].message' \
    --output text 2>/dev/null || true)"
  if printf '%s' "${EVENTS}" | grep -q '\[Middleware\]'; then
    FOUND="yes"
    echo "Found [Middleware] log lines:"
    printf '%s\n' "${EVENTS}" | grep '\[Middleware\]' | head -5
    break
  fi
  echo "  logs not yet available (attempt ${attempt}); retrying..."
  sleep 7
done

[ -n "${FOUND}" ] || fail "No [Middleware] log lines found — middleware did not execute at runtime"

log "E2E (middleware) PASSED"

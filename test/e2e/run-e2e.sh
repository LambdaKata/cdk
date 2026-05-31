#!/usr/bin/env bash
#
# Apache-2.0
# Copyright (C) 2025-present Raman Marozau, Target Insight Function. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Real-AWS end-to-end verification for the Lambda Kata example stack.
#
# Stages: guard -> synth -> deploy -> invoke -> assert -> destroy
#
# Required env:
#   LK_E2E_ACCOUNT   target (entitled) AWS account id
# Optional env:
#   LK_E2E_REGION         default: eu-central-1
#   LK_E2E_FUNCTION_NAME  default: LambdaKataE2EConfigLayerFunction
#   LK_E2E_STACK_NAME     default: LambdaKataE2EConfigLayerStack
#   LK_E2E_KEEP           if "1", skip destroy (leave resources for inspection)
#   LK_E2E_SKIP_DEPLOY    if "1", only synth (no resource creation)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"

REGION="${LK_E2E_REGION:-eu-central-1}"
FUNCTION_NAME="${LK_E2E_FUNCTION_NAME:-LambdaKataE2EConfigLayerFunction}"
STACK_NAME="${LK_E2E_STACK_NAME:-LambdaKataE2EConfigLayerStack}"

export LK_E2E_REGION="${REGION}"
export LK_E2E_FUNCTION_NAME="${FUNCTION_NAME}"
export LK_E2E_STACK_NAME="${STACK_NAME}"

log() { printf '\n=== %s ===\n' "$1"; }
fail() { printf '\nE2E FAILED: %s\n' "$1" >&2; exit 1; }

# ── Guard: account must be set and match active credentials ──────────────────
log "Guard"
[ -n "${LK_E2E_ACCOUNT:-}" ] || fail "LK_E2E_ACCOUNT is required"

ACTIVE_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Requested account : ${LK_E2E_ACCOUNT}"
echo "Active credentials: ${ACTIVE_ACCOUNT}"
echo "Region            : ${REGION}"
[ "${ACTIVE_ACCOUNT}" = "${LK_E2E_ACCOUNT}" ] || fail "Active AWS account (${ACTIVE_ACCOUNT}) != LK_E2E_ACCOUNT (${LK_E2E_ACCOUNT})"

# ── Build artifact must exist (deploy uses out/dist, like an npm install) ────
log "Verify build artifact"
[ -f "${REPO_ROOT}/out/dist/index.js" ] || fail "Missing out/dist/index.js — run 'yarn build' first"
[ -f "${REPO_ROOT}/out/dist/snapstart-handler.js" ] || fail "Missing out/dist/snapstart-handler.js — run 'yarn build' first"

CDK_BIN="${REPO_ROOT}/node_modules/.bin/cdk"
if [ ! -x "${CDK_BIN}" ]; then
  # Fall back to npx (resolves a cached or on-demand CDK CLI).
  if command -v npx >/dev/null 2>&1; then
    CDK_BIN="npx --yes cdk"
  else
    fail "cdk CLI not found (no local binary and npx unavailable)"
  fi
fi

# ── Synth (no resources created) ─────────────────────────────────────────────
log "Synth"
( cd "${HERE}" && ${CDK_BIN} synth --quiet )

if [ "${LK_E2E_SKIP_DEPLOY:-}" = "1" ]; then
  log "SKIP_DEPLOY=1 — synth only, stopping here"
  exit 0
fi

# ── Deploy ───────────────────────────────────────────────────────────────────
log "Deploy (creates real resources)"
( cd "${HERE}" && ${CDK_BIN} deploy --require-approval never )

cleanup() {
  if [ "${LK_E2E_KEEP:-}" = "1" ]; then
    log "LK_E2E_KEEP=1 — leaving stack ${STACK_NAME} in place"
    return
  fi
  log "Destroy (cleanup)"
  ( cd "${HERE}" && ${CDK_BIN} destroy --force ) || echo "WARN: destroy failed; manual cleanup may be required for ${STACK_NAME}"
}
trap cleanup EXIT

# ── Invoke ───────────────────────────────────────────────────────────────────
log "Invoke"
OUT_FILE="$(mktemp)"
aws lambda invoke \
  --function-name "${FUNCTION_NAME}" \
  --cli-binary-format raw-in-base64-out \
  --payload '{}' \
  --region "${REGION}" \
  "${OUT_FILE}" >/dev/null

echo "Raw response:"
cat "${OUT_FILE}"
echo

# ── Assert ───────────────────────────────────────────────────────────────────
log "Assert"
node "${HERE}/assert-response.js" "${OUT_FILE}" || fail "Response assertions failed"

log "E2E PASSED"

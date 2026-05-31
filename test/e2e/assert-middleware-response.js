/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Target Insight Function. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Asserts the middleware-file example invocation returned the handler's
 * response. Combined with the CloudWatch [Middleware] log check in the runner,
 * this proves the middleware was loaded and wrapped the handler at runtime.
 *
 * Usage: node assert-middleware-response.js <responseFile>
 */

const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node assert-middleware-response.js <responseFile>');
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(file, 'utf-8'));
} catch (e) {
  console.error(`Response is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (payload && payload.errorType) {
  console.error(`Lambda returned an error: ${payload.errorType}: ${payload.errorMessage}`);
  process.exit(1);
}

let body = payload && payload.body;
if (typeof body === 'string') {
  try {
    body = JSON.parse(body);
  } catch (e) {
    console.error(`Response body is not valid JSON: ${e.message}`);
    process.exit(1);
  }
}

if (!body) {
  console.error('Response has no body to assert on.');
  process.exit(1);
}

const checks = [];
const check = (name, cond) => checks.push({ name, ok: !!cond });

check('statusCode is 200', payload.statusCode === 200);
check(
  'message is the middleware example handler message',
  body.message === 'Middleware Example - Custom Handler Resolution',
);
check('middleware section present', body.middleware && typeof body.middleware === 'object');
check(
  'handler reports it was resolved by middleware',
  body.middleware && typeof body.middleware.description === 'string' &&
  body.middleware.description.includes('resolved and wrapped by custom middleware'),
);
check('processing.simulatedWorkMs is a number (JS executed)', typeof body.processing?.simulatedWorkMs === 'number');

let allOk = true;
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!c.ok) allOk = false;
}

if (!allOk) {
  console.error('\nOne or more response assertions failed.');
  process.exit(1);
}

console.log('\nAll response assertions passed.');

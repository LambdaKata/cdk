/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Target Insight Function. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Asserts the real Lambda invocation response proves the Lambda Kata runtime
 * executed the original Node.js handler through the config layer.
 *
 * Usage: node assert-response.js <responseFile>
 */

const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node assert-response.js <responseFile>');
  process.exit(2);
}

const raw = fs.readFileSync(file, 'utf-8');

let payload;
try {
  payload = JSON.parse(raw);
} catch (e) {
  console.error(`Response is not valid JSON: ${e.message}`);
  process.exit(1);
}

// Lambda may return a FunctionError envelope on failure.
if (payload && payload.errorType) {
  console.error(`Lambda returned an error: ${payload.errorType}: ${payload.errorMessage}`);
  process.exit(1);
}

// The example handler returns an API-Gateway-style response; body is a JSON string.
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
function check(name, condition) {
  checks.push({ name, ok: !!condition });
}

check('statusCode is 200', payload.statusCode === 200);
check('body.configLayer exists', body.configLayer && typeof body.configLayer === 'object');
check('config layer file exists at runtime', body.configLayer && body.configLayer.exists === true);
check(
  'config layer path is /opt/.kata/original_handler.json',
  body.configLayer && body.configLayer.path === '/opt/.kata/original_handler.json',
);
check(
  'original_js_handler is index.handler',
  body.configLayer &&
  body.configLayer.content &&
  body.configLayer.content.original_js_handler === 'index.handler',
);
check('no config read error', body.configLayer && body.configLayer.readError == null);

let allOk = true;
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!c.ok) allOk = false;
}

if (!allOk) {
  console.error('\nOne or more runtime assertions failed.');
  process.exit(1);
}

console.log('\nAll runtime assertions passed.');

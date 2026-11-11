import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

// 1. Read .env.local exactly as PowerShell would
const envPath = path.join(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

let n8nKey = '';
let cronSecret = '';

for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed.startsWith('N8N_OPERATOR_KEY=')) {
    n8nKey = trimmed.replace(/^N8N_OPERATOR_KEY=/, '').replace(/^["']|["']$/g, '');
  }
  if (trimmed.startsWith('CRON_SECRET=')) {
    cronSecret = trimmed.replace(/^CRON_SECRET=/, '').replace(/^["']|["']$/g, '');
  }
}

console.log('=== HTTP TEST: POST http://127.0.0.1:3000/api/cron/sync-shopify ===');

// Test 1: Send N8N_OPERATOR_KEY as X-Operator-Key
console.log('\n[1] Sending N8N_OPERATOR_KEY as X-Operator-Key header...');
const res1 = await fetch('http://127.0.0.1:3000/api/cron/sync-shopify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-operator-key': n8nKey,
  },
  body: JSON.stringify({
    tenant_id: 'demo-store',
    force: true,
  }),
});

const data1 = await res1.json();
console.log('HTTP Status:', res1.status);
console.log('Response Body:', JSON.stringify(data1, null, 2));
assert.strictEqual(res1.status, 200, 'Must return HTTP 200 for valid N8N_OPERATOR_KEY');
assert.strictEqual(data1.success, true);
assert.ok(data1.results['demo-store']);

// Test 2: Send CRON_SECRET as Authorization Bearer
console.log('\n[2] Sending CRON_SECRET as Authorization: Bearer header...');
const res2 = await fetch('http://127.0.0.1:3000/api/cron/sync-shopify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cronSecret}`,
  },
  body: JSON.stringify({
    tenant_id: 'demo-store',
    force: true,
  }),
});

const data2 = await res2.json();
console.log('HTTP Status:', res2.status);
assert.strictEqual(res2.status, 200, 'Must return HTTP 200 for valid CRON_SECRET');
assert.strictEqual(data2.success, true);

// Test 3: Send placeholder key
console.log('\n[3] Sending placeholder key (__n8n_BLANK_VALUE_) as X-Operator-Key...');
const res3 = await fetch('http://127.0.0.1:3000/api/cron/sync-shopify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-operator-key': '__n8n_BLANK_VALUE_testing_placeholder',
  },
  body: JSON.stringify({}),
});

const data3 = await res3.json();
console.log('HTTP Status:', res3.status);
console.log('Error Body:', data3);
assert.strictEqual(res3.status, 401, 'Must return HTTP 401 for placeholder key');
assert.ok(data3.error.includes('Unauthorized'));

// Test 4: Send invalid key
console.log('\n[4] Sending invalid key as X-Operator-Key...');
const res4 = await fetch('http://127.0.0.1:3000/api/cron/sync-shopify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-operator-key': 'invalid_forged_key',
  },
  body: JSON.stringify({}),
});

const data4 = await res4.json();
console.log('HTTP Status:', res4.status);
console.log('Error Body:', data4);
assert.strictEqual(res4.status, 401, 'Must return HTTP 401 for invalid key');
assert.ok(data4.error.includes('Unauthorized'));

// Test 5: Missing key
console.log('\n[5] Sending request with no auth headers...');
const res5 = await fetch('http://127.0.0.1:3000/api/cron/sync-shopify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({}),
});

const data5 = await res5.json();
console.log('HTTP Status:', res5.status);
assert.strictEqual(res5.status, 401, 'Must return HTTP 401 for missing key');

console.log('\n>>> ALL LIVE HTTP CRON ENDPOINT TESTS PASSED ON PORT 3000! <<<');


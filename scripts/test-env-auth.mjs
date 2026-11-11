import { verifyOperatorOrCronAuth } from '../lib/cron-auth.ts';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

// Parse .env.local manually
const envPath = path.join(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

let parsedN8nKey = '';
let parsedCronSecret = '';

for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed.startsWith('N8N_OPERATOR_KEY=')) {
    parsedN8nKey = trimmed.replace(/^N8N_OPERATOR_KEY=/, '').replace(/^["']|["']$/g, '');
  }
  if (trimmed.startsWith('CRON_SECRET=')) {
    parsedCronSecret = trimmed.replace(/^CRON_SECRET=/, '').replace(/^["']|["']$/g, '');
  }
}

console.log('Parsed N8N_OPERATOR_KEY exists:', Boolean(parsedN8nKey));
console.log('Parsed CRON_SECRET exists:', Boolean(parsedCronSecret));

// Test 1: N8N_OPERATOR_KEY sent as X-Operator-Key
const req1 = {
  headers: {
    get: (name) => {
      if (name.toLowerCase() === 'x-operator-key') return parsedN8nKey;
      return null;
    }
  }
};
const res1 = verifyOperatorOrCronAuth(req1);
console.log('Test 1 (N8N_OPERATOR_KEY as X-Operator-Key):', res1);
assert.strictEqual(res1.authorized, true, 'Must authorize N8N_OPERATOR_KEY sent as X-Operator-Key');

// Test 2: CRON_SECRET sent as Authorization: Bearer <key>
const req2 = {
  headers: {
    get: (name) => {
      if (name.toLowerCase() === 'authorization') return `Bearer ${parsedCronSecret}`;
      return null;
    }
  }
};
const res2 = verifyOperatorOrCronAuth(req2);
console.log('Test 2 (CRON_SECRET as Authorization Bearer):', res2);
assert.strictEqual(res2.authorized, true, 'Must authorize CRON_SECRET sent as Authorization Bearer');

// Test 3: CRON_SECRET sent as X-Operator-Key
const req3 = {
  headers: {
    get: (name) => {
      if (name.toLowerCase() === 'x-operator-key') return parsedCronSecret;
      return null;
    }
  }
};
const res3 = verifyOperatorOrCronAuth(req3);
console.log('Test 3 (CRON_SECRET as X-Operator-Key):', res3);
assert.strictEqual(res3.authorized, true, 'Must authorize CRON_SECRET sent as X-Operator-Key');

// Test 4: N8N_OPERATOR_KEY sent as Authorization: Bearer <key>
const req4 = {
  headers: {
    get: (name) => {
      if (name.toLowerCase() === 'authorization') return `Bearer ${parsedN8nKey}`;
      return null;
    }
  }
};
const res4 = verifyOperatorOrCronAuth(req4);
console.log('Test 4 (N8N_OPERATOR_KEY as Authorization Bearer):', res4);
assert.strictEqual(res4.authorized, true, 'Must authorize N8N_OPERATOR_KEY sent as Authorization Bearer');

// Test 5: Invalid key
const req5 = {
  headers: {
    get: (name) => {
      if (name.toLowerCase() === 'x-operator-key') return 'invalid_random_key_123';
      return null;
    }
  }
};
const res5 = verifyOperatorOrCronAuth(req5);
console.log('Test 5 (Invalid key):', res5);
assert.strictEqual(res5.authorized, false, 'Must reject invalid key');

// Test 6: Missing key
const req6 = {
  headers: {
    get: () => null
  }
};
const res6 = verifyOperatorOrCronAuth(req6);
console.log('Test 6 (Missing key):', res6);
assert.strictEqual(res6.authorized, false, 'Must reject missing key');

console.log('\n>>> ALL ENV AUTH VERIFICATION TESTS PASSED! <<<');

import fs from 'node:fs';

function loadEnv() {
  const env = {};
  if (fs.existsSync('.env.local')) {
    const lines = fs.readFileSync('.env.local', 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let val = match[2] || '';
        val = val.trim().replace(/^["'](.*)["']$/, '$1');
        env[match[1]] = val;
      }
    }
  }
  return env;
}

const env = loadEnv();
const operatorKey = env.N8N_OPERATOR_KEY || env.CRON_SECRET;

console.log('Testing POST http://localhost:3000/api/cron/order-issues/followup...');
const res = await fetch('http://localhost:3000/api/cron/order-issues/followup', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${operatorKey}`,
    'X-Operator-Key': operatorKey,
  },
  body: JSON.stringify({ worker: 'manual_admin_trigger' }),
});

console.log('HTTP Status:', res.status);
const data = await res.json();
console.log('Response Payload:\n', JSON.stringify(data, null, 2));

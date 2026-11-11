import assert from 'node:assert';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read .env.local
let cronSecret = process.env.CRON_SECRET || process.env.N8N_OPERATOR_KEY || '';
let baseUrl = 'http://localhost:3000';

try {
  const envContent = fs.readFileSync(join(__dirname, '../.env.local'), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('CRON_SECRET=')) {
      cronSecret = trimmed.replace(/^CRON_SECRET=/, '').replace(/^["']|["']$/g, '');
    } else if (trimmed.startsWith('N8N_OPERATOR_KEY=') && !cronSecret) {
      cronSecret = trimmed.replace(/^N8N_OPERATOR_KEY=/, '').replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // ignore
}

const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo' });

async function runTests() {
  console.log('=== TEST SUITE: Scheduled Shopify Sync via Operator / n8n ===');

  // Test 1: Verify 401 Unauthorized on invalid operator key
  console.log('\n[1] Testing Unauthorized rejection with invalid key...');
  const resUnauth = await fetch(`${baseUrl}/api/cron/sync-shopify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer invalid_secret_12345',
      'x-operator-key': 'invalid_secret_12345',
    },
    body: JSON.stringify({}),
  });

  console.log('Unauthenticated status code:', resUnauth.status);
  assert.strictEqual(resUnauth.status, 401, 'Invalid operator key must be rejected with HTTP 401');

  // Test 1b: Missing auth header returns 401
  const resMissing = await fetch(`${baseUrl}/api/cron/sync-shopify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  console.log('Missing auth status code:', resMissing.status);
  assert.strictEqual(resMissing.status, 401, 'Missing operator key must be rejected with HTTP 401');

  // Test 2a: Valid X-Operator-Key header (n8n Header Auth standard)
  console.log('\n[2a] Testing Authorized scheduled sync via X-Operator-Key...');
  const resXOperator = await fetch(`${baseUrl}/api/cron/sync-shopify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operator-key': cronSecret,
    },
    body: JSON.stringify({
      tenant_id: 'demo-store',
      force: true,
    }),
  });

  const xOpData = await resXOperator.json();
  console.log('X-Operator-Key response status:', resXOperator.status);
  assert.strictEqual(resXOperator.status, 200, 'X-Operator-Key must return HTTP 200');
  assert.strictEqual(xOpData.success, true);

  // Test 2b: Valid Authorization Bearer header
  console.log('\n[2b] Testing Authorized scheduled sync via Authorization: Bearer <key>...');
  const resBearer = await fetch(`${baseUrl}/api/cron/sync-shopify`, {
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

  const bearerData = await resBearer.json();
  console.log('Authorization Bearer response status:', resBearer.status);
  assert.strictEqual(resBearer.status, 200, 'Authorization Bearer must return HTTP 200');
  assert.strictEqual(bearerData.success, true);

  const demoStoreRes = bearerData.results['demo-store'];
  console.log('demo-store sync status:', demoStoreRes.status);
  assert.ok(
    demoStoreRes.status === 'completed' || demoStoreRes.status === 'partial_failed',
    `Expected completed or partial_failed, got ${demoStoreRes.status}`
  );
  assert.ok(typeof demoStoreRes.products_synced === 'number', 'Must report products_synced count');

  // Test 3: Overlapping prevention test
  console.log('\n[3] Testing Overlapping sync prevention (without force)...');
  // Trigger a fast second call right after
  if (demoStoreRes.job_id) {
    // Set status of that job to running in DB to simulate an active background sync
    await pool.query(
      "UPDATE iao.shopify_sync_jobs SET status = 'running', created_at = NOW() WHERE id = $1;",
      [demoStoreRes.job_id]
    );

    const resOverlap = await fetch(`${baseUrl}/api/cron/sync-shopify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-operator-key': cronSecret,
      },
      body: JSON.stringify({
        tenant_id: 'demo-store',
        force: false,
      }),
    });

    const overlapData = await resOverlap.json();
    console.log('Overlap test response:', overlapData);
    assert.strictEqual(resOverlap.status, 200);
    const overlapResult = overlapData.results['demo-store'];
    assert.strictEqual(overlapResult.status, 'skipped_overlapping', 'Must skip overlapping sync');

    // Clean up
    await pool.query(
      "UPDATE iao.shopify_sync_jobs SET status = 'completed' WHERE id = $1;",
      [demoStoreRes.job_id]
    );
  }

  // Test 4: Validate n8n workflow file
  console.log('\n[4] Validating n8n workflow JSON file...');
  const workflowFile = join(__dirname, '../n8n-workflows/shopify-scheduled-sync.json');
  assert.ok(fs.existsSync(workflowFile), 'n8n workflow file must exist');

  const workflow = JSON.parse(fs.readFileSync(workflowFile, 'utf-8'));
  assert.strictEqual(workflow.name, 'Industry AI Operator - Shopify Store Scheduled Sync');
  
  const httpNode = workflow.nodes.find(n => n.type === 'n8n-nodes-base.httpRequest');
  assert.ok(httpNode, 'Must contain HTTP Request node');
  assert.strictEqual(httpNode.parameters.url, 'http://host.docker.internal:3000/api/cron/sync-shopify');
  assert.strictEqual(httpNode.parameters.method, 'POST');
  assert.strictEqual(httpNode.parameters.options.retry.retry.maxTries, 3);
  assert.strictEqual(httpNode.credentials.httpHeaderAuth.id, 'iao_operator_key');

  // Ensure NO secrets are leaked in JSON
  const rawJson = JSON.stringify(workflow);
  assert.ok(!rawJson.includes(cronSecret), 'Exported workflow JSON must NOT contain plaintext secrets');

  console.log('\n>>> ALL SHOPIFY SCHEDULED SYNC & N8N TESTS PASSED! <<<');
  await pool.end();
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

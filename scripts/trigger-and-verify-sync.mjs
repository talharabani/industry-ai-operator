import fs from 'fs';
import pg from 'pg';

try {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
} catch (e) {}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/iao_demo',
});

async function main() {
  console.log('--- 1. Triggering Shopify Store Sync via API ---');
  const syncRes = await fetch('http://localhost:3000/api/business/connections/shopify/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  console.log('Sync Endpoint HTTP Status:', syncRes.status);
  const syncJson = await syncRes.json();
  console.log('Sync Response Body:', JSON.stringify(syncJson, null, 2));

  console.log('\n--- 2. Waiting for sync execution (2 seconds) ---');
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log('\n--- 3. Verifying Imported Orders in Database ---');
  const orderRows = await pool.query(
    `SELECT tenant_id, order_id, customer_name, customer_email, total, currency, status, data, created_at
     FROM iao.orders
     WHERE tenant_id = 'demo-store'
     ORDER BY created_at DESC;`
  );

  console.log(`Total orders in DB: ${orderRows.rows.length}`);
  for (const o of orderRows.rows) {
    console.log(`- Order: [${o.order_id}] | Customer: ${o.customer_name} (${o.customer_email}) | Total: ${o.currency} ${o.total} | Status: ${o.status} | Source: ${o.data?.source || 'demo'}`);
  }

  console.log('\n--- 4. Verifying Shopify Connection Status in DB ---');
  const connRows = await pool.query(
    `SELECT tenant_id, shop_domain, sync_status, last_error, last_synced_at FROM iao.shopify_connections WHERE tenant_id = 'demo-store';`
  );
  console.log('Connection Row:', JSON.stringify(connRows.rows[0], null, 2));

  console.log('\n--- 5. Verifying Public Connection API Response ---');
  const publicRes = await fetch('http://localhost:3000/api/business/connections/shopify');
  const publicJson = await publicRes.json();
  console.log('Public API Output:', JSON.stringify(publicJson, null, 2));

  await pool.end();
}

main().catch(console.error);

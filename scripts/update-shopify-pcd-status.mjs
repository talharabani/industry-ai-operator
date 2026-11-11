import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/iao_demo',
});

async function main() {
  await pool.query(
    `UPDATE iao.shopify_connections
     SET sync_status = 'partial_failed',
         last_error = 'Products synced; order access blocked (Shopify Protected Customer Data approval required in Partner Dashboard)',
         updated_at = NOW()
     WHERE tenant_id = 'demo-store';`
  );

  const res = await pool.query(
    `SELECT tenant_id, shop_domain, sync_status, last_error, last_synced_at FROM iao.shopify_connections WHERE tenant_id = 'demo-store';`
  );

  console.log('Updated Shopify connection row:', JSON.stringify(res.rows[0], null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

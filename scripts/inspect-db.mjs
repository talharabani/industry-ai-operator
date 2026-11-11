import pg from 'pg';

const pool = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo' });

async function main() {
  const conns = await pool.query('SELECT tenant_id, shop_domain, is_connected, store_info FROM iao.shopify_connections;');
  console.log('=== SHOPIFY CONNECTIONS ===\n', JSON.stringify(conns.rows, null, 2));

  const liquid = await pool.query(`SELECT shopify_product_id, title, variants, raw_data FROM iao.shopify_products WHERE title ILIKE '%Liquid%';`);
  console.log('=== LIQUID SNOWBOARD ===\n', JSON.stringify(liquid.rows, null, 2));

  await pool.end();
}

main().catch(console.error);

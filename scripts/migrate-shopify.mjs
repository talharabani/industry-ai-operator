import { Pool } from 'pg';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let dbUrl = process.env.DATABASE_URL;
try {
  const envContent = fs.readFileSync(join(__dirname, '../.env.local'), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('DATABASE_URL=')) {
      dbUrl = trimmed.replace(/^DATABASE_URL=/, '').replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // ignore
}

if (!dbUrl) {
  dbUrl = 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo';
}

console.log('Running additive Shopify migration on:', dbUrl.replace(/:[^:@]+@/, ':****@'));
const pool = new Pool({ connectionString: dbUrl });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS iao;

      -- Shopify Connections table
      CREATE TABLE IF NOT EXISTS iao.shopify_connections (
        tenant_id TEXT PRIMARY KEY,
        shop_domain TEXT NOT NULL,
        encrypted_access_token TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'read_products,read_orders,read_inventory,read_locations',
        is_connected BOOLEAN NOT NULL DEFAULT true,
        sync_status TEXT NOT NULL DEFAULT 'idle',
        last_synced_at TIMESTAMPTZ,
        last_error TEXT,
        store_info JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_shopify_shop_domain ON iao.shopify_connections(shop_domain);

      -- Shopify Sync Jobs table
      CREATE TABLE IF NOT EXISTS iao.shopify_sync_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        shop_domain TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        sync_types TEXT[] NOT NULL DEFAULT '{"products","inventory","policies","orders"}',
        progress JSONB NOT NULL DEFAULT '{}'::jsonb,
        summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_details JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_shopify_sync_jobs_tenant ON iao.shopify_sync_jobs(tenant_id, created_at DESC);

      -- Shopify Products table
      CREATE TABLE IF NOT EXISTS iao.shopify_products (
        tenant_id TEXT NOT NULL,
        shopify_product_id TEXT NOT NULL,
        title TEXT NOT NULL,
        handle TEXT,
        product_type TEXT,
        vendor TEXT,
        status TEXT DEFAULT 'active',
        variants JSONB NOT NULL DEFAULT '[]'::jsonb,
        options JSONB NOT NULL DEFAULT '[]'::jsonb,
        raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, shopify_product_id)
      );

      CREATE INDEX IF NOT EXISTS idx_shopify_products_tenant ON iao.shopify_products(tenant_id, updated_at DESC);
    `);

    console.log('✅ Additive Shopify tables migrated successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

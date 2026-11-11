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

console.log('Running additive Custom Store migration on:', dbUrl.replace(/:[^:@]+@/, ':****@'));
const pool = new Pool({ connectionString: dbUrl });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS iao;

      -- 1. Custom Store Connections table
      CREATE TABLE IF NOT EXISTS iao.custom_store_connections (
        id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        store_name TEXT NOT NULL,
        website_url TEXT NOT NULL,
        api_base_url TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'bearer',
        encrypted_credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
        webhook_secret TEXT,
        is_connected BOOLEAN NOT NULL DEFAULT true,
        sync_status TEXT NOT NULL DEFAULT 'idle',
        last_synced_at TIMESTAMPTZ,
        last_error TEXT,
        sync_checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
        store_info JSONB NOT NULL DEFAULT '{}'::jsonb,
        product_count INTEGER NOT NULL DEFAULT 0,
        order_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, id)
      );

      CREATE INDEX IF NOT EXISTS idx_custom_store_tenant ON iao.custom_store_connections(tenant_id);

      -- 2. Custom Store Products table
      CREATE TABLE IF NOT EXISTS iao.custom_store_products (
        tenant_id TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        external_product_id TEXT NOT NULL,
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
        PRIMARY KEY (tenant_id, connection_id, external_product_id)
      );

      CREATE INDEX IF NOT EXISTS idx_custom_store_products_lookup 
        ON iao.custom_store_products(tenant_id, connection_id, updated_at DESC);

      -- 3. Custom Store Sync Jobs table
      CREATE TABLE IF NOT EXISTS iao.custom_store_sync_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        sync_types TEXT[] NOT NULL DEFAULT '{"store","products","orders"}',
        progress JSONB NOT NULL DEFAULT '{}'::jsonb,
        summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_details JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_custom_store_sync_jobs_tenant 
        ON iao.custom_store_sync_jobs(tenant_id, connection_id, created_at DESC);

      -- 4. Additive columns to iao.orders to support shared store identity and prevent collisions
      ALTER TABLE iao.orders ADD COLUMN IF NOT EXISTS connection_id TEXT;
      ALTER TABLE iao.orders ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'shopify';
      ALTER TABLE iao.orders ADD COLUMN IF NOT EXISTS external_order_id TEXT;
      ALTER TABLE iao.orders ADD COLUMN IF NOT EXISTS order_number TEXT;

      CREATE INDEX IF NOT EXISTS idx_orders_shared_identity 
        ON iao.orders(tenant_id, provider, connection_id, external_order_id);
      CREATE INDEX IF NOT EXISTS idx_orders_order_number 
        ON iao.orders(tenant_id, order_number);

      -- 5. Additive column to iao.order_issues to associate with specific store connection
      ALTER TABLE iao.order_issues ADD COLUMN IF NOT EXISTS connection_id TEXT;
      ALTER TABLE iao.order_issues ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'shopify';
      ALTER TABLE iao.order_issues ADD COLUMN IF NOT EXISTS external_order_id TEXT;
      ALTER TABLE iao.order_issues ADD COLUMN IF NOT EXISTS order_number TEXT;

      CREATE INDEX IF NOT EXISTS idx_order_issues_connection 
        ON iao.order_issues(tenant_id, connection_id);
    `);

    console.log('✅ Additive Custom Store tables and columns migrated successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

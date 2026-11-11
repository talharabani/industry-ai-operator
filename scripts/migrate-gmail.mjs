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
  console.error('DATABASE_URL is not configured in .env.local');
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Applying Gmail connections and OAuth states schema migrations...');

    await client.query(`
      -- 1. Per-business Gmail Connections
      CREATE TABLE IF NOT EXISTS iao.gmail_connections (
        tenant_id TEXT PRIMARY KEY REFERENCES iao.businesses(tenant_id) ON DELETE CASCADE,
        google_email TEXT NOT NULL,
        google_sub TEXT,
        google_name TEXT,
        google_avatar TEXT,
        encrypted_access_token TEXT NOT NULL,
        encrypted_refresh_token TEXT,
        token_expiry TIMESTAMPTZ NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        history_id TEXT,
        initial_sync_completed BOOLEAN NOT NULL DEFAULT false,
        sync_status TEXT NOT NULL DEFAULT 'idle',
        last_synced_at TIMESTAMPTZ,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Enforce that a single Gmail mailbox cannot be assigned to multiple businesses in this MVP
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_email_unique ON iao.gmail_connections(google_email);
      CREATE INDEX IF NOT EXISTS idx_gmail_sync_status ON iao.gmail_connections(sync_status);

      -- 2. Expiring, Single-Use PKCE OAuth State Bindings
      CREATE TABLE IF NOT EXISTS iao.oauth_states (
        state TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES iao.businesses(tenant_id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        code_verifier TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON iao.oauth_states(expires_at, used);

      -- 3. Ingestion and Dispatch Indexes
      CREATE INDEX IF NOT EXISTS idx_conversations_ext_thread ON iao.conversations(tenant_id, external_thread_id);
    `);

    console.log('Gmail connections and OAuth states tables verified successfully!');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

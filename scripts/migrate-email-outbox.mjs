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
    console.log('Connecting to PostgreSQL to apply email credentials and outbox schema...');

    await client.query(`
      -- 1. Tenant-scoped Encrypted Email Credentials
      CREATE TABLE IF NOT EXISTS iao.email_credentials (
        tenant_id TEXT PRIMARY KEY REFERENCES iao.businesses(tenant_id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'resend',
        mode TEXT NOT NULL DEFAULT 'demo',
        encrypted_api_key TEXT,
        key_fingerprint TEXT,
        sender_name TEXT,
        sender_email TEXT,
        reply_to TEXT,
        is_verified BOOLEAN NOT NULL DEFAULT false,
        last_tested TIMESTAMPTZ,
        last_error TEXT,
        webhook_signing_secret TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_email_credentials_mode ON iao.email_credentials(mode, is_verified);

      -- 2. Durable Outbox & Atomic Dispatch Records
      CREATE TABLE IF NOT EXISTS iao.message_dispatches (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES iao.messages(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES iao.conversations(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL REFERENCES iao.businesses(tenant_id) ON DELETE CASCADE,
        idempotency_key TEXT UNIQUE NOT NULL,
        provider TEXT NOT NULL DEFAULT 'resend',
        provider_message_id TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        recipient_email TEXT NOT NULL,
        sender_email TEXT NOT NULL,
        sender_name TEXT,
        reply_to TEXT,
        subject TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMPTZ,
        last_error TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_dispatches_tenant_status ON iao.message_dispatches(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_dispatches_provider_msg ON iao.message_dispatches(provider_message_id);

      -- 3. Webhook Events (Svix / Resend Webhook Event Log for Idempotency & Replay Protection)
      CREATE TABLE IF NOT EXISTS iao.webhook_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'resend',
        event_id TEXT UNIQUE NOT NULL,
        event_type TEXT NOT NULL,
        provider_message_id TEXT,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'processed',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_events_msg ON iao.webhook_events(provider_message_id);
    `);

    console.log('Email credentials, message dispatches outbox, and webhook events tables verified.');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

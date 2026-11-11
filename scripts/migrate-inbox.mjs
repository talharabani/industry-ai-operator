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
    console.log('Connecting to PostgreSQL to apply additive inbox schema migrations...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS iao.conversations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        customer_phone TEXT,
        channel TEXT NOT NULL DEFAULT 'hosted_inquiry',
        external_thread_id TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        subject TEXT,
        unread BOOLEAN NOT NULL DEFAULT true,
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON iao.conversations (tenant_id, last_message_at DESC);

      CREATE TABLE IF NOT EXISTS iao.messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES iao.conversations(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        sender_email TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'received',
        approval_status TEXT NOT NULL DEFAULT 'none',
        approved_by TEXT,
        approved_at TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON iao.messages (conversation_id, created_at ASC);
    `);

    // Seed initial demo conversation if empty
    const countRes = await client.query('SELECT COUNT(*) as count FROM iao.conversations WHERE tenant_id = $1;', ['demo-store']);
    if (parseInt(countRes.rows[0]?.count || '0', 10) === 0) {
      console.log('Seeding initial demo conversations for demo-store...');
      const convId1 = 'conv-demo-001';
      const convId2 = 'conv-demo-002';

      await client.query(`
        INSERT INTO iao.conversations (id, tenant_id, customer_name, customer_email, customer_phone, channel, status, subject, unread, last_message_at, created_at, updated_at)
        VALUES 
        ($1, 'demo-store', 'Hassan Raza', 'hassan.raza@example.com', '+92 301 5551234', 'hosted_inquiry', 'open', 'Question about Jacket M size stock & fabric', true, NOW(), NOW() - INTERVAL '2 hours', NOW()),
        ($2, 'demo-store', 'Ayesha Malik', 'ayesha.m@example.com', '+92 321 8889999', 'email', 'pending_approval', 'Request for exchange on Order ORD-1001', false, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', NOW())
        ON CONFLICT (id) DO NOTHING;
      `, [convId1, convId2]);

      await client.query(`
        INSERT INTO iao.messages (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
        VALUES
        ('msg-101', $1, 'demo-store', 'customer', 'Hassan Raza', 'hassan.raza@example.com', 'Hello, is the Classic Leather Jacket in Medium true to size? Also when will you restock the Black color?', 'received', 'none', '{}'::jsonb, NOW() - INTERVAL '2 hours'),
        ('msg-102', $2, 'demo-store', 'customer', 'Ayesha Malik', 'ayesha.m@example.com', 'Hi, I received my package yesterday but need to exchange for a smaller size. Can you guide me on the return process?', 'received', 'none', '{}'::jsonb, NOW() - INTERVAL '1 day'),
        ('msg-103', $2, 'demo-store', 'ai_draft', 'AI Operator (Groq)', NULL, 'Hi Ayesha! Thank you for reaching out. We would be happy to help you with your exchange. Our return and exchange window is 14 days from confirmed delivery. Please keep the jacket unworn with tags attached. Reply with your preferred size and we will reserve it for you!', 'draft', 'pending_approval', '{"draft_revision": 1, "tone": "friendly and concise"}'::jsonb, NOW() - INTERVAL '23 hours')
        ON CONFLICT (id) DO NOTHING;
      `, [convId1, convId2]);
    }

    console.log('Unified Inbox database migrations and initial seed applied successfully!');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

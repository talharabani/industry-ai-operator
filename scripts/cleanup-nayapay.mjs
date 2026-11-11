import { Pool } from 'pg';
import fs from 'fs';

function loadEnvLocal() {
  if (fs.existsSync('.env.local')) {
    const lines = fs.readFileSync('.env.local', 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let val = match[2] || '';
        val = val.trim().replace(/^["'](.*)["']$/, '$1');
        process.env[match[1]] = val;
      }
    }
  }
}
loadEnvLocal();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/iao_demo',
});

async function main() {
  console.log('--- Inspecting NayaPay Records ---');
  const convs = await pool.query(`SELECT id, customer_name, customer_email, status, unread, subject FROM iao.conversations WHERE LOWER(customer_email) LIKE '%nayapay%'`);
  console.log('Conversations:', convs.rows);

  const msgs = await pool.query(`
    SELECT m.id, m.conversation_id, m.sender_type, m.status, m.approval_status, m.body
    FROM iao.messages m
    JOIN iao.conversations c ON m.conversation_id = c.id
    WHERE LOWER(c.customer_email) LIKE '%nayapay%'
  `);
  console.log('Messages count:', msgs.rows.length);
  for (const m of msgs.rows) {
    console.log(`- Msg: ${m.id} (${m.sender_type}, status=${m.status}, approval=${m.approval_status}) in ${m.conversation_id}: ${m.body.substring(0, 60)}...`);
  }

  // Update non-customer/NayaPay conversations to status='ignored', unread=false
  const convUpdate = await pool.query(`
    UPDATE iao.conversations
    SET status = 'ignored', unread = false, updated_at = NOW()
    WHERE LOWER(customer_email) LIKE '%nayapay%' AND status != 'ignored'
    RETURNING id;
  `);
  console.log('Updated conversations to ignored:', convUpdate.rows.map(r => r.id));

  // For any unsent drafts (not provider_accepted/sent/simulated_demo), reject and mark ignored while strictly preserving sent history
  const draftUpdate = await pool.query(`
    UPDATE iao.messages
    SET status = 'ignored', approval_status = 'rejected'
    WHERE id IN (
      SELECT m.id
      FROM iao.messages m
      JOIN iao.conversations c ON m.conversation_id = c.id
      WHERE LOWER(c.customer_email) LIKE '%nayapay%'
        AND m.sender_type IN ('ai_draft')
        AND m.status NOT IN ('provider_accepted', 'sent')
    )
    RETURNING id;
  `);
  console.log('Blocked unsent drafts:', draftUpdate.rows.map(r => r.id));

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

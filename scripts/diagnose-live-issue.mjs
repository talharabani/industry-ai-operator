import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

function getDbUrl() {
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('DATABASE_URL=')) {
        return trimmed.replace(/^DATABASE_URL=/, '').replace(/^["']|["']$/g, '');
      }
    }
  } catch {}
  return 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo';
}

const pool = new Pool({ connectionString: getDbUrl() });

async function main() {
  console.log('=== Target Conv: conv-gm-muz89580-3qkp ===');
  const conv = await pool.query('SELECT * FROM iao.conversations WHERE id = $1', ['conv-gm-muz89580-3qkp']);
  console.log(conv.rows[0]);

  const msgs = await pool.query('SELECT id, sender_type, sender_name, sender_email, status, approval_status, body, metadata, created_at FROM iao.messages WHERE conversation_id = $1 ORDER BY created_at ASC', ['conv-gm-muz89580-3qkp']);
  msgs.rows.forEach(m => {
    console.log(`\n--- MSG ${m.id} (${m.sender_type}, status=${m.status}, approval=${m.approval_status}) ---`);
    console.log('BODY:\n' + m.body);
    console.log('METADATA:', JSON.stringify(m.metadata));
  });

  const issues = await pool.query('SELECT * FROM iao.order_issues WHERE conversation_id = $1', ['conv-gm-muz89580-3qkp']);
  console.log('\n--- ISSUES ---');
  issues.rows.forEach(i => {
    console.log(i.id, i.issue_type, i.status, i.next_action, i.responsible_party);
    console.log('Evidence:', JSON.stringify(i.evidence, null, 2));
  });

  const nayapayConvs = await pool.query(`
    SELECT c.id, c.customer_name, c.customer_email, c.subject, c.status, c.created_at
    FROM iao.conversations c
    WHERE c.customer_email ILIKE '%nayapay%' OR c.subject ILIKE '%nayapay%' OR c.customer_name ILIKE '%nayapay%'
    ORDER BY c.created_at DESC
  `);
  console.log('\n=== ALL NAYAPAY CONVERSATIONS ===');
  for (const c of nayapayConvs.rows) {
    console.log(`\nConv: ${c.id} | ${c.customer_name} <${c.customer_email}> | Subject: "${c.subject}" | Status: ${c.status}`);
    const cMsgs = await pool.query('SELECT id, sender_type, sender_name, status, approval_status, body, metadata FROM iao.messages WHERE conversation_id = $1 ORDER BY created_at ASC', [c.id]);
    for (const m of cMsgs.rows) {
      console.log(`  Msg: ${m.id} | ${m.sender_type} | status: ${m.status} | approval: ${m.approval_status}`);
      console.log('  Body snippet:', m.body.substring(0, 160).replace(/\n/g, ' '));
    }
    const dispatches = await pool.query('SELECT id, status, recipient_email FROM iao.message_dispatches WHERE conversation_id = $1', [c.id]);
    console.log('  Dispatches:', dispatches.rows);
  }

  await pool.end();
}

main().catch(console.error);

import { Pool } from 'pg';

const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo' });

async function main() {
  const msgs = await pool.query('SELECT id, sender_type, sender_name, sender_email, status, body, created_at, metadata FROM iao.messages WHERE conversation_id = $1 ORDER BY created_at ASC', ['conv-gm-muxzpm9n-o6wr']);
  for (let i = 0; i < msgs.rows.length; i++) {
    const m = msgs.rows[i];
    const firstLine = m.body.split('\n').filter(l => l.trim()).slice(0, 3).join(' | ');
    console.log(`[${i+1}] ${m.id} | ${m.sender_type} | ${m.sender_name} | ${m.status} | ${m.created_at.toISOString()}`);
    console.log('    First lines:', firstLine.substring(0, 140));
    console.log('    Intent:', m.metadata?.routine_intent, '| Reason:', m.metadata?.reason);
  }
  await pool.end();
}

main().catch(console.error);

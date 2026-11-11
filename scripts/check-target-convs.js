const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo' });

async function run() {
  const ids = [
    'conv-muv1wbpb-xwp4',
    'conv-gm-muv00ekm-p5tq',
    'conv-gm-muv00doa-6985',
    'conv-gm-muv00h9d-coiv'
  ];

  for (const id of ids) {
    console.log('=== Checking ID:', id, '===');
    const conv = await pool.query('SELECT * FROM iao.conversations WHERE id = $1;', [id]);
    console.log('Conversation:', conv.rows);
    const msgs = await pool.query('SELECT id, conversation_id, sender_type, left(body, 60) as body FROM iao.messages WHERE conversation_id = $1;', [id]);
    console.log('Messages:', msgs.rows);
  }

  console.log('=== Checking all conversations in iao.conversations ===');
  const all = await pool.query('SELECT id, tenant_id, customer_name, customer_email, channel, created_at FROM iao.conversations ORDER BY created_at DESC LIMIT 20;');
  console.table(all.rows);
}

run().then(() => pool.end()).catch(console.error);

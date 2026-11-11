import pg from 'pg';
const { Pool } = pg;

async function main() {
  const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo' });
  const { rows } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='iao' ORDER BY table_name");
  console.log('Tables in iao schema:', rows.map(r => r.table_name));

  // Check sync jobs
  if (rows.some(r => r.table_name.includes('sync'))) {
    const syncTables = rows.filter(r => r.table_name.includes('sync')).map(r => r.table_name);
    for (const t of syncTables) {
      const countRes = await pool.query(`SELECT COUNT(*) as c FROM iao.${t}`);
      console.log(`Table iao.${t} row count:`, countRes.rows[0].c);
      const sample = await pool.query(`SELECT * FROM iao.${t} ORDER BY 1 DESC LIMIT 5`);
      console.log(`Sample from iao.${t}:`, JSON.stringify(sample.rows, null, 2));
    }
  }

  await pool.end();
}

main().catch(console.error);

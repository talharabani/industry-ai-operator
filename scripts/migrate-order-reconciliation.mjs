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

console.log('Running additive Order Reconciliation migration on:', dbUrl.replace(/:[^:@]+@/, ':****@'));
const pool = new Pool({ connectionString: dbUrl });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS iao;

      -- Add associated_task_id to order_issue_followup_jobs to allow fine-grained task-level reminder cancellation
      ALTER TABLE iao.order_issue_followup_jobs 
      ADD COLUMN IF NOT EXISTS associated_task_id TEXT;

      CREATE INDEX IF NOT EXISTS idx_order_issue_followups_task 
      ON iao.order_issue_followup_jobs(tenant_id, issue_id, associated_task_id);

      -- Index order_issues by shop_domain
      CREATE INDEX IF NOT EXISTS idx_order_issues_shop_domain 
      ON iao.order_issues(tenant_id, shop_domain);
    `);

    console.log('✔ Additive Order Reconciliation migration applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

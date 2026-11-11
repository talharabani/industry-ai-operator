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

async function run() {
  const issues = await pool.query("SELECT * FROM iao.order_issues WHERE tenant_id = 'demo-store' AND order_id = '#1001'");
  console.log('=== Issues for #1001 ===');
  console.log(JSON.stringify(issues.rows, null, 2));

  if (issues.rows.length > 0) {
    const issueId = issues.rows[0].id;
    const events = await pool.query("SELECT * FROM iao.order_issue_events WHERE tenant_id = 'demo-store' AND issue_id = $1 ORDER BY created_at ASC", [issueId]);
    console.log('=== Events for issue ' + issueId + ' ===');
    console.log(JSON.stringify(events.rows, null, 2));

    const jobs = await pool.query("SELECT *, scheduled_for AT TIME ZONE 'Asia/Karachi' as scheduled_for_karachi, created_at AT TIME ZONE 'Asia/Karachi' as created_at_karachi FROM iao.order_issue_followup_jobs WHERE tenant_id = 'demo-store' AND issue_id = $1 ORDER BY created_at ASC", [issueId]);
    console.log('=== Jobs for issue ' + issueId + ' ===');
    console.log(JSON.stringify(jobs.rows, null, 2));
  }

  const allJobs = await pool.query("SELECT *, scheduled_for AT TIME ZONE 'Asia/Karachi' as scheduled_for_karachi FROM iao.order_issue_followup_jobs WHERE tenant_id = 'demo-store' ORDER BY created_at DESC");
  console.log('=== All Jobs in demo-store ===');
  console.log(JSON.stringify(allJobs.rows, null, 2));

  await pool.end();
}
run().catch(err => {
  console.error(err);
  process.exit(1);
});

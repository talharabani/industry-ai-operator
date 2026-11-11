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

import { scheduleOrderIssueFollowup, getOrderIssue } from '../lib/order-issues.ts';

async function main() {
  const tenantId = 'demo-store';
  const issueId = 'issue_muz895uh_xsxr';
  const issue = await getOrderIssue(tenantId, issueId);

  if (!issue) {
    console.error('Issue not found!');
    process.exit(1);
  }

  console.log('Issue found:', {
    id: issue.id,
    status: issue.status,
    order_id: issue.order_id,
    customer_name: issue.customer_name,
    customer_email: issue.customer_email,
  });

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/iao_demo',
  });

  // Check if active job exists
  const existingJobs = await pool.query(
    `SELECT * FROM iao.order_issue_followup_jobs
     WHERE tenant_id = $1 AND issue_id = $2 AND status IN ('pending', 'claimed')`,
    [tenantId, issueId]
  );

  if (existingJobs.rows.length === 0) {
    console.log('Scheduling replacement owner reminder job for issue...');
    const scheduledJob = await scheduleOrderIssueFollowup({
      tenantId,
      issueId: issue.id,
      conversationId: issue.conversation_id,
      followupType: 'awaiting_owner_review',
      delayHours: 24,
      maxAttempts: 2,
    });
    console.log('Scheduled job:', scheduledJob);
  } else {
    console.log('Active job already exists:', existingJobs.rows);
  }

  const jobsAfter = await pool.query(
    `SELECT *,
      scheduled_for AT TIME ZONE 'Asia/Karachi' as scheduled_for_karachi,
      created_at AT TIME ZONE 'Asia/Karachi' as created_at_karachi
     FROM iao.order_issue_followup_jobs
     WHERE tenant_id = $1 AND issue_id = $2
     ORDER BY created_at DESC`,
    [tenantId, issueId]
  );
  console.log('All jobs for issue in PKT:', jobsAfter.rows);

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

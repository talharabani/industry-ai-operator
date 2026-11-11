import { query } from '../lib/order-issues.ts';

async function inspectOverdueReminder() {
  console.log('=== READ-ONLY INSPECTION OF LIVE REMINDER #1001 ===\n');

  const issueRows = await query(
    `SELECT * FROM iao.order_issues WHERE id = $1;`,
    ['issue_muz895uh_xsxr']
  );
  const issue = issueRows[0];

  const targetJobRows = await query(
    `SELECT * FROM iao.order_issue_followup_jobs WHERE id = $1;`,
    ['fjob_muzdc9x3_5qgp']
  );
  const targetJob = targetJobRows[0];

  const allJobs = await query(
    `SELECT id, status, followup_type, attempt_count, max_attempts, scheduled_for, claimed_at, claimed_by, last_error, associated_task_id, metadata, created_at, updated_at
     FROM iao.order_issue_followup_jobs
     WHERE issue_id = $1
     ORDER BY created_at ASC;`,
    ['issue_muz895uh_xsxr']
  );

  const events = await query(
    `SELECT id, event_type, actor_type, summary, details, created_at
     FROM iao.order_issue_events
     WHERE issue_id = $1
     ORDER BY created_at ASC;`,
    ['issue_muz895uh_xsxr']
  );

  const messages = await query(
    `SELECT *
     FROM iao.messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC;`,
    ['conv-gm-muz89580-3qkp']
  );

  console.log('ISSUE STATE:', JSON.stringify({
    id: issue.id,
    tenant_id: issue.tenant_id,
    issue_type: issue.issue_type,
    status: issue.status,
    order_id: issue.order_id,
    next_action: issue.next_action,
    responsible_party: issue.responsible_party,
    evidence: issue.evidence,
  }, null, 2));

  console.log('\nTARGET JOB fjob_muzdc9x3_5qgp:', JSON.stringify(targetJob, null, 2));
  console.log('\nALL JOBS SUMMARY:', allJobs.map(j => ({
    id: j.id,
    status: j.status,
    followup_type: j.followup_type,
    attempt_count: j.attempt_count,
    max_attempts: j.max_attempts,
    scheduled_for: j.scheduled_for,
    updated_at: j.updated_at,
  })));


  process.exit(0);
}

inspectOverdueReminder();

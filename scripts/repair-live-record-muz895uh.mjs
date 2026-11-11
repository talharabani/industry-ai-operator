import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo';
const TENANT_ID = 'demo-store';
const ISSUE_ID = 'issue_muz895uh_xsxr';
const TARGET_JOB_ID = 'fjob_mv4z3ubp_2lsu';

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  console.log('=== Step 1: Pre-Repair Inspection ===');
  const issueBeforeRes = await client.query(
    `SELECT id, tenant_id, issue_type, status, is_escalated, escalation_summary, evidence, next_action, responsible_party, updated_at
     FROM iao.order_issues
     WHERE tenant_id = $1 AND id = $2;`,
    [TENANT_ID, ISSUE_ID]
  );
  const issueBefore = issueBeforeRes.rows[0];
  if (!issueBefore) {
    console.error(`ERROR: Issue ${ISSUE_ID} not found!`);
    await client.end();
    process.exit(1);
  }
  console.log('Issue Before:', JSON.stringify(issueBefore, null, 2));

  const allJobsBeforeRes = await client.query(
    `SELECT id, status, followup_type, attempt_count, max_attempts, scheduled_for, associated_task_id, metadata, created_at, updated_at
     FROM iao.order_issue_followup_jobs
     WHERE tenant_id = $1 AND issue_id = $2
     ORDER BY created_at ASC;`,
    [TENANT_ID, ISSUE_ID]
  );
  console.log('All Jobs Before:', JSON.stringify(allJobsBeforeRes.rows, null, 2));

  const allEventsBeforeRes = await client.query(
    `SELECT id, event_type, actor_type, summary, details, created_at
     FROM iao.order_issue_events
     WHERE tenant_id = $1 AND issue_id = $2
     ORDER BY created_at ASC;`,
    [TENANT_ID, ISSUE_ID]
  );
  console.log('All Events Before Count:', allEventsBeforeRes.rows.length);

  // Check distinct completed owner reminders
  const completedOwnerJobs = allJobsBeforeRes.rows.filter(
    (j) => j.status === 'completed' && j.followup_type === 'awaiting_owner_review'
  );
  const followupSentEvents = allEventsBeforeRes.rows.filter(
    (e) => e.event_type === 'followup_sent'
  );

  console.log('Completed Owner Reminder Jobs:', completedOwnerJobs.map((j) => ({ id: j.id, attempt: j.attempt_count })));
  console.log('Follow-up Sent Events:', followupSentEvents.map((e) => ({ id: e.id, summary: e.summary, details: e.details })));

  const targetJobBefore = allJobsBeforeRes.rows.find((j) => j.id === TARGET_JOB_ID);
  if (!targetJobBefore) {
    console.error(`ERROR: Target job ${TARGET_JOB_ID} not found!`);
    await client.end();
    process.exit(1);
  }
  console.log('Target Job Before:', targetJobBefore);

  // Re-check conditions strictly before transaction
  if (targetJobBefore.status !== 'pending') {
    console.error(`ABORT: Target job ${TARGET_JOB_ID} is not pending (status: ${targetJobBefore.status})!`);
    await client.end();
    process.exit(1);
  }

  if (completedOwnerJobs.length !== 2) {
    console.error(`ABORT: Expected exactly 2 completed owner reminder jobs, found ${completedOwnerJobs.length}!`);
    await client.end();
    process.exit(1);
  }

  console.log('\n=== Step 2: Executing Repair Inside Atomic Transaction ===');
  try {
    await client.query('BEGIN');

    // 1. Lock issue row
    const lockedIssueRes = await client.query(
      `SELECT id, status, is_escalated FROM iao.order_issues WHERE tenant_id = $1 AND id = $2 FOR UPDATE;`,
      [TENANT_ID, ISSUE_ID]
    );
    if (!lockedIssueRes.rows[0]) {
      throw new Error(`Issue ${ISSUE_ID} not found during lock`);
    }

    // 2. Lock target job row
    const lockedJobRes = await client.query(
      `SELECT id, status FROM iao.order_issue_followup_jobs WHERE tenant_id = $1 AND id = $2 FOR UPDATE;`,
      [TENANT_ID, TARGET_JOB_ID]
    );
    const lockedJob = lockedJobRes.rows[0];
    if (!lockedJob) {
      throw new Error(`Target job ${TARGET_JOB_ID} not found during lock`);
    }
    if (lockedJob.status !== 'pending') {
      throw new Error(`Target job ${TARGET_JOB_ID} state changed during lock: status is ${lockedJob.status}`);
    }

    // 3. Cancel only fjob_mv4z3ubp_2lsu
    const cancelRes = await client.query(
      `UPDATE iao.order_issue_followup_jobs
       SET status = 'cancelled',
           updated_at = NOW(),
           metadata = jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{cancellation_reason}',
             '"max_attempts_exceeded_repair"'
           )
       WHERE tenant_id = $1 AND id = $2 AND status = 'pending'
       RETURNING id, status, metadata;`,
      [TENANT_ID, TARGET_JOB_ID]
    );
    if (cancelRes.rowCount !== 1) {
      throw new Error(`Failed to cancel target job ${TARGET_JOB_ID}`);
    }
    console.log('Cancelled Job Result:', cancelRes.rows[0]);

    // 4. Mark issue escalated with confirmed 2/2 reminder count, preserving awaiting_owner and evidence
    const updateIssueRes = await client.query(
      `UPDATE iao.order_issues
       SET is_escalated = true,
           escalation_summary = 'Owner reminder limit (2/2) reached. Escalated for manual store team action.',
           updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, status, is_escalated, escalation_summary;`,
      [TENANT_ID, ISSUE_ID]
    );
    console.log('Updated Issue Result:', updateIssueRes.rows[0]);

    // 5. Append one escalation audit event idempotently
    const existingEscRes = await client.query(
      `SELECT id FROM iao.order_issue_events
       WHERE tenant_id = $1 AND issue_id = $2 AND event_type = 'escalated_to_owner' LIMIT 1;`,
      [TENANT_ID, ISSUE_ID]
    );

    let eventInserted = null;
    if (existingEscRes.rows.length === 0) {
      const insertEventRes = await client.query(
        `INSERT INTO iao.order_issue_events (
           tenant_id, issue_id, event_type, actor_type, summary, details, created_at
         ) VALUES ($1, $2, 'escalated_to_owner', 'system', $3, $4::jsonb, NOW())
         RETURNING id, event_type, summary, details;`,
        [
          TENANT_ID,
          ISSUE_ID,
          'Owner reminder limit (2/2) reached for open warehouse task. Automated reminders stopped.',
          JSON.stringify({
            cumulative_attempts: 2,
            max_attempts: 2,
            repaired_job_id: TARGET_JOB_ID,
            repair_reason: 'max_attempts_exceeded_repair',
          }),
        ]
      );
      eventInserted = insertEventRes.rows[0];
      console.log('Appended Escalation Event:', eventInserted);
    } else {
      console.log('Escalation Event already exists (idempotent skip):', existingEscRes.rows[0]);
    }

    await client.query('COMMIT');
    console.log('Transaction committed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction rolled back due to error:', err);
    await client.end();
    process.exit(1);
  }

  console.log('\n=== Step 3: Post-Repair Read-Only Verification ===');
  const issueAfterRes = await client.query(
    `SELECT id, tenant_id, issue_type, status, is_escalated, escalation_summary, evidence, next_action, responsible_party, updated_at
     FROM iao.order_issues
     WHERE tenant_id = $1 AND id = $2;`,
    [TENANT_ID, ISSUE_ID]
  );
  console.log('Issue After:', JSON.stringify(issueAfterRes.rows[0], null, 2));

  const allJobsAfterRes = await client.query(
    `SELECT id, status, followup_type, attempt_count, max_attempts, scheduled_for, associated_task_id, metadata, updated_at
     FROM iao.order_issue_followup_jobs
     WHERE tenant_id = $1 AND issue_id = $2
     ORDER BY created_at ASC;`,
    [TENANT_ID, ISSUE_ID]
  );
  console.log('All Jobs After:', JSON.stringify(allJobsAfterRes.rows, null, 2));

  const activeJobs = allJobsAfterRes.rows.filter((j) => ['pending', 'claimed'].includes(j.status));
  console.log('Active Jobs Count for Exhausted Chain:', activeJobs.length);

  const escalationEvents = (await client.query(
    `SELECT id, event_type, actor_type, summary, details, created_at
     FROM iao.order_issue_events
     WHERE tenant_id = $1 AND issue_id = $2 AND event_type = 'escalated_to_owner'
     ORDER BY created_at ASC;`,
    [TENANT_ID, ISSUE_ID]
  )).rows;
  console.log('Escalation Events:', JSON.stringify(escalationEvents, null, 2));

  await client.end();
}

main().catch(console.error);

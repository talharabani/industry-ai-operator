import { Pool } from 'pg';
import fs from 'fs';
import assert from 'node:assert';

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

import {
  createOrderIssue,
  getOrderIssue,
  updateOrderIssue,
  listOrderIssueEvents,
  scheduleOrderIssueFollowup,
  claimDueFollowupJobs,
  processClaimedFollowupJob,
  query,
} from '../lib/order-issues.ts';

async function runSandboxTest() {
  console.log('=== STARTING SANDBOX AWAITING_OWNER_REVIEW VERIFICATION ===\n');

  const testTenant = 'sandbox-test-tenant-' + Date.now();
  const testOrderId = 'SANDBOX-ORD-7788';
  const testCustomerEmail = 'sandbox.customer@example.com';
  const testCustomerName = 'Sandbox Customer';

  // 1. Create a Sandbox Order Issue in awaiting_owner status
  console.log('1. Creating Sandbox Order Issue in awaiting_owner status...');
  const sandboxIssue = await createOrderIssue({
    tenant_id: testTenant,
    issue_type: 'delivery_delay',
    status: 'awaiting_owner',
    customer_email: testCustomerEmail,
    customer_name: testCustomerName,
    order_id: testOrderId,
    evidence: {
      customer_claim: 'Sandbox delay report',
      fulfillment_status: 'unfulfilled',
      owner_tasks: [
        {
          id: `task-${Date.now()}-fulfill`,
          title: `Warehouse fulfillment required for order ${testOrderId}`,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      ],
    },
    next_action: `Warehouse team to expedite order ${testOrderId}`,
    responsible_party: 'owner',
  });

  assert.strictEqual(sandboxIssue.status, 'awaiting_owner');
  assert.strictEqual(sandboxIssue.responsible_party, 'owner');
  console.log(`✓ Sandbox issue created: ${sandboxIssue.id} (${sandboxIssue.status})\n`);

  // 2. Schedule Due Sandbox Job (Attempt 0 -> 1)
  console.log('2. Scheduling Due Job (Attempt 1 of 2)...');
  const job1 = await scheduleOrderIssueFollowup({
    tenant_id: testTenant,
    issue_id: sandboxIssue.id,
    job_type: 'awaiting_owner_review',
    run_at: new Date(Date.now() - 5000), // Due immediately (5 seconds in the past)
    max_attempts: 2,
  });

  assert.strictEqual(job1.status, 'pending');
  assert.strictEqual(job1.attempt_count, 0);
  assert.strictEqual(job1.max_attempts, 2);
  console.log(`✓ Job scheduled: ${job1.id}, type=${job1.followup_type}, status=${job1.status}\n`);

  // 3. Test Concurrent Claiming (Prevent Duplicate Reminders)
  console.log('3. Testing Concurrent Worker Claiming (Duplicate Claim Prevention)...');
  const worker1Claims = await claimDueFollowupJobs(testTenant, 10);
  const worker2Claims = await claimDueFollowupJobs(testTenant, 10);

  assert.strictEqual(worker1Claims.length, 1);
  assert.strictEqual(worker1Claims[0].id, job1.id);
  assert.strictEqual(worker1Claims[0].status, 'claimed');
  // Worker 2 must find 0 due jobs because job1 is already claimed (SKIP LOCKED)
  assert.strictEqual(worker2Claims.length, 0);
  console.log(`✓ Worker 1 claimed job: ${worker1Claims[0].id}; Worker 2 received 0 duplicate claims.\n`);

  // 4. Process Attempt 1 (Owner Reminder Verification)
  console.log('4. Processing Attempt 1 (Targeting Owner, NOT Customer)...');
  const outcome1 = await processClaimedFollowupJob(worker1Claims[0], {
    automation_mode: 'auto_routine',
    order_issues_config: { followup_interval_hours: 24, max_followup_attempts: 2 },
  });

  assert.strictEqual(outcome1.outcome, 'completed');
  assert.strictEqual(outcome1.actionTaken.includes('owner review'), true);
  console.log(`✓ Attempt 1 outcome: ${outcome1.outcome} (${outcome1.actionTaken})\n`);

  // Verify Audit Trail for Attempt 1
  const eventsAfterAttempt1 = await listOrderIssueEvents(testTenant, sandboxIssue.id);
  const followupSentEvent = eventsAfterAttempt1.find((e) => e.event_type === 'followup_sent');
  assert.strictEqual(Boolean(followupSentEvent), true);
  assert.strictEqual(followupSentEvent?.summary.includes('Owner reminder sent'), true);
  assert.strictEqual(followupSentEvent?.summary.includes('Attempt 1/2'), true);
  console.log(`✓ Audit Trail recorded: "${followupSentEvent?.summary}"\n`);

  // 5. Verify Next Attempt (Attempt 2) was Scheduled
  console.log('5. Verifying Next Attempt (Attempt 2 of 2) was Scheduled...');
  const pendingJobsAfter1 = await query(
    `SELECT * FROM iao.order_issue_followup_jobs
     WHERE tenant_id = $1 AND issue_id = $2 AND status = 'pending';`,
    [testTenant, sandboxIssue.id]
  );
  assert.strictEqual(pendingJobsAfter1.length, 1);
  const job2 = pendingJobsAfter1[0];
  assert.strictEqual(job2.followup_type, 'awaiting_owner_review');
  assert.strictEqual(job2.attempt_count, 0); // newly scheduled next attempt starts at 0 or tracks counter
  console.log(`✓ Next attempt scheduled: ${job2.id}, status=${job2.status}\n`);

  // 6. Test Max 2 Attempts Enforcement
  console.log('6. Processing Final Attempt to verify Max 2 Retry Bound Enforcement...');
  // Force job2 due date to past
  await query(
    `UPDATE iao.order_issue_followup_jobs
     SET scheduled_for = NOW() - INTERVAL '1 minute', attempt_count = 1
     WHERE id = $1;`,
    [job2.id]
  );

  const workerClaimsJob2 = await claimDueFollowupJobs(testTenant, 10);
  assert.strictEqual(workerClaimsJob2.length, 1);
  assert.strictEqual(workerClaimsJob2[0].id, job2.id);

  const outcome2 = await processClaimedFollowupJob(workerClaimsJob2[0], {
    automation_mode: 'auto_routine',
    order_issues_config: { followup_interval_hours: 24, max_followup_attempts: 2 },
  });

  assert.strictEqual(outcome2.outcome, 'escalated_to_owner');
  assert.strictEqual(outcome2.actionTaken.includes('retry limit reached'), true);
  console.log(`✓ Final Attempt outcome: ${outcome2.outcome} (${outcome2.actionTaken})\n`);

  // Verify Audit Trail for Escalation
  const eventsAfterAttempt2 = await listOrderIssueEvents(testTenant, sandboxIssue.id);
  const escalationEvent = eventsAfterAttempt2.find((e) => e.event_type === 'escalated_to_owner');
  assert.strictEqual(Boolean(escalationEvent), true);
  assert.strictEqual(escalationEvent?.summary.includes('Owner reminder limit (2) reached'), true);
  console.log(`✓ Audit Trail recorded: "${escalationEvent?.summary}"\n`);

  // Verify NO further pending jobs scheduled after max attempts
  const pendingJobsAfterMax = await query(
    `SELECT * FROM iao.order_issue_followup_jobs
     WHERE tenant_id = $1 AND issue_id = $2 AND status = 'pending';`,
    [testTenant, sandboxIssue.id]
  );
  assert.strictEqual(pendingJobsAfterMax.length, 0);
  console.log(`✓ Verified 0 pending jobs scheduled after max attempts reached.\n`);

  // 7. Test Resolving the Issue Cancels Pending Reminders
  console.log('7. Testing Issue Resolution Auto-Cancels Pending Reminders...');
  const newPendingJob = await scheduleOrderIssueFollowup({
    tenant_id: testTenant,
    issue_id: sandboxIssue.id,
    job_type: 'awaiting_owner_review',
    delay_hours: 24,
  });
  assert.strictEqual(newPendingJob.status, 'pending');

  // Resolve the issue
  await updateOrderIssue(
    testTenant,
    sandboxIssue.id,
    { status: 'resolved', resolution_summary: 'Warehouse dispatched replacement item.' },
    { actorType: 'owner', summary: 'Owner resolved issue after dispatch' }
  );

  const issueAfterResolve = await getOrderIssue(testTenant, sandboxIssue.id);
  assert.strictEqual(issueAfterResolve?.status, 'resolved');

  const resolvedJobCheck = await query(
    `SELECT status FROM iao.order_issue_followup_jobs WHERE id = $1;`,
    [newPendingJob.id]
  );
  assert.strictEqual(resolvedJobCheck[0].status, 'cancelled');
  console.log(`✓ Issue resolved -> Pending reminder job ${newPendingJob.id} automatically cancelled.\n`);

  // 8. Clean up sandbox test records
  console.log('8. Cleaning up Sandbox test tenant records...');
  await query(`DELETE FROM iao.order_issue_events WHERE tenant_id = $1;`, [testTenant]);
  await query(`DELETE FROM iao.order_issue_followup_jobs WHERE tenant_id = $1;`, [testTenant]);
  await query(`DELETE FROM iao.order_issues WHERE tenant_id = $1;`, [testTenant]);
  console.log(`✓ Sandbox test records cleaned up cleanly.\n`);

  console.log('=== ALL 5 SANDBOX VERIFICATION CHECKS PASSED PERFECTLY ===');
}

runSandboxTest().catch((err) => {
  console.error('Sandbox Test Failed:', err);
  process.exit(1);
});

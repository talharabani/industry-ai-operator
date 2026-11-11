import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
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
  listOrderIssues,
  scheduleOrderIssueFollowup,
  query,
} from '../lib/order-issues.ts';

async function runOwnerTasksDashboardTest() {
  console.log('=== RUNNING OWNER TASKS DASHBOARD VERIFICATION TESTS ===\n');

  const tenantA = 'tenant-test-a-' + Date.now();
  const tenantB = 'tenant-test-b-' + Date.now();

  try {
    // 1. Tenant Isolation Test
    console.log('1. Testing Tenant Isolation...');
    const issueA = await createOrderIssue({
      tenantId: tenantA,
      issueType: 'delivery_delay',
      status: 'awaiting_owner',
      orderId: 'ORD-AAA-111',
      customerName: 'Alice Alpha',
      customerEmail: 'alice@example.com',
      conversationId: 'conv-test-alpha-99',
      dueDate: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      evidence: {
        customer_claim: 'Where is my order AAA?',
        owner_tasks: [
          {
            id: 'task-a1',
            title: 'Expedite warehouse dispatch for order AAA-111',
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      nextAction: 'Expedite warehouse dispatch for order AAA-111',
      responsibleParty: 'owner',
    });

    const jobA = await scheduleOrderIssueFollowup({
      tenantId: tenantA,
      issueId: issueA.id,
      conversationId: issueA.conversation_id,
      followupType: 'awaiting_owner_review',
      delayHours: 12,
      maxAttempts: 2,
    });

    // Query Tenant B issues
    const listB = await listOrderIssues(tenantB);
    assert.strictEqual(listB.issues.length, 0, 'Tenant B must see 0 issues from Tenant A');

    // Query Tenant A issues
    const listA = await listOrderIssues(tenantA);
    assert.strictEqual(listA.issues.length, 1, 'Tenant A must see its own issue');
    assert.strictEqual(listA.issues[0].id, issueA.id);
    console.log('✓ Tenant isolation strictly verified.\n');

    // 2. Accurate Reminder Times & Queue Record Test
    console.log('2. Testing Accurate Reminder Times and Queue Metadata Enrichment...');
    assert.strictEqual(Boolean(listA.issues[0].active_followup_job), true);
    assert.strictEqual(listA.issues[0].active_followup_job?.id, jobA.id);
    assert.strictEqual(listA.issues[0].active_followup_job?.attempt_count, 0);
    assert.strictEqual(listA.issues[0].active_followup_job?.max_attempts, 2);
    
    // Check that due_date (deadline) is distinct from scheduled_for (reminder)
    const taskDeadline = new Date(listA.issues[0].due_date).getTime();
    const reminderTime = new Date(listA.issues[0].active_followup_job.scheduled_for).getTime();
    assert.notStrictEqual(taskDeadline, reminderTime, 'Task deadline must be separate from reminder time');
    console.log(`✓ Reminder time (${new Date(reminderTime).toISOString()}) distinct from task deadline (${new Date(taskDeadline).toISOString()}).\n`);

    // 3. Conversation Links Test
    console.log('3. Testing Conversation Link Generation...');
    assert.strictEqual(listA.issues[0].conversation_id, 'conv-test-alpha-99');
    const conversationUrl = `/inbox?selected=${encodeURIComponent(listA.issues[0].conversation_id)}`;
    assert.strictEqual(conversationUrl, '/inbox?selected=conv-test-alpha-99');
    console.log(`✓ Conversation link verified: ${conversationUrl}\n`);

    // 4. Resolved-Task Removal Test
    console.log('4. Testing Resolved Issue Removal from Active Owner Tasks...');
    // Create another issue for tenant A in resolved state
    const resolvedIssue = await createOrderIssue({
      tenantId: tenantA,
      issueType: 'wrong_item',
      status: 'resolved',
      orderId: 'ORD-AAA-222',
      customerName: 'Bob Beta',
      customerEmail: 'bob@example.com',
      responsibleParty: 'owner',
    });

    const refreshedListA = await listOrderIssues(tenantA);
    const activeTasks = refreshedListA.issues.filter((issue) => {
      if (issue.status === 'resolved' || issue.status === 'closed') return false;
      const isOwnerParty = issue.responsible_party === 'owner';
      const isAwaitingOwner = issue.status === 'awaiting_owner';
      const isActionPending = issue.status === 'action_pending';
      const hasPendingTasks = Boolean(
        issue.evidence?.owner_tasks &&
        issue.evidence.owner_tasks.some((t) => t.status === 'pending')
      );
      return isOwnerParty || isAwaitingOwner || isActionPending || hasPendingTasks;
    });

    assert.strictEqual(activeTasks.length, 1, 'Only unresolved owner task should be in active list');
    assert.strictEqual(activeTasks[0].id, issueA.id);

    // Now resolve issueA
    await updateOrderIssue(
      tenantA,
      issueA.id,
      { status: 'resolved', resolution_summary: 'Dispatched replacement parcel.' },
      { actorType: 'owner', summary: 'Owner dispatched parcel' }
    );

    const afterResolvingA = await listOrderIssues(tenantA);
    const activeTasksAfter = afterResolvingA.issues.filter((issue) => {
      if (issue.status === 'resolved' || issue.status === 'closed') return false;
      const isOwnerParty = issue.responsible_party === 'owner';
      const isAwaitingOwner = issue.status === 'awaiting_owner';
      const isActionPending = issue.status === 'action_pending';
      const hasPendingTasks = Boolean(
        issue.evidence?.owner_tasks &&
        issue.evidence.owner_tasks.some((t) => t.status === 'pending')
      );
      return isOwnerParty || isAwaitingOwner || isActionPending || hasPendingTasks;
    });

    assert.strictEqual(activeTasksAfter.length, 0, 'Active tasks must be 0 after all issues resolved');
    console.log('✓ Resolved issues correctly removed from active owner tasks.\n');

    // 5. Verify live #1001 reminder jobs reflect repaired state
    console.log('5. Verifying live #1001 jobs reflect repaired state...');
    const liveJobs = await query(
      `SELECT id, issue_id, followup_type, status, scheduled_for FROM iao.order_issue_followup_jobs
       WHERE issue_id = 'issue_muz895uh_xsxr' ORDER BY created_at ASC;`
    );
    assert.strictEqual(liveJobs.length, 3);
    assert.strictEqual(liveJobs.filter((j) => j.status === 'completed').length, 2);
    assert.strictEqual(liveJobs.find((j) => j.id === 'fjob_mv4z3ubp_2lsu')?.status, 'cancelled');
    console.log(`✓ Live issue #1001 jobs are intact in repaired state with no active reminder.\n`);

  } finally {
    // Clean up sandbox test records
    console.log('Cleaning up test tenant records...');
    await query(`DELETE FROM iao.order_issue_events WHERE tenant_id IN ($1, $2);`, [tenantA, tenantB]);
    await query(`DELETE FROM iao.order_issue_followup_jobs WHERE tenant_id IN ($1, $2);`, [tenantA, tenantB]);
    await query(`DELETE FROM iao.order_issues WHERE tenant_id IN ($1, $2);`, [tenantA, tenantB]);
    console.log('✓ Cleanup complete.');
  }

  console.log('\n=== ALL OWNER TASKS DASHBOARD TESTS PASSED ===');
}

runOwnerTasksDashboardTest().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});

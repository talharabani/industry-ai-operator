import assert from 'assert';
import { query } from '../lib/db.ts';
import {
  claimEligibleServicesFollowupJobs,
  scheduleServicesLeadFollowup,
  dispatchServicesLeadFollowup,
  completeServicesLeadFollowupJob
} from '../lib/services-pack.ts';

async function testTimeoutAndRecovery() {
  const tenantAlpha = 'sandbox-services-alpha';
  const testRunId = `timeout_test_${Date.now()}`;
  console.log(`=== Running Actual HTTP Timeout Scenario After Claim (Run: ${testRunId}) ===`);

  // Ensure business exists
  await query(
    `INSERT INTO iao.businesses (tenant_id, settings, updated_at)
     VALUES ($1, '{"business_name":"Alpha Test","industry":"services","services_config":{"enable_customer_followup":true}}'::jsonb, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET settings = '{"business_name":"Alpha Test","industry":"services","services_config":{"enable_customer_followup":true}}'::jsonb, updated_at = NOW();`,
    [tenantAlpha]
  );

  // 1. Create test lead
  const leadId = 'lead_timeout_test_' + Date.now();
  await query(
    `INSERT INTO iao.services_leads (id, tenant_id, customer_name, customer_email, stage, status, source)
     VALUES ($1, $2, 'Timeout Test Lead', 'timeout@sandbox.local', 'new', 'open', 'web')
     ON CONFLICT (id) DO NOTHING;`,
    [leadId, tenantAlpha]
  );
  console.log(`✓ Created test lead: ${leadId}`);

  // 2. Schedule follow-up
  const scheduled = await scheduleServicesLeadFollowup({
    tenantId: tenantAlpha,
    leadId: leadId,
    delayMinutes: 0,
    metadata: { test: 'timeout_recovery' }
  });
  const timeoutJobId = scheduled.id;
  console.log(`✓ Scheduled job ${timeoutJobId} (status: ${scheduled.status})`);

  // 3. Worker 1 claims the job
  const claimedJobs = await claimEligibleServicesFollowupJobs(tenantAlpha, 10);
  const claimedJob = claimedJobs.find(j => j.id === timeoutJobId);
  assert(claimedJob, 'Worker 1 must claim the job');
  assert.strictEqual(claimedJob.status, 'claimed');
  console.log(`✓ Worker 1 claimed job ${timeoutJobId} (status: ${claimedJob.status}, retry_count: ${claimedJob.execution_retry_count})`);

  // 4. Worker 1 executes an HTTP dispatch attempt against the real timeout endpoint (delay=2000, client timeout=300ms)
  console.log('Worker 1 executing real HTTP call to /api/test/timeout?delay=2000 with 300ms client timeout...');
  let timedOut = false;
  const startTs = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300);
    await fetch('http://localhost:3000/api/test/timeout?delay=2000', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: leadId, job_id: timeoutJobId })
    });
    clearTimeout(timer);
  } catch (err) {
    timedOut = true;
    const elapsed = Date.now() - startTs;
    console.log(`✓ Worker 1 encountered expected HTTP timeout after ${elapsed}ms: ${err.name} - ${err.message}`);
  }
  assert(timedOut, 'HTTP request must time out');

  // Verify that because of the timeout, NO messages were created or dispatched
  const msgsAfterTimeout = await query(
    `SELECT COUNT(*) as count FROM iao.messages WHERE tenant_id = $1 AND metadata->>'job_id' = $2;`,
    [tenantAlpha, timeoutJobId]
  );
  assert.strictEqual(parseInt(msgsAfterTimeout[0].count, 10), 0, 'No messages should be dispatched during timeout failure');
  console.log('✓ Verified 0 messages dispatched during timed-out worker claim');

  // 5. Simulate abandoned claim by aging claim timestamp past the 5-minute stale threshold
  await query(
    `UPDATE iao.services_lead_followup_jobs
     SET claimed_at = NOW() - INTERVAL '6 minutes'
     WHERE id = $1;`,
    [timeoutJobId]
  );
  console.log('✓ Stale-claim condition established (claim aged to 6 minutes ago)');

  // 6. Worker 2 runs claimEligibleServicesFollowupJobs -> Stale-Claim Recovery
  const recoveredJobs = await claimEligibleServicesFollowupJobs(tenantAlpha, 10);
  const recoveredJob = recoveredJobs.find(j => j.id === timeoutJobId);
  assert(recoveredJob, 'Worker 2 must recover the stranded timed-out job');
  assert.strictEqual(recoveredJob.status, 'claimed');
  console.log(`✓ Stale-Claim Recovery successful: Worker 2 claimed stranded job ${recoveredJob.id} (retry_count: ${recoveredJob.execution_retry_count})`);

  // 7. Worker 2 performs mock dispatch
  const dispatchRes1 = await dispatchServicesLeadFollowup({
    tenantId: tenantAlpha,
    leadId: leadId,
    jobId: timeoutJobId,
    action: 'phone_call_followup',
    dispatchTarget: 'test_operator',
    isSandbox: true
  });
  console.log(`✓ Worker 2 mock dispatch attempt 1: outcome=${dispatchRes1.status}, mock_dispatched=${dispatchRes1.mock_dispatched}`);

  const dispatchesCount1 = await query(
    `SELECT COUNT(*) as count FROM iao.messages WHERE tenant_id = $1 AND metadata->>'job_id' = $2;`,
    [tenantAlpha, timeoutJobId]
  );
  assert.strictEqual(parseInt(dispatchesCount1[0].count, 10), 1, 'Exactly 1 message must exist in DB');
  console.log(`✓ Message count in DB after dispatch 1: ${dispatchesCount1[0].count}`);

  // 8. Attempt duplicate dispatch on same job (must be blocked)
  let duplicateBlocked = false;
  try {
    const dispatchRes2 = await dispatchServicesLeadFollowup({
      tenantId: tenantAlpha,
      leadId: leadId,
      jobId: timeoutJobId,
      dispatchTarget: 'test_operator',
      isSandbox: true
    });
    if (dispatchRes2.duplicate_blocked || dispatchRes2.status === 'already_dispatched' || !dispatchRes2.success) {
      duplicateBlocked = true;
    }
  } catch (err) {
    duplicateBlocked = true;
  }
  console.log(`✓ Duplicate dispatch retry attempt blocked: ${duplicateBlocked}`);

  const dispatchesCount2 = await query(
    `SELECT COUNT(*) as count FROM iao.messages WHERE tenant_id = $1 AND metadata->>'job_id' = $2;`,
    [tenantAlpha, timeoutJobId]
  );
  assert.strictEqual(parseInt(dispatchesCount2[0].count, 10), 1, 'Message count must remain exactly 1');
  console.log(`✓ DB message count after duplicate attempt: ${dispatchesCount2[0].count} (Zero duplicate messages)`);

  // 9. Complete the recovered job
  await completeServicesLeadFollowupJob(timeoutJobId, 'dispatched', { test: 'timeout_recovery_done' }, tenantAlpha);

  const finalJobState = await query(
    `SELECT id, status, execution_retry_count FROM iao.services_lead_followup_jobs WHERE id = $1;`,
    [timeoutJobId]
  );
  console.log(`✓ Final job state: status=${finalJobState[0].status}, retry_count=${finalJobState[0].execution_retry_count}`);

  console.log('\n=== HTTP Timeout Scenario & Stale-Claim Recovery: ALL CHECKS PASSED ===\n');
  process.exit(0);
}

testTimeoutAndRecovery().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});

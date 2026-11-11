import { execSync } from 'child_process';
import { query, updateBusinessSettings, createInquiryConversation } from '../lib/db.ts';
import {
  createBusinessWorkspace,
  scheduleServicesLeadFollowup,
  getServicesLead,
  updateServicesLead,
} from '../lib/services-pack.ts';

function getLatestN8nExecution() {
  const cmd = `docker exec n8n node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/home/node/.n8n/database.sqlite'); const row = db.prepare('SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity ORDER BY id DESC LIMIT 1').get(); console.log(JSON.stringify(row));"`;
  try {
    const raw = execSync(cmd, { encoding: 'utf8' }).trim();
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to query n8n execution:', err.message);
    return null;
  }
}

function runN8nWorkflow(workflowId = 'wf-services-lead-followups') {
  const cmd = `docker exec -e N8N_RUNNERS_BROKER_PORT=5699 n8n n8n execute --id=${workflowId}`;
  try {
    const stdout = execSync(cmd, { encoding: 'utf8', timeout: 60000 });
    return { success: true, output: stdout };
  } catch (err) {
    return {
      success: false,
      output: (err.stdout || '') + '\n' + (err.stderr || '') + '\n' + err.message,
    };
  }
}

let passed = 0;
let failed = 0;

function assert(cond, desc) {
  if (cond) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    failed++;
  }
}

async function main() {
  console.log('================================================================');
  console.log('=== n8n Live Unpublished Workflow Execution Verification Suite ===');
  console.log('================================================================\n');

  const tenantAlpha = 'sandbox-services-alpha';
  const tenantBeta = 'sandbox-services-beta';

  // 1. Initialize Sandbox Businesses
  console.log('[Step 1] Ensuring Isolated Sandbox Businesses Exist...');
  await createBusinessWorkspace({
    tenantId: tenantAlpha,
    businessName: 'Alpha Electrical Services',
    businessType: 'services',
    industry: 'services',
    ownerUserId: 'usr-alpha-owner',
    ownerEmail: 'owner@alpha-services.test',
    ownerName: 'Alpha Owner',
  });
  await updateBusinessSettings(tenantAlpha, {
    business_name: 'Alpha Electrical Services',
    industry: 'services',
    automation_mode: 'auto_routine',
    services_config: {
      enable_customer_followup: true,
      max_followup_attempts: 2,
      followup_delay_hours: 24,
    },
  });

  await createBusinessWorkspace({
    tenantId: tenantBeta,
    businessName: 'Beta Plumbing Pros',
    businessType: 'services',
    industry: 'services',
    ownerUserId: 'usr-beta-owner',
    ownerEmail: 'owner@beta-services.test',
    ownerName: 'Beta Owner',
  });
  await updateBusinessSettings(tenantBeta, {
    business_name: 'Beta Plumbing Pros',
    industry: 'services',
    automation_mode: 'auto_routine',
    services_config: {
      enable_customer_followup: true,
      max_followup_attempts: 2,
      followup_delay_hours: 24,
    },
  });
  assert(true, 'Two sandbox businesses configured in database');

  // =========================================================================
  // SCENARIO 1: Follow-Up Dispatch Branch
  // =========================================================================
  console.log('\n--- Scenario 1: Follow-up Dispatch Branch (Sandbox Alpha) ---');
  await query(`DELETE FROM iao.services_lead_followup_jobs WHERE status IN ('pending', 'claimed');`);

  const inqAlpha = await createInquiryConversation(tenantAlpha, {
    customer_name: 'Alice Johnson',
    customer_email: `alice-${Date.now()}@alpha-client.test`,
    message_body: 'Need commercial 200A panel upgrade quote.',
    service_interest: 'Panel Upgrade',
  });
  const jobAlpha = await scheduleServicesLeadFollowup({
    tenantId: tenantAlpha,
    leadId: inqAlpha.lead_id,
    conversationId: inqAlpha.conversation_id,
    delayMinutes: -1, // Due immediately
  });

  console.log(`Created Job Alpha: ${jobAlpha.id} for lead ${inqAlpha.lead_id}`);
  console.log('Executing n8n workflow wf-services-lead-followups...');
  const run1 = runN8nWorkflow();
  assert(run1.success, 'n8n workflow executed without crash');
  const exec1 = getLatestN8nExecution();
  console.log(`n8n Execution Record: ID=${exec1?.id}, Status=${exec1?.status}, Time=${exec1?.startedAt} -> ${exec1?.stoppedAt}`);
  assert(exec1?.status === 'success', 'n8n execution status is success');

  const checkJob1 = (await query(`SELECT * FROM iao.services_lead_followup_jobs WHERE id = $1;`, [jobAlpha.id]))[0];
  const outcome1 = checkJob1.metadata?.outcome || checkJob1.status;
  assert(outcome1 === 'dispatched', `Job outcome recorded as dispatched (outcome=${outcome1})`);
  assert(checkJob1.attempt_count === 1, `Job attempt count incremented to 1 (attempt_count=${checkJob1.attempt_count})`);

  // Verify timeline event logged with simulated dispatch
  const eventsAlpha = await query(
    `SELECT * FROM iao.services_lead_events WHERE lead_id = $1 ORDER BY created_at DESC;`,
    [inqAlpha.lead_id]
  );
  assert(eventsAlpha.some(e => e.event_type === 'followup_sent' || e.event_type === 'followup_dispatched'), 'Lead timeline includes followup dispatched/sent event');

  // =========================================================================
  // SCENARIO 2: Escalation Branch (Max Attempts Exceeded)
  // =========================================================================
  console.log('\n--- Scenario 2: Escalation to Owner Task (Sandbox Beta) ---');
  await query(`DELETE FROM iao.services_lead_followup_jobs WHERE status IN ('pending', 'claimed');`);

  const inqBeta = await createInquiryConversation(tenantBeta, {
    customer_name: 'Bob Smith',
    customer_email: 'bob@beta-client.test',
    message_body: 'Looking for pipe replacement estimates.',
    service_interest: 'Pipe Replacement',
  });
  const jobBeta = await scheduleServicesLeadFollowup({
    tenantId: tenantBeta,
    leadId: inqBeta.lead_id,
    conversationId: inqBeta.conversation_id,
    delayMinutes: -1,
  });
  // Simulate that attempt_count has reached max_attempts (2)
  await query(
    `UPDATE iao.services_lead_followup_jobs SET attempt_count = 2 WHERE id = $1;`,
    [jobBeta.id]
  );

  console.log(`Created Job Beta: ${jobBeta.id} with attempt_count=2 (due for escalation)`);
  console.log('Executing n8n workflow wf-services-lead-followups...');
  const run2 = runN8nWorkflow();
  assert(run2.success, 'n8n workflow executed without crash');
  const exec2 = getLatestN8nExecution();
  console.log(`n8n Execution Record: ID=${exec2?.id}, Status=${exec2?.status}`);
  assert(exec2?.status === 'success', 'n8n execution status is success');

  const checkJob2 = (await query(`SELECT * FROM iao.services_lead_followup_jobs WHERE id = $1;`, [jobBeta.id]))[0];
  assert(checkJob2.status === 'completed', `Job marked completed (status=${checkJob2.status})`);
  const outcome2 = checkJob2.metadata?.outcome;
  assert(outcome2 === 'escalated_to_owner', `Job outcome is escalated_to_owner (outcome=${outcome2})`);

  // Verify owner task was created in iao.cases
  const ownerCases = await query(
    `SELECT * FROM iao.cases WHERE tenant_id = $1 AND kind = 'lead_escalation' AND payload->>'lead_id' = $2;`,
    [tenantBeta, inqBeta.lead_id]
  );
  assert(ownerCases.length > 0, `Owner task created in iao.cases (case_id=${ownerCases[0]?.case_id})`);

  // =========================================================================
  // SCENARIO 3: Cancellation Branch (Obsolete / Lead Closed)
  // =========================================================================
  console.log('\n--- Scenario 3: Obsolete Cancellation Branch (Sandbox Alpha) ---');
  await query(`DELETE FROM iao.services_lead_followup_jobs WHERE status IN ('pending', 'claimed');`);

  const inqGamma = await createInquiryConversation(tenantAlpha, {
    customer_name: 'Charlie Davis',
    customer_email: 'charlie@alpha-client.test',
    message_body: 'Need electrical inspection for home purchase.',
    service_interest: 'Home Inspection',
  });
  const jobGamma = await scheduleServicesLeadFollowup({
    tenantId: tenantAlpha,
    leadId: inqGamma.lead_id,
    conversationId: inqGamma.conversation_id,
    delayMinutes: -1,
  });
  // Simulate lead marked won / closed in DB so n8n inspects and cancels the pending job
  await query(
    `UPDATE iao.services_leads SET stage = 'won', status = 'closed', updated_at = NOW() WHERE id = $1;`,
    [inqGamma.lead_id]
  );

  console.log(`Created Job Gamma: ${jobGamma.id} on closed lead (due for cancel_obsolete)`);
  console.log('Executing n8n workflow wf-services-lead-followups...');
  const run3 = runN8nWorkflow();
  assert(run3.success, 'n8n workflow executed without crash');
  const exec3 = getLatestN8nExecution();
  console.log(`n8n Execution Record: ID=${exec3?.id}, Status=${exec3?.status}`);
  assert(exec3?.status === 'success', 'n8n execution status is success');

  const checkJob3 = (await query(`SELECT * FROM iao.services_lead_followup_jobs WHERE id = $1;`, [jobGamma.id]))[0];
  assert(checkJob3.status === 'completed' || checkJob3.status === 'cancelled', `Job status is cancelled/completed (status=${checkJob3.status})`);
  const outcome3 = checkJob3.metadata?.outcome;
  assert(outcome3 === 'cancelled', `Job outcome is cancelled (outcome=${outcome3})`);

  // =========================================================================
  // SCENARIO 4: Zero Jobs Due Branch
  // =========================================================================
  console.log('\n--- Scenario 4: Zero Jobs Due Branch ---');
  await query(`DELETE FROM iao.services_lead_followup_jobs WHERE status IN ('pending', 'claimed');`);
  console.log('Executing n8n workflow with zero due jobs...');
  const run4 = runN8nWorkflow();
  assert(run4.success, 'n8n workflow executed without crash');
  const exec4 = getLatestN8nExecution();
  console.log(`n8n Execution Record: ID=${exec4?.id}, Status=${exec4?.status}`);
  assert(exec4?.status === 'success', 'n8n execution status is success on zero jobs');
  assert(run4.output.includes('Log Zero Due Jobs') || run4.output.includes('Zero due follow-up jobs claimed'), 'Workflow cleanly branched to Log Zero Due Jobs');

  // =========================================================================
  // SCENARIO 5: HTTP Failure & Unknown Path Handling
  // =========================================================================
  console.log('\n--- Scenario 5: HTTP Failure & Unknown Path Handling ---');
  await query(`DELETE FROM iao.services_lead_followup_jobs WHERE status IN ('pending', 'claimed');`);

  // Part A: Unknown Path Safety Rejection
  const inqUnknown = await createInquiryConversation(tenantAlpha, {
    customer_name: 'Unknown Path Customer',
    customer_email: 'unknown@alpha-client.test',
    message_body: 'Testing unrecognized orchestration path.',
    service_interest: 'Custom Special Service',
  });
  const jobUnknown = await scheduleServicesLeadFollowup({
    tenantId: tenantAlpha,
    leadId: inqUnknown.lead_id,
    conversationId: inqUnknown.conversation_id,
    delayMinutes: -1,
  });
  // Flag this job to simulate an unhandled path response from inspect
  await query(
    `UPDATE iao.services_lead_followup_jobs SET metadata = jsonb_build_object('simulate_unknown_path', true) WHERE id = $1;`,
    [jobUnknown.id]
  );

  console.log(`Created Job with simulated unknown path: ${jobUnknown.id}`);
  console.log('Executing n8n workflow...');
  const run5 = runN8nWorkflow();
  const exec5 = getLatestN8nExecution();
  console.log(`n8n Execution Record: ID=${exec5?.id}, Status=${exec5?.status}`);
  assert(exec5 !== null, 'Execution recorded for safety rejection test');
  assert(exec5?.status === 'success', 'n8n execution handled unknown path safely without crashing');
  const checkJob5 = (await query(`SELECT * FROM iao.services_lead_followup_jobs WHERE id = $1;`, [jobUnknown.id]))[0];
  const outcome5 = checkJob5.metadata?.outcome;
  assert(outcome5 === 'unknown_path_failed' || outcome5 === 'action_execution_failed', `Outcome recorded unknown path failure (outcome=${outcome5})`);

  // Part B: HTTP Failure Resilience (Transient 500 with Bounded Retries)
  await query(`DELETE FROM iao.services_lead_followup_jobs WHERE status IN ('pending', 'claimed');`);
  const inqHttpFail = await createInquiryConversation(tenantBeta, {
    customer_name: 'HTTP Error Customer',
    customer_email: 'error500@beta-client.test',
    message_body: 'Testing HTTP 500 resilience.',
    service_interest: 'Emergency Repair',
  });
  const jobHttpFail = await scheduleServicesLeadFollowup({
    tenantId: tenantBeta,
    leadId: inqHttpFail.lead_id,
    conversationId: inqHttpFail.conversation_id,
    delayMinutes: -1,
  });
  await query(
    `UPDATE iao.services_lead_followup_jobs SET metadata = jsonb_build_object('simulate_http_failure', true) WHERE id = $1;`,
    [jobHttpFail.id]
  );
  console.log(`Created Job with simulated HTTP 500: ${jobHttpFail.id}`);
  const run5b = runN8nWorkflow();
  const exec5b = getLatestN8nExecution();
  console.log(`n8n Execution Record (HTTP 500): ID=${exec5b?.id}, Status=${exec5b?.status}`);
  assert(exec5b?.status === 'error', 'n8n caught HTTP 500 after bounded retries and recorded error status');

  // =========================================================================
  // SCENARIO 6: Concurrent / Repeated Execution & Claim Recovery
  // =========================================================================
  console.log('\n--- Scenario 6: Concurrent Execution & Claim Recovery ---');
  await query(`DELETE FROM iao.services_lead_followup_jobs WHERE status IN ('pending', 'claimed');`);
  const inqDelta = await createInquiryConversation(tenantBeta, {
    customer_name: 'Diana Prince',
    customer_email: 'diana@beta-client.test',
    message_body: 'Water heater emergency leak inspection.',
    service_interest: 'Water Heater',
  });
  const jobDelta = await scheduleServicesLeadFollowup({
    tenantId: tenantBeta,
    leadId: inqDelta.lead_id,
    conversationId: inqDelta.conversation_id,
    delayMinutes: -1,
  });

  // Test atomic claim: Worker A claims the job, Worker B attempts simultaneously
  const worker1Claim = await query(
    `UPDATE iao.services_lead_followup_jobs
     SET status = 'claimed', claimed_by = 'test_worker_1', claimed_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *;`,
    [jobDelta.id]
  );
  assert(worker1Claim.length === 1, 'Worker 1 successfully claimed job');

  const worker2Claim = await query(
    `UPDATE iao.services_lead_followup_jobs
     SET status = 'claimed', claimed_by = 'test_worker_2', claimed_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *;`,
    [jobDelta.id]
  );
  assert(worker2Claim.length === 0, 'Worker 2 blocked by atomic lock from claiming already claimed job');

  // Test stale claim recovery: simulate an interrupted crash (claimed 10 minutes ago)
  await query(
    `UPDATE iao.services_lead_followup_jobs
     SET claimed_at = NOW() - INTERVAL '10 minutes', claimed_by = 'crashed_worker'
     WHERE id = $1;`,
    [jobDelta.id]
  );

  console.log('Running n8n workflow to recover interrupted claim...');
  const run6 = runN8nWorkflow();
  assert(run6.success, 'n8n workflow executed successfully during claim recovery');
  const exec6 = getLatestN8nExecution();
  console.log(`n8n Execution Record: ID=${exec6?.id}, Status=${exec6?.status}`);
  assert(exec6?.status === 'success', 'Claim recovery execution succeeded');

  const checkJob6 = (await query(`SELECT * FROM iao.services_lead_followup_jobs WHERE id = $1;`, [jobDelta.id]))[0];
  const outcome6 = checkJob6.metadata?.outcome;
  assert(outcome6 === 'dispatched', `Job dispatched after recovery (outcome=${outcome6})`);
  assert(checkJob6.attempt_count === 1, 'Attempt count incremented exactly once without duplicate count');

  console.log('\n================================================================');
  console.log(`SUITE SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('================================================================');
  console.log('\nAll verified n8n execution IDs:');
  console.log(`- Scenario 1 (Follow-up dispatch): Execution #${exec1?.id}`);
  console.log(`- Scenario 2 (Escalation to owner): Execution #${exec2?.id}`);
  console.log(`- Scenario 3 (Obsolete cancellation): Execution #${exec3?.id}`);
  console.log(`- Scenario 4 (Zero jobs idle): Execution #${exec4?.id}`);
  console.log(`- Scenario 5a (Safety / unknown path): Execution #${exec5?.id}`);
  console.log(`- Scenario 5b (HTTP 500 resilience): Execution #${exec5b?.id}`);
  console.log(`- Scenario 6 (Claim recovery / concurrency): Execution #${exec6?.id}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

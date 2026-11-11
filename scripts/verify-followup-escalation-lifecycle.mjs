import assert from 'assert';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { query } from '../lib/db.ts';
import {
  scheduleServicesLeadFollowup,
  inspectServicesLeadFollowupEligibility,
  escalateServicesLeadToOwner
} from '../lib/services-pack.ts';
import { encodeSessionCookie } from '../lib/auth.ts';

const BASE_URL = 'http://localhost:3000';
const TENANT_ID = 'sandbox-services-alpha';

// Load N8N_OPERATOR_KEY from .env.local if not present
let operatorKey = process.env.N8N_OPERATOR_KEY || '';
if (!operatorKey) {
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('N8N_OPERATOR_KEY=')) {
          operatorKey = trimmed.replace(/^N8N_OPERATOR_KEY=/, '').replace(/^["']|["']$/g, '');
          break;
        }
      }
    }
  } catch (err) {
    // ignore
  }
}

function getN8nLatestExecution(workflowId = 'wf-services-lead-followups') {
  const raw = execSync(
    `docker exec n8n node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/home/node/.n8n/database.sqlite'); const row = db.prepare('SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity WHERE workflowId = ? ORDER BY id DESC LIMIT 1').get('${workflowId}'); console.log(JSON.stringify(row));"`,
    { encoding: 'utf8' }
  ).trim();
  return JSON.parse(raw);
}

function runN8nWorkflow(workflowId = 'wf-services-lead-followups') {
  try {
    return execSync(`docker exec -e N8N_RUNNERS_BROKER_PORT=5699 n8n n8n execute --id=${workflowId}`, {
      encoding: 'utf8'
    });
  } catch (err) {
    return (err.stdout || '') + '\n' + (err.stderr || '');
  }
}

async function verifyLifecycle() {
  console.log('========================================================================');
  console.log('=== VERIFYING AUTOMATIC ESCALATION LIFECYCLE & DUPLICATE PREVENTION ===');
  console.log('========================================================================\n');

  // Configure sandbox scope for n8n workflow
  const scopeRes = await fetch(`${BASE_URL}/api/services/followup/sandbox-scope`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-iao-worker-key': operatorKey
    },
    body: JSON.stringify({
      sandbox_tenant_id: TENANT_ID,
      mock: true
    })
  });
  assert.strictEqual(scopeRes.status, 200, 'Sandbox scope configuration must succeed');
  const scopeData = await scopeRes.json();
  console.log(`✓ Configured sandbox scope: tenant_id='${scopeData.sandbox_tenant_id}', mock=${scopeData.mock}`);

  // Clear any existing pending/claimed jobs for clean isolated run
  await query(
    `UPDATE iao.services_lead_followup_jobs
     SET status = 'cancelled', last_error = 'Pre-test fixture cleanup'
     WHERE tenant_id = $1 AND status IN ('pending', 'claimed');`,
    [TENANT_ID]
  );

  // ===========================================================================
  // TEST A: Automatic escalation check scheduling through normal application lifecycle
  // (No manual job creation after final follow-up; no reply -> exactly one owner task)
  // ===========================================================================
  console.log('------------------------------------------------------------------------');
  console.log('--- TEST A: Automatic Escalation Scheduling & Single Owner Task ---');
  console.log('------------------------------------------------------------------------');

  const leadAEmail = `aurelius.antoninus.${Date.now()}@example.com`;
  const inqARes = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: TENANT_ID,
      customer_name: 'Aurelius Antoninus',
      customer_email: leadAEmail,
      service_interest: 'HVAC Heat Pump Maintenance',
      message: 'Need urgent diagnostic for commercial heat pump.'
    })
  });
  const inqAData = await inqARes.json();
  const leadAId = inqAData.lead_id;
  const convAId = inqAData.conversation_id;
  console.log(`✓ Created Lead A: ${leadAId}, Conv: ${convAId}`);

  // Schedule initial follow-up job (due immediately)
  const jobA = await scheduleServicesLeadFollowup({
    tenantId: TENANT_ID,
    leadId: leadAId,
    conversationId: convAId,
    delayMinutes: 0,
    metadata: { test: 'automatic_escalation_lifecycle' }
  });
  console.log(`✓ Initial follow-up job scheduled: ${jobA.id} (status: ${jobA.status}, attempt: ${jobA.attempt_count})`);

  // --- Follow-up Attempt 1 ---
  console.log('\n[Follow-up #1] Running n8n workflow...');
  runN8nWorkflow('wf-services-lead-followups');
  const execA1 = getN8nLatestExecution('wf-services-lead-followups');
  console.log(`✓ Execution #${execA1.id} completed (status: ${execA1.status})`);

  const leadAfterA1 = await query(`SELECT reminder_count, stage FROM iao.services_leads WHERE id = $1;`, [leadAId]);
  assert.strictEqual(leadAfterA1[0].reminder_count, 1, 'Reminder count must be 1 after run 1');
  console.log(`✓ Lead reminder_count: ${leadAfterA1[0].reminder_count}`);

  const jobAfterA1 = await query(`SELECT id, status, attempt_count, scheduled_for FROM iao.services_lead_followup_jobs WHERE id = $1;`, [jobA.id]);
  assert.strictEqual(jobAfterA1[0].status, 'pending', 'Job must remain pending for next attempt');
  assert.strictEqual(jobAfterA1[0].attempt_count, 1, 'Attempt count must be 1');
  console.log(`✓ Job ${jobA.id} automatically rescheduled for Attempt #2 at ${jobAfterA1[0].scheduled_for}`);

  // Advance due time for Attempt #2 within isolated test fixture (do not touch reminder_count)
  await query(`UPDATE iao.services_lead_followup_jobs SET scheduled_for = NOW() - INTERVAL '1 minute' WHERE id = $1;`, [jobA.id]);

  // --- Follow-up Attempt 2 (Final Reminder) ---
  console.log('\n[Follow-up #2 - Final Reminder] Running n8n workflow...');
  runN8nWorkflow('wf-services-lead-followups');
  const execA2 = getN8nLatestExecution('wf-services-lead-followups');
  console.log(`✓ Execution #${execA2.id} completed (status: ${execA2.status})`);

  const leadAfterA2 = await query(`SELECT reminder_count, stage FROM iao.services_leads WHERE id = $1;`, [leadAId]);
  assert.strictEqual(leadAfterA2[0].reminder_count, 2, 'Reminder count must be 2 after run 2 (max reached)');
  console.log(`✓ Lead reminder_count: ${leadAfterA2[0].reminder_count} (Max attempts reached)`);

  // VERIFY: Job was NOT terminated or manually created!
  // Normal application lifecycle automatically scheduled it for the reply-wait escalation check!
  const jobAfterA2 = await query(
    `SELECT id, status, attempt_count, scheduled_for, metadata FROM iao.services_lead_followup_jobs WHERE id = $1;`,
    [jobA.id]
  );
  assert.strictEqual(jobAfterA2[0].status, 'pending', 'Job must automatically remain pending for post-reminder escalation check');
  assert.strictEqual(jobAfterA2[0].attempt_count, 2, 'Job attempt_count must be 2');
  assert.strictEqual(jobAfterA2[0].metadata?.phase, 'awaiting_reply_before_escalation', 'Job phase must be awaiting_reply_before_escalation');
  console.log(`✓ [NO MANUAL JOB REQUIRED] Job ${jobA.id} automatically scheduled for escalation check at ${jobAfterA2[0].scheduled_for} (phase: ${jobAfterA2[0].metadata?.phase})`);

  // --- Escalation Cycle Execution ---
  console.log('\n[Escalation Cycle] Advancing past reply-wait period within isolated fixture...');
  await query(`UPDATE iao.services_lead_followup_jobs SET scheduled_for = NOW() - INTERVAL '1 minute' WHERE id = $1;`, [jobA.id]);

  console.log('Running n8n workflow for Escalation Cycle...');
  runN8nWorkflow('wf-services-lead-followups');
  const execA3 = getN8nLatestExecution('wf-services-lead-followups');
  console.log(`✓ Execution #${execA3.id} completed (status: ${execA3.status})`);

  // Verify exactly ONE owner task created in iao.cases
  const casesA = await query(
    `SELECT case_id, tenant_id, kind, status, payload, created_at 
     FROM iao.cases 
     WHERE tenant_id = $1 AND kind = 'lead_escalation' AND payload->>'lead_id' = $2;`,
    [TENANT_ID, leadAId]
  );
  assert.strictEqual(casesA.length, 1, 'Exactly one owner task must be created in iao.cases');
  const ownerTaskA = casesA[0];
  console.log(`✓ [EXACTLY ONE OWNER TASK] Case ID: ${ownerTaskA.case_id}, Status: ${ownerTaskA.status}`);

  // Verify dashboard visibility via /api/cases
  const sessionCookie = encodeSessionCookie({ active_tenant_id: TENANT_ID, role: 'owner' });
  const casesRes = await fetch(`${BASE_URL}/api/cases`, {
    headers: { 'Cookie': `iao_session=${sessionCookie}` }
  });
  const casesData = await casesRes.json();
  const foundInDashboard = (casesData.cases || []).some(c => (c.case_id || c.id) === ownerTaskA.case_id);
  assert(foundInDashboard, 'Escalated case must be visible to owner in dashboard cases API');
  console.log('✓ Owner task verified visible in Owner Dashboard Cases API.');

  // ===========================================================================
  // TEST B: Retrying the escalation cycle does not create duplicate owner tasks
  // ===========================================================================
  console.log('\n------------------------------------------------------------------------');
  console.log('--- TEST B: Retrying Escalation Cycle Does Not Create Duplicate Tasks ---');
  console.log('------------------------------------------------------------------------');

  // Trigger escalation retry directly
  const retryResult = await escalateServicesLeadToOwner({
    tenantId: TENANT_ID,
    leadId: leadAId,
    jobId: jobA.id,
    reason: 'Simulated workflow retry / duplicate escalation trigger'
  });
  console.log(`✓ Retry call returned: taskId=${retryResult.taskId}, duplicate_prevented=${retryResult.duplicate_prevented}`);
  assert.strictEqual(retryResult.taskId, ownerTaskA.case_id, 'Retry must return the same existing task ID');

  // Verify database count in iao.cases remains strictly 1
  const casesAfterRetry = await query(
    `SELECT case_id FROM iao.cases 
     WHERE tenant_id = $1 AND kind = 'lead_escalation' AND payload->>'lead_id' = $2;`,
    [TENANT_ID, leadAId]
  );
  assert.strictEqual(casesAfterRetry.length, 1, 'Total cases for this lead must remain strictly 1 after retry');
  console.log(`✓ [DUPLICATE PREVENTION VERIFIED] Total cases in iao.cases for lead: ${casesAfterRetry.length} (no duplicates created)`);

  // ===========================================================================
  // TEST C: A reply during the final waiting period prevents escalation
  // ===========================================================================
  console.log('\n------------------------------------------------------------------------');
  console.log('--- TEST C: Reply During Final Waiting Period Prevents Escalation ---');
  console.log('------------------------------------------------------------------------');

  const leadCEmail = `lucius.verus.${Date.now()}@example.com`;
  const inqCRes = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: TENANT_ID,
      customer_name: 'Lucius Verus',
      customer_email: leadCEmail,
      service_interest: 'Commercial Chiller Overhaul',
      message: 'Need seasonal maintenance contract quote.'
    })
  });
  const inqCData = await inqCRes.json();
  const leadCId = inqCData.lead_id;
  const convCId = inqCData.conversation_id;
  console.log(`✓ Created Lead C: ${leadCId}, Conv: ${convCId}`);

  // Schedule initial job
  const jobC = await scheduleServicesLeadFollowup({
    tenantId: TENANT_ID,
    leadId: leadCId,
    conversationId: convCId,
    delayMinutes: 0,
    metadata: { test: 'reply_during_wait_period' }
  });

  // Run Follow-up 1
  runN8nWorkflow('wf-services-lead-followups');
  // Advance to Attempt 2
  await query(`UPDATE iao.services_lead_followup_jobs SET scheduled_for = NOW() - INTERVAL '1 minute' WHERE id = $1;`, [jobC.id]);
  // Run Follow-up 2 (Final reminder)
  runN8nWorkflow('wf-services-lead-followups');

  // Verify Lead C is in awaiting_reply_before_escalation phase
  const jobCAfter2 = await query(`SELECT id, status, metadata FROM iao.services_lead_followup_jobs WHERE id = $1;`, [jobC.id]);
  assert.strictEqual(jobCAfter2[0].status, 'pending');
  assert.strictEqual(jobCAfter2[0].metadata?.phase, 'awaiting_reply_before_escalation');
  console.log(`✓ Lead C job is now in waiting period: phase='${jobCAfter2[0].metadata?.phase}'`);

  // NOW: Customer replies during the final waiting period via the real inbound inquiry portal!
  console.log('\nSubmitting customer reply during final waiting period via POST /api/inquiry/submit...');
  const replyRes = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: TENANT_ID,
      customer_name: 'Lucius Verus',
      customer_email: leadCEmail,
      subject: 'Re: Commercial Chiller Overhaul',
      message: 'Sorry for delay! Please send the agreement over, ready to proceed.'
    })
  });
  assert.strictEqual(replyRes.status, 200);
  console.log('✓ Inbound customer reply successfully submitted.');

  // Verify job was automatically cancelled upon customer reply
  const jobCAfterReply = await query(`SELECT id, status, last_error FROM iao.services_lead_followup_jobs WHERE id = $1;`, [jobC.id]);
  assert.strictEqual(jobCAfterReply[0].status, 'cancelled', 'Job must be cancelled upon customer reply during waiting period');
  console.log(`✓ Follow-up job status: '${jobCAfterReply[0].status}', reason: "${jobCAfterReply[0].last_error}"`);

  // Verify eligibility engine reports cancel_obsolete
  const inspectionC = await inspectServicesLeadFollowupEligibility(TENANT_ID, leadCId, jobC.id);
  assert.strictEqual(inspectionC.permitted_path, 'cancel_obsolete');
  console.log(`✓ Eligibility inspection: permitted_path='${inspectionC.permitted_path}', reason='${inspectionC.reason}'`);

  // Verify ZERO owner tasks created for Lead C
  const casesC = await query(
    `SELECT case_id FROM iao.cases WHERE tenant_id = $1 AND kind = 'lead_escalation' AND payload->>'lead_id' = $2;`,
    [TENANT_ID, leadCId]
  );
  assert.strictEqual(casesC.length, 0, 'ZERO owner tasks must exist for lead when customer replied during waiting period');
  console.log('✓ [ZERO ESCALATION VERIFIED] No owner task created because customer replied during waiting period.');

  console.log('\n========================================================================');
  console.log('=== ALL LIFECYCLE & ESCALATION VERIFICATIONS PASSED SUCCESSFULLY ===');
  console.log('========================================================================\n');
  process.exit(0);
}

verifyLifecycle().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});

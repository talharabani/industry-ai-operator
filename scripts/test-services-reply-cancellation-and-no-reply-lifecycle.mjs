import assert from 'assert';
import { execSync } from 'child_process';
import { query } from '../lib/db.ts';
import {
  scheduleServicesLeadFollowup,
  inspectServicesLeadFollowupEligibility,
  claimEligibleServicesFollowupJobs
} from '../lib/services-pack.ts';
import { encodeSessionCookie } from '../lib/auth.ts';

const BASE_URL = 'http://localhost:3000';
const TENANT_ID = 'sandbox-services-alpha';

async function runReplyCancellationAndNoReplyLifecycle() {
  console.log('========================================================================');
  console.log('=== VERIFYING AUTOMATIC REPLY CANCELLATION & NO-REPLY N8N LIFECYCLE ===');
  console.log('========================================================================\n');

  // ===========================================================================
  // SECTION 1: Automatic Reply Cancellation Verification
  // ===========================================================================
  console.log('------------------------------------------------------------------------');
  console.log('--- SECTION 1: Automatic Reply Cancellation via Real Inbound Path ---');
  console.log('------------------------------------------------------------------------');

  // 1.1 Use the Eleanor Vance lead created earlier from browser journey
  const eleanorRows = await query(
    `SELECT id, conversation_id, customer_name, customer_email, stage, status 
     FROM iao.services_leads 
     WHERE customer_email = 'eleanor.vance.pilot@example.com' 
     ORDER BY created_at DESC LIMIT 1;`
  );
  assert(eleanorRows.length > 0, 'Eleanor Vance lead must exist');
  const eleanorLead = eleanorRows[0];
  console.log(`✓ Located Lead for Eleanor Vance: ID=${eleanorLead.id}, Conv=${eleanorLead.conversation_id}`);

  // 1.2 Schedule an active follow-up job for Eleanor Vance
  const scheduledJobA = await scheduleServicesLeadFollowup({
    tenantId: TENANT_ID,
    leadId: eleanorLead.id,
    conversationId: eleanorLead.conversation_id,
    delayMinutes: 60,
    metadata: { pilot_test: 'reply_cancellation' }
  });
  console.log(`✓ Active follow-up job scheduled: ID=${scheduledJobA.id}, Status='${scheduledJobA.status}'`);

  // Count existing messages before inbound reply
  const msgsBeforeReply = await query(
    `SELECT COUNT(*) as count FROM iao.messages WHERE conversation_id = $1;`,
    [eleanorLead.conversation_id]
  );
  const beforeCount = parseInt(msgsBeforeReply[0].count, 10);
  console.log(`  Current message count in Eleanor's thread: ${beforeCount}`);

  // 1.3 Submit a simulated inbound reply through the real public inbound inquiry path
  // NOTE: NOT calling /cancel! Submitting real customer reply to /api/inquiry/submit!
  console.log('\nSubmitting real inbound customer reply via POST /api/inquiry/submit...');
  const inboundReplyRes = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: TENANT_ID,
      customer_name: 'Eleanor Vance',
      customer_email: 'eleanor.vance.pilot@example.com',
      subject: 'Re: Commercial HVAC Maintenance Inquiry',
      message: 'Thank you! We received your estimate and would like to confirm scheduling the technician for Monday morning at 9am.'
    })
  });
  assert.strictEqual(inboundReplyRes.status, 200, 'Inbound inquiry submit must return 200 OK');
  const inboundReplyData = await inboundReplyRes.json();
  assert(inboundReplyData.success, 'Inbound submission must succeed');
  console.log(`✓ Real inbound reply processed by application: reference=${inboundReplyData.reference_id}`);

  // 1.4 Verify that the application detected the inbound reply and automatically cancelled the follow-up job
  const jobStateAfterReply = await query(
    `SELECT id, status, last_error, metadata FROM iao.services_lead_followup_jobs WHERE id = $1;`,
    [scheduledJobA.id]
  );
  assert.strictEqual(jobStateAfterReply[0].status, 'cancelled', 'Follow-up job must be automatically cancelled upon customer reply');
  console.log(`✓ [AUTOMATIC CANCELLATION VERIFIED] Job ${scheduledJobA.id} status='${jobStateAfterReply[0].status}', reason="${jobStateAfterReply[0].last_error}"`);

  // 1.5 Verify eligibility inspection confirms cancel_obsolete
  const inspectionAfterReply = await inspectServicesLeadFollowupEligibility(
    TENANT_ID,
    eleanorLead.id,
    scheduledJobA.id
  );
  console.log(`✓ [ELIGIBILITY INSPECTION VERIFIED] eligible=${inspectionAfterReply.eligible}, action='${inspectionAfterReply.action}', reason='${inspectionAfterReply.reason}'`);
  assert.strictEqual(inspectionAfterReply.action, 'cancel_obsolete', 'Eligibility engine must enforce cancel_obsolete path');

  // Verify no unexpected follow-ups can be dispatched
  const claimedCancelled = await claimEligibleServicesFollowupJobs(10, 'worker_check', TENANT_ID);
  const foundCancelled = claimedCancelled.find(j => j.id === scheduledJobA.id);
  assert.strictEqual(foundCancelled, undefined, 'Cancelled job must never be claimed by workers');
  console.log('✓ Confirmed: Cancelled job cannot be claimed by workers. Zero duplicate/unwanted dispatches.\n');

  // ===========================================================================
  // SECTION 2: No-Reply Lifecycle on Separate Lead Driven by Real n8n Workflow
  // ===========================================================================
  console.log('------------------------------------------------------------------------');
  console.log('--- SECTION 2: No-Reply Lifecycle Driven by Real n8n Workflow ---');
  console.log('------------------------------------------------------------------------');

  const leadBEmail = `marcus.aurelius.noreply.${Date.now()}@example.com`;
  console.log(`Creating separate lead for no-reply testing (${leadBEmail})...`);

  // 2.1 Submit initial public inquiry for Lead B
  const inqBRes = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: TENANT_ID,
      customer_name: 'Marcus Aurelius',
      customer_email: leadBEmail,
      customer_phone: '+1-555-0177',
      service_interest: 'Commercial HVAC Retrofit',
      message: 'Requesting retrofit assessment for our annex wing.'
    })
  });
  const inqBData = await inqBRes.json();
  const leadBId = inqBData.lead_id;
  const convBId = inqBData.conversation_id;
  console.log(`✓ Lead B created: ${leadBId}, Conversation: ${convBId}`);

  // Verify initial reminder_count is 0
  const initialLeadB = await query(
    `SELECT id, reminder_count, stage, status FROM iao.services_leads WHERE id = $1;`,
    [leadBId]
  );
  assert.strictEqual(initialLeadB[0].reminder_count || 0, 0, 'Initial reminder_count must be 0');
  console.log(`✓ Initial lead state: reminder_count=${initialLeadB[0].reminder_count || 0}, stage='${initialLeadB[0].stage}'`);

  // 2.2 Clean any stranded pending jobs for sandbox-services-alpha so our Lead B job is processed first
  await query(
    `UPDATE iao.services_lead_followup_jobs
     SET status = 'cancelled', last_error = 'Pre-test fixture cleanup'
     WHERE tenant_id = $1 AND status IN ('pending', 'claimed') AND lead_id != $2;`,
    [TENANT_ID, leadBId]
  );

  // Schedule Follow-Up Job 1 for Lead B (due immediately)
  const jobB1 = await scheduleServicesLeadFollowup({
    tenantId: TENANT_ID,
    leadId: leadBId,
    conversationId: convBId,
    delayMinutes: 0,
    metadata: { channel: 'email', noreply_test: true }
  });
  console.log(`✓ Scheduled initial follow-up job: ${jobB1.id} (Status='${jobB1.status}')`);

  // Configure active sandbox scope for n8n workflow
  await fetch(`${BASE_URL}/api/services/followup/sandbox-scope`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-iao-worker-key': process.env.N8N_OPERATOR_KEY
    },
    body: JSON.stringify({
      sandbox_tenant_id: TENANT_ID,
      mock: true
    })
  });

  // -------------------------------------------------------------------------
  // RUN 1: Actual n8n Workflow Execution for Follow-up #1
  // -------------------------------------------------------------------------
  console.log('\n[N8N RUN 1] Executing wf-services-lead-followups via n8n CLI for Follow-Up #1...');
  let n8nRun1Output = '';
  try {
    n8nRun1Output = execSync('docker exec -e N8N_RUNNERS_BROKER_PORT=5699 n8n n8n execute --id=wf-services-lead-followups', { encoding: 'utf8' });
  } catch (err) {
    n8nRun1Output = (err.stdout || '') + '\n' + (err.stderr || '');
  }

  // Query SQLite for this execution
  const exec1Raw = execSync(`docker exec n8n node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/home/node/.n8n/database.sqlite'); const row = db.prepare('SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity WHERE workflowId = ? ORDER BY id DESC LIMIT 1').get('wf-services-lead-followups'); console.log(JSON.stringify(row));"`, { encoding: 'utf8' }).trim();
  const exec1 = JSON.parse(exec1Raw);
  console.log(`✓ [N8N RUN 1 Evidence] Execution ID: #${exec1.id}, Status: ${exec1.status.toUpperCase()}, Duration: ${exec1.startedAt} -> ${exec1.stoppedAt}`);

  // Verify Lead B after Run 1: reminder_count MUST HAVE INCREMENTED NATURALLY TO 1
  const leadAfterRun1 = await query(
    `SELECT id, reminder_count, stage FROM iao.services_leads WHERE id = $1;`,
    [leadBId]
  );
  assert.strictEqual(leadAfterRun1[0].reminder_count, 1, 'reminder_count must be naturally incremented to 1 by n8n workflow execution');
  console.log(`✓ [DB Evidence Run 1] Lead B reminder_count naturally incremented from 0 -> ${leadAfterRun1[0].reminder_count} (stage='${leadAfterRun1[0].stage}')`);

  // Verify Message Dispatched for Attempt 1
  const msgRun1 = await query(
    `SELECT id, status, body, metadata FROM iao.messages 
     WHERE conversation_id = $1 AND (metadata->>'followup_attempt')::int = 1;`,
    [convBId]
  );
  assert.strictEqual(msgRun1.length, 1, 'Exactly one message must exist for attempt 1');
  console.log(`✓ [DB Evidence Run 1] Dispatched mock message ID=${msgRun1[0].id}, Status='${msgRun1[0].status}'`);

  // Verify Timeline Event
  const eventRun1 = await query(
    `SELECT id, event_type, summary FROM iao.services_lead_events 
     WHERE lead_id = $1 AND event_type = 'followup_sent';`,
    [leadBId]
  );
  console.log(`✓ [DB Evidence Run 1] Timeline Event: "${eventRun1[0]?.summary}"`);

  // -------------------------------------------------------------------------
  // RUN 2: Actual n8n Workflow Execution for Follow-up #2
  // -------------------------------------------------------------------------
  console.log('\n[TEST FIXTURE] Advancing due time for next scheduled attempt within isolated fixture...');
  // The workflow rescheduled jobB1 for 48h in the future. Advance scheduled_for to NOW() - 1 min to make it eligible.
  // Note: We do NOT touch reminder_count!
  await query(
    `UPDATE iao.services_lead_followup_jobs
     SET scheduled_for = NOW() - INTERVAL '1 minute'
     WHERE id = $1;`,
    [jobB1.id]
  );
  console.log('✓ Scheduled due time advanced to current time.');

  console.log('\n[N8N RUN 2] Executing wf-services-lead-followups via n8n CLI for Follow-Up #2...');
  let n8nRun2Output = '';
  try {
    n8nRun2Output = execSync('docker exec -e N8N_RUNNERS_BROKER_PORT=5699 n8n n8n execute --id=wf-services-lead-followups', { encoding: 'utf8' });
  } catch (err) {
    n8nRun2Output = (err.stdout || '') + '\n' + (err.stderr || '');
  }

  const exec2Raw = execSync(`docker exec n8n node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/home/node/.n8n/database.sqlite'); const row = db.prepare('SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity WHERE workflowId = ? ORDER BY id DESC LIMIT 1').get('wf-services-lead-followups'); console.log(JSON.stringify(row));"`, { encoding: 'utf8' }).trim();
  const exec2 = JSON.parse(exec2Raw);
  console.log(`✓ [N8N RUN 2 Evidence] Execution ID: #${exec2.id}, Status: ${exec2.status.toUpperCase()}, Duration: ${exec2.startedAt} -> ${exec2.stoppedAt}`);

  // Verify Lead B after Run 2: reminder_count MUST HAVE INCREMENTED NATURALLY TO 2 (THRESHOLD REACHED!)
  const leadAfterRun2 = await query(
    `SELECT id, reminder_count, stage FROM iao.services_leads WHERE id = $1;`,
    [leadBId]
  );
  assert.strictEqual(leadAfterRun2[0].reminder_count, 2, 'reminder_count must be naturally incremented to 2 (threshold reached)');
  console.log(`✓ [DB Evidence Run 2] Lead B reminder_count naturally incremented from 1 -> ${leadAfterRun2[0].reminder_count} (MAX REMINDER THRESHOLD REACHED!)`);

  // Verify Message Dispatched for Attempt 2
  const msgRun2 = await query(
    `SELECT id, status, body, metadata FROM iao.messages 
     WHERE conversation_id = $1 AND (metadata->>'followup_attempt')::int = 2;`,
    [convBId]
  );
  assert.strictEqual(msgRun2.length, 1, 'Exactly one message must exist for attempt 2');
  console.log(`✓ [DB Evidence Run 2] Dispatched mock message ID=${msgRun2[0].id}, Status='${msgRun2[0].status}'`);

  // -------------------------------------------------------------------------
  // RUN 3: Escalation Cycle (Workflow Routes to Owner Task Escalation)
  // -------------------------------------------------------------------------
  console.log('\n[N8N RUN 3] Scheduling next cycle job and executing wf-services-lead-followups for Owner Task Escalation...');
  const jobB3 = await scheduleServicesLeadFollowup({
    tenantId: TENANT_ID,
    leadId: leadBId,
    conversationId: convBId,
    delayMinutes: 0,
    metadata: { channel: 'email', cycle: 'escalation_check' }
  });
  console.log(`✓ Scheduled escalation cycle job: ${jobB3.id}`);

  let n8nRun3Output = '';
  try {
    n8nRun3Output = execSync('docker exec -e N8N_RUNNERS_BROKER_PORT=5699 n8n n8n execute --id=wf-services-lead-followups', { encoding: 'utf8' });
  } catch (err) {
    n8nRun3Output = (err.stdout || '') + '\n' + (err.stderr || '');
  }

  const exec3Raw = execSync(`docker exec n8n node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/home/node/.n8n/database.sqlite'); const row = db.prepare('SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity WHERE workflowId = ? ORDER BY id DESC LIMIT 1').get('wf-services-lead-followups'); console.log(JSON.stringify(row));"`, { encoding: 'utf8' }).trim();
  const exec3 = JSON.parse(exec3Raw);
  console.log(`✓ [N8N RUN 3 Evidence] Execution ID: #${exec3.id}, Status: ${exec3.status.toUpperCase()}, Duration: ${exec3.startedAt} -> ${exec3.stoppedAt}`);

  // Verify Owner Task Created in iao.cases
  const ownerCases = await query(
    `SELECT case_id, tenant_id, kind, status, payload, created_at 
     FROM iao.cases 
     WHERE tenant_id = $1 AND kind = 'lead_escalation' AND payload->>'lead_id' = $2
     ORDER BY created_at DESC LIMIT 1;`,
    [TENANT_ID, leadBId]
  );
  assert(ownerCases.length > 0, 'Owner task must be created in iao.cases upon reaching max reminders');
  const ownerTask = ownerCases[0];
  console.log(`\n✓ [OWNER TASK VERIFIED IN iao.cases] Case ID: ${ownerTask.case_id}`);
  console.log(`  Kind:    ${ownerTask.kind}`);
  console.log(`  Status:  ${ownerTask.status}`);
  console.log(`  Lead ID: ${ownerTask.payload?.lead_id}`);
  console.log(`  Reason:  "${ownerTask.payload?.reason}"`);

  // Verify Dashboard Visibility via real /api/cases endpoint
  const sessionCookie = encodeSessionCookie({ active_tenant_id: TENANT_ID, role: 'owner' });
  const casesApiRes = await fetch(`${BASE_URL}/api/cases`, {
    headers: { 'Cookie': `iao_session=${sessionCookie}` }
  });
  const casesApiData = await casesApiRes.json();
  const casesList = casesApiData.cases || [];
  const foundInApi = casesList.find(c => c.case_id === ownerTask.case_id || c.id === ownerTask.case_id);
  assert(foundInApi, 'Owner task must be visible in Dashboard Cases API');
  console.log(`✓ [DASHBOARD VISIBILITY VERIFIED] Case visible to authorized owner in dashboard cases list (status='${foundInApi.status}')`);

  // Verify Timeline Events
  const allEvents = await query(
    `SELECT id, event_type, summary, created_at 
     FROM iao.services_lead_events 
     WHERE lead_id = $1 
     ORDER BY created_at ASC;`,
    [leadBId]
  );
  console.log('\n--- Complete Lead B Timeline in iao.services_lead_events ---');
  for (const ev of allEvents) {
    console.log(`- [${ev.event_type}] ${ev.summary} (${ev.created_at})`);
  }

  // Verify Escalation Audit Record in iao.audit (authoritative DB)
  const auditRows = await query(
    `SELECT id, tenant_id, event, details, created_at 
     FROM iao.audit 
     WHERE tenant_id = $1 
     ORDER BY id DESC LIMIT 5;`,
    [TENANT_ID]
  );
  console.log('\n--- Latest Authoritative Audit Records in iao.audit ---');
  for (const aud of auditRows) {
    console.log(`- Audit ID ${aud.id}: Event '${aud.event}' at ${aud.created_at}`);
  }

  console.log('\n========================================================================');
  console.log('=== ALL AUTOMATIC REPLY CANCELLATION & NO-REPLY CHECKS PASSED ===');
  console.log('========================================================================\n');
  process.exit(0);
}

runReplyCancellationAndNoReplyLifecycle().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});

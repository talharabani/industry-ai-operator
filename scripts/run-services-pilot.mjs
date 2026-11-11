import assert from 'assert';
import { query } from '../lib/db.ts';
import {
  scheduleServicesLeadFollowup,
  claimEligibleServicesFollowupJobs,
  dispatchServicesLeadFollowup,
  inspectServicesLeadFollowupEligibility,
  escalateServicesLeadToOwner
} from '../lib/services-pack.ts';
import { encodeSessionCookie } from '../lib/auth.ts';

const BASE_URL = 'http://localhost:3000';
const TENANT_ID = 'sandbox-services-alpha';

// Helper to generate auth cookie for requests
function getAuthHeaders(role = 'owner') {
  const sessionToken = encodeSessionCookie({
    active_tenant_id: TENANT_ID,
    user_id: 'owner-pilot',
    user_name: 'Pilot Business Owner',
    email: 'owner@sandbox-services.local',
    role: role
  });
  return {
    'Cookie': `iao_session=${sessionToken}`,
    'x-iao-worker-key': process.env.N8N_OPERATOR_KEY,
    'Content-Type': 'application/json'
  };
}

async function runServicesPilot() {
  console.log('================================================================');
  console.log('=== CONTROLLED SERVICES PILOT EXECUTION ===');
  console.log('================================================================\n');

  // [Database Fixture Setup]
  console.log('[FIXTURE SETUP] Ensuring sandbox-services-alpha workspace configured...');
  await query(
    `INSERT INTO iao.businesses (tenant_id, settings, updated_at)
     VALUES ($1, '{"business_name":"Alpha HVAC Services","industry":"services","services_config":{"enable_customer_followup":true},"connections":{"website":{"hosted_inquiry_enabled":true}}}'::jsonb, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       settings = '{"business_name":"Alpha HVAC Services","industry":"services","services_config":{"enable_customer_followup":true},"connections":{"website":{"hosted_inquiry_enabled":true}}}'::jsonb,
       updated_at = NOW();`,
    [TENANT_ID]
  );
  console.log('✓ Business fixture established.\n');

  // ===========================================================================
  // PART 1: Lead A - Full Ingestion -> AI Draft -> Owner Approval -> Mock Dispatch -> Reply Cancels
  // ===========================================================================
  console.log('----------------------------------------------------------------');
  console.log('--- PART 1: Lead A (Reply Cancellation Flow) ---');
  console.log('----------------------------------------------------------------');

  // Step 1: Public Inquiry Submission [API Test: Public Facing]
  console.log('\n[API Action 1.1] Submitting public inquiry via POST /api/inquiry/submit...');
  const inquiryResA = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: TENANT_ID,
      customer_name: 'Marcus Aurelius',
      customer_email: `marcus.aurelius.${Date.now()}@example.com`,
      customer_phone: '+1-555-0199',
      service_interest: 'Commercial HVAC Inspection',
      budget_range: '$5,000 - $10,000',
      location: 'Rome HQ, Suite 100',
      subject: 'Seasonal HVAC Maintenance Request',
      message: 'We require a comprehensive seasonal HVAC inspection for our downtown office building.'
    })
  });
  assert.strictEqual(inquiryResA.status, 200, 'Inquiry submit must return 200 OK');
  const inquiryDataA = await inquiryResA.json();
  assert(inquiryDataA.success, 'Inquiry submit must succeed');
  assert(inquiryDataA.lead_id, 'Lead ID must be generated');
  assert(inquiryDataA.conversation_id, 'Conversation ID must be generated');
  console.log(`✓ [API Result] Lead Created: ${inquiryDataA.lead_id}, Conversation: ${inquiryDataA.conversation_id}`);

  // Step 2: Dashboard Lead Verification [Database Inspection]
  console.log('\n[DB Verification 1.2] Verifying lead record in iao.services_leads...');
  const leadRowsA = await query(
    `SELECT id, tenant_id, customer_name, customer_email, stage, status
     FROM iao.services_leads WHERE id = $1;`,
    [inquiryDataA.lead_id]
  );
  assert.strictEqual(leadRowsA.length, 1);
  assert.strictEqual(leadRowsA[0].customer_name, 'Marcus Aurelius');
  assert.strictEqual(leadRowsA[0].stage, 'new');
  assert.strictEqual(leadRowsA[0].status, 'open');
  console.log(`✓ [DB Verified] Lead ${leadRowsA[0].id} is stage='${leadRowsA[0].stage}', status='${leadRowsA[0].status}'`);

  // Step 3: AI Reply Draft Generation [API Action: AI Pipeline]
  console.log(`\n[API Action 1.3] Generating AI draft reply via POST /api/inbox/${inquiryDataA.conversation_id}/draft...`);
  const draftResA = await fetch(`${BASE_URL}/api/inbox/${inquiryDataA.conversation_id}/draft`, {
    method: 'POST',
    headers: getAuthHeaders('owner')
  });
  assert.strictEqual(draftResA.status, 200, 'AI draft creation must return 200 OK');
  const draftDataA = await draftResA.json();
  assert(draftDataA.success, 'AI draft creation must succeed');
  assert(draftDataA.draft?.id, 'Draft message ID must be returned');
  assert.strictEqual(draftDataA.draft.status, 'draft', 'Message status must be draft');
  assert.strictEqual(draftDataA.draft.approval_status, 'pending_approval', 'Approval status must be pending_approval');
  console.log(`✓ [API Result] AI Draft Created: ID=${draftDataA.draft.id}, Status='${draftDataA.draft.status}', ApprovalStatus='${draftDataA.draft.approval_status}'`);
  console.log(`  Draft Snippet: "${draftDataA.body?.slice(0, 90)}..."`);

  // Step 4: Owner Approval [UI/API Action: Human in the loop]
  console.log(`\n[API/UI Action 1.4] Owner reviews and approves draft via POST /api/inbox/${inquiryDataA.conversation_id}/messages/${draftDataA.draft.id}/approve...`);
  const approveResA = await fetch(`${BASE_URL}/api/inbox/${inquiryDataA.conversation_id}/messages/${draftDataA.draft.id}/approve`, {
    method: 'POST',
    headers: getAuthHeaders('owner')
  });
  assert.strictEqual(approveResA.status, 200, 'Draft approval must return 200 OK');
  const approveDataA = await approveResA.json();
  assert(approveDataA.success, 'Draft approval must succeed');
  console.log(`✓ [API Result] Draft Approved by Owner: Status='${approveDataA.message?.status}', ApprovalStatus='${approveDataA.message?.approval_status}'`);

  // Step 5: Mock Dispatch [API Action: Safe sandbox outbound dispatch]
  console.log(`\n[API Action 1.5] Disagree/Dispatching approved message via POST /api/inbox/${inquiryDataA.conversation_id}/messages/${draftDataA.draft.id}/send...`);
  const sendResA = await fetch(`${BASE_URL}/api/inbox/${inquiryDataA.conversation_id}/messages/${draftDataA.draft.id}/send`, {
    method: 'POST',
    headers: getAuthHeaders('owner')
  });
  assert.strictEqual(sendResA.status, 200, 'Send must return 200 OK');
  const sendDataA = await sendResA.json();
  assert(sendDataA.success, 'Send must succeed');
  console.log(`✓ [API Result] Message Dispatched in Mock/Demo Channel (Simulated Send): ${sendDataA.message?.status}`);

  // Schedule Follow-Up Job for Lead A
  console.log('\n[Workflow Action 1.6] Scheduling Services follow-up job for Lead A...');
  const followJobA = await scheduleServicesLeadFollowup({
    tenantId: TENANT_ID,
    leadId: inquiryDataA.lead_id,
    conversationId: inquiryDataA.conversation_id,
    delayMinutes: 60,
    metadata: { channel: 'email', pilot_lead: 'A' }
  });
  console.log(`✓ Follow-up job scheduled: ID=${followJobA.id}, Status='${followJobA.status}'`);

  // Step 6: Customer Reply Simulated -> Follow-Up Cancelled [Simulated Event & API Action]
  console.log('\n[Simulated Event 1.7] Customer replies via email/phone. Cancelling follow-up job via POST /api/services/followup/cancel...');
  const cancelResA = await fetch(`${BASE_URL}/api/services/followup/cancel`, {
    method: 'POST',
    headers: getAuthHeaders('owner'),
    body: JSON.stringify({
      tenant_id: TENANT_ID,
      lead_id: inquiryDataA.lead_id,
      job_id: followJobA.id,
      reason: 'Customer Marcus Aurelius replied to initial inspection quote via email'
    })
  });
  assert.strictEqual(cancelResA.status, 200, 'Cancel must return 200 OK');
  const cancelDataA = await cancelResA.json();
  assert(cancelDataA.success, 'Cancel must succeed');
  console.log(`✓ [API Result] Cancelled follow-up job: ${cancelDataA.message}`);

  // Verify Follow-up Job in DB is Cancelled
  const checkJobA = await query(
    `SELECT id, status, metadata FROM iao.services_lead_followup_jobs WHERE id = $1;`,
    [followJobA.id]
  );
  assert.strictEqual(checkJobA[0].status, 'cancelled');
  console.log(`✓ [DB Verified] Job ${checkJobA[0].id} state confirmed: status='${checkJobA[0].status}' (No unwanted follow-ups will run).`);

  // ===========================================================================
  // PART 2: Lead B - No-Reply Escalation to Owner Task Flow
  // ===========================================================================
  console.log('\n----------------------------------------------------------------');
  console.log('--- PART 2: Lead B (No-Reply Escalation Flow) ---');
  console.log('----------------------------------------------------------------');

  // Step 1: Public Inquiry Submission for Lead B [API Test: Public Facing]
  console.log('\n[API Action 2.1] Submitting public inquiry for Lead B via POST /api/inquiry/submit...');
  const inquiryResB = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: TENANT_ID,
      customer_name: 'Lucius Seneca',
      customer_email: `lucius.seneca.${Date.now()}@example.com`,
      customer_phone: '+1-555-0188',
      service_interest: 'Emergency Pipe Repair',
      budget_range: '$2,000 - $4,000',
      location: 'Rome Villa District',
      subject: 'Urgent HVAC Compressor Failure',
      message: 'Compressor failed overnight. Urgent technician dispatch required.'
    })
  });
  assert.strictEqual(inquiryResB.status, 200);
  const inquiryDataB = await inquiryResB.json();
  console.log(`✓ [API Result] Lead B Created: ${inquiryDataB.lead_id}`);

  // Step 2: Follow-up Reminders Cycle Without Customer Reply
  console.log('\n[Simulated Event 2.2] Customer does not reply. Reminders cycle dispatched...');
  // Update reminder_count to reach threshold (2)
  await query(
    `UPDATE iao.services_leads
     SET reminder_count = 2, updated_at = NOW()
     WHERE id = $1;`,
    [inquiryDataB.lead_id]
  );
  console.log('✓ Lead B reminder_count incremented to 2 (maximum reminder threshold reached)');

  // Step 3: Next follow-up job scheduled
  const followJobB = await scheduleServicesLeadFollowup({
    tenantId: TENANT_ID,
    leadId: inquiryDataB.lead_id,
    conversationId: inquiryDataB.conversation_id,
    delayMinutes: 0,
    metadata: { channel: 'email', pilot_lead: 'B' }
  });
  console.log(`✓ Follow-up job scheduled for Lead B: ID=${followJobB.id}`);

  // Step 4: Worker claims the follow-up job for orchestration execution
  const claimedJobsB = await claimEligibleServicesFollowupJobs(50, 'worker_pilot_escalation', TENANT_ID);
  const claimedJobB = claimedJobsB.find(j => j.id === followJobB.id);
  assert(claimedJobB, 'Worker must claim the scheduled follow-up job');
  console.log(`✓ Worker claimed job ${followJobB.id} (status='${claimedJobB.status}')`);

  // Step 5: Eligibility Inspection identifies escalation path [Engine Logic]
  console.log('\n[Engine Action 2.4] Inspecting eligibility for follow-up job...');
  const inspectionB = await inspectServicesLeadFollowupEligibility(
    TENANT_ID,
    inquiryDataB.lead_id,
    followJobB.id
  );
  console.log(`✓ Inspection Result: eligible=${inspectionB.eligible}, action='${inspectionB.action}', reason='${inspectionB.reason}'`);
  assert.strictEqual(inspectionB.action, 'owner_task_escalation', 'Must route to owner_task_escalation branch');

  // Step 6: Execute Escalation to Owner Task [Application Path]
  console.log('\n[Application Action 2.5] Executing escalation to owner task...');
  const escalationResult = await escalateServicesLeadToOwner(
    TENANT_ID,
    inquiryDataB.lead_id,
    followJobB.id,
    inspectionB.reason || 'Lead follow-up limit reached without customer response'
  );
  assert.strictEqual(escalationResult.escalated, true, 'Escalation must be marked true');
  assert(escalationResult.task_id, 'Owner task ID must be generated in iao.cases');
  console.log(`✓ [Escalation Created] Case ID: ${escalationResult.task_id}, Escalated: ${escalationResult.escalated}`);

  // Step 6: Verify Owner Task in iao.cases [Database Inspection]
  console.log('\n[DB Verification 2.5] Inspecting owner task in iao.cases...');
  const caseRows = await query(
    `SELECT case_id, tenant_id, kind, status, payload, created_at
     FROM iao.cases WHERE case_id = $1;`,
    [escalationResult.task_id]
  );
  assert.strictEqual(caseRows.length, 1);
  const task = caseRows[0];
  assert.strictEqual(task.kind, 'lead_escalation');
  assert.strictEqual(task.status, 'pending_approval');
  console.log(`✓ [DB Verified] Owner Task ${task.case_id} active in iao.cases:`);
  console.log(`  Kind:    ${task.kind}`);
  console.log(`  Status:  ${task.status}`);
  console.log(`  Lead ID: ${task.payload?.lead_id}`);
  console.log(`  Reason:  "${task.payload?.reason}"`);

  // Verify Timeline Event for Escalation
  const leadEvents = await query(
    `SELECT id, event_type, summary, details, created_at
     FROM iao.services_lead_events
     WHERE lead_id = $1 AND event_type = 'escalated_to_owner'
     ORDER BY created_at DESC LIMIT 1;`,
    [inquiryDataB.lead_id]
  );
  assert.strictEqual(leadEvents.length, 1);
  console.log(`✓ [Timeline Event Verified] Event '${leadEvents[0].event_type}' logged: "${leadEvents[0].summary}"`);

  // Verify Follow-up Job is Marked Completed with outcome escalated_to_owner
  const jobStateB = await query(
    `SELECT id, status, metadata FROM iao.services_lead_followup_jobs WHERE id = $1;`,
    [followJobB.id]
  );
  assert.strictEqual(jobStateB[0].status, 'completed');
  assert.strictEqual(jobStateB[0].metadata?.outcome, 'escalated_to_owner');
  console.log(`✓ [Job State Verified] Follow-up job ${followJobB.id} marked status='${jobStateB[0].status}', outcome='${jobStateB[0].metadata?.outcome}'`);

  console.log('\n================================================================');
  console.log('=== CONTROLLED SERVICES PILOT: ALL STEPS PASSED SUCCESSFULLY ===');
  console.log('================================================================\n');

  process.exit(0);
}

runServicesPilot().catch(e => {
  console.error('Pilot execution error:', e);
  process.exit(1);
});

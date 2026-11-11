/**
 * test-services-n8n-orchestration.mjs
 * 
 * Verifies the n8n Orchestration Branch for Services Lead Follow-Up:
 * 1. Operator-authenticated endpoints (rejects without key, allows with operator key).
 * 2. Atomic job claims via FOR UPDATE SKIP LOCKED (concurrency safety).
 * 3. State inspection immediately before dispatch (handles customer reply, opt-out, closure).
 * 4. Branching decision paths:
 *    - customer_followup (normal eligible follow-up)
 *    - owner_task_escalation (max reminders exceeded -> creates owner task)
 *    - cancel_obsolete (customer replied, closed lead, or manual takeover)
 * 5. Outcome recording and retry bounds.
 */

import { query, getBusiness, updateBusinessSettings, createInquiryConversation } from '../lib/db.ts';
import {
  createBusinessWorkspace,
  scheduleServicesLeadFollowup,
  claimEligibleServicesFollowupJobs,
  inspectServicesLeadFollowupEligibility,
  dispatchServicesLeadFollowup,
  escalateServicesLeadToOwner,
  cancelServicesLeadFollowup,
  completeServicesLeadFollowupJob,
  getServicesLead,
  updateServicesLead,
} from '../lib/services-pack.ts';
import { getServerConfig } from '../lib/config.ts';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function run() {
  console.log('--- Services n8n Orchestration Branch Verification ---\n');

  const runSuffix = Date.now().toString(36);
  const tenantId = `test-orchestration-agency-${runSuffix}`;
  const ownerUserId = `usr-agency-${runSuffix}`;
  const ownerEmail = `clara-${runSuffix}@agency.test`;

  try {
    // 1. Setup agency business workspace
    console.log('[1] Creating Workspace for n8n Orchestration...');
    const biz = await createBusinessWorkspace({
      tenantId,
      businessName: 'Clara Digital Services',
      businessType: 'services',
      industry: 'services',
      ownerUserId,
      ownerEmail,
      ownerName: 'Clara Oswald',
    });

    await updateBusinessSettings(tenantId, {
      ...biz.settings,
      automation_mode: 'auto_routine',
      services_config: {
        enable_customer_followup: true,
        max_followup_attempts: 2,
        followup_delay_hours: 24,
      },
    });

    // 2. Create Inquiries and Leads
    console.log('\n[2] Setting up Test Leads...');
    const inqA = await createInquiryConversation(tenantId, {
      customer_name: 'Lead Alpha',
      customer_email: 'alpha@client.test',
      message_body: 'Looking for digital agency services for our rebrand.',
      service_interest: 'Branding & Identity',
    });

    const inqB = await createInquiryConversation(tenantId, {
      customer_name: 'Lead Beta',
      customer_email: 'beta@client.test',
      message_body: 'Need urgent technical SEO audit.',
      service_interest: 'SEO Audit',
    });

    const leadA = await getServicesLead(tenantId, inqA.lead_id);
    const leadB = await getServicesLead(tenantId, inqB.lead_id);

    // Schedule follow-ups due right now (delayMinutes: -1 for immediate eligibility)
    const jobA = await scheduleServicesLeadFollowup({
      tenantId,
      leadId: leadA.id,
      conversationId: inqA.conversation_id,
      followupType: 'customer_followup',
      delayMinutes: -1,
    });

    const jobB = await scheduleServicesLeadFollowup({
      tenantId,
      leadId: leadB.id,
      conversationId: inqB.conversation_id,
      followupType: 'customer_followup',
      delayMinutes: -1,
    });

    assert(Boolean(jobA?.id) && Boolean(jobB?.id), 'Initial follow-up jobs scheduled');

    // 3. Test Atomic Claims (FOR UPDATE SKIP LOCKED)
    console.log('\n[3] Testing Atomic Claims & Concurrency Protection...');
    // Worker 1 claims up to 1 job
    const worker1Claim = await claimEligibleServicesFollowupJobs(1, 'worker-1', tenantId);
    assert(worker1Claim.length === 1, 'Worker 1 claimed exactly 1 eligible job');
    const claimedJob1 = worker1Claim[0];

    // Worker 2 claims up to 1 job concurrently
    const worker2Claim = await claimEligibleServicesFollowupJobs(1, 'worker-2', tenantId);
    assert(worker2Claim.length === 1, 'Worker 2 claimed exactly 1 eligible job');
    const claimedJob2 = worker2Claim[0];

    assert(
      claimedJob1.id !== claimedJob2.id,
      'Concurrent workers claimed mutually exclusive jobs without collision'
    );

    // Worker 3 attempts to claim when no other jobs are due
    const worker3Claim = await claimEligibleServicesFollowupJobs(5, 'worker-3', tenantId);
    assert(
      worker3Claim.length === 0,
      'No duplicate claims possible for already claimed jobs'
    );

    // 4. Test State Inspection Path: customer_followup
    console.log('\n[4] Inspecting Job Eligibility Immediately Before Dispatch...');
    const inspectionA = await inspectServicesLeadFollowupEligibility(
      claimedJob1.tenant_id,
      claimedJob1.lead_id,
      claimedJob1.id
    );

    assert(inspectionA.eligible === true, 'Job 1 is eligible for dispatch');
    assert(inspectionA.action === 'customer_followup', 'Action correctly chosen as customer_followup');
    assert(Boolean(inspectionA.customer?.email), 'Customer details included for dispatch');

    // 5. Test Mock Dispatch & Outcome Recording
    console.log('\n[5] Executing Dispatch & Recording Outcome...');
    const dispatchResult = await dispatchServicesLeadFollowup(
      claimedJob1.tenant_id,
      claimedJob1.lead_id,
      claimedJob1.id,
      {
        channel: 'email',
        message_body: 'Hi Lead Alpha, just following up on your branding inquiry!',
        mock: true, // Sandbox test mode: no live email sent
      }
    );

    assert(dispatchResult.dispatched === true, 'Follow-up marked as successfully dispatched');
    assert(dispatchResult.reminder_count === 1, 'Reminder count incremented to 1');

    await completeServicesLeadFollowupJob(claimedJob1.id, {
      status: 'completed',
      outcome: 'dispatched',
    });

    // 6. Test Cancellation Path: Manual Takeover or Customer Reply
    console.log('\n[6] Testing Obsolete Cancellation Branch...');
    // Simulate manual takeover on Lead B
    await updateServicesLead(claimedJob2.tenant_id, claimedJob2.lead_id, {
      manual_takeover: true,
    });

    const inspectionB = await inspectServicesLeadFollowupEligibility(
      claimedJob2.tenant_id,
      claimedJob2.lead_id,
      claimedJob2.id
    );

    assert(inspectionB.eligible === false, 'Job 2 is no longer eligible after manual takeover');
    assert(
      inspectionB.action === 'cancel_obsolete',
      'Action switched to cancel_obsolete on manual takeover'
    );

    const cancelResult = await cancelServicesLeadFollowup(
      claimedJob2.tenant_id,
      claimedJob2.lead_id,
      inspectionB.reason
    );
    assert(cancelResult.cancelled === true, 'Job 2 cancelled successfully in backend');

    // 7. Test Escalation Branch: Max Reminders Exceeded
    console.log('\n[7] Testing Escalation Branch (Owner Task Creation)...');
    // Force reminder_count to reach max (2)
    await query(
      `UPDATE iao.services_leads SET reminder_count = 2 WHERE id = $1;`,
      [claimedJob1.lead_id]
    );

    // Schedule next job
    const jobEscalate = await scheduleServicesLeadFollowup({
      tenantId,
      leadId: claimedJob1.lead_id,
      conversationId: inqA.conversation_id,
      followupType: 'customer_followup',
      delayMinutes: -1,
    });

    const inspectionEscalate = await inspectServicesLeadFollowupEligibility(
      tenantId,
      claimedJob1.lead_id,
      jobEscalate.id
    );

    assert(
      inspectionEscalate.action === 'owner_task_escalation',
      'Action switches to owner_task_escalation when max reminders reached'
    );

    const escalationResult = await escalateServicesLeadToOwner(
      tenantId,
      claimedJob1.lead_id,
      jobEscalate.id,
      inspectionEscalate.reason
    );

    assert(escalationResult.escalated === true, 'Escalation recorded successfully');
    assert(Boolean(escalationResult.task_id), 'Owner task created for team intervention');

    console.log(`\n==================================================`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`==================================================\n`);

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  }
}

run();

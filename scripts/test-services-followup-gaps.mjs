/**
 * test-services-followup-gaps.mjs
 * 
 * Verifies fixes for the two remaining gaps in Services Lead Follow-Up workflow:
 * 1. Enforce explicit sandbox scope:
 *    - Missing scope fails before claiming test jobs (0 jobs claimed, 0 DB mutations).
 *    - Valid sandbox scope processes ONLY that tenant's jobs.
 *    - Unauthorized scope is rejected.
 * 2. Make failed business outcomes visibly fail in n8n:
 *    - Unknown path persists failure audit to DB, then execution status is marked 'error' (red).
 *    - Normal mocked follow-up succeeds without live email dispatch.
 *    - No jobs left abandoned in 'claimed' status.
 */

import { execSync } from 'child_process';
import { query, updateBusinessSettings, createInquiryConversation } from '../lib/db.ts';
import {
  createBusinessWorkspace,
  scheduleServicesLeadFollowup,
} from '../lib/services-pack.ts';

const BASE_URL = 'http://localhost:3000';
const OPERATOR_KEY = 'f0cb43c2640716a8c7c1cc46c6bf88f18a55486aafc60203543df7383857b9e8';

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

async function setSandboxScope(tenantId, mock = true) {
  const res = await fetch(`${BASE_URL}/api/services/followup/sandbox-scope`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operator-key': OPERATOR_KEY,
    },
    body: JSON.stringify({
      sandbox_tenant_id: tenantId,
      mock,
    }),
  });
  return res.json();
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
  console.log('=== Services Lead Follow-Up Gaps Verification Suite ===');
  console.log('================================================================\n');

  const tenantAlpha = 'sandbox-services-alpha';
  const tenantBeta = 'sandbox-services-beta';

  // Ensure sandbox businesses exist
  await createBusinessWorkspace({
    tenantId: tenantAlpha,
    businessName: 'Alpha Electrical Services',
    businessType: 'services',
    industry: 'services',
    ownerUserId: 'usr-alpha-owner',
    ownerEmail: 'owner@alpha-services.test',
  });
  await updateBusinessSettings(tenantAlpha, {
    business_name: 'Alpha Electrical Services',
    industry: 'services',
    services_config: { enable_customer_followup: true, max_followup_attempts: 2 },
  });

  await createBusinessWorkspace({
    tenantId: tenantBeta,
    businessName: 'Beta Plumbing Pros',
    businessType: 'services',
    industry: 'services',
    ownerUserId: 'usr-beta-owner',
    ownerEmail: 'owner@beta-services.test',
  });
  await updateBusinessSettings(tenantBeta, {
    business_name: 'Beta Plumbing Pros',
    industry: 'services',
    services_config: { enable_customer_followup: true, max_followup_attempts: 2 },
  });

  // -------------------------------------------------------------------------
  // TEST 1: Missing Sandbox Scope -> Fails Before DB Mutation (0 Jobs Claimed)
  // -------------------------------------------------------------------------
  console.log('--- Test 1: Missing Sandbox Scope ---');
  await query(`DELETE FROM iao.services_lead_followup_jobs WHERE status IN ('pending', 'claimed');`);

  // Explicitly clear any active sandbox scope
  await setSandboxScope(null);

  const inq1 = await createInquiryConversation(tenantAlpha, {
    customer_name: 'Test Missing Scope',
    customer_email: `test-scope-${Date.now()}@example.test`,
    message_body: 'Testing missing sandbox scope behavior.',
  });
  const job1 = await scheduleServicesLeadFollowup({
    tenantId: tenantAlpha,
    leadId: inq1.lead_id,
    conversationId: inq1.conversation_id,
    delayMinutes: -1,
  });

  console.log(`Created pending job: ${job1.id}`);
  console.log('Executing workflow with NO sandbox scope...');
  const runNoScope = runN8nWorkflow();
  const execNoScope = getLatestN8nExecution();

  console.log(`n8n Execution Record: ID=${execNoScope?.id}, Status=${execNoScope?.status}`);
  assert(execNoScope?.status === 'error', 'n8n execution status is ERROR (visibly failed in n8n)');
  assert(!runNoScope.success, 'CLI execution command returned non-zero exit code on missing scope');
  assert(
    runNoScope.output.includes('Missing explicit sandbox tenant scope'),
    'Error message explicitly specifies missing sandbox scope'
  );

  // Verify zero jobs were claimed
  const checkJob1 = (await query(`SELECT * FROM iao.services_lead_followup_jobs WHERE id = $1;`, [job1.id]))[0];
  assert(checkJob1.status === 'pending', 'Job remains in "pending" status (zero database mutations)');
  assert(checkJob1.claimed_at === null, 'Job was NEVER claimed (claimed_at is NULL)');

  // -------------------------------------------------------------------------
  // TEST 2: Valid Sandbox Scope -> ONLY Target Tenant Processed
  // -------------------------------------------------------------------------
  console.log('\n--- Test 2: Valid Sandbox Scope Strict Tenant Isolation ---');
  await query(`DELETE FROM iao.services_lead_followup_jobs WHERE status IN ('pending', 'claimed');`);

  const inqAlpha = await createInquiryConversation(tenantAlpha, {
    customer_name: 'Alpha Target Client',
    customer_email: `alpha-${Date.now()}@alpha.test`,
    message_body: 'Targeted Alpha job.',
  });
  const jobAlpha = await scheduleServicesLeadFollowup({
    tenantId: tenantAlpha,
    leadId: inqAlpha.lead_id,
    conversationId: inqAlpha.conversation_id,
    delayMinutes: -1,
  });

  const inqBeta = await createInquiryConversation(tenantBeta, {
    customer_name: 'Beta Untouched Client',
    customer_email: `beta-${Date.now()}@beta.test`,
    message_body: 'Beta job that must NOT be touched.',
  });
  const jobBeta = await scheduleServicesLeadFollowup({
    tenantId: tenantBeta,
    leadId: inqBeta.lead_id,
    conversationId: inqBeta.conversation_id,
    delayMinutes: -1,
  });

  console.log(`Job Alpha (Target): ${jobAlpha.id}`);
  console.log(`Job Beta (Untouched): ${jobBeta.id}`);
  console.log(`Setting active sandbox scope to ${tenantAlpha}...`);
  await setSandboxScope(tenantAlpha, true);

  console.log('Executing workflow...');
  const runAlpha = runN8nWorkflow();
  const execAlpha = getLatestN8nExecution();

  console.log(`n8n Execution Record: ID=${execAlpha?.id}, Status=${execAlpha?.status}`);
  assert(execAlpha?.status === 'success', 'n8n execution status is SUCCESS for valid sandbox scope');

  // Verify Alpha job was claimed and dispatched
  const checkAlpha = (await query(`SELECT * FROM iao.services_lead_followup_jobs WHERE id = $1;`, [jobAlpha.id]))[0];
  assert(checkAlpha.metadata?.outcome === 'dispatched', `Alpha job dispatched (outcome=${checkAlpha.metadata?.outcome})`);
  assert(checkAlpha.attempt_count === 1, `Alpha job attempt count incremented to 1`);

  // Verify Beta job was STRICTLY UNTOUCHED
  const checkBeta = (await query(`SELECT * FROM iao.services_lead_followup_jobs WHERE id = $1;`, [jobBeta.id]))[0];
  assert(checkBeta.status === 'pending', 'Beta job remained in "pending" status (strict tenant scope)');
  assert(checkBeta.claimed_at === null, 'Beta job was NEVER claimed (claimed_at is NULL)');

  // -------------------------------------------------------------------------
  // TEST 3: Unknown Path -> Failure Audit Persists & Execution is RED
  // -------------------------------------------------------------------------
  console.log('\n--- Test 3: Unknown Path Failure Audit & Red Execution ---');
  await query(`DELETE FROM iao.services_lead_followup_jobs WHERE status IN ('pending', 'claimed');`);

  const inqUnknown = await createInquiryConversation(tenantAlpha, {
    customer_name: 'Unknown Path Customer',
    customer_email: `unknown-${Date.now()}@example.test`,
    message_body: 'Trigger unknown branch.',
  });
  const jobUnknown = await scheduleServicesLeadFollowup({
    tenantId: tenantAlpha,
    leadId: inqUnknown.lead_id,
    conversationId: inqUnknown.conversation_id,
    delayMinutes: -1,
  });

  // Inject simulate_unknown_path flag
  await query(
    `UPDATE iao.services_lead_followup_jobs SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{simulate_unknown_path}', 'true') WHERE id = $1;`,
    [jobUnknown.id]
  );

  await setSandboxScope(tenantAlpha, true);

  console.log(`Job with unknown path: ${jobUnknown.id}`);
  console.log('Executing workflow...');
  const runUnknown = runN8nWorkflow();
  const execUnknown = getLatestN8nExecution();

  console.log(`n8n Execution Record: ID=${execUnknown?.id}, Status=${execUnknown?.status}`);
  assert(execUnknown?.status === 'error', 'n8n execution status is ERROR (visibly RED in n8n)');
  assert(!runUnknown.success, 'CLI command failed with exit code indicating workflow error');

  // Verify failure audit was persisted BEFORE execution failed
  const checkUnknown = (await query(`SELECT * FROM iao.services_lead_followup_jobs WHERE id = $1;`, [jobUnknown.id]))[0];
  assert(
    checkUnknown.metadata?.outcome === 'unknown_path_failed',
    `Failure audit persisted in DB: metadata.outcome = '${checkUnknown.metadata?.outcome}'`
  );
  assert(
    checkUnknown.status === 'completed' || checkUnknown.status === 'failed',
    `Job status is marked terminal ("${checkUnknown.status}") - NOT abandoned in "claimed"`
  );

  // -------------------------------------------------------------------------
  // TEST 4: Normal Mocked Follow-up -> Succeeds Without Sending Live Email
  // -------------------------------------------------------------------------
  console.log('\n--- Test 4: Normal Mocked Follow-up ---');
  await query(`DELETE FROM iao.services_lead_followup_jobs WHERE status IN ('pending', 'claimed');`);

  const inqNormal = await createInquiryConversation(tenantAlpha, {
    customer_name: 'Normal Customer',
    customer_email: `normal-${Date.now()}@example.test`,
    message_body: 'Requesting quote.',
  });
  const jobNormal = await scheduleServicesLeadFollowup({
    tenantId: tenantAlpha,
    leadId: inqNormal.lead_id,
    conversationId: inqNormal.conversation_id,
    delayMinutes: -1,
  });

  await setSandboxScope(tenantAlpha, true);

  console.log(`Normal Job: ${jobNormal.id}`);
  console.log('Executing workflow with mock dispatch...');
  const runNormal = runN8nWorkflow();
  const execNormal = getLatestN8nExecution();

  console.log(`n8n Execution Record: ID=${execNormal?.id}, Status=${execNormal?.status}`);
  assert(execNormal?.status === 'success', 'n8n execution status is SUCCESS (green)');
  assert(runNormal.success, 'Workflow executed without error');

  const checkNormal = (await query(`SELECT * FROM iao.services_lead_followup_jobs WHERE id = $1;`, [jobNormal.id]))[0];
  assert(checkNormal.metadata?.outcome === 'dispatched', `Job outcome is dispatched (outcome=${checkNormal.metadata?.outcome})`);
  assert(checkNormal.attempt_count === 1, `Job attempt count incremented to 1`);

  // Verify no live messages were dispatched in iao.message_dispatches
  const dispatches = await query(
    `SELECT * FROM iao.message_dispatches WHERE tenant_id = $1 AND recipient_email = $2;`,
    [tenantAlpha, inqNormal.customer_email]
  );
  assert(dispatches.length === 0, 'Zero live emails sent (mock dispatch safely verified)');

  console.log('\n================================================================');
  console.log(`GAPS VERIFICATION SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  console.log('Execution Summary:');
  console.log(`- Test 1 (Missing Sandbox Scope): Execution #${execNoScope?.id} (status: ${execNoScope?.status})`);
  console.log(`- Test 2 (Valid Sandbox Scope): Execution #${execAlpha?.id} (status: ${execAlpha?.status})`);
  console.log(`- Test 3 (Unknown Path Failure): Execution #${execUnknown?.id} (status: ${execUnknown?.status})`);
  console.log(`- Test 4 (Normal Mocked Follow-up): Execution #${execNormal?.id} (status: ${execNormal?.status})`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error running gaps verification:', err);
  process.exit(1);
});

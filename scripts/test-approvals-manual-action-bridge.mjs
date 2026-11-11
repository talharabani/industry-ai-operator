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
  query,
  getCase,
  decideCaseInDB,
  authorizeOrderIssueAction,
  recordManualActionExecution,
} from '../lib/db.ts';

import {
  createOrderIssue,
  getOrderIssue,
  listOrderIssueEvents,
} from '../lib/order-issues.ts';

async function runApprovalsBridgeTests() {
  console.log('===============================================================');
  console.log('=== STARTING APPROVALS -> MANUAL ACTION BRIDGE TEST SUITE ===');
  console.log('===============================================================\n');

  const testTenant = 'sandbox-test-store-' + Date.now();
  const testTenantB = 'sandbox-other-store-' + Date.now();
  const testOrderId = 'SANDBOX-ORD-' + Math.floor(Math.random() * 90000 + 10000);
  const testEmail = 'sandbox.shopper@example.com';
  const testName = 'Sandbox Shopper';

  // Ensure sandbox businesses and shopify connection exist so foreign key validation passes
  await query(
    `INSERT INTO iao.businesses (tenant_id, settings, updated_at)
     VALUES ($1, '{}'::jsonb, NOW()), ($2, '{}'::jsonb, NOW())
     ON CONFLICT (tenant_id) DO NOTHING;`,
    [testTenant, testTenantB]
  );

  await query(
    `INSERT INTO iao.shopify_connections (tenant_id, shop_domain, encrypted_access_token, is_connected, sync_status)
     VALUES ($1, $2, 'dummy-token', true, 'connected'),
            ($3, $4, 'dummy-token', true, 'connected')
     ON CONFLICT (tenant_id) DO NOTHING;`,
    [testTenant, `${testTenant}.myshopify.com`, testTenantB, `${testTenantB}.myshopify.com`]
  );

  let createdIssueIds = [];
  let createdCaseIds = [];

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Approval creates manual execution task, marks action_pending,
    // and DOES NOT claim action was executed
    // ------------------------------------------------------------------------
    console.log('--- TEST 1: Approve Authorizes Action & Creates Manual Execution Task ---');

    const issue1 = await createOrderIssue({
      tenant_id: testTenant,
      issue_type: 'refund_requested',
      status: 'open',
      customer_email: testEmail,
      customer_name: testName,
      order_id: testOrderId,
      evidence: {
        customer_claim: 'Customer requested refund for item',
        refundable_balance: 49.50,
        currency: 'USD',
      },
      next_action: 'Awaiting refund decision',
    });
    createdIssueIds.push(issue1.id);

    const case1Id = `case_test_approval_${Date.now()}_1`;
    createdCaseIds.push(case1Id);

    await query(
      `INSERT INTO iao.cases (
        tenant_id, case_id, kind, status, payload, proposal, revision, created_at, updated_at
      ) VALUES ($1, $2, 'refund', 'pending_approval', $3::jsonb, $4::jsonb, 1, NOW(), NOW());`,
      [
        testTenant,
        case1Id,
        JSON.stringify({
          order_id: testOrderId,
          orderId: testOrderId,
          amount: 49.50,
          currency: 'USD',
          customer_email: testEmail,
          customer_name: testName,
        }),
        JSON.stringify({
          headline: 'Refund authorization requested',
          summary: 'Approve refund of $49.50 USD for customer',
          action: 'refund',
          amount: 49.50,
          currency: 'USD',
          draft_reply: 'I have issued a refund of $49.50 USD to your original payment method.',
          revision: 1,
        }),
      ]
    );

    // Call decision pipeline
    const decisionResult1 = await decideCaseInDB({
      tenantId: testTenant,
      caseId: case1Id,
      decision: 'approve',
      approverId: 'owner_admin',
      expectedRevision: 1,
    });

    assert(decisionResult1?.case, 'Decision should return updated case');
    assert.strictEqual(decisionResult1.case.status, 'approved', 'Case status must be approved');

    // Verify issue was updated atomically to action_pending
    const updatedIssue1 = await getOrderIssue(testTenant, issue1.id);
    assert(updatedIssue1, 'Issue must exist');
    assert.strictEqual(
      updatedIssue1.status,
      'action_pending',
      'Issue status must be atomically transitioned to action_pending'
    );

    // Verify execution task created
    const tasks1 = updatedIssue1.evidence?.owner_tasks || [];
    assert.strictEqual(tasks1.length, 1, 'Exactly one owner execution task must be created');
    const execTask1 = tasks1[0];
    assert.strictEqual(execTask1.task_type, 'manual_action_execution', 'Task type must be manual_action_execution');
    assert.strictEqual(execTask1.action_type, 'refund', 'Action type must be refund');
    assert.strictEqual(execTask1.status, 'pending', 'Execution task must be pending execution');
    assert.strictEqual(execTask1.action_details?.amount, 49.50, 'Verified amount must be 49.50');
    assert.strictEqual(execTask1.action_details?.currency, 'USD', 'Source currency must be USD');
    assert.strictEqual(execTask1.approved_by, 'owner_admin', 'Must record approved_by');
    assert(execTask1.approved_at, 'Must record approved_at');

    // Verify draft reply sanitization: must NOT claim "I have issued a refund"
    const outboxMsg1 = await query(
      `SELECT * FROM iao.messages WHERE conversation_id = $1 OR body LIKE $2 ORDER BY created_at DESC LIMIT 1;`,
      [case1Id, '%refund%']
    );
    if (outboxMsg1.length > 0) {
      const body = outboxMsg1[0].body || '';
      assert(!body.includes('I have issued a refund'), 'Must not claim refund already issued');
      assert(!body.toLowerCase().includes('cancelled') && !body.toLowerCase().includes('dispatched'), 'Must not claim premature execution');
    }

    // Verify audit event
    const events1 = await listOrderIssueEvents(testTenant, issue1.id);
    const approvalEvent = events1.find((e) => e.event_type === 'action_approved');
    assert(approvalEvent, 'Must record action_approved audit event');
    assert.strictEqual(approvalEvent.details?.from_status || approvalEvent.from_status, 'open', 'Audit event must record previous status');
    assert.strictEqual(approvalEvent.details?.to_status || approvalEvent.to_status, 'action_pending', 'Audit event must record target status');

    console.log('✓ TEST 1 PASSED: Approval authorizes action, creates manual task, and avoids premature completion claims.\n');

    // ------------------------------------------------------------------------
    // TEST 2: Amount and Currency Integrity for Refunds
    // ------------------------------------------------------------------------
    console.log('--- TEST 2: Amount & Currency Integrity Enforcement ---');

    // Attempting to authorize refund with missing or <= 0 amount
    let invalidAmountErrorThrown = false;
    try {
      await authorizeOrderIssueAction({
        tenantId: testTenant,
        issueId: issue1.id,
        actionType: 'refund',
        actionDetails: { amount: -10, currency: 'USD' },
        approverId: 'owner_admin',
      });
    } catch (err) {
      invalidAmountErrorThrown = true;
      assert(err.message.includes('refund amount'), 'Must require valid refund amount');
    }
    assert(invalidAmountErrorThrown, 'Must throw error on non-positive refund amount');

    // Attempting to authorize refund with missing currency
    let missingCurrencyErrorThrown = false;
    try {
      await authorizeOrderIssueAction({
        tenantId: testTenant,
        issueId: issue1.id,
        actionType: 'refund',
        actionDetails: { amount: 25, currency: '' },
        approverId: 'owner_admin',
      });
    } catch (err) {
      missingCurrencyErrorThrown = true;
      assert(err.message.includes('currency'), 'Must require source currency');
    }
    assert(missingCurrencyErrorThrown, 'Must throw error on missing source currency');

    // Exceeding refundable balance
    let exceedBalanceErrorThrown = false;
    try {
      await authorizeOrderIssueAction({
        tenantId: testTenant,
        issueId: issue1.id,
        actionType: 'refund',
        actionDetails: { amount: 500.00, currency: 'USD' },
        approverId: 'owner_admin',
      });
    } catch (err) {
      exceedBalanceErrorThrown = true;
      assert(err.message.includes('exceeds verified refundable balance'), 'Must reject refund exceeding refundable balance');
    }
    assert(exceedBalanceErrorThrown, 'Must throw error when refund exceeds refundable balance');

    // Currency mismatch
    let currencyMismatchErrorThrown = false;
    try {
      await authorizeOrderIssueAction({
        tenantId: testTenant,
        issueId: issue1.id,
        actionType: 'refund',
        actionDetails: { amount: 20.00, currency: 'EUR' },
        approverId: 'owner_admin',
      });
    } catch (err) {
      currencyMismatchErrorThrown = true;
      assert(err.message.includes('Currency mismatch'), 'Must reject currency mismatch');
    }
    assert(currencyMismatchErrorThrown, 'Must throw error on currency mismatch');

    console.log('✓ TEST 2 PASSED: Amount, currency, and verified refundable balance integrity strictly enforced.\n');

    // ------------------------------------------------------------------------
    // TEST 3: Idempotency & True Concurrent Approval Handling (Promise.all)
    // ------------------------------------------------------------------------
    console.log('--- TEST 3: Idempotency & Concurrency (Sequential Retries + Concurrent Promise.all) ---');

    // Repeated call to decideCaseInDB on already approved case
    const repeatResult = await decideCaseInDB({
      tenantId: testTenant,
      caseId: case1Id,
      decision: 'approve',
      approverId: 'owner_admin',
      expectedRevision: 1,
    });
    assert.strictEqual(repeatResult.case.status, 'approved', 'Repeated decision returns approved case');

    // Check issue still has exactly ONE task and no duplicate events
    const issueAfterRepeat = await getOrderIssue(testTenant, issue1.id);
    const tasksAfterRepeat = issueAfterRepeat.evidence?.owner_tasks || [];
    assert.strictEqual(tasksAfterRepeat.length, 1, 'Must NOT duplicate owner execution task on repeated click');

    const eventsAfterRepeat = await listOrderIssueEvents(testTenant, issue1.id);
    const approvalEventsCount = eventsAfterRepeat.filter((e) => e.event_type === 'action_approved').length;
    assert.strictEqual(approvalEventsCount, 1, 'Must NOT duplicate action_approved audit event');

    // Concurrency test: Multiple simultaneous decideCaseInDB calls with Promise.all
    const issueConc = await createOrderIssue({
      tenant_id: testTenant,
      issue_type: 'refund_requested',
      status: 'open',
      customer_email: testEmail,
      customer_name: testName,
      order_id: testOrderId + '-CONC',
      evidence: { order_total: 49.50, currency: 'USD' },
    });
    createdIssueIds.push(issueConc.id);

    const caseConcId = `case_test_conc_${Date.now()}`;
    createdCaseIds.push(caseConcId);

    await query(
      `INSERT INTO iao.cases (
        tenant_id, case_id, kind, status, payload, proposal, revision, created_at, updated_at
      ) VALUES ($1, $2, 'refund', 'pending_approval', $3::jsonb, $4::jsonb, 1, NOW(), NOW());`,
      [
        testTenant,
        caseConcId,
        JSON.stringify({ order_id: testOrderId + '-CONC', amount: 20.00, currency: 'USD' }),
        JSON.stringify({ headline: 'Refund $20', summary: 'Concurrent test', action: 'refund', amount: 20.00, currency: 'USD', revision: 1 }),
      ]
    );

    const [cRes1, cRes2, cRes3] = await Promise.all([
      decideCaseInDB({ tenantId: testTenant, caseId: caseConcId, decision: 'approve', approverId: 'owner_admin', expectedRevision: 1 }),
      decideCaseInDB({ tenantId: testTenant, caseId: caseConcId, decision: 'approve', approverId: 'owner_admin', expectedRevision: 1 }),
      decideCaseInDB({ tenantId: testTenant, caseId: caseConcId, decision: 'approve', approverId: 'owner_admin', expectedRevision: 1 }),
    ]);

    assert.strictEqual(cRes1.case.status, 'approved');
    assert.strictEqual(cRes2.case.status, 'approved');
    assert.strictEqual(cRes3.case.status, 'approved');

    const issueConcAfter = await getOrderIssue(testTenant, issueConc.id);
    const concTasks = issueConcAfter.evidence?.owner_tasks || [];
    assert.strictEqual(concTasks.length, 1, 'Concurrent approvals must create exactly ONE execution task');

    const concEvents = await listOrderIssueEvents(testTenant, issueConc.id);
    const concApprovalEvents = concEvents.filter((e) => e.event_type === 'action_approved');
    assert.strictEqual(concApprovalEvents.length, 1, 'Concurrent approvals must record exactly ONE action_approved event');

    console.log('✓ TEST 3 PASSED: Repeated decisions and concurrent Promise.all return identical task without duplicate tasks or events.\n');

    // ------------------------------------------------------------------------
    // TEST 4: Rejection Behavior & Preservation of Unrelated Tasks
    // ------------------------------------------------------------------------
    console.log('--- TEST 4: Rejection Creates No Execution Task & Preserves Unrelated Tasks ---');

    const issue2 = await createOrderIssue({
      tenant_id: testTenant,
      issue_type: 'delivery_delay',
      status: 'awaiting_owner',
      customer_email: 'another.shopper@example.com',
      customer_name: 'Another Shopper',
      order_id: testOrderId + '-B',
      evidence: {
        owner_tasks: [
          {
            id: 'task-warehouse-check-101',
            task_type: 'warehouse_fulfillment_check',
            title: 'Verify stock on physical shelf 4B',
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      next_action: 'Warehouse physical check pending',
    });
    createdIssueIds.push(issue2.id);

    const case2Id = `case_test_rejection_${Date.now()}_2`;
    createdCaseIds.push(case2Id);

    await query(
      `INSERT INTO iao.cases (
        tenant_id, case_id, kind, status, payload, proposal, revision, created_at, updated_at
      ) VALUES ($1, $2, 'exchange', 'pending_approval', $3::jsonb, $4::jsonb, 1, NOW(), NOW());`,
      [
        testTenant,
        case2Id,
        JSON.stringify({
          order_id: testOrderId + '-B',
          customer_email: 'another.shopper@example.com',
        }),
        JSON.stringify({
          headline: 'Exchange proposal',
          summary: 'Send replacement size L',
          action: 'exchange',
          draft_reply: 'Replacement item will be sent.',
          revision: 1,
        }),
      ]
    );

    const rejectResult = await decideCaseInDB({
      tenantId: testTenant,
      caseId: case2Id,
      decision: 'reject',
      approverId: 'owner_admin',
      expectedRevision: 1,
    });
    assert.strictEqual(rejectResult.case.status, 'rejected', 'Case status must be rejected');

    const issue2AfterReject = await getOrderIssue(testTenant, issue2.id);
    assert.notStrictEqual(
      issue2AfterReject.status,
      'action_pending',
      'Issue must NOT be transitioned to action_pending on rejection'
    );

    // Verify existing warehouse task was preserved and NO execution task was created
    const issue2Tasks = issue2AfterReject.evidence?.owner_tasks || [];
    assert.strictEqual(issue2Tasks.length, 1, 'Only original warehouse task must exist');
    assert.strictEqual(issue2Tasks[0].id, 'task-warehouse-check-101', 'Warehouse task must be preserved');
    assert.strictEqual(issue2Tasks[0].status, 'pending', 'Warehouse task must remain pending');

    console.log('✓ TEST 4 PASSED: Rejection creates no execution task and preserves unrelated warehouse tasks.\n');

    // ------------------------------------------------------------------------
    // TEST 4b: Ambiguous Order Match Rejection
    // ------------------------------------------------------------------------
    console.log('--- TEST 4b: Ambiguous Order Match Rejection ---');
    const ambigOrderRef = 'ORD-AMBIG-DUAL';
    const issueAmbig1 = await createOrderIssue({
      tenant_id: testTenant,
      issue_type: 'refund_requested',
      status: 'open',
      customer_email: testEmail,
      customer_name: testName,
      order_id: ambigOrderRef,
    });
    const issueAmbig2 = await createOrderIssue({
      tenant_id: testTenant,
      issue_type: 'damaged_item',
      status: 'investigating',
      customer_email: testEmail,
      customer_name: testName,
      order_id: ambigOrderRef,
    });
    createdIssueIds.push(issueAmbig1.id, issueAmbig2.id);

    const caseAmbigId = `case_test_ambig_${Date.now()}`;
    createdCaseIds.push(caseAmbigId);

    await query(
      `INSERT INTO iao.cases (
        tenant_id, case_id, kind, status, payload, proposal, revision, created_at, updated_at
      ) VALUES ($1, $2, 'refund', 'pending_approval', $3::jsonb, $4::jsonb, 1, NOW(), NOW());`,
      [
        testTenant,
        caseAmbigId,
        JSON.stringify({ order_id: ambigOrderRef, amount: 15.00, currency: 'USD' }),
        JSON.stringify({ headline: 'Refund', summary: 'Ambig test', action: 'refund', amount: 15.00, currency: 'USD', revision: 1 }),
      ]
    );

    let ambigErrorCaught = false;
    try {
      await decideCaseInDB({
        tenantId: testTenant,
        caseId: caseAmbigId,
        decision: 'approve',
        approverId: 'owner_admin',
        expectedRevision: 1,
      });
    } catch (err) {
      ambigErrorCaught = true;
      assert(err.message.includes('Ambiguous order match rejected'), 'Must reject ambiguous order match');
    }
    assert(ambigErrorCaught, 'Must throw error when multiple active issues match order reference');
    console.log('✓ TEST 4b PASSED: Ambiguous order matches are safely rejected without guessing.\n');

    // ------------------------------------------------------------------------
    // TEST 5: Tenant Isolation
    // ------------------------------------------------------------------------
    console.log('--- TEST 5: Tenant Isolation ---');

    let tenantCrossDecideError = false;
    try {
      // Tenant B tries to decide Tenant A's case
      await decideCaseInDB({
        tenantId: testTenantB,
        caseId: case1Id,
        decision: 'approve',
        approverId: 'owner_b',
        expectedRevision: 1,
      });
    } catch (err) {
      tenantCrossDecideError = true;
    }
    assert(tenantCrossDecideError, 'Tenant B must NOT be allowed to decide Tenant A case');

    console.log('✓ TEST 5 PASSED: Tenant boundary strictly enforced.\n');

    // ------------------------------------------------------------------------
    // TEST 6: Record Manual Execution Flow (Owner-Reported Completion)
    // ------------------------------------------------------------------------
    console.log('--- TEST 6: Record Manual Execution Flow & Labeling ---');

    // Attempt completion with empty reference -> must fail
    let emptyRefError = false;
    try {
      await recordManualActionExecution({
        tenantId: testTenant,
        issueId: issue1.id,
        taskId: execTask1.id,
        executionReference: '',
        ownerId: 'owner_admin',
      });
    } catch (err) {
      emptyRefError = true;
      assert(err.message.includes('Execution reference'), 'Must require execution reference');
    }
    assert(emptyRefError, 'Must reject execution recording without reference');

    // Complete manual execution with valid evidence
    const completionResult = await recordManualActionExecution({
      tenantId: testTenant,
      issueId: issue1.id,
      taskId: execTask1.id,
      executionReference: 'SP-REFUND-994821',
      evidenceNotes: 'Processed manually in Shopify Admin dashboard',
      ownerId: 'owner_admin',
      completedAt: new Date().toISOString(),
    });

    assert(completionResult.task, 'Manual action recording must succeed');
    const completedTask = completionResult.task;
    assert.strictEqual(completedTask.status, 'completed', 'Task status must be completed');
    assert.strictEqual(
      completedTask.completion_label,
      'Owner-reported completion',
      'Must strictly label as Owner-reported completion'
    );
    assert.strictEqual(completedTask.execution_reference, 'SP-REFUND-994821', 'Must store execution reference');
    assert.strictEqual(completedTask.completed_by, 'owner_admin', 'Must preserve who recorded completion');
    assert(completedTask.completed_at, 'Must preserve completion time');

    // Verify issue event logged
    const eventsAfterCompletion = await listOrderIssueEvents(testTenant, issue1.id);
    const execEvent = eventsAfterCompletion.find((e) => e.event_type === 'manual_action_executed');
    assert(execEvent, 'Must log manual_action_executed event');
    assert.strictEqual(execEvent.details?.execution_reference, 'SP-REFUND-994821');
    assert.strictEqual(execEvent.details?.completion_label, 'Owner-reported completion');

    console.log('✓ TEST 6 PASSED: Manual execution recorded with reference, timestamp, and Owner-reported completion label.\n');

    // ------------------------------------------------------------------------
    // TEST 7: Completing Execution DOES NOT Auto-Resolve Unrelated Issues/Tasks
    // ------------------------------------------------------------------------
    console.log('--- TEST 7: Independent Task Lifecycles (No Auto-Resolution of Unrelated Tasks) ---');

    // Create an issue that has BOTH a not-received delivery delay and a refund execution task
    const issue3 = await createOrderIssue({
      tenant_id: testTenant,
      issue_type: 'not_received',
      status: 'action_pending',
      customer_email: testEmail,
      customer_name: testName,
      order_id: testOrderId + '-C',
      evidence: {
        owner_tasks: [
          {
            id: 'task-delivery-claim',
            task_type: 'carrier_claim_filing',
            title: 'File lost-in-transit claim with UPS',
            status: 'pending',
            created_at: new Date().toISOString(),
          },
          {
            id: 'task-refund-exec',
            task_type: 'manual_action_execution',
            title: 'Execute authorized goodwill refund $15.00 USD',
            status: 'pending',
            action_type: 'refund',
            action_details: { amount: 15.00, currency: 'USD' },
            created_at: new Date().toISOString(),
          },
        ],
      },
      next_action: 'Complete UPS claim and execute goodwill refund',
    });
    createdIssueIds.push(issue3.id);

    // Record execution for the refund task
    await recordManualActionExecution({
      tenantId: testTenant,
      issueId: issue3.id,
      taskId: 'task-refund-exec',
      executionReference: 'TX-GOODWILL-15',
      ownerId: 'owner_admin',
    });

    const issue3AfterExec = await getOrderIssue(testTenant, issue3.id);
    const issue3Tasks = issue3AfterExec.evidence?.owner_tasks || [];
    const deliveryTask = issue3Tasks.find((t) => t.id === 'task-delivery-claim');
    const refundTask = issue3Tasks.find((t) => t.id === 'task-refund-exec');

    assert.strictEqual(refundTask.status, 'completed', 'Refund task must be completed');
    assert.strictEqual(deliveryTask.status, 'pending', 'Carrier claim task must REMAIN pending');
    assert.notStrictEqual(
      issue3AfterExec.status,
      'resolved',
      'Issue must NOT be auto-resolved when carrier claim task is still pending!'
    );

    console.log('✓ TEST 7 PASSED: Completing execution task does NOT auto-resolve unrelated tasks or not-received complaints.\n');

    // ------------------------------------------------------------------------
    // TEST 8: HTTP API - Stale Proposal Conflict (409) & Input Validation
    // ------------------------------------------------------------------------
    console.log('--- TEST 8: HTTP API Stale Proposal Revision (409) & Validation ---');

    const caseApiId = `case_test_api_${Date.now()}`;
    createdCaseIds.push(caseApiId);

    await query(
      `INSERT INTO iao.cases (
        tenant_id, case_id, kind, status, payload, proposal, revision, created_at, updated_at
      ) VALUES ($1, $2, 'refund', 'pending_approval', $3::jsonb, $4::jsonb, 2, NOW(), NOW());`,
      [
        testTenant,
        caseApiId,
        JSON.stringify({
          order_id: testOrderId + '-API',
          amount: 29.99,
          currency: 'USD',
          customer_email: testEmail,
        }),
        JSON.stringify({
          headline: 'Refund $29.99',
          summary: 'Refund request',
          action: 'refund',
          amount: 29.99,
          currency: 'USD',
          revision: 2,
        }),
      ]
    );

    const ownerCookie = Buffer.from(
      JSON.stringify({ active_tenant_id: testTenant, role: 'owner', user_id: 'owner-test' })
    ).toString('base64');
    const memberCookie = Buffer.from(
      JSON.stringify({ active_tenant_id: testTenant, role: 'member', user_id: 'member-test' })
    ).toString('base64');

    // 1. Submit approval with stale revision (1 instead of current 2)
    const staleRes = await fetch(`http://localhost:3000/api/cases/${caseApiId}/decision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `iao_session=${ownerCookie}`,
      },
      body: JSON.stringify({
        decision: 'approve',
        expectedRevision: 1,
      }),
    });
    assert.strictEqual(staleRes.status, 409, 'Must return HTTP 409 Conflict for stale proposal revision');
    const staleData = await staleRes.json();
    assert.strictEqual(staleData.current_revision, 2, 'Must report current revision');

    console.log('✓ TEST 8 PASSED: Stale proposal revisions return HTTP 409 Conflict with current revision.\n');

    // ------------------------------------------------------------------------
    // TEST 9: HTTP API - Owner Permissions & Execution Recording Endpoint
    // ------------------------------------------------------------------------
    console.log('--- TEST 9: HTTP API Owner Permissions (403) & Execution Recording Flow ---');

    const apiIssue = await createOrderIssue({
      tenant_id: testTenant,
      issue_type: 'refund_requested',
      status: 'action_pending',
      customer_email: testEmail,
      customer_name: testName,
      order_id: testOrderId + '-API',
      evidence: {
        owner_tasks: [
          {
            id: 'task-api-exec-1',
            task_type: 'manual_action_execution',
            title: 'Execute approved refund $29.99 USD',
            status: 'pending',
            action_type: 'refund',
            action_details: { amount: 29.99, currency: 'USD' },
            created_at: new Date().toISOString(),
          },
        ],
      },
    });
    createdIssueIds.push(apiIssue.id);

    // 1. Non-owner (member) attempts to record manual execution -> HTTP 403 Forbidden
    const forbiddenRes = await fetch(
      `http://localhost:3000/api/order-issues/${apiIssue.id}/tasks/task-api-exec-1/execute`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `iao_session=${memberCookie}`,
        },
        body: JSON.stringify({
          execution_reference: 'SP-12345',
        }),
      }
    );
    assert.strictEqual(forbiddenRes.status, 403, 'Non-owner must be rejected with HTTP 403 Forbidden');

    // 2. Owner attempts execution without execution reference -> HTTP 400 Bad Request
    const badReqRes = await fetch(
      `http://localhost:3000/api/order-issues/${apiIssue.id}/tasks/task-api-exec-1/execute`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `iao_session=${ownerCookie}`,
        },
        body: JSON.stringify({
          execution_reference: '   ',
        }),
      }
    );
    assert.strictEqual(badReqRes.status, 400, 'Empty reference must be rejected with HTTP 400');

    // 3. Owner records manual execution successfully with valid reference
    const successExecRes = await fetch(
      `http://localhost:3000/api/order-issues/${apiIssue.id}/tasks/task-api-exec-1/execute`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `iao_session=${ownerCookie}`,
        },
        body: JSON.stringify({
          execution_reference: 'SP-API-REFUND-7788',
          evidence: 'Verified via Shopify Orders Admin',
        }),
      }
    );
    assert.strictEqual(successExecRes.status, 200, 'Owner execution recording must return HTTP 200');
    const successExecData = await successExecRes.json();
    assert.strictEqual(successExecData.task.status, 'completed', 'Task status must be completed');
    assert.strictEqual(
      successExecData.task.completion_label,
      'Owner-reported completion',
      'Label must be Owner-reported completion'
    );
    assert.strictEqual(successExecData.task.execution_reference, 'SP-API-REFUND-7788');
    assert.strictEqual(successExecData.task.completed_by, 'owner-test');

    console.log('✓ TEST 9 PASSED: HTTP API owner authentication, 403 rejection, 400 validation, and 200 completion verified.\n');

    // ------------------------------------------------------------------------
    // TEST 9b: Custom-Store Approvals Do NOT Require Shopify Connection
    // ------------------------------------------------------------------------
    console.log('--- TEST 9b: Custom-Store Approvals Without Shopify Connection ---');
    const customTenant = 'sandbox-custom-store-' + Date.now();
    await query(
      `INSERT INTO iao.businesses (tenant_id, settings, updated_at) VALUES ($1, '{}'::jsonb, NOW()) ON CONFLICT (tenant_id) DO NOTHING;`,
      [customTenant]
    );

    const customCaseId = `case_test_custom_${Date.now()}`;
    createdCaseIds.push(customCaseId);

    await query(
      `INSERT INTO iao.cases (
        tenant_id, case_id, kind, status, payload, proposal, revision, created_at, updated_at
      ) VALUES ($1, $2, 'refund', 'pending_approval', $3::jsonb, $4::jsonb, 1, NOW(), NOW());`,
      [
        customTenant,
        customCaseId,
        JSON.stringify({ order_id: 'CUSTOM-ORD-101', store_type: 'custom', amount: 35.00, currency: 'USD' }),
        JSON.stringify({ headline: 'Custom Refund', summary: 'Custom store', action: 'refund', amount: 35.00, currency: 'USD', revision: 1 }),
      ]
    );

    const customOwnerCookie = Buffer.from(
      JSON.stringify({ active_tenant_id: customTenant, role: 'owner', user_id: 'custom-owner' })
    ).toString('base64');

    const customApproveRes = await fetch(`http://localhost:3000/api/cases/${customCaseId}/decision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `iao_session=${customOwnerCookie}`,
      },
      body: JSON.stringify({
        decision: 'approve',
        expected_revision: 1,
      }),
    });
    assert.strictEqual(customApproveRes.status, 200, 'Custom store approval must succeed without Shopify connection');
    await query(`DELETE FROM iao.businesses WHERE tenant_id = $1`, [customTenant]);
    console.log('✓ TEST 9b PASSED: Custom-store approvals succeed independently of Shopify connections.\n');

    // ------------------------------------------------------------------------
    // TEST 9c: Read-Only Shopify Verification Scope Clarification
    // ------------------------------------------------------------------------
    console.log('--- TEST 9c: Read-Only Shopify Verification Scope Clarification ---');
    assert(
      execTask1.action_type === 'refund',
      'Action type must be refund'
    );
    assert(
      updatedIssue1.evidence?.execution_pending_reason?.includes('Read-only Shopify order verification is used without requesting write access'),
      'Must explicitly state read-only verification without write scopes'
    );
    console.log('✓ TEST 9c PASSED: Read-only verification confirmed without requesting write access.\n');

    // ------------------------------------------------------------------------
    // TEST 10: Live Record #1001 Safeguard Verification
    // ------------------------------------------------------------------------
    console.log('--- TEST 10: Verifying Live Record #1001 Remains Untouched ---');
    const liveIssue = (
      await query('SELECT id, status, is_escalated FROM iao.order_issues WHERE id = $1', ['issue_muz895uh_xsxr'])
    )[0];
    if (liveIssue) {
      assert.strictEqual(liveIssue.id, 'issue_muz895uh_xsxr');
      assert.strictEqual(liveIssue.is_escalated, true, 'Live issue #1001 escalated state must remain intact');
      assert.strictEqual(liveIssue.status, 'awaiting_owner', 'Live issue #1001 status must remain awaiting_owner');
    }
    console.log('✓ TEST 8 PASSED: Live record #1001 is completely untouched.\n');

  } finally {
    // Clean up sandbox records
    console.log('--- Cleaning up sandbox test records ---');
    if (createdCaseIds.length > 0) {
      await query(`DELETE FROM iao.cases WHERE case_id = ANY($1::text[])`, [createdCaseIds]);
    }
    if (createdIssueIds.length > 0) {
      await query(`DELETE FROM iao.order_issue_events WHERE issue_id = ANY($1::text[])`, [createdIssueIds]);
      await query(`DELETE FROM iao.order_issues WHERE id = ANY($1::text[])`, [createdIssueIds]);
    }
    await query(`DELETE FROM iao.shopify_connections WHERE tenant_id IN ($1, $2)`, [testTenant, testTenantB]);
    await query(`DELETE FROM iao.businesses WHERE tenant_id IN ($1, $2)`, [testTenant, testTenantB]);
    console.log('✓ Cleanup complete.\n');
  }

  console.log('===============================================================');
  console.log('=== ALL APPROVALS -> MANUAL ACTION BRIDGE TESTS PASSED! ===');
  console.log('===============================================================');
}

runApprovalsBridgeTests().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});

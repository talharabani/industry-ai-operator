import assert from 'node:assert';
import { test, describe, before, after } from 'node:test';
import fs from 'node:fs';

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
  listOrderIssueEvents,
  scheduleOrderIssueFollowup,
  cancelFollowupsForTask,
  claimDueFollowupJobs,
  processClaimedFollowupJob,
  getCumulativeReminderCount,
  reconcileShopifyOrderUpdate,
  reconcileShopifyOrdersBatch,
  query,
} from '../lib/order-issues.ts';

import {
  upsertOrder,
  upsertShopifyOrdersBatch,
} from '../lib/db.ts';

describe('Shopify Order Update Reconciliation Engine', () => {
  const sandboxTenant = `sandbox-reconcile-${Date.now()}`;
  const sandboxTenantB = `sandbox-isolated-${Date.now()}`;
  const shopDomain = 'demo-reconcile.myshopify.com';

  before(async () => {
    await query(
      `INSERT INTO iao.businesses (tenant_id, settings, updated_at)
       VALUES ($1, '{}'::jsonb, NOW())
       ON CONFLICT (tenant_id) DO NOTHING;`,
      [sandboxTenant]
    );
  });

  after(async () => {
    // Clean up sandbox records
    try {
      await query(`DELETE FROM iao.order_issue_events WHERE tenant_id IN ($1, $2);`, [sandboxTenant, sandboxTenantB]);
      await query(`DELETE FROM iao.order_issue_followup_jobs WHERE tenant_id IN ($1, $2);`, [sandboxTenant, sandboxTenantB]);
      await query(`DELETE FROM iao.order_issues WHERE tenant_id IN ($1, $2);`, [sandboxTenant, sandboxTenantB]);
      await query(`DELETE FROM iao.orders WHERE tenant_id IN ($1, $2);`, [sandboxTenant, sandboxTenantB]);
      await query(`DELETE FROM iao.businesses WHERE tenant_id IN ($1, $2);`, [sandboxTenant, sandboxTenantB]);
    } catch (e) {
      console.warn('Sandbox cleanup warning:', e);
    }
  });

  // Test 1: Unfulfilled -> fulfilled with tracking
  test('1. Unfulfilled -> fulfilled with tracking completes warehouse task, updates tracking facts, and cancels obsolete reminder', async () => {
    const orderId = '#9001';
    const taskId = `task-9001-fulfill`;

    const issue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'not_received',
      status: 'awaiting_owner',
      orderId,
      shopDomain,
      customerName: 'Ahmad Khan',
      customerEmail: 'ahmad@example.com',
      evidence: {
        fulfillment_status: 'unfulfilled',
        source_updated_at: '2026-10-10T10:00:00.000Z',
        owner_tasks: [
          {
            id: taskId,
            title: `Warehouse fulfillment required for order ${orderId}`,
            status: 'pending',
            created_at: '2026-10-10T10:00:00.000Z',
          },
        ],
      },
      nextAction: `Warehouse team to expedite and dispatch unfulfilled order ${orderId}.`,
      responsibleParty: 'owner',
    });

    assert.ok(issue, 'Issue should be created');

    // Schedule warehouse fulfillment reminder
    const fjob = await scheduleOrderIssueFollowup({
      tenantId: sandboxTenant,
      issueId: issue.id,
      followupType: 'awaiting_owner_review',
      scheduledFor: new Date(Date.now() + 3600000).toISOString(),
      associatedTaskId: taskId,
      metadata: { task_id: taskId, task_type: 'warehouse_fulfillment' },
    });
    assert.ok(fjob, 'Followup job should be scheduled');

    // Ingest Shopify fulfillment update with tracking
    const shopifyPayload = {
      id: '9001001',
      name: '#9001',
      shop_domain: shopDomain,
      fulfillment_status: 'fulfilled',
      updated_at: '2026-10-11T12:00:00.000Z',
      fulfillments: [
        {
          id: 'ful_9001',
          status: 'success',
          tracking_company: 'TCS Express',
          tracking_number: 'TCS-9001-TRK',
        },
      ],
    };

    const results = await reconcileShopifyOrderUpdate(sandboxTenant, shopifyPayload, { shopDomain });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].reconciled, true);
    assert.strictEqual(results[0].action, 'fulfillment_updated');

    // Verify Issue State
    const updated = await getOrderIssue(sandboxTenant, issue.id);
    assert.ok(updated);
    assert.strictEqual(updated.evidence.fulfillment_status, 'fulfilled');
    assert.strictEqual(updated.evidence.tracking_number, 'TCS-9001-TRK');
    assert.strictEqual(updated.evidence.carrier, 'TCS Express');
    assert.strictEqual(updated.status, 'investigating'); // Transitioned from awaiting_owner
    assert.strictEqual(updated.responsible_party, 'ai_operator');
    // Does NOT auto-resolve "not received"
    assert.notStrictEqual(updated.status, 'resolved');
    assert.notStrictEqual(updated.status, 'closed');

    // Verify Warehouse Task completed
    const warehouseTask = updated.evidence.owner_tasks?.find((t) => t.id === taskId);
    assert.ok(warehouseTask);
    assert.strictEqual(warehouseTask.status, 'completed');
    assert.ok(warehouseTask.resolution?.includes('TCS-9001-TRK'));

    // Verify associated followup job was cancelled
    const jobs = await query(
      `SELECT * FROM iao.order_issue_followup_jobs WHERE tenant_id = $1 AND id = $2;`,
      [sandboxTenant, fjob.id]
    );
    assert.strictEqual(jobs[0].status, 'cancelled');
    assert.strictEqual(jobs[0].metadata?.cancellation_reason, 'task_completed_by_reconciliation');
  });

  // Test 2: Partial fulfillment with outstanding items
  test('2. Partial fulfillment retains tasks for outstanding items and does NOT treat whole order as shipped', async () => {
    const orderId = '#9002';
    const taskId = `task-9002-fulfill`;

    const issue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'delivery_delay',
      status: 'awaiting_owner',
      orderId,
      shopDomain,
      customerName: 'Sara Ali',
      customerEmail: 'sara@example.com',
      evidence: {
        fulfillment_status: 'unfulfilled',
        owner_tasks: [
          {
            id: taskId,
            title: `Warehouse fulfillment required for order ${orderId}`,
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      responsibleParty: 'owner',
    });

    const shopifyPayload = {
      id: '9002002',
      name: '#9002',
      shop_domain: shopDomain,
      fulfillment_status: 'partially_fulfilled',
      updated_at: new Date().toISOString(),
      fulfillments: [
        {
          tracking_company: 'Leopards',
          tracking_number: 'LEO-9002-PARTIAL',
        },
      ],
    };

    const results = await reconcileShopifyOrderUpdate(sandboxTenant, shopifyPayload, { shopDomain });
    assert.strictEqual(results[0].reconciled, true);

    const updated = await getOrderIssue(sandboxTenant, issue.id);
    assert.ok(updated);
    assert.strictEqual(updated.evidence.fulfillment_status, 'partial');
    assert.strictEqual(updated.status, 'awaiting_owner'); // Kept as awaiting_owner
    assert.strictEqual(updated.responsible_party, 'owner');

    // Partial fulfillment task should be created/active
    const partialTask = updated.evidence.owner_tasks?.find((t) => t.id.includes('partial-fulfill'));
    assert.ok(partialTask, 'Partial fulfillment task must exist');
    assert.strictEqual(partialTask.status, 'pending');
    assert.ok(updated.next_action?.toLowerCase().includes('remaining outstanding items'));
  });

  // Test 3: Fulfilled without tracking
  test('3. Fulfilled without tracking completes warehouse fulfillment task, explains tracking unavailable, and creates tracking investigation task', async () => {
    const orderId = '#9003';
    const taskId = `task-9003-fulfill`;

    const issue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'not_received',
      status: 'awaiting_owner',
      orderId,
      shopDomain,
      customerName: 'Bilal Tariq',
      customerEmail: 'bilal@example.com',
      evidence: {
        fulfillment_status: 'unfulfilled',
        owner_tasks: [
          {
            id: taskId,
            title: `Warehouse fulfillment required for order ${orderId}`,
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      responsibleParty: 'owner',
    });

    // Fulfilled without fulfillments array or tracking numbers
    const shopifyPayload = {
      id: '9003003',
      name: '#9003',
      shop_domain: shopDomain,
      fulfillment_status: 'fulfilled',
      updated_at: new Date().toISOString(),
      fulfillments: [],
    };

    const results = await reconcileShopifyOrderUpdate(sandboxTenant, shopifyPayload, { shopDomain });
    assert.strictEqual(results[0].reconciled, true);

    const updated = await getOrderIssue(sandboxTenant, issue.id);
    assert.ok(updated);
    assert.strictEqual(updated.evidence.fulfillment_status, 'fulfilled');
    assert.strictEqual(updated.evidence.tracking_number, null);
    assert.strictEqual(updated.evidence.carrier_data_unavailable, true);

    // Initial warehouse fulfillment task completed
    const initialFulfillTask = updated.evidence.owner_tasks?.find((t) => t.id === taskId);
    assert.strictEqual(initialFulfillTask?.status, 'completed');

    // New owner task created to locate tracking
    const locateTask = updated.evidence.owner_tasks?.find((t) => t.id.includes('find-tracking'));
    assert.ok(locateTask, 'Locate tracking task must be created');
    assert.strictEqual(locateTask.status, 'pending');
    assert.strictEqual(updated.status, 'awaiting_owner');
    assert.strictEqual(updated.responsible_party, 'owner');
  });

  // Test 4: Tracking added or changed
  test('4. Tracking added or changed updates tracking facts, completes locate-tracking task, and logs tracking_updated event', async () => {
    const orderId = '#9004';

    const issue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'not_received',
      status: 'awaiting_owner',
      orderId,
      shopDomain,
      customerName: 'Zainab Noor',
      customerEmail: 'zainab@example.com',
      evidence: {
        fulfillment_status: 'fulfilled',
        tracking_number: null,
        carrier_data_unavailable: true,
        owner_tasks: [
          {
            id: 'task-9004-find-tracking',
            title: `Locate courier tracking information for order ${orderId}`,
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      responsibleParty: 'owner',
    });

    // Tracking is now added in Shopify
    const shopifyPayload = {
      id: '9004004',
      name: '#9004',
      shop_domain: shopDomain,
      fulfillment_status: 'fulfilled',
      updated_at: new Date().toISOString(),
      fulfillments: [
        {
          tracking_company: 'Trax Courier',
          tracking_number: 'TRAX-9004-NEW',
        },
      ],
    };

    const results = await reconcileShopifyOrderUpdate(sandboxTenant, shopifyPayload, { shopDomain });
    assert.strictEqual(results[0].reconciled, true);
    assert.strictEqual(results[0].action, 'tracking_updated');

    const updated = await getOrderIssue(sandboxTenant, issue.id);
    assert.ok(updated);
    assert.strictEqual(updated.evidence.tracking_number, 'TRAX-9004-NEW');
    assert.strictEqual(updated.evidence.carrier, 'Trax Courier');
    assert.strictEqual(updated.status, 'investigating');
    assert.strictEqual(updated.responsible_party, 'ai_operator');

    const locateTask = updated.evidence.owner_tasks?.find((t) => t.id === 'task-9004-find-tracking');
    assert.strictEqual(locateTask?.status, 'completed');

    // Verify audit event
    const events = await listOrderIssueEvents(sandboxTenant, issue.id);
    const trackingEvent = events.find((e) => e.event_type === 'tracking_updated');
    assert.ok(trackingEvent, 'tracking_updated event must be logged');
    assert.strictEqual(trackingEvent.details?.tracking_number, 'TRAX-9004-NEW');
  });

  // Test 5: Idempotency and Concurrent Updates
  test('5. Duplicate and concurrent updates are idempotent with no duplicate tasks or duplicate events', async () => {
    const orderId = '#9005';

    const issue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'delivery_delay',
      status: 'investigating',
      orderId,
      shopDomain,
      customerName: 'Hamza',
      customerEmail: 'hamza@example.com',
      evidence: {
        fulfillment_status: 'fulfilled',
        tracking_number: 'TRK-9005-EXISTING',
        carrier: 'TCS',
        source_updated_at: '2026-10-10T00:00:00.000Z',
      },
    });

    const shopifyPayload = {
      id: '9005005',
      name: '#9005',
      shop_domain: shopDomain,
      fulfillment_status: 'fulfilled',
      updated_at: '2026-10-10T00:00:00.000Z',
      fulfillments: [
        {
          tracking_company: 'TCS',
          tracking_number: 'TRK-9005-EXISTING',
        },
      ],
    };

    // First run ensures issue state is aligned
    await reconcileShopifyOrderUpdate(sandboxTenant, shopifyPayload, { shopDomain });

    // Repeated sequential updates with identical data must return no_change
    const res1 = await reconcileShopifyOrderUpdate(sandboxTenant, shopifyPayload, { shopDomain });
    const res2 = await reconcileShopifyOrderUpdate(sandboxTenant, shopifyPayload, { shopDomain });

    assert.strictEqual(res1[0].action, 'no_change');
    assert.strictEqual(res2[0].action, 'no_change');

    // Concurrent reconciliation run
    const [c1, c2] = await Promise.all([
      reconcileShopifyOrderUpdate(sandboxTenant, shopifyPayload, { shopDomain }),
      reconcileShopifyOrderUpdate(sandboxTenant, shopifyPayload, { shopDomain }),
    ]);

    assert.strictEqual(c1[0].action, 'no_change');
    assert.strictEqual(c2[0].action, 'no_change');

    // Verify no redundant audit events recorded across all runs
    const events = await listOrderIssueEvents(sandboxTenant, issue.id);
    const reconcileEvents = events.filter((e) => e.event_type === 'order_reconciled');
    assert.strictEqual(reconcileEvents.length, 1, 'Exactly 1 event logged from first alignment; no duplicates on repeated or concurrent runs');
  });

  // Test 6: Out-of-order events
  test('6. Older out-of-order events do not overwrite newer order evidence', async () => {
    const orderId = '#9006';

    const issue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'delivery_delay',
      status: 'investigating',
      orderId,
      shopDomain,
      customerName: 'Fatima',
      customerEmail: 'fatima@example.com',
      evidence: {
        fulfillment_status: 'fulfilled',
        tracking_number: 'TRK-NEW-2026',
        source_updated_at: '2026-10-12T10:00:00.000Z',
      },
    });

    // Ingest older event from 2026-10-01
    const olderPayload = {
      id: '9006006',
      name: '#9006',
      shop_domain: shopDomain,
      fulfillment_status: 'unfulfilled', // Old status
      updated_at: '2026-10-01T00:00:00.000Z', // Older timestamp
    };

    const results = await reconcileShopifyOrderUpdate(sandboxTenant, olderPayload, { shopDomain });
    assert.strictEqual(results[0].reconciled, false);
    assert.strictEqual(results[0].action, 'out_of_order_skipped');

    const check = await getOrderIssue(sandboxTenant, issue.id);
    assert.strictEqual(check?.evidence.fulfillment_status, 'fulfilled', 'Status must not regress to unfulfilled');
    assert.strictEqual(check?.evidence.tracking_number, 'TRK-NEW-2026', 'Newer tracking preserved');
  });

  // Test 7: Multi-tenant and shop domain isolation
  test('7. Tenant and shop isolation prevents cross-tenant or cross-shop matching', async () => {
    const orderId = '#9007';

    // Issue in Tenant A
    const issueA = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'not_received',
      status: 'awaiting_owner',
      orderId,
      shopDomain: 'store-a.myshopify.com',
      customerName: 'Customer A',
      customerEmail: 'ca@example.com',
      evidence: { fulfillment_status: 'unfulfilled' },
    });

    // Ingest order in Tenant B with same order ID #9007
    const payloadTenantB = {
      id: '9007007',
      name: '#9007',
      shop_domain: 'store-b.myshopify.com',
      fulfillment_status: 'fulfilled',
      updated_at: new Date().toISOString(),
    };

    const resB = await reconcileShopifyOrderUpdate(sandboxTenantB, payloadTenantB, {
      shopDomain: 'store-b.myshopify.com',
    });
    // Should match nothing in Tenant B
    assert.strictEqual(resB.length, 0);

    // Check Tenant A issue remains unfulfilled
    const checkA = await getOrderIssue(sandboxTenant, issueA.id);
    assert.strictEqual(checkA?.evidence.fulfillment_status, 'unfulfilled');

    // Ingest in Tenant A but with mismatched shop domain
    const resAWrongShop = await reconcileShopifyOrderUpdate(sandboxTenant, payloadTenantB, {
      shopDomain: 'store-b.myshopify.com',
    });
    assert.strictEqual(resAWrongShop.length, 0, 'Must not match issue with different shop domain');
  });

  // Test 8: Selective cancellation of obsolete task reminders
  test('8. Cancels only reminders associated with completed warehouse task and preserves customer clarification and other owner reminders', async () => {
    const orderId = '#9008';
    const warehouseTaskId = `task-9008-fulfill`;
    const financeTaskId = `task-9008-finance-approval`;

    const issue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'delivery_delay',
      status: 'awaiting_owner',
      orderId,
      shopDomain,
      customerName: 'Usman',
      customerEmail: 'usman@example.com',
      evidence: {
        fulfillment_status: 'unfulfilled',
        owner_tasks: [
          { id: warehouseTaskId, title: 'Warehouse fulfillment', status: 'pending', created_at: new Date().toISOString() },
          { id: financeTaskId, title: 'Owner refund authorization', status: 'pending', created_at: new Date().toISOString() },
        ],
      },
    });

    // Schedule 3 follow-ups:
    // 1. Warehouse reminder
    const warehouseJob = await scheduleOrderIssueFollowup({
      tenantId: sandboxTenant,
      issueId: issue.id,
      followupType: 'awaiting_owner_review',
      scheduledFor: new Date(Date.now() + 3600000).toISOString(),
      associatedTaskId: warehouseTaskId,
      metadata: { associated_task_id: warehouseTaskId },
    });

    // 2. Customer clarification reminder
    const customerJob = await scheduleOrderIssueFollowup({
      tenantId: sandboxTenant,
      issueId: issue.id,
      followupType: 'awaiting_customer_reply',
      scheduledFor: new Date(Date.now() + 7200000).toISOString(),
    });

    // 3. Finance authorization reminder
    const financeJob = await scheduleOrderIssueFollowup({
      tenantId: sandboxTenant,
      issueId: issue.id,
      followupType: 'awaiting_owner_review',
      scheduledFor: new Date(Date.now() + 10800000).toISOString(),
      associatedTaskId: financeTaskId,
      metadata: { associated_task_id: financeTaskId },
    });

    // Reconcile fulfillment with tracking
    await reconcileShopifyOrderUpdate(sandboxTenant, {
      id: '9008008',
      name: '#9008',
      shop_domain: shopDomain,
      fulfillment_status: 'fulfilled',
      fulfillments: [{ tracking_company: 'TCS', tracking_number: 'TCS-9008' }],
      updated_at: new Date().toISOString(),
    }, { shopDomain });

    // Verify warehouse job was cancelled
    const [whRow] = await query(`SELECT status FROM iao.order_issue_followup_jobs WHERE id = $1;`, [warehouseJob.id]);
    assert.strictEqual(whRow.status, 'cancelled');

    // Verify customer job remains pending
    const [custRow] = await query(`SELECT status FROM iao.order_issue_followup_jobs WHERE id = $1;`, [customerJob.id]);
    assert.strictEqual(custRow.status, 'pending', 'Customer clarification reminder must be preserved');

    // Verify finance job remains pending
    const [finRow] = await query(`SELECT status FROM iao.order_issue_followup_jobs WHERE id = $1;`, [financeJob.id]);
    assert.strictEqual(finRow.status, 'pending', 'Financial authorization reminder must be preserved');
  });

  // Test 9: Preservation of approval gates and resolved history
  test('9. Order updates never approve financial actions and never reopen resolved or closed issues', async () => {
    const orderId = '#9009';

    // Resolved issue
    const resolvedIssue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'delivery_delay',
      status: 'resolved',
      orderId,
      shopDomain,
      customerName: 'Kareem',
      customerEmail: 'kareem@example.com',
      evidence: {
        fulfillment_status: 'fulfilled',
        proposal_id: 'prop-financial-refund-123',
        proposal_action: 'refund',
      },
    });

    // Reconcile order update
    const res = await reconcileShopifyOrderUpdate(sandboxTenant, {
      id: '9009009',
      name: '#9009',
      shop_domain: shopDomain,
      fulfillment_status: 'fulfilled',
      fulfillments: [{ tracking_number: 'NEW-TRK-9009' }],
      updated_at: new Date().toISOString(),
    }, { shopDomain });

    // Should NOT modify resolved issue
    assert.strictEqual(res.length, 0);

    const check = await getOrderIssue(sandboxTenant, resolvedIssue.id);
    assert.strictEqual(check?.status, 'resolved', 'Must not reopen resolved issue');
    assert.strictEqual(check?.evidence.proposal_id, 'prop-financial-refund-123', 'Financial proposal untouched');
  });

  // Test 10: Zero email dispatch during reconciliation
  test('10. Zero email dispatch occurs during order update reconciliation', async () => {
    const orderId = '#9010';

    const beforeDispatches = await query(
      `SELECT count(*) as count FROM iao.messages WHERE tenant_id = $1 AND sender_type = 'ai_operator';`,
      [sandboxTenant]
    );

    const issue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'not_received',
      status: 'awaiting_owner',
      orderId,
      shopDomain,
      customerName: 'Mariam',
      customerEmail: 'mariam@example.com',
      evidence: { fulfillment_status: 'unfulfilled' },
    });

    await reconcileShopifyOrderUpdate(sandboxTenant, {
      id: '9010010',
      name: '#9010',
      shop_domain: shopDomain,
      fulfillment_status: 'fulfilled',
      fulfillments: [{ tracking_company: 'TCS', tracking_number: 'TCS-9010' }],
      updated_at: new Date().toISOString(),
    }, { shopDomain });

    const afterDispatches = await query(
      `SELECT count(*) as count FROM iao.messages WHERE tenant_id = $1 AND sender_type = 'ai_operator';`,
      [sandboxTenant]
    );

    assert.strictEqual(
      parseInt(afterDispatches[0].count, 10),
      parseInt(beforeDispatches[0].count, 10),
      'Reconciliation phase must not generate or send any customer emails'
    );
  });

  // Test 11: End-to-end ingestion trigger via upsertShopifyOrdersBatch
  test('11. Ingestion via upsertShopifyOrdersBatch automatically triggers reconciliation', async () => {
    const orderId = '#9011';

    const issue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'not_received',
      status: 'awaiting_owner',
      orderId,
      shopDomain,
      customerName: 'Danish',
      customerEmail: 'danish@example.com',
      evidence: {
        fulfillment_status: 'unfulfilled',
        owner_tasks: [{ id: 'task-9011-fulfill', title: 'Warehouse fulfillment', status: 'pending', created_at: new Date().toISOString() }],
      },
    });

    // Ingest via upsertShopifyOrdersBatch (the standard function used by webhooks, cron sync, manual sync)
    const count = await upsertShopifyOrdersBatch(sandboxTenant, [
      {
        id: '9011011',
        name: '#9011',
        email: 'danish@example.com',
        fulfillment_status: 'fulfilled',
        updated_at: new Date().toISOString(),
        fulfillments: [
          { tracking_company: 'FedEx', tracking_number: 'FDX-9011-BATCH' },
        ],
      },
    ]);

    assert.strictEqual(count, 1);

    // Verify issue was reconciled through the batch ingestion pipeline
    const updated = await getOrderIssue(sandboxTenant, issue.id);
    assert.ok(updated);
    assert.strictEqual(updated.evidence.fulfillment_status, 'fulfilled');
    assert.strictEqual(updated.evidence.tracking_number, 'FDX-9011-BATCH');
    assert.strictEqual(updated.status, 'investigating');
    assert.strictEqual(updated.responsible_party, 'ai_operator');
  });

  // Test 12: Reminder-chain limits across the same unresolved task
  test('12. Enforces max_followup_attempts across reminder chain: after 2 reminders escalation is recorded and no 3rd reminder scheduled', async () => {
    const orderId = '#9012';
    const taskId = 'task-9012-fulfill';

    const issue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'delivery_delay',
      status: 'awaiting_owner',
      orderId,
      shopDomain,
      customerName: 'Zubair',
      customerEmail: 'zubair@example.com',
      evidence: {
        fulfillment_status: 'unfulfilled',
        owner_tasks: [{ id: taskId, title: 'Warehouse fulfillment', status: 'pending', created_at: new Date().toISOString() }],
      },
    });

    // 1. Initial schedule creates Job 1 with attempt_count = 0
    const job1 = await scheduleOrderIssueFollowup({
      tenantId: sandboxTenant,
      issueId: issue.id,
      followupType: 'awaiting_owner_review',
      maxAttempts: 2,
      delayHours: 24,
      associatedTaskId: taskId,
    });
    assert.ok(job1);
    assert.strictEqual(job1.attempt_count, 0);

    // Make job 1 due immediately
    await query(`UPDATE iao.order_issue_followup_jobs SET scheduled_for = NOW() - INTERVAL '1 minute' WHERE id = $1;`, [job1.id]);

    // Claim and process Job 1
    const claimed1 = await claimDueFollowupJobs(sandboxTenant, 1, 'worker_test');
    assert.strictEqual(claimed1.length, 1);
    assert.strictEqual(claimed1[0].id, job1.id);

    const outcome1 = await processClaimedFollowupJob(claimed1[0]);
    assert.strictEqual(outcome1.outcome, 'completed');

    // Job 1 is completed with attempt_count = 1
    const [job1After] = await query(`SELECT status, attempt_count FROM iao.order_issue_followup_jobs WHERE id = $1;`, [job1.id]);
    assert.strictEqual(job1After.status, 'completed');
    assert.strictEqual(job1After.attempt_count, 1);

    // Job 2 was automatically scheduled with cumulative attempt_count = 1
    const activeJobsAfter1 = await query(
      `SELECT * FROM iao.order_issue_followup_jobs WHERE tenant_id = $1 AND issue_id = $2 AND status = 'pending';`,
      [sandboxTenant, issue.id]
    );
    assert.strictEqual(activeJobsAfter1.length, 1);
    const job2 = activeJobsAfter1[0];
    assert.strictEqual(job2.attempt_count, 1, 'Next job in chain must start with cumulative attempt_count = 1');
    assert.strictEqual(job2.associated_task_id, taskId, 'associated_task_id must be strictly preserved');

    // Make job 2 due immediately
    await query(`UPDATE iao.order_issue_followup_jobs SET scheduled_for = NOW() - INTERVAL '1 minute' WHERE id = $1;`, [job2.id]);

    // Claim and process Job 2
    const claimed2 = await claimDueFollowupJobs(sandboxTenant, 1, 'worker_test');
    assert.strictEqual(claimed2.length, 1);
    assert.strictEqual(claimed2[0].id, job2.id);

    const outcome2 = await processClaimedFollowupJob(claimed2[0]);
    assert.strictEqual(outcome2.outcome, 'escalated_to_owner', 'Must record escalation on 2nd attempt');

    // Job 2 is completed with attempt_count = 2
    const [job2After] = await query(`SELECT status, attempt_count FROM iao.order_issue_followup_jobs WHERE id = $1;`, [job2.id]);
    assert.strictEqual(job2After.status, 'completed');
    assert.strictEqual(job2After.attempt_count, 2);

    // Crucial check: NO further reminder is scheduled! Active pending jobs = 0
    const activeJobsAfter2 = await query(
      `SELECT * FROM iao.order_issue_followup_jobs WHERE tenant_id = $1 AND issue_id = $2 AND status IN ('pending', 'claimed');`,
      [sandboxTenant, issue.id]
    );
    assert.strictEqual(activeJobsAfter2.length, 0, 'No additional reminder job may be scheduled after max attempts');

    // Issue has been marked escalated
    const updatedIssue = await getOrderIssue(sandboxTenant, issue.id);
    assert.strictEqual(updatedIssue?.is_escalated, true);

    // Verify calling scheduleOrderIssueFollowup again returns null and does NOT schedule a 3rd job
    const attempt3Job = await scheduleOrderIssueFollowup({
      tenantId: sandboxTenant,
      issueId: issue.id,
      followupType: 'awaiting_owner_review',
      maxAttempts: 2,
      associatedTaskId: taskId,
    });
    assert.strictEqual(attempt3Job, null, 'Must return null when max attempts already reached');

    const totalJobs = await query(
      `SELECT count(*) as count FROM iao.order_issue_followup_jobs WHERE tenant_id = $1 AND issue_id = $2;`,
      [sandboxTenant, issue.id]
    );
    assert.strictEqual(parseInt(totalJobs[0].count, 10), 2, 'Exactly 2 jobs total in the chain');
  });

  // Test 13: Concurrency and Deduplication
  test('13. Concurrent scheduling calls do NOT create duplicate jobs or reset counters', async () => {
    const orderId = '#9013';
    const taskId = 'task-9013-fulfill';

    const issue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'not_received',
      status: 'awaiting_owner',
      orderId,
      shopDomain,
      customerName: 'Saima',
      customerEmail: 'saima@example.com',
      evidence: {
        fulfillment_status: 'unfulfilled',
        owner_tasks: [{ id: taskId, title: 'Warehouse fulfillment', status: 'pending', created_at: new Date().toISOString() }],
      },
    });

    // Schedule concurrently 3 times
    const [j1, j2, j3] = await Promise.all([
      scheduleOrderIssueFollowup({ tenantId: sandboxTenant, issueId: issue.id, followupType: 'awaiting_owner_review', associatedTaskId: taskId }),
      scheduleOrderIssueFollowup({ tenantId: sandboxTenant, issueId: issue.id, followupType: 'awaiting_owner_review', associatedTaskId: taskId }),
      scheduleOrderIssueFollowup({ tenantId: sandboxTenant, issueId: issue.id, followupType: 'awaiting_owner_review', associatedTaskId: taskId }),
    ]);

    assert.ok(j1);
    assert.strictEqual(j1.id, j2?.id);
    assert.strictEqual(j1.id, j3?.id);

    const jobRows = await query(
      `SELECT count(*) as count FROM iao.order_issue_followup_jobs WHERE tenant_id = $1 AND issue_id = $2;`,
      [sandboxTenant, issue.id]
    );
    assert.strictEqual(parseInt(jobRows[0].count, 10), 1, 'Only exactly 1 job created, no concurrent duplicates');
  });

  // Test 14: Customer replies and syncs do not reset reminder chain attempt limits
  test('14. Customer replies and syncs preserve cumulative reminder count and do not silently reset limits', async () => {
    const orderId = '#9014';
    const taskId = 'task-9014-fulfill';

    const issue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'delivery_delay',
      status: 'awaiting_owner',
      orderId,
      shopDomain,
      customerName: 'Naveed',
      customerEmail: 'naveed@example.com',
      evidence: {
        fulfillment_status: 'unfulfilled',
        owner_tasks: [{ id: taskId, title: 'Warehouse fulfillment', status: 'pending', created_at: new Date().toISOString() }],
      },
    });

    // Run attempt 1
    const j1 = await scheduleOrderIssueFollowup({
      tenantId: sandboxTenant,
      issueId: issue.id,
      followupType: 'awaiting_owner_review',
      maxAttempts: 2,
      associatedTaskId: taskId,
    });
    await query(`UPDATE iao.order_issue_followup_jobs SET scheduled_for = NOW() - INTERVAL '1 minute' WHERE id = $1;`, [j1?.id]);
    const claimed = await claimDueFollowupJobs(sandboxTenant, 1, 'w1');
    await processClaimedFollowupJob(claimed[0]);

    // 1 completed reminder now exists
    const cumulative = await getCumulativeReminderCount(sandboxTenant, issue.id, 'awaiting_owner_review', taskId);
    assert.strictEqual(cumulative, 1);

    // Simulate customer reply or order sync invoking scheduleOrderIssueFollowup
    // Active job already exists (Job 2), calling schedule returns existing Job 2 with attempt_count = 1
    const resyncJob = await scheduleOrderIssueFollowup({
      tenantId: sandboxTenant,
      issueId: issue.id,
      followupType: 'awaiting_owner_review',
      maxAttempts: 2,
      associatedTaskId: taskId,
    });
    assert.ok(resyncJob);
    assert.strictEqual(resyncJob.attempt_count, 1, 'Sync or reply must NOT reset attempt_count to 0');
  });

  // Test 15: Selective legacy cancellation preserves unassociated jobs without guessing from ID patterns
  test('15. Selective legacy cancellation preserves unassociated jobs without guessing from ID patterns and reports ambiguity', async () => {
    const orderId = '#9015';
    const warehouseTaskId = 'task-warehouse-9015';
    const otherTaskId = 'task-other-9015';

    const issue = await createOrderIssue({
      tenantId: sandboxTenant,
      issueType: 'not_received',
      status: 'awaiting_owner',
      orderId,
      shopDomain,
      customerName: 'Rehan',
      customerEmail: 'rehan@example.com',
      evidence: {
        fulfillment_status: 'unfulfilled',
        owner_tasks: [
          { id: warehouseTaskId, title: 'Warehouse dispatch', status: 'pending', created_at: new Date().toISOString() },
          { id: otherTaskId, title: 'Investigate carrier', status: 'pending', created_at: new Date().toISOString() },
        ],
      },
    });

    // 1. Job A: Unambiguously associated with warehouseTaskId
    const jobA = await scheduleOrderIssueFollowup({
      tenantId: sandboxTenant,
      issueId: issue.id,
      followupType: 'awaiting_owner_review',
      associatedTaskId: warehouseTaskId,
    });

    // 2. Job B: Unambiguously associated with otherTaskId
    const jobB = await scheduleOrderIssueFollowup({
      tenantId: sandboxTenant,
      issueId: issue.id,
      followupType: 'awaiting_owner_review',
      associatedTaskId: otherTaskId,
    });

    // 3. Job C: Legacy job without associated_task_id, but ID happens to contain 'fulfill'
    const legacyJobId = `fjob_legacy_fulfill_${Date.now()}`;
    await query(
      `INSERT INTO iao.order_issue_followup_jobs (
        id, tenant_id, issue_id, status, followup_type, attempt_count, max_attempts, scheduled_for, created_at, updated_at
      ) VALUES ($1, $2, $3, 'pending', 'awaiting_owner_review', 0, 2, NOW() + INTERVAL '24 hours', NOW(), NOW());`,
      [legacyJobId, sandboxTenant, issue.id]
    );

    // Call cancelFollowupsForTask for warehouseTaskId
    const cancelResult = await cancelFollowupsForTask(sandboxTenant, issue.id, warehouseTaskId);

    assert.strictEqual(cancelResult.cancelledCount, 1);
    assert.deepStrictEqual(cancelResult.cancelledJobIds, [jobA?.id]);
    assert.deepStrictEqual(cancelResult.preservedAmbiguousJobIds, [legacyJobId]);

    // Verify Job A is cancelled
    const [rowA] = await query(`SELECT status FROM iao.order_issue_followup_jobs WHERE id = $1;`, [jobA?.id]);
    assert.strictEqual(rowA.status, 'cancelled');

    // Verify Job B is preserved (different task)
    const [rowB] = await query(`SELECT status FROM iao.order_issue_followup_jobs WHERE id = $1;`, [jobB?.id]);
    assert.strictEqual(rowB.status, 'pending');

    // Verify Job C is preserved (unassociated legacy job was NOT cancelled by guessing from ID pattern 'fulfill')
    const [rowC] = await query(`SELECT status FROM iao.order_issue_followup_jobs WHERE id = $1;`, [legacyJobId]);
    assert.strictEqual(rowC.status, 'pending', 'Legacy job must NOT be cancelled by guessing from ID pattern');

    // Verify ambiguity audit event was recorded
    const events = await listOrderIssueEvents(sandboxTenant, issue.id);
    const ambiguityEvent = events.find((e) => e.details?.reason === 'unassociated_legacy_reminder_preserved_without_guessing');
    assert.ok(ambiguityEvent, 'Ambiguity audit event must be logged');
    assert.ok(ambiguityEvent.summary.includes('Preserved 1 unassociated legacy reminder'));
  });
});

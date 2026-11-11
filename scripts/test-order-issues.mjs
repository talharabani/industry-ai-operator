// Order Issue Resolution Module Test Suite
import assert from 'node:assert';
import { test, describe } from 'node:test';
import {
  detectOrderIssue,
  investigateOrderData,
  buildOrderIssueAcknowledgment,
  findMatchingOrder,
  extractOrderIdentifier,
  createOrderIssue,
  getOrderIssue,
  listOrderIssues,
  updateOrderIssue,
  addOrderIssueEvent,
  listOrderIssueEvents,
  scheduleOrderIssueFollowup,
  cancelPendingFollowupsForIssue,
  claimDueFollowupJobs,
  processClaimedFollowupJob,
  query,
} from '../lib/order-issues.ts';
import { cleanQuotedReplyText, evaluateRoutineInquiry } from '../lib/routine-evaluator.ts';
import { classifyEmailMessage } from '../lib/email-filter.ts';

describe('Order Issue Detection & Clean Quoted Text Exclusion', () => {
  test('excludes quoted history from customer emails', () => {
    const rawEmail = `My parcel has not arrived yet! Where is order #1001?
    
On Tue, Oct 6, 2026 at 10:00 AM Store Support <support@demo-store.com> wrote:
> Hello Customer,
> Your order has been placed.
> Thanks for shopping with us!`;

    const cleaned = cleanQuotedReplyText(rawEmail);
    assert.strictEqual(cleaned.includes('My parcel has not arrived yet!'), true);
    assert.strictEqual(cleaned.includes('On Tue, Oct 6, 2026'), false);
    assert.strictEqual(cleaned.includes('Thanks for shopping with us!'), false);
  });

  test('detects delivery delay and not received issues', () => {
    const text1 = 'Hi, where is my order? It has been over 10 days and parcel not received yet #1001';
    const detection1 = detectOrderIssue(text1);
    assert.strictEqual(detection1.isIssue, true);
    assert.strictEqual(detection1.issueType, 'not_received');
    assert.strictEqual(detection1.extractedOrderRef, '1001');

    const text2 = 'My delivery is delayed and tracking is not updating';
    const detection2 = detectOrderIssue(text2);
    assert.strictEqual(detection2.isIssue, true);
    assert.strictEqual(detection2.issueType, 'delivery_delay');
  });

  test('detects damaged and wrong item issues', () => {
    const text1 = 'I received the package today but the shirt is torn and damaged';
    const detection1 = detectOrderIssue(text1);
    assert.strictEqual(detection1.isIssue, true);
    assert.strictEqual(detection1.issueType, 'damaged_item');

    const text2 = 'You sent me the wrong item! I ordered blue kurti but received red dress';
    const detection2 = detectOrderIssue(text2);
    assert.strictEqual(detection2.isIssue, true);
    assert.strictEqual(detection2.issueType, 'wrong_item');
  });

  test('detects refund, exchange, and cancellation requests', () => {
    const text1 = 'I would like a full refund for order #1002';
    const detection1 = detectOrderIssue(text1);
    assert.strictEqual(detection1.isIssue, true);
    assert.strictEqual(detection1.issueType, 'refund_request');

    const text2 = 'Can I exchange this size for a large please?';
    const detection2 = detectOrderIssue(text2);
    assert.strictEqual(detection2.isIssue, true);
    assert.strictEqual(detection2.issueType, 'exchange_request');

    const text3 = 'Please cancel my order immediately';
    const detection3 = detectOrderIssue(text3);
    assert.strictEqual(detection3.isIssue, true);
    assert.strictEqual(detection3.issueType, 'cancellation_request');
  });

  test('ignores generic greetings or policy questions', () => {
    const text = 'Hello, what are your store opening hours on Friday?';
    const detection = detectOrderIssue(text);
    assert.strictEqual(detection.isIssue, false);
  });
});

describe('Customer Privacy, Ownership Verification & Tenant Isolation', () => {
  const mockOrders = [
    {
      order_id: '1001',
      tenant_id: 'demo-store',
      customer_email: 'mukaramajeed28094@gmail.com',
      customer_name: 'Mukaram Majeed',
      total: 3500,
      currency: 'PKR',
      status: 'unfulfilled',
      data: {
        fulfillment_status: 'unfulfilled',
        customer_email: 'mukaramajeed28094@gmail.com',
      },
    },
    {
      order_id: '1002',
      tenant_id: 'demo-store',
      customer_email: 'sarah@example.com',
      customer_name: 'Sarah Khan',
      total: 5200,
      currency: 'PKR',
      status: 'fulfilled',
      data: {
        fulfillment_status: 'fulfilled',
        tracking_number: 'TRK-PK-98214',
        carrier: 'Trax Logistics',
        customer_email: 'sarah@example.com',
      },
    },
  ];

  test('allows order lookup when customer email matches', () => {
    const match = findMatchingOrder('1001', 'mukaramajeed28094@gmail.com', mockOrders);
    assert.strictEqual(match.matched, true);
    assert.strictEqual(match.privacyBlocked, false);
    assert.strictEqual(match.order?.order_id, '1001');
  });

  test('blocks order disclosure when sender email does not match order record', () => {
    const match = findMatchingOrder('1001', 'intruder@unknown.com', mockOrders);
    assert.strictEqual(match.matched, false);
    assert.strictEqual(match.privacyBlocked, true);
    assert.strictEqual(match.order, null);
  });

  test('handles missing order reference cleanly without privacy leak', () => {
    const match = findMatchingOrder(null, 'customer@example.com', mockOrders);
    assert.strictEqual(match.matched, false);
    assert.strictEqual(match.privacyBlocked, false);
    assert.strictEqual(match.order, null);
  });
});

describe('Verified Investigation Logic & Carrier Fact Strictness', () => {
  test('unfulfilled order is NOT inferred as a carrier delay', () => {
    const unfulfilledOrder = {
      order_id: '1001',
      tenant_id: 'demo-store',
      customer_email: 'customer@example.com',
      status: 'open',
      data: {
        fulfillment_status: 'unfulfilled',
      },
    };

    const inv = investigateOrderData(unfulfilledOrder, 'delivery_delay', 'Where is my parcel?');
    assert.strictEqual(inv.evidence.fulfillment_status, 'unfulfilled');
    assert.strictEqual(inv.evidence.tracking_number, undefined);
    assert.strictEqual(inv.responsibleParty, 'owner');
    assert.strictEqual(inv.initialStatus, 'awaiting_owner');
    assert.strictEqual(inv.evidence.investigation_notes?.includes('Do not promise delivery dates or infer transit delay'), true);
    assert.strictEqual(inv.evidence.owner_tasks?.[0]?.title.includes('Warehouse fulfillment required'), true);
  });

  test('fulfilled order with tracking captures carrier facts accurately', () => {
    const fulfilledOrder = {
      order_id: '1002',
      tenant_id: 'demo-store',
      customer_email: 'customer@example.com',
      status: 'fulfilled',
      data: {
        fulfillment_status: 'fulfilled',
        tracking_number: '9400111202555',
        carrier: 'USPS',
        delivery_status: 'in_transit',
      },
    };

    const inv = investigateOrderData(fulfilledOrder, 'delivery_delay', 'Tracking has not updated');
    assert.strictEqual(inv.evidence.fulfillment_status, 'fulfilled');
    assert.strictEqual(inv.evidence.tracking_number, '9400111202555');
    assert.strictEqual(inv.evidence.carrier, 'USPS');
    assert.strictEqual(inv.responsibleParty, 'ai_operator');
    assert.strictEqual(inv.initialStatus, 'investigating');
  });

  test('carrier delivery exception is properly identified', () => {
    const delayedCarrierOrder = {
      order_id: '1003',
      tenant_id: 'demo-store',
      customer_email: 'customer@example.com',
      status: 'fulfilled',
      data: {
        fulfillment_status: 'fulfilled',
        tracking_number: 'TRX-112233',
        carrier: 'Trax Logistics',
        delivery_status: 'delayed',
      },
    };

    const inv = investigateOrderData(delayedCarrierOrder, 'delivery_delay', 'Delivery was missed');
    assert.strictEqual(inv.evidence.delivery_status, 'delayed');
    assert.strictEqual(inv.initialStatus, 'awaiting_owner');
    assert.strictEqual(inv.responsibleParty, 'owner');
    assert.strictEqual(inv.evidence.owner_tasks?.[0]?.title.includes('Carrier exception reported'), true);
  });

  test('missing carrier data states limitation and creates owner task', () => {
    const fulfilledNoTrackingOrder = {
      order_id: '1004',
      tenant_id: 'demo-store',
      customer_email: 'customer@example.com',
      status: 'fulfilled',
      data: {
        fulfillment_status: 'fulfilled',
      },
    };

    const inv = investigateOrderData(fulfilledNoTrackingOrder, 'delivery_delay', 'Where is my order?');
    assert.strictEqual(inv.evidence.carrier_data_unavailable, true);
    assert.strictEqual(inv.initialStatus, 'awaiting_owner');
    assert.strictEqual(inv.responsibleParty, 'owner');
    assert.strictEqual(inv.evidence.owner_tasks?.[0]?.title.includes('Locate courier tracking information'), true);
  });

  test('missing order details requests clarification from customer', () => {
    const inv = investigateOrderData(null, 'delivery_delay', 'My order did not arrive');
    assert.strictEqual(inv.initialStatus, 'awaiting_customer');
    assert.strictEqual(inv.responsibleParty, 'customer');
    assert.strictEqual(inv.nextAction.includes('clarification'), true);
  });
});

describe('Order Issue Acknowledgment Generation & Verified Findings Strictness', () => {
  test('generates factual acknowledgment for not-received inquiry on unfulfilled order (Live test scenario #1001)', () => {
    const unfulfilledOrder = {
      order_id: '#1001',
      tenant_id: 'demo-store',
      customer_email: 'mukaramajeed28094@gmail.com',
      status: 'unfulfilled',
      data: {
        fulfillment_status: 'unfulfilled',
        items: [{ title: 'The Collection Snowboard', quantity: 1 }],
      },
    };

    const inv = investigateOrderData(unfulfilledOrder, 'not_received', 'My order #1001 has not arrived. Please check its status.');
    assert.strictEqual(inv.initialStatus, 'awaiting_owner');
    assert.strictEqual(Boolean(inv.evidence.owner_tasks?.length), true);

    const ack = buildOrderIssueAcknowledgment({
      issueType: 'not_received',
      order: unfulfilledOrder,
      evidence: inv.evidence,
      customerName: 'Mukaram Majeed',
      businessName: 'rabani',
      hasPersistedTask: true,
    });

    // 1. Acknowledges not-received complaint
    assert.strictEqual(ack.includes('order not having arrived') || ack.includes('Order #1001'), true);

    // 2. Explains fulfillment is not yet recorded and tracking is unavailable
    assert.strictEqual(ack.includes('fulfillment has not yet been recorded'), true);
    assert.strictEqual(ack.includes('courier tracking details are currently unavailable'), true);

    // 3. States that the request was flagged for store team only when task was persisted
    assert.strictEqual(ack.includes('flagged this request for our store team to review the fulfillment status'), true);

    // 4. Does NOT claim active preparation, courier contact, or a delivery date without evidence
    assert.strictEqual(ack.toLowerCase().includes('order is being prepared for shipment'), false);
    assert.strictEqual(ack.toLowerCase().includes('contacted the courier'), false);
    assert.strictEqual(ack.toLowerCase().includes('will arrive on'), false);

    // 5. Initial status remains awaiting_owner
    assert.strictEqual(inv.initialStatus, 'awaiting_owner');
  });

  test('omits store team task sentence when no owner task was persisted', () => {
    const ackNoTask = buildOrderIssueAcknowledgment({
      issueType: 'not_received',
      order: { order_id: '#1001', status: 'unfulfilled' },
      evidence: { fulfillment_status: 'unfulfilled', order_status: 'unfulfilled' },
      customerName: 'Mukaram',
      businessName: 'rabani',
      hasPersistedTask: false,
    });

    assert.strictEqual(ackNoTask.includes('flagged this request for our store team'), false);
    assert.strictEqual(ackNoTask.includes('fulfillment has not yet been recorded'), true);
  });

  test('generates carrier exception acknowledgment when carrier delay is reported', () => {
    const carrierDelayedOrder = {
      order_id: '#1005',
      status: 'fulfilled',
      data: {
        tracking_number: 'TRK-99001',
        carrier: 'Trax Logistics',
        delivery_status: 'delayed',
      },
    };

    const inv = investigateOrderData(carrierDelayedOrder, 'delivery_delay', 'Why is my parcel stuck?');
    const ack = buildOrderIssueAcknowledgment({
      issueType: 'delivery_delay',
      order: carrierDelayedOrder,
      evidence: inv.evidence,
      customerName: 'Ali',
      businessName: 'rabani',
      hasPersistedTask: true,
    });

    assert.strictEqual(ack.includes('TRK-99001'), true);
    assert.strictEqual(ack.includes('Trax Logistics'), true);
    assert.strictEqual(ack.includes('transit exception/delay'), true);
  });
});

describe('Fintech & Banking Notification Isolation (NayaPay, SadaPay, etc.)', () => {
  test('classifies NayaPay money transfer alerts as payment_transaction_alert non-customer', () => {
    const paymentEmail1 = classifyEmailMessage({
      senderEmail: 'service@nayapay.com',
      senderName: 'NayaPay',
      subject: 'You sent Rs. 260 to Anjum Imtiaz 💸',
      bodyText: 'NayaPay Email --> Anjum Imtiaz JazzCash/Mobilink MFB-5458 08 Oct 2026, 12:05 PM - Rs. 260 AMOUNT DETAILS Amount Sent Rs. 260 Service Fee (Incl. Tax) Rs. 0 Total',
    });

    assert.strictEqual(paymentEmail1.isNonCustomer, true);
    assert.strictEqual(paymentEmail1.category, 'payment_transaction_alert');

    const paymentEmail2 = classifyEmailMessage({
      senderEmail: 'service@nayapay.com',
      senderName: 'NayaPay',
      subject: 'You got Rs. 5,000 from Ishaq Azra 🎉',
      bodyText: 'NayaPay Email Cha-Ching! --> Ishaq Azra HBL-1803 06 Oct 2026, 09:21 PM Rs. 5,000 AMOUNT DETAILS Amount Received Rs. 5,000 Service Fee (Incl. Tax) Rs. 0',
    });

    assert.strictEqual(paymentEmail2.isNonCustomer, true);
    assert.strictEqual(paymentEmail2.category, 'payment_transaction_alert');
  });

  test('classifies utility bills and wallet statements as non-customer payment alerts', () => {
    const billEmail = classifyEmailMessage({
      senderEmail: 'service@nayapay.com',
      senderName: 'NayaPay',
      subject: "You've got a new bill from StormFiber 🧾",
      bodyText: 'Your bill from StormFiber for Rs. 2,613, due by 12-Oct-2026, is ready. Take care of it early and stay ahead!',
    });

    assert.strictEqual(billEmail.isNonCustomer, true);
    assert.strictEqual(billEmail.category, 'payment_transaction_alert');
  });

  test('prevents routine order evaluator from responding to payment transaction notifications', () => {
    const routineEval = evaluateRoutineInquiry({
      subject: 'You sent Rs. 260 to Anjum Imtiaz 💸',
      bodyText: 'NayaPay Email --> Anjum Imtiaz JazzCash/Mobilink MFB-5458 08 Oct 2026 - Rs. 260',
      senderName: 'NayaPay',
      senderEmail: 'service@nayapay.com',
      settings: { business_name: 'rabani', automation_mode: 'auto_routine' },
    });

    assert.strictEqual(routineEval.canAutoReply, false);
    assert.strictEqual(routineEval.intent, 'ignored_automated');
    assert.strictEqual(routineEval.requiresApproval, false);
  });
});

describe('Persistent Issue Lifecycle, Follow-Up Queue & Database Integrity', () => {
  const testTenant = 'test-issue-tenant-' + Date.now();
  let createdIssueId = '';

  test('creates a persistent order issue and audit trail in PostgreSQL', async () => {
    const issue = await createOrderIssue({
      tenant_id: testTenant,
      issue_type: 'delivery_delay',
      status: 'investigating',
      customer_email: 'testcustomer@example.com',
      customer_name: 'Test Customer',
      order_id: 'ORD-999',
      evidence: {
        customer_claim: 'Parcel is late',
        fulfillment_status: 'fulfilled',
        tracking_number: 'TRK-TEST-123',
        carrier: 'TCS',
      },
      next_action: 'Check carrier delivery tracking status',
      responsible_party: 'ai_operator',
    });

    assert.strictEqual(Boolean(issue.id), true);
    assert.strictEqual(issue.tenant_id, testTenant);
    assert.strictEqual(issue.status, 'investigating');
    assert.strictEqual(issue.evidence.tracking_number, 'TRK-TEST-123');
    createdIssueId = issue.id;

    // Verify initial audit event was recorded
    const events = await listOrderIssueEvents(testTenant, createdIssueId);
    assert.strictEqual(events.length >= 1, true);
    assert.strictEqual(events[0].event_type, 'created');
  });

  test('updates issue status and appends chronological audit trail events', async () => {
    assert.strictEqual(Boolean(createdIssueId), true);

    const updated = await updateOrderIssue(
      testTenant,
      createdIssueId,
      {
        status: 'awaiting_owner',
        responsible_party: 'owner',
        next_action: 'Owner investigation required for lost parcel',
      },
      {
        actorType: 'ai_operator',
        summary: 'Escalated to store owner after tracking stalled',
      }
    );

    assert.strictEqual(updated?.status, 'awaiting_owner');
    assert.strictEqual(updated?.responsible_party, 'owner');

    const events = await listOrderIssueEvents(testTenant, createdIssueId);
    const transitionEvent = events.find((e) => e.event_type === 'status_changed');
    assert.strictEqual(Boolean(transitionEvent), true);
    assert.strictEqual(transitionEvent?.from_status, 'investigating');
    assert.strictEqual(transitionEvent?.to_status, 'awaiting_owner');
  });

  test('schedules, atomically claims, and retries follow-up jobs', async () => {
    // Ensure issue is awaiting customer response
    await updateOrderIssue(testTenant, createdIssueId, {
      status: 'awaiting_customer',
      responsible_party: 'customer',
    });

    // Schedule a due job
    const job = await scheduleOrderIssueFollowup({
      tenant_id: testTenant,
      issue_id: createdIssueId,
      job_type: 'awaiting_customer_clarification',
      run_at: new Date(Date.now() - 1000), // In the past (due immediately)
      max_attempts: 2,
    });

    assert.strictEqual(Boolean(job.id), true);
    assert.strictEqual(job.status, 'pending');

    // Claim due jobs atomically with SKIP LOCKED
    const claimedJobs = await claimDueFollowupJobs(testTenant, 10);
    assert.strictEqual(claimedJobs.length >= 1, true);
    const myJob = claimedJobs.find((j) => j.id === job.id);
    assert.strictEqual(Boolean(myJob), true);
    assert.strictEqual(myJob?.status, 'claimed');

    // Process claimed job with mock settings
    const outcome = await processClaimedFollowupJob(myJob, {
      automation_mode: 'auto_routine',
      order_issues_config: {
        followup_interval_hours: 24,
        max_followup_attempts: 2,
        escalate_after_attempts: true,
        auto_close_resolved_days: 7,
      },
    });

    assert.strictEqual(outcome.actionTaken.includes('verified tracking'), true);

    // Verify job status updated to completed
    const jobRows = await query(
      `SELECT * FROM iao.order_issue_followup_jobs WHERE id = $1;`,
      [job.id]
    );
    assert.strictEqual(jobRows[0].status, 'completed');
  });

  test('cancels pending follow-up jobs when customer responds or case resolves', async () => {
    // Schedule another future follow-up
    const futureJob = await scheduleOrderIssueFollowup({
      tenant_id: testTenant,
      issue_id: createdIssueId,
      job_type: 'awaiting_customer_clarification',
      run_at: new Date(Date.now() + 3600000),
    });

    assert.strictEqual(futureJob.status, 'pending');

    const cancelledCount = await cancelPendingFollowupsForIssue(
      testTenant,
      createdIssueId,
      'Customer replied with receipt'
    );
    assert.strictEqual(cancelledCount >= 1, true);

    const checkRows = await query(
      `SELECT status FROM iao.order_issue_followup_jobs WHERE id = $1;`,
      [futureJob.id]
    );
    assert.strictEqual(checkRows[0].status, 'cancelled');
  });

  test('escalates to owner task when max follow-up retry attempts are reached', async () => {
    // Set issue to awaiting_customer so follow-up processor evaluates it
    await updateOrderIssue(testTenant, createdIssueId, {
      status: 'awaiting_customer',
      responsible_party: 'customer',
    });

    const jobForEscalation = await scheduleOrderIssueFollowup({
      tenant_id: testTenant,
      issue_id: createdIssueId,
      job_type: 'awaiting_customer_clarification',
      run_at: new Date(Date.now() - 5000),
      max_attempts: 1,
    });

    // Artificially simulate 1 prior attempt
    await query(
      `UPDATE iao.order_issue_followup_jobs SET attempt_count = 0, status = 'pending' WHERE id = $1;`,
      [jobForEscalation.id]
    );

    const claimed = await claimDueFollowupJobs(testTenant, 10);
    const targetJob = claimed.find((j) => j.id === jobForEscalation.id);
    assert.strictEqual(Boolean(targetJob), true);

    const outcome = await processClaimedFollowupJob(targetJob, {
      automation_mode: 'auto_routine',
      order_issues_config: {
        followup_interval_hours: 24,
        max_followup_attempts: 1,
        escalate_after_attempts: true,
        auto_close_resolved_days: 7,
      },
    });

    assert.strictEqual(outcome.actionTaken.includes('escalated to owner'), true);

    const issueAfter = await getOrderIssue(testTenant, createdIssueId);
    assert.strictEqual(issueAfter?.status, 'awaiting_owner');
    assert.strictEqual(issueAfter?.responsible_party, 'owner');
  });

  test('respects paused automation mode by delaying follow-up without auto-dispatch', async () => {
    // Set issue to awaiting_customer
    await updateOrderIssue(testTenant, createdIssueId, {
      status: 'awaiting_customer',
      responsible_party: 'customer',
    });

    const pausedJob = await scheduleOrderIssueFollowup({
      tenant_id: testTenant,
      issue_id: createdIssueId,
      job_type: 'awaiting_customer_clarification',
      run_at: new Date(Date.now() - 1000),
      max_attempts: 3,
    });

    const claimed = await claimDueFollowupJobs(testTenant, 10);
    const targetJob = claimed.find((j) => j.id === pausedJob.id);
    assert.strictEqual(Boolean(targetJob), true);

    const outcome = await processClaimedFollowupJob(targetJob, {
      automation_mode: 'paused', // Paused mode
    });

    assert.strictEqual(outcome.actionTaken.includes('paused'), true);
  });

  test('schedules and processes awaiting_owner_review jobs without obsolete cancellation', async () => {
    // Set issue to awaiting_owner
    await updateOrderIssue(testTenant, createdIssueId, {
      status: 'awaiting_owner',
      responsible_party: 'owner',
    });

    const ownerJob = await scheduleOrderIssueFollowup({
      tenant_id: testTenant,
      issue_id: createdIssueId,
      job_type: 'awaiting_owner_review',
      run_at: new Date(Date.now() - 1000), // Due immediately
      max_attempts: 2,
    });

    const claimed = await claimDueFollowupJobs(testTenant, 10);
    const targetJob = claimed.find((j) => j.id === ownerJob.id);
    assert.strictEqual(Boolean(targetJob), true);

    const outcome = await processClaimedFollowupJob(targetJob, {
      automation_mode: 'auto_routine',
      order_issues_config: {
        followup_interval_hours: 24,
        max_followup_attempts: 2,
      },
    });

    assert.strictEqual(outcome.outcome, 'completed');
    assert.strictEqual(outcome.actionTaken.includes('owner review'), true);

    // Verify next attempt was scheduled
    const nextJobs = await query(
      `SELECT * FROM iao.order_issue_followup_jobs
       WHERE tenant_id = $1 AND issue_id = $2 AND status = 'pending' AND followup_type = 'awaiting_owner_review';`,
      [testTenant, createdIssueId]
    );
    assert.strictEqual(nextJobs.length >= 1, true);
  });

  test('selective cancellation cancels customer jobs on customer reply while preserving owner reminder', async () => {
    // Clear any leftover pending jobs for this test
    await query(`UPDATE iao.order_issue_followup_jobs SET status = 'cancelled' WHERE tenant_id = $1 AND issue_id = $2 AND status = 'pending';`, [testTenant, createdIssueId]);

    // Schedule a customer job and an owner job
    const custJob = await scheduleOrderIssueFollowup({
      tenant_id: testTenant,
      issue_id: createdIssueId,
      job_type: 'awaiting_customer_clarification',
      delay_hours: 24,
    });

    const ownerJob = await scheduleOrderIssueFollowup({
      tenant_id: testTenant,
      issue_id: createdIssueId,
      job_type: 'awaiting_owner_review',
      delay_hours: 24,
    });

    // Customer replies: selectively cancel customer clarification only
    const cancelledCount = await cancelPendingFollowupsForIssue(
      testTenant,
      createdIssueId,
      'Customer replied with clarification',
      ['awaiting_customer_clarification', 'awaiting_customer_photos']
    );

    assert.strictEqual(cancelledCount, 1);

    const custJobAfter = await query(
      `SELECT status FROM iao.order_issue_followup_jobs WHERE id = $1;`,
      [custJob.id]
    );
    assert.strictEqual(custJobAfter[0].status, 'cancelled');

    const ownerJobAfter = await query(
      `SELECT status FROM iao.order_issue_followup_jobs WHERE id = $1;`,
      [ownerJob.id]
    );
    assert.strictEqual(ownerJobAfter[0].status, 'pending');
  });

  test('cleanup test tenant records', async () => {
    await query(`DELETE FROM iao.order_issue_events WHERE tenant_id = $1;`, [testTenant]);
    await query(`DELETE FROM iao.order_issue_followup_jobs WHERE tenant_id = $1;`, [testTenant]);
    await query(`DELETE FROM iao.order_issues WHERE tenant_id = $1;`, [testTenant]);
    if (global.__orderIssuesPgPool) {
      await global.__orderIssuesPgPool.end();
    }
  });
});

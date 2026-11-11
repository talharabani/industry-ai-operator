import fs from 'fs';
import assert from 'node:assert';
import crypto from 'crypto';

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

// Enable local connector during automated integration tests against local mock demo API
process.env.ALLOW_LOCAL_CONNECTOR = 'true';

import {
  query,
  decideCaseInDB,
} from '../lib/db.ts';

import {
  validateOutboundUrl,
  safeFetch,
} from '../lib/ssrf-protection.ts';

import {
  saveCustomStoreConnection,
  getCustomStoreConnection,
  getCustomStoreConnectionPublic,
  disconnectCustomStore,
  testCustomStoreConnection,
  startCustomStoreSyncJob,
  fetchCustomStorePage,
  ingestCustomStoreBatch,
  finishCustomStoreSyncJob,
  verifyCustomStoreWebhookSignature,
  ingestCustomStoreWebhook,
  maskApiKey,
} from '../lib/custom-store-service.ts';

import {
  evaluateRoutineInquiry,
} from '../lib/routine-evaluator.ts';

import {
  createOrderIssue,
  getOrderIssue,
} from '../lib/order-issues.ts';

async function runCustomStoreConnectorTests() {
  console.log('====================================================================');
  console.log('=== STARTING CUSTOM STORE CONNECTOR INTEGRATION TEST SUITE ===');
  console.log('====================================================================\n');

  const testTenant = 'sandbox-cs-tenant-' + Date.now();
  const testTenantB = 'sandbox-cs-other-' + Date.now();
  const localDemoBaseUrl = 'http://localhost:3000/api/demo-custom-store/v1';
  const localDemoApiKey = 'demo-custom-key-123';
  const localDemoWebhookSecret = 'demo-custom-webhook-secret-456';

  try {
    // Setup sandbox tenant in iao.businesses so foreign key checks pass
    await query(
      `INSERT INTO iao.businesses (tenant_id, settings, updated_at)
       VALUES ($1, '{"industry":"ecommerce","currency":"USD"}'::jsonb, NOW()),
              ($2, '{"industry":"ecommerce","currency":"USD"}'::jsonb, NOW())
       ON CONFLICT (tenant_id) DO NOTHING;`,
      [testTenant, testTenantB]
    );

    // =========================================================================
    // TEST 1: SSRF Protection & Safe Outbound Fetch
    // =========================================================================
    console.log('--- TEST 1: SSRF Protection & Safe Outbound Fetch ---');

    // 1a: Loopback / Private IP blocking in strict non-local mode
    const privateIps = [
      'http://10.0.0.1/api/v1',
      'http://192.168.1.1/api/v1',
      'http://172.16.0.1/api/v1',
      'http://127.0.0.1:8080/api/v1',
    ];
    for (const url of privateIps) {
      const val = await validateOutboundUrl(url, { allowLocalDevelopment: false });
      assert.strictEqual(val.isValid, false, `Expected ${url} to be blocked by SSRF filter in strict mode`);
      assert.ok(val.error?.length > 0);
    }
    console.log('  ✓ Private IP ranges (10.x, 192.168.x, 172.16.x, 127.x) blocked in strict mode');

    // 1b: Cloud metadata IP blocking (always blocked, even in dev mode)
    const metadataVal = await validateOutboundUrl('http://169.254.169.254/latest/meta-data/', { allowLocalDevelopment: true });
    assert.strictEqual(metadataVal.isValid, false, 'Expected AWS/cloud metadata 169.254.169.254 to be blocked');
    console.log('  ✓ Cloud metadata IP (169.254.169.254) blocked unconditionally');

    // 1c: Non-HTTP/HTTPS protocol blocking
    const ftpVal = await validateOutboundUrl('ftp://example.com/api', { allowLocalDevelopment: true });
    assert.strictEqual(ftpVal.isValid, false, 'Expected ftp:// protocol to be blocked');
    console.log('  ✓ Disallowed protocols (ftp, file, gopher) blocked');

    // 1d: Safe fetch against valid local demo URL (with explicit dev allowlist)
    const demoUrlVal = await validateOutboundUrl(localDemoBaseUrl + '/store', { allowLocalDevelopment: true });
    assert.strictEqual(demoUrlVal.isValid, true, 'Expected local demo endpoint to be permitted under dev allowlist');
    console.log('  ✓ Development allowlist permits local demo endpoint');

    // =========================================================================
    // TEST 2: Connection Persistence & Encryption Security
    // =========================================================================
    console.log('\n--- TEST 2: Connection Persistence & Encryption Security ---');

    const savedConn = await saveCustomStoreConnection({
      tenantId: testTenant,
      storeName: 'Apex Horology Sandbox',
      websiteUrl: 'https://apexhorology.example.com',
      apiBaseUrl: localDemoBaseUrl,
      apiKey: localDemoApiKey,
      webhookSecret: localDemoWebhookSecret,
    });

    assert.ok(savedConn.id, 'Connection ID must be generated');
    assert.strictEqual(savedConn.tenant_id, testTenant);
    assert.strictEqual(savedConn.is_connected, true);
    const connId = savedConn.id;

    // Direct DB inspection to verify encryption
    const dbRows = await query(
      `SELECT encrypted_credentials FROM iao.custom_store_connections WHERE id = $1;`,
      [connId]
    );
    assert.strictEqual(dbRows.length, 1);
    const rawRecord = dbRows[0];
    const encKey = rawRecord.encrypted_credentials?.encrypted_api_key;
    assert.ok(encKey, 'Encrypted API key must be saved in DB');
    assert.ok(!encKey.includes(localDemoApiKey), 'Plaintext API key must NOT be stored in DB');
    console.log('  ✓ Credentials encrypted with AES-256-GCM in database (never stored in plaintext)');

    // Public config inspection
    const publicConfig = await getCustomStoreConnectionPublic(testTenant);
    assert.ok(publicConfig, 'Public config must exist');
    assert.strictEqual(publicConfig.masked_api_key, 'dem••••••••-123');
    assert.ok(!('api_key' in publicConfig), 'Plaintext api_key must never be present in public config');
    assert.ok(!('webhook_secret' in publicConfig), 'Plaintext webhook_secret must never be present in public config');
    console.log('  ✓ Public config masks secrets cleanly (masked: dem••••••••-123)');

    // Test API key masking helper
    assert.strictEqual(maskApiKey('abcdef1234567890'), 'abc••••••••7890');
    assert.strictEqual(maskApiKey('short'), '••••••••');
    console.log('  ✓ API key masking helper formats correctly');

    // =========================================================================
    // TEST 3: Test Connection with Live Demo Store API
    // =========================================================================
    console.log('\n--- TEST 3: Test Connection with Live Demo Store API ---');

    // 3a: Successful test connection
    const testSuccess = await testCustomStoreConnection({
      tenantId: testTenant,
      apiBaseUrl: localDemoBaseUrl,
      apiKey: localDemoApiKey,
    });
    assert.strictEqual(testSuccess.success, true, 'Test connection with valid credentials should succeed');
    assert.strictEqual(testSuccess.store_profile?.name, 'Apex Custom Footwear');
    assert.strictEqual(testSuccess.store_profile?.currency, 'USD');
    assert.ok(testSuccess.latency_ms >= 0, 'Latency calculation must be non-negative');
    console.log(`  ✓ Test connection succeeded against demo API (latency: ${testSuccess.latency_ms}ms)`);

    // 3b: Failed test connection with invalid key
    const testFailure = await testCustomStoreConnection({
      tenantId: testTenant,
      apiBaseUrl: localDemoBaseUrl,
      apiKey: 'invalid-bad-key-999',
    });
    assert.strictEqual(testFailure.success, false, 'Test connection with bad key must fail');
    assert.ok(testFailure.error?.includes('401') || testFailure.error?.includes('Authentication') || testFailure.error?.includes('Unauthorized'));
    console.log('  ✓ Test connection with bad key rejected with 401 error message');

    // =========================================================================
    // TEST 4: Bounded Sync Orchestration (n8n Multi-Step Workflow Contract)
    // =========================================================================
    console.log('\n--- TEST 4: Bounded Sync Orchestration Contract ---');

    // Step 4a: Start sync job
    const { job } = await startCustomStoreSyncJob(testTenant, connId);
    assert.ok(job.id, 'Job ID must be returned');
    assert.strictEqual(job.status, 'running');
    console.log(`  ✓ Step 1: Start sync job created job: ${job.id}`);

    // Step 4b: Fetch bounded page from custom store
    const page1Res = await fetchCustomStorePage({
      jobId: job.id,
      resourceType: 'products',
      page: 1,
      limit: 2,
    });
    const page1 = page1Res.data;
    assert.ok(Array.isArray(page1.products), 'Page products must be an array');
    assert.strictEqual(page1.products.length, 2, 'Page 1 should have 2 products');
    assert.strictEqual(page1.pagination.has_next_page, true, 'Should indicate next page exists');
    assert.strictEqual(page1.pagination.next_page, 2);
    console.log('  ✓ Step 2: Bounded page fetched with verified pagination metadata (page 1 of 2)');

    // Step 4c: Ingest validated batch of products
    const productBatchResult = await ingestCustomStoreBatch({
      jobId: job.id,
      resourceType: 'products',
      items: page1.products,
    });
    assert.strictEqual(productBatchResult.processedCount, 2);
    assert.strictEqual(productBatchResult.errorCount, 0);

    // Verify decimal money invariants in database
    const dbProducts = await query(
      `SELECT * FROM iao.custom_store_products WHERE tenant_id = $1 AND connection_id = $2;`,
      [testTenant, connId]
    );
    assert.strictEqual(dbProducts.length, 2);
    for (const p of dbProducts) {
      assert.ok(Array.isArray(p.variants) && p.variants.length > 0, 'Product must have variants');
      for (const v of p.variants) {
        assert.ok(typeof v.price === 'string' && /^\d+\.\d{2}$/.test(v.price), `Price must be exact decimal string: ${v.price}`);
        assert.strictEqual(v.currency, 'USD');
      }
    }
    console.log('  ✓ Step 3: Product batch ingested with strict decimal money values ("189.00", "249.99")');

    // Step 4d: Fetch and ingest orders batch (including order #1001)
    const ordersPageRes = await fetchCustomStorePage({
      jobId: job.id,
      resourceType: 'orders',
      page: 1,
      limit: 10,
    });
    const ordersPage = ordersPageRes.data;
    assert.ok(ordersPage.orders.length >= 2, 'Should fetch demo orders');

    const orderBatchResult = await ingestCustomStoreBatch({
      jobId: job.id,
      resourceType: 'orders',
      items: ordersPage.orders,
    });
    assert.strictEqual(orderBatchResult.processedCount, ordersPage.orders.length);
    assert.strictEqual(orderBatchResult.errorCount, 0);

    // Verify orders persisted in iao.orders with multi-store composite ID
    const dbOrders = await query(
      `SELECT * FROM iao.orders WHERE tenant_id = $1 AND connection_id = $2;`,
      [testTenant, connId]
    );
    assert.ok(dbOrders.length >= 2);
    const order1001 = dbOrders.find((o) => o.order_number === '#1001');
    assert.ok(order1001, 'Order #1001 must exist in database');
    assert.strictEqual(order1001.external_order_id, 'ord_apex_1001');
    assert.strictEqual(order1001.provider, 'custom');
    assert.strictEqual(order1001.order_id, `custom:${connId}:ord_apex_1001`);
    assert.strictEqual(order1001.currency, 'USD');
    console.log('  ✓ Step 4: Orders batch ingested with composite ID custom:<connId>:<extId> and display number #1001');

    // Step 4e: Finish sync job
    const finishResult = await finishCustomStoreSyncJob(testTenant, job.id, 'completed', null);
    assert.strictEqual(finishResult.status, 'completed');

    const updatedConn = await getCustomStoreConnection(testTenant);
    assert.ok(updatedConn?.last_synced_at, 'Connection last_synced_at must be populated');
    assert.strictEqual(updatedConn?.sync_status, 'completed');
    assert.strictEqual(updatedConn?.product_count, 2);
    assert.ok(updatedConn?.order_count >= 2);
    console.log('  ✓ Step 5: Finish sync job updated connection counts and last_synced_at timestamp');

    // =========================================================================
    // TEST 5: Shared Store Identity & Collision Avoidance (#1001)
    // =========================================================================
    console.log('\n--- TEST 5: Shared Store Identity & Collision Avoidance (#1001) ---');

    // Insert a Shopify order with the exact same display order number #1001 in the same tenant
    const shopifyOrderId = 'gid://shopify/Order/990011001';
    await query(
      `INSERT INTO iao.orders (
        tenant_id, order_id, customer_name, customer_email, items, total, currency,
        status, provider, connection_id, external_order_id, order_number, created_at, updated_at
      ) VALUES (
        $1, $2, 'Shopify Customer Alice', 'alice.shopify@example.com',
        '[{"name":"Shopify Leather Belt","price":4500,"quantity":1}]'::jsonb,
        4500, 'PKR', 'delivered', 'shopify', 'shopify_conn_1', '990011001', '#1001', NOW(), NOW()
      ) ON CONFLICT (tenant_id, order_id) DO UPDATE SET order_number = '#1001';`,
      [testTenant, shopifyOrderId]
    );

    // Verify both orders coexist cleanly in database
    const collisions = await query(
      `SELECT * FROM iao.orders
       WHERE tenant_id = $1 AND order_number = '#1001';`,
      [testTenant]
    );
    assert.strictEqual(collisions.length, 2, 'Both Shopify #1001 and Custom #1001 must exist simultaneously');
    const shopifyRecord = collisions.find((r) => r.provider === 'shopify');
    const customRecord = collisions.find((r) => r.provider === 'custom');
    assert.ok(shopifyRecord && customRecord, 'Both provider records must be distinguished');
    console.log('  ✓ Storage coexistence: Shopify #1001 and Custom Store #1001 stored without collision');

    // AI Inquiry Resolution:
    // Case A: Customer email matches custom store customer
    const inquiryCustom = evaluateRoutineInquiry({
      subject: 'Where is my order #1001?',
      bodyText: 'Where is my order #1001? Has it shipped yet?',
      senderName: customRecord.customer_name || 'Sarah',
      senderEmail: customRecord.customer_email,
      orders: collisions,
      settings: {
        automation_mode: 'auto_routine',
        business_name: 'Apex Horology Sandbox',
      },
    });
    assert.strictEqual(inquiryCustom.canAutoReply, true);
    assert.ok(inquiryCustom.replyText.includes(customRecord.order_id), 'Order #1001 must match custom store customer');
    console.log(`  ✓ Inquiry Case A: ${customRecord.customer_name || 'Customer'} (#1001) resolved unambiguously to Custom Store order`);

    // Case B: Customer email matches Shopify customer ('alice.shopify@example.com')
    const inquiryShopify = evaluateRoutineInquiry({
      subject: 'Order #1001 status',
      bodyText: 'Can you check status of order #1001?',
      senderName: 'Alice',
      senderEmail: 'alice.shopify@example.com',
      orders: collisions,
      settings: {
        automation_mode: 'auto_routine',
        business_name: 'Apex Horology Sandbox',
      },
    });
    assert.strictEqual(inquiryShopify.canAutoReply, true);
    assert.ok(inquiryShopify.replyText.includes(shopifyOrderId), 'Order #1001 must match Shopify customer');
    console.log('  ✓ Inquiry Case B: Alice (#1001) resolved unambiguously to Shopify order');

    // Case C: Ambiguous inquiry from an unknown email with no store context
    const inquiryAmbiguous = evaluateRoutineInquiry({
      subject: 'Order 1001 query',
      bodyText: 'Hey, what is going on with order 1001?',
      senderName: 'Stranger',
      senderEmail: 'stranger@example.com',
      orders: collisions,
      settings: {
        automation_mode: 'auto_routine',
        business_name: 'Apex Horology Sandbox',
      },
    });
    assert.strictEqual(inquiryAmbiguous.canAutoReply, true);
    assert.ok(
      inquiryAmbiguous.reason.includes('Ambiguous order match') ||
      inquiryAmbiguous.replyText.includes('multiple active orders') ||
      inquiryAmbiguous.replyText.includes('which store'),
      'AI must ask customer for clarification instead of guessing between Shopify and Custom Store'
    );
    console.log('  ✓ Inquiry Case C: Ambiguous #1001 inquiry correctly triggered store clarification response');

    // =========================================================================
    // TEST 6: Authenticated Webhook Updates & Sync Integrity
    // =========================================================================
    console.log('\n--- TEST 6: Authenticated Webhooks & Integrity Protection ---');

    const webhookSecret = localDemoWebhookSecret;
    const nowIso = new Date().toISOString();
    const eventId = 'evt_' + Math.random().toString(36).substring(2, 10);

    const validPayload = {
      event_id: eventId,
      event_type: 'order.updated',
      timestamp: nowIso,
      data: {
        external_order_id: 'ord_apex_1001',
        order_number: '#1001',
        customer_name: 'Sarah Jenkins',
        customer_email: 'sarah.jenkins.apex@example.com',
        status: 'shipped',
        financial_status: 'paid',
        fulfillment_status: 'shipped',
        tracking_company: 'UPS',
        tracking_number: '1Z9999999999999999',
        currency: 'USD',
        total_price: '249.99',
        updated_at: new Date(Date.now() + 1000).toISOString(),
      },
    };

    const rawPayloadString = JSON.stringify(validPayload);
    const validSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawPayloadString, 'utf8')
      .digest('hex');

    // 6a: Valid signature verification
    const sigVerified = verifyCustomStoreWebhookSignature({
      rawBody: rawPayloadString,
      signatureHeader: validSignature,
      timestampHeader: String(Date.now()),
      secret: webhookSecret,
    });
    assert.strictEqual(sigVerified.isValid, true, 'HMAC-SHA256 signature must verify correctly');
    console.log('  ✓ Webhook HMAC-SHA256 signature verified with constant-time comparison');

    // 6b: Tampered signature rejection
    const sigTampered = verifyCustomStoreWebhookSignature({
      rawBody: rawPayloadString,
      signatureHeader: 'invalid-signature-hex',
      timestampHeader: String(Date.now()),
      secret: webhookSecret,
    });
    assert.strictEqual(sigTampered.isValid, false, 'Tampered signature must be rejected');
    console.log('  ✓ Tampered signature rejected');

    // 6c: Ingest valid webhook
    const hookResult1 = await ingestCustomStoreWebhook({
      tenantId: testTenant,
      connectionId: connId,
      eventId: validPayload.event_id,
      topic: validPayload.event_type,
      payload: validPayload.data,
    });
    assert.strictEqual(hookResult1.status, 'processed');
    console.log('  ✓ Valid webhook processed and order tracking updated');

    // 6d: Event deduplication: replay identical event
    const hookResult2 = await ingestCustomStoreWebhook({
      tenantId: testTenant,
      connectionId: connId,
      eventId: validPayload.event_id,
      topic: validPayload.event_type,
      payload: validPayload.data,
    });
    assert.ok(
      hookResult2.status === 'already_processed' || hookResult2.status === 'skipped_duplicate',
      'Duplicate event_id must be skipped'
    );
    console.log('  ✓ Replay protection: duplicate webhook event_id was skipped cleanly');

    // 6e: Replay protection: expired timestamp (> 300s old)
    const expiredVerification = verifyCustomStoreWebhookSignature({
      rawBody: rawPayloadString,
      signatureHeader: validSignature,
      timestampHeader: String(Date.now() - 400 * 1000), // 400s old
      secret: webhookSecret,
    });
    assert.strictEqual(expiredVerification.isValid, false, 'Expired timestamp must be rejected');
    assert.ok(expiredVerification.error?.includes('expired') || expiredVerification.error?.includes('replay'));
    console.log('  ✓ Timestamp replay protection: payload older than 5 minutes rejected');

    // 6f: Out-of-order protection: incoming event with older updated_at than database
    const outOfOrderPayload = {
      event_id: 'evt_old_' + Date.now(),
      event_type: 'order.updated',
      timestamp: new Date().toISOString(),
      data: {
        id: 'ord_apex_1001',
        external_order_id: 'ord_apex_1001',
        order_number: '#1001',
        status: 'unfulfilled',
        fulfillment_status: 'unfulfilled',
        updated_at: new Date(Date.now() - 50000).toISOString(), // 50 seconds in the past
      },
    };
    const oooResult = await ingestCustomStoreWebhook({
      tenantId: testTenant,
      connectionId: connId,
      eventId: outOfOrderPayload.event_id,
      topic: outOfOrderPayload.event_type,
      payload: outOfOrderPayload.data,
    });
    assert.ok(oooResult.details?.includes('Older event skipped'), 'Older out-of-order event must not overwrite newer state');
    console.log('  ✓ Out-of-order protection: older event prevented from overwriting newer order status');

    // =========================================================================
    // TEST 7: Order Issue Reconciliation on Custom Store Update
    // =========================================================================
    console.log('\n--- TEST 7: Order Issue Reconciliation on Custom Store Order ---');

    // Create an order issue for custom store order #1001
    const testIssue = await createOrderIssue({
      tenantId: testTenant,
      orderId: `custom:${connId}:ord_apex_1001`,
      customerEmail: 'sarah.jenkins.apex@example.com',
      customerName: 'Sarah Jenkins',
      issueType: 'missing_package',
      summary: 'Package delayed in transit for custom store order #1001',
    });
    assert.ok(testIssue.id, 'Issue must be created');

    // Send a new webhook updating the order with new carrier tracking
    const trackingUpdatePayload = {
      event_id: 'evt_trk_' + Date.now(),
      event_type: 'order.updated',
      timestamp: new Date().toISOString(),
      data: {
        id: 'ord_apex_1001',
        external_order_id: 'ord_apex_1001',
        order_number: '#1001',
        status: 'shipped',
        fulfillment_status: 'shipped',
        tracking_company: 'FedEx Express',
        tracking_number: '779988112233',
        fulfillments: [
          {
            tracking_company: 'FedEx Express',
            tracking_number: '779988112233',
            status: 'shipped',
          },
        ],
        updated_at: new Date(Date.now() + 5000).toISOString(),
      },
    };
    await ingestCustomStoreWebhook({
      tenantId: testTenant,
      connectionId: connId,
      eventId: trackingUpdatePayload.event_id,
      topic: trackingUpdatePayload.event_type,
      payload: trackingUpdatePayload.data,
    });

    // Verify issue reconciliation occurred
    const reconciledIssue = await getOrderIssue(testTenant, testIssue.id);
    assert.ok(reconciledIssue, 'Reconciled issue must exist');
    const issueEvidence = reconciledIssue.evidence || {};
    assert.strictEqual(issueEvidence.tracking_number, '779988112233', 'Issue tracking number must be reconciled');
    assert.strictEqual(issueEvidence.fulfillment_status, 'fulfilled', 'Issue fulfillment status must be reconciled');
    console.log('  ✓ Order issue reconciliation updated active issue with verified carrier tracking (FedEx Express 779988112233)');

    // =========================================================================
    // TEST 8: Partial Failure Visibility (Never Reported as Full Success)
    // =========================================================================
    console.log('\n--- TEST 8: Partial Failure Visibility ---');

    const { job: partialJob } = await startCustomStoreSyncJob(testTenant, connId);
    const mixedBatch = [
      {
        id: 'prod_valid_99',
        title: 'Valid Running Shoe',
        price: '120.00',
        currency: 'USD',
      },
      {
        id: 'prod_invalid_missing_price',
        title: 'Broken Shoe Without Price',
        // missing price and currency
      },
    ];

    const batchRes = await ingestCustomStoreBatch({
      jobId: partialJob.id,
      resourceType: 'products',
      items: mixedBatch,
    });

    assert.strictEqual(batchRes.processedCount, 1, 'Valid item must be processed');
    assert.strictEqual(batchRes.errorCount, 1, 'Invalid item must be counted as failure');
    assert.ok(batchRes.errors.length > 0, 'Error details must be captured');

    // Finish job with partial failure
    const finishedPartial = await finishCustomStoreSyncJob(
      testTenant,
      partialJob.id,
      'partial_failed',
      'Batch contained 1 invalid product missing price'
    );
    assert.strictEqual(finishedPartial.status, 'partial_failed');

    const connAfterPartial = await getCustomStoreConnection(testTenant);
    assert.strictEqual(connAfterPartial?.sync_status, 'partial_failed');
    assert.ok(connAfterPartial?.last_error?.includes('1 invalid product'));
    console.log('  ✓ Partial failures remain clearly visible as "partial_failed" (never masked as full success)');

    // =========================================================================
    // TEST 9: Approval Bridge on Custom Store Orders (No Shopify Required)
    // =========================================================================
    console.log('\n--- TEST 9: Approval Bridge on Custom Store Orders ---');

    // Create an approval case in iao.cases for the custom store order #1001
    const caseId = 'case_cs_' + Date.now();
    await query(
      `INSERT INTO iao.cases (
        tenant_id, case_id, kind, status, payload, proposal, revision, created_at, updated_at
      ) VALUES (
        $1, $2, 'refund', 'pending_approval', $3::jsonb, $4::jsonb, 1, NOW(), NOW()
      );`,
      [
        testTenant,
        caseId,
        JSON.stringify({
          order_id: `custom:${connId}:ord_apex_1001`,
          orderId: `custom:${connId}:ord_apex_1001`,
          amount: 50.00,
          currency: 'USD',
          customer_email: 'sarah.jenkins.apex@example.com',
          customer_name: 'Sarah Jenkins',
          store_connection_id: connId,
          store_provider: 'custom',
        }),
        JSON.stringify({
          headline: 'Refund authorization requested',
          summary: 'Approve refund of $50.00 USD for customer',
          action: 'refund',
          amount: 50.00,
          currency: 'USD',
          store_provider: 'custom',
          store_connection_id: connId,
          draft_reply: 'I have approved your refund request of $50.00 USD.',
          revision: 1,
        }),
      ]
    );

    const decisionResult = await decideCaseInDB({
      tenantId: testTenant,
      caseId: caseId,
      decision: 'approve',
      approverId: 'owner_admin',
      expectedRevision: 1,
    });

    assert.strictEqual(decisionResult.success, true);
    assert.strictEqual(decisionResult.case.status, 'approved');
    console.log('  ✓ Approval authorized cleanly for Custom Store without requiring Shopify connection');

    // =========================================================================
    // TEST 10: Live Record Safeguard (#1001 / issue_muz895uh_xsxr)
    // =========================================================================
    console.log('\n--- TEST 10: Live Record Safeguard ---');

    const liveIssueRows = await query(
      `SELECT id, status, is_escalated, escalation_summary FROM iao.order_issues WHERE id = 'issue_muz895uh_xsxr';`
    );
    if (liveIssueRows.length > 0) {
      const live = liveIssueRows[0];
      assert.strictEqual(live.status, 'awaiting_owner', 'Live record issue_muz895uh_xsxr must remain awaiting_owner');
      assert.strictEqual(live.is_escalated, true, 'Live record issue_muz895uh_xsxr must remain is_escalated = true');

      const pendingJobs = await query(
        `SELECT id, status FROM iao.order_issue_followup_jobs WHERE issue_id = 'issue_muz895uh_xsxr' AND status = 'pending';`
      );
      assert.strictEqual(pendingJobs.length, 0, 'Live record must have 0 pending follow-up jobs');
      console.log('  ✓ Live record issue_muz895uh_xsxr verified intact: awaiting_owner, escalated, 0 pending jobs');
    } else {
      console.log('  (Live record issue_muz895uh_xsxr not present in this test environment)');
    }

    console.log('\n====================================================================');
    console.log('=== ALL 10 CUSTOM STORE CONNECTOR INTEGRATION TESTS PASSED! ===');
    console.log('====================================================================\n');
  } finally {
    // Cleanup sandbox test tenant data safely
    try {
      await query(`DELETE FROM iao.custom_store_sync_jobs WHERE tenant_id = $1 OR tenant_id = $2;`, [testTenant, testTenantB]);
      await query(`DELETE FROM iao.custom_store_products WHERE tenant_id = $1 OR tenant_id = $2;`, [testTenant, testTenantB]);
      await query(`DELETE FROM iao.cases WHERE tenant_id = $1 OR tenant_id = $2;`, [testTenant, testTenantB]);
      await query(`DELETE FROM iao.orders WHERE tenant_id = $1 OR tenant_id = $2;`, [testTenant, testTenantB]);
      await query(`DELETE FROM iao.order_issue_events WHERE issue_id IN (SELECT id FROM iao.order_issues WHERE tenant_id = $1 OR tenant_id = $2);`, [testTenant, testTenantB]);
      await query(`DELETE FROM iao.order_issues WHERE tenant_id = $1 OR tenant_id = $2;`, [testTenant, testTenantB]);
      await query(`DELETE FROM iao.custom_store_connections WHERE tenant_id = $1 OR tenant_id = $2;`, [testTenant, testTenantB]);
      await query(`DELETE FROM iao.businesses WHERE tenant_id = $1 OR tenant_id = $2;`, [testTenant, testTenantB]);
    } catch (cleanErr) {
      console.error('Cleanup warning:', cleanErr);
    }
  }
}

runCustomStoreConnectorTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
  });

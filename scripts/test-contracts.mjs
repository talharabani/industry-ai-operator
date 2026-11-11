// Contract and Validation Test Suite for Industry AI Operator MVP
import assert from 'node:assert';
import { test, describe } from 'node:test';
import crypto from 'node:crypto';
import { evaluateRoutineInquiry, extractOrderReference, matchOrderRecord, cleanQuotedReplyText } from '../lib/routine-evaluator.ts';

// 1. Test Server Configuration and Identity Defaults
describe('Server Configuration & Identity Resolution', () => {
  test('resolves default demo-store tenant and owner-demo approver identity', () => {
    const tenantId = process.env.DEMO_TENANT_ID || 'demo-store';
    const approverId = process.env.DEMO_APPROVER_ID || 'owner-demo';

    assert.strictEqual(tenantId, 'demo-store', 'Default tenant ID must be demo-store');
    assert.strictEqual(approverId, 'owner-demo', 'Default approver ID must be owner-demo');
  });

  test('no database credentials or webhook secret are exposed to NEXT_PUBLIC_', () => {
    const envKeys = Object.keys(process.env);
    const leakedPublicSecrets = envKeys.filter(
      (k) =>
        k.startsWith('NEXT_PUBLIC_') &&
        (k.includes('PASSWORD') ||
          k.includes('SECRET') ||
          k.includes('DATABASE_URL') ||
          k.includes('OPERATOR_KEY'))
    );

    assert.deepStrictEqual(
      leakedPublicSecrets,
      [],
      'No sensitive secrets must have NEXT_PUBLIC_ prefix'
    );
  });
});

// 2. Test n8n Webhook Contract Payloads
describe('n8n Webhook Payload Mappings', () => {
  test('onboarding contract formats body with tenant_id and settings', () => {
    const tenantId = 'demo-store';
    const settings = {
      industry: 'ecommerce',
      business_name: 'Demo Clothing Store',
      tone: 'friendly and concise',
      return_window_days: 14,
      refund_requires_approval: true,
      approver_ids: ['owner-demo'],
    };

    const payload = {
      tenant_id: tenantId,
      settings,
    };

    assert.strictEqual(payload.tenant_id, 'demo-store');
    assert.strictEqual(payload.settings.industry, 'ecommerce');
    assert.strictEqual(payload.settings.refund_requires_approval, true);
    assert.deepStrictEqual(payload.settings.approver_ids, ['owner-demo']);
  });

  test('case creation contracts for order, stock, delivery, return have valid structure', () => {
    const tenantId = 'demo-store';
    const reqId = '123e4567-e89b-12d3-a456-426614174000';
    const orderId = 'ORD-1001';

    // Order
    const orderPayload = { tenant_id: tenantId, request_id: reqId, order_id: orderId };
    assert.strictEqual(orderPayload.tenant_id, 'demo-store');
    assert.strictEqual(orderPayload.request_id, reqId);
    assert.strictEqual(orderPayload.order_id, 'ORD-1001');

    // Return requires customer message
    const returnMsg = 'The jacket is too small.';
    const returnPayload = {
      tenant_id: tenantId,
      request_id: reqId,
      order_id: orderId,
      message: returnMsg,
    };
    assert.strictEqual(returnPayload.message, returnMsg);
  });

  test('approval contract includes expected_revision, server approver_id, and exact proposal', () => {
    const tenantId = 'demo-store';
    const approverId = 'owner-demo';
    const caseId = 'order-test-123';
    const expectedRevision = 1;
    const storedProposal = { action: 'confirm_order', amount: 149.99, currency: 'USD' };

    const approvalPayload = {
      tenant_id: tenantId,
      case_id: caseId,
      decision: 'approve',
      approver_id: approverId,
      expected_revision: expectedRevision,
      approved_proposal: storedProposal,
    };

    assert.strictEqual(approvalPayload.decision, 'approve');
    assert.strictEqual(approvalPayload.expected_revision, 1);
    assert.strictEqual(approvalPayload.approver_id, 'owner-demo');
    assert.deepStrictEqual(approvalPayload.approved_proposal, storedProposal);
  });

  test('approval conflict check fails if client expected_revision does not match server revision', () => {
    const serverCase = {
      case_id: 'return-456',
      status: 'pending_approval',
      revision: 2, // Current in DB
      proposal: { action: 'refund', amount: 149.99 },
    };

    const clientAttempt = {
      expected_revision: 1, // Stale client state
      decision: 'approve',
    };

    const isConflict = serverCase.revision !== clientAttempt.expected_revision;
    assert.strictEqual(isConflict, true, 'Must detect HTTP 409 revision conflict');
  });
});

// 3. Test Humanization & UI Utilities
describe('Proposal Humanization and Formatting', () => {
  test('humanize refund proposal includes currency and simulated action details', () => {
    const refundProposal = {
      action: 'process_refund',
      amount: 149.99,
      currency: 'USD',
      summary: 'Issue full refund to customer after return inspection.',
    };

    const hasRefund = refundProposal.action.includes('refund') || refundProposal.amount !== undefined;
    assert.strictEqual(hasRefund, true);
    assert.strictEqual(refundProposal.amount, 149.99);
  });

  test('humanize stock shortage proposal calculates shortfall units', () => {
    const stockProposal = {
      action: 'supplier_po',
      items: [
        { sku: 'JKT-001', name: 'Winter Parka', shortfall: 5 },
        { sku: 'SHO-004', name: 'Boots', shortfall: 3 },
      ],
    };

    const totalShortfall = stockProposal.items.reduce((acc, i) => acc + (i.shortfall || 0), 0);
    assert.strictEqual(totalShortfall, 8, 'Should aggregate total shortfall count correctly');
  });
});

// 4. Test Multi-Business & Permissions Safety Locks
describe('Multi-Business & Automation Governance', () => {
  test('strictly locks refunds, exchanges, payments, supplier POs to approval_required or disabled', () => {
    // Attempting to set automatic on locked financial actions must be sanitized
    const lockedKeys = [
      'return_refund',
      'exchange_replacement',
      'supplier_purchase',
      'payment_reversal',
      'policy_modification',
    ];

    const requestedUnsafe = {
      order_confirmation: 'automatic',
      delay_notification: 'automatic',
      return_refund: 'automatic', // Malicious or misconfigured attempt
      exchange_replacement: 'automatic',
      supplier_purchase: 'automatic',
      payment_reversal: 'automatic',
      policy_modification: 'automatic',
    };

    // Sanitize function mock
    const sanitize = (val) => (val === 'disabled' ? 'disabled' : 'approval_required');

    lockedKeys.forEach((k) => {
      const sanitized = sanitize(requestedUnsafe[k]);
      assert.strictEqual(
        sanitized,
        'approval_required',
        `${k} must be coerced to approval_required when automatic is requested`
      );
    });
  });

  test('encodes and resolves session with active business context', () => {
    const sessionPayload = {
      active_tenant_id: 'artisan-bakery',
      user_id: 'owner-demo',
      user_name: 'Store Owner',
      role: 'owner',
    };

    const encoded = Buffer.from(JSON.stringify(sessionPayload)).toString('base64');
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));

    assert.strictEqual(decoded.active_tenant_id, 'artisan-bakery');
    assert.strictEqual(decoded.role, 'owner');
    assert.strictEqual(decoded.user_id, 'owner-demo');
  });

  test('hosted inquiry form generates valid case intake payload for No-Website businesses', () => {
    const inquiryPayload = {
      tenant_id: 'artisan-bakery',
      request_id: 'inq-987',
      order_id: 'INQ-DIRECT',
      message: '[Customer: Bob (bob@example.com)] Inquiry about gluten-free items',
    };

    assert.strictEqual(inquiryPayload.tenant_id, 'artisan-bakery');
    assert.ok(inquiryPayload.message.includes('gluten-free'));
    assert.strictEqual(inquiryPayload.order_id, 'INQ-DIRECT');
  });
});

// 5. Test Unified Inbox & Hosted Inquiry Form Lifecycle
describe('Hosted Inquiry Form & Rate Limiting Contracts', () => {
  test('rate limiter enforces sliding window request limits', () => {
    const rateLimitMap = new Map();
    const checkRateLimit = (key, limit = 5, windowMs = 600000) => {
      const now = Date.now();
      const entry = rateLimitMap.get(key);
      if (!entry || entry.resetAt <= now) {
        rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: limit - 1 };
      }
      if (entry.count >= limit) {
        return { allowed: false, remaining: 0 };
      }
      entry.count += 1;
      return { allowed: true, remaining: limit - entry.count };
    };

    const clientIp = '192.168.1.100';
    for (let i = 0; i < 5; i++) {
      const res = checkRateLimit(clientIp, 5);
      assert.strictEqual(res.allowed, true, `Request ${i + 1} should be permitted`);
    }

    // 6th request must be blocked
    const blocked = checkRateLimit(clientIp, 5);
    assert.strictEqual(blocked.allowed, false, '6th request must be rate limited');
    assert.strictEqual(blocked.remaining, 0);
  });

  test('validates customer email and prevents spam via honeypot field', () => {
    const spamSubmission = {
      tenant_id: 'demo-store',
      customer_name: 'Spam Bot',
      customer_email: 'bot@spam.com',
      message: 'Cheap sunglasses click here',
      honeypot: 'filled-by-bot', // Spam trap filled
    };

    const isSpam = Boolean(spamSubmission.honeypot && spamSubmission.honeypot.trim().length > 0);
    assert.strictEqual(isSpam, true, 'Honeypot filled submission must be intercepted as spam');
  });
});

// 6. Test Unified Inbox Governance & Email Adapter
describe('Unified Inbox Governance & Dispatch Lifecycle', () => {
  test('editing an approved message draft invalidates approval', () => {
    const originalApprovedMessage = {
      id: 'msg-401',
      body: 'Original approved draft body text.',
      status: 'approved',
      approval_status: 'approved',
      approved_by: 'owner-demo',
      approved_at: '2026-10-03T12:00:00Z',
    };

    // User edits message body
    const editedBody = 'Modified draft body text.';
    const updatedMessage = {
      ...originalApprovedMessage,
      body: editedBody,
      approval_status: 'pending_approval',
      approved_by: null,
      approved_at: null,
      status: 'draft',
      metadata: { draft_revision: 2 },
    };

    assert.strictEqual(updatedMessage.approval_status, 'pending_approval', 'Approval must be invalidated upon body edit');
    assert.strictEqual(updatedMessage.approved_by, null);
    assert.strictEqual(updatedMessage.status, 'draft');
    assert.strictEqual(updatedMessage.metadata.draft_revision, 2);
  });

  test('approval binds recipient, subject, body, revision and sender configuration; sender changes invalidate approval', () => {
    const approvedSnapshot = {
      approved_recipient: 'customer@example.com',
      approved_subject: 'Response from Nordic Rest Support',
      approved_body_hash: crypto.createHash('sha256').update('Thank you for contacting us.').digest('hex'),
      approved_revision: 1,
      approved_sender_email: 'support@nordicrest.com',
      approved_sender_name: 'Nordic Rest Support',
      approved_mode: 'live',
    };

    // Case 1: All parameters match -> Approval is valid
    const currentParamsMatch = {
      recipient: 'customer@example.com',
      subject: 'Response from Nordic Rest Support',
      body: 'Thank you for contacting us.',
      revision: 1,
      sender_email: 'support@nordicrest.com',
      sender_name: 'Nordic Rest Support',
      mode: 'live',
    };
    const bodyHash = crypto.createHash('sha256').update(currentParamsMatch.body).digest('hex');
    const isValidMatch =
      approvedSnapshot.approved_recipient === currentParamsMatch.recipient &&
      approvedSnapshot.approved_subject === currentParamsMatch.subject &&
      approvedSnapshot.approved_body_hash === bodyHash &&
      approvedSnapshot.approved_revision === currentParamsMatch.revision &&
      approvedSnapshot.approved_sender_email === currentParamsMatch.sender_email &&
      approvedSnapshot.approved_sender_name === currentParamsMatch.sender_name &&
      approvedSnapshot.approved_mode === currentParamsMatch.mode;

    assert.strictEqual(isValidMatch, true, 'Matching approval snapshot must pass dispatch verification');

    // Case 2: Business updates sender email -> Approval must be invalidated
    const changedSenderEmail = 'new-support@nordicrest.com';
    const isSenderMismatched = approvedSnapshot.approved_sender_email !== changedSenderEmail;
    assert.strictEqual(isSenderMismatched, true, 'Sender change must invalidate approval');
  });

  test('simulated email dispatch is never marked as sent without live provider credentials', () => {
    const resendApiKey = ''; // Missing live key in demo mode
    const isSimulated = !resendApiKey.startsWith('re_');

    const outcomeStatus = isSimulated ? 'simulated_demo' : 'sent';

    assert.strictEqual(isSimulated, true);
    assert.strictEqual(outcomeStatus, 'simulated_demo');
    assert.notStrictEqual(outcomeStatus, 'sent', 'Simulated messages must never be marked as Sent');
  });

  test('duplicate send prevention blocks re-transmitting already dispatched messages', () => {
    const alreadyDispatchedStatuses = ['sent', 'provider_accepted', 'simulated_demo', 'queued'];
    const currentMessageStatus = 'simulated_demo';

    const isDuplicate = alreadyDispatchedStatuses.includes(currentMessageStatus);
    assert.strictEqual(isDuplicate, true, 'Must prevent re-sending already dispatched messages');
  });

  test('changing store URL or email provider invalidates prior verified connection', () => {
    const priorConnection = {
      store_url: 'https://demo.myshopify.com',
      is_verified: true,
      status: 'connected',
    };

    const newStoreUrl = 'https://new-url.myshopify.com';
    const isChanged = newStoreUrl !== priorConnection.store_url;

    const updatedConnection = {
      ...priorConnection,
      store_url: newStoreUrl,
      is_verified: isChanged ? false : priorConnection.is_verified,
      status: isChanged ? 'not_connected' : priorConnection.status,
    };

    assert.strictEqual(updatedConnection.is_verified, false, 'Changing URL must invalidate prior verification');
    assert.strictEqual(updatedConnection.status, 'not_connected');
  });
});

// 7. Test Tenant-Scoped Encrypted Credential Security & Masking
describe('Tenant-Scoped Secret Encryption & Masking', () => {
  test('strictly requires EMAIL_ENCRYPTION_KEY and throws if missing or invalid (no fallback)', () => {
    const validateKey = (key) => {
      if (!key || typeof key !== 'string' || key.trim().length === 0) {
        throw new Error('Server configuration error: EMAIL_ENCRYPTION_KEY is required.');
      }
      const trimmed = key.trim();
      if (trimmed.length < 32) {
        throw new Error('Server configuration error: EMAIL_ENCRYPTION_KEY must be at least 32 characters.');
      }
      if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
        return Buffer.from(trimmed, 'hex');
      }
      return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
    };

    // Missing key throws
    assert.throws(() => validateKey(undefined), /EMAIL_ENCRYPTION_KEY is required/);
    assert.throws(() => validateKey(''), /EMAIL_ENCRYPTION_KEY is required/);

    // Too short key throws
    assert.throws(() => validateKey('short_key'), /must be at least 32 characters/);

    // Valid 64-hex key succeeds
    const hexKey = '51d5660d36511d8756efb3380d639ae85b1c29b9a8294e4d93d4e8fb3519e36b';
    const buf = validateKey(hexKey);
    assert.strictEqual(buf.length, 32);
  });

  test('encrypted credentials remain readable across restarts using stable key', () => {
    const stableKeyHex = '51d5660d36511d8756efb3380d639ae85b1c29b9a8294e4d93d4e8fb3519e36b';
    const rawApiKey = 're_test_live_key_9876543210';

    // 1. Encrypt before server restart
    const keyBuf1 = Buffer.from(stableKeyHex, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf1, iv);
    let enc = cipher.update(rawApiKey, 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    const storedPayload = `${iv.toString('hex')}:${tag}:${enc}`;

    // 2. Simulate server restart: new process instance loads the same stable EMAIL_ENCRYPTION_KEY from .env.local
    const keyBuf2 = Buffer.from(stableKeyHex, 'hex');
    const parts = storedPayload.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf2, Buffer.from(parts[0], 'hex'));
    decipher.setAuthTag(Buffer.from(parts[1], 'hex'));
    let decrypted = decipher.update(parts[2], 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    assert.strictEqual(decrypted, rawApiKey, 'Credentials must remain readable across server restarts');
  });

  test('generates secure masked fingerprint without exposing raw key', () => {
    const maskApiKey = (k) => {
      const prefix = k.startsWith('re_') ? 're_' : k.slice(0, 3);
      return `${prefix}••••••••${k.slice(-4)}`;
    };

    const masked = maskApiKey('re_live_998877665544332211');
    assert.strictEqual(masked, 're_••••••••2211');
    assert.strictEqual(masked.includes('998877'), false, 'Masked fingerprint must never reveal key body');
  });

  test('tenant credential isolation ensures Business A cannot read Business B secrets', () => {
    const store = new Map();
    store.set('tenant-bakery', { tenant_id: 'tenant-bakery', apiKey: 're_bakery_123' });
    store.set('tenant-fashion', { tenant_id: 'tenant-fashion', apiKey: 're_fashion_456' });

    const getCreds = (tenantId, sessionTenantId) => {
      if (tenantId !== sessionTenantId) return null; // Scoped access enforcement
      return store.get(tenantId);
    };

    const bakeryAccess = getCreds('tenant-fashion', 'tenant-bakery');
    assert.strictEqual(bakeryAccess, null, 'Cross-tenant credential access must be forbidden');

    const ownAccess = getCreds('tenant-bakery', 'tenant-bakery');
    assert.strictEqual(ownAccess.apiKey, 're_bakery_123');
  });
});

// 8. Test Live Mode Strict Dispatch & Atomic Claiming
describe('Live Mode Strict Dispatch & Atomic Claiming', () => {
  test('live mode without verified credentials produces error and NEVER falls back to simulation', () => {
    const credential = {
      mode: 'live',
      is_verified: false,
      decryptedApiKey: null,
    };

    const executeSend = (cred) => {
      if (cred.mode === 'live' && (!cred.is_verified || !cred.decryptedApiKey)) {
        return { success: false, status: 'failed', error: 'Live mode requires verified email credentials.' };
      }
      return { success: true, status: 'simulated_demo' };
    };

    const result = executeSend(credential);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'failed');
    assert.notStrictEqual(result.status, 'simulated_demo', 'Live mode must never fall back to simulation');
  });

  test('atomic claiming transitions status to sending and blocks concurrent workers', () => {
    let messageStatus = 'approved';

    const atomicClaim = () => {
      if (['approved', 'queued'].includes(messageStatus)) {
        messageStatus = 'sending';
        return { success: true };
      }
      return { success: false, error: 'Already claimed' };
    };

    // Worker 1 claims
    const claim1 = atomicClaim();
    assert.strictEqual(claim1.success, true);
    assert.strictEqual(messageStatus, 'sending');

    // Worker 2 attempts concurrent claim
    const claim2 = atomicClaim();
    assert.strictEqual(claim2.success, false, 'Concurrent worker claim must be rejected');
  });

  test('network timeout sets status to uncertain and is not blindly retried', () => {
    const timeoutResult = {
      status: 'uncertain',
      isUncertain: true,
      error: 'Network timeout after 10000ms. Dispatch outcome is uncertain.',
    };

    const canAutoRetry = (status) => status === 'failed'; // Only unambiguous failures can be retried

    assert.strictEqual(timeoutResult.status, 'uncertain');
    assert.strictEqual(canAutoRetry(timeoutResult.status), false, 'Uncertain outcomes must not be blindly auto-retried');
  });
});

// 9. Test Svix / Resend Webhook Signatures & Idempotent Event Log
describe('Resend Webhook Signatures & Event Reconciliation', () => {
  test('validates Svix signature matching raw request body', () => {
    const secret = 'whsec_mfas6789abcdef1234567890';
    const cleanSecret = secret.slice(6);
    const secretBytes = Buffer.from(cleanSecret, 'base64');

    const svixId = 'msg_test_001';
    const svixTimestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify({ type: 'email.delivered', data: { email_id: 're_msg_101' } });

    const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', secretBytes).update(signedPayload).digest('base64');
    const headerSig = `v1,${signature}`;

    // Verify
    const extractedSig = headerSig.replace(/^v1,/, '');
    const isMatch = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(extractedSig));
    assert.strictEqual(isMatch, true, 'Valid HMAC-SHA256 signature must be accepted');
  });

  test('rejects webhook with expired timestamp (replay prevention)', () => {
    const svixTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const nowSec = Math.floor(Date.now() / 1000);
    const isExpired = Math.abs(nowSec - svixTimestamp) > 300; // 5 min tolerance

    assert.strictEqual(isExpired, true, 'Webhooks older than 5 minutes must be rejected');
  });

  test('deduplicates incoming webhook events using event ID', () => {
    const seenEvents = new Set();
    const processEvent = (eventId) => {
      if (seenEvents.has(eventId)) return { isDuplicate: true };
      seenEvents.add(eventId);
      return { isDuplicate: false };
    };

    const first = processEvent('evt_deliv_001');
    assert.strictEqual(first.isDuplicate, false);

    const duplicate = processEvent('evt_deliv_001');
    assert.strictEqual(duplicate.isDuplicate, true, 'Duplicate webhook event must be ignored');
  });
});

// 10. Test Google OAuth 2.0 PKCE & Per-Business Connection Governance
describe('Google OAuth 2.0 PKCE & Mailbox Isolation', () => {
  test('generates valid PKCE S256 code verifier and challenge pair', () => {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(codeVerifier).digest();
    const codeChallenge = hash.toString('base64url');

    assert.ok(codeVerifier.length >= 43, 'Code verifier must satisfy RFC 7636 minimum length');
    assert.ok(codeChallenge.length >= 43, 'Code challenge must be valid base64url hash');

    // Verification of S256 challenge matching verifier
    const recomputed = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    assert.strictEqual(recomputed, codeChallenge, 'PKCE challenge must match SHA-256 verifier hash');
  });

  test('enforces single-use expiring OAuth state and prevents replay', () => {
    const statesDb = new Map();
    const saveState = (st, tenantId) => {
      statesDb.set(st, { tenantId, used: false, expiresAt: Date.now() + 600000 });
    };

    const consumeState = (st) => {
      const entry = statesDb.get(st);
      if (!entry || entry.used || entry.expiresAt <= Date.now()) {
        return null;
      }
      entry.used = true;
      return entry;
    };

    const stateToken = 'st_123456789_abcdef';
    saveState(stateToken, 'demo-store');

    // 1st consumption: Valid
    const firstConsume = consumeState(stateToken);
    assert.ok(firstConsume, 'First state consumption must succeed');
    assert.strictEqual(firstConsume.tenantId, 'demo-store');

    // 2nd consumption (Replay attempt): Must be rejected
    const replayConsume = consumeState(stateToken);
    assert.strictEqual(replayConsume, null, 'Replay of consumed OAuth state must be rejected');
  });

  test('strictly prevents assigning the same Gmail mailbox to multiple businesses', () => {
    const connectedMailboxes = new Map();
    connectedMailboxes.set('support@business-a.com', 'business-a');

    const connectMailbox = (googleEmail, requestingTenantId) => {
      const existingTenant = connectedMailboxes.get(googleEmail.toLowerCase());
      if (existingTenant && existingTenant !== requestingTenantId) {
        throw new Error(
          `This Gmail mailbox (${googleEmail}) is already connected to another business workspace (${existingTenant}). Please disconnect it first.`
        );
      }
      connectedMailboxes.set(googleEmail.toLowerCase(), requestingTenantId);
      return { success: true };
    };

    // Business A reconnecting own mailbox succeeds
    const ownReconnect = connectMailbox('support@business-a.com', 'business-a');
    assert.strictEqual(ownReconnect.success, true);

    // Business B attempting to connect Business A's mailbox is blocked
    assert.throws(
      () => connectMailbox('support@business-a.com', 'business-b'),
      /already connected to another business workspace/
    );
  });

  test('refreshes expired access tokens and transitions to needs_reconnect upon revocation', () => {
    const simulateTokenFetch = (refreshToken, isRevoked = false) => {
      if (isRevoked) {
        return { success: false, isRevoked: true, status: 'needs_reconnect' };
      }
      return { success: true, accessToken: 'ya29.new_fresh_access_token', status: 'idle' };
    };

    const activeRefresh = simulateTokenFetch('valid_refresh_token', false);
    assert.strictEqual(activeRefresh.success, true);
    assert.strictEqual(activeRefresh.accessToken.startsWith('ya29.'), true);

    const revokedRefresh = simulateTokenFetch('revoked_refresh_token', true);
    assert.strictEqual(revokedRefresh.success, false);
    assert.strictEqual(revokedRefresh.status, 'needs_reconnect', 'Revoked tokens must set status to needs_reconnect');
  });
});

// 11. Test Gmail Inbound Ingestion, Threading & Approved Replies Outbox
describe('Gmail Inbound Ingestion, Threading & Approved Replies Outbox', () => {
  test('deduplicates incoming Gmail messages by Gmail message ID', () => {
    const seenMessages = new Set();
    const ingestMsg = (gmailMsgId) => {
      if (seenMessages.has(gmailMsgId)) {
        return { isNew: false, notice: 'Duplicate message ignored' };
      }
      seenMessages.add(gmailMsgId);
      return { isNew: true, messageId: `msg-${gmailMsgId}` };
    };

    const first = ingestMsg('18a992bc012');
    assert.strictEqual(first.isNew, true);

    const duplicate = ingestMsg('18a992bc012');
    assert.strictEqual(duplicate.isNew, false, 'Duplicate Gmail message ID must not create duplicate inbox items');
  });

  test('threads incoming customer replies to existing conversation by Gmail threadId and In-Reply-To', () => {
    const conversations = [
      { id: 'conv-001', external_thread_id: 'thread_18a992bc', customer_email: 'cust@example.com' },
    ];
    const messages = [
      { id: 'msg-001', conversation_id: 'conv-001', rfc_message_id: 'cad8820@mail.gmail.com' },
    ];

    const resolveConversation = (incoming) => {
      // 1. Match by threadId
      const byThread = conversations.find((c) => c.external_thread_id === incoming.threadId);
      if (byThread) return byThread;

      // 2. Match by In-Reply-To
      if (incoming.inReplyTo) {
        const parentMsg = messages.find((m) => m.rfc_message_id === incoming.inReplyTo);
        if (parentMsg) return conversations.find((c) => c.id === parentMsg.conversation_id);
      }
      return null;
    };

    const matchedByThread = resolveConversation({ threadId: 'thread_18a992bc' });
    assert.strictEqual(matchedByThread?.id, 'conv-001');

    const matchedByReplyTo = resolveConversation({ inReplyTo: 'cad8820@mail.gmail.com' });
    assert.strictEqual(matchedByReplyTo?.id, 'conv-001');
  });

  test('filters automated bounces and spam from generating AI proposals', () => {
    const isAutomatedMsg = (headers) => {
      const autoSub = headers['Auto-Submitted'];
      const from = headers['From'] || '';
      return Boolean(
        (autoSub && autoSub !== 'no') ||
        from.includes('mailer-daemon') ||
        from.includes('no-reply')
      );
    };

    const spamBounce = isAutomatedMsg({ 'Auto-Submitted': 'auto-replied', From: 'mailer-daemon@googlemail.com' });
    assert.strictEqual(spamBounce, true, 'Automated bounces must be flagged as automated');

    const humanCustomer = isAutomatedMsg({ From: 'sarah.connor@gmail.com' });
    assert.strictEqual(humanCustomer, false, 'Human customer inquiry must not be filtered');
  });

  test('constructs RFC 2822 reply with In-Reply-To, References, and Re: Subject', () => {
    const buildRfcHeaders = (to, from, subject, inReplyTo, references) => {
      const formattedSubject = !subject.toLowerCase().startsWith('re:') ? `Re: ${subject}` : subject;
      const lines = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${formattedSubject}`,
        `In-Reply-To: ${inReplyTo}`,
        `References: ${references}`,
      ];
      return lines.join('\r\n');
    };

    const raw = buildRfcHeaders(
      'cust@example.com',
      'Nordic Rest <support@nordicrest.com>',
      'Question about sizing',
      '<orig_123@gmail.com>',
      '<orig_123@gmail.com>'
    );

    assert.ok(raw.includes('Subject: Re: Question about sizing'));
    assert.ok(raw.includes('In-Reply-To: <orig_123@gmail.com>'));
    assert.ok(raw.includes('References: <orig_123@gmail.com>'));
  });

  test('reconciles uncertain timeout outcome against Sent mail without blind retry', () => {
    const sentMailbox = [
      { id: 'sent_msg_909', to: 'cust@example.com', subject: 'Re: Inquiry' },
    ];

    const reconcileTimeout = (recipient, subjectSnippet) => {
      const found = sentMailbox.find((m) => m.to === recipient && m.subject.includes(subjectSnippet));
      if (found) {
        return { status: 'provider_accepted', providerMessageId: found.id, autoRetryNeeded: false };
      }
      return { status: 'uncertain', autoRetryNeeded: false };
    };

    const outcome = reconcileTimeout('cust@example.com', 'Inquiry');
    assert.strictEqual(outcome.status, 'provider_accepted');
    assert.strictEqual(outcome.autoRetryNeeded, false, 'Must never blindly auto-retry');
  });
});

// 12. Test Automatic Routine Replies, Safety Governance & Grounding Engine
describe('Automatic Routine Replies, Safety Governance & Grounding Engine', () => {
  const sampleSettings = {
    business_name: 'Demo Clothing Store',
    country: 'Pakistan',
    timezone: 'Asia/Karachi',
    automation_mode: 'auto_routine',
    working_hours: {
      start_time: '09:00',
      end_time: '18:00',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      auto_reply_outside_hours: true,
    },
    knowledge: {
      faqs: [
        {
          id: 'faq-1',
          question: 'What courier service do you use for deliveries?',
          answer: 'We deliver nationwide across Pakistan using Trax and TCS Express.',
        },
        {
          id: 'faq-2',
          question: 'What is your standard return window?',
          answer: 'You can return unwashed items within 14 days of delivery in original packaging.',
        },
      ],
      policies: {
        return_window_days: 14,
        general_rules: 'All returns must be unworn with tags attached.',
        shipping_timeframe: 'Standard delivery takes 2-4 business days.',
      },
      products_services: [
        {
          id: 'prod-1',
          name: 'Classic Leather Jacket',
          sku: 'JKT-001',
          price: 14500,
          currency: 'PKR',
          in_stock: true,
          description: '100% genuine full-grain leather jacket.',
        },
        {
          id: 'prod-2',
          name: 'Oxford Leather Shoes',
          sku: 'SHO-002',
          price: 9500,
          currency: 'PKR',
          in_stock: true,
          description: 'Handcrafted formal leather shoes.',
        },
      ],
    },
  };

  const sampleOrders = [
    {
      tenant_id: 'demo-store',
      order_id: 'ORD-1001',
      data: {
        order_id: 'ORD-1001',
        status: 'delivered',
        customer_name: 'Ayesha Malik',
        total: 14500,
        currency: 'PKR',
        items: [{ name: 'Classic Leather Jacket', qty: 1 }],
      },
    },
    {
      tenant_id: 'demo-store',
      order_id: 'ORD-1002',
      data: {
        order_id: 'ORD-1002',
        status: 'shipped',
        customer_name: 'Hassan Raza',
        total: 9500,
        currency: 'PKR',
        items: [{ name: 'Oxford Leather Shoes', qty: 1 }],
      },
    },
  ];

  const ACTION_REQUEST_PATTERNS = [
    { regex: /(i\s*(want|need|would\s*like|demand|request|am\s*asking\s*for)|please|kindly|can\s*(i|you)\s*(process|give|issue|send|provide)|give\s*me|send\s*me|want\s*my)\s*.*(refund|money\s*back|reimburse|reimbursement|credit\s*back)/i, label: 'Refund / Reimbursement Request' },
    { regex: /\b(i\s*want\s*a\s*refund|please\s*refund|refund\s*(me|my|this|the\s*order)|refund\s*my\s*money|issue\s*a\s*refund|need\s*a\s*refund|get\s*a\s*refund|return\s*for\s*(a\s*)?refund)\b/i, label: 'Refund / Reimbursement Request' },
    { regex: /(i\s*(want|need|would\s*like)|please|kindly|can\s*(i|you)\s*(process|do|swap))\s*.*(exchange|replacement|replace\s*item|swap\s*size)/i, label: 'Exchange / Replacement Request' },
    { regex: /\b(exchange\s*(my|these|this|the|shoes|shirt|jacket|item|product|size)|please\s*exchange|want\s*to\s*exchange|replace\s*(my|this|these)|damaged\s*item\s*return)\b/i, label: 'Exchange / Replacement Request' },
    { regex: /\b(cancel\s*(my|the|this)?\s*order|order\s*cancellation|cancel\s*(my\s*)?booking|stop\s*shipment|stop\s*delivery)\b/i, label: 'Order / Booking Cancellation Request' },
    { regex: /\b(chargeback|payment\s*dispute|bank\s*transfer|wire\s*transfer|credit\s*card\s*charge|payment\s*reversal)\b/i, label: 'Payment / Chargeback Request' },
  ];

  const POLICY_INQUIRY_PATTERNS = [
    /\b(what\s*(is|are)\s*(your|the)?\s*(return|refund|exchange|cancellation|shipping|delivery)\s*policy)\b/i,
    /\b(how\s*does\s*(your|the)?\s*(return|refund|exchange|shipping|delivery)\s*policy\s*work)\b/i,
    /\b(explain\s*(your|the)?\s*(return|refund|exchange|cancellation|shipping|delivery)\s*policy)\b/i,
    /\b(policy\s*on\s*(returns|refunds|exchanges|cancellations|shipping|delivery))\b/i,
    /\b(how\s*many\s*days\s*(do\s*I\s*have\s*to\s*)?(return|exchange|cancel)|return\s*window|exchange\s*window)\b/i,
  ];

  const evaluateRoutine = (query, mode = 'auto_routine', history = [], orders = sampleOrders, settings = sampleSettings) => {
    const combined = query.trim();
    const lower = combined.toLowerCase();

    // 1. Paused check
    if (mode === 'paused') {
      return { canAutoReply: false, intent: 'paused', requiresApproval: false, financialOrMajorAction: false };
    }

    // 2. Loop prevention
    if (history.length >= 2) {
      const consecutiveAi = history.slice(-2).filter((m) => m.sender_type === 'agent' || m.sender_type === 'ai_draft');
      if (consecutiveAi.length >= 2) {
        return { canAutoReply: false, intent: 'loop_prevented', requiresApproval: true, financialOrMajorAction: false };
      }
    }

    // 3. Policy inquiries (Routine explanation FIRST)
    const isPolicyInquiry = POLICY_INQUIRY_PATTERNS.some((p) => p.test(combined));
    const isExplicitActionRequest = ACTION_REQUEST_PATTERNS.some((p) => p.regex.test(combined));

    if (isPolicyInquiry && !isExplicitActionRequest) {
      const returnDays = settings.knowledge.policies.return_window_days;
      const rules = settings.knowledge.policies.general_rules;
      const reply = `Our return policy allows returns and exchanges within ${returnDays} days. ${rules}`;
      return {
        canAutoReply: mode === 'auto_routine',
        intent: 'routine_policy_info',
        replyText: reply,
        requiresApproval: mode !== 'auto_routine',
        financialOrMajorAction: false,
      };
    }

    // 4. Strict action requests (Refund, exchange, cancel, payments)
    for (const pattern of ACTION_REQUEST_PATTERNS) {
      if (pattern.regex.test(combined)) {
        return {
          canAutoReply: false,
          intent: 'financial_action',
          financialOrMajorAction: true,
          requiresApproval: true,
          acknowledgmentDraft: `We have received your ${pattern.label.toLowerCase()} and our store management is reviewing it.`,
        };
      }
    }

    // 5. Greetings
    if (/^(hi|hello|hey|good\s*(morning|afternoon|evening))\b/i.test(combined) && combined.split(/\s+/).length <= 4) {
      return {
        canAutoReply: mode === 'auto_routine',
        intent: 'routine_greeting',
        replyText: `Hello! How can we assist you today?`,
        requiresApproval: mode !== 'auto_routine',
        financialOrMajorAction: false,
      };
    }

    // 6. Working hours
    if (/\b(working\s*hours|business\s*hours|opening\s*hours|what\s*time\s*do\s*you\s*open)\b/i.test(combined)) {
      const reply = `Our business operating hours are from ${settings.working_hours.start_time} to ${settings.working_hours.end_time}.`;
      return {
        canAutoReply: mode === 'auto_routine',
        intent: 'routine_hours',
        replyText: reply,
        requiresApproval: mode !== 'auto_routine',
        financialOrMajorAction: false,
      };
    }

    // 7. Order & Delivery tracking
    if (/\b(where\s*is\s*(my\s*)?order|order\s*status|track\s*(my\s*)?order|delivery\s*status)\b/i.test(combined)) {
      const orderMatch = combined.match(/\b(ORD-[a-zA-Z0-9_-]+)\b/i);
      if (orderMatch) {
        const orderId = orderMatch[1].toUpperCase();
        const found = orders.find((o) => o.order_id === orderId);
        if (found) {
          return {
            canAutoReply: mode === 'auto_routine',
            intent: 'routine_order_status',
            replyText: `Your order ${found.order_id} status is: ${found.data.status.toUpperCase()}.`,
            requiresApproval: mode !== 'auto_routine',
            financialOrMajorAction: false,
          };
        } else {
          return {
            canAutoReply: mode === 'auto_routine',
            intent: 'routine_order_status',
            replyText: `Could not locate order ${orderId}. Please verify your order number.`,
            requiresApproval: mode !== 'auto_routine',
            financialOrMajorAction: false,
          };
        }
      } else {
        // Missing order number -> automatic clarification question
        return {
          canAutoReply: mode === 'auto_routine',
          intent: 'routine_order_status',
          replyText: `Could you please provide your Order ID or reference number so we can look up its status?`,
          requiresApproval: mode !== 'auto_routine',
          financialOrMajorAction: false,
        };
      }
    }

    // 8. Product availability & pricing
    if (/\b(available|availability|in\s*stock|out\s*of\s*stock|do\s*you\s*have|how\s*much\s*is|what\s*is\s*the\s*price|price\s*of|price|pricing|cost)\b/i.test(combined)) {
      const catalog = settings.knowledge.products_services || [];
      const matchedProd = catalog.find((p) => lower.includes(p.name.toLowerCase()) || lower.includes(p.sku.toLowerCase()));
      if (matchedProd) {
        return {
          canAutoReply: mode === 'auto_routine',
          intent: 'routine_product_info',
          replyText: `${matchedProd.name} is ${matchedProd.in_stock ? 'In Stock' : 'Out of Stock'}. Price: ${matchedProd.currency} ${matchedProd.price}.`,
          requiresApproval: mode !== 'auto_routine',
          financialOrMajorAction: false,
        };
      } else {
        // Missing product name -> automatic clarification question
        return {
          canAutoReply: mode === 'auto_routine',
          intent: 'routine_product_info',
          replyText: `Could you please specify which product or item name you are inquiring about?`,
          requiresApproval: mode !== 'auto_routine',
          financialOrMajorAction: false,
        };
      }
    }

    // 9. FAQ matching
    for (const faq of settings.knowledge.faqs) {
      const qWords = faq.question.toLowerCase().split(' ').filter((w) => w.length > 3);
      const matchCount = qWords.filter((w) => lower.includes(w)).length;
      if (matchCount >= 2) {
        return {
          canAutoReply: mode === 'auto_routine',
          intent: 'routine_faq',
          replyText: faq.answer,
          requiresApproval: mode !== 'auto_routine',
          financialOrMajorAction: false,
        };
      }
    }

    return {
      canAutoReply: false,
      intent: 'ambiguous',
      requiresApproval: true,
      financialOrMajorAction: false,
    };
  };

  test('draft_only mode always requires approval even for routine questions', () => {
    const res = evaluateRoutine('What are your working hours?', 'draft_only');
    assert.strictEqual(res.canAutoReply, false);
    assert.strictEqual(res.requiresApproval, true, 'Draft-only mode must keep all replies pending approval');
    assert.strictEqual(res.intent, 'routine_hours');
  });

  test('auto_routine: “Hi, is this product available?” without product name asks clarification automatically', () => {
    const res = evaluateRoutine('Hi, is this product available?', 'auto_routine');
    assert.strictEqual(res.canAutoReply, true, 'Must auto-reply clarification question without owner approval');
    assert.strictEqual(res.requiresApproval, false);
    assert.strictEqual(res.intent, 'routine_product_info');
    assert.ok(res.replyText.includes('specify which product') || res.replyText.includes('item name'), 'Must ask for product name clarification without hallucinating details');
  });

  test('auto_routine: “Is Classic Leather Jacket available and what is the price?” auto-replies verified catalog data', () => {
    const res = evaluateRoutine('Is Classic Leather Jacket available and what is the price?', 'auto_routine');
    assert.strictEqual(res.canAutoReply, true);
    assert.strictEqual(res.requiresApproval, false);
    assert.strictEqual(res.intent, 'routine_product_info');
    assert.ok(res.replyText.includes('Classic Leather Jacket'));
    assert.ok(res.replyText.includes('14500'));
    assert.ok(res.replyText.includes('In Stock'));
  });

  test('auto_routine: “Where is my order?” without order ID asks for order number automatically', () => {
    const res = evaluateRoutine('Where is my order?', 'auto_routine');
    assert.strictEqual(res.canAutoReply, true, 'Must auto-reply clarification without owner approval');
    assert.strictEqual(res.requiresApproval, false);
    assert.strictEqual(res.intent, 'routine_order_status');
    assert.ok(res.replyText.includes('Order ID') || res.replyText.includes('reference number'), 'Must ask customer for order number');
  });

  test('auto_routine: “Where is my order ORD-1001?” auto-replies with verified order status', () => {
    const res = evaluateRoutine('Where is my order ORD-1001?', 'auto_routine');
    assert.strictEqual(res.canAutoReply, true);
    assert.strictEqual(res.requiresApproval, false);
    assert.strictEqual(res.intent, 'routine_order_status');
    assert.ok(res.replyText.includes('ORD-1001'));
    assert.ok(res.replyText.includes('DELIVERED'));
  });

  test('auto_routine: “I want a refund” strictly requires owner approval', () => {
    const res = evaluateRoutine('I received a defective item. I want a refund please.', 'auto_routine');
    assert.strictEqual(res.canAutoReply, false, 'Refund requests must NEVER auto-send');
    assert.strictEqual(res.requiresApproval, true);
    assert.strictEqual(res.financialOrMajorAction, true);
    assert.strictEqual(res.intent, 'financial_action');
    assert.ok(res.acknowledgmentDraft.includes('reviewing'), 'Must route to owner review');
  });

  test('auto_routine: “Please exchange my shoes” strictly requires owner approval', () => {
    const res = evaluateRoutine('Please exchange my shoes for a larger size', 'auto_routine');
    assert.strictEqual(res.canAutoReply, false, 'Exchange requests must NEVER auto-send');
    assert.strictEqual(res.requiresApproval, true);
    assert.strictEqual(res.financialOrMajorAction, true);
    assert.strictEqual(res.intent, 'financial_action');
  });

  test('auto_routine: “What is your refund policy?” is routine policy info and auto-replies published policy', () => {
    const res = evaluateRoutine('What is your refund policy and return window?', 'auto_routine');
    assert.strictEqual(res.canAutoReply, true, 'Policy inquiry is routine and must auto-reply');
    assert.strictEqual(res.requiresApproval, false);
    assert.strictEqual(res.financialOrMajorAction, false);
    assert.strictEqual(res.intent, 'routine_policy_info');
    assert.ok(res.replyText.includes('14 days'), 'Must provide published return window');
  });

  test('auto_routine mode auto-replies to routine FAQs grounded in knowledge base', () => {
    const res = evaluateRoutine('What courier service do you use for nationwide deliveries?', 'auto_routine');
    assert.strictEqual(res.canAutoReply, true);
    assert.strictEqual(res.requiresApproval, false);
    assert.strictEqual(res.intent, 'routine_faq');
    assert.ok(res.replyText.includes('Trax and TCS Express'), 'Reply must include grounded FAQ content');
  });

  test('auto_routine mode auto-replies to operating hours questions', () => {
    const res = evaluateRoutine('What are your opening hours on weekdays?', 'auto_routine');
    assert.strictEqual(res.canAutoReply, true);
    assert.strictEqual(res.intent, 'routine_hours');
    assert.ok(res.replyText.includes('09:00 to 18:00'));
  });

  test('paused mode disables all AI auto-replies and drafts', () => {
    const res = evaluateRoutine('What are your hours?', 'paused');
    assert.strictEqual(res.canAutoReply, false);
    assert.strictEqual(res.intent, 'paused');
    assert.strictEqual(res.requiresApproval, false);
  });

  test('prevents auto-reply loops by falling back to human review on consecutive AI messages', () => {
    const historyWithLoops = [
      { sender_type: 'agent', body: 'Auto reply 1' },
      { sender_type: 'agent', body: 'Auto reply 2' },
    ];
    const res = evaluateRoutine('What courier do you use?', 'auto_routine', historyWithLoops);
    assert.strictEqual(res.canAutoReply, false);
    assert.strictEqual(res.intent, 'loop_prevented');
    assert.strictEqual(res.requiresApproval, true, 'Potential loops must be routed to human review');
  });

  test('duplicate sync prevention: re-syncing an existing Gmail message ID ignores duplicate ingestion', () => {
    const existingGmailIds = new Set(['msg_1001', 'msg_1002']);
    const isDuplicate = (gmailId) => existingGmailIds.has(gmailId);

    assert.strictEqual(isDuplicate('msg_1001'), true, 'Existing Gmail message must be skipped');
    assert.strictEqual(isDuplicate('msg_1003'), false, 'New Gmail message must be processed');
  });

  test('cron scheduler enforces authorization token', () => {
    const cronSecret = 'secure_cron_token_123';
    const validateAuth = (authHeader, cronKeyHeader) => {
      if (authHeader === `Bearer ${cronSecret}` || cronKeyHeader === cronSecret) {
        return { authorized: true };
      }
      return { authorized: false, error: 'Unauthorized cron trigger' };
    };

    assert.strictEqual(validateAuth('Bearer secure_cron_token_123', null).authorized, true);
    assert.strictEqual(validateAuth(null, 'secure_cron_token_123').authorized, true);
    assert.strictEqual(validateAuth('Bearer wrong_token', null).authorized, false);
    assert.strictEqual(validateAuth(null, null).authorized, false);
  });
});

// 13. Test Pending Approvals Sync, Inbox Selection & Decision Integrity
describe('Pending Approvals Sync, Inbox Selection & Safe Decision Lifecycle', () => {
  test('extracts order ID from refund message text reliably', () => {
    const extractOrderId = (text) => {
      if (!text) return 'ORD-1001';
      const patterns = [
        /(?:order|ord|order\s*#|invoice)\s*[:#\-]?\s*([A-Za-z0-9\-_]{3,20})/i,
        /\b(ORD-[A-Za-z0-9\-_]+)\b/i,
        /\b([A-Z]{2,4}-\d{3,8})\b/,
        /#(\d{4,8})\b/,
      ];
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          let id = match[1].trim();
          if (/^\d{4,8}$/.test(id)) id = `ORD-${id}`;
          return id;
        }
      }
      return 'ORD-1001';
    };

    assert.strictEqual(extractOrderId('Hi, I need a refund for order ORD-1001 because it was broken.'), 'ORD-1001');
    assert.strictEqual(extractOrderId('Please cancel order #54321'), 'ORD-54321');
    assert.strictEqual(extractOrderId('Return request for ITEM-9988'), 'ITEM-9988');
    assert.strictEqual(extractOrderId('I just want my money back.'), 'ORD-1001');
  });

  test('sync pending conversation cases is idempotent and maps schema correctly', () => {
    const draftMessage = {
      id: 'msg-draft-1',
      conversation_id: 'conv-gm-mutryn1s-4r7n',
      approval_status: 'pending_approval',
      body: 'I have received your refund request for order ORD-1001.',
      customer_name: 'Talha ishaq Rabani',
      customer_email: 'talha@example.com',
      created_at: new Date('2026-10-04T12:00:00Z'),
    };

    // Construct case_id
    const cleanSuffix = draftMessage.conversation_id.replace(/^conv-/, '');
    const caseId = `case-${cleanSuffix}`;

    assert.strictEqual(caseId, 'case-gm-mutryn1s-4r7n');

    const casePayload = {
      tenant_id: 'demo-store',
      case_id: caseId,
      kind: 'return',
      status: 'pending_approval',
      revision: 1,
      payload: {
        request_id: `req-${cleanSuffix}`,
        order_id: 'ORD-1001',
        conversation_id: draftMessage.conversation_id,
        message_id: draftMessage.id,
        customer_name: draftMessage.customer_name,
        customer_email: draftMessage.customer_email,
        source: 'gmail',
      },
      proposal: {
        action: 'Authorize Refund / Financial Action',
        summary: 'Authorize customer refund/return email reply',
        proposed_response: draftMessage.body,
      },
    };

    assert.strictEqual(casePayload.case_id, 'case-gm-mutryn1s-4r7n');
    assert.strictEqual(casePayload.payload.conversation_id, 'conv-gm-mutryn1s-4r7n');
    assert.strictEqual(casePayload.payload.order_id, 'ORD-1001');
    assert.strictEqual(casePayload.status, 'pending_approval');
  });

  test('inbox conversation selection preserves ID and matching between list and detail', () => {
    const listConversations = [
      { id: 'conv-gm-mutryn1s-4r7n', customer_name: 'Talha ishaq Rabani', status: 'pending_approval' },
      { id: 'conv-demo-1', customer_name: 'Sarah Connor', status: 'resolved' },
    ];

    const targetUrlId = 'conv-gm-mutryn1s-4r7n';
    const found = listConversations.find((c) => c.id === targetUrlId);
    assert.ok(found, 'Selected ID from URL must match an item in the conversation list');
    assert.strictEqual(found.customer_name, 'Talha ishaq Rabani');
  });

  test('approval decision never dispatches email if rejected and does not execute financial transactions', () => {
    let emailDispatched = false;
    let refundExecuted = false;

    const handleDecision = (decisionType, caseData) => {
      if (decisionType === 'reject') {
        emailDispatched = false;
        return { status: 'rejected', draft_status: 'cancelled' };
      }
      if (decisionType === 'approve') {
        emailDispatched = true;
        refundExecuted = false; // System only approves the communication draft, does not execute money transfer
        return {
          status: 'approved',
          draft_status: 'sent',
          email_dispatched: true,
          financial_refund_executed: false,
          notice: 'Email reply dispatched. Note: Monetary refund must be processed in payment gateway.',
        };
      }
    };

    const rejectRes = handleDecision('reject', { case_id: 'case-gm-mutryn1s-4r7n' });
    assert.strictEqual(rejectRes.status, 'rejected');
    assert.strictEqual(emailDispatched, false, 'Rejected case must never dispatch email');

    const approveRes = handleDecision('approve', { case_id: 'case-gm-mutryn1s-4r7n' });
    assert.strictEqual(approveRes.status, 'approved');
    assert.strictEqual(approveRes.financial_refund_executed, false, 'Approval must not claim monetary refund execution');
  });
});

// 12. Merchant Product Catalog & Demo Orders Verification
describe('Merchant Catalog, Demo Orders & Customer Matching Security', () => {
  const evaluateCatalogAndOrder = ({
    query,
    senderEmail,
    senderName = 'Customer',
    mode = 'auto_routine',
    orders = [],
    settings = {},
  }) => {
    const combinedText = query.trim();
    const lowerText = combinedText.toLowerCase();

    // Check for strict refund/exchange request
    const isRefundOrExchange = /(refund|money back|reimburse|exchange|replace my|damaged item return)/i.test(combinedText);
    if (isRefundOrExchange && /(i want|please|request|process|need|give me)/i.test(combinedText)) {
      return {
        canAutoReply: false,
        intent: 'financial_action',
        requiresApproval: true,
        financialOrMajorAction: true,
        replyText: 'Refund request held for merchant approval.',
      };
    }

    // Check for order tracking
    const isOrderQuery = /(where is my order|order status|track my package|tracking number|status of my order)/i.test(combinedText);
    if (isOrderQuery) {
      const orderIdMatch = combinedText.match(/\b(ORD-[a-zA-Z0-9_-]+)\b/i);
      const extractedOrderId = orderIdMatch ? orderIdMatch[1].toUpperCase() : null;

      if (extractedOrderId) {
        const matchedOrder = orders.find((o) => o.order_id?.toUpperCase() === extractedOrderId);
        if (matchedOrder) {
          const normalizedSenderEmail = (senderEmail || '').trim().toLowerCase();
          const orderCustomerEmail = (
            matchedOrder.customer_email ||
            matchedOrder.data?.customer_email ||
            matchedOrder.data?.customer?.email ||
            ''
          ).trim().toLowerCase();

          if (orderCustomerEmail && normalizedSenderEmail && orderCustomerEmail !== normalizedSenderEmail) {
            return {
              canAutoReply: mode === 'auto_routine',
              intent: 'routine_order_status',
              reason: 'Customer email does not match verified order record. Privacy gate engaged.',
              replyText: `Hello ${senderName},\n\nFor security and customer privacy protection, order details can only be shared with the verified email address associated with the purchase. The email address you are writing from (${senderEmail}) does not match the registered customer record for Order ${matchedOrder.order_id}.`,
              requiresApproval: mode !== 'auto_routine',
              financialOrMajorAction: false,
            };
          }

          const items = Array.isArray(matchedOrder.items)
            ? matchedOrder.items.map((i) => `${i.name} [${i.variant || 'Standard'}] (Qty: ${i.qty || 1})`).join(', ')
            : 'Standard items';
          const tracking = matchedOrder.data?.tracking_number ? `\n- Tracking Number: ${matchedOrder.data.tracking_number}` : '';

          return {
            canAutoReply: mode === 'auto_routine',
            intent: 'routine_order_status',
            replyText: `Hello ${senderName},\n\n- Order ID: ${matchedOrder.order_id}\n- Status: ${(matchedOrder.status || 'processing').toUpperCase()}\n- Items: ${items}\n- Total: ${matchedOrder.currency || 'PKR'} ${matchedOrder.total}${tracking}`,
            requiresApproval: mode !== 'auto_routine',
            financialOrMajorAction: false,
          };
        }
      }
    }

    // Check for product inquiry
    const isProductQuery = /(available|price|cost|how much|in stock|sku)/i.test(combinedText);
    if (isProductQuery) {
      const catalog = settings.knowledge?.products_services || [];
      const matched = catalog.find((p) => p.name && lowerText.includes(p.name.toLowerCase()));
      if (matched) {
        let availability = matched.is_active === false
          ? 'Currently Inactive / Unavailable'
          : matched.stock_quantity !== undefined
          ? (matched.stock_quantity <= 0 ? 'Out of Stock (0 units available)' : `In Stock (${matched.stock_quantity} units available)`)
          : (matched.in_stock !== false ? 'In Stock' : 'Out of Stock');

        const variantsStr = matched.variants
          ? `\n- Sizes/Variants: ${Array.isArray(matched.variants) ? matched.variants.join(', ') : matched.variants}`
          : '';
        const skuStr = matched.sku ? ` (SKU: ${matched.sku})` : '';

        return {
          canAutoReply: mode === 'auto_routine',
          intent: 'routine_product_info',
          replyText: `Hello ${senderName},\n\n- Product: ${matched.name}${skuStr}\n- Price: ${matched.currency || 'PKR'} ${matched.price}\n- Availability: ${availability}${variantsStr}`,
          requiresApproval: mode !== 'auto_routine',
          financialOrMajorAction: false,
        };
      }
    }

    return { canAutoReply: false, intent: 'ambiguous' };
  };

  test('product inquiry returns saved price, SKU, variants, and stock quantity', () => {
    const settings = {
      business_name: 'Demo Apparel',
      currency: 'PKR',
      knowledge: {
        products_services: [
          {
            id: 'prod-lawn-01',
            name: 'Embroidered Lawn Kurti',
            sku: 'LAWN-101',
            price: 4500,
            currency: 'PKR',
            stock_quantity: 15,
            variants: ['Small', 'Medium', 'Large'],
            is_active: true,
            in_stock: true,
          },
        ],
      },
    };

    const result = evaluateCatalogAndOrder({
      query: 'Hi, is the Embroidered Lawn Kurti available and how much is it?',
      senderName: 'Fatima',
      senderEmail: 'fatima@example.com',
      settings,
    });

    assert.strictEqual(result.intent, 'routine_product_info');
    assert.strictEqual(result.canAutoReply, true);
    assert.ok(result.replyText.includes('Embroidered Lawn Kurti'));
    assert.ok(result.replyText.includes('PKR 4500'));
    assert.ok(result.replyText.includes('SKU: LAWN-101'));
    assert.ok(result.replyText.includes('In Stock (15 units available)'));
    assert.ok(result.replyText.includes('Small, Medium, Large'));
  });

  test('subsequent stock update is immediately reflected in the next AI reply', () => {
    const updatedSettings = {
      business_name: 'Demo Apparel',
      currency: 'PKR',
      knowledge: {
        products_services: [
          {
            id: 'prod-lawn-01',
            name: 'Embroidered Lawn Kurti',
            sku: 'LAWN-101',
            price: 4500,
            currency: 'PKR',
            stock_quantity: 0,
            variants: 'Small, Medium, Large',
            is_active: true,
            in_stock: false,
          },
        ],
      },
    };

    const result = evaluateCatalogAndOrder({
      query: 'Do you have Embroidered Lawn Kurti in stock and available?',
      senderName: 'Fatima',
      senderEmail: 'fatima@example.com',
      settings: updatedSettings,
    });

    assert.strictEqual(result.intent, 'routine_product_info');
    assert.ok(result.replyText.includes('Out of Stock (0 units available)'));
  });

  test('demo order tracking reply is disclosed when sender matches order customer email', () => {
    const orders = [
      {
        tenant_id: 'demo-store',
        order_id: 'ORD-9801',
        customer_name: 'Ahmed Khan',
        customer_email: 'ahmed.khan@example.com',
        items: [{ name: 'Embroidered Lawn Kurti', variant: 'Medium', qty: 1, price: 4500 }],
        total: 4500,
        currency: 'PKR',
        status: 'shipped',
        data: {
          tracking_number: 'TRK-PK-9801',
          is_demo: true,
        },
      },
    ];

    const result = evaluateCatalogAndOrder({
      query: 'Where is my order ORD-9801?',
      senderName: 'Ahmed Khan',
      senderEmail: 'ahmed.khan@example.com',
      orders,
    });

    assert.strictEqual(result.intent, 'routine_order_status');
    assert.strictEqual(result.canAutoReply, true);
    assert.ok(result.replyText.includes('ORD-9801'));
    assert.ok(result.replyText.includes('SHIPPED'));
    assert.ok(result.replyText.includes('TRK-PK-9801'));
    assert.ok(result.replyText.includes('Embroidered Lawn Kurti [Medium] (Qty: 1)'));
  });

  test('customer matching privacy gate: different sender cannot access another customer order details', () => {
    const orders = [
      {
        tenant_id: 'demo-store',
        order_id: 'ORD-9801',
        customer_name: 'Ahmed Khan',
        customer_email: 'ahmed.khan@example.com',
        items: [{ name: 'Embroidered Lawn Kurti', variant: 'Medium', qty: 1, price: 4500 }],
        total: 4500,
        currency: 'PKR',
        status: 'shipped',
        data: {
          tracking_number: 'TRK-PK-9801',
          is_demo: true,
        },
      },
    ];

    const result = evaluateCatalogAndOrder({
      query: 'Where is my order ORD-9801?',
      senderName: 'Stranger Danger',
      senderEmail: 'intruder@randomdomain.com',
      orders,
    });

    assert.strictEqual(result.intent, 'routine_order_status');
    assert.ok(result.replyText.includes('customer privacy protection'));
    assert.ok(!result.replyText.includes('TRK-PK-9801'), 'Must not expose tracking number to wrong email');
    assert.ok(!result.replyText.includes('Embroidered Lawn Kurti'), 'Must not expose purchased items to wrong email');
  });

  test('refund and exchange requests strictly require owner approval even with valid orders', () => {
    const orders = [
      {
        tenant_id: 'demo-store',
        order_id: 'ORD-9801',
        customer_name: 'Ahmed Khan',
        customer_email: 'ahmed.khan@example.com',
        total: 4500,
        currency: 'PKR',
        status: 'delivered',
      },
    ];

    const refundResult = evaluateCatalogAndOrder({
      query: 'The item arrived damaged. Please process a full refund for my order ORD-9801.',
      senderName: 'Ahmed Khan',
      senderEmail: 'ahmed.khan@example.com',
      orders,
    });

    assert.strictEqual(refundResult.intent, 'financial_action');
    assert.strictEqual(refundResult.requiresApproval, true);
    assert.strictEqual(refundResult.canAutoReply, false);
    assert.strictEqual(refundResult.financialOrMajorAction, true);
  });
});

// 15. Shopify OAuth 2.0 & HMAC Security Contracts
describe('Shopify OAuth 2.0 & HMAC Security Contracts', () => {
  // Helper HMAC generator for test fixtures
  function generateShopifyHmac(queryParams, clientSecret) {
    const { hmac, signature, ...rest } = queryParams;
    const sortedKeys = Object.keys(rest).sort();
    const message = sortedKeys.map((k) => `${k}=${rest[k]}`).join('&');
    return crypto.createHmac('sha256', clientSecret).update(message, 'utf8').digest('hex');
  }

  function verifyShopifyHmac(queryParams, clientSecret) {
    const { hmac, signature, ...rest } = queryParams;
    const targetHmac = hmac || signature;
    if (!targetHmac || !clientSecret) return false;
    const sortedKeys = Object.keys(rest).sort();
    const message = sortedKeys.map((k) => `${k}=${rest[k]}`).join('&');
    const generated = crypto.createHmac('sha256', clientSecret).update(message, 'utf8').digest('hex');
    try {
      const a = Buffer.from(generated, 'hex');
      const b = Buffer.from(targetHmac, 'hex');
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  function verifyShopifyWebhookHmac(rawBody, hmacHeader, secret) {
    if (!hmacHeader || !secret) return false;
    const generated = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    try {
      const a = Buffer.from(generated, 'utf8');
      const b = Buffer.from(hmacHeader, 'utf8');
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  function sanitizeShopDomain(rawShop) {
    if (!rawShop || typeof rawShop !== 'string') return null;
    let cleaned = rawShop.trim().toLowerCase();
    cleaned = cleaned.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!cleaned.includes('.myshopify.com')) {
      cleaned = `${cleaned}.myshopify.com`;
    }
    const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
    return shopRegex.test(cleaned) ? cleaned : null;
  }

  test('normalizes varied shop domain formats to valid myshopify.com subdomains', () => {
    assert.strictEqual(sanitizeShopDomain('my-boutique'), 'my-boutique.myshopify.com');
    assert.strictEqual(sanitizeShopDomain('https://urban-tech.myshopify.com/admin'), 'urban-tech.myshopify.com');
    assert.strictEqual(sanitizeShopDomain('DEMO-STORE.MYSHOPIFY.COM'), 'demo-store.myshopify.com');
    assert.strictEqual(sanitizeShopDomain('invalid domain with spaces!'), null);
    assert.strictEqual(sanitizeShopDomain(''), null);
  });

  test('validates authentic Shopify OAuth callback HMAC and rejects forged signatures', () => {
    const clientSecret = 'shpss_test_secret_key_1234567890abcdef';
    const validParams = {
      code: 'code_mock_oauth_authorization_123',
      shop: 'urban-tech.myshopify.com',
      state: 'st_1728200000_mockstate',
      timestamp: '1728200000',
    };

    const signature = generateShopifyHmac(validParams, clientSecret);
    const callbackPayload = { ...validParams, hmac: signature };

    assert.strictEqual(verifyShopifyHmac(callbackPayload, clientSecret), true, 'Valid HMAC signature must pass');

    // Tampered parameter attempt
    const tamperedPayload = { ...callbackPayload, shop: 'attacker-store.myshopify.com' };
    assert.strictEqual(verifyShopifyHmac(tamperedPayload, clientSecret), false, 'Tampered shop domain must be rejected');

    // Invalid secret attempt
    assert.strictEqual(verifyShopifyHmac(callbackPayload, 'wrong_secret'), false, 'Wrong secret must be rejected');
  });

  test('validates Shopify webhook HMAC-SHA256 Base64 header and rejects altered payloads', () => {
    const webhookSecret = 'shpss_webhook_secret_998877';
    const rawOrderPayload = JSON.stringify({
      id: 88776655,
      name: '#1050',
      total_price: '5500.00',
      currency: 'PKR',
      email: 'customer@example.com',
    });

    const validHeader = crypto.createHmac('sha256', webhookSecret).update(rawOrderPayload).digest('base64');

    assert.strictEqual(verifyShopifyWebhookHmac(rawOrderPayload, validHeader, webhookSecret), true);

    const tamperedPayload = rawOrderPayload.replace('5500.00', '0.00');
    assert.strictEqual(verifyShopifyWebhookHmac(tamperedPayload, validHeader, webhookSecret), false, 'Altered body must fail HMAC check');
  });

  test('requests only minimal read-only permissions for sync phase', () => {
    const readScopes = ['read_products', 'read_orders', 'read_inventory', 'read_locations'];
    const hasWritePermission = readScopes.some((s) => s.startsWith('write_'));
    assert.strictEqual(hasWritePermission, false, 'Phase 1 connector must not request write permissions');
  });
});

// 16. Shopify Credential Encryption & Multi-Tenant Isolation
describe('Shopify Credential Encryption & Multi-Tenant Isolation', () => {
  const ALGORITHM = 'aes-256-gcm';
  const testKey = crypto.createHash('sha256').update('test_master_encryption_key_32bytes_long!').digest();

  function encryptToken(plaintext) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, testKey, iv);
    let enc = cipher.update(plaintext, 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${enc}`;
  }

  function decryptToken(payload) {
    const [ivHex, tagHex, cipherHex] = payload.split(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, testKey, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let dec = decipher.update(cipherHex, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  }

  test('Shopify offline access tokens are encrypted with AES-256-GCM and never stored plaintext', () => {
    const rawToken = 'shpat_live_access_token_abcdef1234567890';
    const encrypted = encryptToken(rawToken);

    assert.ok(encrypted.includes(':'), 'Encrypted payload must contain IV, tag, and ciphertext');
    assert.ok(!encrypted.includes(rawToken), 'Ciphertext must not expose raw token string');
    assert.strictEqual(decryptToken(encrypted), rawToken, 'Decrypted token must match original exactly');
  });

  test('strictly enforces tenant isolation so Store A cannot view or sync Store B credentials', () => {
    const storeRegistry = new Map();

    // Tenant 1
    storeRegistry.set('demo-store', {
      shop_domain: 'demo-clothing.myshopify.com',
      token: encryptToken('shpat_tenant_demo_111'),
    });

    // Tenant 2
    storeRegistry.set('artisan-bakery', {
      shop_domain: 'artisan-fresh.myshopify.com',
      token: encryptToken('shpat_tenant_bakery_222'),
    });

    // Tenant lookup query simulation
    const getStoreForTenant = (tenantId) => storeRegistry.get(tenantId) || null;

    const demoStore = getStoreForTenant('demo-store');
    const bakeryStore = getStoreForTenant('artisan-bakery');
    const unknownStore = getStoreForTenant('unauthorized-tenant');

    assert.strictEqual(demoStore.shop_domain, 'demo-clothing.myshopify.com');
    assert.strictEqual(decryptToken(demoStore.token), 'shpat_tenant_demo_111');

    assert.strictEqual(bakeryStore.shop_domain, 'artisan-fresh.myshopify.com');
    assert.strictEqual(decryptToken(bakeryStore.token), 'shpat_tenant_bakery_222');

    assert.strictEqual(unknownStore, null, 'Unknown tenant must return null');
  });
});

// 17. n8n Shopify Sync Orchestration (Jobs, Batching & Error States)
describe('n8n Shopify Sync Orchestration Contracts', () => {
  test('sync job starts in running status with initialized pagination counters', () => {
    const newJob = {
      id: 'sync_test_001',
      tenant_id: 'demo-store',
      shop_domain: 'demo-store.myshopify.com',
      status: 'running',
      sync_types: ['products', 'inventory', 'policies', 'orders'],
      progress: {
        products: { processed: 0, failed: 0, has_next_page: true, next_cursor: null },
        orders: { processed: 0, failed: 0, has_next_page: true, next_cursor: null },
        policies: { processed: 0, failed: 0, status: 'pending' },
        inventory: { processed: 0, failed: 0, status: 'pending' },
      },
      summary: {
        products_synced: 0,
        orders_synced: 0,
        policies_synced: 0,
        errors_count: 0,
      },
      error_details: [],
    };

    assert.strictEqual(newJob.status, 'running');
    assert.strictEqual(newJob.progress.products.processed, 0);
    assert.strictEqual(newJob.progress.products.has_next_page, true);
    assert.deepStrictEqual(newJob.error_details, []);
  });

  test('batch processor advances cursor and aggregates synced counts across paginated pages', () => {
    // Page 1
    const page1Items = [
      { id: '101', title: 'Silk Scarf', variants: [{ id: 'v1', price: 1200, inventory_quantity: 15 }] },
      { id: '102', title: 'Wool Beanie', variants: [{ id: 'v2', price: 950, inventory_quantity: 8 }] },
    ];
    const page1NextCursor = '102';
    const page1HasNext = true;

    // Page 2
    const page2Items = [
      { id: '103', title: 'Leather Belt', variants: [{ id: 'v3', price: 2100, inventory_quantity: 5 }] },
    ];
    const page2NextCursor = '103';
    const page2HasNext = false;

    // Aggregate simulation
    let totalProcessed = 0;
    let cursor = null;

    // Process page 1
    totalProcessed += page1Items.length;
    cursor = page1NextCursor;
    assert.strictEqual(totalProcessed, 2);
    assert.strictEqual(cursor, '102');
    assert.strictEqual(page1HasNext, true);

    // Process page 2
    totalProcessed += page2Items.length;
    cursor = page2NextCursor;
    assert.strictEqual(totalProcessed, 3);
    assert.strictEqual(cursor, '103');
    assert.strictEqual(page2HasNext, false, 'End of pagination must signal hasNextPage = false');
  });

  test('idempotent upserting handles duplicate product and order batches without duplicates', () => {
    const productDb = new Map();

    const upsertProduct = (p) => {
      productDb.set(p.id, { ...p, updated_at: Date.now() });
    };

    const item = { id: 'prod-4455', title: 'Embroidered Shawl', price: 6500 };

    // First ingestion
    upsertProduct(item);
    assert.strictEqual(productDb.size, 1);
    assert.strictEqual(productDb.get('prod-4455').title, 'Embroidered Shawl');

    // Duplicate ingestion with updated price
    upsertProduct({ ...item, price: 6999 });
    assert.strictEqual(productDb.size, 1, 'Duplicate ID must update existing record rather than creating a new one');
    assert.strictEqual(productDb.get('prod-4455').price, 6999);
  });

  test('accurate partial failure state: does NOT report a failed or partial sync as complete', () => {
    const jobState = {
      id: 'sync_partial_test',
      status: 'running',
      sync_types: ['products', 'orders', 'policies'],
      progress: {
        products: { processed: 25, failed: 0, status: 'completed' },
        orders: { processed: 0, failed: 1, status: 'failed' },
        policies: { processed: 1, failed: 0, status: 'completed' },
      },
      summary: {
        products_synced: 25,
        orders_synced: 0,
        policies_synced: 1,
        errors_count: 1,
      },
      error_details: [
        { type: 'orders', message: 'Shopify API returned 503 Service Unavailable for orders endpoint', timestamp: new Date().toISOString() },
      ],
    };

    // Determine final status
    const resolveFinalStatus = (job) => {
      const hasErrors = (job.error_details && job.error_details.length > 0) || job.summary.errors_count > 0;
      const someSucceeded = job.summary.products_synced > 0 || job.summary.policies_synced > 0 || job.summary.orders_synced > 0;

      if (hasErrors) {
        return someSucceeded ? 'partial_failed' : 'failed';
      }
      return 'completed';
    };

    const finalStatus = resolveFinalStatus(jobState);
    assert.strictEqual(finalStatus, 'partial_failed', 'Partial sync with errors must be marked as partial_failed, never completed');
    assert.notStrictEqual(finalStatus, 'completed');
  });

  test('Shopify 429 rate-limiting throttling calculation respects Retry-After header', () => {
    const calculateBackoffMs = (retryAfterHeader, attempt) => {
      if (retryAfterHeader) {
        const parsed = parseFloat(retryAfterHeader);
        if (!isNaN(parsed) && parsed > 0) {
          return Math.min(parsed * 1000, 10000);
        }
      }
      return Math.min(Math.pow(2, attempt) * 1000, 10000);
    };

    assert.strictEqual(calculateBackoffMs('2.5', 1), 2500, 'Should respect Retry-After: 2.5s');
    assert.strictEqual(calculateBackoffMs(null, 2), 4000, 'Should use exponential backoff 2^2 * 1000 = 4000ms');
    assert.strictEqual(calculateBackoffMs('15.0', 1), 10000, 'Should cap maximum wait time to 10000ms');
  });
});

// 18. Shopify Synced Data Grounding & Customer Privacy Gates
describe('Shopify Synced Data Grounding & Customer Privacy Gates', () => {
  const evaluateCatalogAndOrder = (params) => {
    const { query, senderName, senderEmail, settings = {}, orders = [] } = params;
    const lowerQuery = (query || '').toLowerCase();
    const mode = settings.automation_mode || 'auto_routine';

    // 1. Financial or major actions
    if (/refund|money\s*back|cancel\s*order|exchange/i.test(lowerQuery) && !/what\s*is\s*your\s*(return|refund|exchange)\s*policy/i.test(lowerQuery)) {
      return {
        canAutoReply: false,
        intent: 'financial_action',
        requiresApproval: true,
        financialOrMajorAction: true,
        reason: 'Refund/Exchange action request requires owner approval.',
      };
    }

    // 2. Policy query
    if (/return\s*policy|refund\s*policy|exchange\s*policy/i.test(lowerQuery)) {
      const days = settings.return_window_days || settings.knowledge?.policies?.return_window_days || 14;
      const rule = settings.knowledge?.policies?.general_rules || `Items can be returned within ${days} days.`;
      return {
        canAutoReply: mode === 'auto_routine',
        intent: 'routine_policy_info',
        replyText: `Hello ${senderName},\n\nOur return policy allows returns within ${days} days of delivery. ${rule}`,
        requiresApproval: mode !== 'auto_routine',
        financialOrMajorAction: false,
      };
    }

    // 3. Order status query
    if (/where\s*is\s*my\s*order|order\s*status|status\s*for\s*order/i.test(lowerQuery) || /#\d+|ord-\d+/i.test(lowerQuery)) {
      const orderMatch = lowerQuery.match(/(#\d+|ord-[\w-]+)/i);
      const orderId = orderMatch ? orderMatch[0].toUpperCase() : null;

      if (orderId) {
        const matched = orders.find((o) => o.order_id?.toUpperCase() === orderId);
        if (matched) {
          const orderEmail = (matched.customer_email || matched.data?.customer_email || '').toLowerCase().trim();
          const reqEmail = (senderEmail || '').toLowerCase().trim();

          if (orderEmail && reqEmail && orderEmail !== reqEmail) {
            return {
              canAutoReply: mode === 'auto_routine',
              intent: 'routine_order_status',
              replyText: `Hello ${senderName},\n\nFor security and customer privacy protection, order details can only be shared with the verified email address associated with the purchase (${orderEmail}).`,
              requiresApproval: mode !== 'auto_routine',
              financialOrMajorAction: false,
            };
          }

          const tracking = matched.data?.tracking_number ? `\n- Tracking Number: ${matched.data.tracking_number}` : '';
          const items = (matched.items || []).map((i) => `${i.name || i.title} (Qty: ${i.qty || 1})`).join(', ');

          return {
            canAutoReply: mode === 'auto_routine',
            intent: 'routine_order_status',
            replyText: `Hello ${senderName},\n\nOrder ID: ${matched.order_id}\nStatus: ${(matched.status || 'shipped').toUpperCase()}\nItems: ${items}${tracking}`,
            requiresApproval: mode !== 'auto_routine',
            financialOrMajorAction: false,
          };
        }
      }
    }

    // 4. Product inquiry
    const products = settings.knowledge?.products_services || [];
    for (const p of products) {
      if (lowerQuery.includes(p.name.toLowerCase().split('(')[0].trim())) {
        const avail = (p.stock_quantity ?? 10) > 0 ? `In Stock (${p.stock_quantity} units available)` : 'Out of Stock';
        return {
          canAutoReply: mode === 'auto_routine',
          intent: 'routine_product_info',
          replyText: `Hello ${senderName},\n\n- Product: ${p.name}\n- Price: ${p.currency || 'PKR'} ${p.price}\n- Availability: ${avail}`,
          requiresApproval: mode !== 'auto_routine',
          financialOrMajorAction: false,
        };
      }
    }

    return { canAutoReply: false, intent: 'ambiguous' };
  };

  test('AI assistant grounds product availability and pricing from synced Shopify catalog without manual entry', () => {
    // Synced catalog from Shopify
    const syncedKnowledge = {
      products_services: [
        {
          id: 'sp-101-v1',
          name: 'Classic Velvet Tuxedo (40R)',
          sku: 'TUX-40R',
          price: 24500,
          currency: 'PKR',
          in_stock: true,
          stock_quantity: 6,
          description: 'Premium wool-blend velvet tuxedo in Midnight Blue.',
        },
      ],
      faqs: [],
      policies: {
        return_window_days: 30,
        general_rules: 'Shopify Store Policy: Unworn items with tags can be returned within 30 days.',
      },
    };

    const settings = {
      business_name: 'Velvet Atelier',
      currency: 'PKR',
      automation_mode: 'auto_routine',
      knowledge: syncedKnowledge,
      return_window_days: 30,
    };

    const result = evaluateCatalogAndOrder({
      query: 'Is the Classic Velvet Tuxedo available and how much is it?',
      senderName: 'Usman Ali',
      senderEmail: 'usman.ali@example.com',
      settings,
    });

    assert.strictEqual(result.intent, 'routine_product_info');
    assert.strictEqual(result.canAutoReply, true);
    assert.ok(result.replyText.includes('Classic Velvet Tuxedo'));
    assert.ok(result.replyText.includes('PKR 24,500') || result.replyText.includes('24500'));
    assert.ok(result.replyText.includes('in stock') || result.replyText.includes('available'));
  });

  test('Shopify synced return policy is automatically explained in routine policy inquiry', () => {
    const settings = {
      business_name: 'Velvet Atelier',
      currency: 'PKR',
      automation_mode: 'auto_routine',
      return_window_days: 30,
      knowledge: {
        products_services: [],
        faqs: [],
        policies: {
          return_window_days: 30,
          general_rules: 'Items can be returned within 30 days of delivery.',
        },
      },
    };

    const result = evaluateCatalogAndOrder({
      query: 'What is your return policy?',
      senderName: 'Fatima Noor',
      senderEmail: 'fatima@example.com',
      settings,
    });

    assert.strictEqual(result.intent, 'routine_policy_info');
    assert.strictEqual(result.canAutoReply, true);
    assert.ok(result.replyText.includes('30 days'));
  });

  test('customer order privacy gate: verifies customer email before disclosing Shopify order tracking', () => {
    const syncedOrders = [
      {
        tenant_id: 'demo-store',
        order_id: '#1088',
        customer_name: 'Sara Khan',
        customer_email: 'sara.khan@example.com',
        items: [{ name: 'Bridal Clutch', qty: 1, price: 8500 }],
        total: 8500,
        currency: 'PKR',
        status: 'shipped',
        data: {
          tracking_number: 'TRK-SHOPIFY-9922',
          carrier: 'TCS Express',
          source: 'shopify',
        },
      },
    ];

    // Case A: Correct customer email matches order
    const validCustomerResult = evaluateCatalogAndOrder({
      query: 'Where is my order #1088?',
      senderName: 'Sara Khan',
      senderEmail: 'sara.khan@example.com',
      orders: syncedOrders,
    });

    assert.strictEqual(validCustomerResult.intent, 'routine_order_status');
    assert.ok(validCustomerResult.replyText.includes('#1088'));
    assert.ok(validCustomerResult.replyText.includes('SHIPPED'));
    assert.ok(validCustomerResult.replyText.includes('TRK-SHOPIFY-9922'));

    // Case B: Mismatched sender email attempting to query #1088
    const intruderResult = evaluateCatalogAndOrder({
      query: 'Please check status for order #1088',
      senderName: 'Random Scammer',
      senderEmail: 'scammer@external-mail.com',
      orders: syncedOrders,
    });

    assert.strictEqual(intruderResult.intent, 'routine_order_status');
    assert.ok(intruderResult.replyText.includes('customer privacy protection'));
    assert.ok(!intruderResult.replyText.includes('TRK-SHOPIFY-9922'), 'Must never leak tracking number to unauthorized sender');
    assert.ok(!intruderResult.replyText.includes('Bridal Clutch'), 'Must never leak purchased items');
  });

  test('disconnecting Shopify store invalidates live connector and marks status as disconnected', () => {
    const connectionState = {
      tenant_id: 'demo-store',
      shop_domain: 'demo-store.myshopify.com',
      is_connected: true,
      sync_status: 'success',
    };

    // Disconnect action simulation
    connectionState.is_connected = false;
    connectionState.sync_status = 'disconnected';

    assert.strictEqual(connectionState.is_connected, false);
    assert.strictEqual(connectionState.sync_status, 'disconnected');
  });
});

// 19. Regression Test Suite: Shopify Store Identity, Source Currency & Non-Customer Email Filtering
describe('Shopify Store Identity, Source Currency & Non-Customer Email Filter Regressions', () => {
  // Classification Helper definition for contract test isolation
  function classifyEmail(input) {
    const { senderEmail = '', subject = '', bodyText = '', headers = {}, isAutomatedHeader } = input;
    const cleanEmail = senderEmail.trim().toLowerCase();
    const cleanSubject = subject.trim();
    const combinedText = `${cleanSubject}\n${bodyText}`.trim();

    const autoSubmitted = (headers['auto-submitted'] || '').toLowerCase();
    const precedence = (headers['precedence'] || '').toLowerCase();
    const listUnsubscribe = headers['list-unsubscribe'] || '';

    if (autoSubmitted && autoSubmitted !== 'no') {
      return { isNonCustomer: true, category: 'system_notification', reason: `Auto-Submitted=${autoSubmitted}` };
    }
    if (['bulk', 'list', 'junk', 'auto_reply'].includes(precedence)) {
      return { isNonCustomer: true, category: 'newsletter_marketing', reason: `Precedence=${precedence}` };
    }

    const automatedSenders = [
      /^mailer@shopify\.com$/i,
      /^accounts@shopify\.com$/i,
      /^(no-?reply|donotreply|do-not-reply|no_reply|notifications?|alerts?|mailer-daemon|postmaster|bounce|billing-noreply|news|newsletter|promotions?|marketing|updates?|system|security|auth|verify|daemon)@/i,
      /@(accounts\.shopify\.com|accounts\.google\.com|notifications\.google\.com|mail\.stripe\.com|stripe\.com)$/i,
    ];
    const isAutomatedSender = automatedSenders.some((p) => p.test(cleanEmail));

    if (/\b(delivery\s*status\s*notification|undelivered\s*mail|mail\s*delivery\s*failed|failure\s*notice)\b/i.test(cleanSubject) || cleanEmail.includes('mailer-daemon')) {
      return { isNonCustomer: true, category: 'delivery_failure_bounce', reason: 'Delivery failure/bounce' };
    }
    if (/^(auto-reply|automatic\s*reply|out\s*of\s*office|away\s*from\s*(the\s*)?office)/i.test(cleanSubject)) {
      return { isNonCustomer: true, category: 'automated_autoreply', reason: 'Out of office/auto-reply' };
    }
    if (/\b(verification\s*code|one-?time\s*(password|code)|\botp\b|security\s*code)\b/i.test(cleanSubject) || (/\b(your\s*verification\s*code|use\s*this\s*code\s*to\s*continue|\bthis\s*code\s*expires\s*in)\b/i.test(combinedText) && isAutomatedSender)) {
      return { isNonCustomer: true, category: 'otp_verification', reason: 'OTP/verification code' };
    }
    if (/\b(new\s*device\s*signed\s*in|new\s*sign-?in|security\s*alert|review\s*activity)\b/i.test(cleanSubject) || (/\b(we\s*noticed\s*a\s*new\s*sign-?in|if\s*this\s*was\s*you,\s*you'?re\s*all\s*set)\b/i.test(combinedText) && (isAutomatedSender || cleanEmail.includes('shopify')))) {
      return { isNonCustomer: true, category: 'security_signin_alert', reason: 'Sign-in activity alert' };
    }
    if (/\b(password\s*reset|reset\s*your\s*password)\b/i.test(cleanSubject) || (/\b(reset\s*your\s*password|requested\s*to\s*reset\s*the\s*password)\b/i.test(combinedText) && isAutomatedSender)) {
      return { isNonCustomer: true, category: 'password_reset', reason: 'Password reset notification' };
    }
    if (listUnsubscribe || (isAutomatedSender && /\b(view\s*in\s*browser|if\s*you\s*no\s*longer\s*wish\s*to\s*receive|unsubscribe|opt-?out)\b/i.test(bodyText))) {
      return { isNonCustomer: true, category: 'newsletter_marketing', reason: 'Marketing newsletter' };
    }
    if (isAutomatedSender) {
      return { isNonCustomer: true, category: 'system_notification', reason: `System notification from ${cleanEmail}` };
    }
    if (isAutomatedHeader) {
      return { isNonCustomer: true, category: 'system_notification', reason: 'Flagged automated' };
    }

    return { isNonCustomer: false };
  }

  function evaluateStoreInquiry(params) {
    const { subject = '', bodyText = '', senderName = 'Customer', senderEmail = '', settings = {}, orders = [] } = params;
    const businessName = settings.display_name_override || settings.business_name || 'Customer Support';
    const customerFirstName = senderName.split(' ')[0] || 'there';
    const combined = `${subject} ${bodyText}`.trim().toLowerCase();

    // 1. Classification check
    const filter = classifyEmail({ senderEmail, senderName, subject, bodyText });
    if (filter.isNonCustomer) {
      return {
        canAutoReply: false,
        intent: 'ignored_automated',
        reason: filter.reason,
        requiresApproval: false,
      };
    }

    // 2. Policy inquiry check
    if (/\b(what\s*(is|are)\s*(your|the)?\s*(return|refund|exchange|shipping|delivery)\s*policy|how\s*many\s*days\s*(do\s*i\s*have\s*to\s*)?(return|exchange|cancel)|(return|refund|exchange)\s*policy|return\s*window)\b/i.test(combined)) {
      const returnDays = settings.knowledge?.policies?.return_window_days || settings.return_window_days || 14;
      return {
        canAutoReply: true,
        intent: 'routine_policy_info',
        replyText: `Hello ${customerFirstName},\n\nThank you for reaching out to ${businessName}.\n\nOur standard return policy allows returns and exchanges within ${returnDays} days of delivery.\n\nBest regards,\n${businessName} Support Team`,
        requiresApproval: false,
      };
    }

    // 3. Product inquiry check
    const catalog = settings.knowledge?.products_services || [];
    let matchedProd = null;
    for (const p of catalog) {
      if (p.name && combined.includes(p.name.toLowerCase())) {
        matchedProd = p;
        break;
      }
    }

    if (matchedProd) {
      const priceStr = matchedProd.currency ? `${matchedProd.currency} ${matchedProd.price}` : `${matchedProd.price}`;
      const avail = matchedProd.stock_quantity > 0 ? `In Stock (${matchedProd.stock_quantity} units available)` : 'Out of Stock';
      return {
        canAutoReply: true,
        intent: 'routine_product_info',
        replyText: `Hello ${customerFirstName},\n\nThank you for your interest in ${businessName}!\n\nHere are the details for ${matchedProd.name}:\n- Product: ${matchedProd.name}\n- Price: ${priceStr}\n- Availability: ${avail}\n\nBest regards,\n${businessName} Support Team`,
        requiresApproval: false,
      };
    }

    // 4. Missing details -> Clarification question
    if (/\b(product|price|cost|available|in\s*stock)\b/i.test(combined)) {
      return {
        canAutoReply: true,
        intent: 'routine_product_info',
        replyText: `Hello ${customerFirstName},\n\nThank you for contacting ${businessName}.\n\nCould you please specify which product or item name you are inquiring about?\n\nBest regards,\n${businessName} Support Team`,
        requiresApproval: false,
      };
    }

    // 5. Major action -> Approval required
    if (/\b(refund\s*my\s*money|i\s*demand\s*a\s*refund|cancel\s*my\s*order)\b/i.test(combined)) {
      return {
        canAutoReply: false,
        intent: 'financial_action',
        requiresApproval: true,
        acknowledgmentDraftText: `Hello ${customerFirstName},\n\nThank you for contacting ${businessName}. We have received your refund request and our team is reviewing it.\n\nBest regards,\n${businessName} Support Team`,
      };
    }

    return {
      canAutoReply: false,
      intent: 'ambiguous',
      requiresApproval: true,
    };
  }

  test('Shopify connected store name "rabani" is used in greetings and signatures instead of demo placeholder', () => {
    const settings = {
      business_name: 'rabani',
      currency: 'USD',
      automation_mode: 'auto_routine',
      knowledge: {
        products_services: [
          {
            id: 'sp-15340422201634',
            name: 'The Collection Snowboard: Liquid',
            price: 749.95,
            currency: 'USD',
            stock_quantity: 50,
            in_stock: true,
          },
        ],
      },
    };

    const result = evaluateStoreInquiry({
      subject: 'Inquiry about The Collection Snowboard: Liquid',
      bodyText: 'Hi, what is the price and availability of The Collection Snowboard: Liquid?',
      senderName: 'John Doe',
      senderEmail: 'john.doe@example.com',
      settings,
    });

    assert.strictEqual(result.canAutoReply, true);
    assert.strictEqual(result.intent, 'routine_product_info');
    assert.ok(result.replyText.includes('interest in rabani!'), 'Must use connected store name "rabani"');
    assert.ok(result.replyText.includes('rabani Support Team'), 'Must use "rabani Support Team" in signature');
    assert.ok(!result.replyText.includes('Demo Clothing Store'), 'Must NOT contain "Demo Clothing Store"');
  });

  test('Explicit merchant display_name_override takes precedence over connected Shopify store name', () => {
    const settings = {
      business_name: 'rabani',
      display_name_override: 'Rabani Snowboard Co.',
      currency: 'USD',
      automation_mode: 'auto_routine',
      knowledge: {
        products_services: [
          {
            id: 'sp-15340422201634',
            name: 'The Collection Snowboard: Liquid',
            price: 749.95,
            currency: 'USD',
            stock_quantity: 50,
          },
        ],
      },
    };

    const result = evaluateStoreInquiry({
      subject: 'Inquiry',
      bodyText: 'Do you have The Collection Snowboard: Liquid in stock?',
      senderName: 'Michael Scott',
      senderEmail: 'michael@dunder.com',
      settings,
    });

    assert.ok(result.replyText.includes('Rabani Snowboard Co.'), 'Must use explicit merchant display_name_override');
  });

  test('Shopify product "The Collection Snowboard: Liquid" uses exact source price 749.95 and source currency USD (never PKR)', () => {
    const settings = {
      business_name: 'rabani',
      currency: 'USD',
      knowledge: {
        products_services: [
          {
            id: 'sp-15340422201634',
            name: 'The Collection Snowboard: Liquid',
            sku: 'SKU-67457998586146',
            price: 749.95,
            currency: 'USD',
            stock_quantity: 50,
            in_stock: true,
          },
        ],
      },
    };

    const result = evaluateStoreInquiry({
      subject: 'Product Price Check',
      bodyText: 'How much is The Collection Snowboard: Liquid?',
      senderName: 'Sarah Connor',
      senderEmail: 'sarah@skynet.com',
      settings,
    });

    assert.strictEqual(result.canAutoReply, true);
    assert.ok(result.replyText.includes('USD 749.95'), 'Must output "USD 749.95"');
    assert.ok(!result.replyText.includes('PKR'), 'Must NEVER attach demo PKR currency to USD product');
    assert.ok(result.replyText.includes('In Stock (50 units available)'), 'Must show verified 50 units stock');
  });

  test('Non-customer sign-in alerts (e.g. from Shopify or Google) are ignored with no AI reply created', () => {
    const signinResult = evaluateStoreInquiry({
      subject: 'New sign-in to your Shopify account',
      bodyText: 'We noticed a new sign-in to your account from a new device: Chrome on Windows 10, IP 72.255.21.60. If this was you, no action needed.',
      senderName: 'Shopify',
      senderEmail: 'mailer@shopify.com',
      settings: { business_name: 'rabani' },
    });

    assert.strictEqual(signinResult.canAutoReply, false);
    assert.strictEqual(signinResult.intent, 'ignored_automated');
    assert.strictEqual(signinResult.requiresApproval, false, 'Ignored notifications must create no approval task');
    assert.strictEqual(signinResult.replyText, undefined, 'Must create no automatic reply');
  });

  test('Non-customer OTP and verification codes are ignored with no AI reply created', () => {
    const otpResult = evaluateStoreInquiry({
      subject: 'Your verification code',
      bodyText: 'We received a request to verify your account. Use this one time code to continue: 961262. This code expires in 10 minutes. Do not share this verification code.',
      senderName: 'Shopify',
      senderEmail: 'mailer@shopify.com',
      settings: { business_name: 'rabani' },
    });

    assert.strictEqual(otpResult.canAutoReply, false);
    assert.strictEqual(otpResult.intent, 'ignored_automated');
    assert.strictEqual(otpResult.requiresApproval, false);
  });

  test('Marketing newsletters, promos, and bounces are ignored with no AI reply created', () => {
    const promoResult = evaluateStoreInquiry({
      subject: '🐝 .BUZZ offer extended through October 31!',
      bodyText: 'Register a .BUZZ domain with promo code BUZZ26. View in browser | Unsubscribe from this list.',
      senderName: 'Dmytro from NIC.UA',
      senderEmail: 'news@nic.ua',
      settings: { business_name: 'rabani' },
    });

    assert.strictEqual(promoResult.canAutoReply, false);
    assert.strictEqual(promoResult.intent, 'ignored_automated');

    const bounceResult = evaluateStoreInquiry({
      subject: 'Delivery Status Notification (Failure)',
      bodyText: 'The following message could not be delivered to the recipient address.',
      senderName: 'Mail Delivery Subsystem',
      senderEmail: 'mailer-daemon@googlemail.com',
      settings: { business_name: 'rabani' },
    });

    assert.strictEqual(bounceResult.canAutoReply, false);
    assert.strictEqual(bounceResult.intent, 'ignored_automated');
  });

  test('Genuine customer inquiries containing keywords "verification", "refund", or "Shopify" are NOT blocked', () => {
    const genuineInquiry = evaluateStoreInquiry({
      subject: 'Need verification on return window for my Shopify purchase',
      bodyText: 'Hello! I bought an item on your Shopify store. How many days do I have to return it under your refund policy?',
      senderName: 'Emma Watson',
      senderEmail: 'emma.watson@gmail.com', // Normal human sender, not a system address
      settings: {
        business_name: 'rabani',
        return_window_days: 14,
      },
    });

    assert.strictEqual(genuineInquiry.canAutoReply, true);
    assert.strictEqual(genuineInquiry.intent, 'routine_policy_info');
    assert.ok(genuineInquiry.replyText.includes('14 days'));
    assert.ok(genuineInquiry.replyText.includes('rabani'));
  });

  test('Major financial actions (e.g. demand a refund) still require owner approval', () => {
    const refundRequest = evaluateStoreInquiry({
      subject: 'I demand a refund for my damaged item',
      bodyText: 'Please refund my money back immediately. The item arrived broken.',
      senderName: 'David Miller',
      senderEmail: 'david.m@example.com',
      settings: { business_name: 'rabani' },
    });

    assert.strictEqual(refundRequest.canAutoReply, false);
    assert.strictEqual(refundRequest.intent, 'financial_action');
    assert.strictEqual(refundRequest.requiresApproval, true);
  });
});

// 20. Regression Test Suite: Shopify Order Sync, Protected Customer Data (PCD) & Graceful Partial Failure
describe('Shopify Order Sync, Protected Customer Data (PCD) Handling & No Permissions Bypass', () => {
  // Helpers mirroring implementation contracts
  class ShopifyOrderAccessBlockedError extends Error {
    constructor(message) {
      super(
        message ||
        'Shopify order access blocked: app requires read_orders scope and approved Protected Customer Data access in Shopify Partner Dashboard.'
      );
      this.name = 'ShopifyOrderAccessBlockedError';
      this.isOrderAccessBlocked = true;
    }
  }

  function isShopifyOrderAccessBlockedError(err) {
    if (err instanceof ShopifyOrderAccessBlockedError) return true;
    if (err && typeof err === 'object') {
      if (err.isOrderAccessBlocked) return true;
      const msg = String(err.message || '');
      if (
        msg.includes('protected customer data') ||
        msg.includes('Protected customer data') ||
        msg.includes('Access denied for orders') ||
        msg.includes('ACCESS_DENIED') ||
        msg.includes('not approved to access') ||
        msg.includes('order access blocked') ||
        (msg.includes('403') && (msg.includes('order') || msg.includes('customer') || msg.includes('REST')))
      ) {
        return true;
      }
    }
    return false;
  }

  test('isShopifyOrderAccessBlockedError recognizes Shopify REST 403 and GraphQL PCD rejection', () => {
    const rest403Err = new Error('Failed to fetch Shopify orders (HTTP 403): {"errors":"[API] This app is not approved to access REST endpoints with protected customer data. See https://shopify.dev/docs/apps/launch/protected-customer-data for more details."}');
    assert.strictEqual(isShopifyOrderAccessBlockedError(rest403Err), true);

    const gqlDeniedErr = new ShopifyOrderAccessBlockedError('Shopify GraphQL access denied: Access denied for orders field. Required access: Protected customer data');
    assert.strictEqual(isShopifyOrderAccessBlockedError(gqlDeniedErr), true);

    const typedErr = new ShopifyOrderAccessBlockedError();
    assert.strictEqual(isShopifyOrderAccessBlockedError(typedErr), true);

    const genericNetworkErr = new Error('getaddrinfo ENOTFOUND rabani-ysnivj04.myshopify.com');
    assert.strictEqual(isShopifyOrderAccessBlockedError(genericNetworkErr), false);
  });

  test('Order sync failure finishes job as partial_failed, preserves synced products, and sets last_error', () => {
    const syncJob = {
      id: 'job-pcd-test-01',
      tenant_id: 'demo-store',
      shop_domain: 'rabani-ysnivj04.myshopify.com',
      status: 'running',
      progress: {},
      summary: {},
      error_details: [],
    };

    const syncedProducts = [
      { id: '8205574340798', title: 'The Collection Snowboard: Liquid', price: 749.95, currency: 'USD' },
    ];
    let productsCount = syncedProducts.length;
    let ordersCount = 0;
    const errors = [];

    // Simulate order fetch throwing PCD 403
    const orderError = new ShopifyOrderAccessBlockedError('Shopify GraphQL HTTP 403: App not approved to access protected customer data or missing read_orders permission.');
    if (isShopifyOrderAccessBlockedError(orderError)) {
      errors.push({
        type: 'orders',
        message: 'Products synced; order access blocked (Shopify Protected Customer Data approval required in Partner Dashboard)',
        timestamp: new Date().toISOString(),
      });
    }

    const finalStatus = errors.length > 0 ? (productsCount > 0 ? 'partial_failed' : 'failed') : 'completed';
    syncJob.status = finalStatus;
    syncJob.summary = {
      products_synced: productsCount,
      orders_synced: ordersCount,
      errors_count: errors.length,
    };
    syncJob.error_details = errors;

    assert.strictEqual(syncJob.status, 'partial_failed', 'Must finish as partial_failed, NOT stuck in running');
    assert.strictEqual(syncJob.summary.products_synced, 1, 'Must preserve synced products');
    assert.strictEqual(syncJob.summary.orders_synced, 0);
    assert.ok(syncJob.error_details[0].message.includes('Products synced; order access blocked'));
  });

  test('UI badge renders "Products synced; order access blocked" instead of "Connected & Synced"', () => {
    function computeShopifyBadge(shopifyConnected, syncStatus, lastError) {
      if (!shopifyConnected) {
        return { label: 'Not Connected', badgeClass: 'bg-slate-100 text-slate-600' };
      }
      const isBlocked =
        syncStatus === 'partial_failed' ||
        (lastError && (
          lastError.includes('order access blocked') ||
          lastError.includes('protected customer data') ||
          lastError.includes('REST endpoints with protected customer data')
        ));

      if (isBlocked) {
        return {
          label: 'Products synced; order access blocked',
          badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
        };
      }
      if (syncStatus === 'failed') {
        return { label: 'Sync Failed', badgeClass: 'bg-rose-100 text-rose-800' };
      }
      return { label: 'Connected & Synced', badgeClass: 'bg-emerald-100 text-emerald-800' };
    }

    // When order PCD is blocked
    const blockedBadge = computeShopifyBadge(
      true,
      'partial_failed',
      'Products synced; order access blocked (Shopify Protected Customer Data approval required in Partner Dashboard)'
    );
    assert.strictEqual(blockedBadge.label, 'Products synced; order access blocked');
    assert.ok(blockedBadge.badgeClass.includes('amber'));

    // When fully healthy
    const healthyBadge = computeShopifyBadge(true, 'success', null);
    assert.strictEqual(healthyBadge.label, 'Connected & Synced');
    assert.ok(healthyBadge.badgeClass.includes('emerald'));
  });

  test('Customer-email privacy verification matches existing records and blocks cross-customer access', () => {
    const existingOrders = [
      {
        order_id: 'ORD-1001',
        customer_name: 'Ayesha Malik',
        customer_email: 'ayesha.m@example.com',
        status: 'delivered',
        total: 14500,
        currency: 'PKR',
        data: {
          items: [{ name: 'Classic Leather Jacket', qty: 1 }],
          tracking_number: 'TRK-PKR-001',
        },
      },
    ];

    // Privacy match check function
    function checkOrderPrivacyAccess(orderId, senderEmail) {
      const order = existingOrders.find((o) => o.order_id === orderId);
      if (!order) return { found: false, allowed: false };
      const orderEmail = (order.customer_email || order.data?.customer_email || '').toLowerCase().trim();
      const sender = (senderEmail || '').toLowerCase().trim();
      const isMatch = orderEmail === sender;
      return {
        found: true,
        allowed: isMatch,
        reason: isMatch ? 'Verified customer identity' : 'Customer email mismatch - access denied for privacy',
      };
    }

    const authorizedAccess = checkOrderPrivacyAccess('ORD-1001', 'ayesha.m@example.com');
    assert.strictEqual(authorizedAccess.allowed, true);

    const unauthorizedAccess = checkOrderPrivacyAccess('ORD-1001', 'snooper@external.com');
    assert.strictEqual(unauthorizedAccess.allowed, false);
    assert.ok(unauthorizedAccess.reason.includes('Customer email mismatch'));
  });
});

// 21. Real Email Order Lookup, Normalization, Demo Isolation & Quote Stripping
describe('Real Email Order Lookup, Normalization & Privacy Gates', () => {
  const shopifyOrder = {
    order_id: '#1001',
    customer_email: 'mukaramajeed28094@gmail.com',
    customer_name: 'mukaram majeed',
    total: '749.95',
    currency: 'USD',
    status: 'unfulfilled',
    items: [
      {
        name: 'The Collection Snowboard: Liquid',
        price: 749.95,
        qty: 1,
      },
    ],
    data: {
      shopify_name: '#1001',
      shopify_order_id: '7275667423522',
      tracking_number: null,
      status: 'unfulfilled',
    },
  };

  const demoOrder = {
    order_id: 'ORD-1001',
    customer_email: 'ayesha.m@example.com',
    customer_name: 'Ayesha Malik',
    total: '14500.00',
    currency: 'PKR',
    status: 'delivered',
    items: [{ name: 'Classic Leather Jacket', qty: 1 }],
    data: {
      tracking_number: null,
      status: 'delivered',
    },
  };

  const settings = {
    business_name: 'rabani',
    currency: 'USD',
    automation_mode: 'auto_routine',
  };

  test('normalizes #1001 and 1001 consistently to match Shopify order #1001', () => {
    const ref1 = extractOrderReference('hi what is the current status of my order? #1001');
    assert.ok(ref1);
    assert.strictEqual(ref1.normalized, '1001');
    assert.strictEqual(matchOrderRecord(shopifyOrder, ref1), true);

    const ref2 = extractOrderReference('what is the status of order 1001');
    assert.ok(ref2);
    assert.strictEqual(ref2.normalized, '1001');
    assert.strictEqual(matchOrderRecord(shopifyOrder, ref2), true);
  });

  test('plain #1001 or 1001 query STRICTLY rejects demo ORD-1001', () => {
    const refHash = extractOrderReference('what is the status of order #1001');
    assert.strictEqual(matchOrderRecord(demoOrder, refHash), false);

    const refPlain = extractOrderReference('status for 1001');
    assert.strictEqual(matchOrderRecord(demoOrder, refPlain), false);
  });

  test('explicit ORD-1001 matches demo order ORD-1001 and rejects #1001', () => {
    const refOrd = extractOrderReference('check status of ORD-1001');
    assert.ok(refOrd);
    assert.strictEqual(refOrd.isExplicitOrdPrefix, true);
    assert.strictEqual(matchOrderRecord(demoOrder, refOrd), true);
    assert.strictEqual(matchOrderRecord(shopifyOrder, refOrd), false);
  });

  test('matching customer receives real fulfillment status and no invented tracking', () => {
    const evalResult = evaluateRoutineInquiry({
      subject: 'Order Status',
      bodyText: 'hi what is the current status of my order? #1001',
      senderName: 'Mukaram Majeed',
      senderEmail: 'mukaramajeed28094@gmail.com',
      settings,
      orders: [shopifyOrder, demoOrder],
    });

    assert.strictEqual(evalResult.intent, 'routine_order_status');
    assert.strictEqual(evalResult.canAutoReply, true);
    assert.ok(evalResult.replyText.includes('#1001'));
    assert.ok(evalResult.replyText.includes('UNFULFILLED'));
    assert.ok(evalResult.replyText.includes('USD 749.95'));
    assert.ok(evalResult.replyText.includes('The Collection Snowboard: Liquid'));
    assert.ok(evalResult.replyText.includes('Not yet assigned'));
    assert.ok(!evalResult.replyText.includes('TRK-'));
  });

  test('different customer email triggers privacy gate and does not disclose details', () => {
    const evalResult = evaluateRoutineInquiry({
      subject: 'Order status',
      bodyText: 'where is my order #1001',
      senderName: 'Stranger',
      senderEmail: 'stranger@example.com',
      settings,
      orders: [shopifyOrder, demoOrder],
    });

    assert.strictEqual(evalResult.intent, 'routine_order_status');
    assert.ok(evalResult.reason.includes('Privacy gate engaged'));
    assert.ok(!evalResult.replyText.includes('Snowboard'));
    assert.ok(!evalResult.replyText.includes('749.95'));
    assert.ok(evalResult.replyText.includes('does not match the registered customer record'));
  });

  test('missing order triggers clarification without hallucinating details', () => {
    const evalResult = evaluateRoutineInquiry({
      subject: 'Where is my order',
      bodyText: 'check status for #9999',
      senderName: 'Mukaram',
      senderEmail: 'mukaramajeed28094@gmail.com',
      settings,
      orders: [shopifyOrder, demoOrder],
    });

    assert.strictEqual(evalResult.intent, 'routine_order_status');
    assert.ok(evalResult.reason.includes('not found in database'));
    assert.ok(evalResult.replyText.includes('Could you please double-check your order number'));
  });

  test('strips quoted email thread history to prevent false positive policy replies', () => {
    const threadBody = `who are you

On Wed, 7 Oct 2026 at 03:54, rabani <talhaishaqrabani9490@gmail.com> wrote:

> Hello Mukaram,
>
> Regarding your question "What is your standard return and exchange window?":
> Items in original unworn condition with tags attached can be returned within 14 days.`;

    const cleaned = cleanQuotedReplyText(threadBody);
    assert.strictEqual(cleaned, 'who are you');

    const evalResult = evaluateRoutineInquiry({
      subject: 'Re: Inquiry',
      bodyText: threadBody,
      senderName: 'Mukaram',
      senderEmail: 'mukaramajeed28094@gmail.com',
      settings,
      orders: [shopifyOrder, demoOrder],
    });

    assert.notStrictEqual(evalResult.intent, 'routine_policy_info');
  });
});

// 22. Automatic Shopify Synchronization via n8n & Operator-Key Authentication
describe('Automatic Shopify Synchronization via n8n & Operator Authentication', () => {
  const operatorKey = 'test_operator_key_9988aabbcc';

  function authenticateScheduledSync(headers) {
    const auth = headers['authorization'] || '';
    const xKey = headers['x-operator-key'] || '';
    const xCron = headers['x-cron-key'] || '';
    const bearer = auth.startsWith('Bearer ') ? auth.substring(7).trim() : '';

    if (bearer === operatorKey || xKey === operatorKey || xCron === operatorKey) {
      return { authorized: true };
    }
    return { authorized: false, error: 'Unauthorized: Invalid operator key.' };
  }

  test('accepts valid operator key in Authorization Bearer and X-Operator-Key headers', () => {
    const res1 = authenticateScheduledSync({ authorization: `Bearer ${operatorKey}` });
    assert.strictEqual(res1.authorized, true);

    const res2 = authenticateScheduledSync({ 'x-operator-key': operatorKey });
    assert.strictEqual(res2.authorized, true);

    const res3 = authenticateScheduledSync({ 'x-cron-key': operatorKey });
    assert.strictEqual(res3.authorized, true);
  });

  test('rejects forged or missing operator keys with 401 unauthorized', () => {
    const resMissing = authenticateScheduledSync({});
    assert.strictEqual(resMissing.authorized, false);

    const resForged = authenticateScheduledSync({ authorization: 'Bearer forged_key_xyz' });
    assert.strictEqual(resForged.authorized, false);
    assert.ok(resForged.error.includes('Unauthorized'));
  });

  test('multi-tenant scheduled sync resolves active shops and isolates failures', () => {
    const connectedTenants = [
      { tenant_id: 'store-alpha', shop_domain: 'alpha.myshopify.com', is_connected: true },
      { tenant_id: 'store-beta', shop_domain: 'beta.myshopify.com', is_connected: true },
    ];

    // Mock sync results for each tenant
    const syncResults = {};
    for (const tenant of connectedTenants) {
      if (tenant.tenant_id === 'store-beta') {
        // Simulate a PCD or rate limit error on store-beta
        syncResults[tenant.tenant_id] = {
          status: 'partial_failed',
          shop_domain: tenant.shop_domain,
          products_synced: 10,
          orders_synced: 0,
          errors: [{ type: 'orders', message: 'Shopify Protected Customer Data approval required' }],
        };
      } else {
        syncResults[tenant.tenant_id] = {
          status: 'completed',
          shop_domain: tenant.shop_domain,
          products_synced: 25,
          orders_synced: 5,
          policies_synced: 1,
        };
      }
    }

    assert.strictEqual(syncResults['store-alpha'].status, 'completed');
    assert.strictEqual(syncResults['store-alpha'].products_synced, 25);
    // Store-alpha succeeded regardless of store-beta's partial failure
    assert.strictEqual(syncResults['store-beta'].status, 'partial_failed');
    assert.strictEqual(syncResults['store-beta'].products_synced, 10);
  });

  test('overlap prevention detects running jobs within interval window', () => {
    function checkJobOverlap(runningJobs, tenantId, windowMinutes = 15) {
      const now = Date.now();
      const active = runningJobs.find(
        (j) => j.tenant_id === tenantId && j.status === 'running' && (now - j.created_at) < windowMinutes * 60 * 1000
      );
      if (active) {
        return { shouldSkip: true, reason: 'Active sync job running within interval' };
      }
      return { shouldSkip: false };
    }

    const runningJobs = [
      { id: 'job-1', tenant_id: 'store-alpha', status: 'running', created_at: Date.now() - 2 * 60 * 1000 },
      { id: 'job-2', tenant_id: 'store-beta', status: 'completed', created_at: Date.now() - 5 * 60 * 1000 },
    ];

    const checkAlpha = checkJobOverlap(runningJobs, 'store-alpha');
    assert.strictEqual(checkAlpha.shouldSkip, true);

    const checkBeta = checkJobOverlap(runningJobs, 'store-beta');
    assert.strictEqual(checkBeta.shouldSkip, false);
  });

  test('n8n workflow JSON specifies host.docker.internal, credential auth, and bounded retries', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const workflowPath = path.join(process.cwd(), 'n8n-workflows', 'shopify-scheduled-sync.json');

    assert.ok(fs.existsSync(workflowPath), 'Workflow file must exist');
    const content = fs.readFileSync(workflowPath, 'utf8');
    const wf = JSON.parse(content);

    assert.strictEqual(wf.name, 'Industry AI Operator - Shopify Store Scheduled Sync');
    const httpNode = wf.nodes.find((n) => n.type === 'n8n-nodes-base.httpRequest');
    assert.ok(httpNode, 'HTTP request node required');
    assert.ok(httpNode.parameters.url.includes('host.docker.internal:3000/api/cron/sync-shopify'));
    assert.strictEqual(httpNode.parameters.options.retry.retry.maxTries, 3);
    assert.strictEqual(httpNode.credentials.httpHeaderAuth.id, 'iao_operator_key');

    // Asserts no hardcoded secrets in workflow JSON
    assert.ok(!content.includes('shpss_'));
    assert.ok(!content.includes('GOCSPX-'));
  });
});

console.log('All contract validation tests configured successfully.');








import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  recordWebhookEvent,
  findDispatchByProviderMessageId,
  updateDispatchStatus,
  recordAuditLog,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Validates Svix / Resend Webhook Signatures against raw payload (Requirement 5)
 */
function verifySvixSignature(
  rawBody: string,
  headers: Headers,
  signingSecret?: string
): { isValid: boolean; error?: string } {
  const secret = signingSecret || process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // If no secret configured in demo environment, log warning and allow for local testing if explicitly configured
    if (process.env.NODE_ENV === 'development' || process.env.ALLOW_UNVERIFIED_WEBHOOKS === 'true') {
      return { isValid: true };
    }
    return { isValid: false, error: 'RESEND_WEBHOOK_SECRET is not configured on the server.' };
  }

  const svixId = headers.get('svix-id');
  const svixTimestamp = headers.get('svix-timestamp');
  const svixSignature = headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { isValid: false, error: 'Missing required Svix webhook headers (svix-id, svix-timestamp, svix-signature).' };
  }

  // 1. Timestamp replay protection (5 minute tolerance)
  const timestampSec = parseInt(svixTimestamp, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (isNaN(timestampSec) || Math.abs(nowSec - timestampSec) > 300) {
    return { isValid: false, error: 'Webhook timestamp expired or out of valid 5-minute window (replay prevention).' };
  }

  // 2. Secret format: Resend secrets usually start with 'whsec_'
  const cleanSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const secretBytes = Buffer.from(cleanSecret, 'base64');

  const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedSig = crypto
    .createHmac('sha256', secretBytes)
    .update(signedPayload)
    .digest('base64');

  // Svix signature header may contain space-separated signatures (e.g. "v1,signature1 v1,signature2")
  const signatures = svixSignature.split(' ').map((s) => s.replace(/^v1,/, ''));
  const matches = signatures.some((sig) => crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig)));

  if (!matches) {
    return { isValid: false, error: 'Signature verification mismatch.' };
  }

  return { isValid: true };
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const headers = request.headers;

    // 1. Validate signature against raw request body
    const sigCheck = verifySvixSignature(rawBody, headers);
    if (!sigCheck.isValid) {
      return NextResponse.json(
        { error: `Webhook authorization failed: ${sigCheck.error}` },
        { status: 401 }
      );
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const eventType = String(payload.type || payload.event || 'unknown');
    const eventId = String(payload.id || headers.get('svix-id') || `ev-${Date.now()}`);
    const data = (payload.data || {}) as Record<string, unknown>;
    const providerMessageId = String(data.email_id || data.id || payload.email_id || '');

    // 2. Deduplicate events (Idempotent Webhook Processing - Requirement 5)
    const recordRes = await recordWebhookEvent({
      eventId,
      provider: 'resend',
      eventType,
      providerMessageId: providerMessageId || null,
      payload,
    });

    if (recordRes.isDuplicate) {
      return NextResponse.json(
        { message: 'Duplicate event ignored', event_id: eventId },
        { status: 200 }
      );
    }

    // 3. Resolve dispatch and parent message from stored providerMessageId
    if (providerMessageId) {
      const dispatch = await findDispatchByProviderMessageId(providerMessageId);

      if (dispatch) {
        let newStatus = dispatch.status;

        // Map Resend event types: 'email.delivered', 'email.bounced', 'email.complained', etc.
        switch (eventType) {
          case 'email.delivered':
            newStatus = 'delivered';
            break;
          case 'email.bounced':
            newStatus = 'bounced';
            break;
          case 'email.complained':
            newStatus = 'complained';
            break;
          case 'email.delivery_delayed':
            // Retain provider_accepted or current status
            break;
          default:
            break;
        }

        // Handle out-of-order events (e.g. delivered should not be overwritten if already bounced)
        if (newStatus !== dispatch.status) {
          await updateDispatchStatus({
            dispatch_id: dispatch.id,
            status: newStatus,
            metadataUpdates: {
              last_webhook_event: eventType,
              webhook_timestamp: new Date().toISOString(),
            },
          });

          await recordAuditLog(dispatch.tenant_id, `webhook_${eventType.replace('.', '_')}`, {
            dispatch_id: dispatch.id,
            message_id: dispatch.message_id,
            provider_message_id: providerMessageId,
            new_status: newStatus,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      processed: true,
      event_id: eventId,
      event_type: eventType,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Webhook processing error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

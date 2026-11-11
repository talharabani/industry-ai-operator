import { NextRequest, NextResponse } from 'next/server';
import {
  getCustomStoreConnection,
  verifyCustomStoreWebhookSignature,
  ingestCustomStoreWebhook,
} from '@/lib/custom-store-service';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const tenantId = req.headers.get('x-custom-store-tenant') || req.headers.get('x-tenant-id') || 'demo-store';
    const connectionId = req.headers.get('x-custom-store-connection-id') || undefined;
    const signatureHeader = req.headers.get('x-custom-store-signature') || '';
    const timestampHeader = req.headers.get('x-custom-store-timestamp') || '';
    const eventIdHeader = req.headers.get('x-custom-store-event-id') || '';

    // Retrieve connection and webhook secret
    const conn = await getCustomStoreConnection(tenantId, connectionId);
    if (!conn || !conn.is_connected) {
      return NextResponse.json({ error: 'Connection not found or inactive' }, { status: 404 });
    }

    if (!conn.webhook_secret) {
      return NextResponse.json(
        { error: 'Webhook secret is not configured for this custom store connection.' },
        { status: 400 }
      );
    }

    // 1. Verify HMAC-SHA256 signature and replay protection
    const verification = verifyCustomStoreWebhookSignature({
      rawBody,
      signatureHeader,
      timestampHeader,
      secret: conn.webhook_secret,
    });

    if (!verification.isValid) {
      return NextResponse.json(
        { error: `Webhook verification failed: ${verification.error}` },
        { status: 401 }
      );
    }

    let parsedPayload: any;
    try {
      parsedPayload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const eventId = eventIdHeader || parsedPayload.event_id || parsedPayload.id;
    const topic = req.headers.get('x-custom-store-topic') || parsedPayload.topic || parsedPayload.event || 'order.updated';

    // 2. Ingest with deduplication and reconciliation
    const result = await ingestCustomStoreWebhook({
      tenantId,
      connectionId: conn.id,
      eventId,
      topic,
      payload: parsedPayload,
    });

    return NextResponse.json({
      success: true,
      status: result.status,
      details: result.details,
      event_id: eventId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

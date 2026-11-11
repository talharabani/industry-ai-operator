import { NextRequest, NextResponse } from 'next/server';
import { getServerConfig } from '@/lib/config';
import {
  verifyShopifyWebhookHmac,
  getShopifyOAuthConfig,
  sanitizeShopDomain,
} from '@/lib/shopify-service';
import {
  query,
  disconnectShopify,
  upsertShopifyOrdersBatch,
  upsertShopifyProductsBatch,
  insertAudit,
} from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const hmacHeader = request.headers.get('x-shopify-hmac-sha256') || '';
    const topic = request.headers.get('x-shopify-topic') || '';
    const shopDomainHeader = request.headers.get('x-shopify-shop-domain') || '';
    const webhookId = request.headers.get('x-shopify-webhook-id') || `wh_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const config = getShopifyOAuthConfig(request.nextUrl.origin);
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET || config?.clientSecret || '';

    if (!secret) {
      console.warn('[Shopify Webhook] No webhook secret configured.');
    } else {
      const isValid = verifyShopifyWebhookHmac(rawBody, hmacHeader, secret);
      if (!isValid) {
        console.error('[Shopify Webhook HMAC Error] Signature verification failed for topic:', topic);
        return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
      }
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = { raw: rawBody };
    }

    const cleanShop = sanitizeShopDomain(shopDomainHeader) || '';

    // Resolve tenant_id for this shop
    let tenantId = 'demo-store';
    if (cleanShop) {
      const connRows = await query<{ tenant_id: string }>(
        `SELECT tenant_id FROM iao.shopify_connections WHERE shop_domain = $1 LIMIT 1;`,
        [cleanShop]
      );
      if (connRows[0]) {
        tenantId = connRows[0].tenant_id;
      }
    }

    // 1. Idempotent webhook logging
    try {
      await query(
        `INSERT INTO iao.webhook_events (id, provider, event_id, event_type, payload, status, created_at)
         VALUES ($1, 'shopify', $2, $3, $4::jsonb, 'processed', NOW())
         ON CONFLICT (event_id) DO NOTHING;`,
        [`wh-sp-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`, webhookId, topic, JSON.stringify(payload)]
      );
    } catch (logErr) {
      console.warn('[Webhook event log warning]', logErr);
    }

    // 2. Process topic-specific actions
    if (topic === 'app/uninstalled') {
      await disconnectShopify(tenantId);
      await insertAudit(tenantId, 'shopify_app_uninstalled', {
        shop_domain: cleanShop,
        webhook_id: webhookId,
      });
    } else if (topic === 'orders/create' || topic === 'orders/updated') {
      if (payload && (payload.id || payload.order_id)) {
        await upsertShopifyOrdersBatch(tenantId, [payload]);
        await insertAudit(tenantId, 'shopify_order_webhook_synced', {
          order_id: payload.id,
          topic,
        });
      }
    } else if (topic === 'products/create' || topic === 'products/update') {
      if (payload && (payload.id || payload.title)) {
        await upsertShopifyProductsBatch(tenantId, [payload]);
        await insertAudit(tenantId, 'shopify_product_webhook_synced', {
          product_id: payload.id,
          topic,
        });
      }
    }

    // 3. Optionally forward verified event reference to n8n if configured
    const serverConfig = getServerConfig();
    if (serverConfig.isN8nConfigured) {
      try {
        const n8nUrl = `${serverConfig.n8nBaseUrl}/webhook/iao/shopify/events`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (serverConfig.n8nOperatorKey) {
          headers['X-Operator-Key'] = serverConfig.n8nOperatorKey;
        }

        fetch(n8nUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tenant_id: tenantId,
            shop_domain: cleanShop,
            topic,
            webhook_id: webhookId,
            event_reference: {
              id: webhookId,
              topic,
              timestamp: new Date().toISOString(),
            },
          }),
        }).catch(() => {});
      } catch {
        // Non-blocking
      }
    }

    return NextResponse.json({
      success: true,
      topic,
      webhook_id: webhookId,
      status: 'processed',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Webhook handling failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

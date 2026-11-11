import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getServerConfig } from '@/lib/config';
import {
  getShopifyConnection,
  createShopifySyncJob,
  getShopifySyncJob,
  updateShopifySyncJob,
  upsertShopifyProductsBatch,
  upsertShopifyOrdersBatch,
  syncShopifyPoliciesToKnowledge,
} from '@/lib/db';
import {
  fetchShopifyProductsBatch,
  fetchShopifyOrdersBatch,
  fetchShopifyPolicies,
  isShopifyOrderAccessBlockedError,
} from '@/lib/shopify-service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    if (session.role === 'member') {
      return NextResponse.json(
        { error: 'Forbidden: Only owners and admins can trigger store sync.' },
        { status: 403 }
      );
    }

    const connection = await getShopifyConnection(tenantId);
    if (!connection) {
      return NextResponse.json(
        { error: 'No active Shopify store connected. Please connect your store first.' },
        { status: 400 }
      );
    }

    // Create sync job
    const job = await createShopifySyncJob({
      tenantId,
      shopDomain: connection.shop_domain,
      syncTypes: ['products', 'policies', 'orders', 'inventory'],
    });

    const config = getServerConfig();
    const isN8nTriggered = config.isN8nConfigured;

    if (isN8nTriggered) {
      // Notify n8n orchestration workflow
      try {
        const n8nUrl = `${config.n8nBaseUrl}/webhook/iao/shopify/sync`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.n8nOperatorKey) {
          headers['X-Operator-Key'] = config.n8nOperatorKey;
        }

        fetch(n8nUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tenant_id: tenantId,
            job_id: job.id,
            shop_domain: connection.shop_domain,
            sync_types: job.sync_types,
          }),
        }).catch((err) => {
          console.warn('[n8n sync dispatch notice]', err);
        });
      } catch {
        // Non-blocking
      }
    }

    // Run first-pass sync execution asynchronously or inline so user sees immediate results
    (async () => {
      const errors: Array<{ type: string; message: string; timestamp: string }> = [];
      let productsCount = 0;
      let ordersCount = 0;
      let policiesCount = 0;

      // 1. Sync Policies
      try {
        const policies = await fetchShopifyPolicies({
          shop: connection.shop_domain,
          accessToken: connection.access_token,
        });
        await syncShopifyPoliciesToKnowledge(tenantId, policies);
        policiesCount = 1;
      } catch (err: unknown) {
        errors.push({
          type: 'policies',
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
      }

      // 2. Sync Products (first batch)
      try {
        const prodRes = await fetchShopifyProductsBatch({
          shop: connection.shop_domain,
          accessToken: connection.access_token,
          limit: 50,
        });
        if (prodRes.products.length > 0) {
          const up = await upsertShopifyProductsBatch(tenantId, prodRes.products);
          productsCount = up.count;
        }
      } catch (err: unknown) {
        errors.push({
          type: 'products',
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
      }

      // 3. Sync Orders (first batch via GraphQL Admin API - no permissions bypass)
      try {
        const orderRes = await fetchShopifyOrdersBatch({
          shop: connection.shop_domain,
          accessToken: connection.access_token,
          limit: 50,
        });
        if (orderRes.orders.length > 0) {
          ordersCount = await upsertShopifyOrdersBatch(tenantId, orderRes.orders);
        }
      } catch (err: unknown) {
        const isBlocked = isShopifyOrderAccessBlockedError(err);
        const errMsg = isBlocked
          ? 'Products synced; order access blocked (Shopify Protected Customer Data approval required in Partner Dashboard)'
          : (err instanceof Error ? err.message : String(err));
        errors.push({
          type: 'orders',
          message: errMsg,
          timestamp: new Date().toISOString(),
        });
      }

      const hasErrors = errors.length > 0;
      const finalStatus = hasErrors
        ? (productsCount > 0 || ordersCount > 0 || policiesCount > 0 ? 'partial_failed' : 'failed')
        : 'completed';

      await updateShopifySyncJob(job.id, {
        status: finalStatus,
        summary: {
          products_synced: productsCount,
          orders_synced: ordersCount,
          policies_synced: policiesCount,
          errors_count: errors.length,
        },
        error_details: errors,
      });
    })().catch((bgErr) => {
      console.error('[Background sync error]', bgErr);
    });

    return NextResponse.json({
      success: true,
      job_id: job.id,
      tenant_id: tenantId,
      status: 'running',
      message: 'Store sync job initiated.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to trigger store sync';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

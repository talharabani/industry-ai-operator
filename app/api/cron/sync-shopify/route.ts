import { NextRequest, NextResponse } from 'next/server';
import { getServerConfig } from '@/lib/config';
import {
  listActiveShopifyTenants,
  getShopifyConnection,
  createShopifySyncJob,
  updateShopifySyncJob,
  upsertShopifyProductsBatch,
  upsertShopifyOrdersBatch,
  syncShopifyPoliciesToKnowledge,
  query,
} from '@/lib/db';
import {
  fetchShopifyProductsBatch,
  fetchShopifyOrdersBatch,
  fetchShopifyPolicies,
  isShopifyOrderAccessBlockedError,
} from '@/lib/shopify-service';

import { verifyOperatorOrCronAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface TenantSyncResult {
  status: 'completed' | 'partial_failed' | 'failed' | 'skipped_overlapping' | 'not_connected';
  shop_domain?: string;
  job_id?: string;
  products_synced?: number;
  orders_synced?: number;
  policies_synced?: number;
  errors?: Array<{ type: string; message: string; timestamp: string }>;
  reason?: string;
}

async function performScheduledShopifySyncForTenant(
  tenantId: string,
  options: {
    isMock?: boolean;
    mockProducts?: any[];
    mockOrders?: any[];
    mockPolicies?: any;
    force?: boolean;
  } = {}
): Promise<TenantSyncResult> {
  const connection = await getShopifyConnection(tenantId);
  if (!connection && !options.isMock) {
    return { status: 'not_connected', reason: 'No active Shopify connection found for tenant' };
  }

  const shopDomain = connection?.shop_domain || 'mock-shop.myshopify.com';

  // 1. Overlap Prevention: check for running jobs initiated within the last 15 minutes
  if (!options.force) {
    const runningJobs = await query<{ id: string; created_at: string }>(
      `SELECT id, created_at FROM iao.shopify_sync_jobs
       WHERE tenant_id = $1 AND status = 'running' AND created_at > NOW() - INTERVAL '15 minutes'
       ORDER BY created_at DESC LIMIT 1;`,
      [tenantId]
    );

    if (runningJobs.length > 0) {
      return {
        status: 'skipped_overlapping',
        shop_domain: shopDomain,
        job_id: runningJobs[0].id,
        reason: 'A sync job is already actively running for this tenant within the last 15 minutes.',
      };
    }
  }

  // 2. Create sync job
  const job = await createShopifySyncJob({
    tenantId,
    shopDomain,
    syncTypes: ['products', 'policies', 'orders', 'inventory'],
  });

  const errors: Array<{ type: string; message: string; timestamp: string }> = [];
  let productsCount = 0;
  let ordersCount = 0;
  let policiesCount = 0;

  // 3. Sync Policies
  try {
    let policies = options.mockPolicies || null;
    if (!policies && connection) {
      policies = await fetchShopifyPolicies({
        shop: connection.shop_domain,
        accessToken: connection.access_token,
      });
    }
    if (policies) {
      await syncShopifyPoliciesToKnowledge(tenantId, policies);
      policiesCount = 1;
    }
  } catch (policyErr: unknown) {
    const msg = policyErr instanceof Error ? policyErr.message : String(policyErr);
    errors.push({ type: 'policies', message: msg, timestamp: new Date().toISOString() });
  }

  // 4. Sync Products (with bounded pagination)
  try {
    if (options.mockProducts) {
      const up = await upsertShopifyProductsBatch(tenantId, options.mockProducts);
      productsCount = up.count;
    } else if (connection) {
      let pageCursor: string | undefined = undefined;
      let hasNext = true;
      let pagesFetched = 0;
      const maxPages = 20; // Up to 1,000 products per run

      while (hasNext && pagesFetched < maxPages) {
        pagesFetched++;
        const prodRes = await fetchShopifyProductsBatch({
          shop: connection.shop_domain,
          accessToken: connection.access_token,
          limit: 50,
          sinceId: pageCursor,
        });

        if (prodRes.products.length > 0) {
          const up = await upsertShopifyProductsBatch(tenantId, prodRes.products);
          productsCount += up.count;
        }

        hasNext = prodRes.hasNextPage;
        pageCursor = prodRes.nextSinceId || undefined;
        if (!pageCursor) break;
      }
    }
  } catch (prodErr: unknown) {
    const msg = prodErr instanceof Error ? prodErr.message : String(prodErr);
    errors.push({ type: 'products', message: msg, timestamp: new Date().toISOString() });
  }

  // 5. Sync Orders (with bounded pagination & PCD Protected Customer Data error handling)
  try {
    if (options.mockOrders) {
      ordersCount = await upsertShopifyOrdersBatch(tenantId, options.mockOrders);
    } else if (connection) {
      let pageCursor: string | undefined = undefined;
      let hasNext = true;
      let pagesFetched = 0;
      const maxPages = 20;

      while (hasNext && pagesFetched < maxPages) {
        pagesFetched++;
        const orderRes = await fetchShopifyOrdersBatch({
          shop: connection.shop_domain,
          accessToken: connection.access_token,
          limit: 50,
          sinceId: pageCursor,
        });

        if (orderRes.orders.length > 0) {
          const count = await upsertShopifyOrdersBatch(tenantId, orderRes.orders);
          ordersCount += count;
        }

        hasNext = orderRes.hasNextPage;
        pageCursor = orderRes.nextSinceId || undefined;
        if (!pageCursor) break;
      }
    }
  } catch (orderErr: unknown) {
    const isBlocked = isShopifyOrderAccessBlockedError(orderErr);
    const msg = isBlocked
      ? 'Products synced; order access blocked (Shopify Protected Customer Data approval required in Partner Dashboard)'
      : (orderErr instanceof Error ? orderErr.message : String(orderErr));
    errors.push({ type: 'orders', message: msg, timestamp: new Date().toISOString() });
  }

  // 6. Calculate final state and update sync job & connection
  const hasErrors = errors.length > 0;
  let finalStatus: 'completed' | 'partial_failed' | 'failed' = 'completed';

  if (hasErrors) {
    if (productsCount > 0 || ordersCount > 0 || policiesCount > 0) {
      finalStatus = 'partial_failed';
    } else {
      finalStatus = 'failed';
    }
  }

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

  return {
    status: finalStatus,
    shop_domain: shopDomain,
    job_id: job.id,
    products_synced: productsCount,
    orders_synced: ordersCount,
    policies_synced: policiesCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export async function GET(request: NextRequest) {
  return handleScheduledSync(request);
}

export async function POST(request: NextRequest) {
  return handleScheduledSync(request);
}

async function handleScheduledSync(request: NextRequest) {
  // 1. Authenticate Request via Operator Key / Cron Secret
  const auth = verifyOperatorOrCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized: Invalid operator key or cron secret.' },
      { status: 401 }
    );
  }

  // 2. Parse Request Parameters
  const { searchParams } = new URL(request.url);
  let body: Record<string, any> = {};
  if (request.method === 'POST') {
    body = await request.json().catch(() => ({}));
  }

  const requestedTenant = searchParams.get('tenant_id') || body.tenant_id;
  const isMock = body.is_mock === true;
  const force = body.force === true || searchParams.get('force') === 'true';

  // 3. Resolve Tenants
  let tenantsToSync: string[] = [];
  if (requestedTenant) {
    tenantsToSync = [requestedTenant];
  } else {
    const activeTenants = await listActiveShopifyTenants();
    tenantsToSync = activeTenants.map((t) => t.tenant_id);
  }

  if (tenantsToSync.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No active Shopify stores connected for synchronization.',
      tenants_synced: 0,
      results: {},
      timestamp: new Date().toISOString(),
    });
  }

  // 4. Execute Isolated Synchronization per Tenant
  const results: Record<string, TenantSyncResult> = {};
  let successfulCount = 0;
  let partialCount = 0;
  let failedCount = 0;

  for (const tenantId of tenantsToSync) {
    try {
      const res = await performScheduledShopifySyncForTenant(tenantId, {
        isMock,
        mockProducts: body.mock_products,
        mockOrders: body.mock_orders,
        mockPolicies: body.mock_policies,
        force,
      });

      results[tenantId] = res;
      if (res.status === 'completed') successfulCount++;
      else if (res.status === 'partial_failed') partialCount++;
      else if (res.status === 'failed') failedCount++;
    } catch (tenantErr: unknown) {
      const errMessage = tenantErr instanceof Error ? tenantErr.message : String(tenantErr);
      results[tenantId] = {
        status: 'failed',
        reason: `Unexpected tenant synchronization error: ${errMessage}`,
      };
      failedCount++;
    }
  }

  return NextResponse.json({
    success: failedCount === 0 || successfulCount > 0 || partialCount > 0,
    tenants_count: tenantsToSync.length,
    successful_count: successfulCount,
    partial_count: partialCount,
    failed_count: failedCount,
    results,
    timestamp: new Date().toISOString(),
  });
}

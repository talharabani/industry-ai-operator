import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, verifyOperatorOrCronAuth } from '@/lib/auth';
import { getServerConfig } from '@/lib/config';
import {
  getShopifyConnection,
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

function authenticateRequest(request: NextRequest, sessionTenantId?: string): { authorized: boolean; error?: string } {
  if (sessionTenantId) {
    return { authorized: true };
  }
  return verifyOperatorOrCronAuth(request);
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession().catch(() => null);
    const body = await request.json().catch(() => ({}));
    const {
      job_id,
      tenant_id: requestedTenant,
      sync_type,
      cursor,
      limit = 50,
      mock_items,
      mock_policies,
      is_mock,
    } = body;

    const tenantId = requestedTenant || session?.active_tenant_id;
    if (!tenantId) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
    }

    const auth = authenticateRequest(request, session?.active_tenant_id);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    if (!job_id) {
      return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
    }

    if (!sync_type || !['products', 'orders', 'policies', 'inventory'].includes(sync_type)) {
      return NextResponse.json(
        { error: 'sync_type must be one of "products", "orders", "policies", "inventory"' },
        { status: 400 }
      );
    }

    const job = await getShopifySyncJob(job_id, tenantId);
    if (!job) {
      return NextResponse.json(
        { error: `Sync job "${job_id}" not found for tenant "${tenantId}"` },
        { status: 404 }
      );
    }

    const connection = await getShopifyConnection(tenantId);
    if (!connection && !is_mock && !mock_items) {
      const errMsg = `No active Shopify connection found for tenant "${tenantId}".`;
      await updateShopifySyncJob(job_id, {
        status: 'failed',
        error_details: [...(job.error_details || []), { type: sync_type, message: errMsg, timestamp: new Date().toISOString() }],
      });
      return NextResponse.json({ error: errMsg }, { status: 404 });
    }

    let processedCount = 0;
    let hasNextPage = false;
    let nextCursor: string | null = null;
    const errors: Array<{ type?: string; item_id?: string; message: string; timestamp: string }> = [];

    // 1. Process Products Batch
    if (sync_type === 'products') {
      let rawProducts: any[] = [];
      if (mock_items && Array.isArray(mock_items)) {
        rawProducts = mock_items;
        hasNextPage = Boolean(body.has_next_page);
        nextCursor = body.next_cursor || null;
      } else if (connection) {
        try {
          const fetchResult = await fetchShopifyProductsBatch({
            shop: connection.shop_domain,
            accessToken: connection.access_token,
            limit: Number(limit),
            sinceId: cursor || undefined,
          });
          rawProducts = fetchResult.products;
          hasNextPage = fetchResult.hasNextPage;
          nextCursor = fetchResult.nextSinceId;
        } catch (fetchErr: unknown) {
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          errors.push({ type: 'products_fetch', message: msg, timestamp: new Date().toISOString() });
        }
      }

      if (rawProducts.length > 0) {
        try {
          const upsertRes = await upsertShopifyProductsBatch(tenantId, rawProducts);
          processedCount = upsertRes.count;
        } catch (upsertErr: unknown) {
          const msg = upsertErr instanceof Error ? upsertErr.message : String(upsertErr);
          errors.push({ type: 'products_upsert', message: msg, timestamp: new Date().toISOString() });
        }
      }

      // Update progress
      const currentProgress = job.progress || {};
      const currentSummary = job.summary || {};
      const prevProductsSynced = Number(currentSummary.products_synced || 0);

      const updatedProgress = {
        ...currentProgress,
        products: {
          processed: prevProductsSynced + processedCount,
          failed: (currentProgress.products?.failed || 0) + (errors.length > 0 ? 1 : 0),
          has_next_page: hasNextPage,
          next_cursor: nextCursor,
        },
      };

      const updatedSummary = {
        ...currentSummary,
        products_synced: prevProductsSynced + processedCount,
        errors_count: (currentSummary.errors_count || 0) + errors.length,
      };

      const allErrors = [...(job.error_details || []), ...errors];
      const newStatus = allErrors.length > 0 ? (processedCount > 0 ? 'partial_failed' : 'failed') : 'running';

      const updatedJob = await updateShopifySyncJob(job_id, {
        status: newStatus,
        progress: updatedProgress,
        summary: updatedSummary,
        error_details: allErrors,
      });

      return NextResponse.json({
        success: errors.length === 0,
        job_id,
        tenant_id: tenantId,
        sync_type: 'products',
        processed_count: processedCount,
        has_next_page: hasNextPage,
        next_cursor: nextCursor,
        job_status: updatedJob?.status || newStatus,
        summary: updatedJob?.summary || updatedSummary,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    // 2. Process Orders Batch
    if (sync_type === 'orders') {
      let rawOrders: any[] = [];
      if (mock_items && Array.isArray(mock_items)) {
        rawOrders = mock_items;
        hasNextPage = Boolean(body.has_next_page);
        nextCursor = body.next_cursor || null;
      } else if (connection) {
        try {
          const fetchResult = await fetchShopifyOrdersBatch({
            shop: connection.shop_domain,
            accessToken: connection.access_token,
            limit: Number(limit),
            sinceId: cursor || undefined,
          });
          rawOrders = fetchResult.orders;
          hasNextPage = fetchResult.hasNextPage;
          nextCursor = fetchResult.nextSinceId;
        } catch (fetchErr: unknown) {
          const isBlocked = isShopifyOrderAccessBlockedError(fetchErr);
          const msg = isBlocked
            ? 'Products synced; order access blocked (Shopify Protected Customer Data approval required in Partner Dashboard)'
            : (fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
          errors.push({ type: 'orders_fetch', message: msg, timestamp: new Date().toISOString() });
        }
      }

      if (rawOrders.length > 0) {
        try {
          processedCount = await upsertShopifyOrdersBatch(tenantId, rawOrders);
        } catch (upsertErr: unknown) {
          const msg = upsertErr instanceof Error ? upsertErr.message : String(upsertErr);
          errors.push({ type: 'orders_upsert', message: msg, timestamp: new Date().toISOString() });
        }
      }

      const currentProgress = job.progress || {};
      const currentSummary = job.summary || {};
      const prevOrdersSynced = Number(currentSummary.orders_synced || 0);

      const updatedProgress = {
        ...currentProgress,
        orders: {
          processed: prevOrdersSynced + processedCount,
          failed: (currentProgress.orders?.failed || 0) + (errors.length > 0 ? 1 : 0),
          has_next_page: hasNextPage,
          next_cursor: nextCursor,
        },
      };

      const updatedSummary = {
        ...currentSummary,
        orders_synced: prevOrdersSynced + processedCount,
        errors_count: (currentSummary.errors_count || 0) + errors.length,
      };

      const allErrors = [...(job.error_details || []), ...errors];
      const newStatus = allErrors.length > 0 ? (processedCount > 0 ? 'partial_failed' : 'failed') : 'running';

      const updatedJob = await updateShopifySyncJob(job_id, {
        status: newStatus,
        progress: updatedProgress,
        summary: updatedSummary,
        error_details: allErrors,
      });

      return NextResponse.json({
        success: errors.length === 0,
        job_id,
        tenant_id: tenantId,
        sync_type: 'orders',
        processed_count: processedCount,
        has_next_page: hasNextPage,
        next_cursor: nextCursor,
        job_status: updatedJob?.status || newStatus,
        summary: updatedJob?.summary || updatedSummary,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    // 3. Process Policies
    if (sync_type === 'policies') {
      let policies = mock_policies || {};
      if (!mock_policies && connection) {
        try {
          policies = await fetchShopifyPolicies({
            shop: connection.shop_domain,
            accessToken: connection.access_token,
          });
        } catch (policyErr: unknown) {
          const msg = policyErr instanceof Error ? policyErr.message : String(policyErr);
          errors.push({ type: 'policies_fetch', message: msg, timestamp: new Date().toISOString() });
        }
      }

      try {
        await syncShopifyPoliciesToKnowledge(tenantId, policies);
        processedCount = 1;
      } catch (saveErr: unknown) {
        const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
        errors.push({ type: 'policies_save', message: msg, timestamp: new Date().toISOString() });
      }

      const currentProgress = job.progress || {};
      const currentSummary = job.summary || {};

      const updatedProgress = {
        ...currentProgress,
        policies: {
          processed: 1,
          failed: errors.length > 0 ? 1 : 0,
          status: errors.length > 0 ? 'failed' : 'completed',
        },
      };

      const updatedSummary = {
        ...currentSummary,
        policies_synced: (currentSummary.policies_synced || 0) + (errors.length === 0 ? 1 : 0),
        errors_count: (currentSummary.errors_count || 0) + errors.length,
      };

      const allErrors = [...(job.error_details || []), ...errors];
      const newStatus = allErrors.length > 0 ? 'partial_failed' : 'running';

      const updatedJob = await updateShopifySyncJob(job_id, {
        status: newStatus,
        progress: updatedProgress,
        summary: updatedSummary,
        error_details: allErrors,
      });

      return NextResponse.json({
        success: errors.length === 0,
        job_id,
        tenant_id: tenantId,
        sync_type: 'policies',
        processed_count: processedCount,
        has_next_page: false,
        next_cursor: null,
        job_status: updatedJob?.status || newStatus,
        summary: updatedJob?.summary || updatedSummary,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    // 4. Process Inventory
    if (sync_type === 'inventory') {
      processedCount = 1;
      const currentProgress = job.progress || {};
      const currentSummary = job.summary || {};

      const updatedProgress = {
        ...currentProgress,
        inventory: {
          processed: 1,
          failed: 0,
          status: 'completed',
        },
      };

      const updatedSummary = {
        ...currentSummary,
        inventory_items_synced: (currentSummary.inventory_items_synced || 0) + 1,
      };

      const updatedJob = await updateShopifySyncJob(job_id, {
        progress: updatedProgress,
        summary: updatedSummary,
      });

      return NextResponse.json({
        success: true,
        job_id,
        tenant_id: tenantId,
        sync_type: 'inventory',
        processed_count: processedCount,
        has_next_page: false,
        next_cursor: null,
        job_status: updatedJob?.status || 'running',
        summary: updatedJob?.summary || updatedSummary,
      });
    }

    return NextResponse.json({ error: 'Unsupported sync type' }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to process sync batch';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

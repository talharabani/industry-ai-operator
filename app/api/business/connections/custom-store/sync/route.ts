import { NextRequest, NextResponse } from 'next/server';
import {
  startCustomStoreSyncJob,
  fetchCustomStorePage,
  ingestCustomStoreBatch,
  finishCustomStoreSyncJob,
  getCustomStorePublicConfig,
} from '@/lib/custom-store-service';

function getSessionTenantId(req: NextRequest): string {
  const sessionCookie = req.cookies.get('iao_session');
  if (sessionCookie) {
    try {
      const decoded = JSON.parse(Buffer.from(sessionCookie.value, 'base64').toString('utf8'));
      if (decoded.active_tenant_id) return decoded.active_tenant_id;
    } catch {
      // ignore
    }
  }
  return req.headers.get('x-tenant-id') || 'demo-store';
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = getSessionTenantId(req);
    const body = await req.json().catch(() => ({}));

    // 1. Start Job
    const { job, maxPagesPerRun } = await startCustomStoreSyncJob(tenantId, body.connection_id);

    let storeInfoFetched = null;
    let productsSynced = 0;
    let ordersSynced = 0;
    const errors: any[] = [];

    // 2. Fetch Store Profile
    try {
      const storeRes = await fetchCustomStorePage({
        jobId: job.id,
        resourceType: 'store',
      });
      storeInfoFetched = storeRes.data;
      await ingestCustomStoreBatch({
        jobId: job.id,
        resourceType: 'store',
        storeInfo: storeInfoFetched,
      });
    } catch (err: unknown) {
      errors.push({ stage: 'store', message: err instanceof Error ? err.message : String(err) });
    }

    // 3. Fetch Products (bounded pages)
    for (let page = 1; page <= maxPagesPerRun; page++) {
      try {
        const prodRes = await fetchCustomStorePage({
          jobId: job.id,
          resourceType: 'products',
          page,
          limit: 50,
        });
        const items = prodRes.data?.products || [];
        if (items.length > 0) {
          const ingestResult = await ingestCustomStoreBatch({
            jobId: job.id,
            resourceType: 'products',
            items,
            page,
          });
          productsSynced += ingestResult.processedCount;
          if (ingestResult.errors.length > 0) {
            errors.push(...ingestResult.errors);
          }
        }
        if (!prodRes.data?.pagination?.has_next_page) break;
      } catch (err: unknown) {
        errors.push({ stage: 'products', message: err instanceof Error ? err.message : String(err) });
        break;
      }
    }

    // 4. Fetch Orders (bounded pages)
    for (let page = 1; page <= maxPagesPerRun; page++) {
      try {
        const orderRes = await fetchCustomStorePage({
          jobId: job.id,
          resourceType: 'orders',
          page,
          limit: 50,
        });
        const items = orderRes.data?.orders || [];
        if (items.length > 0) {
          const ingestResult = await ingestCustomStoreBatch({
            jobId: job.id,
            resourceType: 'orders',
            items,
            page,
          });
          ordersSynced += ingestResult.processedCount;
          if (ingestResult.errors.length > 0) {
            errors.push(...ingestResult.errors);
          }
        }
        if (!orderRes.data?.pagination?.has_next_page) break;
      } catch (err: unknown) {
        errors.push({ stage: 'orders', message: err instanceof Error ? err.message : String(err) });
        break;
      }
    }

    // 5. Finish Job
    const finalStatus = errors.length > 0 ? (productsSynced > 0 || ordersSynced > 0 ? 'partial_failed' : 'failed') : 'completed';
    const finishedJob = await finishCustomStoreSyncJob({
      jobId: job.id,
      status: finalStatus,
      summary: { products_synced: productsSynced, orders_synced: ordersSynced },
      errorDetails: errors,
    });

    const publicConfig = await getCustomStorePublicConfig(tenantId, job.connection_id);

    return NextResponse.json({
      success: finalStatus !== 'failed',
      status: finalStatus,
      job: finishedJob,
      custom_store: publicConfig,
      summary: {
        products_synced: productsSynced,
        orders_synced: ordersSynced,
        errors,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { ingestCustomStoreBatch } from '@/lib/custom-store-service';
import { verifyOperatorOrCronAuth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  const auth = verifyOperatorOrCronAuth(req);
  if (!auth.authorized) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized: Invalid operator key.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      job_id,
      tenant_id,
      resource_type,
      items,
      store_info,
      page = 1,
      limit = 50,
      max_pages = 5,
      has_next_page = false,
      status = 'completed',
      error_details = [],
    } = body;

    if (!job_id) {
      return NextResponse.json({ error: 'Missing job_id' }, { status: 400 });
    }
    if (!resource_type || !['store', 'products', 'orders'].includes(resource_type)) {
      return NextResponse.json({ error: 'resource_type must be "store", "products", or "orders"' }, { status: 400 });
    }

    const effectiveTenantId = tenant_id || req.headers.get('x-tenant-id');
    if (effectiveTenantId) {
      const jobRows = await query<{ tenant_id: string }>('SELECT tenant_id FROM iao.custom_store_sync_jobs WHERE id = $1 LIMIT 1;', [job_id]);
      if (jobRows.length === 0 || jobRows[0].tenant_id !== effectiveTenantId.trim()) {
        return NextResponse.json({ success: false, error: 'Forbidden: Tenant does not own this sync job.' }, { status: 403 });
      }
    }

    const result = await ingestCustomStoreBatch({
      jobId: job_id,
      resourceType: resource_type,
      items,
      storeInfo: store_info,
      page,
    });

    const isDegraded = !result.success || result.errorCount > 0;
    const finalStatus = isDegraded ? (status === 'failed' ? 'failed' : 'partial_failed') : status;
    const combinedErrors = Array.isArray(result.errors) && result.errors.length > 0
      ? [...(Array.isArray(error_details) ? error_details : []), ...result.errors]
      : (Array.isArray(error_details) ? error_details : []);

    return NextResponse.json({
      success: result.success,
      job_id,
      tenant_id: result.tenantId,
      connection_id: result.connectionId,
      resource_type,
      page,
      limit,
      max_pages,
      has_next_page,
      status: finalStatus,
      error_details: combinedErrors,
      processed_count: result.processedCount,
      error_count: result.errorCount,
      errors: result.errors,
      summary: result.summary,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { fetchCustomStorePage } from '@/lib/custom-store-service';
import { verifyOperatorOrCronAuth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const auth = verifyOperatorOrCronAuth(req);
  if (!auth.authorized) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized: Invalid operator key.' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('job_id');
    const tenantId = searchParams.get('tenant_id') || req.headers.get('x-tenant-id');
    const resourceType = searchParams.get('resource_type') as 'store' | 'products' | 'orders';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const maxPages = parseInt(searchParams.get('max_pages') || '5', 10);
    const since = searchParams.get('since') || undefined;

    if (!jobId) {
      return NextResponse.json({ error: 'Missing job_id' }, { status: 400 });
    }
    if (!resourceType || !['store', 'products', 'orders'].includes(resourceType)) {
      return NextResponse.json({ error: 'resource_type must be "store", "products", or "orders"' }, { status: 400 });
    }

    if (tenantId) {
      const jobRows = await query<{ tenant_id: string }>('SELECT tenant_id FROM iao.custom_store_sync_jobs WHERE id = $1 LIMIT 1;', [jobId]);
      if (jobRows.length === 0 || jobRows[0].tenant_id !== tenantId.trim()) {
        return NextResponse.json({ success: false, error: 'Forbidden: Tenant does not own this sync job.' }, { status: 403 });
      }
    }

    const result = await fetchCustomStorePage({
      jobId,
      resourceType,
      page,
      limit,
      since,
    });

    return NextResponse.json({
      success: true,
      job_id: jobId,
      tenant_id: result.tenantId,
      connection_id: result.connectionId,
      resource_type: resourceType,
      page,
      limit,
      max_pages: maxPages,
      summary: result.summary,
      data: result.data,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

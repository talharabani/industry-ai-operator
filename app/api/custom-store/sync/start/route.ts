import { NextRequest, NextResponse } from 'next/server';
import { startCustomStoreSyncJob } from '@/lib/custom-store-service';
import { verifyOperatorOrCronAuth } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const auth = verifyOperatorOrCronAuth(req);
  if (!auth.authorized) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized: Invalid operator key.' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawTenantId = body.tenant_id || req.headers.get('x-tenant-id');
    if (!rawTenantId || typeof rawTenantId !== 'string' || !rawTenantId.trim()) {
      return NextResponse.json(
        { success: false, error: 'Missing required tenant scope: tenant_id is required. Missing sandbox scope fails closed.' },
        { status: 400 }
      );
    }
    const tenantId = rawTenantId.trim();
    const connectionId = body.connection_id;

    const result = await startCustomStoreSyncJob(tenantId, connectionId);

    return NextResponse.json({
      success: true,
      job_id: result.job.id,
      tenant_id: result.job.tenant_id,
      connection_id: result.job.connection_id,
      store_name: result.connection.store_name,
      api_base_url: result.connection.api_base_url,
      checkpoint: result.connection.sync_checkpoint || {},
      max_pages_per_run: result.maxPagesPerRun,
      page_size: result.pageSize,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}

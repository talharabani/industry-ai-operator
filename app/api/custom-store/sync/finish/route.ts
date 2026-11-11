import { NextRequest, NextResponse } from 'next/server';
import { finishCustomStoreSyncJob } from '@/lib/custom-store-service';
import { verifyOperatorOrCronAuth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  const auth = verifyOperatorOrCronAuth(req);
  if (!auth.authorized) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized: Invalid operator key.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { job_id, tenant_id, status = 'completed', summary = {}, error_details = [], checkpoint } = body;

    if (!job_id) {
      return NextResponse.json({ error: 'Missing job_id' }, { status: 400 });
    }

    const effectiveTenantId = tenant_id || req.headers.get('x-tenant-id');
    if (effectiveTenantId) {
      const jobRows = await query<{ tenant_id: string }>('SELECT tenant_id FROM iao.custom_store_sync_jobs WHERE id = $1 LIMIT 1;', [job_id]);
      if (jobRows.length === 0 || jobRows[0].tenant_id !== effectiveTenantId.trim()) {
        return NextResponse.json({ success: false, error: 'Forbidden: Tenant does not own this sync job.' }, { status: 403 });
      }
    }

    const resolvedCheckpoint = checkpoint || (summary as Record<string, unknown>)?.checkpoint;

    const job = await finishCustomStoreSyncJob({
      jobId: job_id,
      status,
      summary: { ...summary, ...(resolvedCheckpoint ? { checkpoint: resolvedCheckpoint } : {}) },
      errorDetails: error_details,
      checkpoint: resolvedCheckpoint,
    });

    return NextResponse.json({
      success: job.status !== 'failed',
      job,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}

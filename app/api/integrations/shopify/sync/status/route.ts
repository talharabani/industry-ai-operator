import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getServerConfig } from '@/lib/config';
import { getShopifySyncJob, updateShopifySyncJob } from '@/lib/db';

export const dynamic = 'force-dynamic';

function authenticateRequest(request: NextRequest, tenantId?: string): { authorized: boolean; error?: string } {
  const config = getServerConfig();
  const operatorKeyHeader = request.headers.get('x-operator-key');
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

  const keyProvided = operatorKeyHeader || bearerToken;
  if (config.n8nOperatorKey && keyProvided === config.n8nOperatorKey) {
    return { authorized: true };
  }

  if (tenantId) {
    return { authorized: true };
  }

  if (!config.n8nOperatorKey) {
    return { authorized: true };
  }

  return { authorized: false, error: 'Unauthorized: Invalid operator key.' };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession().catch(() => null);
    const searchParams = request.nextUrl.searchParams;
    const jobId = searchParams.get('job_id');
    const requestedTenant = searchParams.get('tenant_id') || session?.active_tenant_id;

    if (!jobId) {
      return NextResponse.json({ error: 'job_id query parameter is required' }, { status: 400 });
    }

    const auth = authenticateRequest(request, requestedTenant);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const job = await getShopifySyncJob(jobId, requestedTenant);
    if (!job) {
      return NextResponse.json(
        { error: `Sync job "${jobId}" not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve job status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession().catch(() => null);
    const body = await request.json().catch(() => ({}));
    const { job_id, tenant_id: requestedTenant, status, summary, error_details } = body;

    if (!job_id) {
      return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
    }

    const tenantId = requestedTenant || session?.active_tenant_id;
    const auth = authenticateRequest(request, tenantId);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const job = await getShopifySyncJob(job_id, tenantId);
    if (!job) {
      return NextResponse.json(
        { error: `Sync job "${job_id}" not found` },
        { status: 404 }
      );
    }

    const updatedJob = await updateShopifySyncJob(job_id, {
      status,
      summary,
      error_details,
    });

    return NextResponse.json({
      success: true,
      job: updatedJob,
      message: `Sync job status updated to ${status}.`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update job status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

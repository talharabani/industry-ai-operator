import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getServerConfig } from '@/lib/config';
import {
  getShopifyConnection,
  createShopifySyncJob,
  listShopifySyncJobs,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

function authenticateRequest(request: NextRequest, sessionTenantId?: string): { authorized: boolean; tenantId: string; error?: string } {
  const config = getServerConfig();
  const operatorKeyHeader = request.headers.get('x-operator-key');
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

  const keyProvided = operatorKeyHeader || bearerToken;
  if (config.n8nOperatorKey && keyProvided === config.n8nOperatorKey) {
    return { authorized: true, tenantId: sessionTenantId || config.tenantId };
  }

  if (sessionTenantId) {
    return { authorized: true, tenantId: sessionTenantId };
  }

  if (!config.n8nOperatorKey && !sessionTenantId) {
    // Demo fallback when operator key is unset
    return { authorized: true, tenantId: config.tenantId };
  }

  return { authorized: false, tenantId: '', error: 'Unauthorized: Invalid operator key or missing session.' };
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession().catch(() => null);
    const body = await request.json().catch(() => ({}));
    const requestedTenant = body.tenant_id || session?.active_tenant_id;

    const auth = authenticateRequest(request, requestedTenant);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const tenantId = requestedTenant || auth.tenantId;
    const connection = await getShopifyConnection(tenantId);

    if (!connection) {
      return NextResponse.json(
        {
          error: `No active Shopify store connection found for business "${tenantId}". Please connect Shopify first in Settings.`,
          tenant_id: tenantId,
        },
        { status: 404 }
      );
    }

    const syncTypes = Array.isArray(body.sync_types) && body.sync_types.length > 0
      ? body.sync_types
      : ['products', 'inventory', 'policies', 'orders'];

    const job = await createShopifySyncJob({
      tenantId,
      shopDomain: connection.shop_domain,
      syncTypes,
    });

    return NextResponse.json({
      success: true,
      job_id: job.id,
      tenant_id: tenantId,
      shop_domain: connection.shop_domain,
      status: job.status,
      sync_types: job.sync_types,
      progress: job.progress,
      summary: job.summary,
      created_at: job.created_at,
      message: 'Sync job created and ready for orchestration.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to start sync job';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession().catch(() => null);
    const searchParams = request.nextUrl.searchParams;
    const requestedTenant = searchParams.get('tenant_id') || session?.active_tenant_id;

    const auth = authenticateRequest(request, requestedTenant);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const tenantId = requestedTenant || auth.tenantId;
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const jobs = await listShopifySyncJobs(tenantId, limit);

    return NextResponse.json({
      success: true,
      tenant_id: tenantId,
      jobs,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve sync jobs';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

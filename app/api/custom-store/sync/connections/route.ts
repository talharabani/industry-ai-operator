import { NextRequest, NextResponse } from 'next/server';
import { listCustomStoreConnections } from '@/lib/custom-store-service';
import { verifyOperatorOrCronAuth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const auth = verifyOperatorOrCronAuth(req);
  if (!auth.authorized) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized: Invalid operator key.' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const rawTenantId = searchParams.get('tenant_id') || req.headers.get('x-tenant-id');
    if (!rawTenantId || !rawTenantId.trim()) {
      return NextResponse.json(
        { success: false, error: 'Missing required tenant scope: tenant_id is required and cannot be empty. Missing sandbox scope fails closed.' },
        { status: 400 }
      );
    }
    const tenantId = rawTenantId.trim();

    // Verify tenant exists
    const bizCheck = await query<{ tenant_id: string }>('SELECT tenant_id FROM iao.businesses WHERE tenant_id = $1 LIMIT 1;', [tenantId]);
    if (bizCheck.length === 0) {
      return NextResponse.json(
        { success: false, error: `Business workspace '${tenantId}' not found.` },
        { status: 404 }
      );
    }

    const connections = await listCustomStoreConnections(tenantId);

    return NextResponse.json({
      success: true,
      tenant_id: tenantId || null,
      connections: connections.map((c) => ({
        connection_id: c.id,
        tenant_id: c.tenant_id,
        store_name: c.store_name,
        website_url: c.website_url,
        api_base_url: c.api_base_url,
        is_connected: c.is_connected,
        sync_status: c.sync_status,
        last_synced_at: c.last_synced_at,
        product_count: c.product_count,
        order_count: c.order_count,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

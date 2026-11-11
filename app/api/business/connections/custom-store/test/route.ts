import { NextRequest, NextResponse } from 'next/server';
import { testCustomStoreConnection } from '@/lib/custom-store-service';

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

    const result = await testCustomStoreConnection({
      tenantId,
      connectionId: body.connection_id,
      apiBaseUrl: body.api_base_url,
      apiKey: body.api_key,
      authType: body.auth_type,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, latency_ms: result.latencyMs },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      store_info: result.storeInfo,
      latency_ms: result.latencyMs,
      message: 'Connection verified successfully.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import {
  createOrUpdateCustomStoreConnection,
  getCustomStorePublicConfig,
  disconnectCustomStoreConnection,
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

export async function GET(req: NextRequest) {
  try {
    const tenantId = getSessionTenantId(req);
    const config = await getCustomStorePublicConfig(tenantId);
    return NextResponse.json({
      success: true,
      custom_store: config,
      connection: config,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = getSessionTenantId(req);
    const body = await req.json();

    const {
      store_name,
      website_url,
      api_base_url,
      auth_type = 'bearer',
      api_key,
      username,
      password,
      webhook_secret,
      connection_id,
    } = body;

    const saved = await createOrUpdateCustomStoreConnection({
      tenantId,
      id: connection_id,
      storeName: store_name,
      websiteUrl: website_url,
      apiBaseUrl: api_base_url,
      authType: auth_type,
      apiKey: api_key,
      username,
      password,
      webhookSecret: webhook_secret,
    });

    const publicConfig = await getCustomStorePublicConfig(tenantId, saved.id);

    return NextResponse.json({
      success: true,
      custom_store: publicConfig,
      connection: publicConfig,
      message: 'Custom Store connection saved successfully.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const tenantId = getSessionTenantId(req);
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connection_id') || undefined;

    const result = await disconnectCustomStoreConnection(tenantId, connectionId);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

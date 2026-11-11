import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getPublicShopifyConfig, disconnectShopify } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    const publicConfig = await getPublicShopifyConfig(tenantId);
    return NextResponse.json({
      success: true,
      tenant_id: tenantId,
      shopify: publicConfig,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve Shopify configuration';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    if (session.role === 'member') {
      return NextResponse.json(
        { error: 'Forbidden: Only business owners and administrators can disconnect Shopify stores.' },
        { status: 403 }
      );
    }

    await disconnectShopify(tenantId);
    const publicConfig = await getPublicShopifyConfig(tenantId);

    return NextResponse.json({
      success: true,
      message: 'Shopify store disconnected successfully. Active sync stopped.',
      shopify: publicConfig,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to disconnect Shopify store';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

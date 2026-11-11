import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorOrCronAuth } from '@/lib/cron-auth';
import { getBusiness } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Runtime in-memory active sandbox scope for Custom Store Sync
let activeCustomStoreScope: {
  sandbox_tenant_id: string | null;
  target_connection_id: string;
  mock: boolean;
  updated_at: string;
} = {
  sandbox_tenant_id: null,
  target_connection_id: '',
  mock: true,
  updated_at: new Date().toISOString(),
};

export async function GET(request: NextRequest) {
  try {
    const auth = verifyOperatorOrCronAuth(request);
    if (!auth.authorized) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid operator credentials or cron secret required.' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      sandbox_tenant_id: activeCustomStoreScope.sandbox_tenant_id,
      target_connection_id: activeCustomStoreScope.target_connection_id,
      mock: activeCustomStoreScope.mock,
      updated_at: activeCustomStoreScope.updated_at,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to get custom store sandbox scope';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = verifyOperatorOrCronAuth(request);
    if (!auth.authorized) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid operator credentials or cron secret required.' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const rawTenantId = body.sandbox_tenant_id ?? body.tenant_id ?? null;
    const connectionId = typeof body.connection_id === 'string' ? body.connection_id.trim() : (body.target_connection_id || '');
    const isMock = body.mock !== undefined ? Boolean(body.mock) : true;

    if (rawTenantId === null || rawTenantId === undefined || rawTenantId === '') {
      activeCustomStoreScope = {
        sandbox_tenant_id: null,
        target_connection_id: '',
        mock: isMock,
        updated_at: new Date().toISOString(),
      };
      return NextResponse.json({
        success: true,
        message: 'Custom Store sandbox scope cleared.',
        sandbox_tenant_id: null,
        mock: isMock,
      });
    }

    const cleanTenantId = String(rawTenantId).trim();

    // 1. Validate scope exists in database
    const biz = await getBusiness(cleanTenantId);
    if (!biz) {
      return NextResponse.json(
        { error: `Business workspace '${cleanTenantId}' not found.` },
        { status: 404 }
      );
    }

    activeCustomStoreScope = {
      sandbox_tenant_id: cleanTenantId,
      target_connection_id: connectionId,
      mock: isMock,
      updated_at: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      message: `Active custom store sandbox scope set to '${cleanTenantId}'.`,
      sandbox_tenant_id: cleanTenantId,
      target_connection_id: connectionId,
      mock: isMock,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to set custom store sandbox scope';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

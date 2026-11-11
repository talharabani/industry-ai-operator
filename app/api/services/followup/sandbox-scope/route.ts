import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorOrCronAuth } from '@/lib/cron-auth';
import { getBusiness } from '@/lib/db';

export const dynamic = 'force-dynamic';

// In-memory runtime active sandbox scope state
let activeSandboxScope: {
  sandbox_tenant_id: string | null;
  mock: boolean;
  updated_at: string;
} = {
  sandbox_tenant_id: null,
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
      sandbox_tenant_id: activeSandboxScope.sandbox_tenant_id,
      mock: activeSandboxScope.mock,
      updated_at: activeSandboxScope.updated_at,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to get sandbox scope';
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
    const isMock = body.mock !== undefined ? Boolean(body.mock) : true;

    if (rawTenantId === null || rawTenantId === undefined || rawTenantId === '') {
      activeSandboxScope = {
        sandbox_tenant_id: null,
        mock: isMock,
        updated_at: new Date().toISOString(),
      };
      return NextResponse.json({
        success: true,
        message: 'Sandbox scope cleared.',
        sandbox_tenant_id: null,
        mock: isMock,
      });
    }

    const cleanTenantId = String(rawTenantId).trim();

    // 1. Validate scope format: must target a sandbox or test tenant
    if (!cleanTenantId.startsWith('sandbox-') && !cleanTenantId.startsWith('test-')) {
      return NextResponse.json(
        { error: `Unauthorized sandbox scope: '${cleanTenantId}' is not an authorized sandbox business workspace.` },
        { status: 403 }
      );
    }

    // 2. Validate scope exists in database
    const biz = await getBusiness(cleanTenantId);
    if (!biz) {
      return NextResponse.json(
        { error: `Business workspace '${cleanTenantId}' not found.` },
        { status: 404 }
      );
    }

    activeSandboxScope = {
      sandbox_tenant_id: cleanTenantId,
      mock: isMock,
      updated_at: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      message: `Active sandbox scope set to '${cleanTenantId}'.`,
      sandbox_tenant_id: cleanTenantId,
      mock: isMock,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to set sandbox scope';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

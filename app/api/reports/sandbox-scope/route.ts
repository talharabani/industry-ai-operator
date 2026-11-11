import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorOrCronAuth } from '@/lib/cron-auth';
import { getBusiness } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Runtime in-memory active sandbox scope for Daily Reporting
let activeReportScope: {
  sandbox_tenant_id: string | null;
  updated_at: string;
} = {
  sandbox_tenant_id: null,
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
      sandbox_tenant_id: activeReportScope.sandbox_tenant_id,
      updated_at: activeReportScope.updated_at,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to get report sandbox scope';
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

    if (rawTenantId === null || rawTenantId === undefined || rawTenantId === '') {
      activeReportScope = {
        sandbox_tenant_id: null,
        updated_at: new Date().toISOString(),
      };
      return NextResponse.json({
        success: true,
        message: 'Report sandbox scope cleared.',
        sandbox_tenant_id: null,
      });
    }

    const cleanTenantId = String(rawTenantId).trim();
    const biz = await getBusiness(cleanTenantId);
    if (!biz) {
      return NextResponse.json(
        { error: `Business workspace '${cleanTenantId}' not found.` },
        { status: 404 }
      );
    }

    activeReportScope = {
      sandbox_tenant_id: cleanTenantId,
      updated_at: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      message: `Active report sandbox scope set to '${cleanTenantId}'.`,
      sandbox_tenant_id: cleanTenantId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to set report sandbox scope';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

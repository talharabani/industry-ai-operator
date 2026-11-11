import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getPublicGmailConfig, disconnectGmail } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const { searchParams } = new URL(request.url);
    const requestedTenant = searchParams.get('tenant') || searchParams.get('tenant_id');

    const authCheck = await requireWorkspaceAccess(session, requestedTenant || undefined);
    if (!authCheck.authorized) {
      return NextResponse.json(
        { error: authCheck.error || 'Forbidden: Workspace access denied.' },
        { status: 403 }
      );
    }

    const tenantId = authCheck.tenantId;
    const publicConfig = await getPublicGmailConfig(tenantId);
    return NextResponse.json({
      success: true,
      tenant_id: tenantId,
      gmail: publicConfig,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve Gmail configuration';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const { searchParams } = new URL(request.url);
    const requestedTenant = searchParams.get('tenant') || searchParams.get('tenant_id');

    const authCheck = await requireWorkspaceAccess(session, requestedTenant || undefined);
    if (!authCheck.authorized) {
      return NextResponse.json(
        { error: authCheck.error || 'Forbidden: Workspace access denied.' },
        { status: 403 }
      );
    }

    const tenantId = authCheck.tenantId;

    if (authCheck.role === 'member') {
      return NextResponse.json(
        { error: 'Forbidden: Only business owners and administrators can disconnect Gmail accounts.' },
        { status: 403 }
      );
    }

    await disconnectGmail(tenantId);
    const publicConfig = await getPublicGmailConfig(tenantId);

    return NextResponse.json({
      success: true,
      message: 'Gmail account disconnected. Sync stopped and queued sends blocked.',
      gmail: publicConfig,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to disconnect Gmail';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

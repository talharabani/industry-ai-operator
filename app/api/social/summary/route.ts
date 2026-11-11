import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getSocialDashboardSummary } from '@/lib/social-db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const url = new URL(request.url);
    const requestedTenant = url.searchParams.get('tenant') || url.searchParams.get('tenant_id');

    const authCheck = await requireWorkspaceAccess(session, requestedTenant || undefined);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden: Workspace access denied.' }, { status: 403 });
    }

    const summary = await getSocialDashboardSummary(authCheck.tenantId);
    return NextResponse.json({ tenant_id: authCheck.tenantId, summary });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to retrieve social summary' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { approveSocialPost } from '@/lib/social-db';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getAuthSession();
    const body = await request.json().catch(() => ({}));
    const requestedTenant = typeof body.tenant_id === 'string' ? body.tenant_id.trim() : undefined;

    const authCheck = await requireWorkspaceAccess(session, requestedTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden: Workspace access denied.' }, { status: 403 });
    }

    if (!authCheck.can_approve && authCheck.role !== 'owner' && authCheck.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Insufficient permissions to approve social posts.' }, { status: 403 });
    }

    const scheduledAt = body.scheduled_at || undefined;
    const post = await approveSocialPost(authCheck.tenantId, id, session.user_id, scheduledAt);

    return NextResponse.json({ success: true, post });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to approve post' }, { status: 500 });
  }
}

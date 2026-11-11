import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { listConversations } from '@/lib/db';
import { ConversationChannel, ConversationStatus } from '@/lib/types';

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

    const statusParam = searchParams.get('status') as ConversationStatus | 'all' | null;
    const unreadOnly = searchParams.get('unread') === 'true';
    const channelParam = searchParams.get('channel') as ConversationChannel | null;
    const search = searchParams.get('search') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const conversations = await listConversations(tenantId, {
      status: statusParam || undefined,
      unreadOnly,
      channel: channelParam || undefined,
      search,
      limit,
    });

    // Compute unread count
    const unreadCount = conversations.filter((c) => c.unread).length;
    const pendingApprovalCount = conversations.filter((c) => c.status === 'pending_approval').length;

    return NextResponse.json({
      conversations,
      unread_count: unreadCount,
      pending_approval_count: pendingApprovalCount,
      tenant_id: tenantId,
      session: {
        user_id: session.user_id,
        user_name: session.user_name,
        role: session.role,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch conversations';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

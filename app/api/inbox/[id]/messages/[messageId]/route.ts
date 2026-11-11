import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { updateMessageDraft, getConversation } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const { id: conversationId, messageId } = await context.params;

    const conversation = await getConversation(tenantId, conversationId);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const newBody = typeof body.body === 'string' ? body.body.trim() : '';

    if (!newBody) {
      return NextResponse.json({ error: 'Message body cannot be empty' }, { status: 400 });
    }

    // Updating draft body resets approval status to 'none' (Requirement 5)
    const updated = await updateMessageDraft(tenantId, messageId, newBody);

    if (!updated) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: updated,
      note: 'Message modified. Previous approval has been invalidated and requires re-review.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update message';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

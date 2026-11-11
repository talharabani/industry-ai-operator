import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import {
  getConversation,
  listMessages,
  createMessage,
  markConversationRead,
  updateConversationStatus,
} from '@/lib/db';
import { ConversationStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  let currentStep = 'init';
  let conversationId = '';
  let tenantId = 'demo-store';

  try {
    currentStep = 'tenant_resolution';
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
    tenantId = authCheck.tenantId;

    currentStep = 'route_params';
    const params = await context.params;
    conversationId = params?.id ? decodeURIComponent(params.id).trim() : '';

    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation ID required' }, { status: 400 });
    }

    currentStep = 'get_conversation';
    const conversation = await getConversation(tenantId, conversationId);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    currentStep = 'mark_conversation_read';
    try {
      await markConversationRead(tenantId, conversation.id, false);
    } catch (readErr) {
      console.error('[API /inbox/[id] markConversationRead error non-fatal]', {
        tenantId,
        conversationId: conversation.id,
        error: readErr instanceof Error ? readErr.message : readErr,
        stack: readErr instanceof Error ? readErr.stack : undefined,
      });
    }

    currentStep = 'list_messages';
    const messages = await listMessages(tenantId, conversation.id);

    currentStep = 'serialize_response';
    return NextResponse.json(
      {
        conversation: { ...conversation, unread: false },
        messages,
        tenant_id: tenantId,
        session,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch conversation';
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`[API /inbox/[id] GET Error at step "${currentStep}"]`, {
      step: currentStep,
      tenantId,
      conversationId,
      message,
      stack,
    });
    return NextResponse.json(
      {
        error: message,
        step: currentStep,
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const { id: conversationId } = await context.params;

    const conversation = await getConversation(tenantId, conversationId);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const messageBody = typeof body.body === 'string' ? body.body.trim() : '';

    if (!messageBody) {
      return NextResponse.json({ error: 'Message body cannot be empty' }, { status: 400 });
    }

    // Determine initial approval state: Owner/Admin can directly post approved messages or drafts
    const isDirectApproved = body.is_approved === true && (session.role === 'owner' || session.role === 'admin');
    const senderType = body.sender_type || 'agent';

    const message = await createMessage({
      tenant_id: tenantId,
      conversation_id: conversationId,
      sender_type: senderType,
      sender_name: session.user_name || 'Support Agent',
      sender_email: session.email,
      body: messageBody,
      status: isDirectApproved ? 'approved' : 'draft',
      approval_status: isDirectApproved ? 'approved' : 'pending_approval',
      approved_by: isDirectApproved ? session.user_id : null,
    });

    return NextResponse.json({
      success: true,
      message,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create message';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const { id: conversationId } = await context.params;

    const body = await request.json().catch(() => ({}));
    const { status, unread } = body;

    if (status) {
      await updateConversationStatus(tenantId, conversationId, status as ConversationStatus);
    }
    if (typeof unread === 'boolean') {
      await markConversationRead(tenantId, conversationId, unread);
    }

    const updated = await getConversation(tenantId, conversationId);
    return NextResponse.json({
      success: true,
      conversation: updated,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update conversation';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

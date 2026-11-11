import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getConversation, updateMessageApproval, getBusiness, listMessages, getEmailCredential, getGmailConnection } from '@/lib/db';
import { MessageApprovalStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const { id: conversationId, messageId } = await context.params;

    // Server-side permission check (Requirement 5)
    const business = await getBusiness(tenantId);
    const teamMembers = business?.settings?.team_members || [];
    const currentMember = teamMembers.find((m) => m.id === session.user_id);

    const isAuthorized =
      session.role === 'owner' ||
      session.role === 'admin' ||
      currentMember?.can_approve === true;

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have permission to approve messages.' },
        { status: 403 }
      );
    }

    const conversation = await getConversation(tenantId, conversationId);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const messages = await listMessages(tenantId, conversationId);
    const targetMessage = messages.find((m) => m.id === messageId);
    if (!targetMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    const { credential } = await getEmailCredential(tenantId);
    const { connection: gmailConn } = await getGmailConnection(tenantId);
    const isSendingViaGmail = conversation.channel === 'gmail' || (tenantId === 'sandbox-services-alpha' && Boolean(gmailConn));

    const body = await request.json().catch(() => ({}));
    const decision: MessageApprovalStatus = body.decision === 'rejected' ? 'rejected' : 'approved';

    const draftRevision = (targetMessage.metadata?.draft_revision as number) || 1;
    const approvalBinding = decision === 'approved' ? {
      recipient_email: conversation.customer_email,
      subject: conversation.subject || `Response from ${business?.settings?.business_name || 'Support'}`,
      body: targetMessage.body,
      sender_email: isSendingViaGmail ? (gmailConn?.google_email || credential?.sender_email || null) : (credential?.sender_email || null),
      sender_name: isSendingViaGmail ? (business?.settings?.business_name || gmailConn?.google_name || credential?.sender_name || null) : (credential?.sender_name || null),
      mode: isSendingViaGmail ? 'live' : (credential?.mode || 'demo'),
      draft_revision: draftRevision,
    } : undefined;

    const updated = await updateMessageApproval(
      tenantId,
      messageId,
      decision,
      session.user_id,
      approvalBinding
    );

    if (!updated) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      decision,
      message: updated,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to approve message';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

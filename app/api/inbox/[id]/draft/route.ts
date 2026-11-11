import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import {
  getConversation,
  listMessages,
  getBusiness,
  getDefaultBusinessSettings,
  createMessage,
  insertAudit,
} from '@/lib/db';
import { generateAiReplyDraft } from '@/lib/ai-draft';

export const dynamic = 'force-dynamic';

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

    const business = await getBusiness(tenantId);
    const settings = business?.settings || getDefaultBusinessSettings(tenantId);
    const messages = await listMessages(tenantId, conversationId);

    const body = await request.json().catch(() => ({}));
    const customInstructions = typeof body.instructions === 'string' ? body.instructions : undefined;

    // Generate AI Reply Draft
    const draftText = await generateAiReplyDraft({
      conversation,
      history: messages,
      settings,
      instructions: customInstructions,
    });

    // Save draft into messages table with 'ai_draft' sender type & 'pending_approval'
    const draftMessage = await createMessage({
      tenant_id: tenantId,
      conversation_id: conversationId,
      sender_type: 'ai_draft',
      sender_name: `${settings.business_name} AI Operator`,
      body: draftText,
      status: 'draft',
      approval_status: 'pending_approval',
      metadata: {
        generated_at: new Date().toISOString(),
        model: 'groq-llama-3.3-70b-versatile',
        tone: settings.tone,
        custom_instructions: customInstructions || null,
      },
    });

    await insertAudit(tenantId, 'ai_draft_generated', {
      conversation_id: conversationId,
      message_id: draftMessage.id,
      generated_by: session.user_id,
    });

    return NextResponse.json({
      success: true,
      draft: draftMessage,
      body: draftText,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to generate AI draft';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

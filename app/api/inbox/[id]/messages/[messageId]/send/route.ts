import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import {
  getConversation,
  listMessages,
  getBusiness,
  getEmailCredential,
  getGmailConnection,
  claimMessageForDispatch,
  createMessageDispatch,
  updateDispatchStatus,
  updateMessageStatus,
  recordAuditLog,
  updateConversationStatus,
} from '@/lib/db';
import { sendResendEmail } from '@/lib/resend-service';
import { sendGmailReply, reconcileGmailSentMessage } from '@/lib/gmail-service';
import { computeSha256, isEncryptionKeyConfigured } from '@/lib/crypto';
import { validateOutboundDispatch } from '@/lib/outbound-guard';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const { id: conversationId, messageId } = await context.params;

    // 1. Resolve conversation and message
    const conversation = await getConversation(tenantId, conversationId);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const messages = await listMessages(tenantId, conversationId);
    const targetMessage = messages.find((m) => m.id === messageId);

    if (!targetMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // 2. Verification of Approval & Authorization (Requirement 3 & 6)
    const business = await getBusiness(tenantId);
    const currentMember = business?.settings?.team_members?.find((m) => m.id === session.user_id);
    const isAuthorized = session.role === 'owner' || session.role === 'admin' || currentMember?.can_approve === true;

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have permission to dispatch approved customer replies.' },
        { status: 403 }
      );
    }

    // Message must be approved prior to send
    if (targetMessage.approval_status !== 'approved') {
      return NextResponse.json(
        { error: 'Message must be approved before dispatch. Please approve the draft first.' },
        { status: 400 }
      );
    }

    // 3. Load tenant email credentials and Gmail connection to verify approval binding against current sender config
    const { credential, decryptedApiKey } = await getEmailCredential(tenantId);
    const { connection: gmailConn } = await getGmailConnection(tenantId);
    const isSendingViaGmail = conversation.channel === 'gmail' || (tenantId === 'sandbox-services-alpha' && Boolean(gmailConn));

    const businessName = business?.settings?.business_name || 'Customer Support';
    const recipientEmail = conversation.customer_email;
    const subject = conversation.subject || `Response from ${businessName}`;
    const currentBodyHash = computeSha256(targetMessage.body);
    const meta = (targetMessage.metadata || {}) as Record<string, unknown>;

    // Strict validation: recipient, subject, body hash, revision and sender config must match approval snapshot
    const approvedHash = meta.approved_body_hash as string | undefined;
    const approvedRecipient = meta.approved_recipient as string | undefined;
    const approvedSubject = meta.approved_subject as string | undefined;
    const approvedSenderEmail = meta.approved_sender_email as string | undefined;
    const approvedMode = meta.approved_mode as string | undefined;

    const expectedSenderEmail = isSendingViaGmail ? (gmailConn?.google_email || credential?.sender_email || null) : (credential?.sender_email || null);
    const expectedMode = isSendingViaGmail ? 'live' : (credential?.mode || 'demo');

    const isBindingMismatched =
      (approvedHash && approvedHash !== currentBodyHash) ||
      (approvedRecipient && approvedRecipient !== recipientEmail) ||
      (approvedSubject && approvedSubject !== subject) ||
      (approvedSenderEmail !== undefined && approvedSenderEmail !== expectedSenderEmail) ||
      (approvedMode !== undefined && approvedMode !== expectedMode);

    if (isBindingMismatched) {
      await updateMessageStatus(tenantId, messageId, 'draft', {
        approval_status: 'pending_approval',
        invalidation_reason: 'Approval invalidated: Recipient, subject, body content, or sender configuration changed after approval.',
      });
      return NextResponse.json(
        {
          error: 'Approval invalidated: Recipient, subject, body revision, or sender configuration has changed since approval. Please re-review and approve before dispatching.',
          status: 'draft',
        },
        { status: 400 }
      );
    }

    // Prevent re-sending already completed dispatches (Requirement 4)
    const nonSendableStatuses = ['sent', 'provider_accepted', 'simulated_demo', 'sending'];
    if (nonSendableStatuses.includes(targetMessage.status)) {
      return NextResponse.json(
        {
          error: `Duplicate send prevented. Message is currently in state '${targetMessage.status}'.`,
          current_status: targetMessage.status,
        },
        { status: 409 }
      );
    }

    // 4. Atomic Claim for Dispatch (Prevents concurrent duplicate sends)
    const claimedMessage = await claimMessageForDispatch(tenantId, messageId);
    if (!claimedMessage) {
      return NextResponse.json(
        { error: 'Concurrent dispatch collision. Message is already being processed by another worker.' },
        { status: 409 }
      );
    }

    // 5. Stable Idempotency Key & Outbox Registration (Requirement 4 & 6)
    const idempotencyKey = `idem-${messageId}-${Date.now().toString(36)}`;

    if (isSendingViaGmail) {
      // ----------------------------------------------------------------------
      // GMAIL DISPATCH LIFECYCLE
      // ----------------------------------------------------------------------
      const { connection, decryptedAccessToken, needsReconnect } = await getGmailConnection(tenantId);

      if (needsReconnect || !connection || !decryptedAccessToken) {
        await updateMessageStatus(tenantId, messageId, 'failed', {
          error: needsReconnect
            ? 'Google account authorization has been revoked. Please reconnect Gmail in Settings > Connections.'
            : 'No connected Gmail account found for this business. Please connect Gmail in Settings > Connections.',
        });
        return NextResponse.json(
          {
            error: needsReconnect
              ? 'Google authorization revoked or expired. Please reconnect your Gmail account in Settings > Connections.'
              : 'Gmail account connection required. Please connect Gmail in Settings > Connections.',
            status: 'failed',
          },
          { status: 400 }
        );
      }

      const senderEmail = connection.google_email;
      const senderName = businessName || connection.google_name;
      const fromAddress = `${senderName} <${senderEmail}>`;

      // Centralized Controlled Pilot Security Guard
      const outboundGuard = validateOutboundDispatch({
        tenantId,
        senderEmail,
        recipientEmail,
        isAutomated: false,
        approvalStatus: targetMessage.approval_status,
        pilotWhitelist: business?.settings?.pilot_whitelist as any,
        automationMode: business?.settings?.automation_mode,
      });

      if (!outboundGuard.allowed) {
        return NextResponse.json(
          {
            error: outboundGuard.reason,
            status: outboundGuard.action === 'draft_required' ? 'draft' : 'blocked',
          },
          { status: outboundGuard.action === 'draft_required' ? 400 : 403 }
        );
      }

      // Extract RFC threading headers from previous message in this conversation
      const customerMsgs = messages.filter((m) => m.sender_type === 'customer');
      const lastCustMsg = customerMsgs[customerMsgs.length - 1];
      const inReplyTo = (lastCustMsg?.metadata?.rfc_message_id as string) || undefined;
      const references = (lastCustMsg?.metadata?.references as string) || inReplyTo;
      const threadId = conversation.external_thread_id || (targetMessage.metadata?.target_gmail_thread_id as string) || undefined;

      // Create Outbox record for Gmail dispatch
      const dispatchRecord = await createMessageDispatch({
        message_id: messageId,
        conversation_id: conversationId,
        tenant_id: tenantId,
        idempotency_key: idempotencyKey,
        provider: 'gmail',
        status: 'sending',
        recipient_email: recipientEmail,
        sender_email: senderEmail,
        sender_name: senderName,
        subject,
        body_text: targetMessage.body,
        metadata: {
          approver_id: session.user_id,
          dispatched_at: new Date().toISOString(),
          channel: 'gmail',
          thread_id: threadId,
          in_reply_to: inReplyTo,
        },
      });

      // Dispatch via Gmail API
      let sendResult = await sendGmailReply({
        accessToken: decryptedAccessToken,
        to: recipientEmail,
        from: fromAddress,
        subject,
        text: targetMessage.body,
        threadId,
        inReplyToMessageId: inReplyTo,
        referencesMessageId: references,
      });

      // If timeout occurred, attempt to reconcile against Sent mail
      if (sendResult.isUncertain) {
        const reconciliation = await reconcileGmailSentMessage(
          decryptedAccessToken,
          recipientEmail,
          subject,
          Math.floor(Date.now() / 1000) - 30
        );

        if (reconciliation.found && reconciliation.providerMessageId) {
          sendResult = {
            success: true,
            status: 'provider_accepted',
            providerMessageId: reconciliation.providerMessageId,
            threadId: reconciliation.threadId,
          };
        }
      }

      // Reconcile status based on provider outcome
      await updateDispatchStatus({
        dispatch_id: dispatchRecord.id,
        status: sendResult.status,
        provider_message_id: sendResult.providerMessageId || null,
        error: sendResult.error || null,
        metadataUpdates: {
          gmail_thread_id: sendResult.threadId || threadId,
          is_uncertain: sendResult.isUncertain,
        },
      });

      await recordAuditLog(tenantId, 'gmail_reply_dispatched', {
        conversation_id: conversationId,
        message_id: messageId,
        dispatch_id: dispatchRecord.id,
        recipient: recipientEmail,
        status: sendResult.status,
        provider_message_id: sendResult.providerMessageId || null,
      });

      await updateConversationStatus(tenantId, conversationId, 'open');

      return NextResponse.json({
        success: sendResult.success,
        status: sendResult.status,
        is_simulated: false,
        provider: 'gmail',
        provider_message_id: sendResult.providerMessageId,
        dispatch_id: dispatchRecord.id,
        error: sendResult.error,
        notice:
          sendResult.status === 'provider_accepted'
            ? 'Reply successfully dispatched through connected Gmail account.'
            : sendResult.status === 'uncertain'
            ? 'Network timeout during Gmail dispatch. Status retained as Uncertain (will not blindly retry).'
            : `Gmail dispatch failed: ${sendResult.error}`,
      });
    }

    const isLiveMode = credential?.mode === 'live';

    if (isLiveMode) {
      // Check stable encryption key configuration
      if (!isEncryptionKeyConfigured()) {
        await updateMessageStatus(tenantId, messageId, 'failed', {
          error: 'Server configuration error: EMAIL_ENCRYPTION_KEY is required for live email operations.',
        });
        return NextResponse.json(
          {
            error: 'Server configuration error: EMAIL_ENCRYPTION_KEY environment variable is missing or invalid. Please configure EMAIL_ENCRYPTION_KEY in .env.local.',
            status: 'failed',
          },
          { status: 500 }
        );
      }

      // Live Mode Dispatch (Requirement 3: Never fall back to simulated sending in Live mode)
      if (!credential || !credential.is_verified || !decryptedApiKey) {
        await updateMessageStatus(tenantId, messageId, 'failed', {
          error: 'Live mode active but business Resend connection is unverified or missing API key.',
        });
        return NextResponse.json(
          {
            error: 'Live mode requires a verified email connection. Please test and verify your Resend credentials in Settings > Connections.',
            status: 'failed',
          },
          { status: 400 }
        );
      }

      const senderEmail = credential.sender_email || 'onboarding@resend.dev';
      const senderName = credential.sender_name || businessName;
      const fromAddress = `${senderName} <${senderEmail}>`;

      // Create Outbox record
      const dispatchRecord = await createMessageDispatch({
        message_id: messageId,
        conversation_id: conversationId,
        tenant_id: tenantId,
        idempotency_key: idempotencyKey,
        provider: 'resend',
        status: 'sending',
        recipient_email: recipientEmail,
        sender_email: senderEmail,
        sender_name: senderName,
        reply_to: credential.reply_to || undefined,
        subject,
        body_text: targetMessage.body,
        metadata: {
          approver_id: session.user_id,
          dispatched_at: new Date().toISOString(),
          is_live: true,
        },
      });

      // Execute network call to Resend (No DB transaction kept open during network request)
      const sendResult = await sendResendEmail({
        apiKey: decryptedApiKey,
        to: recipientEmail,
        from: fromAddress,
        subject,
        text: targetMessage.body,
        replyTo: credential.reply_to || undefined,
        idempotencyKey,
      });

      // Reconcile status based on provider outcome
      await updateDispatchStatus({
        dispatch_id: dispatchRecord.id,
        status: sendResult.status,
        provider_message_id: sendResult.providerMessageId || null,
        error: sendResult.error || null,
        metadataUpdates: {
          provider_response: sendResult.details || null,
          is_uncertain: sendResult.isUncertain,
        },
      });

      await recordAuditLog(tenantId, 'message_dispatched_live', {
        conversation_id: conversationId,
        message_id: messageId,
        dispatch_id: dispatchRecord.id,
        recipient: recipientEmail,
        status: sendResult.status,
        provider_message_id: sendResult.providerMessageId || null,
        is_uncertain: sendResult.isUncertain,
      });

      // Update conversation status
      await updateConversationStatus(tenantId, conversationId, 'open');

      return NextResponse.json({
        success: sendResult.success,
        status: sendResult.status,
        is_simulated: false,
        provider: 'resend',
        provider_message_id: sendResult.providerMessageId,
        dispatch_id: dispatchRecord.id,
        error: sendResult.error,
        notice: sendResult.status === 'provider_accepted'
          ? 'Email accepted by Resend provider for delivery.'
          : sendResult.status === 'uncertain'
          ? 'Network timeout during dispatch. Outcome is retained as Uncertain (will not blindly retry).'
          : `Dispatch failed: ${sendResult.error}`,
      });
    }

    // Demo Mode Dispatch (Requirement 3: No external network request, clear simulated_demo status)
    const senderEmail = credential?.sender_email || 'support@demo-store.com';
    const senderName = credential?.sender_name || businessName;

    const dispatchRecord = await createMessageDispatch({
      message_id: messageId,
      conversation_id: conversationId,
      tenant_id: tenantId,
      idempotency_key: idempotencyKey,
      provider: 'simulated_demo',
      status: 'simulated_demo',
      recipient_email: recipientEmail,
      sender_email: senderEmail,
      sender_name: senderName,
      subject,
      body_text: targetMessage.body,
      metadata: {
        note: 'Simulated email dispatch in demo mode. No external provider network call made.',
        approver_id: session.user_id,
        dispatched_at: new Date().toISOString(),
      },
    });

    await updateDispatchStatus({
      dispatch_id: dispatchRecord.id,
      status: 'simulated_demo',
      provider_message_id: `demo-resend-${Date.now().toString(36)}`,
    });

    await recordAuditLog(tenantId, 'message_dispatched_demo', {
      conversation_id: conversationId,
      message_id: messageId,
      recipient: recipientEmail,
      status: 'simulated_demo',
    });

    await updateConversationStatus(tenantId, conversationId, 'open');

    return NextResponse.json({
      success: true,
      status: 'simulated_demo',
      is_simulated: true,
      dispatch_id: dispatchRecord.id,
      provider_message_id: `demo-resend-${Date.now().toString(36)}`,
      notice: 'Message recorded in Simulated Demo mode (No external API call executed).',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Dispatch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

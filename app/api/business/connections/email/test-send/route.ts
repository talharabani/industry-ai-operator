import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getEmailCredential, recordAuditLog } from '@/lib/db';
import { sendResendEmail } from '@/lib/resend-service';
import { isEncryptionKeyConfigured } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    if (session.role === 'member') {
      return NextResponse.json(
        { error: 'Forbidden: Only business owners and administrators can send test emails.' },
        { status: 403 }
      );
    }

    if (!isEncryptionKeyConfigured()) {
      return NextResponse.json(
        {
          error: 'Server configuration error: EMAIL_ENCRYPTION_KEY environment variable is missing or invalid. Please configure EMAIL_ENCRYPTION_KEY in .env.local.',
        },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const recipientEmail = typeof body.recipient_email === 'string' ? body.recipient_email.trim() : '';

    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return NextResponse.json(
        { error: 'A valid recipient email address is required to send a test email.' },
        { status: 400 }
      );
    }

    const { credential, decryptedApiKey } = await getEmailCredential(tenantId);

    if (!credential || !decryptedApiKey) {
      return NextResponse.json(
        { error: 'No email credentials configured for this business. Please configure your Resend API Key first.' },
        { status: 400 }
      );
    }

    const senderEmail = credential.sender_email || 'onboarding@resend.dev';
    const senderName = credential.sender_name || 'AI Operator';
    const fromAddress = `${senderName} <${senderEmail}>`;

    const sendResult = await sendResendEmail({
      apiKey: decryptedApiKey,
      to: recipientEmail,
      from: fromAddress,
      subject: `[Test] Email Verification from ${senderName}`,
      text: `Hello,\n\nThis is a verified test email sent from the Industry AI Dashboard for business '${tenantId}'.\n\nYour Resend email dispatch integration is operational and ready for live approved message sending.\n\nTimestamp: ${new Date().toISOString()}`,
      replyTo: credential.reply_to || undefined,
    });

    await recordAuditLog(tenantId, 'test_email_dispatched', {
      recipient: recipientEmail,
      sender: fromAddress,
      success: sendResult.success,
      provider_message_id: sendResult.providerMessageId || null,
      status: sendResult.status,
    });

    if (!sendResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: sendResult.error || 'Failed to dispatch test email through Resend API.',
          details: sendResult.details,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      status: sendResult.status,
      provider_message_id: sendResult.providerMessageId,
      message: `Test email successfully dispatched to ${recipientEmail} via Resend. (Provider ID: ${sendResult.providerMessageId})`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Test email failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { MessageStatus } from './types';

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  status: MessageStatus;
  provider: 'resend' | 'simulated_demo' | 'none';
  providerMessageId?: string;
  error?: string;
  isSimulated: boolean;
  details?: Record<string, unknown>;
}

/**
 * Dispatch an email message to a customer.
 * - If RESEND_API_KEY is available in environment or connection config, dispatches a real email.
 * - Otherwise, operates in simulated demo mode and marks as 'simulated_demo' (NEVER 'sent').
 */
export async function sendEmailMessage(
  params: SendEmailParams,
  providerConfig?: { provider?: string; sender_email?: string; apiKey?: string }
): Promise<SendEmailResult> {
  const resendApiKey = providerConfig?.apiKey || process.env.RESEND_API_KEY || '';
  const fromEmail = providerConfig?.sender_email || process.env.EMAIL_FROM || 'support@onboarding.resend.dev';
  const fromName = params.fromName || 'Customer Support';

  // If a live Resend API key is configured, perform real authenticated send
  if (resendApiKey && resendApiKey.startsWith('re_')) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [params.to],
          subject: params.subject,
          text: params.body,
          ...(params.replyTo ? { reply_to: params.replyTo } : {}),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };

      if (!response.ok) {
        return {
          success: false,
          status: 'failed',
          provider: 'resend',
          error: data.message || `Resend error HTTP ${response.status}`,
          isSimulated: false,
          details: data,
        };
      }

      return {
        success: true,
        status: 'provider_accepted',
        provider: 'resend',
        providerMessageId: data.id,
        isSimulated: false,
        details: data,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error communicating with email provider';
      return {
        success: false,
        status: 'failed',
        provider: 'resend',
        error: message,
        isSimulated: false,
      };
    }
  }

  // Demo / Simulated mode: Explicitly marked as simulated_demo, NOT sent (Requirement 6)
  return {
    success: true,
    status: 'simulated_demo',
    provider: 'simulated_demo',
    providerMessageId: `demo-email-${Date.now().toString(36)}`,
    isSimulated: true,
    details: {
      recipient: params.to,
      subject: params.subject,
      note: 'Simulated email dispatch in demo environment. Real email dispatch requires RESEND_API_KEY.',
    },
  };
}

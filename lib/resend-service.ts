import { ResendDomainItem, MessageStatus } from './types';

export interface VerifyResendKeyResult {
  success: boolean;
  status: 'connected' | 'error' | 'not_connected';
  error?: string;
  domains?: ResendDomainItem[];
  verifiedDomainFound?: boolean;
  senderDomainAuthorized?: boolean;
  limitationNotice?: string;
}

export interface SendResendEmailParams {
  apiKey: string;
  to: string;
  from: string;
  subject: string;
  text: string;
  replyTo?: string;
  idempotencyKey?: string;
}

export interface SendResendEmailResult {
  success: boolean;
  status: MessageStatus;
  providerMessageId?: string;
  error?: string;
  isUncertain: boolean;
  details?: Record<string, unknown>;
}

/**
 * Non-sending Resend Provider Verification (Requirement 2)
 * Validates API key authenticity and checks sender domain status via Resend API without sending any emails.
 */
export async function verifyResendConnection(
  apiKey: string,
  senderEmail?: string
): Promise<VerifyResendKeyResult> {
  if (!apiKey || !apiKey.trim().startsWith('re_')) {
    return {
      success: false,
      status: 'error',
      error: 'Invalid API Key format. Resend API keys must start with "re_".',
    };
  }

  const cleanKey = apiKey.trim();

  try {
    // 1. Authenticate API Key via GET /api-keys (Non-sending operation)
    const keyController = new AbortController();
    const keyTimeout = setTimeout(() => keyController.abort(), 6000);

    const keyRes = await fetch('https://api.resend.com/api-keys', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cleanKey}`,
        'Content-Type': 'application/json',
      },
      signal: keyController.signal,
    }).catch((err) => {
      throw new Error(`Network error contacting Resend API: ${err.message}`);
    });
    clearTimeout(keyTimeout);

    if (keyRes.status === 401 || keyRes.status === 403) {
      return {
        success: false,
        status: 'error',
        error: 'Authentication failed. The provided Resend API key is invalid or lacks read permissions.',
      };
    }

    if (!keyRes.ok) {
      const errData = await keyRes.json().catch(() => ({}));
      return {
        success: false,
        status: 'error',
        error: (errData as { message?: string })?.message || `Resend API returned HTTP ${keyRes.status}`,
      };
    }

    // 2. Fetch configured sender domains via GET /domains (Non-sending operation)
    const domController = new AbortController();
    const domTimeout = setTimeout(() => domController.abort(), 6000);

    const domRes = await fetch('https://api.resend.com/domains', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cleanKey}`,
        'Content-Type': 'application/json',
      },
      signal: domController.signal,
    }).catch(() => null);
    clearTimeout(domTimeout);

    let domains: ResendDomainItem[] = [];
    if (domRes && domRes.ok) {
      const domData = (await domRes.json().catch(() => ({}))) as { data?: Array<{ id: string; name: string; status: string; region?: string }> };
      if (Array.isArray(domData.data)) {
        domains = domData.data.map((d) => ({
          id: d.id,
          name: d.name,
          status: d.status,
          region: d.region,
        }));
      }
    }

    // 3. Domain authorization check for the configured sender email
    let senderDomainAuthorized = true;
    let limitationNotice: string | undefined;

    if (senderEmail && senderEmail.includes('@')) {
      const senderDomain = senderEmail.split('@')[1].toLowerCase();
      const isTestDomain = senderDomain === 'resend.dev';

      if (isTestDomain) {
        limitationNotice = 'Using test domain onboarding@resend.dev. In Resend sandbox mode, emails can only be delivered to your verified account email.';
      } else if (domains.length > 0) {
        const matchingDomain = domains.find((d) => d.name.toLowerCase() === senderDomain);
        if (!matchingDomain || matchingDomain.status !== 'verified') {
          senderDomainAuthorized = false;
          return {
            success: false,
            status: 'error',
            domains,
            senderDomainAuthorized: false,
            error: `Domain "${senderDomain}" is not verified in your Resend account. Status: ${matchingDomain?.status || 'Not found'}. Please verify DNS records in Resend dashboard before live sending.`,
          };
        }
      }
    }

    return {
      success: true,
      status: 'connected',
      domains,
      senderDomainAuthorized,
      limitationNotice,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown connection error';
    return {
      success: false,
      status: 'error',
      error: msg,
    };
  }
}

/**
 * Dispatches an email via Resend API with idempotency and strict timeout handling.
 * - Retains 'uncertain' status on network timeouts (never blindly retried).
 */
export async function sendResendEmail(params: SendResendEmailParams): Promise<SendResendEmailResult> {
  const { apiKey, to, from, subject, text, replyTo, idempotencyKey } = params;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s strict timeout

  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
      headers['X-Entity-Ref-ID'] = idempotencyKey;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };

    if (!response.ok) {
      const errorMsg = data.message || `Resend error HTTP ${response.status}`;
      return {
        success: false,
        status: 'failed',
        error: errorMsg,
        isUncertain: false,
        details: data,
      };
    }

    return {
      success: true,
      status: 'provider_accepted',
      providerMessageId: data.id,
      isUncertain: false,
      details: data,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    if (err instanceof Error && err.name === 'AbortError') {
      // Timeout after request was sent -> Outcome is UNCERTAIN (Requirement 4)
      return {
        success: false,
        status: 'uncertain',
        isUncertain: true,
        error: 'Network timeout after 10000ms. Dispatch outcome is uncertain; retaining uncertain state to avoid duplicate send.',
      };
    }

    const message = err instanceof Error ? err.message : 'Network error';
    return {
      success: false,
      status: 'uncertain',
      isUncertain: true,
      error: `Connection failure during provider dispatch: ${message}. Outcome retained as uncertain.`,
    };
  }
}

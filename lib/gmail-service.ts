import crypto from 'crypto';
import { classifyEmailMessage } from './email-filter.ts';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGoogleOAuthConfig(origin?: string): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || vercelUrl || '').trim().replace(/\/+$/, '');
  const stagingCallback = appUrl ? `${appUrl}/api/auth/google/callback` : null;
  const defaultRedirect = stagingCallback || (origin
    ? `${origin}/api/auth/google/callback`
    : 'http://localhost:3000/api/auth/google/callback');
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || defaultRedirect;

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
  };
}

export const GMAIL_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

/**
 * Base64url encode a buffer (RFC 4648)
 */
export function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generates PKCE code_verifier and code_challenge (S256)
 */
export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = base64url(hash);
  return { codeVerifier, codeChallenge };
}

/**
 * Builds the Google OAuth 2.0 authorization URL
 */
export function buildGoogleAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GMAIL_SCOPES.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return url.toString();
}

/**
 * Exchanges authorization code for access and refresh tokens
 */
export async function exchangeGoogleCodeForTokens(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  config: GoogleOAuthConfig;
}): Promise<{
  accessToken: string;
  refreshToken?: string | null;
  expiresIn: number;
  tokenType: string;
  scope: string;
}> {
  const body = new URLSearchParams({
    client_id: params.config.clientId,
    client_secret: params.config.clientSecret,
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(
      errorData.error_description || errorData.error || `Token exchange failed with status ${res.status}`
    );
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresIn: data.expires_in || 3600,
    tokenType: data.token_type || 'Bearer',
    scope: data.scope || '',
  };
}

/**
 * Refreshes an expired Google access token using the stored refresh token
 */
export async function refreshGoogleAccessToken(params: {
  refreshToken: string;
  config: GoogleOAuthConfig;
}): Promise<{
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
}> {
  const body = new URLSearchParams({
    client_id: params.config.clientId,
    client_secret: params.config.clientSecret,
    refresh_token: params.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const isRevoked = err.error === 'invalid_grant';
    const error = new Error(
      isRevoked
        ? 'Google access revoked or refresh token expired. Reconnection required.'
        : err.error_description || 'Failed to refresh Google access token'
    );
    (error as unknown as { isRevoked?: boolean }).isRevoked = isRevoked;
    throw error;
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 3600,
    refreshToken: data.refresh_token || undefined,
  };
}

/**
 * Fetches Google User Profile (email, name, picture)
 */
export async function getGoogleUserInfo(accessToken: string): Promise<{
  email: string;
  sub: string;
  name?: string;
  picture?: string;
}> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Google user profile (${res.status})`);
  }

  const data = await res.json();
  return {
    email: data.email,
    sub: data.sub,
    name: data.name,
    picture: data.picture,
  };
}

/**
 * Fetches Gmail Profile historyId
 */
export async function getGmailProfile(accessToken: string): Promise<{
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Gmail profile (${res.status})`);
  }

  return await res.json();
}

export interface ParsedGmailMessage {
  id: string;
  threadId: string;
  historyId?: string;
  senderName: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  date: string;
  bodyText: string;
  bodyHtml?: string;
  rfcMessageId?: string;
  inReplyTo?: string;
  references?: string;
  hasAttachments: boolean;
  isAutomated: boolean;
  automatedReason?: string;
  category?: string;
  snippet?: string;
}

/**
 * Safely decodes base64url data
 */
function decodeBase64Url(str: string): string {
  try {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * Recursively extracts plain text and HTML from MIME payload parts
 */
function extractMessageBody(payload: Record<string, unknown>): {
  text: string;
  html?: string;
  hasAttachments: boolean;
} {
  let text = '';
  let html = '';
  let hasAttachments = false;

  const mimeType = (payload.mimeType as string) || '';
  const body = payload.body as Record<string, unknown> | undefined;

  if (body?.data && typeof body.data === 'string') {
    const decoded = decodeBase64Url(body.data);
    if (mimeType.includes('text/plain')) {
      text += decoded;
    } else if (mimeType.includes('text/html')) {
      html += decoded;
    }
  }

  if (body?.attachmentId) {
    hasAttachments = true;
  }

  const parts = (payload.parts as Record<string, unknown>[]) || [];
  for (const part of parts) {
    const partFilename = part.filename as string | undefined;
    if (partFilename && partFilename.trim().length > 0) {
      hasAttachments = true;
    }
    const extracted = extractMessageBody(part);
    if (extracted.text) text += (text ? '\n' : '') + extracted.text;
    if (extracted.html) html += (html ? '<br>' : '') + extracted.html;
    if (extracted.hasAttachments) hasAttachments = true;
  }

  // Fallback if only HTML is present
  if (!text && html) {
    text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { text: text.trim(), html: html.trim() || undefined, hasAttachments };
}

/**
 * Parses a single raw Gmail Message object from the REST API
 */
export function parseGmailMessage(raw: Record<string, unknown>): ParsedGmailMessage {
  const id = raw.id as string;
  const threadId = raw.threadId as string;
  const historyId = raw.historyId as string | undefined;
  const snippet = raw.snippet as string | undefined;

  const payload = (raw.payload || {}) as Record<string, unknown>;
  const headers = ((payload.headers || []) as Array<{ name: string; value: string }>);

  const getHeader = (name: string): string => {
    const found = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
    return found ? found.value : '';
  };

  const fromRaw = getHeader('From');
  const toRaw = getHeader('To');
  const subject = getHeader('Subject') || '(No Subject)';
  const dateRaw = getHeader('Date');
  const rfcMessageId = getHeader('Message-ID');
  const inReplyTo = getHeader('In-Reply-To');
  const references = getHeader('References');
  const autoSubmitted = getHeader('Auto-Submitted');
  const listUnsubscribe = getHeader('List-Unsubscribe');

  // Parse sender name & email from "Name <email@example.com>" or "email@example.com"
  let senderName = fromRaw;
  let senderEmail = fromRaw;
  const emailMatch = fromRaw.match(/^(.*?)\s*<([^>]+)>/);
  if (emailMatch) {
    senderName = emailMatch[1].replace(/^["']|["']$/g, '').trim() || emailMatch[2];
    senderEmail = emailMatch[2].trim();
  }

  const { text, html, hasAttachments } = extractMessageBody(payload);
  const effectiveBody = text || snippet || '(Empty message body)';

  // Rigorously classify non-customer emails (OTPs, sign-in alerts, marketing, bounces)
  const classification = classifyEmailMessage({
    senderEmail,
    senderName,
    subject,
    bodyText: effectiveBody,
    headers,
  });

  return {
    id,
    threadId,
    historyId,
    senderName: senderName || 'Unknown Customer',
    senderEmail,
    recipientEmail: toRaw,
    subject,
    date: dateRaw ? new Date(dateRaw).toISOString() : new Date().toISOString(),
    bodyText: effectiveBody,
    bodyHtml: html,
    rfcMessageId: rfcMessageId || undefined,
    inReplyTo: inReplyTo || undefined,
    references: references || undefined,
    hasAttachments,
    isAutomated: classification.isNonCustomer,
    automatedReason: classification.reason,
    category: classification.category,
    snippet,
  };
}

/**
 * Fetches message IDs from Gmail using query
 */
export async function listGmailMessages(
  accessToken: string,
  options: {
    query?: string;
    maxResults?: number;
    pageToken?: string;
  } = {}
): Promise<{ messages: Array<{ id: string; threadId: string }>; nextPageToken?: string }> {
  const params = new URLSearchParams();
  if (options.query) params.set('q', options.query);
  if (options.maxResults) params.set('maxResults', options.maxResults.toString());
  if (options.pageToken) params.set('pageToken', options.pageToken);

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to list Gmail messages (${res.status})`);
  }

  const data = await res.json();
  return {
    messages: data.messages || [],
    nextPageToken: data.nextPageToken,
  };
}

/**
 * Fetches full details for a Gmail message
 */
export async function getGmailMessageDetails(
  accessToken: string,
  messageId: string
): Promise<ParsedGmailMessage | null> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 404) {
    // Message was deleted or purged from Gmail mailbox
    return null;
  }

  if (!res.ok) {
    throw new Error(`Failed to get Gmail message ${messageId} (${res.status})`);
  }

  const raw = await res.json();
  return parseGmailMessage(raw);
}

/**
 * Fetches incremental changes using historyId
 */
export async function listGmailHistory(
  accessToken: string,
  startHistoryId: string
): Promise<{
  history: Array<{
    messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
    messages?: Array<{ id: string; threadId: string }>;
    labelsAdded?: Array<{ message: { id: string; threadId: string } }>;
  }>;
  historyId: string;
  expired?: boolean;
}> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${startHistoryId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (res.status === 404 || res.status === 400) {
    // historyId is outdated or expired
    return { history: [], historyId: startHistoryId, expired: true };
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch Gmail history (${res.status})`);
  }

  const data = await res.json();
  return {
    history: data.history || [],
    historyId: data.historyId || startHistoryId,
    expired: false,
  };
}

/**
 * Constructs RFC 2822 raw message and dispatches via Gmail REST API
 */
export async function sendGmailReply(params: {
  accessToken: string;
  to: string;
  from: string;
  subject: string;
  text: string;
  threadId?: string;
  inReplyToMessageId?: string;
  referencesMessageId?: string;
}): Promise<{
  success: boolean;
  status: 'provider_accepted' | 'failed' | 'uncertain';
  providerMessageId?: string;
  threadId?: string;
  error?: string;
  isUncertain?: boolean;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s strict timeout

  try {
    // Controlled Pilot Hard Stop: If sending from the pilot account, restrict strictly to authorized recipient
    const cleanFrom = (params.from || '').toLowerCase();
    const cleanTo = (params.to || '').trim().toLowerCase();
    const authorizedPilotSender = (process.env.AUTHORIZED_GMAIL_SENDER || 'talhaishaqrabani9490@gmail.com').toLowerCase();
    const authorizedPilotRecipient = (process.env.AUTHORIZED_TEST_RECIPIENT || 'mukaramajeed28094@gmail.com').toLowerCase();

    if (cleanFrom.includes(authorizedPilotSender)) {
      if (cleanTo !== authorizedPilotRecipient) {
        clearTimeout(timeoutId);
        return {
          success: false,
          status: 'failed',
          error: `Controlled Pilot Security Guard: Outbound sending from ${authorizedPilotSender} is restricted strictly to ${authorizedPilotRecipient}. Attempted send to '${cleanTo}' blocked fail-closed.`,
        };
      }
    }

    // Ensure subject has "Re: " prefix if this is a reply
    const formattedSubject = params.threadId && !params.subject.toLowerCase().startsWith('re:')
      ? `Re: ${params.subject}`
      : params.subject;

    // Build RFC 2822 headers
    const lines: string[] = [
      `From: ${params.from}`,
      `To: ${params.to}`,
      `Subject: =?utf-8?B?${Buffer.from(formattedSubject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
    ];

    if (params.inReplyToMessageId) {
      lines.push(`In-Reply-To: ${params.inReplyToMessageId}`);
    }
    if (params.referencesMessageId) {
      lines.push(`References: ${params.referencesMessageId}`);
    }

    lines.push('', params.text);
    const rawRfc2822 = lines.join('\r\n');
    const encodedRaw = base64url(Buffer.from(rawRfc2822, 'utf-8'));

    const requestBody: Record<string, unknown> = { raw: encodedRaw };
    if (params.threadId) {
      requestBody.threadId = params.threadId;
    }

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        status: 'failed',
        error: err.error?.message || `Gmail API send failed with HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    return {
      success: true,
      status: 'provider_accepted',
      providerMessageId: data.id,
      threadId: data.threadId,
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        status: 'uncertain',
        isUncertain: true,
        error: 'Network timeout after 10000ms sending Gmail message. Outcome retained as uncertain.',
      };
    }
    const message = error instanceof Error ? error.message : 'Unknown network dispatch failure';
    return {
      success: false,
      status: 'failed',
      error: message,
    };
  }
}

/**
 * Searches Gmail Sent messages to reconcile an uncertain dispatch after a timeout
 */
export async function reconcileGmailSentMessage(
  accessToken: string,
  recipient: string,
  subjectSnippet: string,
  sentAfterEpochSec: number
): Promise<{ found: boolean; providerMessageId?: string; threadId?: string }> {
  try {
    const q = `to:${recipient} in:sent after:${sentAfterEpochSec - 10}`;
    const result = await listGmailMessages(accessToken, { query: q, maxResults: 5 });
    if (result.messages.length === 0) {
      return { found: false };
    }

    for (const msg of result.messages) {
      const details = await getGmailMessageDetails(accessToken, msg.id);
      if (!details) continue;
      if (
        details.recipientEmail.includes(recipient) &&
        (details.subject.includes(subjectSnippet) || subjectSnippet.includes(details.subject))
      ) {
        return {
          found: true,
          providerMessageId: details.id,
          threadId: details.threadId,
        };
      }
    }
    return { found: false };
  } catch {
    return { found: false };
  }
}

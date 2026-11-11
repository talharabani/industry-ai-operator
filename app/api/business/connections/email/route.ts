import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import {
  getPublicEmailConfig,
  saveEmailCredential,
  disconnectEmail,
  getBusiness,
} from '@/lib/db';
import { isEncryptionKeyConfigured } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    const emailConfig = await getPublicEmailConfig(tenantId);
    return NextResponse.json({
      success: true,
      tenant_id: tenantId,
      email: emailConfig,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve email configuration';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    // Authorization check: Only owner or admin can manage email connection credentials (Requirement 1)
    if (session.role === 'member') {
      return NextResponse.json(
        { error: 'Forbidden: Only business owners and administrators can configure live email connections.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { mode, provider, api_key, sender_name, sender_email, reply_to } = body;

    // Validate email format if provided
    if (sender_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender_email.trim())) {
      return NextResponse.json(
        { error: 'Invalid sender email address format.' },
        { status: 400 }
      );
    }

    if (reply_to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reply_to.trim())) {
      return NextResponse.json(
        { error: 'Invalid reply-to email address format.' },
        { status: 400 }
      );
    }

    if (api_key && typeof api_key === 'string' && api_key.trim() && !isEncryptionKeyConfigured()) {
      return NextResponse.json(
        {
          error: 'Server configuration error: EMAIL_ENCRYPTION_KEY is required for credential storage and live email operations. Please set EMAIL_ENCRYPTION_KEY in .env.local.',
        },
        { status: 500 }
      );
    }

    // Save encrypted credentials
    await saveEmailCredential(tenantId, {
      mode: mode === 'live' ? 'live' : 'demo',
      provider: provider || 'resend',
      apiKey: typeof api_key === 'string' && api_key.trim() ? api_key.trim() : undefined,
      sender_name: typeof sender_name === 'string' ? sender_name.trim() : undefined,
      sender_email: typeof sender_email === 'string' ? sender_email.trim() : undefined,
      reply_to: typeof reply_to === 'string' ? reply_to.trim() : undefined,
    });

    const publicConfig = await getPublicEmailConfig(tenantId);

    return NextResponse.json({
      success: true,
      message: 'Email connection saved. Verification is required before live sending.',
      email: publicConfig,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save email configuration';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    if (session.role === 'member') {
      return NextResponse.json(
        { error: 'Forbidden: Only business owners and administrators can disconnect email connections.' },
        { status: 403 }
      );
    }

    await disconnectEmail(tenantId);
    const publicConfig = await getPublicEmailConfig(tenantId);

    return NextResponse.json({
      success: true,
      message: 'Email connection disconnected. Queued unsent messages have been blocked.',
      email: publicConfig,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to disconnect email';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import {
  getEmailCredential,
  updateEmailVerificationStatus,
  getPublicEmailConfig,
} from '@/lib/db';
import { verifyResendConnection } from '@/lib/resend-service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    if (session.role === 'member') {
      return NextResponse.json(
        { error: 'Forbidden: Only business owners and administrators can test email connections.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const inlineApiKey = typeof body.api_key === 'string' ? body.api_key.trim() : null;
    const inlineSenderEmail = typeof body.sender_email === 'string' ? body.sender_email.trim() : null;

    // Retrieve stored credentials if no inline key is provided
    const { credential, decryptedApiKey } = await getEmailCredential(tenantId);
    const apiKeyToTest = inlineApiKey || decryptedApiKey;
    const senderToTest = inlineSenderEmail || credential?.sender_email || undefined;

    if (!apiKeyToTest) {
      return NextResponse.json(
        {
          success: false,
          status: 'error',
          error: 'No Resend API Key found to test. Please provide a key starting with "re_".',
        },
        { status: 400 }
      );
    }

    // Execute non-sending verification (Requirement 2)
    const verificationResult = await verifyResendConnection(apiKeyToTest, senderToTest);

    // Persist verification outcome
    await updateEmailVerificationStatus(
      tenantId,
      verificationResult.success,
      verificationResult.error || null
    );

    const publicConfig = await getPublicEmailConfig(tenantId);

    return NextResponse.json({
      success: verificationResult.success,
      status: verificationResult.status,
      error: verificationResult.error,
      domains: verificationResult.domains,
      limitationNotice: verificationResult.limitationNotice,
      email: publicConfig,
      message: verificationResult.success
        ? 'Resend API Key and sender domain verified successfully (non-sending check).'
        : `Verification failed: ${verificationResult.error}`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Verification failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

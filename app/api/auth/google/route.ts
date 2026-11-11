import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getGoogleOAuthConfig, generatePkcePair, buildGoogleAuthUrl } from '@/lib/gmail-service';
import { saveOAuthState } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    if (session.role === 'member') {
      return NextResponse.json(
        { error: 'Forbidden: Only business owners and administrators can connect Google accounts.' },
        { status: 403 }
      );
    }

    const origin = request.nextUrl.origin;
    const config = getGoogleOAuthConfig(origin);

    if (!config) {
      return NextResponse.json(
        {
          error:
            'Google OAuth is not configured on this platform. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local.',
          configured: false,
        },
        { status: 503 }
      );
    }

    // Generate PKCE code verifier and code challenge
    const { codeVerifier, codeChallenge } = generatePkcePair();

    // Generate single-use expiring state
    const state = `st_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minute expiry

    await saveOAuthState({
      state,
      tenant_id: tenantId,
      user_id: session.user_id,
      code_verifier: codeVerifier,
      redirect_uri: config.redirectUri,
      expires_at: expiresAt,
    });

    const authUrl = buildGoogleAuthUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      codeChallenge,
    });

    if (request.nextUrl.searchParams.get('redirect') === 'true') {
      return NextResponse.redirect(authUrl);
    }

    return NextResponse.json({
      success: true,
      url: authUrl,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to initialize Google OAuth';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getGoogleOAuthConfig, generatePkcePair, buildGoogleAuthUrl } from '@/lib/gmail-service';
import { saveOAuthState } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.origin;

  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    if (!session || !tenantId) {
      return NextResponse.redirect(
        new URL('/settings?tab=connections&error=Authentication+session+required+to+connect+Gmail', baseUrl)
      );
    }

    if (session.role === 'member') {
      return NextResponse.redirect(
        new URL('/settings?tab=connections&error=Forbidden:+Only+business+owners+and+administrators+can+connect+Google+accounts', baseUrl)
      );
    }

    const config = getGoogleOAuthConfig(baseUrl);

    if (!config) {
      return NextResponse.redirect(
        new URL(
          '/settings?tab=connections&error=Google+OAuth+is+not+configured+on+this+platform.+Please+check+credentials.',
          baseUrl
        )
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

    // Directly redirect browser to Google consent screen
    return NextResponse.redirect(authUrl);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to initialize Google OAuth login';
    return NextResponse.redirect(
      new URL(`/settings?tab=connections&error=${encodeURIComponent(message)}`, baseUrl)
    );
  }
}

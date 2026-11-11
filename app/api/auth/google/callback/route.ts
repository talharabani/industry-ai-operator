import { NextRequest, NextResponse } from 'next/server';
import { getAndConsumeOAuthState, saveGmailConnection, getBusiness } from '@/lib/db';
import {
  getGoogleOAuthConfig,
  exchangeGoogleCodeForTokens,
  getGoogleUserInfo,
  getGmailProfile,
} from '@/lib/gmail-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const errorParam = searchParams.get('error');

  const baseUrl = request.nextUrl.origin;

  if (errorParam) {
    const errorDesc = searchParams.get('error_description') || errorParam;
    return NextResponse.redirect(
      new URL(`/settings?tab=connections&error=${encodeURIComponent(`Google access denied: ${errorDesc}`)}`, baseUrl)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/settings?tab=connections&error=Missing+authorization+code+or+state', baseUrl)
    );
  }

  // 1. Consume and validate expiring, single-use state
  const oauthState = await getAndConsumeOAuthState(state);
  if (!oauthState) {
    return NextResponse.redirect(
      new URL('/settings?tab=connections&error=Invalid+or+expired+OAuth+session.+Please+try+connecting+again.', baseUrl)
    );
  }

  const tenantId = oauthState.tenant_id;
  const config = getGoogleOAuthConfig(baseUrl);

  if (!config) {
    return NextResponse.redirect(
      new URL('/settings?tab=connections&error=Google+OAuth+not+configured+on+platform', baseUrl)
    );
  }

  try {
    // 2. Exchange authorization code for tokens with PKCE code_verifier
    const tokenResult = await exchangeGoogleCodeForTokens({
      code,
      codeVerifier: oauthState.code_verifier,
      redirectUri: oauthState.redirect_uri || config.redirectUri,
      config,
    });

    // 3. Fetch Google User Profile
    const userInfo = await getGoogleUserInfo(tokenResult.accessToken);

    // 4. Fetch initial Gmail Profile for sync cursor (historyId)
    let historyId: string | null = null;
    try {
      const profile = await getGmailProfile(tokenResult.accessToken);
      historyId = profile.historyId || null;
    } catch (profileErr) {
      console.warn('[Gmail profile fetch warning]', profileErr);
    }

    const scopes = tokenResult.scope ? tokenResult.scope.split(' ') : [];

    // 5. Save Gmail connection with AES-256-GCM encrypted tokens
    await saveGmailConnection(tenantId, {
      google_email: userInfo.email,
      google_sub: userInfo.sub,
      google_name: userInfo.name || null,
      google_avatar: userInfo.picture || null,
      access_token: tokenResult.accessToken,
      refresh_token: tokenResult.refreshToken,
      expires_in: tokenResult.expiresIn,
      scopes,
      history_id: historyId,
    });

    return NextResponse.redirect(
      new URL(`/settings?tab=connections&gmail_connected=${encodeURIComponent(userInfo.email)}`, baseUrl)
    );
  } catch (error: unknown) {
    console.error('[Google OAuth Callback Error]', error);
    const message = error instanceof Error ? error.message : 'Failed to complete Google connection';
    return NextResponse.redirect(
      new URL(`/settings?tab=connections&error=${encodeURIComponent(message)}`, baseUrl)
    );
  }
}

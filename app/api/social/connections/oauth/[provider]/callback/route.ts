import { NextRequest, NextResponse } from 'next/server';
import { verifyAndConsumeSocialOAuthState, upsertSocialConnection } from '@/lib/social-db';
import { getSocialAdapter } from '@/lib/social-adapters';
import type { SocialPlatform } from '@/lib/social-types';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error') || url.searchParams.get('error_description');

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/social?tab=accounts&error=${encodeURIComponent(errorParam)}`, url.origin)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/social?tab=accounts&error=Missing_authorization_code_or_state', url.origin)
    );
  }

  try {
    const { provider } = await params;
    const platform = provider.toLowerCase() as SocialPlatform;

    // Verify and consume state to protect against CSRF
    const stateRecord = await verifyAndConsumeSocialOAuthState(state);
    if (!stateRecord) {
      return NextResponse.redirect(
        new URL('/social?tab=accounts&error=Invalid_or_expired_oauth_state', url.origin)
      );
    }

    const adapter = getSocialAdapter(platform);
    const redirectUri = `${url.origin}/api/social/connections/oauth/${platform}/callback`;

    // Exchange code for tokens
    const tokenResult = await adapter.exchangeCodeForTokens(code, redirectUri, stateRecord.code_verifier);

    // Persist securely encrypted connection
    await upsertSocialConnection(stateRecord.tenant_id, {
      platform,
      account_id: tokenResult.account_id,
      account_name: tokenResult.account_name,
      account_handle: tokenResult.account_handle,
      status: 'connected',
      scopes: tokenResult.scopes,
      selected_destinations: tokenResult.available_destinations,
      access_token: tokenResult.access_token,
      refresh_token: tokenResult.refresh_token,
      token_expires_at: tokenResult.expires_in
        ? new Date(Date.now() + tokenResult.expires_in * 1000)
        : undefined,
      metadata: tokenResult.metadata,
      connected_by: stateRecord.user_id,
    });

    return NextResponse.redirect(
      new URL(`/social?tab=accounts&success=connected&platform=${platform}`, url.origin)
    );
  } catch (err: any) {
    return NextResponse.redirect(
      new URL(`/social?tab=accounts&error=${encodeURIComponent(err.message || 'OAuth_callback_failed')}`, url.origin)
    );
  }
}

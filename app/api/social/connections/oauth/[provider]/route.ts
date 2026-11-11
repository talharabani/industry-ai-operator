import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getSocialAdapter } from '@/lib/social-adapters';
import { saveSocialOAuthState } from '@/lib/social-db';
import type { SocialPlatform } from '@/lib/social-types';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params;
    const platform = provider.toLowerCase() as SocialPlatform;

    if (!['facebook', 'instagram', 'tiktok'].includes(platform)) {
      return NextResponse.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
    }

    const session = await getAuthSession();
    const url = new URL(request.url);
    const requestedTenant = url.searchParams.get('tenant') || url.searchParams.get('tenant_id');

    const authCheck = await requireWorkspaceAccess(session, requestedTenant || undefined);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden: Workspace access denied.' }, { status: 403 });
    }

    const tenantId = authCheck.tenantId;
    const adapter = getSocialAdapter(platform);
    const validation = adapter.validateConfiguration();

    if (!validation.is_configured) {
      return NextResponse.json(
        {
          error: `Setup required: Missing ${validation.missing_keys.join(', ')}.`,
          setup_guide: validation.setup_guide,
        },
        { status: 422 }
      );
    }

    const redirectUri = `${url.origin}/api/social/connections/oauth/${platform}/callback`;
    const stateToken = crypto.randomBytes(24).toString('hex');

    await saveSocialOAuthState(stateToken, tenantId, session.user_id, platform, redirectUri);

    const authUrl = await adapter.getAuthorizationUrl(tenantId, redirectUri, stateToken);

    // If client requested JSON redirect or direct browser navigation
    if (url.searchParams.get('format') === 'json') {
      return NextResponse.json({ url: authUrl, state: stateToken });
    }

    return NextResponse.redirect(authUrl);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to initiate OAuth' }, { status: 500 });
  }
}

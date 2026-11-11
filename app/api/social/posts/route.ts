import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getSocialPosts, createSocialPost, getSocialBrandSettings } from '@/lib/social-db';
import type { SocialPlatform, SocialPostStatus } from '@/lib/social-types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const url = new URL(request.url);
    const requestedTenant = url.searchParams.get('tenant') || url.searchParams.get('tenant_id');
    const status = url.searchParams.get('status') as SocialPostStatus;
    const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : 50;

    const authCheck = await requireWorkspaceAccess(session, requestedTenant || undefined);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden: Workspace access denied.' }, { status: 403 });
    }

    const posts = await getSocialPosts(authCheck.tenantId, { status: status || undefined, limit });
    return NextResponse.json({ tenant_id: authCheck.tenantId, posts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to retrieve social posts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const body = await request.json().catch(() => ({}));
    const requestedTenant = typeof body.tenant_id === 'string' ? body.tenant_id.trim() : undefined;

    const authCheck = await requireWorkspaceAccess(session, requestedTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden: Workspace access denied.' }, { status: 403 });
    }

    const tenantId = authCheck.tenantId;

    if (!body.caption || typeof body.caption !== 'string' || body.caption.trim().length === 0) {
      return NextResponse.json({ error: 'Post caption is required.' }, { status: 400 });
    }

    const targetPlatforms: SocialPlatform[] = Array.isArray(body.target_platforms) && body.target_platforms.length > 0
      ? body.target_platforms
      : ['facebook'];

    const brandSettings = await getSocialBrandSettings(tenantId);
    const isAutopilot = brandSettings.automation_mode === 'autopilot';

    // In autopilot mode, post can be automatically approved if created by owner or scheduled
    const shouldApprove = Boolean(body.is_approved) || (isAutopilot && body.auto_approve !== false);

    const post = await createSocialPost(tenantId, {
      caption: body.caption.trim(),
      hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
      video_script: body.video_script,
      target_platforms: targetPlatforms,
      topic_theme: body.topic_theme,
      campaign_name: body.campaign_name,
      media_asset_ids: body.media_asset_ids,
      media_urls: body.media_urls,
      scheduled_at: body.scheduled_at,
      status: shouldApprove && body.scheduled_at ? 'scheduled' : (body.status || 'pending_approval'),
      is_approved: shouldApprove,
      approved_by: shouldApprove ? session.user_id : undefined,
    });

    return NextResponse.json({ success: true, post });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to create social post' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getSocialPostById, updateSocialPost, cancelSocialPost } from '@/lib/social-db';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getAuthSession();
    const url = new URL(request.url);
    const requestedTenant = url.searchParams.get('tenant') || url.searchParams.get('tenant_id');

    const authCheck = await requireWorkspaceAccess(session, requestedTenant || undefined);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden: Workspace access denied.' }, { status: 403 });
    }

    const post = await getSocialPostById(authCheck.tenantId, id);
    if (!post) {
      return NextResponse.json({ error: 'Post not found or access denied.' }, { status: 404 });
    }

    // Also fetch associated publishing jobs
    const jobs = await query<any>(
      `SELECT * FROM iao.social_publishing_jobs WHERE tenant_id = $1 AND post_id = $2 ORDER BY created_at ASC`,
      [authCheck.tenantId, id]
    );

    return NextResponse.json({ post, jobs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to retrieve post' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getAuthSession();
    const body = await request.json().catch(() => ({}));
    const requestedTenant = typeof body.tenant_id === 'string' ? body.tenant_id.trim() : undefined;

    const authCheck = await requireWorkspaceAccess(session, requestedTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden: Workspace access denied.' }, { status: 403 });
    }

    const updated = await updateSocialPost(authCheck.tenantId, id, {
      caption: body.caption,
      hashtags: body.hashtags,
      video_script: body.video_script,
      target_platforms: body.target_platforms,
      media_urls: body.media_urls,
      scheduled_at: body.scheduled_at,
    });

    return NextResponse.json({ success: true, post: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update post' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getAuthSession();
    const url = new URL(request.url);
    const requestedTenant = url.searchParams.get('tenant') || url.searchParams.get('tenant_id');

    const authCheck = await requireWorkspaceAccess(session, requestedTenant || undefined);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden: Workspace access denied.' }, { status: 403 });
    }

    const cancelled = await cancelSocialPost(
      authCheck.tenantId,
      id,
      url.searchParams.get('reason') || 'Cancelled by business owner'
    );

    return NextResponse.json({ success: true, post: cancelled });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to cancel post' }, { status: 500 });
  }
}

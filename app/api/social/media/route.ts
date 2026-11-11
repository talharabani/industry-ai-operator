import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getSocialMediaAssets, createSocialMediaAsset } from '@/lib/social-db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const url = new URL(request.url);
    const requestedTenant = url.searchParams.get('tenant') || url.searchParams.get('tenant_id');

    const authCheck = await requireWorkspaceAccess(session, requestedTenant || undefined);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden: Workspace access denied.' }, { status: 403 });
    }

    const assets = await getSocialMediaAssets(authCheck.tenantId);
    return NextResponse.json({ tenant_id: authCheck.tenantId, assets });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to retrieve media assets' }, { status: 500 });
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

    if (body.action === 'generate_branded_card') {
      const { generateBrandedSocialCard } = await import('@/lib/media-providers/index');
      const asset = await generateBrandedSocialCard(authCheck.tenantId, {
        headline: body.headline,
        subtext: body.subtext,
        theme: body.theme,
        aspectRatio: body.aspectRatio || 'square',
      });
      return NextResponse.json({ success: true, asset, message: 'Branded social card generated successfully' });
    }

    if (!body.storage_url || !body.filename) {
      return NextResponse.json({ error: 'storage_url and filename are required' }, { status: 400 });
    }

    const asset = await createSocialMediaAsset(authCheck.tenantId, {
      media_type: body.media_type === 'video' ? 'video' : 'image',
      storage_url: body.storage_url,
      filename: body.filename,
      filesize_bytes: body.filesize_bytes,
      mime_type: body.mime_type,
      source: body.source || 'owner_upload',
      dimensions: body.dimensions,
      duration_seconds: body.duration_seconds,
    });

    return NextResponse.json({ success: true, asset });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to create media asset' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getSocialBrandSettings, saveSocialBrandSettings } from '@/lib/social-db';

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

    const settings = await getSocialBrandSettings(authCheck.tenantId);
    return NextResponse.json({ settings, tenant_id: authCheck.tenantId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to retrieve social brand settings' }, { status: 500 });
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

    // Role check: Only owner or admin can update social automation settings
    if (authCheck.role !== 'owner' && authCheck.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Only owners and admins can configure social brand settings.' }, { status: 403 });
    }

    const updated = await saveSocialBrandSettings(authCheck.tenantId, {
      automation_mode: body.automation_mode,
      publishing_mode: body.publishing_mode === 'live' ? 'live' : (body.publishing_mode === 'simulation' ? 'simulation' : undefined),
      is_automation_paused: body.is_automation_paused !== undefined ? Boolean(body.is_automation_paused) : undefined,
      language: body.language,
      tone: body.tone,
      target_audience: body.target_audience,
      content_themes: body.content_themes,
      prohibited_topics: body.prohibited_topics,
      selected_platforms: body.selected_platforms,
      timezone: body.timezone,
      posting_days: body.posting_days,
      posting_times: body.posting_times,
      weekly_post_limit: body.weekly_post_limit,
      monthly_generation_limit: body.monthly_generation_limit,
      schedule_anchor_at: body.schedule_anchor_at,
    });

    const connections = await (await import('@/lib/social-db')).getSocialConnections(authCheck.tenantId);
    const modeInfo = (await import('@/lib/social-db')).getEffectivePublishingMode(updated.publishing_mode, connections);

    return NextResponse.json({
      success: true,
      settings: updated,
      effective_publishing_mode: modeInfo.effective_mode,
      live_publishing_gate_enabled: modeInfo.live_publishing_gate_enabled,
      live_publishing_block_reason: modeInfo.block_reason,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to save social brand settings' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import {
  getSocialConnections,
  getSocialConnection,
  upsertSocialConnection,
  disconnectSocialConnection,
} from '@/lib/social-db';
import { getAllSocialAdapters } from '@/lib/social-adapters';
import type { SocialPlatform } from '@/lib/social-types';

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

    const tenantId = authCheck.tenantId;
    const connections = await getSocialConnections(tenantId);
    const adapters = getAllSocialAdapters();

    // Map platforms with status and validation guides
    const platforms: SocialPlatform[] = ['facebook', 'instagram', 'tiktok'];
    const platformData = platforms.map((p) => {
      const conn = connections.find((c) => c.platform === p);
      const adapter = adapters[p];
      const validation = adapter ? adapter.validateConfiguration() : { is_configured: false, missing_keys: [], setup_guide: {} };

      let effectiveStatus = conn ? conn.status : (validation.is_configured ? 'setup_required' : 'setup_required');
      if (conn?.status === 'connected') {
        effectiveStatus = 'connected';
      }

      return {
        platform: p,
        is_connected: effectiveStatus === 'connected',
        status: effectiveStatus,
        connection: conn || null,
        configuration_validation: validation,
      };
    });

    return NextResponse.json({
      tenant_id: tenantId,
      connections,
      platforms: platformData,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to retrieve social connections' }, { status: 500 });
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

    if (authCheck.role !== 'owner' && authCheck.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Only owners and admins can configure connections.' }, { status: 403 });
    }

    const tenantId = authCheck.tenantId;
    const platform: SocialPlatform = body.platform;
    if (!platform || !['facebook', 'instagram', 'tiktok'].includes(platform)) {
      return NextResponse.json({ error: 'Valid platform (facebook, instagram, tiktok) required' }, { status: 400 });
    }

    // Action 1: Update destination selection
    if (body.action === 'select_destinations' && Array.isArray(body.selected_destinations)) {
      const existing = await getSocialConnection(tenantId, platform);
      if (!existing) {
        return NextResponse.json({ error: `No active connection found for ${platform}` }, { status: 404 });
      }

      const updated = await upsertSocialConnection(tenantId, {
        platform,
        account_id: existing.account_id,
        account_name: existing.account_name,
        account_handle: existing.account_handle,
        status: existing.status,
        scopes: existing.scopes,
        selected_destinations: body.selected_destinations,
        token_expires_at: existing.token_expires_at,
        metadata: existing.metadata,
        connected_by: session.user_id,
      });

      return NextResponse.json({ success: true, connection: updated });
    }

    // Action 2: Controlled sandbox connection (for developer / automated test verification)
    if (body.action === 'connect_simulation' && body.account_name) {
      const updated = await upsertSocialConnection(tenantId, {
        platform,
        account_id: `sim_acc_${tenantId}_${platform}`,
        account_name: body.account_name,
        account_handle: body.account_handle || `@${platform}_${tenantId}`,
        status: 'connected',
        scopes: ['publish_posts', 'read_insights'],
        selected_destinations: [
          {
            id: `dest_${platform}_${tenantId}`,
            name: `${body.account_name} (${platform})`,
            platform,
            is_default: true,
          },
        ],
        metadata: { simulation_account: true, simulated_at: new Date().toISOString() },
        connected_by: session.user_id,
      });

      return NextResponse.json({ success: true, connection: updated });
    }

    return NextResponse.json({ error: 'Invalid action or payload' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update connection' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const url = new URL(request.url);
    const requestedTenant = url.searchParams.get('tenant') || url.searchParams.get('tenant_id');
    const platform = url.searchParams.get('platform') as SocialPlatform;

    const authCheck = await requireWorkspaceAccess(session, requestedTenant || undefined);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden: Workspace access denied.' }, { status: 403 });
    }

    if (authCheck.role !== 'owner' && authCheck.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Only owners and admins can disconnect accounts.' }, { status: 403 });
    }

    if (!platform || !['facebook', 'instagram', 'tiktok'].includes(platform)) {
      return NextResponse.json({ error: 'Valid platform required for disconnection' }, { status: 400 });
    }

    const success = await disconnectSocialConnection(authCheck.tenantId, platform);
    return NextResponse.json({ success, disconnected_platform: platform });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to disconnect account' }, { status: 500 });
  }
}

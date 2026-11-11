import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getBusiness, updateServicesKnowledge } from '@/lib/db';
import { ServiceAreaItem } from '@/lib/types';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const url = new URL(request.url);
    const targetTenant = url.searchParams.get('tenant') || session.active_tenant_id;

    const authCheck = await requireWorkspaceAccess(session, targetTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden' }, { status: 403 });
    }

    const business = await getBusiness(authCheck.tenantId);
    const serviceAreas = business?.settings?.knowledge?.service_areas || [];

    return NextResponse.json({
      tenant_id: authCheck.tenantId,
      service_areas: serviceAreas,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to list service areas';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const body = await request.json().catch(() => ({}));
    const targetTenant = body.tenant_id ? String(body.tenant_id).trim() : session.active_tenant_id;

    const authCheck = await requireWorkspaceAccess(session, targetTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden' }, { status: 403 });
    }

    if (authCheck.role === 'member') {
      return NextResponse.json({ error: 'Only owners and admins can modify service areas.' }, { status: 403 });
    }

    const { name, type = 'city', coverage_details } = body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Area name is required.' }, { status: 400 });
    }

    const newArea: ServiceAreaItem = {
      id: `area_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
      name: name.trim(),
      type: (type as any) || 'city',
      coverage_details: typeof coverage_details === 'string' ? coverage_details.trim() : undefined,
      is_active: true,
    };

    const business = await getBusiness(authCheck.tenantId);
    const existingAreas: ServiceAreaItem[] = business?.settings?.knowledge?.service_areas || [];
    const updatedAreas = [...existingAreas, newArea];

    await updateServicesKnowledge(authCheck.tenantId, { service_areas: updatedAreas });

    return NextResponse.json({
      success: true,
      service_area: newArea,
    }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create service area';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const url = new URL(request.url);
    const areaId = url.searchParams.get('id');
    const targetTenant = url.searchParams.get('tenant') || session.active_tenant_id;

    const authCheck = await requireWorkspaceAccess(session, targetTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden' }, { status: 403 });
    }

    if (authCheck.role === 'member') {
      return NextResponse.json({ error: 'Only owners and admins can remove service areas.' }, { status: 403 });
    }

    if (!areaId) {
      return NextResponse.json({ error: 'Area ID is required.' }, { status: 400 });
    }

    const business = await getBusiness(authCheck.tenantId);
    const existingAreas: ServiceAreaItem[] = business?.settings?.knowledge?.service_areas || [];
    const filtered = existingAreas.filter((a) => a.id !== areaId);

    await updateServicesKnowledge(authCheck.tenantId, { service_areas: filtered });

    return NextResponse.json({ success: true, message: 'Service area removed.' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete service area';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getBusiness, updateServicesKnowledge, addServiceItem } from '@/lib/db';
import { ServiceItem } from '@/lib/types';

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
    const services = business?.settings?.knowledge?.services || [];

    return NextResponse.json({
      tenant_id: authCheck.tenantId,
      services,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to list services';
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
      return NextResponse.json({ error: 'Only owners and admins can modify services.' }, { status: 403 });
    }

    const {
      name,
      category = 'General',
      description = '',
      price_type = 'starting_at',
      price,
      currency = 'USD',
      duration_minutes,
      service_area,
      approval_status = 'approved',
    } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Service name is required.' }, { status: 400 });
    }

    const newService = await addServiceItem(authCheck.tenantId, {
      name: name.trim(),
      category: typeof category === 'string' ? category.trim() : 'General',
      description: typeof description === 'string' ? description.trim() : '',
      price_type: (price_type as any) || 'starting_at',
      price: typeof price === 'number' ? price : price ? Number(price) : undefined,
      currency: typeof currency === 'string' ? currency.trim() : 'USD',
      duration_minutes: duration_minutes ? Number(duration_minutes) : undefined,
      service_area: typeof service_area === 'string' ? service_area.trim() : undefined,
      is_active: true,
      approval_status: (approval_status as any) || 'approved',
      source: 'manual',
    });

    return NextResponse.json({
      success: true,
      service: newService,
    }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create service';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const url = new URL(request.url);
    const serviceId = url.searchParams.get('id');
    const targetTenant = url.searchParams.get('tenant') || session.active_tenant_id;

    const authCheck = await requireWorkspaceAccess(session, targetTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden' }, { status: 403 });
    }

    if (authCheck.role === 'member') {
      return NextResponse.json({ error: 'Only owners and admins can remove services.' }, { status: 403 });
    }

    if (!serviceId) {
      return NextResponse.json({ error: 'Service ID is required.' }, { status: 400 });
    }

    const business = await getBusiness(authCheck.tenantId);
    const existingServices: ServiceItem[] = business?.settings?.knowledge?.services || [];
    const filtered = existingServices.filter((s) => s.id !== serviceId);

    await updateServicesKnowledge(authCheck.tenantId, { services: filtered });

    return NextResponse.json({ success: true, message: 'Service removed successfully.' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete service';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

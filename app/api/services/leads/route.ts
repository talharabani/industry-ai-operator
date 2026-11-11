import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { listServicesLeads, createOrUpdateServicesLead } from '@/lib/services-pack';

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

    const stage = url.searchParams.get('stage') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 50;
    const offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : 0;

    const result = await listServicesLeads(authCheck.tenantId, {
      stage,
      status,
      search,
      limit,
      offset,
    });

    return NextResponse.json({
      tenant_id: authCheck.tenantId,
      leads: result.leads,
      total: result.total,
      limit,
      offset,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to list leads';
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

    const {
      customer_name,
      customer_email,
      customer_phone,
      service_interest,
      budget_range,
      location,
      notes,
    } = body;

    if (!customer_name || !customer_email) {
      return NextResponse.json({ error: 'Customer name and email are required.' }, { status: 400 });
    }

    const result = await createOrUpdateServicesLead(authCheck.tenantId, {
      customer_name: String(customer_name).trim(),
      customer_email: String(customer_email).trim(),
      customer_phone: customer_phone ? String(customer_phone).trim() : null,
      service_interest: service_interest ? String(service_interest).trim() : null,
      budget_range: budget_range ? String(budget_range).trim() : null,
      location: location ? String(location).trim() : null,
      source: 'manual',
      inquiry_text: notes || 'Manually entered lead by team member.',
    });

    return NextResponse.json({
      success: true,
      lead: result.lead,
      is_new: result.isNew,
    }, { status: result.isNew ? 201 : 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create lead';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

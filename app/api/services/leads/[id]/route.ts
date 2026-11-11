import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getServicesLead, updateServicesLead, getServicesLeadEvents } from '@/lib/services-pack';
import { getConversation, listMessages } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession();
    const { id: leadId } = await context.params;
    const url = new URL(request.url);
    const targetTenant = url.searchParams.get('tenant') || session.active_tenant_id;

    const authCheck = await requireWorkspaceAccess(session, targetTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden' }, { status: 403 });
    }

    const lead = await getServicesLead(authCheck.tenantId, leadId);
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    }

    const events = await getServicesLeadEvents(authCheck.tenantId, leadId);

    let conversation = null;
    let messages: unknown[] = [];
    if (lead.conversation_id) {
      conversation = await getConversation(authCheck.tenantId, lead.conversation_id);
      messages = await listMessages(authCheck.tenantId, lead.conversation_id);
    }

    return NextResponse.json({
      lead,
      events,
      conversation,
      messages,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve lead details';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession();
    const { id: leadId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const targetTenant = body.tenant_id ? String(body.tenant_id).trim() : session.active_tenant_id;

    const authCheck = await requireWorkspaceAccess(session, targetTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden' }, { status: 403 });
    }

    const {
      stage,
      status,
      assigned_member_id,
      assigned_member_name,
      next_action,
      due_date,
      estimated_value,
      notes,
      manual_takeover,
    } = body;

    const updated = await updateServicesLead(
      authCheck.tenantId,
      leadId,
      {
        stage,
        status,
        assigned_member_id,
        assigned_member_name,
        next_action,
        due_date,
        estimated_value: typeof estimated_value === 'number' ? estimated_value : undefined,
        notes,
        manual_takeover: Boolean(manual_takeover),
      },
      {
        id: session.user_id,
        name: session.user_name,
        type: session.role || 'owner',
      }
    );

    if (!updated) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    }

    const events = await getServicesLeadEvents(authCheck.tenantId, leadId);

    return NextResponse.json({
      success: true,
      lead: updated,
      events,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update lead';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

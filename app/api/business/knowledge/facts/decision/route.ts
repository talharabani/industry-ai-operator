import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { decideExtractedFact } from '@/lib/services-pack';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const body = await request.json().catch(() => ({}));
    const { fact_id, decision, tenant_id } = body;
    const targetTenant = tenant_id ? String(tenant_id).trim() : session.active_tenant_id;

    const authCheck = await requireWorkspaceAccess(session, targetTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden' }, { status: 403 });
    }

    if (authCheck.role === 'member') {
      return NextResponse.json({ error: 'Only owners and admins can approve or reject extracted facts.' }, { status: 403 });
    }

    if (!fact_id || typeof fact_id !== 'string') {
      return NextResponse.json({ error: 'Fact ID is required.' }, { status: 400 });
    }

    if (decision !== 'approved' && decision !== 'rejected') {
      return NextResponse.json({ error: 'Decision must be "approved" or "rejected".' }, { status: 400 });
    }

    const updatedFact = await decideExtractedFact(authCheck.tenantId, fact_id, decision);
    if (!updatedFact) {
      return NextResponse.json({ error: 'Extracted fact not found.' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      fact: updatedFact,
      message: `Fact marked as ${decision}. ${decision === 'approved' ? 'Fact is now active for routine customer inquiries.' : ''}`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to record decision';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getCase, getOrder, listAudit } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const { id: caseId } = await context.params;

    if (!caseId) {
      return NextResponse.json({ error: 'Case ID is required' }, { status: 400 });
    }

    const caseData = await getCase(tenantId, caseId);
    if (!caseData) {
      return NextResponse.json({ error: `Case ${caseId} not found` }, { status: 404 });
    }

    // Attempt to load associated order if order_id is in payload
    let orderData = null;
    const orderId =
      (caseData.payload?.order_id as string) ||
      (caseData.payload?.orderId as string);

    if (orderId) {
      orderData = await getOrder(tenantId, orderId);
    }

    // Load audit trail for this specific case
    const auditRecords = await listAudit(tenantId, { caseId, limit: 20 });

    return NextResponse.json(
      {
        case: caseData,
        order: orderData,
        audit: auditRecords,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve case';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

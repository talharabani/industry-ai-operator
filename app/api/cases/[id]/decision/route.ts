import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getCase, getBusiness, decideCaseInDB } from '@/lib/db';
import { submitCaseDecision, N8nApiError } from '@/lib/n8n';
import { canMemberApprove } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const { id: caseId } = await context.params;

    if (!caseId) {
      return NextResponse.json({ error: 'Case ID is required.' }, { status: 400 });
    }

    // Verify member approval authorization
    const business = await getBusiness(tenantId);
    const member = business?.settings?.team_members?.find((m) => m.id === session.user_id) || {
      id: session.user_id,
      name: session.user_name,
      email: session.email,
      role: session.role,
      can_approve: session.role === 'owner',
      created_at: new Date().toISOString(),
    };

    if (!canMemberApprove(member)) {
      return NextResponse.json(
        { error: 'Forbidden: Your user role does not have authorization to approve or reject proposals.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { decision, proposal } = body;
    const expected_revision = body.expected_revision ?? body.expectedRevision;

    if (!decision || (decision !== 'approve' && decision !== 'reject')) {
      return NextResponse.json(
        { error: 'Field "decision" must be either "approve" or "reject".' },
        { status: 400 }
      );
    }

    if (expected_revision === undefined || typeof expected_revision !== 'number') {
      return NextResponse.json(
        { error: 'Field "expected_revision" is required and must be a number.' },
        { status: 400 }
      );
    }

    // 1. Load trusted case on the server from PostgreSQL
    const trustedCase = await getCase(tenantId, caseId);
    if (!trustedCase) {
      return NextResponse.json({ error: `Case '${caseId}' not found.` }, { status: 404 });
    }

    // Check status & idempotency: repeated clicks or retries with same decision
    if (trustedCase.status !== 'pending_approval') {
      if (trustedCase.status === (decision === 'approve' ? 'approved' : 'rejected')) {
        return NextResponse.json({
          success: true,
          case_id: caseId,
          decision,
          approver_id: session.user_id,
          revision: trustedCase.revision,
          status: trustedCase.status,
          case: trustedCase,
          already_decided: true,
        });
      }
      return NextResponse.json(
        {
          error: `Case is currently in status "${trustedCase.status}", not "pending_approval". Decisions can only be made on pending cases.`,
          current_status: trustedCase.status,
          current_revision: trustedCase.revision,
        },
        { status: 400 }
      );
    }

    // Check revision conflict
    if (trustedCase.revision !== expected_revision) {
      return NextResponse.json(
        {
          error: `Revision conflict (HTTP 409): Displayed revision ${expected_revision} does not match current server revision ${trustedCase.revision}. Please refresh and review the updated proposal.`,
          expected_revision,
          current_revision: trustedCase.revision,
          case: trustedCase,
        },
        { status: 409 }
      );
    }

    // Gap 4: Keep provider-specific validation separate from shared approval logic
    if (decision === 'approve') {
      const isShopifyCase = Boolean(
        trustedCase.payload?.shopify_order_id ||
        trustedCase.payload?.shop_domain ||
        trustedCase.payload?.channel === 'shopify' ||
        trustedCase.payload?.provider === 'shopify' ||
        (trustedCase.proposal as any)?.platform === 'shopify' ||
        (trustedCase.proposal as any)?.provider === 'shopify'
      );

      if (isShopifyCase) {
        const { getShopifyConnection } = await import('@/lib/db');
        const shopifyConn = await getShopifyConnection(tenantId);
        if (!shopifyConn || !shopifyConn.is_connected) {
          return NextResponse.json(
            { error: 'A connected Shopify store is required to authorize Shopify order actions.' },
            { status: 400 }
          );
        }
      }

      const orderId =
        (trustedCase.payload?.order_id as string) ||
        (trustedCase.payload?.orderId as string) ||
        ((trustedCase.proposal as any)?.order_id as string);
      if (!orderId || !orderId.trim()) {
        return NextResponse.json(
          { error: 'A valid, stable Order ID is required to authorize this proposal.' },
          { status: 400 }
        );
      }

      const isRefund =
        trustedCase.kind === 'return' ||
        String((trustedCase.proposal as any)?.action || '').toLowerCase().includes('refund');
      if (isRefund) {
        const amount = (trustedCase.proposal as any)?.amount;
        const currency = (trustedCase.proposal as any)?.currency;
        if (typeof amount !== 'number' || amount <= 0 || !currency || typeof currency !== 'string' || !currency.trim()) {
          return NextResponse.json(
            { error: 'Missing or changed refund amount or source currency; requires manual review before authorization.' },
            { status: 400 }
          );
        }
      }
    }

    // Use the exact trusted proposal from database
    const trustedProposal = trustedCase.proposal;

    // 2. Perform trusted database update
    const dbResult = await decideCaseInDB({
      tenantId,
      caseId,
      decision,
      approverId: session.user_id,
      expectedRevision: expected_revision,
      approvedProposal: trustedProposal,
    });

    // 3. Notify n8n webhook if configured (non-fatal if local db succeeded)
    try {
      const n8nResult = await submitCaseDecision({
        caseId,
        decision,
        expectedRevision: expected_revision,
        approvedProposal: trustedProposal,
      });
      return NextResponse.json({
        ...n8nResult,
        success: true,
        case_id: caseId,
        decision,
        approver_id: session.user_id,
        revision: dbResult?.case?.revision || expected_revision + 1,
        status: dbResult?.case?.status || (decision === 'approve' ? 'approved' : 'rejected'),
        case: dbResult?.case,
      });
    } catch (n8nErr) {
      if (dbResult) {
        return NextResponse.json({
          success: true,
          case_id: caseId,
          decision,
          approver_id: session.user_id,
          revision: dbResult.case.revision,
          status: dbResult.case.status,
          case: dbResult.case,
        });
      }

      if (n8nErr instanceof N8nApiError) {
        return NextResponse.json(
          {
            error: n8nErr.message,
            details: n8nErr.data,
            status: n8nErr.status,
          },
          { status: n8nErr.status }
        );
      }
      throw n8nErr;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to process decision';
    console.error('[Decision Route Error]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

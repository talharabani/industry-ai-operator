import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { listOrderIssues, createOrderIssue, investigateOrderData } from '@/lib/order-issues';
import { listOrders, getBusiness } from '@/lib/db';
import type { OrderIssueType, OrderIssueStatus, OrderIssueResponsibleParty } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const { searchParams } = new URL(request.url);

    const status = (searchParams.get('status') as OrderIssueStatus) || undefined;
    const issueType = (searchParams.get('issue_type') as OrderIssueType) || undefined;
    const orderId = searchParams.get('order_id') || undefined;
    const conversationId = searchParams.get('conversation_id') || undefined;
    const responsibleParty = (searchParams.get('responsible_party') as OrderIssueResponsibleParty) || undefined;
    const search = searchParams.get('search') || undefined;
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const { issues, total } = await listOrderIssues(tenantId, {
      status,
      issueType,
      orderId,
      conversationId,
      responsibleParty,
      search,
      limit,
      offset,
    });

    // Compute active summary counts for dashboard
    const allActive = await listOrderIssues(tenantId, { limit: 500 });
    const unresolvedCount = allActive.issues.filter((i) => i.status !== 'resolved' && i.status !== 'closed').length;
    const awaitingOwnerCount = allActive.issues.filter((i) => i.status === 'awaiting_owner' || i.responsible_party === 'owner').length;
    const actionPendingCount = allActive.issues.filter((i) => i.status === 'action_pending').length;

    return NextResponse.json({
      issues,
      total,
      limit,
      offset,
      summary: {
        unresolved_count: unresolvedCount,
        awaiting_owner_count: awaitingOwnerCount,
        action_pending_count: actionPendingCount,
      },
      tenant_id: tenantId,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch order issues';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const body = await request.json().catch(() => ({}));

    const {
      issue_type,
      order_id,
      customer_name,
      customer_email,
      customer_claim,
      conversation_id,
      shop_domain,
    } = body;

    if (!issue_type || typeof issue_type !== 'string') {
      return NextResponse.json({ error: 'Field "issue_type" is required.' }, { status: 400 });
    }

    if (!customer_email || typeof customer_email !== 'string') {
      return NextResponse.json({ error: 'Field "customer_email" is required.' }, { status: 400 });
    }

    // Match order from verified orders
    const orders = await listOrders(tenantId);
    const matchedOrder = order_id ? orders.find((o) => o.order_id === order_id || o.order_id === `#${order_id}`) || null : null;

    const { evidence, initialStatus, nextAction, responsibleParty } = investigateOrderData(
      matchedOrder,
      issue_type as OrderIssueType,
      customer_claim || ''
    );

    const issue = await createOrderIssue({
      tenantId,
      issueType: issue_type as OrderIssueType,
      status: initialStatus,
      orderId: matchedOrder?.order_id || order_id || null,
      shopDomain: shop_domain || null,
      conversationId: conversation_id || null,
      customerName: customer_name || 'Customer',
      customerEmail: customer_email.trim().toLowerCase(),
      evidence,
      nextAction,
      responsibleParty,
    });

    return NextResponse.json({ success: true, issue }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create order issue';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

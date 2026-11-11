import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import {
  getOrderIssue,
  updateOrderIssue,
  listOrderIssueEvents,
  addOrderIssueEvent,
} from '@/lib/order-issues';
import { query } from '@/lib/db';
import type { OrderIssueStatus, OrderIssueResponsibleParty, OrderIssueFollowupJobRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const { id: issueId } = await context.params;

    if (!issueId) {
      return NextResponse.json({ error: 'Issue ID is required' }, { status: 400 });
    }

    const issue = await getOrderIssue(tenantId, issueId);
    if (!issue) {
      return NextResponse.json({ error: `Order issue '${issueId}' not found.` }, { status: 404 });
    }

    const events = await listOrderIssueEvents(tenantId, issueId);
    const followupJobs = await query<OrderIssueFollowupJobRecord>(
      `SELECT * FROM iao.order_issue_followup_jobs 
       WHERE tenant_id = $1 AND issue_id = $2 
       ORDER BY created_at DESC;`,
      [tenantId, issueId]
    );

    return NextResponse.json({
      issue,
      events,
      timeline: events,
      followup_jobs: followupJobs,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch order issue details';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const { id: issueId } = await context.params;
    const body = await request.json().catch(() => ({}));

    if (!issueId) {
      return NextResponse.json({ error: 'Issue ID is required' }, { status: 400 });
    }

    const current = await getOrderIssue(tenantId, issueId);
    if (!current) {
      return NextResponse.json({ error: `Order issue '${issueId}' not found.` }, { status: 404 });
    }

    const {
      status,
      next_action,
      responsible_party,
      due_date,
      resolution_summary,
      evidence_updates,
      add_owner_task,
      complete_owner_task_id,
      timeline_note,
    } = body;

    const updates: Record<string, any> = {};

    if (status) updates.status = status as OrderIssueStatus;
    if (next_action !== undefined) updates.next_action = next_action;
    if (responsible_party) updates.responsible_party = responsible_party as OrderIssueResponsibleParty;
    if (due_date !== undefined) updates.due_date = due_date;
    if (resolution_summary !== undefined) updates.resolution_summary = resolution_summary;

    let mergedEvidence = { ...current.evidence, ...(evidence_updates || {}) };

    if (add_owner_task && typeof add_owner_task === 'string') {
      const existingTasks = mergedEvidence.owner_tasks || [];
      const newTask = {
        id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        title: add_owner_task.trim(),
        status: 'pending' as const,
        created_at: new Date().toISOString(),
      };
      mergedEvidence.owner_tasks = [...existingTasks, newTask];
      updates.evidence = mergedEvidence;
    }

    if (complete_owner_task_id) {
      const existingTasks = mergedEvidence.owner_tasks || [];
      mergedEvidence.owner_tasks = existingTasks.map((t: any) =>
        t.id === complete_owner_task_id
          ? { ...t, status: 'completed' as const, completed_at: new Date().toISOString() }
          : t
      );
      updates.evidence = mergedEvidence;
    }

    const updated = await updateOrderIssue(tenantId, issueId, updates, {
      actorType: 'owner',
      actorId: session.user_id,
      summary: timeline_note || `Issue updated by ${session.user_name || 'store owner'}`,
    });

    if (timeline_note) {
      await addOrderIssueEvent({
        tenantId,
        issueId,
        eventType: 'status_changed',
        actorType: 'owner',
        actorId: session.user_id,
        summary: timeline_note,
      });
    }

    return NextResponse.json({ success: true, issue: updated });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to update order issue';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

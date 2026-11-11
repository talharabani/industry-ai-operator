import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { recordManualActionExecution } from '@/lib/order-issues';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; taskId: string }> }
) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const { id: issueId, taskId } = await context.params;

    if (!issueId || !taskId) {
      return NextResponse.json({ error: 'Issue ID and Task ID are required.' }, { status: 400 });
    }

    // Requirement 9: Owner-only permissions check
    if (session.role !== 'owner') {
      return NextResponse.json(
        { error: 'Forbidden: Only store owners can record manual execution of authorized actions.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { execution_reference, evidence, completed_at } = body;

    if (!execution_reference || typeof execution_reference !== 'string' || !execution_reference.trim()) {
      return NextResponse.json(
        { error: 'Field "execution_reference" is required (e.g. Shopify refund ID, transaction code, or note).' },
        { status: 400 }
      );
    }

    const result = await recordManualActionExecution({
      tenantId,
      issueId,
      taskId,
      ownerId: session.user_id,
      executionReference: execution_reference.trim(),
      evidenceNotes: evidence ? String(evidence) : undefined,
      completedAt: completed_at ? String(completed_at) : undefined,
    });

    return NextResponse.json({
      success: true,
      issue: result.issue,
      task: result.task,
      remaining_pending_tasks_count: result.remainingPendingTasksCount,
      already_completed: result.alreadyCompleted,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to record manual execution';
    console.error('[Record Manual Execution Error]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorOrCronAuth } from '@/lib/cron-auth';
import { dispatchServicesLeadFollowup } from '@/lib/services-pack';
import { getBusiness } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = verifyOperatorOrCronAuth(request);
    if (!auth.authorized) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid operator credentials or cron secret required.' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { tenant_id, lead_id, job_id, custom_message, mock } = body;

    if (!tenant_id || !lead_id || !job_id) {
      return NextResponse.json(
        { error: 'Fields "tenant_id", "lead_id", and "job_id" are required.' },
        { status: 400 }
      );
    }

    const cleanTenantId = String(tenant_id).trim();
    const cleanLeadId = String(lead_id).trim();
    const cleanJobId = String(job_id).trim();

    const biz = await getBusiness(cleanTenantId);
    if (!biz) {
      return NextResponse.json(
        { error: `Business workspace '${cleanTenantId}' not found.` },
        { status: 404 }
      );
    }

    const result = await dispatchServicesLeadFollowup({
      tenantId: cleanTenantId,
      leadId: cleanLeadId,
      jobId: cleanJobId,
      customMessage: typeof custom_message === 'string' ? custom_message : undefined,
      mock: mock !== undefined ? Boolean(mock) : true,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          dispatched: false,
          tenant_id: String(tenant_id).trim(),
          lead_id: String(lead_id).trim(),
          job_id: String(job_id).trim(),
          reason: result.reason,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      tenant_id: String(tenant_id).trim(),
      lead_id: String(lead_id).trim(),
      job_id: String(job_id).trim(),
      dispatched: result.dispatched,
      reminder_count: result.reminder_count,
      message_id: result.messageId,
      status: result.dispatched ? 'dispatched_simulated' : 'draft_pending_approval',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to dispatch follow-up';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

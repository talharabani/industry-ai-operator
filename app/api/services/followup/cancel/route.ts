import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorOrCronAuth } from '@/lib/cron-auth';
import { cancelServicesLeadFollowup } from '@/lib/services-pack';
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
    const { tenant_id, lead_id, job_id, reason } = body;

    if (!tenant_id || !lead_id) {
      return NextResponse.json(
        { error: 'Fields "tenant_id" and "lead_id" are required.' },
        { status: 400 }
      );
    }

    const cleanTenantId = String(tenant_id).trim();
    const cleanLeadId = String(lead_id).trim();
    const cleanJobId = job_id ? String(job_id).trim() : undefined;

    const biz = await getBusiness(cleanTenantId);
    if (!biz) {
      return NextResponse.json(
        { error: `Business workspace '${cleanTenantId}' not found.` },
        { status: 404 }
      );
    }

    await cancelServicesLeadFollowup({
      tenantId: cleanTenantId,
      leadId: cleanLeadId,
      jobId: cleanJobId,
      reason: reason || 'Follow-up rendered obsolete',
    });

    return NextResponse.json({
      success: true,
      tenant_id: String(tenant_id).trim(),
      lead_id: String(lead_id).trim(),
      job_id: job_id ? String(job_id).trim() : undefined,
      message: 'Follow-up job cancelled successfully.',
      reason,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to cancel follow-up';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

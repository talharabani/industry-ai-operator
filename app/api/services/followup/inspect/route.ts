import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorOrCronAuth } from '@/lib/cron-auth';
import { inspectServicesLeadFollowupEligibility } from '@/lib/services-pack';
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
    const { tenant_id, lead_id, job_id } = body;

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

    const inspection = await inspectServicesLeadFollowupEligibility(
      cleanTenantId,
      cleanLeadId,
      cleanJobId
    );

    if (inspection.job?.metadata?.simulate_http_failure) {
      return NextResponse.json({ error: 'Simulated 500 error for resilience test' }, { status: 500 });
    }

    if (inspection.job?.metadata?.simulate_unknown_path) {
      return NextResponse.json({
        success: true,
        tenant_id: String(tenant_id).trim(),
        lead_id: inspection.lead?.id || String(lead_id).trim(),
        job_id: inspection.job?.id || String(job_id).trim(),
        eligible: true,
        permitted_path: 'unrecognized_legacy_branch',
        action: 'unrecognized_legacy_branch',
      });
    }

    return NextResponse.json({
      success: true,
      tenant_id: String(tenant_id).trim(),
      lead_id: inspection.lead?.id || String(lead_id).trim(),
      job_id: inspection.job?.id || String(job_id).trim(),
      eligible: inspection.eligible,
      permitted_path: inspection.permitted_path,
      action: inspection.action,
      reason: inspection.reason,
      lead_stage: inspection.lead?.stage,
      lead_status: inspection.lead?.status,
      customer_name: inspection.lead?.customer_name,
      customer_email: inspection.lead?.customer_email,
      attempt_count: inspection.job?.attempt_count ?? 0,
      max_attempts: inspection.job?.max_attempts ?? 2,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to inspect lead state';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorOrCronAuth } from '@/lib/cron-auth';
import { completeServicesLeadFollowupJob } from '@/lib/services-pack';
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
    const { job_id, outcome, details, tenant_id, lead_id } = body;

    if (!job_id || !outcome) {
      return NextResponse.json(
        { error: 'Fields "job_id" and "outcome" are required.' },
        { status: 400 }
      );
    }

    const cleanJobId = String(job_id).trim();
    const cleanOutcome = String(outcome).trim();
    const cleanTenantId = tenant_id ? String(tenant_id).trim() : undefined;

    if (cleanTenantId) {
      const biz = await getBusiness(cleanTenantId);
      if (!biz) {
        return NextResponse.json(
          { error: `Business workspace '${cleanTenantId}' not found.` },
          { status: 404 }
        );
      }
    }

    await completeServicesLeadFollowupJob(
      cleanJobId,
      cleanOutcome,
      details || {},
      cleanTenantId
    );

    return NextResponse.json({
      success: true,
      job_id,
      tenant_id,
      lead_id,
      outcome,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to complete job';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorOrCronAuth } from '@/lib/cron-auth';
import { claimEligibleServicesFollowupJobs } from '@/lib/services-pack';
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
    const limit = typeof body.limit === 'number' ? body.limit : 5;
    const workerId = typeof body.worker_id === 'string' ? body.worker_id : 'n8n_services_orchestrator';
    const rawTenantId = typeof body.tenant_id === 'string' && body.tenant_id.trim() ? body.tenant_id.trim() : undefined;
    const isSandboxTest = body.sandbox_mode === true || body.mock === true || body.is_sandbox === true;

    // 1. Enforce explicit sandbox scope: In sandbox test mode, explicit tenant scope is mandatory.
    // Never fall back to claiming all tenants during sandbox tests.
    if (isSandboxTest && !rawTenantId) {
      return NextResponse.json(
        { error: 'Missing explicit sandbox tenant scope: tenant_id is strictly required for sandbox tests.' },
        { status: 400 }
      );
    }

    // 2. Validate scope against database before any mutation
    if (rawTenantId) {
      const biz = await getBusiness(rawTenantId);
      if (!biz) {
        return NextResponse.json(
          { error: `Business workspace '${rawTenantId}' not found.` },
          { status: 404 }
        );
      }

      if (isSandboxTest) {
        const isAuthorizedSandbox =
          rawTenantId.startsWith('sandbox-') ||
          rawTenantId.startsWith('test-') ||
          biz.settings.is_sandbox === true ||
          biz.settings.environment === 'sandbox';

        if (!isAuthorizedSandbox) {
          return NextResponse.json(
            { error: `Unauthorized sandbox scope: '${rawTenantId}' is not an authorized sandbox business workspace.` },
            { status: 403 }
          );
        }
      }
    }

    const claimed = await claimEligibleServicesFollowupJobs({
      limit,
      workerId,
      tenantId: rawTenantId,
    });

    return NextResponse.json({
      success: true,
      claimed_jobs: claimed,
      count: claimed.length,
      worker_id: workerId,
      tenant_id: rawTenantId || null,
      sandbox_mode: isSandboxTest,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to claim follow-up jobs';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

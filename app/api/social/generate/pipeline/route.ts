import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorOrCronAuth } from '@/lib/cron-auth';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getSocialGenerationJob } from '@/lib/social-db';
import { runSocialGenerationPipeline } from '@/lib/social-generator';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const jobId = body.job_id;

    if (!jobId) {
      return NextResponse.json({ error: 'Missing job_id parameter' }, { status: 400 });
    }

    // Verify authentication: either operator/cron secret header or valid owner session
    const operatorAuth = verifyOperatorOrCronAuth(request);
    if (!operatorAuth.authorized) {
      const session = await getAuthSession();
      const job = await getSocialGenerationJob(jobId);
      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }
      const authCheck = await requireWorkspaceAccess(session, job.tenant_id);
      if (!authCheck.authorized) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Execute the generation pipeline
    const completedJob = await runSocialGenerationPipeline(jobId);

    return NextResponse.json({
      success: true,
      job: completedJob,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Pipeline execution failed' },
      { status: 500 }
    );
  }
}

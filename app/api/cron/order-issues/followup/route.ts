import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorOrCronAuth } from '@/lib/auth';
import { claimDueFollowupJobs, processClaimedFollowupJob } from '@/lib/order-issues';
import { getBusiness } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleFollowups(request);
}

export async function POST(request: NextRequest) {
  return handleFollowups(request);
}

async function handleFollowups(request: NextRequest) {
  // 1. Authenticate Request via Operator Key / Cron Secret
  const auth = verifyOperatorOrCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized: Invalid operator key or cron secret.' },
      { status: 401 }
    );
  }

  // 2. Parse Parameters
  const { searchParams } = new URL(request.url);
  let body: Record<string, any> = {};
  if (request.method === 'POST') {
    body = await request.json().catch(() => ({}));
  }

  const limit = parseInt(searchParams.get('limit') || body.limit || '10', 10);
  const claimedBy = (searchParams.get('worker') || body.worker || 'n8n_followup_worker').toString();

  // 3. Atomically Claim Due Jobs with SELECT ... FOR UPDATE SKIP LOCKED
  const claimedJobs = await claimDueFollowupJobs(limit, claimedBy);

  if (claimedJobs.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No order issue follow-up jobs currently due for processing.',
      claimed_count: 0,
      completed_count: 0,
      escalated_count: 0,
      cancelled_count: 0,
      timestamp: new Date().toISOString(),
    });
  }

  // 4. Process Claimed Jobs
  const results: Record<string, any> = {};
  let completedCount = 0;
  let escalatedCount = 0;
  let cancelledCount = 0;
  let pausedCount = 0;

  for (const job of claimedJobs) {
    try {
      const business = await getBusiness(job.tenant_id);
      const res = await processClaimedFollowupJob(job, business?.settings);

      results[job.id] = res;
      if (res.outcome === 'completed') completedCount++;
      else if (res.outcome === 'escalated_to_owner') escalatedCount++;
      else if (res.outcome === 'cancelled_obsolete') cancelledCount++;
      else if (res.outcome === 'paused_delayed') pausedCount++;
    } catch (jobErr: unknown) {
      const errMsg = jobErr instanceof Error ? jobErr.message : String(jobErr);
      results[job.id] = {
        jobId: job.id,
        outcome: 'failed',
        message: `Execution error: ${errMsg}`,
      };
    }
  }

  return NextResponse.json({
    success: true,
    claimed_count: claimedJobs.length,
    completed_count: completedCount,
    escalated_count: escalatedCount,
    cancelled_count: cancelledCount,
    paused_count: pausedCount,
    results,
    timestamp: new Date().toISOString(),
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorOrCronAuth } from '@/lib/cron-auth';
import { claimDueSocialPublishingJobs } from '@/lib/social-db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = verifyOperatorOrCronAuth(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Unauthorized operator' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const limit = typeof body.limit === 'number' ? body.limit : 10;
    const workerId = body.worker_id || 'n8n_social_worker';

    const claimedJobs = await claimDueSocialPublishingJobs(limit, workerId);

    return NextResponse.json({
      success: true,
      claimed_count: claimedJobs.length,
      jobs: claimedJobs,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to claim social jobs' }, { status: 500 });
  }
}

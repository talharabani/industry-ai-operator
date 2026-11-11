import { NextRequest, NextResponse } from 'next/server';
import { verifyOperatorOrCronAuth } from '@/lib/cron-auth';
import {
  getSocialPostById,
  getSocialBrandSettings,
  getSocialConnection,
  updatePublishingJobOutcome,
  computeSocialApprovalSnapshotHash,
} from '@/lib/social-db';
import { getSocialAdapter } from '@/lib/social-adapters';
import { query } from '@/lib/db';
import type { SocialPlatform } from '@/lib/social-types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = verifyOperatorOrCronAuth(request);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Unauthorized operator' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { job_id } = body;

    if (!job_id) {
      return NextResponse.json({ error: 'job_id is required' }, { status: 400 });
    }

    // 1. Fetch job record
    const jobRows = await query<any>(
      `SELECT * FROM iao.social_publishing_jobs WHERE id = $1 LIMIT 1`,
      [job_id]
    );

    if (jobRows.length === 0) {
      return NextResponse.json({ error: `Job not found: ${job_id}` }, { status: 404 });
    }

    const job = jobRows[0];
    const tenantId = job.tenant_id;
    const postId = job.post_id;
    const platform = job.platform as SocialPlatform;

    // 2. Immediate pre-publishing validation: Recheck tenant settings & pause status
    const brandSettings = await getSocialBrandSettings(tenantId);
    if (brandSettings.is_automation_paused) {
      const outcome = await updatePublishingJobOutcome(job_id, {
        status: 'cancelled',
        error_message: 'Automation is paused by business owner.',
        error_code: 'AUTOMATION_PAUSED',
      });
      return NextResponse.json({ success: false, reason: 'AUTOMATION_PAUSED', job: outcome });
    }

    // 3. Immediate pre-publishing validation: Recheck post status & cancellation
    const post = await getSocialPostById(tenantId, postId);
    if (!post) {
      const outcome = await updatePublishingJobOutcome(job_id, {
        status: 'failed',
        error_message: 'Post was deleted or not found.',
        error_code: 'POST_NOT_FOUND',
      });
      return NextResponse.json({ success: false, reason: 'POST_NOT_FOUND', job: outcome });
    }

    if (post.status === 'cancelled') {
      const outcome = await updatePublishingJobOutcome(job_id, {
        status: 'cancelled',
        error_message: post.cancellation_reason || 'Post was cancelled by owner.',
        error_code: 'POST_CANCELLED',
      });
      return NextResponse.json({ success: false, reason: 'POST_CANCELLED', job: outcome });
    }

    // 4. Validate Review vs Autopilot mode
    if (brandSettings.automation_mode === 'review_required') {
      if (!post.is_approved) {
        const outcome = await updatePublishingJobOutcome(job_id, {
          status: 'failed',
          error_message: 'Review mode active: Post is not approved by business owner.',
          error_code: 'APPROVAL_REQUIRED',
        });
        return NextResponse.json({ success: false, reason: 'APPROVAL_REQUIRED', job: outcome });
      }

      // Check snapshot hash integrity
      const currentHash = computeSocialApprovalSnapshotHash({
        caption: post.caption,
        hashtags: post.hashtags,
        target_platforms: post.target_platforms,
        media_urls: post.media_urls,
      });

      if (currentHash !== post.approval_snapshot_hash) {
        const outcome = await updatePublishingJobOutcome(job_id, {
          status: 'failed',
          error_message: 'Post was materially edited after approval; re-approval required.',
          error_code: 'APPROVAL_INVALIDATED',
        });
        return NextResponse.json({ success: false, reason: 'APPROVAL_INVALIDATED', job: outcome });
      }
    }

    // 5. Load connection & credentials
    const conn = await getSocialConnection(tenantId, platform, true);
    const dest = conn?.selected_destinations?.find((d) => d.id === job.destination_id) || {
      id: job.destination_id,
      name: job.destination_name || `${platform} destination`,
      platform,
    };

    // Server-enforced per-workspace test/live settings, owner permissions & environment gate
    const { getEffectivePublishingMode, getSocialConnections } = await import('@/lib/social-db');
    const connections = await getSocialConnections(tenantId);
    const modeInfo = getEffectivePublishingMode(brandSettings.publishing_mode, connections);

    const isSimulatedExecution = modeInfo.effective_mode !== 'live' || Boolean(job.is_simulated) || conn?.status !== 'connected';
    const adapter = getSocialAdapter(platform);

    const publishResult = await adapter.publishPost(
      post,
      dest,
      conn?.access_token || 'mock_token',
      { is_simulated: isSimulatedExecution }
    );

    const finalStatus = publishResult.success
      ? (publishResult.is_simulated ? 'simulated' : 'published')
      : 'failed';

    const updatedJob = await updatePublishingJobOutcome(job_id, {
      status: finalStatus,
      provider_post_id: publishResult.provider_post_id,
      provider_post_url: publishResult.provider_post_url,
      error_message: publishResult.error_message,
      error_code: publishResult.error_code,
      raw_response: publishResult.raw_response,
    });

    return NextResponse.json({
      success: publishResult.success,
      status: finalStatus,
      is_simulated: publishResult.is_simulated,
      provider_post_id: publishResult.provider_post_id,
      provider_post_url: publishResult.provider_post_url,
      job: updatedJob,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Dispatch failed' }, { status: 500 });
  }
}

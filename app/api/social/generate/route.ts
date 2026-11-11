import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { createSocialGenerationJob } from '@/lib/social-db';
import { runSocialGenerationPipeline } from '@/lib/social-generator';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const body = await request.json().catch(() => ({}));
    const requestedTenant = typeof body.tenant_id === 'string' ? body.tenant_id.trim() : undefined;

    const authCheck = await requireWorkspaceAccess(session, requestedTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden: Workspace access denied.' }, { status: 403 });
    }

    const tenantId = authCheck.tenantId;
    const job = await createSocialGenerationJob(
      tenantId,
      {
        theme: body.theme,
        custom_instruction: body.custom_instruction,
        target_platforms: body.target_platforms,
        save_as_post: Boolean(body.save_as_post),
        scheduled_at: body.scheduled_at,
      },
      undefined,
      session.user_id || 'owner'
    );

    const completedJob = await runSocialGenerationPipeline(job.id);

    return NextResponse.json({
      success: true,
      job_id: completedJob.id,
      generated: {
        topic_theme: completedJob.selected_concept?.topic,
        campaign_name: completedJob.selected_concept?.angle_title,
        content_angle: completedJob.selected_concept?.content_angle,
        catalog_item_name: completedJob.selected_concept?.catalog_item_name,
        caption: completedJob.generated_draft?.caption,
        hashtags: completedJob.generated_draft?.hashtags,
        video_script: completedJob.generated_draft?.video_script,
        image_prompt: completedJob.generated_draft?.image_prompt,
        alt_text: completedJob.generated_draft?.alt_text,
        media_urls: completedJob.media_result?.storage_url ? [completedJob.media_result.storage_url] : [],
        generation_source: completedJob.generated_draft?.generation_source,
        generator_model: completedJob.generated_draft?.generator_model,
        media_result: completedJob.media_result,
      },
      post_id: completedJob.post_id,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate social content' }, { status: 500 });
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import {
  createSocialGenerationJob,
  findActiveSocialGenerationJobByIdempotency,
} from '@/lib/social-db';
import { runSocialGenerationPipeline } from '@/lib/social-generator';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const body = await request.json().catch(() => ({}));
    const requestedTenant = typeof body.tenant_id === 'string' ? body.tenant_id.trim() : undefined;

    const authCheck = await requireWorkspaceAccess(session, requestedTenant);
    if (!authCheck.authorized) {
      return NextResponse.json(
        { error: authCheck.error || 'Forbidden: Workspace access denied.' },
        { status: 403 }
      );
    }

    const tenantId = authCheck.tenantId;
    const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : undefined;

    // 1. Double-click protection: return existing in-progress job if idempotency key matches
    if (idempotencyKey) {
      const activeJob = await findActiveSocialGenerationJobByIdempotency(tenantId, idempotencyKey);
      if (activeJob) {
        return NextResponse.json({
          success: true,
          job_id: activeJob.id,
          status: activeJob.status,
          stage_label: activeJob.stage_label,
          stage_progress: activeJob.stage_progress,
          is_existing: true,
        });
      }
    }

    // 2. Persist new generation job
    const options = {
      theme: body.theme,
      custom_instruction: body.custom_instruction,
      target_platforms: body.target_platforms,
      language: body.language,
      save_as_post: Boolean(body.save_as_post),
      scheduled_at: body.scheduled_at,
    };

    const job = await createSocialGenerationJob(
      tenantId,
      options,
      idempotencyKey,
      session.user_id || 'owner'
    );

    // 3. Trigger n8n Webhook asynchronously
    const n8nBaseUrl = process.env.N8N_BASE_URL || 'http://localhost:5678';
    const cronSecret = process.env.CRON_SECRET || 'dev-secret';

    (async () => {
      let triggeredN8n = false;
      try {
        const webhookUrl = `${n8nBaseUrl}/webhook/social-generate-post`;
        const n8nRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-n8n-operator-key': cronSecret,
          },
          body: JSON.stringify({
            job_id: job.id,
            tenant_id: tenantId,
            timestamp: new Date().toISOString(),
          }),
        });

        if (n8nRes.ok) {
          triggeredN8n = true;
        }
      } catch (webhookErr) {
        // Fall back to direct background pipeline execution if n8n webhook is unreachable
        console.warn('[Social Jobs] n8n webhook notification skipped, executing pipeline directly:', webhookErr);
      }

      // If n8n webhook did not process it directly, execute server-side pipeline to ensure job completes
      if (!triggeredN8n) {
        try {
          await runSocialGenerationPipeline(job.id);
        } catch (pipelineErr) {
          console.error('[Social Jobs] Pipeline execution error:', pipelineErr);
        }
      }
    })();

    // 4. Return job ID promptly to dashboard
    return NextResponse.json({
      success: true,
      job_id: job.id,
      status: job.status,
      stage_label: job.stage_label,
      stage_progress: job.stage_progress,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to initialize generation job' },
      { status: 500 }
    );
  }
}

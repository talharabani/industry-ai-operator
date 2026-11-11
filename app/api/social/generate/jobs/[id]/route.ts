import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getSocialGenerationJob, updateSocialGenerationJob } from '@/lib/social-db';
import { runSocialGenerationPipeline } from '@/lib/social-generator';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getAuthSession();

    const job = await getSocialGenerationJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Generation job not found' }, { status: 404 });
    }

    const authCheck = await requireWorkspaceAccess(session, job.tenant_id);
    if (!authCheck.authorized) {
      return NextResponse.json(
        { error: authCheck.error || 'Forbidden: Workspace access denied.' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch generation job status' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getAuthSession();

    const job = await getSocialGenerationJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Generation job not found' }, { status: 404 });
    }

    const authCheck = await requireWorkspaceAccess(session, job.tenant_id);
    if (!authCheck.authorized) {
      return NextResponse.json(
        { error: authCheck.error || 'Forbidden: Workspace access denied.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    if (body.action === 'retry') {
      // Reset job to queued state without creating a new job row or duplicate posts
      await updateSocialGenerationJob(id, {
        status: 'queued',
        stage_label: 'Retrying generation pipeline',
        stage_progress: 5,
        error_message: null,
      });

      // Run pipeline asynchronously
      (async () => {
        try {
          await runSocialGenerationPipeline(id);
        } catch (retryErr) {
          console.error('[Social Jobs Retry] Pipeline error:', retryErr);
        }
      })();

      return NextResponse.json({
        success: true,
        message: 'Generation job retrying',
        job_id: id,
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to process job action' },
      { status: 500 }
    );
  }
}

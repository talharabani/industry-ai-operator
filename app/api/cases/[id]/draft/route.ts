import { NextRequest, NextResponse } from 'next/server';
import { generateCaseDraft, N8nApiError } from '@/lib/n8n';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: caseId } = await context.params;

    if (!caseId) {
      return NextResponse.json({ error: 'Case ID is required.' }, { status: 400 });
    }

    const result = await generateCaseDraft(caseId);
    return NextResponse.json(result, { status: result.http_status || 200 });
  } catch (error: unknown) {
    if (error instanceof N8nApiError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.data,
        },
        { status: error.status }
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to generate draft';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

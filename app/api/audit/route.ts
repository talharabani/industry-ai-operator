import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { listAudit } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const searchParams = request.nextUrl.searchParams;
    const caseId = searchParams.get('case_id') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const audit = await listAudit(tenantId, { caseId, limit });
    return NextResponse.json({ audit }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve audit log';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { listDailySummarySnapshots } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '30', 10);

    const snapshots = await listDailySummarySnapshots(tenantId, limit);

    return NextResponse.json(
      {
        snapshots,
        tenant_id: tenantId,
        count: snapshots.length,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve reports';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

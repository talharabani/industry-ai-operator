import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getSummaryStatsFromDB } from '@/lib/db';
import { getSummaryFromN8n } from '@/lib/n8n';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    // 1. Try fetching live stats from PostgreSQL first
    const dbStats = await getSummaryStatsFromDB(tenantId);
    if (dbStats) {
      return NextResponse.json(dbStats, {
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      });
    }

    // 2. Try fetching from n8n webhook if DB query returned null / offline
    try {
      const n8nStats = await getSummaryFromN8n();
      return NextResponse.json(
        { ...n8nStats, is_live_db: false },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    } catch {
      // Return empty fallback stats if both are currently offline
      return NextResponse.json(
        {
          mode: 'demo',
          tenant_id: tenantId,
          period_hours: 24,
          completed_last_24h: 0,
          cases_created_last_24h: 0,
          pending_approvals_all_time: 0,
          open_cases: [],
          is_live_db: false,
          warning: 'Live data source is currently unreachable.',
        },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve summary';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

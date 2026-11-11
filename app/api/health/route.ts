import { NextResponse } from 'next/server';
import { getServerConfig } from '@/lib/config';
import { checkDatabaseHealth } from '@/lib/db';
import { checkN8nHealth } from '@/lib/n8n';
import { HealthStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = getServerConfig();
    const [dbHealth, n8nHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkN8nHealth(),
    ]);

    const status: HealthStatus = {
      database: dbHealth,
      n8n: n8nHealth,
      tenant_id: config.tenantId,
      approver_id: config.approverId,
      mode: 'demo',
    };

    return NextResponse.json(status, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Health check failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

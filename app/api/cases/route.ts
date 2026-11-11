import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { listCases } from '@/lib/db';
import {
  createOrderCase,
  createStockCase,
  createDeliveryCase,
  createReturnCase,
  N8nApiError,
} from '@/lib/n8n';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const searchParams = request.nextUrl.searchParams;

    const kind = searchParams.get('kind') || undefined;
    const status = searchParams.get('status') || undefined;
    const search = searchParams.get('search') || undefined;
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const { cases, total } = await listCases(tenantId, {
      kind,
      status,
      search,
      limit,
      offset,
    });

    return NextResponse.json(
      {
        cases,
        total,
        limit,
        offset,
        tenant_id: tenantId,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch cases';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { kind, order_id, message, request_id } = body;

    if (!kind || typeof kind !== 'string') {
      return NextResponse.json({ error: 'Field "kind" is required.' }, { status: 400 });
    }

    if (!order_id || typeof order_id !== 'string') {
      return NextResponse.json({ error: 'Field "order_id" is required.' }, { status: 400 });
    }

    // Reuse provided request_id if retrying, otherwise generate a secure UUID
    const finalRequestId =
      typeof request_id === 'string' && request_id.trim()
        ? request_id.trim()
        : crypto.randomUUID();

    let result;
    switch (kind) {
      case 'order':
        result = await createOrderCase(finalRequestId, order_id);
        break;
      case 'stock':
        result = await createStockCase(finalRequestId, order_id);
        break;
      case 'delivery':
        result = await createDeliveryCase(finalRequestId, order_id);
        break;
      case 'return':
        if (!message || typeof message !== 'string' || !message.trim()) {
          return NextResponse.json(
            { error: 'Return proposals require a customer message description.' },
            { status: 400 }
          );
        }
        result = await createReturnCase(finalRequestId, order_id, message.trim());
        break;
      default:
        return NextResponse.json(
          { error: `Unsupported case kind: "${kind}". Must be order, return, stock, or delivery.` },
          { status: 400 }
        );
    }

    const statusCode = result.http_status || (result.duplicate ? 200 : 201);
    return NextResponse.json(result, { status: statusCode });
  } catch (error: unknown) {
    if (error instanceof N8nApiError) {
      return NextResponse.json(
        { error: error.message, details: error.data },
        { status: error.status }
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to create case';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

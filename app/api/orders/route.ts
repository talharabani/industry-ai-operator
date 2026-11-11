import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { listOrders, upsertOrder, deleteOrder, getOrder } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;
    const orders = await listOrders(tenantId);

    // If orders table is empty for this tenant, provide standard demo order examples
    if (!orders || orders.length === 0) {
      return NextResponse.json({
        orders: [
          {
            tenant_id: tenantId,
            order_id: 'ORD-1001',
            customer_name: 'Alice Smith',
            customer_email: 'alice@example.com',
            total: 149.99,
            currency: 'USD',
            status: 'delivered',
            data: {
              customer: { name: 'Alice Smith', email: 'alice@example.com' },
              items: [{ sku: 'JKT-001', name: 'Winter Parka Jacket', qty: 1, price: 149.99 }],
              total_amount: 149.99,
              currency: 'USD',
              status: 'delivered',
              delivery_status: 'delivered',
              is_demo: true,
            },
          },
          {
            tenant_id: tenantId,
            order_id: 'ORD-1002',
            customer_name: 'Bob Johnson',
            customer_email: 'bob@example.com',
            total: 179.0,
            currency: 'USD',
            status: 'processing',
            data: {
              customer: { name: 'Bob Johnson', email: 'bob@example.com' },
              items: [{ sku: 'SHO-004', name: 'Leather Boots', qty: 2, price: 89.5 }],
              total_amount: 179.0,
              currency: 'USD',
              status: 'processing',
              delivery_status: 'processing',
              is_demo: true,
            },
          },
        ],
        is_fallback: true,
      });
    }

    return NextResponse.json({
      orders,
      is_fallback: false,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve orders';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    if (session.role === 'member') {
      return NextResponse.json(
        { error: 'Forbidden: Only owners and admins can manage demo orders.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    let rawOrderId = (body.order_id || body.order_number || '').toString().trim();
    if (!rawOrderId) {
      return NextResponse.json({ error: 'Order Number is required (e.g. ORD-2001).' }, { status: 400 });
    }
    const order_id = rawOrderId.toUpperCase().startsWith('ORD-') ? rawOrderId.toUpperCase() : `ORD-${rawOrderId.toUpperCase()}`;

    const customer_email = (body.customer_email || body.email || '').trim().toLowerCase();
    if (!customer_email || !customer_email.includes('@')) {
      return NextResponse.json({ error: 'A valid customer email is required.' }, { status: 400 });
    }

    const customer_name = (body.customer_name || body.name || customer_email.split('@')[0] || 'Customer').trim();
    const status = (body.status || body.delivery_status || 'processing').toLowerCase();
    const currency = (body.currency || 'PKR').toUpperCase();
    const total = Number(body.total || body.total_amount || 0);

    let items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0 && (body.product_name || body.item_name)) {
      items = [
        {
          sku: body.sku || `SKU-${Math.floor(Math.random() * 1000)}`,
          name: body.product_name || body.item_name,
          variant: body.variant || body.size || undefined,
          qty: Number(body.quantity || body.qty || 1),
          price: total,
          currency,
        },
      ];
    }

    const orderData = {
      customer: {
        name: customer_name,
        email: customer_email,
        phone: body.customer_phone || null,
        address: body.customer_address || 'Demo Delivery Address',
      },
      items,
      total_amount: total,
      currency,
      status,
      delivery_status: status,
      tracking_number: body.tracking_number || body.data?.tracking_number || `TRK-${Math.floor(Math.random() * 1000000)}`,
      carrier: body.carrier || body.data?.carrier || 'Standard Courier',
      estimated_delivery: body.estimated_delivery || body.data?.estimated_delivery || '2-4 business days',
      is_demo: true,
      demo_badge: 'Demo Order',
      created_at: new Date().toISOString(),
    };

    const saved = await upsertOrder(tenantId, {
      order_id,
      customer_name,
      customer_email,
      items,
      total,
      currency,
      status,
      data: orderData,
    });

    if (!saved) {
      return NextResponse.json({ error: 'Failed to save demo order to database.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      order: saved,
      message: `Demo order ${order_id} saved successfully.`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save order';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    if (session.role === 'member') {
      return NextResponse.json(
        { error: 'Forbidden: Only owners and admins can delete demo orders.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('id');

    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required.' }, { status: 400 });
    }

    const deleted = await deleteOrder(tenantId, orderId);
    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete demo order.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Demo order ${orderId} removed successfully.`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete order';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

function checkAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || apiKeyHeader.trim();
  return token === 'demo-custom-key-123';
}

const DEMO_ORDERS = [
  {
    id: 'ord_apex_1001',
    order_number: '#1001',
    created_at: '2026-10-01T15:30:00Z',
    updated_at: '2026-10-12T08:00:00Z',
    financial_status: 'paid',
    fulfillment_status: 'fulfilled',
    currency: 'USD',
    total_amount: '145.00',
    total_refunded: '0.00',
    refundable_balance: '145.00',
    customer: {
      email: 'sarah.jenkins.apex@example.com',
      first_name: 'Sarah',
      last_name: 'Jenkins',
      phone: '+1-555-0192',
    },
    shipping_address: {
      name: 'Sarah Jenkins',
      address1: '742 Evergreen Terrace',
      city: 'Springfield',
      state: 'OR',
      postal_code: '97477',
      country: 'US',
    },
    line_items: [
      {
        id: 'item_101',
        product_id: 'prod_apex_01',
        variant_id: 'var_apex_01_m10',
        title: 'Apex Trail Runner Pro',
        sku: 'APX-TRP-M10-BLU',
        quantity: 1,
        price: '145.00',
        currency: 'USD',
      },
    ],
    fulfillments: [
      {
        id: 'ful_apex_101',
        status: 'delivered',
        tracking_company: 'UPS',
        tracking_number: '1Z9999999999999999',
        tracking_url: 'https://www.ups.com/track?loc=en_US&tracknum=1Z9999999999999999',
        created_at: '2026-10-02T10:00:00Z',
        updated_at: '2026-10-05T14:20:00Z',
      },
    ],
  },
  {
    id: 'ord_apex_1002',
    order_number: '#1002',
    created_at: '2026-10-05T11:00:00Z',
    updated_at: '2026-10-11T16:00:00Z',
    financial_status: 'paid',
    fulfillment_status: 'unfulfilled',
    currency: 'USD',
    total_amount: '208.00',
    total_refunded: '0.00',
    refundable_balance: '208.00',
    customer: {
      email: 'michael.scott.apex@example.com',
      first_name: 'Michael',
      last_name: 'Scott',
      phone: '+1-555-0144',
    },
    shipping_address: {
      name: 'Michael Scott',
      address1: '1725 Slough Avenue',
      city: 'Scranton',
      state: 'PA',
      postal_code: '18503',
      country: 'US',
    },
    line_items: [
      {
        id: 'item_102_a',
        product_id: 'prod_apex_02',
        variant_id: 'var_apex_02_w8',
        title: 'Apex CloudStrike Road Shoe',
        sku: 'APX-CSR-W8-RED',
        quantity: 1,
        price: '180.00',
        currency: 'USD',
      },
      {
        id: 'item_102_b',
        product_id: 'prod_apex_03',
        variant_id: 'var_apex_03_l',
        title: 'Apex All-Weather Merino Running Socks',
        sku: 'APX-SOC-L-CHA',
        quantity: 1,
        price: '28.00',
        currency: 'USD',
      },
    ],
    fulfillments: [],
  },
];

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing API key.' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '50', 10)));
  const since = searchParams.get('since');

  let filtered = DEMO_ORDERS;
  if (since) {
    const sinceTime = new Date(since).getTime();
    if (!isNaN(sinceTime)) {
      filtered = filtered.filter((o) => new Date(o.updated_at).getTime() >= sinceTime);
    }
  }

  const totalCount = filtered.length;
  const startIndex = (page - 1) * limit;
  const paginated = filtered.slice(startIndex, startIndex + limit);
  const hasNextPage = startIndex + limit < totalCount;

  return NextResponse.json({
    orders: paginated,
    pagination: {
      page,
      limit,
      total_count: totalCount,
      has_next_page: hasNextPage,
      next_page: hasNextPage ? page + 1 : null,
    },
  });
}

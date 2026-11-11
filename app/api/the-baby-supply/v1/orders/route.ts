import { NextRequest, NextResponse } from 'next/server';

function checkAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || apiKeyHeader.trim();
  return token === 'tbs-live-key-baby2026' || token === 'demo-custom-key-123';
}

const TBS_ORDERS = [
  {
    id: 'ord_tbs_1001',
    order_number: '#TBS-1001',
    created_at: '2026-10-10T11:20:00Z',
    updated_at: '2026-10-12T14:30:00Z',
    financial_status: 'paid',
    fulfillment_status: 'fulfilled',
    currency: 'EUR',
    total_amount: '119.99',
    total_refunded: '0.00',
    refundable_balance: '119.99',
    customer: {
      email: 'eline.deboer@example.nl',
      first_name: 'Eline',
      last_name: 'de Boer',
      phone: '+31-612345678',
    },
    shipping_address: {
      name: 'Eline de Boer',
      address1: 'Coolsingel 42',
      city: 'Rotterdam',
      state: 'Zuid-Holland',
      postal_code: '3011 AA',
      country: 'NL',
    },
    line_items: [
      {
        id: 'item_tbs_101',
        product_id: 'prod_tbs_02',
        variant_id: 'var_tbs_02_std',
        title: 'Philips Avent Babyfoon DECT SCD713/26',
        sku: 'TBS-AVENT-SCD713',
        quantity: 1,
        price: '119.99',
        currency: 'EUR',
      },
    ],
    fulfillments: [
      {
        id: 'ful_tbs_101',
        status: 'delivered',
        tracking_company: 'PostNL',
        tracking_number: '3STEST987654321',
        tracking_url: 'https://jouw.postnl.nl/track-and-trace/3STEST987654321-NL-3011AA',
        created_at: '2026-10-10T16:00:00Z',
        updated_at: '2026-10-11T13:45:00Z',
      },
    ],
  },
  {
    id: 'ord_tbs_1002',
    order_number: '#TBS-1002',
    created_at: '2026-10-11T09:15:00Z',
    updated_at: '2026-10-12T10:00:00Z',
    financial_status: 'paid',
    fulfillment_status: 'fulfilled',
    currency: 'EUR',
    total_amount: '39.90',
    total_refunded: '0.00',
    refundable_balance: '39.90',
    customer: {
      email: 'lars.van.dijk@example.nl',
      first_name: 'Lars',
      last_name: 'van Dijk',
      phone: '+31-687654321',
    },
    shipping_address: {
      name: 'Lars van Dijk',
      address1: 'Oudegracht 156',
      city: 'Utrecht',
      state: 'Utrecht',
      postal_code: '3511 AL',
      country: 'NL',
    },
    line_items: [
      {
        id: 'item_tbs_102_a',
        product_id: 'prod_tbs_01',
        variant_id: 'var_tbs_01_std',
        title: 'Brievenbuspakket Hello Baby',
        sku: 'TBS-CADEAU-HB01',
        quantity: 1,
        price: '24.95',
        currency: 'EUR',
      },
      {
        id: 'item_tbs_102_b',
        product_id: 'prod_tbs_07',
        variant_id: 'var_tbs_07_mnt',
        title: 'Matchstick Monkey Siliconen Bijtring Aapje',
        sku: 'TBS-MM-TEETH-MNT',
        quantity: 1,
        price: '14.95',
        currency: 'EUR',
      },
    ],
    fulfillments: [
      {
        id: 'ful_tbs_102',
        status: 'in_transit',
        tracking_company: 'PostNL',
        tracking_number: '3STEST112233445',
        tracking_url: 'https://jouw.postnl.nl/track-and-trace/3STEST112233445-NL-3511AL',
        created_at: '2026-10-11T16:30:00Z',
        updated_at: '2026-10-12T08:15:00Z',
      },
    ],
  },
  {
    id: 'ord_tbs_1003',
    order_number: '#TBS-1003',
    created_at: '2026-10-13T08:45:00Z',
    updated_at: '2026-10-13T08:45:00Z',
    financial_status: 'paid',
    fulfillment_status: 'unfulfilled',
    currency: 'EUR',
    total_amount: '29.95',
    total_refunded: '0.00',
    refundable_balance: '29.95',
    customer: {
      email: 'sophie.bakker@example.nl',
      first_name: 'Sophie',
      last_name: 'Bakker',
      phone: '+31-645678901',
    },
    shipping_address: {
      name: 'Sophie Bakker',
      address1: 'Keizersgracht 384',
      city: 'Amsterdam',
      state: 'Noord-Holland',
      postal_code: '1016 GB',
      country: 'NL',
    },
    line_items: [
      {
        id: 'item_tbs_103',
        product_id: 'prod_tbs_05',
        variant_id: 'var_tbs_05_12p',
        title: 'Montessori Houten Regenboog Speelgoed',
        sku: 'TBS-MONT-RAINBOW',
        quantity: 1,
        price: '29.95',
        currency: 'EUR',
      },
    ],
    fulfillments: [],
  },
];

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing API key. Expected "tbs-live-key-baby2026".' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const pageItems = TBS_ORDERS.slice(startIndex, endIndex);

  const response = NextResponse.json({
    orders: pageItems.map((o) => ({
      ...o,
      is_demo_fixture: true,
      data_source: 'local_demo_fixture',
      fixture_notice: 'Synthesized demo fixture order. 3STEST tracking codes and example.nl emails are non-live test mocks.',
    })),
    pagination: {
      page,
      limit,
      total_count: TBS_ORDERS.length,
      has_next_page: endIndex < TBS_ORDERS.length,
      next_page: endIndex < TBS_ORDERS.length ? page + 1 : null,
    },
    is_demo_fixture: true,
    environment: 'demo_simulation',
    fixture_notice: 'Local simulation demo fixture orders with mock example.nl customers and test tracking for development and offline testing.',
  });

  response.headers.set('X-Demo-Fixture', 'true');
  response.headers.set('X-Data-Source', 'local-simulation-fixture');
  return response;
}

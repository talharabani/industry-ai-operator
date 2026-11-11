import { NextRequest, NextResponse } from 'next/server';

function checkAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || apiKeyHeader.trim();
  return token === 'demo-custom-key-123';
}

const DEMO_PRODUCTS = [
  {
    id: 'prod_apex_01',
    title: 'Apex Trail Runner Pro',
    handle: 'apex-trail-runner-pro',
    description: 'Rugged all-terrain trail running shoes with responsive cushioning.',
    product_type: 'Footwear',
    vendor: 'Apex Footwear',
    status: 'active',
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-10-10T15:30:00Z',
    variants: [
      {
        id: 'var_apex_01_m10',
        title: 'Men Size 10 / Slate Blue',
        sku: 'APX-TRP-M10-BLU',
        price: '145.00',
        compare_at_price: '165.00',
        currency: 'USD',
        inventory_quantity: 35,
        available: true,
      },
      {
        id: 'var_apex_01_m11',
        title: 'Men Size 11 / Slate Blue',
        sku: 'APX-TRP-M11-BLU',
        price: '145.00',
        compare_at_price: '165.00',
        currency: 'USD',
        inventory_quantity: 12,
        available: true,
      },
    ],
    options: [
      { name: 'Size', values: ['Men 10', 'Men 11'] },
      { name: 'Color', values: ['Slate Blue'] },
    ],
  },
  {
    id: 'prod_apex_02',
    title: 'Apex CloudStrike Road Shoe',
    handle: 'apex-cloudstrike-road-shoe',
    description: 'Ultralight marathon running shoes with carbon-composite plate.',
    product_type: 'Footwear',
    vendor: 'Apex Footwear',
    status: 'active',
    created_at: '2026-09-15T09:00:00Z',
    updated_at: '2026-10-11T11:00:00Z',
    variants: [
      {
        id: 'var_apex_02_w8',
        title: 'Women Size 8 / Coral Red',
        sku: 'APX-CSR-W8-RED',
        price: '180.00',
        compare_at_price: '210.00',
        currency: 'USD',
        inventory_quantity: 18,
        available: true,
      },
    ],
    options: [
      { name: 'Size', values: ['Women 8'] },
      { name: 'Color', values: ['Coral Red'] },
    ],
  },
  {
    id: 'prod_apex_03',
    title: 'Apex All-Weather Merino Running Socks',
    handle: 'apex-merino-running-socks',
    description: 'Anti-blister Merino wool blend performance socks.',
    product_type: 'Accessories',
    vendor: 'Apex Footwear',
    status: 'active',
    created_at: '2026-09-20T14:00:00Z',
    updated_at: '2026-10-12T08:00:00Z',
    variants: [
      {
        id: 'var_apex_03_l',
        title: 'Large (3-Pack) / Charcoal',
        sku: 'APX-SOC-L-CHA',
        price: '28.00',
        compare_at_price: null,
        currency: 'USD',
        inventory_quantity: 150,
        available: true,
      },
    ],
    options: [
      { name: 'Size', values: ['Large'] },
      { name: 'Pack', values: ['3-Pack'] },
    ],
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

  let filtered = DEMO_PRODUCTS;
  if (since) {
    const sinceTime = new Date(since).getTime();
    if (!isNaN(sinceTime)) {
      filtered = filtered.filter((p) => new Date(p.updated_at).getTime() >= sinceTime);
    }
  }

  const totalCount = filtered.length;
  const startIndex = (page - 1) * limit;
  const paginated = filtered.slice(startIndex, startIndex + limit);
  const hasNextPage = startIndex + limit < totalCount;

  return NextResponse.json({
    products: paginated,
    pagination: {
      page,
      limit,
      total_count: totalCount,
      has_next_page: hasNextPage,
      next_page: hasNextPage ? page + 1 : null,
    },
  });
}

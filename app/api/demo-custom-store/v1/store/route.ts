import { NextRequest, NextResponse } from 'next/server';

function checkAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || apiKeyHeader.trim();
  // Valid demo token is demo-custom-key-123
  return token === 'demo-custom-key-123';
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing API key. Expected "demo-custom-key-123".' },
      { status: 401 }
    );
  }

  return NextResponse.json({
    store_id: 'apex_store_demo',
    name: 'Apex Custom Footwear',
    website_url: 'https://apexfootwear.example.com',
    currency: 'USD',
    timezone: 'America/New_York',
    country: 'US',
    policies: {
      return_policy: '30 days return window for unworn items with original tags attached. Customer pays return shipping unless item is defective.',
      shipping_policy: 'Orders ship within 1-2 business days via UPS. Free standard shipping on orders over $100.',
    },
    contact_email: 'support@apexfootwear.example.com',
    updated_at: '2026-10-12T10:00:00Z',
  });
}

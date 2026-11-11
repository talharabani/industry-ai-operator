import { NextRequest, NextResponse } from 'next/server';

function checkAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || apiKeyHeader.trim();
  // Valid token for The Baby Supply endpoint
  return token === 'tbs-live-key-baby2026' || token === 'demo-custom-key-123';
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing API key. Expected "tbs-live-key-baby2026".' },
      { status: 401 }
    );
  }

  const response = NextResponse.json({
    store_id: 'the_baby_supply_nl',
    name: 'The Baby Supply (Demo Fixture)',
    website_url: 'https://thebabysupply.nl',
    currency: 'EUR',
    timezone: 'Europe/Amsterdam',
    country: 'NL',
    is_demo_fixture: true,
    environment: 'demo_simulation',
    fixture_notice: 'Local simulation demo fixture for development, automated testing, and offline sandboxes. These are synthesized fixtures, not authentic live store records.',
    policies: {
      return_policy: 'Klanten van The Baby Supply hebben het recht om binnen 14 dagen na ontvangst van de producten de bestelling te retourneren, mits de producten ongebruikt en in originele staat zijn. Neem contact op via info@thebabysupply.nl. Retourkosten zijn voor rekening van de klant tenzij er sprake is van een defect of fout. Uitgezonderd zijn hygiënische, gepersonaliseerde en op maat gemaakte producten.',
      shipping_policy: 'Gratis verzending in Nederland en België. Voor 16:00 uur besteld, volgende dag in huis via PostNL en DHL. Brievenbuspakketjes worden direct bezorgd.',
    },
    contact_email: 'info@thebabysupply.nl',
    updated_at: '2026-10-13T10:00:00Z',
  });

  response.headers.set('X-Demo-Fixture', 'true');
  response.headers.set('X-Data-Source', 'local-simulation-fixture');
  return response;
}

import { NextRequest, NextResponse } from 'next/server';

function checkAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || apiKeyHeader.trim();
  return token === 'tbs-live-key-baby2026' || token === 'demo-custom-key-123';
}

const TBS_PRODUCTS = [
  {
    id: 'prod_tbs_01',
    title: 'Brievenbuspakket Hello Baby',
    handle: 'brievenbuspakket-hello-baby',
    description: 'Liefdevol samengesteld kraamcadeau brievenbuspakket met zachte sokjes, houten bijtring en felicitatiekaart.',
    product_type: 'Kraamcadeaus',
    vendor: 'The Baby Supply',
    status: 'active',
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-10-12T14:00:00Z',
    variants: [
      {
        id: 'var_tbs_01_std',
        title: 'Standaard / Neutraal',
        sku: 'TBS-CADEAU-HB01',
        price: '24.95',
        compare_at_price: '29.95',
        currency: 'EUR',
        inventory_quantity: 42,
        available: true,
      },
    ],
    options: [{ name: 'Kleur', values: ['Neutraal'] }],
  },
  {
    id: 'prod_tbs_02',
    title: 'Philips Avent Babyfoon DECT SCD713/26',
    handle: 'philips-avent-babyfoon-scd713',
    description: '100% storingsvrije kristalheldere babyfoon met nachtlampje, slaapliedjes en temperatuursensor.',
    product_type: 'Babyfoons',
    vendor: 'Philips Avent',
    status: 'active',
    created_at: '2026-08-10T11:00:00Z',
    updated_at: '2026-10-12T15:00:00Z',
    variants: [
      {
        id: 'var_tbs_02_std',
        title: 'Wit / Zilver',
        sku: 'TBS-AVENT-SCD713',
        price: '119.99',
        compare_at_price: '139.99',
        currency: 'EUR',
        inventory_quantity: 18,
        available: true,
      },
    ],
    options: [{ name: 'Kleur', values: ['Wit / Zilver'] }],
  },
  {
    id: 'prod_tbs_03',
    title: 'Philips Avent Elektrische Borstkolf Single',
    handle: 'philips-avent-borstkolf-elektrisch',
    description: 'Natuurlijke stimulatie en comfortabel afkolven zonder voorover te hoeven leunen met zacht massagekussen.',
    product_type: 'Borstvoeding',
    vendor: 'Philips Avent',
    status: 'active',
    created_at: '2026-08-15T09:00:00Z',
    updated_at: '2026-10-12T16:00:00Z',
    variants: [
      {
        id: 'var_tbs_03_std',
        title: 'Single Elektrisch',
        sku: 'TBS-AVENT-KOLF1',
        price: '139.99',
        compare_at_price: '159.99',
        currency: 'EUR',
        inventory_quantity: 12,
        available: true,
      },
    ],
    options: [{ name: 'Type', values: ['Single Elektrisch'] }],
  },
  {
    id: 'prod_tbs_04',
    title: 'Elvie Pump Double Borstkolf Draadloos',
    handle: 'elvie-pump-double-borstkolf',
    description: 'Stille, draadloze handsfree kolf die in je bh past. Discreet afkolven met app-verbinding.',
    product_type: 'Borstvoeding',
    vendor: 'Elvie',
    status: 'active',
    created_at: '2026-08-20T12:00:00Z',
    updated_at: '2026-10-13T09:00:00Z',
    variants: [
      {
        id: 'var_tbs_04_dbl',
        title: 'Double Kit (2 Kolven)',
        sku: 'TBS-ELVIE-DOUBLE',
        price: '599.00',
        compare_at_price: '649.00',
        currency: 'EUR',
        inventory_quantity: 7,
        available: true,
      },
    ],
    options: [{ name: 'Type', values: ['Double Kit'] }],
  },
  {
    id: 'prod_tbs_05',
    title: 'Montessori Houten Regenboog Speelgoed',
    handle: 'montessori-houten-regenboog',
    description: 'Open-ended educatief speelgoed gemaakt van duurzaam FSC-gecertificeerd beukenhout en kindveilige verf.',
    product_type: 'Educatief Speelgoed',
    vendor: 'The Baby Supply',
    status: 'active',
    created_at: '2026-08-25T14:00:00Z',
    updated_at: '2026-10-12T10:00:00Z',
    variants: [
      {
        id: 'var_tbs_05_12p',
        title: 'Groot (12 Bogen) / Pastel',
        sku: 'TBS-MONT-RAINBOW',
        price: '29.95',
        compare_at_price: '34.95',
        currency: 'EUR',
        inventory_quantity: 38,
        available: true,
      },
    ],
    options: [{ name: 'Grootte', values: ['Groot (12 Bogen)'] }],
  },
  {
    id: 'prod_tbs_06',
    title: 'Sage Canyon Meisjesjurk',
    handle: 'sage-canyon-meisjesjurk',
    description: 'Prachtige gebloemde meisjesjurk van zacht ademend 100% biologisch katoen met subtiele ruches.',
    product_type: 'Babykleding',
    vendor: 'The Baby Supply',
    status: 'active',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-10-12T11:00:00Z',
    variants: [
      {
        id: 'var_tbs_06_68',
        title: 'Maat 68 / Saliegroen',
        sku: 'TBS-DRESS-SC68',
        price: '34.95',
        compare_at_price: null,
        currency: 'EUR',
        inventory_quantity: 15,
        available: true,
      },
      {
        id: 'var_tbs_06_74',
        title: 'Maat 74 / Saliegroen',
        sku: 'TBS-DRESS-SC74',
        price: '34.95',
        compare_at_price: null,
        currency: 'EUR',
        inventory_quantity: 11,
        available: true,
      },
    ],
    options: [
      { name: 'Maat', values: ['68', '74'] },
      { name: 'Kleur', values: ['Saliegroen'] },
    ],
  },
  {
    id: 'prod_tbs_07',
    title: 'Matchstick Monkey Siliconen Bijtring Aapje',
    handle: 'matchstick-monkey-bijtring',
    description: 'Ergonomische bijtring met zachte borsteltjes om tandvlees te masseren en tandjespijn te verlichten. BPA-vrij.',
    product_type: 'Babyverzorging',
    vendor: 'Matchstick Monkey',
    status: 'active',
    created_at: '2026-09-05T13:00:00Z',
    updated_at: '2026-10-12T12:00:00Z',
    variants: [
      {
        id: 'var_tbs_07_mnt',
        title: 'Mintgroen',
        sku: 'TBS-MM-TEETH-MNT',
        price: '14.95',
        compare_at_price: null,
        currency: 'EUR',
        inventory_quantity: 55,
        available: true,
      },
    ],
    options: [{ name: 'Kleur', values: ['Mintgroen'] }],
  },
  {
    id: 'prod_tbs_08',
    title: 'Hydrofiele Doeken 3-Pack Biologisch Katoen',
    handle: 'hydrofiele-doeken-3pack',
    description: 'Set van 3 extra grote zachte hydrofiele doeken (70x70 cm) met pastelprint. Ademend en absorberend.',
    product_type: 'Babyverzorging',
    vendor: 'The Baby Supply',
    status: 'active',
    created_at: '2026-09-10T14:00:00Z',
    updated_at: '2026-10-12T13:00:00Z',
    variants: [
      {
        id: 'var_tbs_08_pst',
        title: '70x70 cm / Pastel mix',
        sku: 'TBS-DOEK-3PK',
        price: '18.95',
        compare_at_price: '22.95',
        currency: 'EUR',
        inventory_quantity: 48,
        available: true,
      },
    ],
    options: [{ name: 'Formaat', values: ['70x70 cm'] }],
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
  const pageItems = TBS_PRODUCTS.slice(startIndex, endIndex);

  const response = NextResponse.json({
    products: pageItems.map((p) => ({
      ...p,
      is_demo_fixture: true,
      data_source: 'local_demo_fixture',
    })),
    pagination: {
      page,
      limit,
      total_count: TBS_PRODUCTS.length,
      has_next_page: endIndex < TBS_PRODUCTS.length,
      next_page: endIndex < TBS_PRODUCTS.length ? page + 1 : null,
    },
    is_demo_fixture: true,
    environment: 'demo_simulation',
    fixture_notice: 'Local demo catalog fixtures synthesized for integration development and testing. Not authentic live store data.',
  });

  response.headers.set('X-Demo-Fixture', 'true');
  response.headers.set('X-Data-Source', 'local-simulation-fixture');
  return response;
}

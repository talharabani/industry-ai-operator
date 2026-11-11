import pg from 'pg';
import fs from 'fs';

function loadEnvLocal() {
  if (fs.existsSync('.env.local')) {
    const lines = fs.readFileSync('.env.local', 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let val = match[2] || '';
        val = val.trim().replace(/^["'](.*)["']$/, '$1');
        process.env[match[1]] = val;
      }
    }
  }
}
loadEnvLocal();

const pool = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo' });

async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

async function restoreDemoStoreProfile() {
  console.log('================================================================');
  console.log('=== AUDITING AND RESTORING DEMO-STORE BUSINESS PROFILE ===');
  console.log('================================================================\n');

  // 1. Fetch current settings in DB to record the exact overwritten values
  const currentBiz = await query("SELECT settings FROM iao.businesses WHERE tenant_id = 'demo-store';");
  const cur = currentBiz[0]?.settings || {};

  console.log('--- Overwritten Values Audit Report ---');
  console.log('  business_name:', JSON.stringify({ overwritten: cur.business_name, restored: 'rabani' }));
  console.log('  currency:', JSON.stringify({ overwritten: cur.currency, restored: 'USD' }));
  console.log('  country:', JSON.stringify({ overwritten: cur.country, restored: 'United States' }));
  console.log('  timezone:', JSON.stringify({ overwritten: cur.timezone, restored: 'America/New_York' }));
  console.log('  support_email:', JSON.stringify({ overwritten: cur.support_email, restored: 'talhaishaqrabani9490@gmail.com' }));
  console.log('  language:', JSON.stringify({ overwritten: cur.language, restored: 'English' }));
  console.log('  email connection sender:', JSON.stringify({ overwritten: cur.connections?.email?.sender_email, restored: 'talhaishaqrabani9490@gmail.com' }));
  console.log('  website store_url:', JSON.stringify({ overwritten: cur.connections?.website?.store_url, restored: 'rabani-ysnivj04.myshopify.com' }));
  console.log('---------------------------------------\n');

  // 2. Fetch verified Shopify products from iao.shopify_products
  const shopifyProds = await query(
    `SELECT tenant_id, shopify_product_id, title, handle, product_type, vendor, status, variants, options
     FROM iao.shopify_products
     WHERE tenant_id = 'demo-store' AND status != 'archived'
     ORDER BY updated_at DESC;`
  );

  const mappedShopifyItems = [];
  for (const p of shopifyProds) {
    const variants = Array.isArray(p.variants) ? p.variants : [];
    if (variants.length > 0) {
      for (const v of variants) {
        const variantSuffix = v.title && v.title !== 'Default Title' ? ` (${v.title})` : '';
        mappedShopifyItems.push({
          id: `sp-${p.shopify_product_id}-${v.id}`,
          name: `${p.title}${variantSuffix}`,
          sku: v.sku || `SKU-${v.id}`,
          price: typeof v.price === 'string' ? parseFloat(v.price) : Number(v.price || 0),
          currency: 'USD',
          description: `${p.product_type ? `[${p.product_type}] ` : ''}${p.title}`,
          in_stock: Boolean(v.available ?? ((v.inventory_quantity || 0) > 0)),
          stock_quantity: v.inventory_quantity ?? 0,
          is_active: true,
          connection_id: 'shopify_primary',
          provider: 'shopify',
          store_name: 'rabani',
          is_demo_fixture: false,
        });
      }
    } else {
      mappedShopifyItems.push({
        id: `sp-${p.shopify_product_id}`,
        name: p.title,
        sku: `SKU-${p.shopify_product_id}`,
        price: 0,
        currency: 'USD',
        description: p.title,
        in_stock: true,
        stock_quantity: 1,
        is_active: true,
        connection_id: 'shopify_primary',
        provider: 'shopify',
        store_name: 'rabani',
        is_demo_fixture: false,
      });
    }
  }

  // 3. Fetch custom store products from iao.custom_store_products
  const customProds = await query(
    `SELECT * FROM iao.custom_store_products WHERE tenant_id = 'demo-store' AND connection_id = 'conn_custom_demo-store' ORDER BY created_at ASC;`
  );

  const mappedCustomItems = [];
  for (const cp of customProds) {
    const variants = (cp.variants || []) ;
    if (variants.length > 0) {
      for (const v of variants) {
        mappedCustomItems.push({
          id: `cs-${cp.connection_id}-${cp.external_product_id}-${v.id || 'def'}`,
          name: variants.length > 1 && v.title && v.title !== 'Default Title' ? `${cp.title} (${v.title})` : cp.title,
          sku: v.sku || `SKU-${cp.external_product_id}`,
          price: parseFloat(v.price || 0),
          currency: 'EUR',
          description: cp.title,
          in_stock: v.available !== false,
          stock_quantity: typeof v.inventory_quantity === 'number' ? v.inventory_quantity : 1,
          is_active: cp.status === 'active',
          connection_id: 'conn_custom_demo-store',
          provider: 'custom',
          store_name: 'The Baby Supply (Demo Fixture)',
          is_demo_fixture: true,
        });
      }
    }
  }

  const combinedCatalog = [...mappedShopifyItems, ...mappedCustomItems];

  // 4. Construct verified rabani Business Settings with multi-store policy scoping
  const restoredSettings = {
    business_name: 'rabani',
    industry: 'ecommerce',
    country: 'United States',
    currency: 'USD',
    timezone: 'America/New_York',
    language: 'English',
    tone: 'professional, courteous, and helpful',
    support_email: 'talhaishaqrabani9490@gmail.com',
    working_hours: {
      start_time: '09:00',
      end_time: '18:00',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      auto_reply_outside_hours: true,
    },
    automation_mode: 'auto_routine',
    permissions: {
      can_auto_reply_routine: true,
      can_draft_orders: true,
      can_draft_stock: true,
      can_draft_delivery: true,
      can_draft_returns: true,
      can_auto_execute_refunds: false,
      can_auto_execute_exchanges: false,
      return_refund: 'approval_required',
      exchange_replacement: 'approval_required',
      order_confirmation: 'approval_required',
      policy_modification: 'approval_required',
      supplier_purchase: 'approval_required',
      payment_reversal: 'approval_required',
      delay_notification: 'automatic',
    },
    approver_ids: ['owner-demo', 'admin-sarah'],
    team_members: cur.team_members || [
      {
        id: 'owner-demo',
        name: 'Store Owner (Demo)',
        email: 'talhaishaqrabani9490@gmail.com',
        role: 'owner',
        can_approve: true,
        title: 'Primary Business Owner',
        created_at: new Date('2026-09-01T00:00:00Z').toISOString(),
      },
      {
        id: 'admin-sarah',
        name: 'Sarah Jenkins',
        email: 'sarah.j@demo-store.com',
        role: 'admin',
        can_approve: true,
        title: 'Operations Manager',
        created_at: new Date('2026-09-15T00:00:00Z').toISOString(),
      },
    ],
    connections: {
      email: {
        mode: 'gmail',
        status: 'connected',
        provider: 'gmail',
        sender_email: 'talhaishaqrabani9490@gmail.com',
        sender_name: 'rabani Support Team',
        reply_to: 'talhaishaqrabani9490@gmail.com',
      },
      website: {
        type: 'shopify',
        status: 'connected',
        store_url: 'rabani-ysnivj04.myshopify.com',
        is_verified: true,
        last_tested: new Date().toISOString(),
        hosted_inquiry_enabled: true,
      },
      whatsapp: {
        status: 'not_implemented',
        provider: 'meta_cloud',
        is_verified: false,
        phone_number: '+1 555 123 4567',
      },
    },
    knowledge: {
      policies: {
        return_window_days: 14,
        general_rules: 'Items in original unworn condition with tags attached can be returned or exchanged within 14 days of confirmed delivery.',
        shipping_timeframe: 'Standard nationwide shipping takes 2-4 business days.',
        restocking_fee_pct: 0,
        operating_disclaimer: 'Supported by AI Operations Assistant. Financial actions and refunds require human owner approval.',
      },
      faqs: [
        {
          id: 'faq_rb_1',
          question: 'What is your return and exchange policy?',
          answer: 'We accept returns and exchanges on items in new, unworn condition with tags intact within 14 days of delivery. Contact us at talhaishaqrabani9490@gmail.com to initiate a return.',
        },
        {
          id: 'faq_rb_2',
          question: 'How long does shipping take and what carriers do you use?',
          answer: 'Standard shipping takes 2-4 business days. All orders include tracked carrier delivery.',
        },
        {
          id: 'faq_rb_3',
          question: 'What payment methods are supported?',
          answer: 'We accept all major credit cards, Apple Pay, Google Pay, and Shopify Payments.',
        },
      ],
      products_services: combinedCatalog,
      store_policies: {
        shopify_primary: {
          connection_id: 'shopify_primary',
          store_name: 'rabani',
          provider: 'shopify',
          currency: 'USD',
          timezone: 'America/New_York',
          return_window_days: 14,
          return_policy: 'Items in original unworn condition with tags attached can be returned or exchanged within 14 days of confirmed delivery. Contact talhaishaqrabani9490@gmail.com.',
          shipping_policy: 'Standard nationwide shipping takes 2-4 business days.',
          shipping_timeframe: 'Standard shipping takes 2-4 business days.',
          general_rules: 'Items in original unworn condition with tags attached qualify for return or exchange within 14 days.',
          support_email: 'talhaishaqrabani9490@gmail.com',
          is_demo_fixture: false,
        },
        'conn_custom_demo-store': {
          connection_id: 'conn_custom_demo-store',
          store_name: 'The Baby Supply (Demo Fixture)',
          provider: 'custom',
          currency: 'EUR',
          timezone: 'Europe/Amsterdam',
          return_window_days: 14,
          return_policy: 'Klanten van The Baby Supply hebben het recht om binnen 14 dagen na ontvangst van de producten de bestelling te retourneren, mits de producten ongebruikt en in originele staat zijn. Neem contact op via info@thebabysupply.nl. Uitgezonderd zijn hygiënische artikelen.',
          shipping_policy: 'Gratis verzending in Nederland en België! Voor 16:00 uur besteld, volgende werkdag in huis via PostNL en DHL.',
          shipping_timeframe: 'Voor 16:00 besteld, volgende werkdag in huis via PostNL / DHL.',
          general_rules: 'Binnen 14 dagen retourneren in originele ongebruikte staat. Contact via info@thebabysupply.nl.',
          support_email: 'info@thebabysupply.nl',
          is_demo_fixture: true,
        },
      },
    },
    order_issues_config: cur.order_issues_config || {
      max_followup_attempts: 2,
      auto_escalate_to_owner: true,
      followup_interval_hours: 24,
      auto_close_resolved_days: 7,
      clarification_delay_minutes: 1440,
      carrier_check_interval_minutes: 360,
      owner_reminder_interval_minutes: 1440,
    },
  };

  await query(
    `UPDATE iao.businesses
     SET settings = $1::jsonb, updated_at = NOW()
     WHERE tenant_id = 'demo-store';`,
    [JSON.stringify(restoredSettings)]
  );

  console.log('✓ Successfully restored demo-store settings to verified rabani profile (USD, America/New_York, Shopify connected).');
  console.log(`✓ Materialized combined catalog: ${mappedShopifyItems.length} Shopify items + ${mappedCustomItems.length} scoped Custom Store items.`);
  console.log('✓ Scoped store_policies: [shopify_primary (rabani), conn_custom_demo-store (The Baby Supply Demo Fixture)].\n');

  // 5. Also insert dedicated tenant `the-baby-supply` for completely isolated testing
  const tbsSettings = {
    business_name: 'The Baby Supply (Demo Fixture)',
    industry: 'ecommerce',
    country: 'Netherlands',
    currency: 'EUR',
    timezone: 'Europe/Amsterdam',
    language: 'Dutch',
    tone: 'warm, deskundig, empathisch en behulpzaam voor ouders en verzorgers',
    support_email: 'info@thebabysupply.nl',
    working_hours: {
      start_time: '09:00',
      end_time: '17:00',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      auto_reply_outside_hours: true,
    },
    automation_mode: 'auto_routine',
    permissions: restoredSettings.permissions,
    approver_ids: ['owner-demo'],
    team_members: restoredSettings.team_members,
    connections: {
      email: {
        mode: 'demo',
        status: 'demo_simulated',
        provider: 'none',
        sender_email: 'info@thebabysupply.nl',
        sender_name: 'The Baby Supply Klantenservice',
        reply_to: 'info@thebabysupply.nl',
      },
      website: {
        type: 'custom',
        status: 'connected',
        store_url: 'https://thebabysupply.nl',
        is_verified: true,
        last_tested: new Date().toISOString(),
        hosted_inquiry_enabled: true,
      },
    },
    knowledge: {
      policies: restoredSettings.knowledge.store_policies['conn_custom_demo-store'],
      faqs: cur.knowledge?.faqs || [],
      products_services: mappedCustomItems,
      store_policies: {
        'conn_custom_demo-store': restoredSettings.knowledge.store_policies['conn_custom_demo-store'],
      },
    },
  };

  await query(
    `INSERT INTO iao.businesses (tenant_id, settings, updated_at)
     VALUES ('the-baby-supply', $1::jsonb, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW();`,
    [JSON.stringify(tbsSettings)]
  );
  console.log('✓ Seeded/verified isolated tenant "the-baby-supply" for standalone Dutch baby goods tests.\n');

  await pool.end();
}

restoreDemoStoreProfile().catch((err) => {
  console.error('Failed to restore demo-store profile:', err);
  process.exit(1);
});

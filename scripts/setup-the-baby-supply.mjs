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
process.env.ALLOW_LOCAL_CONNECTOR = 'true';

import { query } from '../lib/db.ts';
import {
  saveCustomStoreConnection,
  getCustomStoreConnection,
  startCustomStoreSyncJob,
  fetchCustomStorePage,
  ingestCustomStoreBatch,
  finishCustomStoreSyncJob,
} from '../lib/custom-store-service.ts';

async function setupTheBabySupply() {
  console.log('====================================================');
  console.log('=== CONFIGURING THE BABY SUPPLY BUSINESS PROFILE ===');
  console.log('====================================================\n');

  const tenantId = 'demo-store';
  const baseUrl = 'http://localhost:3000/api/the-baby-supply/v1';
  const apiKey = 'tbs-live-key-baby2026';
  const webhookSecret = 'tbs-webhook-secret-baby99';

  // 1. Update iao.businesses settings
  const babySupplySettings = {
    business_name: 'The Baby Supply',
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
    permissions: {
      can_auto_reply_routine: true,
      can_draft_orders: true,
      can_draft_stock: true,
      can_draft_delivery: true,
      can_draft_returns: true,
      can_auto_execute_refunds: false, // Permanently requires owner approval
      can_auto_execute_exchanges: false,
    },
    knowledge: {
      policies: {
        return_policy: 'Klanten van The Baby Supply hebben het recht om binnen 14 dagen na ontvangst van de producten de bestelling te retourneren, mits de producten ongebruikt en in originele staat zijn. Neem contact op via info@thebabysupply.nl. Retourkosten zijn voor rekening van de klant, tenzij sprake van een defect of fout. Uitgezonderd zijn hygiënische, gepersonaliseerde en op maat gemaakte artikelen.',
        shipping_policy: 'Gratis verzending in Nederland en België! Voor 16:00 uur besteld, volgende dag in huis via PostNL en DHL. Brievenbuspakketjes worden direct bezorgd.',
        return_window_days: 14,
        shipping_timeframe: 'Voor 16:00 besteld, volgende werkdag in huis via PostNL / DHL.',
        general_rules: 'Binnen 14 dagen retourneren in originele ongebruikte staat. Contact via info@thebabysupply.nl.',
        operating_disclaimer: 'Ondersteund door The Baby Supply AI Operator. Financiële acties en terugbetalingen worden altijd door de winkeleigenaar beoordeeld.',
      },
      faqs: [
        {
          question: 'Wat is jullie levertijd en wat zijn de verzendkosten?',
          answer: 'Bij The Baby Supply profiteer je van gratis verzending binnen Nederland en België! Bestellingen geplaatst voor 16:00 uur worden dezelfde werkdag verzonden en heb je de volgende dag al in huis via PostNL of DHL.',
        },
        {
          question: 'Hoe kan ik een product retourneren of ruilen?',
          answer: 'Je kunt artikelen binnen 14 dagen na ontvangst retourneren, mits ze ongebruikt en in originele staat zijn. Stuur een e-mail naar info@thebabysupply.nl om je retour aan te melden. Wij sturen je direct de instructies toe.',
        },
        {
          question: 'Welke betaalmethoden accepteren jullie?',
          answer: 'Wij accepteren veilige betalingen via iDeal, Klarna (achteraf betalen), Creditcard (Mastercard & Visa), Apple Pay en Bancontact.',
        },
        {
          question: 'Zijn jullie babyproducten en speelgoed veilig?',
          answer: 'Ja, absolute veiligheid staat bij ons voorop! Al ons speelgoed (zoals onze Montessori houten speelgoedlijn) en babyverzorging voldoen aan strenge Europese veiligheidsnormen (EN71 en CE-markering) en zijn 100% BPA-vrij.',
        },
        {
          question: 'Wat als mijn bestelling vertraging heeft of kwijt is?',
          answer: 'Je ontvangt na verzending direct een PostNL of DHL Track & Trace code per e-mail. Heb je na 2 werkdagen nog geen pakket ontvangen? Neem dan direct contact op met onze klantenservice via info@thebabysupply.nl zodat we direct navraag kunnen doen.',
        },
      ],
      products_services: [
        {
          id: 'prod_tbs_01',
          name: 'Brievenbuspakket Hello Baby',
          sku: 'TBS-CADEAU-HB01',
          price: 24.95,
          currency: 'EUR',
          in_stock: true,
          is_active: true,
          description: 'Liefdevol samengesteld kraamcadeau brievenbuspakket met zachte sokjes, houten bijtring en felicitatiekaart.',
          stock_quantity: 42,
        },
        {
          id: 'prod_tbs_02',
          name: 'Philips Avent Babyfoon DECT SCD713/26',
          sku: 'TBS-AVENT-SCD713',
          price: 119.99,
          currency: 'EUR',
          in_stock: true,
          is_active: true,
          description: '100% storingsvrije kristalheldere babyfoon met nachtlampje, slaapliedjes en temperatuursensor.',
          stock_quantity: 18,
        },
        {
          id: 'prod_tbs_03',
          name: 'Philips Avent Elektrische Borstkolf Single',
          sku: 'TBS-AVENT-KOLF1',
          price: 139.99,
          currency: 'EUR',
          in_stock: true,
          is_active: true,
          description: 'Natuurlijke stimulatie en comfortabel afkolven zonder voorover te leunen met zacht massagekussen.',
          stock_quantity: 12,
        },
        {
          id: 'prod_tbs_04',
          name: 'Elvie Pump Double Borstkolf Draadloos',
          sku: 'TBS-ELVIE-DOUBLE',
          price: 599.00,
          currency: 'EUR',
          in_stock: true,
          is_active: true,
          description: 'Stille, draadloze handsfree kolf die in je bh past. Discreet afkolven met app-verbinding.',
          stock_quantity: 7,
        },
        {
          id: 'prod_tbs_05',
          name: 'Montessori Houten Regenboog Speelgoed',
          sku: 'TBS-MONT-RAINBOW',
          price: 29.95,
          currency: 'EUR',
          in_stock: true,
          is_active: true,
          description: 'Open-ended educatief speelgoed gemaakt van duurzaam FSC-gecertificeerd beukenhout en kindveilige verf.',
          stock_quantity: 38,
        },
        {
          id: 'prod_tbs_06',
          name: 'Sage Canyon Meisjesjurk',
          sku: 'TBS-DRESS-SC68',
          price: 34.95,
          currency: 'EUR',
          in_stock: true,
          is_active: true,
          description: 'Prachtige gebloemde meisjesjurk van zacht ademend 100% biologisch katoen.',
          stock_quantity: 26,
        },
        {
          id: 'prod_tbs_07',
          name: 'Matchstick Monkey Siliconen Bijtring Aapje',
          sku: 'TBS-MM-TEETH-MNT',
          price: 14.95,
          currency: 'EUR',
          in_stock: true,
          is_active: true,
          description: 'Ergonomische bijtring met zachte borsteltjes om tandjespijn te verlichten. BPA-vrij.',
          stock_quantity: 55,
        },
        {
          id: 'prod_tbs_08',
          name: 'Hydrofiele Doeken 3-Pack Biologisch Katoen',
          sku: 'TBS-DOEK-3PK',
          price: 18.95,
          currency: 'EUR',
          in_stock: true,
          is_active: true,
          description: 'Set van 3 extra grote zachte hydrofiele doeken (70x70 cm) met pastelprint.',
          stock_quantity: 48,
        },
      ],
    },
    connections: {
      website: {
        type: 'custom',
        status: 'connected',
        store_url: 'https://thebabysupply.nl',
        hosted_inquiry_enabled: true,
        is_verified: true,
        last_tested: new Date().toISOString(),
      },
      email: {
        mode: 'demo',
        provider: 'none',
        status: 'demo_simulated',
        sender_name: 'The Baby Supply Klantenservice',
        sender_email: 'info@thebabysupply.nl',
        reply_to: 'info@thebabysupply.nl',
      },
    },
  };

  await query(
    `INSERT INTO iao.businesses (tenant_id, settings, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (tenant_id)
     DO UPDATE SET settings = $2::jsonb, updated_at = NOW();`,
    [tenantId, JSON.stringify(babySupplySettings)]
  );
  console.log('  ✓ Updated iao.businesses profile to "The Baby Supply" (EUR, Netherlands, Europe/Amsterdam)');

  // 2. Save Custom Store connection record in iao.custom_store_connections
  const conn = await saveCustomStoreConnection({
    tenantId,
    storeName: 'The Baby Supply',
    websiteUrl: 'https://thebabysupply.nl',
    apiBaseUrl: baseUrl,
    apiKey,
    webhookSecret,
  });
  console.log(`  ✓ Saved Custom Store connection: ${conn.id} (status: ${conn.is_connected ? 'Connected' : 'Disconnected'})`);

  // 3. Trigger initial sync to ingest products and orders
  console.log('\n--- Ingesting The Baby Supply Products & Orders ---');
  const { job } = await startCustomStoreSyncJob(tenantId, conn.id);
  console.log(`  ✓ Sync job started: ${job.id}`);

  // 3a. Fetch & Ingest Store Profile
  const storePage = await fetchCustomStorePage({
    jobId: job.id,
    resourceType: 'store',
  });
  await ingestCustomStoreBatch({
    jobId: job.id,
    resourceType: 'store',
    storeInfo: storePage.data,
  });
  console.log(`  ✓ Store Profile synced: Currency = ${storePage.data.currency}, Timezone = ${storePage.data.timezone}`);

  // 3b. Fetch & Ingest Products
  const productsPage = await fetchCustomStorePage({
    jobId: job.id,
    resourceType: 'products',
    page: 1,
    limit: 50,
  });
  const productsResult = await ingestCustomStoreBatch({
    jobId: job.id,
    resourceType: 'products',
    items: productsPage.data.products,
  });
  console.log(`  ✓ Products synced: ${productsResult.processedCount} products ingested cleanly`);

  // 3b. Fetch & Ingest Orders
  const ordersPage = await fetchCustomStorePage({
    jobId: job.id,
    resourceType: 'orders',
    page: 1,
    limit: 50,
  });
  const ordersResult = await ingestCustomStoreBatch({
    jobId: job.id,
    resourceType: 'orders',
    items: ordersPage.data.orders,
  });
  console.log(`  ✓ Orders synced: ${ordersResult.processedCount} orders ingested cleanly (with PostNL & DHL tracking)`);

  // 3c. Finish Sync Job
  const finished = await finishCustomStoreSyncJob(tenantId, job.id, 'completed', null);
  console.log(`  ✓ Sync job completed: status = ${finished.status}`);

  // 4. Verify resulting connection state
  const verifiedConn = await getCustomStoreConnection(tenantId);
  console.log('\n--- VERIFICATION RESULT ---');
  console.log(`  Store Name: ${verifiedConn?.store_name}`);
  console.log(`  Website: ${verifiedConn?.website_url}`);
  console.log(`  Synced Products: ${verifiedConn?.product_count}`);
  console.log(`  Synced Orders: ${verifiedConn?.order_count}`);
  console.log(`  Currency: ${verifiedConn?.currency}`);
  console.log(`  Status: ${verifiedConn?.sync_status}`);
  console.log(`  Last Synced: ${verifiedConn?.last_synced_at}`);
  console.log('====================================================\n');
}

setupTheBabySupply()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to setup The Baby Supply:', err);
    process.exit(1);
  });

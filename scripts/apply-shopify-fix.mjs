import pg from 'pg';
import { classifyEmailMessage } from '../lib/email-filter.ts';

const pool = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo' });

async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

async function main() {
  console.log('--- Applying Shopify Profile & Email Filter Fixes ---');

  // 1. Trace Shopify Connection and update Business Settings for connected stores
  const conns = await query(`SELECT tenant_id, shop_domain, is_connected, store_info FROM iao.shopify_connections WHERE is_connected = true;`);
  
  for (const conn of conns) {
    const tenantId = conn.tenant_id;
    const storeInfo = conn.store_info || {};
    const storeName = String(storeInfo.name || '').trim();
    const storeCurrency = String(storeInfo.currency || 'USD').trim();
    const storeTimezone = String(storeInfo.iana_timezone || storeInfo.timezone || 'America/New_York').trim();
    const storeCountry = String(storeInfo.country_name || storeInfo.country || 'United States').trim();

    console.log(`Found active Shopify connection for tenant [${tenantId}]: store "${storeName}", currency "${storeCurrency}"`);

    const bizRows = await query(`SELECT tenant_id, settings FROM iao.businesses WHERE tenant_id = $1;`, [tenantId]);
    if (bizRows[0]) {
      const currentSettings = bizRows[0].settings || {};
      const currentName = currentSettings.business_name;
      const hasCustomOverride = Boolean(currentSettings.display_name_override);

      const effectiveName = !hasCustomOverride && storeName && (currentName === 'Demo Clothing Store' || !currentName)
        ? storeName
        : currentName || storeName;

      const updatedSettings = {
        ...currentSettings,
        business_name: effectiveName,
        currency: storeCurrency || currentSettings.currency || 'USD',
        timezone: storeTimezone || currentSettings.timezone,
        country: storeCountry || currentSettings.country,
      };

      await query(
        `UPDATE iao.businesses SET settings = $1::jsonb, updated_at = NOW() WHERE tenant_id = $2;`,
        [JSON.stringify(updatedSettings), tenantId]
      );
      console.log(`✓ Updated business [${tenantId}] settings: business_name="${updatedSettings.business_name}", currency="${updatedSettings.currency}"`);
    }

    // 2. Remap Shopify Products into Knowledge with source currency
    const products = await query(
      `SELECT tenant_id, shopify_product_id, title, handle, product_type, vendor, status, variants, options
       FROM iao.shopify_products
       WHERE tenant_id = $1 AND status != 'archived'
       ORDER BY updated_at DESC
       LIMIT 100;`,
      [tenantId]
    );

    const mappedItems = [];
    for (const p of products) {
      const variants = Array.isArray(p.variants) ? p.variants : [];
      if (variants.length > 0) {
        for (const v of variants) {
          const variantSuffix = v.title && v.title !== 'Default Title' ? ` (${v.title})` : '';
          const resolvedCurrency = v.currency || storeCurrency || 'USD';
          mappedItems.push({
            id: `sp-${p.shopify_product_id}-${v.id}`,
            name: `${p.title}${variantSuffix}`,
            sku: v.sku || `SKU-${v.id}`,
            price: typeof v.price === 'string' ? parseFloat(v.price) : Number(v.price || 0),
            currency: resolvedCurrency,
            description: `${p.product_type ? `[${p.product_type}] ` : ''}${p.title}`,
            in_stock: Boolean(v.available ?? ((v.inventory_quantity || 0) > 0)),
            stock_quantity: v.inventory_quantity ?? 0,
            is_active: true,
          });
        }
      } else {
        mappedItems.push({
          id: `sp-${p.shopify_product_id}`,
          name: p.title,
          sku: `SKU-${p.shopify_product_id}`,
          price: 0,
          currency: storeCurrency || 'USD',
          description: p.title,
          in_stock: true,
          stock_quantity: 1,
          is_active: true,
        });
      }
    }

    if (mappedItems.length > 0) {
      const latestBiz = await query(`SELECT settings FROM iao.businesses WHERE tenant_id = $1;`, [tenantId]);
      if (latestBiz[0]) {
        const s = latestBiz[0].settings;
        s.knowledge = s.knowledge || {};
        s.knowledge.products_services = mappedItems;
        await query(`UPDATE iao.businesses SET settings = $1::jsonb, updated_at = NOW() WHERE tenant_id = $2;`, [JSON.stringify(s), tenantId]);
        console.log(`✓ Materialized ${mappedItems.length} Shopify products with source currency [${storeCurrency}] into knowledge.`);
      }
    }
  }

  // 3. Clean up and ignore non-customer automated emails (sign-in alerts, OTPs, newsletters)
  const allConvs = await query(`
    SELECT c.id, c.tenant_id, c.customer_name, c.customer_email, c.subject, c.status,
           (SELECT m.body FROM iao.messages m WHERE m.conversation_id = c.id ORDER BY m.created_at ASC LIMIT 1) as message_body
    FROM iao.conversations c;
  `);
  let ignoredCount = 0;

  for (const conv of allConvs) {
    const classification = classifyEmailMessage({
      senderEmail: conv.customer_email || '',
      senderName: conv.customer_name || '',
      subject: conv.subject || '',
      bodyText: conv.message_body || '',
    });

    if (classification.isNonCustomer) {
      await query(
        `UPDATE iao.conversations SET status = 'ignored', unread = false, updated_at = NOW() WHERE id = $1;`,
        [conv.id]
      );
      // Cancel any pending unsent drafts for this conversation
      await query(
        `UPDATE iao.messages
         SET status = 'failed', approval_status = 'rejected',
             metadata = metadata || '{"ignored": true, "reason": "Non-customer notification filtered"}'::jsonb
         WHERE conversation_id = $1 AND status = 'draft' AND approval_status = 'pending_approval';`,
        [conv.id]
      );
      ignoredCount++;
      console.log(`✓ Ignored non-customer conversation [${conv.id}] (${conv.customer_email} - "${conv.subject}"): ${classification.reason}`);
    }
  }

  console.log(`--- Done! Updated ${conns.length} Shopify store(s), ignored ${ignoredCount} non-customer conversation(s). ---`);
  await pool.end();
}

main().catch(console.error);

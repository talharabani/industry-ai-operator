import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { decryptSecret } from '../lib/crypto.js';

// Parse .env.local if exists
try {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
} catch (e) {
  console.log('No .env.local file found or error reading it:', e.message);
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/iao_demo',
});

async function main() {
  console.log('--- 1. Stored Shopify Connection Record ---');
  const res = await pool.query(
    `SELECT tenant_id, shop_domain, encrypted_access_token, scope, is_connected, sync_status, last_error, store_info, last_synced_at
     FROM iao.shopify_connections
     WHERE tenant_id = 'demo-store';`
  );

  if (res.rows.length === 0) {
    console.error('No connection row found for demo-store');
    return;
  }

  const row = res.rows[0];
  console.log('Tenant:', row.tenant_id);
  console.log('Shop Domain:', row.shop_domain);
  console.log('Stored Scope:', row.scope);
  console.log('Sync Status:', row.sync_status);
  console.log('Last Synced At:', row.last_synced_at);
  console.log('Last Error:', row.last_error);

  const accessToken = decryptSecret(row.encrypted_access_token);
  const maskedToken = accessToken.slice(0, 8) + '••••••••' + accessToken.slice(-4);
  console.log('Decrypted Token:', maskedToken, `(length: ${accessToken.length})`);

  const shop = row.shop_domain;
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2025-01';

  console.log(`\n--- 2. Live GraphQL Request: Shop, App & Granted Scopes (${apiVersion}) ---`);
  const shopQuery = `
    query getShopAndAppDetails {
      shop {
        id
        name
        myshopifyDomain
        currencyCode
        email
        plan {
          displayName
        }
      }
      app {
        apiKey
        title
        installation {
          accessScopes {
            handle
          }
        }
      }
    }
  `;

  const shopUrl = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  const shopResponse = await fetch(shopUrl, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: shopQuery }),
  });

  console.log('Shop/App HTTP Status:', shopResponse.status, shopResponse.statusText);
  console.log('X-Request-ID:', shopResponse.headers.get('x-request-id'));
  console.log('Shopify Call Limit:', shopResponse.headers.get('x-shopify-shop-api-call-limit'));
  
  const shopData = await shopResponse.json();
  console.log('Shop/App Response Data:', JSON.stringify(shopData, null, 2));

  console.log(`\n--- 3. Live GraphQL Request: Orders & Customer Protected Data (${apiVersion}) ---`);
  const ordersQuery = `
    query getOrders {
      orders(first: 10, sortKey: CREATED_AT, reverse: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              id
              displayName
              email
              phone
            }
            shippingAddress {
              name
              formatted
            }
            fulfillments(first: 5) {
              trackingInfo(first: 5) {
                number
                company
              }
            }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  variantTitle
                  sku
                  quantity
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const ordersResponse = await fetch(shopUrl, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: ordersQuery }),
  });

  console.log('Orders Query HTTP Status:', ordersResponse.status, ordersResponse.statusText);
  console.log('Orders Query X-Request-ID:', ordersResponse.headers.get('x-request-id'));
  const ordersData = await ordersResponse.json();
  console.log('Orders Query Response Data:', JSON.stringify(ordersData, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error('Fatal diagnostic error:', e);
  process.exit(1);
});

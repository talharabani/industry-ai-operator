import fs from 'fs';
import { decryptSecret } from '../lib/crypto.js';
import pg from 'pg';

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
} catch (e) {}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/iao_demo',
});

async function main() {
  const res = await pool.query(`SELECT encrypted_access_token, shop_domain FROM iao.shopify_connections WHERE tenant_id = 'demo-store';`);
  const accessToken = decryptSecret(res.rows[0].encrypted_access_token);
  const shop = res.rows[0].shop_domain;

  // Test GraphQL Order fields with email, phone, customer, shippingAddress
  const testQuery = `
    query getOrdersTest {
      orders(first: 5, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            email
            phone
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            shippingAddress {
              name
              formatted
              phone
            }
            lineItems(first: 10) {
              edges {
                node {
                  id
                  title
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

  const resp = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: testQuery }),
  });

  console.log('HTTP Status:', resp.status);
  const data = await resp.json();
  console.log('Test Query Result without `customer` field:', JSON.stringify(data, null, 2));

  await pool.end();
}

main().catch(console.error);

import crypto from 'crypto';

// Modern supported Shopify Admin API version (2025-01 / 2025-04 / 2026-01)
export const DEFAULT_SHOPIFY_API_VERSION = '2025-01';
export const DEFAULT_SHOPIFY_SCOPES = [
  'read_products',
  'read_orders',
  'read_inventory',
  'read_locations',
];

export interface ShopifyOAuthConfig {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  redirectUri: string;
  apiVersion: string;
  appUrl: string;
}

/**
 * Resolves Shopify OAuth configuration from environment variables.
 */
export function getShopifyOAuthConfig(origin?: string): ShopifyOAuthConfig | null {
  const clientId = (process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_CLIENT_SECRET || '').trim();
  const appUrl = (process.env.SHOPIFY_APP_URL || origin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const apiVersion = process.env.SHOPIFY_API_VERSION || DEFAULT_SHOPIFY_API_VERSION;

  if (!clientId || !clientSecret) {
    return null;
  }

  const customScopes = process.env.SHOPIFY_SCOPES
    ? process.env.SHOPIFY_SCOPES.split(',').map((s) => s.trim())
    : DEFAULT_SHOPIFY_SCOPES;

  return {
    clientId,
    clientSecret,
    scopes: customScopes,
    redirectUri: `${appUrl}/api/auth/shopify/callback`,
    apiVersion,
    appUrl,
  };
}

/**
 * Normalizes and validates a Shopify shop domain.
 * Accepts: "my-store.myshopify.com", "https://my-store.myshopify.com", "my-store"
 */
export function sanitizeShopDomain(rawShop: string): string | null {
  if (!rawShop || typeof rawShop !== 'string') return null;

  let cleaned = rawShop.trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  if (!cleaned.includes('.myshopify.com')) {
    cleaned = `${cleaned}.myshopify.com`;
  }

  // Enforce valid Shopify shop subdomain regex
  const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
  if (!shopRegex.test(cleaned)) {
    return null;
  }

  return cleaned;
}

/**
 * Builds the Shopify OAuth authorization URL.
 */
export function buildShopifyAuthUrl(params: {
  shop: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
}): string {
  const { shop, clientId, redirectUri, scopes, state } = params;
  const scopeStr = scopes.join(',');
  const queryParams = new URLSearchParams({
    client_id: clientId,
    scope: scopeStr,
    redirect_uri: redirectUri,
    state,
  });

  return `https://${shop}/admin/oauth/authorize?${queryParams.toString()}`;
}

/**
 * Verifies Shopify OAuth Callback HMAC parameter.
 * Parameters must be sorted alphabetically by key, formatted as key=value, joined with '&',
 * then hashed with HMAC-SHA256 using the client secret.
 */
export function verifyShopifyHmac(queryParams: Record<string, string>, clientSecret: string): boolean {
  const { hmac, signature, ...rest } = queryParams;
  const targetHmac = hmac || signature;

  if (!targetHmac || !clientSecret) {
    return false;
  }

  const sortedKeys = Object.keys(rest).sort();
  const message = sortedKeys
    .map((k) => `${k}=${rest[k]}`)
    .join('&');

  const generatedHmac = crypto
    .createHmac('sha256', clientSecret)
    .update(message, 'utf8')
    .digest('hex');

  try {
    const a = Buffer.from(generatedHmac, 'hex');
    const b = Buffer.from(targetHmac, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Verifies Shopify webhook raw body against X-Shopify-Hmac-Sha256 header (Base64 HMAC-SHA256).
 * Uses verbatim raw request body and app client secret.
 */
export function verifyShopifyWebhookHmac(rawBody: string | Buffer, hmacHeader: string, secret: string): boolean {
  if (!hmacHeader || !secret) return false;

  const generated = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  try {
    const a = Buffer.from(generated, 'utf8');
    const b = Buffer.from(hmacHeader, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Custom error thrown when Shopify blocks order access due to missing read_orders scope
 * or unapproved Protected Customer Data (PCD) access.
 */
export class ShopifyOrderAccessBlockedError extends Error {
  readonly isOrderAccessBlocked = true;
  constructor(message?: string) {
    super(
      message ||
      'Shopify order access blocked: app requires read_orders scope and approved Protected Customer Data access in Shopify Partner Dashboard.'
    );
    this.name = 'ShopifyOrderAccessBlockedError';
  }
}

/**
 * Type guard to check if an error is due to Shopify Protected Customer Data / permissions restriction.
 */
export function isShopifyOrderAccessBlockedError(err: unknown): boolean {
  if (err instanceof ShopifyOrderAccessBlockedError) return true;
  if (err && typeof err === 'object') {
    if ('isOrderAccessBlocked' in err && Boolean((err as any).isOrderAccessBlocked)) return true;
    const msg = String((err as any).message || '');
    if (
      msg.includes('protected customer data') ||
      msg.includes('Protected customer data') ||
      msg.includes('Access denied for orders') ||
      msg.includes('ACCESS_DENIED') ||
      msg.includes('not approved to access') ||
      msg.includes('order access blocked') ||
      (msg.includes('403') && (msg.includes('order') || msg.includes('customer') || msg.includes('REST')))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Exchanges Shopify OAuth authorization code for permanent offline access token.
 */
export async function exchangeShopifyCodeForAccessToken(params: {
  shop: string;
  code: string;
  config: ShopifyOAuthConfig;
}): Promise<{ accessToken: string; scope: string }> {
  const { shop, code, config } = params;
  const url = `https://${shop}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify OAuth token exchange failed (HTTP ${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Shopify response did not contain an access_token');
  }

  return {
    accessToken: data.access_token,
    scope: data.scope || config.scopes.join(','),
  };
}

/**
 * Generic GraphQL Admin API execution helper with rate-limiting backoff
 */
export async function executeShopifyGraphQL<T = any>(params: {
  shop: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
  apiVersion?: string;
}): Promise<{ data: T; extensions?: any }> {
  const { shop, accessToken, query, variables, apiVersion = DEFAULT_SHOPIFY_API_VERSION } = params;
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 403 || /protected customer data|access denied|permission/i.test(errText)) {
      throw new ShopifyOrderAccessBlockedError(
        `Shopify GraphQL HTTP 403: App not approved to access protected customer data or missing read_orders permission.`
      );
    }
    throw new Error(`Shopify GraphQL request failed (HTTP ${response.status}): ${errText}`);
  }

  const resJson = await response.json();
  if (resJson.errors && Array.isArray(resJson.errors) && resJson.errors.length > 0) {
    const errorMsg = resJson.errors.map((e: any) => e.message).join('; ');
    if (!resJson.data) {
      const isAccessDenied = resJson.errors.some((e: any) =>
        e.extensions?.code === 'ACCESS_DENIED' ||
        /protected customer data|access denied|read_orders|permission/i.test(e.message || '')
      );
      if (isAccessDenied) {
        throw new ShopifyOrderAccessBlockedError(
          `Shopify GraphQL order access blocked: ${errorMsg}`
        );
      }
      throw new Error(`Shopify GraphQL execution error: ${errorMsg}`);
    }
    console.warn(`[Shopify GraphQL Notice]: ${errorMsg}`);
  }

  return { data: resJson.data as T, extensions: resJson.extensions };
}

/**
 * GraphQL query for Shop profile and published store policies
 */
export const GRAPHQL_SHOP_AND_POLICIES_QUERY = `
  query getShopAndPolicies {
    shop {
      id
      name
      email
      myshopifyDomain
      currencyCode
      plan {
        displayName
      }
      timezoneAbbreviation
      ianaTimezone
      privacyPolicy {
        body
      }
      refundPolicy {
        body
      }
      shippingPolicy {
        body
      }
      termsOfService {
        body
      }
    }
  }
`;

/**
 * GraphQL query for Products and Variant inventory
 */
export const GRAPHQL_PRODUCTS_QUERY = `
  query getProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          title
          handle
          productType
          vendor
          status
          variants(first: 50) {
            edges {
              node {
                id
                title
                price
                sku
                inventoryQuantity
                availableForSale
                barcode
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * GraphQL query for Orders, fulfillments and customer information
 */
export const GRAPHQL_ORDERS_QUERY = `
  query getOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
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

/**
 * Fetches Shop profile and policies using GraphQL Admin API (with REST fallback)
 */
export async function fetchShopifyShopInfo(params: {
  shop: string;
  accessToken: string;
  apiVersion?: string;
}): Promise<{
  id: string | number;
  name: string;
  email: string;
  currency: string;
  domain: string;
  myshopify_domain: string;
  plan_name: string;
  country_name?: string;
  iana_timezone?: string;
  [key: string]: unknown;
}> {
  const { shop, accessToken, apiVersion = DEFAULT_SHOPIFY_API_VERSION } = params;

  try {
    const res = await executeShopifyGraphQL<{ shop: any }>({
      shop,
      accessToken,
      query: GRAPHQL_SHOP_AND_POLICIES_QUERY,
      apiVersion,
    });

    const s = res.data?.shop || {};
    return {
      id: s.id ? String(s.id).replace(/^gid:\/\/shopify\/Shop\//, '') : '1',
      name: s.name || shop,
      email: s.email || '',
      currency: s.currencyCode || '',
      domain: s.myshopifyDomain || shop,
      myshopify_domain: s.myshopifyDomain || shop,
      plan_name: s.plan?.displayName || 'Standard',
      iana_timezone: s.ianaTimezone || 'UTC',
    };
  } catch (gqlErr) {
    // REST API fallback
    const url = `https://${shop}/admin/api/${apiVersion}/shop.json`;
    const response = await fetchWithRetry(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Failed to fetch shop details (HTTP ${response.status}): ${err}`);
    }

    const data = await response.json();
    return data.shop;
  }
}

/**
 * Wrapper for fetch with Shopify rate limit handling (429 Throttling & Retry-After backoff)
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3
): Promise<Response> {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    const res = await fetch(url, options);

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('Retry-After');
      const waitSeconds = retryAfterHeader ? parseFloat(retryAfterHeader) : Math.pow(2, attempt);
      const waitMs = Math.max(500, Math.min(waitSeconds * 1000, 10000));
      console.warn(`[Shopify API 429 Throttling] Waiting ${waitMs}ms before retry ${attempt}/${maxRetries}...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    return res;
  }

  return fetch(url, options);
}

/**
 * Fetches paginated products using GraphQL Admin API
 */
export async function fetchShopifyProductsBatch(params: {
  shop: string;
  accessToken: string;
  limit?: number;
  sinceId?: string | number;
  cursor?: string;
  apiVersion?: string;
}): Promise<{
  products: any[];
  hasNextPage: boolean;
  nextSinceId: string | null;
}> {
  const { shop, accessToken, limit = 50, cursor, sinceId, apiVersion = DEFAULT_SHOPIFY_API_VERSION } = params;
  const effectiveCursor = cursor || (sinceId ? String(sinceId) : undefined);

  try {
    const gqlRes = await executeShopifyGraphQL<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: Array<{ cursor: string; node: any }>;
      };
    }>({
      shop,
      accessToken,
      query: GRAPHQL_PRODUCTS_QUERY,
      variables: {
        first: Math.min(limit, 100),
        after: effectiveCursor || null,
      },
      apiVersion,
    });

    const edges = gqlRes.data?.products?.edges || [];
    const pageInfo = gqlRes.data?.products?.pageInfo || { hasNextPage: false, endCursor: null };

    const normalizedProducts = edges.map(({ node, cursor: edgeCursor }) => {
      const rawVariants = node.variants?.edges?.map((e: any) => e.node) || [];
      const shopifyId = String(node.id || '').replace(/^gid:\/\/shopify\/Product\//, '');

      return {
        id: shopifyId,
        shopify_product_id: shopifyId,
        title: node.title,
        handle: node.handle,
        product_type: node.productType,
        vendor: node.vendor,
        status: (node.status || 'ACTIVE').toLowerCase(),
        cursor: edgeCursor,
        variants: rawVariants.map((v: any) => ({
          id: String(v.id || '').replace(/^gid:\/\/shopify\/ProductVariant\//, ''),
          product_id: shopifyId,
          title: v.title,
          price: v.price,
          sku: v.sku || '',
          inventory_quantity: v.inventoryQuantity ?? 10,
          available: Boolean(v.availableForSale ?? ((v.inventoryQuantity || 0) > 0)),
          barcode: v.barcode || '',
        })),
      };
    });

    return {
      products: normalizedProducts,
      hasNextPage: Boolean(pageInfo.hasNextPage),
      nextSinceId: pageInfo.endCursor || (normalizedProducts.length > 0 ? normalizedProducts[normalizedProducts.length - 1].cursor : null),
    };
  } catch (gqlErr) {
    // REST fallback for compatibility
    const query = new URLSearchParams({ limit: String(limit) });
    if (sinceId) query.set('since_id', String(sinceId));

    const url = `https://${shop}/admin/api/${apiVersion}/products.json?${query.toString()}`;
    const response = await fetchWithRetry(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Failed to fetch Shopify products (HTTP ${response.status}): ${err}`);
    }

    const data = await response.json();
    const products = Array.isArray(data.products) ? data.products : [];
    return {
      products,
      hasNextPage: products.length >= limit,
      nextSinceId: products.length > 0 ? String(products[products.length - 1].id) : null,
    };
  }
}

/**
 * Fetches paginated orders using GraphQL Admin API
 */
export async function fetchShopifyOrdersBatch(params: {
  shop: string;
  accessToken: string;
  limit?: number;
  sinceId?: string | number;
  cursor?: string;
  apiVersion?: string;
}): Promise<{
  orders: any[];
  hasNextPage: boolean;
  nextSinceId: string | null;
}> {
  const { shop, accessToken, limit = 50, cursor, sinceId, apiVersion = DEFAULT_SHOPIFY_API_VERSION } = params;
  const effectiveCursor = cursor || (sinceId ? String(sinceId) : undefined);

  try {
    const gqlRes = await executeShopifyGraphQL<{
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: Array<{ cursor: string; node: any }>;
      };
    }>({
      shop,
      accessToken,
      query: GRAPHQL_ORDERS_QUERY,
      variables: {
        first: Math.min(limit, 100),
        after: effectiveCursor || null,
      },
      apiVersion,
    });

    const edges = gqlRes.data?.orders?.edges || [];
    const pageInfo = gqlRes.data?.orders?.pageInfo || { hasNextPage: false, endCursor: null };

    const normalizedOrders = edges.map(({ node, cursor: edgeCursor }) => {
      const shopifyOrderId = String(node.id || '').replace(/^gid:\/\/shopify\/Order\//, '');
      const lineItems = node.lineItems?.edges?.map((e: any) => ({
        id: String(e.node.id || '').replace(/^gid:\/\/shopify\/LineItem\//, ''),
        title: e.node.title,
        name: e.node.title,
        variant_title: e.node.variantTitle,
        sku: e.node.sku || '',
        quantity: e.node.quantity || 1,
        qty: e.node.quantity || 1,
        price: parseFloat(e.node.originalUnitPriceSet?.shopMoney?.amount || '0'),
        currency: e.node.originalUnitPriceSet?.shopMoney?.currencyCode || '',
      })) || [];

      const fulfillmentTracking = node.fulfillments?.[0]?.trackingInfo?.[0] || {};

      const customerName = node.shippingAddress?.name || node.customer?.displayName || '';
      const customerEmail = node.email || node.customer?.email || '';
      const customerPhone = node.phone || node.shippingAddress?.phone || node.customer?.phone || '';

      return {
        id: shopifyOrderId,
        order_id: shopifyOrderId,
        name: node.name || `#${shopifyOrderId}`,
        created_at: node.createdAt,
        total_price: node.totalPriceSet?.shopMoney?.amount || '0.00',
        currency: node.totalPriceSet?.shopMoney?.currencyCode || '',
        financial_status: (node.displayFinancialStatus || 'PAID').toLowerCase(),
        fulfillment_status: (node.displayFulfillmentStatus || 'UNFULFILLED').toLowerCase(),
        customer: {
          name: customerName,
          email: customerEmail,
          phone: customerPhone,
        },
        email: customerEmail,
        shipping_address: {
          name: customerName,
          formatted: node.shippingAddress?.formatted || [],
        },
        tracking_number: fulfillmentTracking.number || null,
        carrier: fulfillmentTracking.company || null,
        line_items: lineItems,
        cursor: edgeCursor,
      };
    });

    return {
      orders: normalizedOrders,
      hasNextPage: Boolean(pageInfo.hasNextPage),
      nextSinceId: pageInfo.endCursor || (normalizedOrders.length > 0 ? normalizedOrders[normalizedOrders.length - 1].cursor : null),
    };
  } catch (gqlErr) {
    if (isShopifyOrderAccessBlockedError(gqlErr)) {
      throw gqlErr;
    }
    const msg = gqlErr instanceof Error ? gqlErr.message : String(gqlErr);
    if (/403|access denied|protected customer data|not approved|read_orders|permission/i.test(msg)) {
      throw new ShopifyOrderAccessBlockedError(`Shopify order access blocked: ${msg}`);
    }
    throw gqlErr;
  }
}

/**
 * Fetches store policies (Refund, Privacy, Terms, Shipping) using GraphQL Admin API
 */
export async function fetchShopifyPolicies(params: {
  shop: string;
  accessToken: string;
  apiVersion?: string;
}): Promise<{
  refundPolicy?: string;
  shippingPolicy?: string;
  termsOfService?: string;
  privacyPolicy?: string;
  returnWindowDays?: number;
}> {
  const { shop, accessToken, apiVersion = DEFAULT_SHOPIFY_API_VERSION } = params;

  try {
    const gqlRes = await executeShopifyGraphQL<{
      shop: {
        refundPolicy?: { body?: string };
        shippingPolicy?: { body?: string };
        termsOfService?: { body?: string };
        privacyPolicy?: { body?: string };
      };
    }>({
      shop,
      accessToken,
      query: GRAPHQL_SHOP_AND_POLICIES_QUERY,
      apiVersion,
    });

    const s = gqlRes.data?.shop || {};
    const refundPolicy = s.refundPolicy?.body || '';
    const shippingPolicy = s.shippingPolicy?.body || '';
    const termsOfService = s.termsOfService?.body || '';
    const privacyPolicy = s.privacyPolicy?.body || '';

    let returnWindowDays = 14;
    if (refundPolicy) {
      const daysMatch = refundPolicy.match(/(\d+)\s*days/i);
      if (daysMatch) {
        const parsed = parseInt(daysMatch[1], 10);
        if (parsed > 0 && parsed <= 365) returnWindowDays = parsed;
      }
    }

    return {
      refundPolicy,
      shippingPolicy,
      termsOfService,
      privacyPolicy,
      returnWindowDays,
    };
  } catch {
    return { returnWindowDays: 14 };
  }
}

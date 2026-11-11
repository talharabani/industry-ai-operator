import crypto from 'crypto';
import { query } from './order-issues.ts';
import { getBusiness, updateBusinessSettings } from './db.ts';
import { encryptSecret, decryptSecret, maskApiKey } from './crypto.ts';
import { safeFetch, validateOutboundUrl } from './ssrf-protection.ts';
import { reconcileShopifyOrderUpdate } from './order-issues.ts';
import type {
  CustomStoreConnectionRecord,
  CustomStorePublicConfig,
  CustomStoreProductRecord,
  CustomStoreSyncJob,
  OrderRecord,
  ProductServiceItem,
  BusinessSettings,
} from './types.ts';

/**
 * Normalizes an API base URL (strips trailing slashes).
 */
export function normalizeApiBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Builds resource endpoint URL safely, avoiding duplicated /api/v1 or /v1 path segments.
 */
export function buildCustomStoreResourceUrl(baseUrl: string, resource: string): string {
  const clean = normalizeApiBaseUrl(baseUrl);
  const cleanResource = resource.replace(/^\/+/, '');
  if (clean.endsWith('/api/v1') || clean.endsWith('/v1')) {
    return `${clean}/${cleanResource}`;
  }
  return `${clean}/api/v1/${cleanResource}`;
}

export { maskApiKey } from './crypto.ts';

/**
 * Creates or updates a Custom Store Connection for a tenant.
 * Encrypts credentials with AES-256-GCM; never stores plaintext secrets.
 */
export async function createOrUpdateCustomStoreConnection(params: {
  tenantId: string;
  id?: string;
  storeName: string;
  websiteUrl: string;
  apiBaseUrl: string;
  authType?: 'bearer' | 'api_key' | 'basic';
  apiKey?: string;
  username?: string;
  password?: string;
  webhookSecret?: string;
}): Promise<CustomStoreConnectionRecord> {
  const {
    tenantId,
    id = `conn_custom_${tenantId}`,
    storeName,
    websiteUrl,
    apiBaseUrl,
    authType = 'bearer',
    apiKey,
    username,
    password,
    webhookSecret,
  } = params;

  if (!storeName || !storeName.trim()) {
    throw new Error('Store name is required.');
  }
  if (!websiteUrl || !websiteUrl.trim()) {
    throw new Error('Website URL is required.');
  }
  if (!apiBaseUrl || !apiBaseUrl.trim()) {
    throw new Error('API Base URL is required.');
  }

  const cleanBaseUrl = normalizeApiBaseUrl(apiBaseUrl);

  // Validate outbound destination against SSRF
  const ssrfValidation = await validateOutboundUrl(cleanBaseUrl);
  if (!ssrfValidation.isValid) {
    throw new Error(`Security validation failed for API Base URL: ${ssrfValidation.error}`);
  }

  // Fetch existing record if any to preserve credentials if not re-entered
  const existingRows = await query<CustomStoreConnectionRecord>(
    `SELECT * FROM iao.custom_store_connections WHERE tenant_id = $1 AND id = $2 LIMIT 1;`,
    [tenantId, id]
  );
  const existing = existingRows[0] || null;

  let encryptedCreds: Record<string, unknown> = existing?.encrypted_credentials || {};

  if (apiKey && apiKey.trim()) {
    const rawKey = apiKey.trim();
    encryptedCreds = {
      ...encryptedCreds,
      encrypted_api_key: encryptSecret(rawKey),
      masked_key: maskApiKey(rawKey),
    };
  }

  if (username && username.trim()) {
    encryptedCreds.encrypted_username = encryptSecret(username.trim());
  }
  if (password && password.trim()) {
    encryptedCreds.encrypted_password = encryptSecret(password.trim());
  }

  const cleanWebhookSecret = webhookSecret !== undefined
    ? (webhookSecret.trim() || null)
    : (existing?.webhook_secret || null);

  const rows = await query<CustomStoreConnectionRecord>(
    `INSERT INTO iao.custom_store_connections (
      id, tenant_id, store_name, website_url, api_base_url, auth_type,
      encrypted_credentials, webhook_secret, is_connected, sync_status,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, true, 'idle', NOW(), NOW())
    ON CONFLICT (tenant_id, id) DO UPDATE SET
      store_name = EXCLUDED.store_name,
      website_url = EXCLUDED.website_url,
      api_base_url = EXCLUDED.api_base_url,
      auth_type = EXCLUDED.auth_type,
      encrypted_credentials = EXCLUDED.encrypted_credentials,
      webhook_secret = COALESCE(EXCLUDED.webhook_secret, iao.custom_store_connections.webhook_secret),
      is_connected = true,
      last_error = NULL,
      updated_at = NOW()
    RETURNING *;`,
    [
      id,
      tenantId,
      storeName.trim(),
      websiteUrl.trim(),
      cleanBaseUrl,
      authType,
      JSON.stringify(encryptedCreds),
      cleanWebhookSecret,
    ]
  );

  const saved = rows[0];

  await query(
    `INSERT INTO iao.audit (tenant_id, event, details, created_at)
     VALUES ($1, 'custom_store_connected', $2::jsonb, NOW());`,
    [tenantId, JSON.stringify({ connection_id: saved.id, store_name: saved.store_name, api_base_url: saved.api_base_url })]
  );

  return saved;
}

/**
 * Retrieves a custom store connection by tenant and connection ID.
 */
export async function getCustomStoreConnection(
  tenantId: string,
  connectionId?: string
): Promise<CustomStoreConnectionRecord | null> {
  const queryStr = connectionId
    ? `SELECT * FROM iao.custom_store_connections WHERE tenant_id = $1 AND id = $2 LIMIT 1;`
    : `SELECT * FROM iao.custom_store_connections WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1;`;
  const params = connectionId ? [tenantId, connectionId] : [tenantId];
  const rows = await query<CustomStoreConnectionRecord>(queryStr, params);
  return rows[0] || null;
}

/**
 * Lists active custom store connections for a tenant, or all active connections if tenant is omitted.
 */
export async function listCustomStoreConnections(
  tenantId?: string
): Promise<CustomStoreConnectionRecord[]> {
  if (!tenantId || !tenantId.trim()) {
    // Missing tenant scope fails closed. Never return all tenants!
    return [];
  }
  const queryStr = `SELECT * FROM iao.custom_store_connections WHERE tenant_id = $1 AND is_connected = true ORDER BY created_at ASC;`;
  const params = [tenantId.trim()];
  return await query<CustomStoreConnectionRecord>(queryStr, params);
}

/**
 * Returns safe public configuration for frontend (masks all credentials).
 */
export async function getCustomStorePublicConfig(
  tenantId: string,
  connectionId?: string
): Promise<CustomStorePublicConfig | null> {
  const conn = await getCustomStoreConnection(tenantId, connectionId);
  if (!conn) return null;

  return {
    id: conn.id,
    store_name: conn.store_name,
    website_url: conn.website_url,
    api_base_url: conn.api_base_url,
    auth_type: conn.auth_type,
    masked_key: (conn.encrypted_credentials?.masked_key as string) || (conn.encrypted_credentials?.encrypted_api_key ? '••••••••••••' : ''),
    masked_api_key: (conn.encrypted_credentials?.masked_key as string) || (conn.encrypted_credentials?.encrypted_api_key ? '••••••••••••' : ''),
    has_webhook_secret: Boolean(conn.webhook_secret),
    is_connected: conn.is_connected,
    sync_status: conn.sync_status,
    last_synced_at: conn.last_synced_at,
    last_error: conn.last_error,
    product_count: conn.product_count || 0,
    order_count: conn.order_count || 0,
    currency: (conn.store_info?.currency as string) || 'USD',
    created_at: conn.created_at,
  };
}

/**
 * Disconnects a custom store connection.
 */
export async function disconnectCustomStoreConnection(
  tenantId: string,
  connectionId?: string
): Promise<{ success: boolean; connection?: CustomStoreConnectionRecord | null }> {
  const conn = await getCustomStoreConnection(tenantId, connectionId);
  if (!conn) {
    return { success: false, connection: null };
  }

  const rows = await query<CustomStoreConnectionRecord>(
    `UPDATE iao.custom_store_connections
     SET is_connected = false, sync_status = 'disconnected', updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *;`,
    [tenantId, conn.id]
  );

  await query(
    `INSERT INTO iao.audit (tenant_id, event, details, created_at)
     VALUES ($1, 'custom_store_disconnected', $2::jsonb, NOW());`,
    [tenantId, JSON.stringify({ connection_id: conn.id, store_name: conn.store_name })]
  );

  return { success: true, connection: rows[0] || null };
}

/**
 * Builds HTTP authorization header from custom store connection credentials.
 */
export function buildAuthHeaders(conn: CustomStoreConnectionRecord): Record<string, string> {
  const creds = conn.encrypted_credentials || {};
  if (conn.auth_type === 'bearer' && creds.encrypted_api_key) {
    const rawKey = decryptSecret(creds.encrypted_api_key as string);
    return { Authorization: `Bearer ${rawKey}` };
  }
  if (conn.auth_type === 'api_key' && creds.encrypted_api_key) {
    const rawKey = decryptSecret(creds.encrypted_api_key as string);
    return { 'X-API-Key': rawKey };
  }
  if (conn.auth_type === 'basic' && creds.encrypted_username && creds.encrypted_password) {
    const u = decryptSecret(creds.encrypted_username as string);
    const p = decryptSecret(creds.encrypted_password as string);
    const b64 = Buffer.from(`${u}:${p}`).toString('base64');
    return { Authorization: `Basic ${b64}` };
  }
  return {};
}

/**
 * Tests connection to custom store's /api/v1/store profile endpoint.
 */
export async function testCustomStoreConnection(params: {
  tenantId: string;
  connectionId?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  authType?: 'bearer' | 'api_key' | 'basic';
}): Promise<{
  success: boolean;
  storeInfo?: any;
  store_profile?: any;
  latencyMs: number;
  latency_ms?: number;
  error?: string;
}> {
  let targetUrl = params.apiBaseUrl ? normalizeApiBaseUrl(params.apiBaseUrl) : '';
  let authHeaders: Record<string, string> = {};

  if (!targetUrl || !params.apiKey) {
    const conn = await getCustomStoreConnection(params.tenantId, params.connectionId);
    if (!conn) {
      throw new Error('Connection record not found.');
    }
    targetUrl = conn.api_base_url;
    authHeaders = buildAuthHeaders(conn);
  } else {
    const at = params.authType || 'bearer';
    if (at === 'bearer') authHeaders = { Authorization: `Bearer ${params.apiKey}` };
    else if (at === 'api_key') authHeaders = { 'X-API-Key': params.apiKey };
  }

  const endpoint = buildCustomStoreResourceUrl(targetUrl, 'store');
  const startTime = Date.now();

  try {
    const response = await safeFetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders,
      },
    }, { timeoutMs: 10000 });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let errMsg = `Custom store returned HTTP ${response.status} ${response.statusText}`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error || errJson.message) {
          errMsg += `: ${errJson.error || errJson.message}`;
        }
      } catch {
        if (errText) errMsg += `: ${errText.slice(0, 150)}`;
      }
      return { success: false, latencyMs, latency_ms: latencyMs, error: errMsg };
    }

    const data = await response.json();
    return { success: true, storeInfo: data, store_profile: data, latencyMs, latency_ms: latencyMs };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, latencyMs, latency_ms: latencyMs, error: `Connection failed: ${msg}` };
  }
}

/**
 * Starts a Custom Store synchronization job for n8n orchestration or direct sync.
 */
export async function startCustomStoreSyncJob(
  tenantId: string,
  connectionId?: string
): Promise<{
  job: CustomStoreSyncJob;
  connection: CustomStoreConnectionRecord;
  maxPagesPerRun: number;
  pageSize: number;
}> {
  const conn = await getCustomStoreConnection(tenantId, connectionId);
  if (!conn || !conn.is_connected) {
    throw new Error('Active custom store connection not found for this tenant.');
  }

  const jobId = `csync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const syncTypes = ['store', 'products', 'orders'];

  const rows = await query<CustomStoreSyncJob>(
    `INSERT INTO iao.custom_store_sync_jobs (
      id, tenant_id, connection_id, status, sync_types, progress, summary, error_details, created_at, updated_at
    ) VALUES ($1, $2, $3, 'running', $4, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, NOW(), NOW())
    RETURNING *;`,
    [jobId, tenantId, conn.id, syncTypes]
  );

  await query(
    `UPDATE iao.custom_store_connections
     SET sync_status = 'syncing', updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2;`,
    [tenantId, conn.id]
  );

  await query(
    `INSERT INTO iao.audit (tenant_id, event, details, created_at)
     VALUES ($1, 'custom_store_sync_started', $2::jsonb, NOW());`,
    [tenantId, JSON.stringify({ job_id: jobId, connection_id: conn.id })]
  );

  return {
    job: rows[0],
    connection: conn,
    maxPagesPerRun: 5,
    pageSize: 50,
  };
}

/**
 * Fetches a page of data from the custom store with protected credentials and SSRF safety.
 */
export async function fetchCustomStorePage(params: {
  jobId: string;
  resourceType: 'store' | 'products' | 'orders';
  page?: number;
  limit?: number;
  since?: string;
}): Promise<{
  data: any;
  statusCode: number;
  tenantId?: string;
  connectionId?: string;
  summary?: any;
}> {
  const { jobId, resourceType, page = 1, limit = 50, since } = params;

  const jobRows = await query<CustomStoreSyncJob>(
    `SELECT * FROM iao.custom_store_sync_jobs WHERE id = $1 LIMIT 1;`,
    [jobId]
  );
  if (jobRows.length === 0) {
    throw new Error(`Sync job ${jobId} not found`);
  }
  const job = jobRows[0];

  const conn = await getCustomStoreConnection(job.tenant_id, job.connection_id);
  if (!conn || !conn.is_connected) {
    throw new Error('Connection is inactive or disconnected.');
  }

  let endpoint = buildCustomStoreResourceUrl(conn.api_base_url, resourceType);
  const queryParams = new URLSearchParams();
  if (resourceType !== 'store') {
    queryParams.set('page', String(page));
    queryParams.set('limit', String(limit));
    if (since) queryParams.set('since', since);
    endpoint += `?${queryParams.toString()}`;
  }

  const authHeaders = buildAuthHeaders(conn);

  const response = await safeFetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...authHeaders,
    },
  }, { timeoutMs: 15000 });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Custom store API error on ${resourceType}: HTTP ${response.status} - ${body.slice(0, 200)}`);
  }

  const json = await response.json();
  return {
    data: json,
    statusCode: response.status,
    tenantId: job.tenant_id,
    connectionId: job.connection_id,
    summary: job.summary,
  };
}

/**
 * Ingests and persists a validated batch of products or orders from Custom Store.
 * Reconciles Order Issues for order updates and enforces exact money values.
 */
export async function ingestCustomStoreBatch(params: {
  jobId: string;
  resourceType: 'store' | 'products' | 'orders';
  items?: any[];
  storeInfo?: any;
  page?: number;
}): Promise<{
  success: boolean;
  processedCount: number;
  errorCount: number;
  errors: Array<{ item_id?: string; message: string }>;
  summary?: any;
  tenantId?: string;
  connectionId?: string;
}> {
  const { jobId, resourceType, items = [], storeInfo, page = 1 } = params;

  const jobRows = await query<CustomStoreSyncJob>(
    `SELECT * FROM iao.custom_store_sync_jobs WHERE id = $1 LIMIT 1;`,
    [jobId]
  );
  if (jobRows.length === 0) {
    throw new Error(`Sync job ${jobId} not found`);
  }
  const job = jobRows[0];
  const { tenant_id: tenantId, connection_id: connectionId } = job;

  let processedCount = 0;
  const errors: Array<{ item_id?: string; message: string }> = [];

  // 1. Store profile ingestion
  if (resourceType === 'store' && storeInfo) {
    await query(
      `UPDATE iao.custom_store_connections
       SET store_info = $3::jsonb, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2;`,
      [tenantId, connectionId, JSON.stringify(storeInfo)]
    );
    return { success: true, processedCount: 1, errorCount: 0, errors: [] };
  }

  // 2. Products ingestion
  if (resourceType === 'products') {
    for (const prod of items) {
      try {
        const extProdId = String(prod.id || prod.product_id || '').trim();
        if (!extProdId) {
          throw new Error('Product is missing required stable external ID.');
        }
        if (!prod.title || !prod.title.trim()) {
          throw new Error(`Product ${extProdId} is missing title.`);
        }

        // Validate variants and decimal pricing
        let rawVariants = Array.isArray(prod.variants) && prod.variants.length > 0 ? prod.variants : [];
        if (rawVariants.length === 0) {
          if (prod.price !== undefined && prod.price !== null) {
            const priceNum = parseFloat(prod.price);
            if (isNaN(priceNum) || priceNum < 0) {
              throw new Error(`Product ${extProdId} has invalid decimal price: ${prod.price}`);
            }
            if (!prod.currency || !String(prod.currency).trim()) {
              throw new Error(`Product ${extProdId} is missing currency. Inferred currency is forbidden.`);
            }
            rawVariants = [
              {
                id: 'default',
                title: 'Default Title',
                price: priceNum.toFixed(2),
                currency: String(prod.currency).trim().toUpperCase(),
                available: prod.available !== false,
              },
            ];
          } else {
            throw new Error(`Product ${extProdId} must have either valid variants or top-level price and currency.`);
          }
        }

        const validatedVariants = rawVariants.map((v: any) => {
          const priceNum = parseFloat(v.price);
          if (isNaN(priceNum) || priceNum < 0) {
            throw new Error(`Variant ${v.id || v.title} has invalid decimal price: ${v.price}`);
          }
          if (!v.currency || !String(v.currency).trim()) {
            throw new Error(`Variant ${v.id || v.title} is missing currency.`);
          }
          return {
            id: String(v.id || 'default'),
            title: v.title || 'Default Title',
            sku: v.sku || '',
            price: priceNum.toFixed(2),
            compare_at_price: v.compare_at_price ? parseFloat(v.compare_at_price).toFixed(2) : null,
            currency: String(v.currency).trim().toUpperCase(),
            inventory_quantity: typeof v.inventory_quantity === 'number' ? v.inventory_quantity : 0,
            available: v.available !== false,
          };
        });

        await query(
          `INSERT INTO iao.custom_store_products (
            tenant_id, connection_id, external_product_id, title, handle,
            product_type, vendor, status, variants, options, raw_data,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, NOW(), NOW())
          ON CONFLICT (tenant_id, connection_id, external_product_id) DO UPDATE SET
            title = EXCLUDED.title,
            handle = EXCLUDED.handle,
            product_type = EXCLUDED.product_type,
            vendor = EXCLUDED.vendor,
            status = EXCLUDED.status,
            variants = EXCLUDED.variants,
            options = EXCLUDED.options,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW();`,
          [
            tenantId,
            connectionId,
            extProdId,
            prod.title.trim(),
            prod.handle || null,
            prod.product_type || null,
            prod.vendor || null,
            prod.status || 'active',
            JSON.stringify(validatedVariants),
            JSON.stringify(prod.options || []),
            JSON.stringify(prod),
          ]
        );
        processedCount++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ item_id: prod?.id, message: msg });
      }
    }
  }

  // 3. Orders ingestion (Composite identity & collision prevention)
  if (resourceType === 'orders') {
    for (const ord of items) {
      try {
        const extOrderId = String(ord.id || ord.order_id || '').trim();
        if (!extOrderId) {
          throw new Error('Order is missing required stable external ID.');
        }

        const displayOrderNumber = String(ord.order_number || ord.number || extOrderId).trim();
        const customerEmail = ord.customer?.email || ord.customer_email || ord.email || null;
        const customerName = ord.customer
          ? `${ord.customer.first_name || ''} ${ord.customer.last_name || ''}`.trim() || ord.customer.name
          : ord.shipping_address?.name || null;

        // Decimal money validation
        const totalNum = parseFloat(ord.total_amount ?? ord.total ?? ord.total_price);
        if (isNaN(totalNum) || totalNum < 0) {
          throw new Error(`Order ${extOrderId} has invalid total_amount: ${ord.total_amount}`);
        }
        const currency = String(ord.currency || '').trim().toUpperCase();
        if (!currency) {
          throw new Error(`Order ${extOrderId} is missing explicit currency. Currency inference is forbidden.`);
        }

        const refundableBalance = ord.refundable_balance !== undefined && ord.refundable_balance !== null
          ? parseFloat(ord.refundable_balance)
          : null;

        const totalRefunded = ord.total_refunded !== undefined && ord.total_refunded !== null
          ? parseFloat(ord.total_refunded)
          : 0;

        // Composite primary key in iao.orders: custom:{connection_id}:{external_order_id}
        // This strictly prevents collisions between Shopify #1001 and Custom Store #1001!
        const compositeOrderId = `custom:${connectionId}:${extOrderId}`;

        const fulfillments = Array.isArray(ord.fulfillments) ? ord.fulfillments : [];
        const trackingNumber = fulfillments[0]?.tracking_number || ord.tracking_number || null;
        const carrier = fulfillments[0]?.tracking_company || ord.carrier || null;

        const lineItems = (ord.line_items || ord.items || []).map((li: any) => ({
          name: li.title || li.name || 'Custom Product',
          title: li.title || li.name || 'Custom Product',
          sku: li.sku || '',
          qty: li.quantity || li.qty || 1,
          quantity: li.quantity || li.qty || 1,
          price: parseFloat(li.price || 0),
          currency,
          variant: li.variant_title || li.variant || '',
        }));

        const fullData = {
          source: 'custom_store',
          provider: 'custom',
          connection_id: connectionId,
          external_order_id: extOrderId,
          order_number: displayOrderNumber,
          customer_email: customerEmail,
          customer_name: customerName,
          tracking_number: trackingNumber,
          carrier,
          fulfillment_status: ord.fulfillment_status || 'unfulfilled',
          financial_status: ord.financial_status || 'paid',
          refundable_balance: refundableBalance,
          total_refunded: totalRefunded,
          raw_custom_order: ord,
          updated_at_custom: ord.updated_at || new Date().toISOString(),
        };

        // Out-of-order protection: Check if existing record is newer
        const existingOrderRows = await query<OrderRecord>(
          `SELECT * FROM iao.orders WHERE tenant_id = $1 AND order_id = $2 LIMIT 1;`,
          [tenantId, compositeOrderId]
        );
        if (existingOrderRows.length > 0) {
          const prev = existingOrderRows[0];
          const prevRaw = (prev.data as Record<string, unknown> | undefined)?.updated_at_custom as string | undefined;
          const prevUpdated = new Date(prevRaw || prev.updated_at || 0).getTime();
          const incomingUpdated = new Date(ord.updated_at || 0).getTime();
          if (incomingUpdated > 0 && incomingUpdated < prevUpdated) {
            // Stale update: skip overwriting newer evidence
            processedCount++;
            continue;
          }
        }

        await query(
          `INSERT INTO iao.orders (
            tenant_id, order_id, customer_name, customer_email, items,
            total, currency, status, data, connection_id, provider,
            external_order_id, order_number, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10, 'custom', $11, $12, NOW(), NOW())
          ON CONFLICT (tenant_id, order_id) DO UPDATE SET
            customer_name = EXCLUDED.customer_name,
            customer_email = EXCLUDED.customer_email,
            items = EXCLUDED.items,
            total = EXCLUDED.total,
            currency = EXCLUDED.currency,
            status = EXCLUDED.status,
            data = EXCLUDED.data,
            connection_id = EXCLUDED.connection_id,
            provider = 'custom',
            external_order_id = EXCLUDED.external_order_id,
            order_number = EXCLUDED.order_number,
            updated_at = NOW();`,
          [
            tenantId,
            compositeOrderId,
            customerName,
            customerEmail,
            JSON.stringify(lineItems),
            totalNum,
            currency,
            ord.fulfillment_status || ord.status || 'processing',
            JSON.stringify(fullData),
            connectionId,
            extOrderId,
            displayOrderNumber,
          ]
        );

        processedCount++;

        // Trigger Order Issue Reconciliation for this updated custom store order
        try {
          await reconcileShopifyOrderUpdate(tenantId, {
            id: extOrderId,
            name: displayOrderNumber,
            order_id: compositeOrderId,
            order_number: displayOrderNumber,
            fulfillment_status: ord.fulfillment_status,
            fulfillments: fulfillments.map((f: any) => ({
              tracking_number: f.tracking_number,
              tracking_company: f.tracking_company,
              status: f.status,
            })),
            updated_at: ord.updated_at || new Date().toISOString(),
          }, { source: 'custom_store_sync', provider: 'custom_store', connectionId });
        } catch (recErr) {
          console.warn('[Custom Store Reconciliation Warning]', recErr instanceof Error ? recErr.message : recErr);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ item_id: ord?.id, message: msg });
      }
    }
  }

  // Update sync job progress
  const existingJob = jobRows[0];
  const currentSummary = existingJob.summary || {};
  const currentErrors = existingJob.error_details || [];

  const updatedSummary = {
    ...currentSummary,
    [`${resourceType}_synced`]: ((currentSummary[`${resourceType}_synced`] as number) || 0) + processedCount,
  };
  const updatedErrors = [
    ...currentErrors,
    ...errors.map((e) => ({
      item_id: e.item_id,
      stage: resourceType,
      message: e.message,
      timestamp: new Date().toISOString(),
    })),
  ];

  await query(
    `UPDATE iao.custom_store_sync_jobs
     SET summary = $2::jsonb, error_details = $3::jsonb, updated_at = NOW()
     WHERE id = $1;`,
    [jobId, JSON.stringify(updatedSummary), JSON.stringify(updatedErrors)]
  );

  return {
    success: errors.length === 0,
    processedCount,
    errorCount: errors.length,
    errors,
    summary: updatedSummary,
    tenantId,
    connectionId,
  };
}

/**
 * Finalizes a Custom Store synchronization job.
 * Supports both object signature ({ jobId, status, summary, errorDetails }) and positional signature (tenantId, jobId, status, summary).
 */
export async function finishCustomStoreSyncJob(
  paramsOrTenantId: {
    jobId: string;
    status: 'completed' | 'partial_failed' | 'failed';
    summary?: Record<string, unknown>;
    errorDetails?: any[];
    checkpoint?: Record<string, unknown>;
  } | string,
  argJobId?: string,
  argStatus?: 'completed' | 'partial_failed' | 'failed',
  argSummary?: any
): Promise<CustomStoreSyncJob> {
  let jobId: string;
  let status: 'completed' | 'partial_failed' | 'failed';
  let summary: Record<string, unknown> = {};
  let errorDetails: any[] = [];
  let checkpoint: Record<string, unknown> | null = null;

  if (typeof paramsOrTenantId === 'object' && paramsOrTenantId !== null) {
    jobId = paramsOrTenantId.jobId;
    status = paramsOrTenantId.status;
    summary = paramsOrTenantId.summary || {};
    errorDetails = paramsOrTenantId.errorDetails || [];
    checkpoint = paramsOrTenantId.checkpoint || ((paramsOrTenantId.summary as Record<string, unknown>)?.checkpoint as Record<string, unknown>) || null;
  } else {
    jobId = argJobId!;
    status = argStatus || 'completed';
    if (typeof argSummary === 'string') {
      summary = { note: argSummary };
      if (status === 'partial_failed' || status === 'failed') {
        errorDetails = [{ message: argSummary }];
      }
    } else if (typeof argSummary === 'object' && argSummary !== null) {
      summary = argSummary;
    }
  }

  const jobRows = await query<CustomStoreSyncJob>(
    `SELECT * FROM iao.custom_store_sync_jobs WHERE id = $1 LIMIT 1;`,
    [jobId]
  );
  if (jobRows.length === 0) {
    throw new Error(`Sync job ${jobId} not found`);
  }
  const job = jobRows[0];
  const { tenant_id: tenantId, connection_id: connectionId } = job;

  const mergedSummary = { ...(job.summary || {}), ...summary };
  const mergedErrors = [...(job.error_details || []), ...errorDetails];

  const finalStatus = (mergedErrors.length > 0 && status === 'completed') ? 'partial_failed' : status;

  const updatedJobRows = await query<CustomStoreSyncJob>(
    `UPDATE iao.custom_store_sync_jobs
     SET status = $2, summary = $3::jsonb, error_details = $4::jsonb, updated_at = NOW()
     WHERE id = $1
     RETURNING *;`,
    [jobId, finalStatus, JSON.stringify(mergedSummary), JSON.stringify(mergedErrors)]
  );

  // Update counts on connection record
  const prodCountRows = await query<{ count: string }>(
    `SELECT count(*) as count FROM iao.custom_store_products WHERE tenant_id = $1 AND connection_id = $2;`,
    [tenantId, connectionId]
  );
  const orderCountRows = await query<{ count: string }>(
    `SELECT count(*) as count FROM iao.orders WHERE tenant_id = $1 AND connection_id = $2 AND provider = 'custom';`,
    [tenantId, connectionId]
  );

  const productCount = parseInt(prodCountRows[0]?.count || '0', 10);
  const orderCount = parseInt(orderCountRows[0]?.count || '0', 10);

  const lastError = mergedErrors.length > 0 ? mergedErrors[mergedErrors.length - 1].message : null;

  await query(
    `UPDATE iao.custom_store_connections
     SET sync_status = $3,
         last_synced_at = NOW(),
         last_error = $4,
         product_count = $5,
         order_count = $6,
         updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2;`,
    [tenantId, connectionId, finalStatus, lastError, productCount, orderCount]
  );

  if (checkpoint && typeof checkpoint === 'object') {
    await query(
      `UPDATE iao.custom_store_connections
       SET sync_checkpoint = $3::jsonb, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2;`,
      [tenantId, connectionId, JSON.stringify(checkpoint)]
    );
  }

  await query(
    `INSERT INTO iao.audit (tenant_id, event, details, created_at)
     VALUES ($1, 'custom_store_sync_completed', $2::jsonb, NOW());`,
    [
      tenantId,
      JSON.stringify({
        job_id: jobId,
        connection_id: connectionId,
        status: finalStatus,
        product_count: productCount,
        order_count: orderCount,
        error_count: mergedErrors.length,
      }),
    ]
  );

  // Sync ingested Custom Store products to business knowledge base for AI operator grounding
  if (finalStatus === 'completed' || finalStatus === 'partial_failed') {
    try {
      await syncCustomStoreProductsToKnowledge(tenantId, connectionId);
    } catch (e) {
      console.error('[syncCustomStoreProductsToKnowledge failed]', e);
    }
  }

  return updatedJobRows[0];
}

/**
 * Syncs ingested Custom Store products into business settings knowledge.products_services
 * so the AI Operator can automatically ground product questions in verified store catalog items.
 */
export async function syncCustomStoreProductsToKnowledge(
  tenantId: string,
  connectionId: string
): Promise<void> {
  const products = await query<CustomStoreProductRecord>(
    `SELECT * FROM iao.custom_store_products WHERE tenant_id = $1 AND connection_id = $2 ORDER BY created_at ASC;`,
    [tenantId, connectionId]
  );

  if (products.length === 0) return;

  const mappedItems: ProductServiceItem[] = [];
  for (const p of products) {
    const variants = (p.variants || []) as any[];
    if (variants.length > 0) {
      for (const v of variants) {
        mappedItems.push({
          id: `cs-${p.external_product_id}-${v.id || 'def'}`,
          name: variants.length > 1 && v.title && v.title !== 'Default Title' ? `${p.title} (${v.title})` : p.title,
          sku: v.sku || `SKU-${p.external_product_id}`,
          price: parseFloat(v.price || 0),
          currency: v.currency || 'EUR',
          description: p.title,
          in_stock: v.available !== false,
          stock_quantity: typeof v.inventory_quantity === 'number' ? v.inventory_quantity : 1,
          is_active: p.status === 'active',
        });
      }
    } else {
      mappedItems.push({
        id: `cs-${p.external_product_id}`,
        name: p.title,
        sku: `SKU-${p.external_product_id}`,
        price: 0,
        currency: 'EUR',
        description: p.title,
        in_stock: true,
        stock_quantity: 1,
        is_active: p.status === 'active',
      });
    }
  }

  const business = await getBusiness(tenantId);
  if (business && mappedItems.length > 0) {
    const existingFaqs = business.settings.knowledge?.faqs || [];
    const existingPolicies = business.settings.knowledge?.policies || {};

    const currentItems = business.settings.knowledge?.products_services || [];
    // Keep items from other sources (e.g. Shopify sp- items or other connections)
    const preservedItems = currentItems.filter(
      (item) => !item.id.startsWith(`cs-${connectionId}-`) && !mappedItems.some((m) => m.name.toLowerCase() === item.name.toLowerCase())
    );
    const combinedProducts = [...mappedItems, ...preservedItems];

    const updatedSettings: BusinessSettings = {
      ...business.settings,
      knowledge: {
        faqs: existingFaqs,
        products_services: combinedProducts,
        policies: existingPolicies,
      },
    };

    await updateBusinessSettings(tenantId, updatedSettings);
  }
}

/**
 * Timing-safe HMAC-SHA256 signature verification for inbound custom store webhooks.
 * Validates timestamp freshness (replay attack prevention: 5-minute tolerance).
 */
export function verifyCustomStoreWebhookSignature(params: {
  rawBody: string;
  signatureHeader: string;
  timestampHeader?: string;
  secret: string;
}): { isValid: boolean; error?: string } {
  const { rawBody, signatureHeader, timestampHeader, secret } = params;

  if (!signatureHeader || !secret) {
    return { isValid: false, error: 'Missing signature header or secret.' };
  }

  // 1. Replay protection: Check timestamp freshness within 300 seconds (5 minutes)
  if (timestampHeader) {
    let reqTimestamp = Number(timestampHeader);
    if (isNaN(reqTimestamp)) {
      reqTimestamp = new Date(timestampHeader).getTime();
    }
    if (reqTimestamp < 10000000000) {
      // In seconds, convert to ms
      reqTimestamp *= 1000;
    }

    const now = Date.now();
    const toleranceMs = 5 * 60 * 1000; // 5 minutes
    if (Math.abs(now - reqTimestamp) > toleranceMs) {
      return { isValid: false, error: `Webhook timestamp expired or outside tolerance window (replay protection).` };
    }
  }

  // 2. Compute expected HMAC-SHA256 signature
  const cleanSignature = signatureHeader.replace(/^sha256=/i, '').trim();
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody, 'utf8');
  const expectedHex = hmac.digest('hex');

  const sigBuf = Buffer.from(cleanSignature, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  if (sigBuf.length !== expectedBuf.length) {
    return { isValid: false, error: 'Signature length mismatch.' };
  }

  const isMatch = crypto.timingSafeEqual(sigBuf, expectedBuf);
  if (!isMatch) {
    return { isValid: false, error: 'Signature mismatch.' };
  }

  return { isValid: true };
}

/**
 * Ingests an authenticated webhook event from Custom Store with deduplication and out-of-order protection.
 */
export async function ingestCustomStoreWebhook(params: {
  tenantId: string;
  connectionId: string;
  eventId: string;
  topic: string;
  payload: any;
}): Promise<{ status: 'processed' | 'already_processed' | 'rejected'; details?: string }> {
  const { tenantId, connectionId, eventId, topic, payload } = params;

  if (!eventId) {
    throw new Error('Missing event_id in webhook.');
  }

  // 1. Event deduplication check
  const existingEventRows = await query(
    `SELECT * FROM iao.webhook_events WHERE event_id = $1 LIMIT 1;`,
    [eventId]
  );
  if (existingEventRows.length > 0) {
    return { status: 'already_processed', details: `Event ${eventId} has already been ingested.` };
  }

  // Record in webhook_events
  const eventRowId = `cs_evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await query(
    `INSERT INTO iao.webhook_events (id, provider, event_id, event_type, payload, status, created_at)
     VALUES ($1, 'custom_store', $2, $3, $4::jsonb, 'processed', NOW())
     ON CONFLICT (event_id) DO NOTHING;`,
    [eventRowId, eventId, topic, JSON.stringify(payload)]
  );

  // 2. Process order events
  if (topic.startsWith('order.')) {
    const ord = payload.order || payload;
    const extOrderId = String(ord.external_order_id || ord.id || ord.order_id || '').trim();
    if (!extOrderId) {
      return { status: 'rejected', details: 'Order event missing order ID' };
    }

    const displayOrderNumber = String(ord.order_number || ord.number || extOrderId).trim();
    const compositeOrderId = `custom:${connectionId}:${extOrderId}`;
    const fulfillments = Array.isArray(ord.fulfillments) ? ord.fulfillments : [];
    const trackingNumber = fulfillments[0]?.tracking_number || ord.tracking_number || null;
    const carrier = fulfillments[0]?.tracking_company || ord.carrier || null;

    const totalRaw = ord.total_amount ?? ord.total ?? ord.total_price;
    const totalNum = totalRaw !== undefined && totalRaw !== null ? parseFloat(totalRaw) : null;
    const currency = ord.currency ? String(ord.currency).trim().toUpperCase() : null;

    const fullData: Record<string, any> = {
      source: 'custom_store',
      provider: 'custom',
      connection_id: connectionId,
      external_order_id: extOrderId,
      order_number: displayOrderNumber,
      updated_at_custom: ord.updated_at || new Date().toISOString(),
      raw_custom_order: ord,
    };

    if (ord.customer?.email || ord.customer_email) fullData.customer_email = ord.customer?.email || ord.customer_email;
    if (ord.customer?.name || ord.customer_name) fullData.customer_name = ord.customer?.name || ord.customer_name;
    if (trackingNumber) fullData.tracking_number = trackingNumber;
    if (carrier) fullData.carrier = carrier;
    if (ord.fulfillment_status) fullData.fulfillment_status = ord.fulfillment_status;
    if (ord.refundable_balance !== undefined && ord.refundable_balance !== null) {
      fullData.refundable_balance = parseFloat(ord.refundable_balance);
    }
    if (ord.total_refunded !== undefined && ord.total_refunded !== null) {
      fullData.total_refunded = parseFloat(ord.total_refunded);
    }

    // Out-of-order check
    const existingOrderRows = await query<OrderRecord>(
      `SELECT * FROM iao.orders WHERE tenant_id = $1 AND order_id = $2 LIMIT 1;`,
      [tenantId, compositeOrderId]
    );
    if (existingOrderRows.length > 0) {
      const prev = existingOrderRows[0];
      const prevRaw = (prev.data as Record<string, unknown> | undefined)?.updated_at_custom as string | undefined;
      const prevUpdated = new Date(prevRaw || prev.updated_at || 0).getTime();
      const incomingUpdated = new Date(ord.updated_at || 0).getTime();
      if (incomingUpdated > 0 && incomingUpdated < prevUpdated) {
        return { status: 'processed', details: 'Older event skipped; newer evidence preserved' };
      }
    }

    await query(
      `INSERT INTO iao.orders (
        tenant_id, order_id, customer_name, customer_email, items,
        total, currency, status, data, connection_id, provider,
        external_order_id, order_number, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10, 'custom', $11, $12, NOW(), NOW())
      ON CONFLICT (tenant_id, order_id) DO UPDATE SET
        customer_name = COALESCE(EXCLUDED.customer_name, iao.orders.customer_name),
        customer_email = COALESCE(EXCLUDED.customer_email, iao.orders.customer_email),
        items = CASE WHEN jsonb_array_length(EXCLUDED.items) > 0 THEN EXCLUDED.items ELSE iao.orders.items END,
        total = CASE WHEN EXCLUDED.total > 0 THEN EXCLUDED.total ELSE iao.orders.total END,
        currency = COALESCE(NULLIF(EXCLUDED.currency, ''), iao.orders.currency),
        status = COALESCE(EXCLUDED.status, iao.orders.status),
        data = iao.orders.data || EXCLUDED.data,
        connection_id = EXCLUDED.connection_id,
        provider = 'custom',
        external_order_id = EXCLUDED.external_order_id,
        order_number = EXCLUDED.order_number,
        updated_at = NOW();`,
      [
        tenantId,
        compositeOrderId,
        ord.customer?.name || ord.customer_name || null,
        ord.customer?.email || ord.customer_email || null,
        JSON.stringify(ord.line_items || ord.items || []),
        totalNum !== null && !isNaN(totalNum) ? totalNum : 0,
        currency || 'USD',
        ord.fulfillment_status || 'processing',
        JSON.stringify(fullData),
        connectionId,
        extOrderId,
        displayOrderNumber,
      ]
    );

    // Reconcile order issues
    await reconcileShopifyOrderUpdate(tenantId, {
      id: extOrderId,
      name: displayOrderNumber,
      order_id: compositeOrderId,
      order_number: displayOrderNumber,
      fulfillment_status: ord.fulfillment_status,
      fulfillments: fulfillments.map((f: any) => ({
        tracking_number: f.tracking_number,
        tracking_company: f.tracking_company,
        status: f.status,
      })),
      updated_at: ord.updated_at || new Date().toISOString(),
    }, { source: 'custom_store_webhook', provider: 'custom_store', connectionId });

    return { status: 'processed' };
  }

  return { status: 'processed' };
}

// Aliases for compatibility
export const saveCustomStoreConnection = createOrUpdateCustomStoreConnection;
export const getCustomStoreConnectionPublic = getCustomStorePublicConfig;
export const disconnectCustomStore = disconnectCustomStoreConnection;

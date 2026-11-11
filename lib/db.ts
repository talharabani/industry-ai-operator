import { Pool, type QueryResultRow } from 'pg';
import { getServerConfig, parseDbConfig } from './config.ts';
import type {
  BusinessRecord,
  BusinessSettings,
  OrderRecord,
  CaseRecord,
  AuditRecord,
  DailySummarySnapshot,
  SummaryStats,
  ConversationRecord,
  MessageRecord,
  ConversationStatus,
  MessageStatus,
  MessageApprovalStatus,
  ConversationChannel,
  MessageSenderType,
  EmailCredentialRecord,
  MessageDispatchRecord,
  WebhookEventRecord,
  EmailConnectionConfig,
  GmailConnectionRecord,
  GmailPublicConfig,
  OAuthStateRecord,
  ShopifyConnectionRecord,
  ShopifyPublicConfig,
  ShopifySyncJob,
  ShopifyProductRecord,
  ShopifyProductVariant,
  ProductServiceItem,
  OrderIssueRecord,
  OrderIssueFollowupJobRecord,
} from './types.ts';
import { encryptSecret, decryptSecret, maskApiKey, computeSha256 } from './crypto.ts';
import { getGoogleOAuthConfig, refreshGoogleAccessToken, sendGmailReply, type ParsedGmailMessage } from './gmail-service.ts';
import { getShopifyOAuthConfig, sanitizeShopDomain } from './shopify-service.ts';
import { evaluateRoutineInquiry, type RoutineEvaluationResult } from './routine-evaluator.ts';
import { validateOutboundDispatch } from './outbound-guard.ts';
import { classifyEmailMessage } from './email-filter.ts';
import {
  detectOrderIssue,
  investigateOrderData,
  buildOrderIssueAcknowledgment,
  createOrderIssue,
  getOrderIssue,
  getOrderIssueByConversation,
  updateOrderIssue,
  addOrderIssueEvent,
  scheduleOrderIssueFollowup,
  cancelPendingFollowupsForIssue,
  reconcileShopifyOrderUpdate,
  reconcileShopifyOrdersBatch,
  cancelFollowupsForTask,
  authorizeOrderIssueAction,
  recordManualActionExecution,
  withTransaction,
} from './order-issues.ts';
import crypto from 'crypto';
import { createOrUpdateServicesLead, cancelServicesLeadFollowup, addServicesLeadEvent } from './services-pack.ts';

export { authorizeOrderIssueAction, recordManualActionExecution, withTransaction };


// Global singleton pool for connection pooling in Next.js
declare global {
  var __pgPool: Pool | undefined;
  var __pgPoolUrl: string | undefined;
}

function getPool(): Pool | null {
  const config = getServerConfig();
  if (!config.isDatabaseConfigured) {
    return null;
  }

  // If connection string changed in .env.local, reset the pool
  if (global.__pgPool && global.__pgPoolUrl !== config.databaseUrl) {
    global.__pgPool.end().catch(() => {});
    global.__pgPool = undefined;
    global.__pgPoolUrl = undefined;
  }

  if (!global.__pgPool) {
    const dbParams = parseDbConfig(config.databaseUrl);
    global.__pgPool = new Pool({
      ...dbParams,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    global.__pgPoolUrl = config.databaseUrl;

    global.__pgPool.on('error', (err) => {
      console.error('[PostgreSQL Pool Error]', err.message);
    });
  }

  return global.__pgPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getPool();
  if (!pool) {
    throw new Error('Database is not configured. Please verify DATABASE_URL in .env.local');
  }

  try {
    const res = await pool.query<T>(text, params);
    return res.rows;
  } catch (err: any) {
    if (
      err?.message?.includes('terminated') ||
      err?.message?.includes('closed') ||
      err?.message?.includes('reset') ||
      err?.code === 'ECONNRESET'
    ) {
      if (global.__pgPool) {
        global.__pgPool.end().catch(() => {});
        global.__pgPool = undefined;
        global.__pgPoolUrl = undefined;
      }
      const freshPool = getPool();
      if (freshPool) {
        const retryRes = await freshPool.query<T>(text, params);
        return retryRes.rows;
      }
    }
    throw err;
  }
}

export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  configured: boolean;
  error?: string;
  tablesFound?: string[];
}> {
  const config = getServerConfig();
  if (!config.isDatabaseConfigured) {
    return {
      connected: false,
      configured: false,
      error: 'DATABASE_URL is not set or contains placeholder REPLACE_ME',
    };
  }

  try {
    const tables = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'iao' ORDER BY table_name;`
    );
    return {
      connected: true,
      configured: true,
      tablesFound: tables.map((t) => t.table_name),
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      configured: true,
      error: errorMsg,
    };
  }
}

export function getDefaultBusinessSettings(
  tenantId: string,
  businessName?: string,
  industry: BusinessSettings['industry'] = 'ecommerce'
): BusinessSettings {
  return {
    industry,
    business_name: businessName || (tenantId === 'demo-store' ? 'Demo Clothing Store' : tenantId.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())),
    country: 'Pakistan',
    timezone: 'Asia/Karachi',
    currency: 'PKR',
    language: 'English',
    tone: 'friendly and concise',
    automation_mode: 'auto_routine',
    working_hours: {
      start_time: '09:00',
      end_time: '18:00',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      auto_reply_outside_hours: true,
    },
    permissions: {
      order_confirmation: 'approval_required',
      delay_notification: 'automatic',
      return_refund: 'approval_required',
      exchange_replacement: 'approval_required',
      supplier_purchase: 'approval_required',
      payment_reversal: 'approval_required',
      policy_modification: 'approval_required',
    },
    team_members: [
      {
        id: 'owner-demo',
        name: 'Store Owner (Demo)',
        email: 'owner@demo-store.com',
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
      {
        id: 'agent-alex',
        name: 'Alex Rivera',
        email: 'alex.r@demo-store.com',
        role: 'member',
        can_approve: false,
        title: 'Support & Fulfillment Specialist',
        created_at: new Date('2026-10-01T00:00:00Z').toISOString(),
      },
    ],
    approver_ids: ['owner-demo', 'admin-sarah'],
    connections: {
      website: {
        type: 'shopify',
        status: 'connected',
        store_url: 'https://demo-clothing-store.myshopify.com',
        hosted_inquiry_enabled: true,
        last_tested: new Date().toISOString(),
        is_verified: true,
      },
      email: {
        mode: 'demo',
        provider: 'resend',
        status: 'demo_simulated',
        sender_email: 'notifications@demo-store.com',
        last_tested: new Date().toISOString(),
        is_verified: false,
      },
      whatsapp: {
        provider: 'meta_cloud',
        status: 'not_implemented',
        phone_number: '+92 300 1234567',
        last_tested: undefined,
        is_verified: false,
      },
    },
    knowledge: {
      faqs: [
        {
          id: 'faq-1',
          question: 'What is your standard return and exchange window?',
          answer: 'Items in original unworn condition with tags attached can be returned within 14 days of confirmed delivery.',
          category: 'Returns',
        },
        {
          id: 'faq-2',
          question: 'How long does nationwide delivery take?',
          answer: 'Standard delivery takes 2 to 4 business days. Expedited dispatch is processed within 24 hours.',
          category: 'Shipping',
        },
        {
          id: 'faq-3',
          question: 'What payment methods do you accept?',
          answer: 'We accept Cash on Delivery (COD), Direct Bank Transfer, Visa/MasterCard, and local mobile wallets.',
          category: 'Payments',
        },
      ],
      products_services: [
        {
          id: 'prod-1',
          name: 'Classic Leather Jacket (M)',
          sku: 'JACKET-M',
          price: 59.99,
          currency: 'USD',
          description: 'Premium faux-leather biker jacket with quilted lining.',
          in_stock: true,
        },
        {
          id: 'prod-2',
          name: 'Oxford Cotton Shirt (L)',
          sku: 'SHIRT-L',
          price: 29.99,
          currency: 'USD',
          description: '100% organic breathable cotton tailored fit shirt.',
          in_stock: true,
        },
      ],
      policies: {
        general_rules: 'All customer service inquiries are evaluated against store operating policies.',
        operating_disclaimer: 'Automated actions operate under strict owner oversight.',
        return_window_days: 14,
        restocking_fee_pct: 0,
        free_return_threshold: 50,
      },
    },
    order_issues_config: {
      followup_interval_hours: 24,
      clarification_delay_minutes: 1440,
      carrier_check_interval_minutes: 360,
      max_followup_attempts: 2,
      auto_escalate_to_owner: true,
      owner_reminder_interval_minutes: 1440,
      auto_close_resolved_days: 7,
    },
    return_window_days: 14,
    refund_requires_approval: true,
    mode: 'demo',
  };
}

export async function getBusiness(tenantId: string): Promise<BusinessRecord | null> {
  try {
    const rows = await query<{
      tenant_id: string;
      public_form_id: string | null;
      settings: any;
      updated_at: string;
    }>(
      `SELECT tenant_id, public_form_id, settings, updated_at FROM iao.businesses WHERE tenant_id = $1 LIMIT 1;`,
      [tenantId]
    );
    if (!rows[0]) return null;

    // Merge stored settings with default template to ensure all tabs have complete data
    const defaults = getDefaultBusinessSettings(tenantId);
    const stored = rows[0].settings || {};
    const mergedSettings: BusinessSettings = {
      ...defaults,
      ...stored,
      public_form_id: rows[0].public_form_id || stored.public_form_id,
      working_hours: { ...defaults.working_hours, ...(stored.working_hours || {}) },
      permissions: { ...defaults.permissions, ...(stored.permissions || {}) },
      connections: { ...defaults.connections, ...(stored.connections || {}) },
      knowledge: {
        ...defaults.knowledge,
        ...(stored.knowledge || {}),
        policies: { ...defaults.knowledge.policies, ...(stored.knowledge?.policies || {}) },
        faqs: stored.knowledge?.faqs || defaults.knowledge.faqs,
        products_services: stored.knowledge?.products_services || defaults.knowledge.products_services,
        services: stored.knowledge?.services || [],
        service_areas: stored.knowledge?.service_areas || [],
        extracted_facts: stored.knowledge?.extracted_facts || [],
      },
      order_issues_config: {
        ...defaults.order_issues_config,
        ...(stored.order_issues_config || {}),
      },
      services_config: stored.services_config || {
        enable_customer_followup: false,
        followup_interval_hours: 24,
        max_followup_attempts: 2,
        auto_escalate_to_owner: true,
        require_quote_approval: true,
      },
      onboarding: stored.onboarding || {
        step: 1,
        completed: false,
        business_type: stored.business_type || (stored.industry as any) || 'ecommerce',
      },
      team_members: stored.team_members || defaults.team_members,
      approver_ids: stored.approver_ids || defaults.approver_ids,
    };

    // If Shopify is connected, resolve store name and currency dynamically unless explicitly overridden
    try {
      const connRows = await query<ShopifyConnectionRecord>(
        `SELECT shop_domain, is_connected, store_info FROM iao.shopify_connections WHERE tenant_id = $1 AND is_connected = true LIMIT 1;`,
        [tenantId]
      );
      if (connRows[0]?.store_info) {
        const storeInfo = (connRows[0].store_info || {}) as Record<string, unknown>;
        const shopName = String(storeInfo.name || '').trim();
        const shopCurrency = String(storeInfo.currency || '').trim();
        const shopTimezone = String(storeInfo.iana_timezone || storeInfo.timezone || '').trim();
        const shopCountry = String(storeInfo.country_name || storeInfo.country || '').trim();

        // Use connected Shopify store name unless merchant explicitly configured a display_name_override
        if (!mergedSettings.display_name_override) {
          if (shopName && (mergedSettings.business_name === 'Demo Clothing Store' || !stored.business_name)) {
            mergedSettings.business_name = shopName;
          }
        }

        // Use connected Shopify store currency if available and settings currency was default/unset
        if (shopCurrency && (!stored.currency || stored.currency === 'PKR')) {
          mergedSettings.currency = shopCurrency;
        }

        if (shopTimezone && (!stored.timezone || stored.timezone === 'Asia/Karachi')) {
          mergedSettings.timezone = shopTimezone;
        }

        if (shopCountry && (!stored.country || stored.country === 'Pakistan')) {
          mergedSettings.country = shopCountry;
        }
      }
    } catch {
      // ignore
    }

    return {
      tenant_id: rows[0].tenant_id,
      public_form_id: rows[0].public_form_id || undefined,
      settings: mergedSettings,
      updated_at: rows[0].updated_at,
    };
  } catch (err) {
    console.error('[getBusiness Error]', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function updateBusinessSettings(
  tenantId: string,
  settings: BusinessSettings
): Promise<BusinessRecord> {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO iao.businesses (tenant_id, settings, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id)
     DO UPDATE SET settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at;`,
    [tenantId, JSON.stringify(settings), now]
  );

  return {
    tenant_id: tenantId,
    settings,
    updated_at: now,
  };
}

export async function listAllBusinesses(): Promise<Array<{ tenant_id: string; business_name: string; industry: string; updated_at: string }>> {
  try {
    const rows = await query<{ tenant_id: string; settings: Record<string, unknown>; updated_at: string }>(
      `SELECT tenant_id, settings, updated_at FROM iao.businesses ORDER BY tenant_id ASC;`
    );
    return rows.map((r) => ({
      tenant_id: r.tenant_id,
      business_name: String(r.settings?.business_name || r.tenant_id),
      industry: String(r.settings?.industry || 'ecommerce'),
      updated_at: r.updated_at,
    }));
  } catch {
    return [];
  }
}

export async function recordAuditLog(
  tenantId: string,
  event: string,
  details: Record<string, unknown>,
  caseId?: string | null
): Promise<void> {
  try {
    await query(
      `INSERT INTO iao.audit (tenant_id, case_id, event, details, created_at)
       VALUES ($1, $2, $3, $4, NOW());`,
      [tenantId, caseId || null, event, JSON.stringify(details)]
    );
  } catch (err) {
    console.error('[recordAuditLog Error]', err instanceof Error ? err.message : err);
  }
}

export const insertAudit = recordAuditLog;


export async function listOrders(tenantId: string): Promise<OrderRecord[]> {
  try {
    const rows = await query<OrderRecord>(
      `SELECT tenant_id, order_id, customer_name, customer_email, items, total, currency, status, data, created_at, updated_at
       FROM iao.orders
       WHERE tenant_id = $1
       ORDER BY updated_at DESC, order_id ASC;`,
      [tenantId]
    );
    return rows;
  } catch (err) {
    console.error('[listOrders Error]', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function getOrder(tenantId: string, orderId: string): Promise<OrderRecord | null> {
  try {
    const rawId = (orderId || '').trim();
    const cleanId = rawId.toUpperCase();
    const unhashedId = cleanId.replace(/^#+/, '');
    const rows = await query<OrderRecord>(
      `SELECT tenant_id, order_id, customer_name, customer_email, items, total, currency, status, data, connection_id, provider, external_order_id, order_number, created_at, updated_at
       FROM iao.orders
       WHERE tenant_id = $1 AND (
         order_id = $2 OR order_id = $3 OR order_id = $4
         OR order_number = $2 OR order_number = $3 OR order_number = $4
         OR external_order_id = $2 OR external_order_id = $3 OR external_order_id = $4
         OR data->>'order_number' = $2 OR data->>'order_number' = $3 OR data->>'order_number' = $4
         OR data->>'external_order_id' = $2 OR data->>'external_order_id' = $3
         OR data->>'shopify_order_id' = $2 OR data->>'shopify_order_id' = $3
       )
       LIMIT 1;`,
      [tenantId, rawId, cleanId, unhashedId]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('[getOrder Error]', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function upsertOrder(
  tenantId: string,
  order: {
    order_id: string;
    customer_name?: string | null;
    customer_email?: string | null;
    items?: any[];
    total?: number;
    currency?: string;
    status?: string;
    data: any;
  }
): Promise<OrderRecord | null> {
  try {
    const cleanId = (order.order_id || '').trim().toUpperCase();
    const custName = order.customer_name || order.data?.customer?.name || null;
    const custEmail = order.customer_email || order.data?.customer?.email || null;
    const itemsJson = JSON.stringify(order.items || order.data?.items || []);
    const totalVal = Number(order.total ?? order.data?.total_amount ?? 0);
    const curr = order.currency || order.data?.currency || 'PKR';
    const statusVal = order.status || order.data?.delivery_status || order.data?.status || 'processing';

    const fullData = {
      ...order.data,
      customer: {
        ...(order.data?.customer || {}),
        name: custName,
        email: custEmail,
      },
      items: order.items || order.data?.items || [],
      total_amount: totalVal,
      currency: curr,
      status: statusVal,
      delivery_status: statusVal,
      is_demo: true,
    };

    const rows = await query<OrderRecord>(
      `INSERT INTO iao.orders
        (tenant_id, order_id, customer_name, customer_email, items, total, currency, status, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, NOW(), NOW())
       ON CONFLICT (tenant_id, order_id)
       DO UPDATE SET
         customer_name = EXCLUDED.customer_name,
         customer_email = EXCLUDED.customer_email,
         items = EXCLUDED.items,
         total = EXCLUDED.total,
         currency = EXCLUDED.currency,
         status = EXCLUDED.status,
         data = EXCLUDED.data,
         updated_at = NOW()
       RETURNING tenant_id, order_id, customer_name, customer_email, items, total, currency, status, data, created_at, updated_at;`,
      [tenantId, cleanId, custName, custEmail, itemsJson, totalVal, curr, statusVal, JSON.stringify(fullData)]
    );

    await recordAuditLog(tenantId, 'demo_order_upserted', {
      order_id: cleanId,
      customer_email: custEmail,
      total: totalVal,
      status: statusVal,
    });

    // Reconcile order issues if order has fulfillment, tracking, or raw Shopify payload
    if (order.data?.source !== 'shopify' && (order.data?.raw_shopify_order || order.data?.fulfillment_status || order.data?.tracking_number)) {
      try {
        await reconcileShopifyOrderUpdate(tenantId, order.data.raw_shopify_order || {
          id: order.data?.shopify_order_id || cleanId,
          name: cleanId,
          fulfillment_status: order.data?.fulfillment_status || order.status,
          fulfillments: order.data?.tracking_number ? [{
            tracking_number: order.data.tracking_number,
            tracking_company: order.data?.carrier,
          }] : [],
          updated_at: new Date().toISOString(),
        }, { source: 'upsert_order' });
      } catch (recErr) {
        console.error('[Reconciliation Error on upsertOrder]', recErr instanceof Error ? recErr.message : recErr);
      }
    }

    return rows[0] || null;
  } catch (err) {
    console.error('[upsertOrder Error]', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function deleteOrder(tenantId: string, orderId: string): Promise<boolean> {
  try {
    const cleanId = (orderId || '').trim().toUpperCase();
    await query(`DELETE FROM iao.orders WHERE tenant_id = $1 AND order_id = $2;`, [tenantId, cleanId]);
    await recordAuditLog(tenantId, 'demo_order_deleted', { order_id: cleanId });
    return true;
  } catch (err) {
    console.error('[deleteOrder Error]', err instanceof Error ? err.message : err);
    return false;
  }
}

function extractOrderIdFromText(text?: string | null): string | null {
  if (!text) return null;
  // 1. Direct match for ORD-1001 or ORDER-1234
  const ordMatch = text.match(/\b(ORD(?:ER)?-\d{3,10})\b/i);
  if (ordMatch) return ordMatch[1].toUpperCase();

  // 2. Match pattern like "order #1001", "order: 1001", "order number is 123321231", "order numberr is 123321231"
  const numMatch = text.match(/\border\s*(?:id|#|number+)?\s*[:#\-]?\s*(?:is\s*)?(\d{3,10})\b/i);
  if (numMatch && numMatch[1]) {
    return `ORD-${numMatch[1]}`;
  }

  // 3. Match explicit alphanumeric order codes like ORD-XYZ
  const alphaMatch = text.match(/\border\s*[:#]\s*([A-Z0-9-]{4,15})\b/i);
  if (alphaMatch && alphaMatch[1]) {
    const val = alphaMatch[1].trim().toUpperCase();
    if (!['REQUEST', 'A', 'FOR', 'MY', 'THE', 'IS', 'AND', 'OR', 'STATUS', 'DETAILS', 'INQUIRY', 'NUMBER', 'NUMBERR'].includes(val)) {
      return val.startsWith('ORD-') ? val : `ORD-${val.replace(/^#/, '')}`;
    }
  }

  return null;
}

/**
 * Automatically ensures all conversations/messages needing owner approval
 * have synchronized entries in iao.cases so that Approvals Queue, Home Dashboard,
 * and Header/Sidebar badge are 100% unified with Inbox drafts.
 */
export async function syncPendingConversationCases(tenantId: string): Promise<void> {
  try {
    const pendingMsgRows = await query<{
      msg_id: string;
      conversation_id: string;
      msg_body: string;
      msg_status: string;
      approval_status: string;
      msg_metadata: any;
      customer_name: string;
      customer_email: string;
      subject: string;
      channel: string;
      last_message_at: string;
      msg_created_at: string;
      customer_msg_body?: string | null;
    }>(
      `SELECT DISTINCT ON (c.id)
        m.id as msg_id,
        m.conversation_id,
        m.body as msg_body,
        m.status as msg_status,
        m.approval_status,
        m.metadata as msg_metadata,
        c.customer_name,
        c.customer_email,
        c.subject,
        c.channel,
        c.last_message_at,
        m.created_at as msg_created_at,
        (
          SELECT cust_m.body 
          FROM iao.messages cust_m 
          WHERE cust_m.conversation_id = c.id AND cust_m.sender_type = 'customer'
          ORDER BY cust_m.created_at DESC 
          LIMIT 1
        ) as customer_msg_body
       FROM iao.messages m
       JOIN iao.conversations c ON m.conversation_id = c.id
       WHERE m.tenant_id = $1 
         AND m.approval_status = 'pending_approval'
         AND m.status = 'draft'
       ORDER BY c.id, m.created_at DESC;`,
      [tenantId]
    );

    for (const item of pendingMsgRows) {
      const cleanConvSuffix = item.conversation_id.replace(/^(case-|conv-)+/, '');
      const caseId = `case-${cleanConvSuffix}`;
      
      const searchPool = `${item.subject || ''} ${item.customer_msg_body || ''} ${item.msg_body || ''} ${item.msg_metadata?.routine_intent || ''} ${item.msg_metadata?.requires_approval_reason || ''}`.toLowerCase();
      let kind: CaseRecord['kind'] = 'return';
      if (searchPool.includes('refund') || searchPool.includes('return') || searchPool.includes('exchange') || searchPool.includes('swap')) {
        kind = 'return';
      } else if (searchPool.includes('stock') || searchPool.includes('inventory')) {
        kind = 'stock';
      } else if (searchPool.includes('delivery') || searchPool.includes('shipping') || searchPool.includes('courier')) {
        kind = 'delivery';
      } else if (searchPool.includes('order') || searchPool.includes('ord-') || searchPool.includes('cancel')) {
        kind = 'order';
      }

      const orderId =
        extractOrderIdFromText(item.customer_msg_body) ||
        extractOrderIdFromText(item.subject) ||
        extractOrderIdFromText(item.msg_body) ||
        item.msg_metadata?.order_id ||
        null;

      const isFinancial = Boolean(
        item.msg_metadata?.financial_action ||
        searchPool.includes('refund') ||
        searchPool.includes('money back') ||
        searchPool.includes('reimburse') ||
        searchPool.includes('exchange')
      );

      const summary =
        item.msg_metadata?.requires_approval_reason ||
        (isFinancial
          ? `Customer ${item.customer_name || 'Customer'} requested a Refund / Reimbursement${orderId ? ' for ' + orderId : ''}. Multi-business governance requires owner authorization.`
          : item.msg_metadata?.reason ||
            `Customer inquiry from ${item.customer_name || 'Customer'}: "${item.subject || 'Request'}"`);

      const action = isFinancial
        ? 'Authorize Refund / Financial Action'
        : 'Review & Authorize Reply Draft';

      const draftRev = (item.msg_metadata?.draft_revision as number) || 1;
      const caseTimestamp = item.msg_created_at || item.last_message_at || new Date().toISOString();

      await query(
        `INSERT INTO iao.cases
          (tenant_id, case_id, kind, status, payload, proposal, revision, created_at, updated_at)
         VALUES ($1, $2, $3, 'pending_approval', $4::jsonb, $5::jsonb, $6, $7, $7)
         ON CONFLICT (case_id)
         DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           kind = EXCLUDED.kind,
           payload = EXCLUDED.payload,
           proposal = EXCLUDED.proposal,
           revision = EXCLUDED.revision,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at
         WHERE iao.cases.status = 'pending_approval';`,
        [
          tenantId,
          caseId,
          kind,
          JSON.stringify({
            conversation_id: item.conversation_id,
            message_id: item.msg_id,
            customer_name: item.customer_name,
            customer_email: item.customer_email,
            subject: item.subject,
            customer_message: item.customer_msg_body || item.msg_body,
            order_id: orderId,
            channel: item.channel || 'gmail',
          }),
          JSON.stringify({
            summary,
            action,
            message: item.msg_body,
            proposed_reply: item.msg_body,
            customer_name: item.customer_name,
            customer_email: item.customer_email,
            subject: item.subject,
            order_id: orderId,
            amount: isFinancial && orderId === 'ORD-1001' ? 14999 : undefined,
            currency: 'PKR',
          }),
          draftRev,
          caseTimestamp,
        ]
      );
    }

    // Clean up any double-prefixed 'case-conv-conv-' rows if previously inserted
    await query(`DELETE FROM iao.cases WHERE case_id LIKE 'case-conv-conv-%';`);
  } catch (err) {
    console.error('[syncPendingConversationCases error]', err);
  }
}

export async function listCases(
  tenantId: string,
  options: {
    kind?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ cases: CaseRecord[]; total: number }> {
  try {
    // Keep cases synchronized with pending conversation drafts
    await syncPendingConversationCases(tenantId);

    const { kind, status, search, limit = 20, offset = 0 } = options;
    const conditions: string[] = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    let paramIndex = 2;

    if (kind && kind !== 'all') {
      conditions.push(`kind = $${paramIndex}`);
      params.push(kind);
      paramIndex++;
    }

    if (status && status !== 'all') {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      conditions.push(
        `(case_id ILIKE $${paramIndex} OR (payload->>'order_id') ILIKE $${paramIndex} OR (proposal->>'summary') ILIKE $${paramIndex})`
      );
      params.push(searchTerm);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Total count
    const countRows = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM iao.cases WHERE ${whereClause};`,
      params
    );
    const total = parseInt(countRows[0]?.count || '0', 10);

    // Paginated records - NEWEST FIRST
    const paginatedParams = [...params, limit, offset];
    const dataRows = await query<CaseRecord>(
      `SELECT tenant_id, case_id, COALESCE(payload->>'request_id', 'req-' || case_id) as request_id, kind, status, payload, proposal, revision, created_at, updated_at
       FROM iao.cases
       WHERE ${whereClause}
       ORDER BY created_at DESC, updated_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1};`,
      paginatedParams
    );

    return { cases: dataRows, total };
  } catch (err) {
    console.error('[listCases Error]', err instanceof Error ? err.message : err);
    return { cases: [], total: 0 };
  }
}

export async function getCase(tenantId: string, caseId: string): Promise<CaseRecord | null> {
  try {
    // Sync to ensure case exists if newly created
    await syncPendingConversationCases(tenantId);

    const cleanSuffix = caseId.replace(/^(case-|conv-)+/, '');
    const rows = await query<CaseRecord>(
      `SELECT tenant_id, case_id, COALESCE(payload->>'request_id', 'req-' || case_id) as request_id, kind, status, payload, proposal, revision, created_at, updated_at
       FROM iao.cases
       WHERE tenant_id = $1 AND (case_id = $2 OR case_id = $3 OR payload->>'conversation_id' = $2 OR payload->>'conversation_id' = $4)
       LIMIT 1;`,
      [tenantId, caseId, `case-${cleanSuffix}`, `conv-${cleanSuffix}`]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('[getCase Error]', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function decideCaseInDB(params: {
  tenantId: string;
  caseId: string;
  decision: 'approve' | 'reject';
  approverId: string;
  expectedRevision: number;
  approvedProposal?: Record<string, unknown>;
}): Promise<{ success: boolean; case: CaseRecord; message?: MessageRecord | null }> {
  const { tenantId, caseId, decision, approverId, expectedRevision, approvedProposal } = params;

  return await withTransaction(async (client) => {
    // 1. Atomically lock case record
    const cleanSuffix = caseId.replace(/^case-/, '').replace(/^conv-/, '');
    const caseRes = await client.query(
      `SELECT * FROM iao.cases 
       WHERE tenant_id = $1 AND (case_id = $2 OR case_id = $3 OR payload->>'conversation_id' = $2 OR payload->>'conversation_id' = $4)
       FOR UPDATE;`,
      [tenantId, caseId, `case-${cleanSuffix}`, `conv-${cleanSuffix}`]
    );

    if (caseRes.rows.length === 0) {
      throw new Error(`Case ${caseId} not found`);
    }
    const currentCase: CaseRecord = caseRes.rows[0];

    // Idempotency: repeated clicks or retries with same decision return existing state
    const nextStatus: CaseRecord['status'] = decision === 'approve' ? 'approved' : 'rejected';
    if (currentCase.status === nextStatus) {
      return { success: true, case: currentCase, message: null };
    }

    // Proposal revision conflict check
    if (expectedRevision !== undefined && currentCase.revision !== expectedRevision) {
      const conflictErr: any = new Error(
        `Proposal revision mismatch. Expected ${expectedRevision}, got ${currentCase.revision}.`
      );
      conflictErr.status = 409;
      conflictErr.current_revision = currentCase.revision;
      throw conflictErr;
    }

    // 2. Order Issue Resolution Lifecycle Hook for Approvals
    const conversationId = (currentCase.payload?.conversation_id as string) || currentCase.case_id.replace(/^case-/, 'conv-');
    const messageId = currentCase.payload?.message_id as string | undefined;

    const issueId = (currentCase.payload?.issue_id as string) || (currentCase.proposal as any)?.issue_id;
    let targetIssue: OrderIssueRecord | null = null;
    if (issueId) {
      const issueRes = await client.query(
        `SELECT * FROM iao.order_issues WHERE tenant_id = $1 AND id = $2 FOR UPDATE;`,
        [tenantId, issueId]
      );
      if (issueRes.rows.length > 0) targetIssue = issueRes.rows[0];
    }
    if (!targetIssue && conversationId) {
      const convIssueRes = await client.query(
        `SELECT oi.* FROM iao.order_issues oi
         WHERE oi.tenant_id = $1 AND oi.conversation_id = $2
         ORDER BY oi.created_at DESC LIMIT 1 FOR UPDATE;`,
        [tenantId, conversationId]
      );
      if (convIssueRes.rows.length > 0) targetIssue = convIssueRes.rows[0];
    }
    if (!targetIssue) {
      const rawOrderRef =
        (currentCase.payload?.order_id as string) ||
        (currentCase.payload?.orderId as string) ||
        ((currentCase.proposal as any)?.order_id as string);

      if (rawOrderRef && rawOrderRef.trim()) {
        const cleanOrderRef = rawOrderRef.trim();
        const unhashedRef = cleanOrderRef.replace(/^#/, '');

        // Gap 1: Match tenant + store connection + stable external order ID
        let targetShopDomain: string | null =
          (currentCase.payload?.shop_domain as string) ||
          (currentCase.payload?.store_domain as string) ||
          null;

        if (!targetShopDomain) {
          const shopConnRes = await client.query(
            `SELECT shop_domain FROM iao.shopify_connections WHERE tenant_id = $1 AND is_connected = true LIMIT 1;`,
            [tenantId]
          );
          if (shopConnRes.rows.length > 0 && shopConnRes.rows[0].shop_domain) {
            targetShopDomain = shopConnRes.rows[0].shop_domain;
          }
        }

        const matchingRes = await client.query(
          `SELECT oi.* 
           FROM iao.order_issues oi
           WHERE oi.tenant_id = $1 
             AND (oi.order_id = $2 OR oi.order_id = $3)
             AND ($4::text IS NULL OR oi.shop_domain IS NULL OR oi.shop_domain = $4)
             AND oi.status NOT IN ('resolved', 'closed')
           FOR UPDATE;`,
          [tenantId, cleanOrderRef, unhashedRef, targetShopDomain]
        );
        const matchingIssues: OrderIssueRecord[] = matchingRes.rows;

        if (matchingIssues.length > 1) {
          // Gap 1: Ambiguous matches must be rejected!
          throw new Error(
            `Ambiguous order match rejected: Found ${matchingIssues.length} active order issues for order '${cleanOrderRef}' on store '${targetShopDomain || 'default'}'. Explicit issue linkage is required.`
          );
        } else if (matchingIssues.length === 1) {
          targetIssue = matchingIssues[0];
        }
      }
    }

    if (targetIssue && targetIssue.status !== 'resolved' && targetIssue.status !== 'closed') {
      if (decision === 'approve') {
        const isFinancialOrMajor =
          currentCase.kind === 'return' ||
          currentCase.kind === 'stock' ||
          Boolean(
            (currentCase.proposal as any)?.amount ||
            (currentCase.proposal as any)?.action?.includes('refund') ||
            (currentCase.proposal as any)?.action?.includes('exchange') ||
            (currentCase.proposal as any)?.action?.includes('cancel')
          );

        if (isFinancialOrMajor) {
          const rawAction = String((currentCase.proposal as any)?.action || currentCase.kind).toLowerCase();
          let actionType = 'refund';
          if (rawAction.includes('exchange')) actionType = 'exchange';
          else if (rawAction.includes('cancel')) actionType = 'cancellation';

          const actionAmount = (currentCase.proposal as any)?.amount ?? (approvedProposal as any)?.amount;
          const actionCurrency = (currentCase.proposal as any)?.currency ?? (approvedProposal as any)?.currency;

          await authorizeOrderIssueAction({
            tenantId,
            issueId: targetIssue.id,
            approverId,
            actionType,
            actionDetails: {
              amount: actionAmount,
              currency: actionCurrency,
              reason: (currentCase.proposal as any)?.reason,
              items: (currentCase.proposal as any)?.items,
              replacement_size: (currentCase.proposal as any)?.replacement_size,
            },
            proposalId: currentCase.case_id,
            proposalRevision: currentCase.revision,
            dbClient: client,
          });
        } else {
          await client.query(
            `INSERT INTO iao.order_issue_events (
              tenant_id, issue_id, event_type, actor_type, actor_id, summary, details, created_at
            ) VALUES ($1, $2, 'action_approved', 'owner', $3, $4, '{}'::jsonb, NOW());`,
            [tenantId, targetIssue.id, approverId, `Owner approved proposal for case ${currentCase.case_id}.`]
          );
        }
      } else {
        // Rejection: preserves unrelated tasks, creates NO execution tasks
        await client.query(
          `UPDATE iao.order_issues
           SET status = 'awaiting_owner',
               responsible_party = 'owner',
               next_action = $3,
               updated_at = NOW()
           WHERE tenant_id = $1 AND id = $2;`,
          [
            tenantId,
            targetIssue.id,
            `Proposal rejected by store owner for case ${currentCase.case_id}. Review case and alternate customer resolution.`,
          ]
        );

        await client.query(
          `INSERT INTO iao.order_issue_events (
            tenant_id, issue_id, event_type, actor_type, actor_id, summary, details, created_at
          ) VALUES ($1, $2, 'action_rejected', 'owner', $3, $4, $5::jsonb, NOW());`,
          [
            tenantId,
            targetIssue.id,
            approverId,
            `Proposal rejected by owner for case ${currentCase.case_id}.`,
            JSON.stringify({ case_id: currentCase.case_id }),
          ]
        );
      }
    }

    // 3. Update case record in iao.cases
    const updatedCaseRows = await client.query(
      `UPDATE iao.cases
       SET status = $1, revision = revision + 1, updated_at = NOW(),
           proposal = COALESCE($2::jsonb, proposal)
       WHERE tenant_id = $3 AND (case_id = $4 OR case_id = $5)
       RETURNING *;`,
      [nextStatus, approvedProposal ? JSON.stringify(approvedProposal) : null, tenantId, caseId, currentCase.case_id]
    );
    const updatedCase: CaseRecord = updatedCaseRows.rows[0] || currentCase;

    // 4. Update message / conversation if linked
    let updatedMsg: MessageRecord | null = null;
    if (conversationId) {
      if (decision === 'approve') {
        const msgRows = (await client.query(
          `SELECT * FROM iao.messages WHERE conversation_id = $1 ORDER BY created_at ASC;`,
          [conversationId]
        )).rows as MessageRecord[];
        const targetMsg = (messageId ? msgRows.find((m) => m.id === messageId) : null) ||
                          msgRows.find((m) => m.approval_status === 'pending_approval');
        if (targetMsg) {
          const sanitizedBody = targetMsg.body
            .replace(/I have issued a refund/gi, 'Your refund request has been approved and authorized for processing')
            .replace(/We have processed your refund/gi, 'Your refund request has been approved and authorized for processing')
            .replace(/has been refunded/gi, 'has been approved for refund')
            .replace(/your order has been cancelled/gi, 'your cancellation request has been approved and authorized')
            .replace(/replacement (?:has been )?dispatched/gi, 'replacement request has been approved and is being prepared');

          await client.query(
            `UPDATE iao.messages 
             SET approval_status = 'approved', approved_by = $1, approved_at = NOW(), body = $3, status = 'simulated_demo'
             WHERE id = $2;`,
            [approverId, targetMsg.id, sanitizedBody]
          );
          targetMsg.approval_status = 'approved';
          targetMsg.body = sanitizedBody;
          updatedMsg = targetMsg;
        }

        await client.query(
          `UPDATE iao.conversations 
           SET status = 'open', unread = false, updated_at = NOW() 
           WHERE tenant_id = $1 AND id = $2;`,
          [tenantId, conversationId]
        );
      } else {
        if (messageId) {
          await client.query(
            `UPDATE iao.messages 
             SET approval_status = 'rejected', status = 'draft' 
             WHERE id = $1;`,
            [messageId]
          );
        }
        await client.query(
          `UPDATE iao.conversations 
           SET status = 'open', updated_at = NOW() 
           WHERE tenant_id = $1 AND id = $2;`,
          [tenantId, conversationId]
        );
      }
    }

    // 5. Audit insertion in iao.audit
    await client.query(
      `INSERT INTO iao.audit (tenant_id, case_id, event, details, created_at)
       VALUES ($1, $2, $3, $4, NOW());`,
      [tenantId, currentCase.case_id, `case_decision_${decision}`, JSON.stringify({
        case_id: currentCase.case_id,
        decision,
        approver_id: approverId,
        revision: updatedCase?.revision,
      })]
    );

    return { success: true, case: updatedCase, message: updatedMsg };
  });
}


export async function listAudit(
  tenantId: string,
  options: { caseId?: string; limit?: number } = {}
): Promise<AuditRecord[]> {
  try {
    const { caseId, limit = 50 } = options;
    if (caseId) {
      return await query<AuditRecord>(
        `SELECT id, tenant_id, case_id, event, details, created_at
         FROM iao.audit
         WHERE tenant_id = $1 AND case_id = $2
         ORDER BY created_at DESC
         LIMIT $3;`,
        [tenantId, caseId, limit]
      );
    }
    return await query<AuditRecord>(
      `SELECT id, tenant_id, case_id, event, details, created_at
       FROM iao.audit
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2;`,
      [tenantId, limit]
    );
  } catch (err) {
    console.error('[listAudit Error]', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function listDailySummarySnapshots(
  tenantId: string,
  limit: number = 30
): Promise<DailySummarySnapshot[]> {
  try {
    const rows = await query<DailySummarySnapshot>(
      `SELECT id, tenant_id, event, details, created_at
       FROM iao.audit
       WHERE tenant_id = $1 AND event = 'daily_summary'
       ORDER BY created_at DESC
       LIMIT $2;`,
      [tenantId, limit]
    );
    return rows;
  } catch (err) {
    console.error('[listDailySummarySnapshots Error]', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function getSummaryStatsFromDB(tenantId: string): Promise<SummaryStats | null> {
  try {
    // Synchronize pending conversation drafts into iao.cases
    await syncPendingConversationCases(tenantId);

    // 1. Pending approvals (all time)
    const pendingRows = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM iao.cases WHERE tenant_id = $1 AND status = 'pending_approval';`,
      [tenantId]
    );
    const pending_approvals_all_time = parseInt(pendingRows[0]?.count || '0', 10);

    // 2. Completed last 24h
    const completedRows = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM iao.cases 
       WHERE tenant_id = $1 
         AND status IN ('demo_completed', 'completed', 'approved') 
         AND updated_at >= NOW() - INTERVAL '24 hours';`,
      [tenantId]
    );
    const completed_last_24h = parseInt(completedRows[0]?.count || '0', 10);

    // 3. Created last 24h
    const createdRows = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM iao.cases 
       WHERE tenant_id = $1 
         AND created_at >= NOW() - INTERVAL '24 hours';`,
      [tenantId]
    );
    const cases_created_last_24h = parseInt(createdRows[0]?.count || '0', 10);

    // 4. Open cases
    const openCasesRows = await query<{
      kind: CaseRecord['kind'];
      status: CaseRecord['status'];
      case_id: string;
      revision: number;
    }>(
      `SELECT kind, status, case_id, revision 
       FROM iao.cases 
       WHERE tenant_id = $1 AND status = 'pending_approval'
       ORDER BY created_at DESC
       LIMIT 10;`,
      [tenantId]
    );

    return {
      mode: 'demo',
      tenant_id: tenantId,
      period_hours: 24,
      completed_last_24h,
      cases_created_last_24h,
      pending_approvals_all_time,
      open_cases: openCasesRows,
      is_live_db: true,
    };
  } catch (err) {
    console.error('[getSummaryStatsFromDB Error]', err instanceof Error ? err.message : err);
    return null;
  }
}

// ==========================================
// UNIFIED INBOX & CONVERSATIONS
// ==========================================

export async function listConversations(
  tenantId: string,
  options: {
    status?: ConversationStatus | 'all';
    unreadOnly?: boolean;
    channel?: ConversationChannel;
    search?: string;
    limit?: number;
  } = {}
): Promise<ConversationRecord[]> {
  try {
    const { status, unreadOnly, channel, search, limit = 50 } = options;
    const conditions: string[] = ['c.tenant_id = $1'];
    const params: unknown[] = [tenantId];
    let idx = 2;

    if (status && status !== 'all') {
      conditions.push(`c.status = $${idx++}`);
      params.push(status);
    }
    if (unreadOnly) {
      conditions.push(`c.unread = true`);
    }
    if (channel) {
      conditions.push(`c.channel = $${idx++}`);
      params.push(channel);
    }
    if (search && search.trim()) {
      conditions.push(`(c.customer_name ILIKE $${idx} OR c.customer_email ILIKE $${idx} OR c.subject ILIKE $${idx})`);
      params.push(`%${search.trim()}%`);
      idx++;
    }

    params.push(limit);
    const sql = `
      SELECT 
        c.id, c.tenant_id, c.customer_name, c.customer_email, c.customer_phone,
        c.channel, c.external_thread_id, c.status, c.subject, c.unread,
        c.last_message_at, c.created_at, c.updated_at,
        (
          SELECT m.body 
          FROM iao.messages m 
          WHERE m.conversation_id = c.id 
          ORDER BY m.created_at DESC 
          LIMIT 1
        ) as last_message_body
      FROM iao.conversations c
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.last_message_at DESC
      LIMIT $${idx};
    `;

    return await query<ConversationRecord>(sql, params);
  } catch (err) {
    console.error('[listConversations Error]', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function getConversation(
  tenantId: string,
  conversationId: string
): Promise<ConversationRecord | null> {
  try {
    const cleanId = (conversationId || '').trim();
    const cleanSuffix = cleanId.replace(/^conv-/, '');
    const rows = await query<ConversationRecord>(
      `SELECT 
        c.id, c.tenant_id, c.customer_name, c.customer_email, c.customer_phone,
        c.channel, c.external_thread_id, c.status, c.subject, c.unread,
        c.last_message_at, c.created_at, c.updated_at
       FROM iao.conversations c
       WHERE (c.tenant_id = $1 OR $1 IS NULL)
         AND (c.id = $2 OR c.id = 'conv-' || $3 OR c.id = $3)
       ORDER BY (c.tenant_id = $1) DESC, c.created_at DESC
       LIMIT 1;`,
      [tenantId, cleanId, cleanSuffix]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('[getConversation Error]', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function listMessages(
  tenantId: string,
  conversationId: string
): Promise<MessageRecord[]> {
  try {
    const cleanId = (conversationId || '').trim();
    const cleanSuffix = cleanId.replace(/^conv-/, '');
    return await query<MessageRecord>(
      `SELECT 
        id, conversation_id, tenant_id, sender_type, sender_name, sender_email,
        body, status, approval_status, approved_by, approved_at, metadata, created_at
       FROM iao.messages
       WHERE (tenant_id = $1 OR $1 IS NULL)
         AND (conversation_id = $2 OR conversation_id = 'conv-' || $3 OR conversation_id = $3)
       ORDER BY created_at ASC;`,
      [tenantId, cleanId, cleanSuffix]
    );
  } catch (err) {
    console.error('[listMessages Error]', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function createInquiryConversation(
  tenantIdOrParams:
    | string
    | {
        tenant_id?: string;
        customer_name: string;
        customer_email: string;
        customer_phone?: string | null;
        channel?: ConversationChannel;
        subject?: string | null;
        message_body: string;
        service_interest?: string | null;
        budget_range?: string | null;
        location?: string | null;
      },
  maybeParams?: {
    customer_name: string;
    customer_email: string;
    customer_phone?: string | null;
    channel?: ConversationChannel;
    subject?: string | null;
    message_body: string;
    service_interest?: string | null;
    budget_range?: string | null;
    location?: string | null;
  }
): Promise<{ conversation: ConversationRecord; message: MessageRecord; leadId?: string; lead_id?: string; conversation_id?: string }> {
  const tenantId =
    typeof tenantIdOrParams === 'string'
      ? tenantIdOrParams
      : (tenantIdOrParams.tenant_id || 'demo-store');

  const params =
    typeof tenantIdOrParams === 'string'
      ? maybeParams!
      : tenantIdOrParams;

  const convId = `conv-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const msgId = `msg-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const channel = params.channel || 'hosted_inquiry';
  const subject = params.subject || (params.message_body.length > 50 ? params.message_body.slice(0, 47) + '...' : params.message_body);

  // Insert conversation
  const convRows = await query<ConversationRecord>(
    `INSERT INTO iao.conversations 
      (id, tenant_id, customer_name, customer_email, customer_phone, channel, status, subject, unread, last_message_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, true, NOW())
     RETURNING *;`,
    [
      convId,
      tenantId,
      params.customer_name,
      params.customer_email,
      params.customer_phone || null,
      channel,
      subject,
    ]
  );

  // Insert initial customer message
  const msgRows = await query<MessageRecord>(
    `INSERT INTO iao.messages 
      (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata)
     VALUES ($1, $2, $3, 'customer', $4, $5, $6, 'received', 'none', '{}'::jsonb)
     RETURNING *;`,
    [
      msgId,
      convId,
      tenantId,
      params.customer_name,
      params.customer_email,
      params.message_body,
    ]
  );

  // Persist or update Services Lead linked to this conversation
  let leadResultId: string | undefined;
  try {
    const leadRes = await createOrUpdateServicesLead(tenantId, {
      customer_name: params.customer_name,
      customer_email: params.customer_email,
      customer_phone: params.customer_phone || null,
      service_interest: params.service_interest || null,
      budget_range: params.budget_range || null,
      location: params.location || null,
      source: channel,
      conversation_id: convId,
      inquiry_text: params.message_body,
    });
    leadResultId = leadRes.lead.id;
    if (!leadRes.isNew && leadResultId) {
      // Automatic reply cancellation: inbound customer reply renders pending follow-up obsolete
      await cancelServicesLeadFollowup({
        tenantId,
        leadId: leadResultId,
        reason: 'Customer replied via inquiry portal',
      }).catch((e) => console.warn('[Auto-Cancel Followup on Reply]', e));
    }
  } catch (leadErr) {
    console.warn('[Services Lead Capture Notice]', leadErr instanceof Error ? leadErr.message : leadErr);
  }

  // Log audit
  await insertAudit(tenantId, 'hosted_inquiry_received', {
    conversation_id: convId,
    customer_name: params.customer_name,
    customer_email: params.customer_email,
    channel,
    lead_id: leadResultId,
  });

  // Evaluate inquiry: First check if inquiry is a genuine Order Issue
  const business = await getBusiness(tenantId);
  const settings = business?.settings || getDefaultBusinessSettings(tenantId);
  const orders = await listOrders(tenantId);

  const issueDetection = detectOrderIssue({
    subject,
    bodyText: params.message_body,
    senderName: params.customer_name,
    senderEmail: params.customer_email,
    orders,
  });

  if (issueDetection.isIssue && issueDetection.issueType) {
    const shopConn = await getShopifyConnection(tenantId);
    const inv = investigateOrderData(
      issueDetection.verifiedOrder || null,
      issueDetection.issueType,
      issueDetection.customerClaimText
    );

    const newIssue = await createOrderIssue({
      tenantId,
      issueType: issueDetection.issueType,
      status: inv.initialStatus,
      orderId: issueDetection.orderId || null,
      shopDomain: shopConn?.shop_domain || null,
      conversationId: convId,
      customerName: params.customer_name,
      customerEmail: params.customer_email,
      evidence: inv.evidence,
      nextAction: inv.nextAction,
      responsibleParty: inv.responsibleParty,
    });

    const intervalHours = settings.order_issues_config?.followup_interval_hours || 24;
    const maxAttempts = settings.order_issues_config?.max_followup_attempts || 2;

    if (inv.initialStatus === 'awaiting_customer') {
      await scheduleOrderIssueFollowup({
        tenantId,
        issueId: newIssue.id,
        conversationId: convId,
        followupType: 'awaiting_customer_clarification',
        delayHours: intervalHours,
        maxAttempts,
      });
    } else if (inv.initialStatus === 'awaiting_owner' || inv.initialStatus === 'action_pending') {
      await scheduleOrderIssueFollowup({
        tenantId,
        issueId: newIssue.id,
        conversationId: convId,
        followupType: 'awaiting_owner_review',
        delayHours: intervalHours,
        maxAttempts,
      });
    } else if (inv.initialStatus === 'investigating' && inv.evidence?.carrier) {
      await scheduleOrderIssueFollowup({
        tenantId,
        issueId: newIssue.id,
        conversationId: convId,
        followupType: 'awaiting_carrier_update',
        delayHours: intervalHours,
        maxAttempts,
      });
    }

    const hasPersistedTask = Boolean(inv.evidence?.owner_tasks && inv.evidence.owner_tasks.length > 0);
    const effectiveBizName = settings.display_name_override || settings.business_name || 'Customer Support';
    const ackBody = buildOrderIssueAcknowledgment({
      issueType: issueDetection.issueType,
      order: issueDetection.verifiedOrder || null,
      evidence: inv.evidence,
      customerName: params.customer_name,
      businessName: effectiveBizName,
      hasPersistedTask,
    });

    const isFinancialOrMajorAction =
      issueDetection.issueType === 'refund_request' ||
      issueDetection.issueType === 'exchange_request' ||
      issueDetection.issueType === 'cancellation_request';

    const mode = settings.automation_mode || 'auto_routine';
    const isAuto = mode === 'auto_routine' && !isFinancialOrMajorAction;
    const aiMsgId = `msg-ai-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    await query(
      `INSERT INTO iao.messages 
        (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9::jsonb, NOW())`,
      [
        aiMsgId,
        convId,
        tenantId,
        isAuto ? 'agent' : 'ai_draft',
        `${effectiveBizName} (AI Operator)`,
        ackBody,
        isAuto ? 'simulated_demo' : 'draft',
        isAuto ? 'none' : 'pending_approval',
        JSON.stringify({
          auto_dispatched: isAuto,
          issue_id: newIssue.id,
          issue_type: issueDetection.issueType,
          financial_action: isFinancialOrMajorAction,
          reason: inv.nextAction,
        }),
      ]
    );

    if (!isAuto) {
      await query(
        `UPDATE iao.conversations SET status = 'pending_approval' WHERE id = $1;`,
        [convId]
      );
    }

    return {
      conversation: convRows[0],
      message: msgRows[0],
      lead_id: leadResultId,
      leadId: leadResultId,
      conversation_id: convId,
    };
  }

  const evaluation = evaluateRoutineInquiry({
    subject,
    bodyText: params.message_body,
    senderName: params.customer_name,
    senderEmail: params.customer_email,
    settings,
    orders,
    channel,
    isLiveChannel: (channel as string) === 'gmail' || (channel as string) === 'email' || (channel as string) === 'live_chat',
  });

  if (evaluation.intent !== 'ignored_automated' && evaluation.intent !== 'paused') {
    const aiMsgId = `msg-ai-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const isAuto = evaluation.canAutoReply && Boolean(evaluation.replyText);
    const replyBody =
      evaluation.replyText ||
      evaluation.acknowledgmentDraftText ||
      'Thank you for reaching out. We have received your inquiry and will follow up shortly.';

    await query(
      `INSERT INTO iao.messages 
        (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9::jsonb, NOW())`,
      [
        aiMsgId,
        convId,
        tenantId,
        isAuto ? 'agent' : 'ai_draft',
        `${settings.business_name || 'Store'} (AI Operator)`,
        replyBody,
        isAuto ? 'simulated_demo' : 'draft',
        isAuto ? 'none' : 'pending_approval',
        JSON.stringify({
          auto_dispatched: isAuto,
          routine_intent: evaluation.intent,
          grounded_sources: evaluation.groundedSources,
          financial_action: evaluation.financialOrMajorAction,
          reason: evaluation.reason,
        }),
      ]
    );

    if (!isAuto) {
      await query(
        `UPDATE iao.conversations SET status = 'pending_approval' WHERE id = $1;`,
        [convId]
      );
    }
  }

  return {
    conversation: convRows[0],
    message: msgRows[0],
    lead_id: leadResultId,
    leadId: leadResultId,
    conversation_id: convId,
  };
}

export async function createMessage(params: {
  tenant_id: string;
  conversation_id: string;
  sender_type: MessageSenderType;
  sender_name: string;
  sender_email?: string | null;
  body: string;
  status?: MessageStatus;
  approval_status?: MessageApprovalStatus;
  approved_by?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<MessageRecord> {
  const msgId = `msg-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const status = params.status || (params.sender_type === 'ai_draft' ? 'draft' : 'received');
  const approvalStatus = params.approval_status || (params.sender_type === 'ai_draft' ? 'pending_approval' : 'none');

  const rows = await query<MessageRecord>(
    `INSERT INTO iao.messages 
      (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, approved_by, approved_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *;`,
    [
      msgId,
      params.conversation_id,
      params.tenant_id,
      params.sender_type,
      params.sender_name,
      params.sender_email || null,
      params.body,
      status,
      approvalStatus,
      params.approved_by || null,
      params.approved_by ? new Date().toISOString() : null,
      JSON.stringify(params.metadata || {}),
    ]
  );

  // Update conversation last_message_at and status if needed
  let convStatusUpdate = '';
  if (params.sender_type === 'ai_draft') {
    convStatusUpdate = `, status = 'pending_approval'`;
  }
  await query(
    `UPDATE iao.conversations 
     SET last_message_at = NOW(), updated_at = NOW() ${convStatusUpdate}
     WHERE tenant_id = $1 AND id = $2;`,
    [params.tenant_id, params.conversation_id]
  );

  return rows[0];
}

export async function updateMessageDraft(
  tenantId: string,
  messageId: string,
  newBody: string
): Promise<MessageRecord | null> {
  // Editing a draft or approved message invalidates prior approval and increments revision
  const rows = await query<MessageRecord>(
    `UPDATE iao.messages
     SET body = $1, 
         approval_status = 'pending_approval', 
         approved_by = NULL, 
         approved_at = NULL, 
         status = 'draft',
         metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           '{draft_revision}',
           to_jsonb(COALESCE((metadata->>'draft_revision')::int, 1) + 1)
         )
     WHERE tenant_id = $2 AND id = $3
     RETURNING *;`,
    [newBody, tenantId, messageId]
  );
  return rows[0] || null;
}

export async function updateMessageApproval(
  tenantId: string,
  messageId: string,
  approvalStatus: MessageApprovalStatus,
  approvedBy: string,
  approvalBinding?: {
    recipient_email: string;
    subject: string;
    body: string;
    sender_email?: string | null;
    sender_name?: string | null;
    mode?: string | null;
    draft_revision?: number;
  }
): Promise<MessageRecord | null> {
  const isApproved = approvalStatus === 'approved';
  const newStatus: MessageStatus = isApproved ? 'approved' : 'draft';

  let rows: MessageRecord[];
  if (isApproved && approvalBinding) {
    const bindingData = {
      approved_recipient: approvalBinding.recipient_email,
      approved_subject: approvalBinding.subject,
      approved_body_hash: computeSha256(approvalBinding.body),
      approved_revision: approvalBinding.draft_revision || 1,
      approved_sender_email: approvalBinding.sender_email || null,
      approved_sender_name: approvalBinding.sender_name || null,
      approved_mode: approvalBinding.mode || 'demo',
    };

    rows = await query<MessageRecord>(
      `UPDATE iao.messages
       SET approval_status = $1, 
           approved_by = $2, 
           approved_at = NOW(), 
           status = $3,
           metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
       WHERE tenant_id = $5 AND id = $6
       RETURNING *;`,
      [approvalStatus, approvedBy, newStatus, JSON.stringify(bindingData), tenantId, messageId]
    );
  } else {
    rows = await query<MessageRecord>(
      `UPDATE iao.messages
       SET approval_status = $1, approved_by = $2, approved_at = NOW(), status = $3
       WHERE tenant_id = $4 AND id = $5
       RETURNING *;`,
      [approvalStatus, approvedBy, newStatus, tenantId, messageId]
    );
  }

  if (rows[0]) {
    // Keep linked case in sync
    await query(
      `UPDATE iao.cases 
       SET status = $1, updated_at = NOW() 
       WHERE tenant_id = $2 AND (case_id = $3 OR payload->>'message_id' = $4);`,
      [
        isApproved ? 'approved' : 'rejected',
        tenantId,
        `case-conv-${rows[0].conversation_id}`,
        messageId,
      ]
    );

    await insertAudit(tenantId, `message_approval_${approvalStatus}`, {
      message_id: messageId,
      conversation_id: rows[0].conversation_id,
      approved_by: approvedBy,
      status: approvalStatus,
    });
  }

  return rows[0] || null;
}

export async function updateMessageStatus(
  tenantId: string,
  messageId: string,
  status: MessageStatus,
  metadataUpdates?: Record<string, unknown>
): Promise<MessageRecord | null> {
  let rows: MessageRecord[];
  if (metadataUpdates) {
    rows = await query<MessageRecord>(
      `UPDATE iao.messages
       SET status = $1, metadata = metadata || $2::jsonb
       WHERE tenant_id = $3 AND id = $4
       RETURNING *;`,
      [status, JSON.stringify(metadataUpdates), tenantId, messageId]
    );
  } else {
    rows = await query<MessageRecord>(
      `UPDATE iao.messages
       SET status = $1
       WHERE tenant_id = $2 AND id = $3
       RETURNING *;`,
      [status, tenantId, messageId]
    );
  }
  return rows[0] || null;
}

export async function markConversationRead(
  tenantId: string,
  conversationId: string,
  unread: boolean = false
): Promise<void> {
  try {
    const cleanId = (conversationId || '').trim();
    const cleanSuffix = cleanId.replace(/^conv-/, '');
    await query(
      `UPDATE iao.conversations
       SET unread = $1, updated_at = NOW()
       WHERE (tenant_id = $2 OR $2 IS NULL) 
         AND (id = $3 OR id = 'conv-' || $4 OR id = $4);`,
      [unread, tenantId, cleanId, cleanSuffix]
    );
  } catch (err) {
    console.warn('[markConversationRead non-fatal]', err instanceof Error ? err.message : err);
  }
}

export async function updateConversationStatus(
  tenantId: string,
  conversationId: string,
  status: ConversationStatus
): Promise<ConversationRecord | null> {
  const rows = await query<ConversationRecord>(
    `UPDATE iao.conversations
     SET status = $1, updated_at = NOW()
     WHERE tenant_id = $2 AND id = $3
     RETURNING *;`,
    [status, tenantId, conversationId]
  );
  return rows[0] || null;
}

// ==========================================
// TENANT ENCRYPTED EMAIL CREDENTIALS & OUTBOX
// ==========================================

export async function getEmailCredential(tenantId: string): Promise<{
  credential: EmailCredentialRecord | null;
  decryptedApiKey: string | null;
}> {
  try {
    const rows = await query<EmailCredentialRecord>(
      `SELECT tenant_id, provider, mode, encrypted_api_key, key_fingerprint, sender_name, sender_email, reply_to, is_verified, last_tested, last_error, webhook_signing_secret, created_at, updated_at
       FROM iao.email_credentials
       WHERE tenant_id = $1
       LIMIT 1;`,
      [tenantId]
    );

    const cred = rows[0] || null;
    if (!cred || !cred.encrypted_api_key) {
      return { credential: cred, decryptedApiKey: null };
    }

    try {
      const decrypted = decryptSecret(cred.encrypted_api_key);
      return { credential: cred, decryptedApiKey: decrypted };
    } catch (err) {
      console.error('[getEmailCredential decryption error]', err);
      return { credential: cred, decryptedApiKey: null };
    }
  } catch (err) {
    console.error('[getEmailCredential Error]', err instanceof Error ? err.message : err);
    return { credential: null, decryptedApiKey: null };
  }
}

export async function getPublicEmailConfig(tenantId: string): Promise<EmailConnectionConfig> {
  try {
    const rows = await query<EmailCredentialRecord>(
      `SELECT tenant_id, provider, mode, key_fingerprint, sender_name, sender_email, reply_to, is_verified, last_tested, last_error
       FROM iao.email_credentials
       WHERE tenant_id = $1
       LIMIT 1;`,
      [tenantId]
    );

    const cred = rows[0];
    if (!cred) {
      return {
        mode: 'demo',
        provider: 'resend',
        status: 'demo_simulated',
        sender_name: 'Customer Support',
        sender_email: 'support@demo-store.com',
        has_api_key: false,
        is_verified: false,
      };
    }

    const isConnected = cred.is_verified && cred.mode === 'live';
    const status = cred.mode === 'demo'
      ? 'demo_simulated'
      : isConnected
      ? 'connected'
      : cred.last_error
      ? 'error'
      : 'not_connected';

    return {
      mode: cred.mode as 'demo' | 'live',
      provider: cred.provider as 'resend' | 'smtp' | 'none',
      status,
      sender_name: cred.sender_name || undefined,
      sender_email: cred.sender_email || undefined,
      reply_to: cred.reply_to || undefined,
      key_fingerprint: cred.key_fingerprint || undefined,
      has_api_key: Boolean(cred.key_fingerprint),
      is_verified: cred.is_verified,
      last_tested: cred.last_tested || undefined,
      last_error: cred.last_error || undefined,
    };
  } catch (err) {
    console.error('[getPublicEmailConfig Error]', err instanceof Error ? err.message : err);
    return {
      mode: 'demo',
      provider: 'resend',
      status: 'demo_simulated',
      has_api_key: false,
      is_verified: false,
    };
  }
}

export async function saveEmailCredential(
  tenantId: string,
  params: {
    mode?: 'demo' | 'live';
    provider?: 'resend' | 'smtp' | 'none';
    apiKey?: string;
    sender_name?: string;
    sender_email?: string;
    reply_to?: string;
    webhook_signing_secret?: string;
  }
): Promise<EmailCredentialRecord> {
  const existingRes = await getEmailCredential(tenantId);
  const existing = existingRes.credential;

  const mode = params.mode || existing?.mode || 'demo';
  const provider = params.provider || existing?.provider || 'resend';
  const senderName = params.sender_name !== undefined ? params.sender_name : existing?.sender_name;
  const senderEmail = params.sender_email !== undefined ? params.sender_email : existing?.sender_email;
  const replyTo = params.reply_to !== undefined ? params.reply_to : existing?.reply_to;

  let encryptedApiKey = existing?.encrypted_api_key || null;
  let keyFingerprint = existing?.key_fingerprint || null;
  let credentialsChanged = false;

  if (params.apiKey && params.apiKey.trim()) {
    const rawKey = params.apiKey.trim();
    encryptedApiKey = encryptSecret(rawKey);
    keyFingerprint = maskApiKey(rawKey);
    credentialsChanged = true;
  }

  // Changing credentials, sender configuration or mode invalidates verification and prior approvals
  const senderChanged = senderEmail !== existing?.sender_email || senderName !== existing?.sender_name || replyTo !== existing?.reply_to;
  const modeChanged = mode !== existing?.mode;
  const isVerified = credentialsChanged || senderChanged || modeChanged ? false : (existing?.is_verified ?? false);

  if (credentialsChanged || senderChanged || modeChanged) {
    // Invalidate approved messages bound to old sender configuration
    await query(
      `UPDATE iao.messages
       SET approval_status = 'pending_approval', approved_by = NULL, approved_at = NULL, status = 'draft',
           metadata = jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{invalidation_reason}',
             '"Sender configuration or credentials updated in Business Settings"'
           )
       WHERE tenant_id = $1 AND approval_status = 'approved' AND status IN ('approved', 'queued');`,
      [tenantId]
    );
  }

  const rows = await query<EmailCredentialRecord>(
    `INSERT INTO iao.email_credentials 
      (tenant_id, provider, mode, encrypted_api_key, key_fingerprint, sender_name, sender_email, reply_to, is_verified, last_error, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
      provider = EXCLUDED.provider,
      mode = EXCLUDED.mode,
      encrypted_api_key = COALESCE(EXCLUDED.encrypted_api_key, iao.email_credentials.encrypted_api_key),
      key_fingerprint = COALESCE(EXCLUDED.key_fingerprint, iao.email_credentials.key_fingerprint),
      sender_name = EXCLUDED.sender_name,
      sender_email = EXCLUDED.sender_email,
      reply_to = EXCLUDED.reply_to,
      is_verified = EXCLUDED.is_verified,
      last_error = NULL,
      updated_at = NOW()
     RETURNING *;`,
    [
      tenantId,
      provider,
      mode,
      encryptedApiKey,
      keyFingerprint,
      senderName || null,
      senderEmail || null,
      replyTo || null,
      isVerified,
    ]
  );

  await recordAuditLog(tenantId, 'email_connection_updated', {
    mode,
    provider,
    sender_email: senderEmail,
    credentials_changed: credentialsChanged,
    is_verified: isVerified,
  });

  return rows[0];
}

export async function disconnectEmail(tenantId: string): Promise<void> {
  await query(
    `UPDATE iao.email_credentials
     SET encrypted_api_key = NULL, key_fingerprint = NULL, is_verified = false, mode = 'demo', last_error = NULL, updated_at = NOW()
     WHERE tenant_id = $1;`,
    [tenantId]
  );

  // Block any queued unsent messages (Requirement 1)
  await query(
    `UPDATE iao.messages
     SET status = 'draft', approval_status = 'none'
     WHERE tenant_id = $1 AND status = 'queued';`,
    [tenantId]
  );

  await recordAuditLog(tenantId, 'email_connection_disconnected', { tenant_id: tenantId });
}

export async function updateEmailVerificationStatus(
  tenantId: string,
  isVerified: boolean,
  errorMessage: string | null = null
): Promise<void> {
  await query(
    `UPDATE iao.email_credentials
     SET is_verified = $1, last_tested = NOW(), last_error = $2, updated_at = NOW()
     WHERE tenant_id = $3;`,
    [isVerified, errorMessage, tenantId]
  );
}

// ----------------------------------------------------------------------------
// OUTBOX & ATOMIC CLAIM FOR DISPATCH
// ----------------------------------------------------------------------------

export async function claimMessageForDispatch(
  tenantId: string,
  messageId: string
): Promise<MessageRecord | null> {
  // Atomic claim: only claim if status is 'approved' or 'queued' to prevent concurrent duplicate sends (Requirement 4)
  const rows = await query<MessageRecord>(
    `UPDATE iao.messages
     SET status = 'sending'
     WHERE tenant_id = $1 AND id = $2 AND status IN ('approved', 'queued')
     RETURNING *;`,
    [tenantId, messageId]
  );
  return rows[0] || null;
}

export async function createMessageDispatch(params: {
  message_id: string;
  conversation_id: string;
  tenant_id: string;
  idempotency_key: string;
  provider: 'resend' | 'gmail' | 'simulated_demo';
  status: MessageStatus;
  recipient_email: string;
  sender_email: string;
  sender_name?: string | null;
  reply_to?: string | null;
  subject: string;
  body_text: string;
  metadata?: Record<string, unknown>;
}): Promise<MessageDispatchRecord> {
  const dispatchId = `dsp-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const bodyHash = computeSha256(params.body_text);

  const rows = await query<MessageDispatchRecord>(
    `INSERT INTO iao.message_dispatches
      (id, message_id, conversation_id, tenant_id, idempotency_key, provider, status, recipient_email, sender_email, sender_name, reply_to, subject, body_hash, attempts, last_attempt_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1, NOW(), $14)
     RETURNING *;`,
    [
      dispatchId,
      params.message_id,
      params.conversation_id,
      params.tenant_id,
      params.idempotency_key,
      params.provider,
      params.status,
      params.recipient_email,
      params.sender_email,
      params.sender_name || null,
      params.reply_to || null,
      params.subject,
      bodyHash,
      JSON.stringify(params.metadata || {}),
    ]
  );

  return rows[0];
}

export async function updateDispatchStatus(params: {
  dispatch_id: string;
  status: MessageStatus;
  provider_message_id?: string | null;
  error?: string | null;
  metadataUpdates?: Record<string, unknown>;
}): Promise<MessageDispatchRecord | null> {
  const rows = await query<MessageDispatchRecord>(
    `UPDATE iao.message_dispatches
     SET status = $1,
         provider_message_id = COALESCE($2, provider_message_id),
         last_error = $3,
         last_attempt_at = NOW(),
         metadata = metadata || $4::jsonb,
         updated_at = NOW()
     WHERE id = $5
     RETURNING *;`,
    [
      params.status,
      params.provider_message_id || null,
      params.error || null,
      JSON.stringify(params.metadataUpdates || {}),
      params.dispatch_id,
    ]
  );

  if (rows[0]) {
    // Also update parent message status
    await query(
      `UPDATE iao.messages
       SET status = $1, metadata = metadata || $2::jsonb
       WHERE id = $3;`,
      [
        params.status,
        JSON.stringify({
          dispatch_id: params.dispatch_id,
          provider_message_id: params.provider_message_id || null,
          last_status_update: new Date().toISOString(),
        }),
        rows[0].message_id,
      ]
    );
  }

  return rows[0] || null;
}

export async function findDispatchByProviderMessageId(
  providerMessageId: string
): Promise<MessageDispatchRecord | null> {
  try {
    const rows = await query<MessageDispatchRecord>(
      `SELECT * FROM iao.message_dispatches
       WHERE provider_message_id = $1
       ORDER BY created_at DESC
       LIMIT 1;`,
      [providerMessageId]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('[findDispatchByProviderMessageId Error]', err);
    return null;
  }
}

export async function recordWebhookEvent(params: {
  eventId: string;
  provider: 'resend';
  eventType: string;
  providerMessageId?: string | null;
  payload: Record<string, unknown>;
}): Promise<{ isDuplicate: boolean; record: WebhookEventRecord | null }> {
  try {
    const id = `ev-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const rows = await query<WebhookEventRecord>(
      `INSERT INTO iao.webhook_events (id, provider, event_id, event_type, provider_message_id, payload, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'processed')
       ON CONFLICT (event_id) DO NOTHING
       RETURNING *;`,
      [
        id,
        params.provider,
        params.eventId,
        params.eventType,
        params.providerMessageId || null,
        JSON.stringify(params.payload),
      ]
    );

    if (rows.length === 0) {
      return { isDuplicate: true, record: null };
    }

    return { isDuplicate: false, record: rows[0] };
  } catch (err) {
    console.error('[recordWebhookEvent Error]', err);
    return { isDuplicate: false, record: null };
  }
}

export async function listActiveGmailTenants(): Promise<string[]> {
  try {
    const rows = await query<{ tenant_id: string }>(
      `SELECT tenant_id FROM iao.gmail_connections WHERE sync_status != 'needs_reconnect';`
    );
    return rows.map((r) => r.tenant_id);
  } catch (err) {
    console.error('[listActiveGmailTenants Error]', err);
    return [];
  }
}

export async function saveOAuthState(params: {
  state: string;
  tenant_id: string;
  user_id: string;
  code_verifier: string;
  redirect_uri: string;
  expires_at: Date;
}): Promise<OAuthStateRecord> {
  const rows = await query<OAuthStateRecord>(
    `INSERT INTO iao.oauth_states (state, tenant_id, user_id, code_verifier, redirect_uri, expires_at, used)
     VALUES ($1, $2, $3, $4, $5, $6, false)
     RETURNING *;`,
    [
      params.state,
      params.tenant_id,
      params.user_id,
      params.code_verifier,
      params.redirect_uri,
      params.expires_at.toISOString(),
    ]
  );
  return rows[0];
}

export async function getAndConsumeOAuthState(state: string): Promise<OAuthStateRecord | null> {
  const rows = await query<OAuthStateRecord>(
    `UPDATE iao.oauth_states
     SET used = true
     WHERE state = $1 AND used = false AND expires_at > NOW()
     RETURNING *;`,
    [state]
  );
  return rows[0] || null;
}

export async function getGmailConnection(tenantId: string): Promise<{
  connection: GmailConnectionRecord | null;
  decryptedAccessToken: string | null;
  decryptedRefreshToken: string | null;
  needsReconnect: boolean;
}> {
  try {
    const rows = await query<GmailConnectionRecord>(
      `SELECT * FROM iao.gmail_connections
       WHERE tenant_id = $1
       LIMIT 1;`,
      [tenantId]
    );

    const conn = rows[0] || null;
    if (!conn) {
      return { connection: null, decryptedAccessToken: null, decryptedRefreshToken: null, needsReconnect: false };
    }

    if (conn.sync_status === 'needs_reconnect') {
      return { connection: conn, decryptedAccessToken: null, decryptedRefreshToken: null, needsReconnect: true };
    }

    let accessToken = decryptSecret(conn.encrypted_access_token);
    const refreshToken = conn.encrypted_refresh_token ? decryptSecret(conn.encrypted_refresh_token) : null;

    // Check if access token is expired or within 2 minutes of expiry
    const expiryTime = new Date(conn.token_expiry).getTime();
    const isExpired = Date.now() >= expiryTime - 120000;

    if (isExpired && refreshToken) {
      const config = getGoogleOAuthConfig();
      if (config) {
        try {
          const refreshed = await refreshGoogleAccessToken({ refreshToken, config });
          accessToken = refreshed.accessToken;
          const newExpiry = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
          const encryptedNewAccess = encryptSecret(refreshed.accessToken);

          await query(
            `UPDATE iao.gmail_connections
             SET encrypted_access_token = $1, token_expiry = $2, sync_status = 'idle', last_error = NULL, updated_at = NOW()
             WHERE tenant_id = $3;`,
            [encryptedNewAccess, newExpiry, tenantId]
          );

          conn.encrypted_access_token = encryptedNewAccess;
          conn.token_expiry = newExpiry;
          conn.sync_status = 'idle';
        } catch (refreshErr: unknown) {
          console.error('[refreshGoogleAccessToken Error]', refreshErr);
          const isRevoked = (refreshErr as { isRevoked?: boolean })?.isRevoked;
          if (isRevoked) {
            await query(
              `UPDATE iao.gmail_connections
               SET sync_status = 'needs_reconnect', last_error = 'Google account authorization revoked or expired. Please reconnect.', updated_at = NOW()
               WHERE tenant_id = $1;`,
              [tenantId]
            );
            return { connection: conn, decryptedAccessToken: null, decryptedRefreshToken: null, needsReconnect: true };
          }
        }
      }
    }

    return {
      connection: conn,
      decryptedAccessToken: accessToken,
      decryptedRefreshToken: refreshToken,
      needsReconnect: false,
    };
  } catch (err) {
    console.error('[getGmailConnection Error]', err);
    return { connection: null, decryptedAccessToken: null, decryptedRefreshToken: null, needsReconnect: false };
  }
}

export async function getPublicGmailConfig(tenantId: string): Promise<GmailPublicConfig> {
  const config = getGoogleOAuthConfig();
  const isPlatformConfigured = Boolean(config?.clientId && config?.clientSecret);

  try {
    const rows = await query<GmailConnectionRecord>(
      `SELECT google_email, google_name, google_avatar, sync_status, last_synced_at, last_error, initial_sync_completed, history_id
       FROM iao.gmail_connections
       WHERE tenant_id = $1
       LIMIT 1;`,
      [tenantId]
    );

    const conn = rows[0];
    if (!conn) {
      return {
        is_connected: false,
        sync_status: 'not_connected',
        initial_sync_completed: false,
        is_configured_on_platform: isPlatformConfigured,
      };
    }

    return {
      is_connected: true,
      google_email: conn.google_email,
      google_name: conn.google_name || undefined,
      google_avatar: conn.google_avatar || undefined,
      sync_status: conn.sync_status,
      last_synced_at: conn.last_synced_at || undefined,
      last_error: conn.last_error || undefined,
      initial_sync_completed: conn.initial_sync_completed,
      history_id: conn.history_id || undefined,
      is_configured_on_platform: isPlatformConfigured,
    };
  } catch (err) {
    console.error('[getPublicGmailConfig Error]', err);
    return {
      is_connected: false,
      sync_status: 'not_connected',
      initial_sync_completed: false,
      is_configured_on_platform: isPlatformConfigured,
    };
  }
}

export async function saveGmailConnection(
  tenantId: string,
  params: {
    google_email: string;
    google_sub?: string | null;
    google_name?: string | null;
    google_avatar?: string | null;
    access_token: string;
    refresh_token?: string | null;
    expires_in: number;
    scopes?: string[];
    history_id?: string | null;
  }
): Promise<GmailConnectionRecord> {
  // Enforce single-tenant mailbox assignment: Check if mailbox is already connected to another tenant
  const conflictRows = await query<{ tenant_id: string }>(
    `SELECT tenant_id FROM iao.gmail_connections WHERE LOWER(google_email) = LOWER($1) AND tenant_id != $2;`,
    [params.google_email.trim(), tenantId]
  );

  if (conflictRows.length > 0) {
    throw new Error(
      `This Gmail mailbox (${params.google_email}) is already connected to another business workspace (${conflictRows[0].tenant_id}). Please disconnect it from that business first or use a different Google account.`
    );
  }

  const existingRes = await getGmailConnection(tenantId);
  const existing = existingRes.connection;

  const encryptedAccess = encryptSecret(params.access_token);
  // Keep existing refresh token if Google does not return a new one on re-consent
  const encryptedRefresh = params.refresh_token
    ? encryptSecret(params.refresh_token)
    : existing?.encrypted_refresh_token || null;

  const expiryDate = new Date(Date.now() + params.expires_in * 1000).toISOString();
  const scopes = params.scopes || existing?.scopes || [];

  const rows = await query<GmailConnectionRecord>(
    `INSERT INTO iao.gmail_connections
      (tenant_id, google_email, google_sub, google_name, google_avatar, encrypted_access_token, encrypted_refresh_token, token_expiry, scopes, history_id, sync_status, last_error, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'idle', NULL, NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
      google_email = EXCLUDED.google_email,
      google_sub = EXCLUDED.google_sub,
      google_name = EXCLUDED.google_name,
      google_avatar = EXCLUDED.google_avatar,
      encrypted_access_token = EXCLUDED.encrypted_access_token,
      encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, iao.gmail_connections.encrypted_refresh_token),
      token_expiry = EXCLUDED.token_expiry,
      scopes = EXCLUDED.scopes,
      history_id = COALESCE(EXCLUDED.history_id, iao.gmail_connections.history_id),
      sync_status = 'idle',
      last_error = NULL,
      updated_at = NOW()
     RETURNING *;`,
    [
      tenantId,
      params.google_email.trim().toLowerCase(),
      params.google_sub || null,
      params.google_name || null,
      params.google_avatar || null,
      encryptedAccess,
      encryptedRefresh,
      expiryDate,
      scopes,
      params.history_id || null,
    ]
  );

  // Invalidate any previously approved drafts bound to old mailbox/sender configuration
  await query(
    `UPDATE iao.messages
     SET approval_status = 'pending_approval', approved_by = NULL, approved_at = NULL, status = 'draft',
         metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           '{invalidation_reason}',
           '"Gmail mailbox connection connected or updated in Settings"'
         )
     WHERE tenant_id = $1 AND approval_status = 'approved' AND status IN ('approved', 'queued');`,
    [tenantId]
  );

  await recordAuditLog(tenantId, 'gmail_connection_saved', {
    google_email: params.google_email,
    connected_at: new Date().toISOString(),
  });

  return rows[0];
}

export async function disconnectGmail(tenantId: string): Promise<void> {
  await query(`DELETE FROM iao.gmail_connections WHERE tenant_id = $1;`, [tenantId]);

  // Block any queued unsent messages waiting on Gmail provider
  await query(
    `UPDATE iao.messages
     SET status = 'draft', approval_status = 'none'
     WHERE tenant_id = $1 AND status = 'queued';`,
    [tenantId]
  );

  await recordAuditLog(tenantId, 'gmail_connection_disconnected', { tenant_id: tenantId });
}

export async function updateGmailSyncStatus(
  tenantId: string,
  params: {
    status: 'idle' | 'syncing' | 'error' | 'needs_reconnect';
    historyId?: string;
    error?: string | null;
    initialSyncCompleted?: boolean;
  }
): Promise<void> {
  let updates = `sync_status = $1, updated_at = NOW()`;
  const sqlParams: unknown[] = [params.status];
  let idx = 2;

  if (params.historyId) {
    updates += `, history_id = $${idx}`;
    sqlParams.push(params.historyId);
    idx++;
  }

  if (params.status === 'idle') {
    updates += `, last_synced_at = NOW()`;
  }

  if (params.error !== undefined) {
    updates += `, last_error = $${idx}`;
    sqlParams.push(params.error);
    idx++;
  }

  if (params.initialSyncCompleted !== undefined) {
    updates += `, initial_sync_completed = $${idx}`;
    sqlParams.push(params.initialSyncCompleted);
    idx++;
  }

  sqlParams.push(tenantId);
  await query(
    `UPDATE iao.gmail_connections
     SET ${updates}
     WHERE tenant_id = $${idx};`,
    sqlParams
  );
}

// ==========================================
// GMAIL MESSAGE INGESTION & THREADING
// ==========================================

export async function ingestGmailMessage(
  tenantId: string,
  msg: ParsedGmailMessage
): Promise<{
  isNew: boolean;
  conversation: ConversationRecord;
  message: MessageRecord;
  aiDraft?: MessageRecord | null;
  autoDispatchedReply?: MessageRecord | null;
  evaluation?: RoutineEvaluationResult;
}> {
  // 1. Deduplication by tenant & Gmail message ID
  const existingMsgRows = await query<MessageRecord>(
    `SELECT * FROM iao.messages 
     WHERE tenant_id = $1 AND metadata->>'gmail_message_id' = $2
     LIMIT 1;`,
    [tenantId, msg.id]
  );

  if (existingMsgRows.length > 0) {
    const conv = await getConversation(tenantId, existingMsgRows[0].conversation_id);
    return {
      isNew: false,
      conversation: conv!,
      message: existingMsgRows[0],
    };
  }

  // 2. Resolve Conversation by Gmail Thread ID or In-Reply-To / References
  let conversation: ConversationRecord | null = null;

  // A. Search by external_thread_id
  if (msg.threadId) {
    const threadConvRows = await query<ConversationRecord>(
      `SELECT * FROM iao.conversations
       WHERE tenant_id = $1 AND external_thread_id = $2
       LIMIT 1;`,
      [tenantId, msg.threadId]
    );
    if (threadConvRows.length > 0) {
      conversation = threadConvRows[0];
    }
  }

  // B. Search by In-Reply-To or References RFC Message-ID
  if (!conversation && (msg.inReplyTo || msg.references)) {
    const refTargets: string[] = [];
    if (msg.inReplyTo) refTargets.push(msg.inReplyTo.replace(/[<>]/g, '').trim());
    if (msg.references) {
      const parts = msg.references.match(/<[^>]+>/g) || [];
      parts.forEach((p) => refTargets.push(p.replace(/[<>]/g, '').trim()));
    }

    if (refTargets.length > 0) {
      const refMsgRows = await query<MessageRecord>(
        `SELECT conversation_id FROM iao.messages
         WHERE tenant_id = $1 AND metadata->>'rfc_message_id' = ANY($2::text[])
         ORDER BY created_at DESC
         LIMIT 1;`,
        [tenantId, refTargets]
      );
      if (refMsgRows.length > 0) {
        conversation = await getConversation(tenantId, refMsgRows[0].conversation_id);
      }
    }
  }

  // C. Search recent open conversation by customer email & normalized subject
  if (!conversation) {
    const cleanSubject = msg.subject.replace(/^(re|fwd|fw):\s*/i, '').trim();
    const subConvRows = await query<ConversationRecord>(
      `SELECT * FROM iao.conversations
       WHERE tenant_id = $1 AND LOWER(customer_email) = LOWER($2) AND status != 'archived'
         AND (subject ILIKE $3 OR $3 ILIKE '%' || subject || '%')
       ORDER BY last_message_at DESC
       LIMIT 1;`,
      [tenantId, msg.senderEmail, `%${cleanSubject}%`]
    );
    if (subConvRows.length > 0) {
      conversation = subConvRows[0];
      // Bind thread ID to conversation if not set
      if (!conversation.external_thread_id && msg.threadId) {
        await query(
          `UPDATE iao.conversations SET external_thread_id = $1 WHERE id = $2;`,
          [msg.threadId, conversation.id]
        );
        conversation.external_thread_id = msg.threadId;
      }
    }
  }

  // D. Create new conversation if none matched
  if (!conversation) {
    const newConvId = `conv-gm-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const newSubject = msg.subject || `Inquiry from ${msg.senderName}`;
    const insertConvRows = await query<ConversationRecord>(
      `INSERT INTO iao.conversations 
        (id, tenant_id, customer_name, customer_email, channel, external_thread_id, status, subject, unread, last_message_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'gmail', $5, 'open', $6, true, $7, $7, NOW())
       RETURNING *;`,
      [
        newConvId,
        tenantId,
        msg.senderName,
        msg.senderEmail,
        msg.threadId || null,
        newSubject,
        msg.date,
      ]
    );
    conversation = insertConvRows[0];
  }

  // 3. Insert customer message
  const newMsgId = `msg-gm-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const metadataPayload = {
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId,
    rfc_message_id: msg.rfcMessageId || null,
    in_reply_to: msg.inReplyTo || null,
    references: msg.references || null,
    has_attachments: msg.hasAttachments,
    is_automated: msg.isAutomated,
    body_html: msg.bodyHtml || null,
  };

  const insertMsgRows = await query<MessageRecord>(
    `INSERT INTO iao.messages 
      (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
     VALUES ($1, $2, $3, 'customer', $4, $5, $6, 'received', 'none', $7::jsonb, $8)
     RETURNING *;`,
    [
      newMsgId,
      conversation.id,
      tenantId,
      msg.senderName,
      msg.senderEmail,
      msg.bodyText,
      JSON.stringify(metadataPayload),
      msg.date,
    ]
  );
  const insertedMsg = insertMsgRows[0];

  // 3b. Automatically cancel active Services lead follow-ups upon receiving inbound customer reply via Gmail
  try {
    const matchedLeads = await query<{ id: string }>(
      `SELECT id FROM iao.services_leads 
       WHERE tenant_id = $1 AND (conversation_id = $2 OR LOWER(customer_email) = LOWER($3))
       ORDER BY created_at DESC LIMIT 1;`,
      [tenantId, conversation.id, msg.senderEmail]
    );
    if (matchedLeads.length > 0) {
      const leadId = matchedLeads[0].id;
      await cancelServicesLeadFollowup({
        tenantId,
        leadId,
        reason: 'Customer replied via Gmail message',
      });
      await addServicesLeadEvent(tenantId, leadId, {
        event_type: 'customer_replied',
        actor_type: 'customer',
        summary: `Customer reply received via Gmail (${msg.subject || 'Re: Inquiry'}). Pending follow-ups automatically cancelled.`,
        details: { gmail_message_id: msg.id, conversation_id: conversation.id },
      });
    }
  } catch (cancelErr) {
    console.warn('[Services Lead Followup Cancel on Gmail Warning]', cancelErr);
  }

  // 4. Retrieve conversation message history for loop evaluation
  const conversationMessages = await listMessages(tenantId, conversation.id);

  // 5. Retrieve business settings, active Gmail connection, and verified orders
  const business = await getBusiness(tenantId);
  const settings = business?.settings || getDefaultBusinessSettings(tenantId);
  const { connection } = await getGmailConnection(tenantId);
  const connectedEmail = connection?.google_email;
  const orders = await listOrders(tenantId);

  // 6. Fast Gate: Classify whether incoming email is an automated or non-customer notification
  const emailClassification = classifyEmailMessage({
    senderEmail: msg.senderEmail,
    senderName: msg.senderName,
    subject: msg.subject,
    bodyText: msg.bodyText,
    isAutomatedHeader: msg.isAutomated,
  });

  if (emailClassification.isNonCustomer) {
    // Non-customer notification, OTP, security alert, payment/wallet notification, or bounce message ignored
    await query(
      `UPDATE iao.conversations
       SET last_message_at = NOW(), unread = false, status = 'ignored', updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2;`,
      [tenantId, conversation.id]
    );

    await insertAudit(tenantId, 'gmail_automated_message_ignored', {
      conversation_id: conversation.id,
      message_id: newMsgId,
      sender_email: msg.senderEmail,
      reason: emailClassification.reason,
    });
    return { isNew: false, conversation, message: insertedMsg };
  }

  // 7. Check if message is a genuine Order Issue
  const issueDetection = detectOrderIssue({
    subject: msg.subject,
    bodyText: msg.bodyText,
    senderEmail: msg.senderEmail,
    senderName: msg.senderName,
    orders,
    isAutomated: msg.isAutomated,
  });

  let aiDraftMsg: MessageRecord | null = null;
  let autoDispatchedMsg: MessageRecord | null = null;

  if (issueDetection.isIssue && issueDetection.issueType) {
    // Process Order Issue Resolution & Grounded Investigation
    const existingIssue = await getOrderIssueByConversation(tenantId, conversation.id);
    const shopConn = await getShopifyConnection(tenantId);
    const inv = investigateOrderData(
      issueDetection.verifiedOrder || null,
      issueDetection.issueType,
      issueDetection.customerClaimText
    );

    let targetIssue: OrderIssueRecord;

    if (existingIssue && existingIssue.status !== 'resolved' && existingIssue.status !== 'closed') {
      await addOrderIssueEvent({
        tenantId,
        issueId: existingIssue.id,
        eventType: 'customer_replied',
        actorType: 'customer',
        summary: `Customer reply received regarding ${existingIssue.issue_type.replace(/_/g, ' ')}`,
        details: {
          message_id: newMsgId,
          claim_text: issueDetection.customerClaimText,
          order_id: issueDetection.orderId || existingIssue.order_id,
        },
      });

      // Cancel customer clarification reminders since customer replied
      await cancelPendingFollowupsForIssue(
        tenantId,
        existingIssue.id,
        'Customer reply received',
        ['awaiting_customer_clarification', 'awaiting_customer_photos']
      );

      const updated = await updateOrderIssue(
        tenantId,
        existingIssue.id,
        {
          order_id: issueDetection.verifiedOrder?.order_id || existingIssue.order_id,
          evidence: inv.evidence,
          next_action: inv.nextAction,
          responsible_party: inv.responsibleParty,
        },
        {
          actorType: 'ai_operator',
          summary: `Updated issue evidence from customer reply.`,
        }
      );
      targetIssue = updated || existingIssue;

      // If issue is awaiting owner review, ensure an owner reminder job is active
      if (targetIssue.status === 'awaiting_owner' || targetIssue.status === 'action_pending') {
        const existingOwnerJobs = await query<OrderIssueFollowupJobRecord>(
          `SELECT * FROM iao.order_issue_followup_jobs
           WHERE tenant_id = $1 AND issue_id = $2 AND followup_type = 'awaiting_owner_review' AND status IN ('pending', 'claimed')
           LIMIT 1;`,
          [tenantId, targetIssue.id]
        );
        if (existingOwnerJobs.length === 0) {
          const intervalHours = settings.order_issues_config?.followup_interval_hours || 24;
          const maxAttempts = settings.order_issues_config?.max_followup_attempts || 2;
          await scheduleOrderIssueFollowup({
            tenantId,
            issueId: targetIssue.id,
            conversationId: conversation.id,
            followupType: 'awaiting_owner_review',
            delayHours: intervalHours,
            maxAttempts,
          });
        }
      }
    } else {
      targetIssue = await createOrderIssue({
        tenantId,
        issueType: issueDetection.issueType,
        status: inv.initialStatus,
        orderId: issueDetection.orderId || null,
        shopDomain: shopConn?.shop_domain || null,
        conversationId: conversation.id,
        customerName: msg.senderName || 'Customer',
        customerEmail: msg.senderEmail,
        evidence: inv.evidence,
        nextAction: inv.nextAction,
        responsibleParty: inv.responsibleParty,
      });

      const intervalHours = settings.order_issues_config?.followup_interval_hours || 24;
      const maxAttempts = settings.order_issues_config?.max_followup_attempts || 2;

      if (inv.initialStatus === 'awaiting_customer') {
        await scheduleOrderIssueFollowup({
          tenantId,
          issueId: targetIssue.id,
          conversationId: conversation.id,
          followupType: 'awaiting_customer_clarification',
          delayHours: intervalHours,
          maxAttempts,
        });
      } else if (inv.initialStatus === 'awaiting_owner' || inv.initialStatus === 'action_pending') {
        await scheduleOrderIssueFollowup({
          tenantId,
          issueId: targetIssue.id,
          conversationId: conversation.id,
          followupType: 'awaiting_owner_review',
          delayHours: intervalHours,
          maxAttempts,
        });
      } else if (inv.initialStatus === 'investigating' && inv.evidence?.carrier) {
        await scheduleOrderIssueFollowup({
          tenantId,
          issueId: targetIssue.id,
          conversationId: conversation.id,
          followupType: 'awaiting_carrier_update',
          delayHours: intervalHours,
          maxAttempts,
        });
      }
    }

    const hasPersistedTask = Boolean(inv.evidence?.owner_tasks && inv.evidence.owner_tasks.length > 0);
    const effectiveBizName = settings.display_name_override || settings.business_name || 'Customer Support';
    const ackBodyText = buildOrderIssueAcknowledgment({
      issueType: issueDetection.issueType,
      order: issueDetection.verifiedOrder || null,
      evidence: inv.evidence,
      customerName: msg.senderName,
      businessName: effectiveBizName,
      hasPersistedTask,
    });

    const isFinancialOrMajorAction =
      issueDetection.issueType === 'refund_request' ||
      issueDetection.issueType === 'exchange_request' ||
      issueDetection.issueType === 'cancellation_request';

    const mode = settings.automation_mode || 'auto_routine';

    if (mode === 'paused') {
      await query(
        `UPDATE iao.conversations
         SET last_message_at = NOW(), unread = true, status = 'open', updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2;`,
        [tenantId, conversation.id]
      );
      await insertAudit(tenantId, 'automation_paused_inquiry_ingested', {
        conversation_id: conversation.id,
        message_id: newMsgId,
        sender_email: msg.senderEmail,
        reason: 'Automation paused by business owner settings.',
      });
    } else if (isFinancialOrMajorAction || mode === 'draft_only') {
      const aiMsgId = `msg-ai-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
      const aiDraftRows = await query<MessageRecord>(
        `INSERT INTO iao.messages
          (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
         VALUES ($1, $2, $3, 'ai_draft', 'AI Operator', NULL, $4, 'draft', 'pending_approval', $5::jsonb, NOW())
         RETURNING *;`,
        [
          aiMsgId,
          conversation.id,
          tenantId,
          ackBodyText,
          JSON.stringify({
            draft_revision: 1,
            issue_id: targetIssue.id,
            issue_type: issueDetection.issueType,
            financial_action: isFinancialOrMajorAction,
            requires_approval_reason: isFinancialOrMajorAction
              ? 'Financial or major operational action requires store owner approval.'
              : 'Draft-only mode configured in business settings.',
            target_gmail_thread_id: msg.threadId,
            target_rfc_message_id: msg.rfcMessageId,
          }),
        ]
      );
      aiDraftMsg = aiDraftRows[0] || null;

      await query(
        `UPDATE iao.conversations
         SET last_message_at = NOW(), unread = true, status = 'pending_approval', updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2;`,
        [tenantId, conversation.id]
      );

      await insertAudit(tenantId, 'ai_draft_reply_generated', {
        conversation_id: conversation.id,
        message_id: aiMsgId,
        issue_id: targetIssue.id,
        recipient: msg.senderEmail,
        issue_type: issueDetection.issueType,
      });
    } else {
      // Automatic routine issue acknowledgment (delivery delay / not received / damage clarification)
      const { connection: freshConn, decryptedAccessToken, needsReconnect } = await getGmailConnection(tenantId);
      const freshBiz = await getBusiness(tenantId);
      const replySubject = msg.subject.toLowerCase().startsWith('re:') ? msg.subject : `Re: ${msg.subject}`;
      const autoSenderName = effectiveBizName;

      const issueDispatchGuard = validateOutboundDispatch({
        tenantId,
        senderEmail: freshConn?.google_email || '',
        recipientEmail: msg.senderEmail,
        isAutomated: true,
        approvalStatus: 'none',
        pilotWhitelist: (freshBiz?.settings?.pilot_whitelist || settings?.pilot_whitelist) as any,
        automationMode: (freshBiz?.settings?.automation_mode || settings?.automation_mode),
      });

      if (issueDispatchGuard.allowed && !needsReconnect && decryptedAccessToken && freshConn) {
        const fromAddress = `${autoSenderName} <${freshConn.google_email}>`;
        const sendResult = await sendGmailReply({
          accessToken: decryptedAccessToken,
          to: msg.senderEmail,
          from: fromAddress,
          subject: replySubject,
          text: ackBodyText,
          threadId: msg.threadId,
          inReplyToMessageId: msg.rfcMessageId,
          referencesMessageId: msg.references || msg.rfcMessageId,
        });

        if (sendResult.success) {
          const autoMsgId = `msg-auto-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
          const autoMetadata = {
            auto_dispatched: true,
            issue_id: targetIssue.id,
            issue_type: issueDetection.issueType,
            provider_message_id: sendResult.providerMessageId,
            target_gmail_thread_id: msg.threadId,
            target_rfc_message_id: msg.rfcMessageId,
          };

          const autoMsgRows = await query<MessageRecord>(
            `INSERT INTO iao.messages
              (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
             VALUES ($1, $2, $3, 'agent', $4, $5, $6, 'provider_accepted', 'none', $7::jsonb, NOW())
             RETURNING *;`,
            [
              autoMsgId,
              conversation.id,
              tenantId,
              `${autoSenderName} (AI Operator)`,
              freshConn.google_email,
              ackBodyText,
              JSON.stringify(autoMetadata),
            ]
          );
          autoDispatchedMsg = autoMsgRows[0];

          await createMessageDispatch({
            message_id: autoMsgId,
            conversation_id: conversation.id,
            tenant_id: tenantId,
            idempotency_key: `auto-${newMsgId}-${Date.now().toString(36)}`,
            provider: 'gmail',
            status: 'provider_accepted',
            recipient_email: msg.senderEmail,
            sender_email: freshConn.google_email,
            sender_name: autoSenderName,
            subject: replySubject,
            body_text: ackBodyText,
            metadata: autoMetadata,
          });

          await query(
            `UPDATE iao.conversations
             SET last_message_at = NOW(), unread = false, status = 'open', updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2;`,
            [tenantId, conversation.id]
          );

          await insertAudit(tenantId, 'order_issue_acknowledgment_dispatched', {
            conversation_id: conversation.id,
            issue_id: targetIssue.id,
            message_id: autoMsgId,
            recipient: msg.senderEmail,
            issue_type: issueDetection.issueType,
          });
        }
      } else if (issueDispatchGuard.action === 'draft_required') {
        const aiMsgId = `msg-ai-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
        const aiDraftRows = await query<MessageRecord>(
          `INSERT INTO iao.messages
            (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
           VALUES ($1, $2, $3, 'ai_draft', 'AI Operator', NULL, $4, 'draft', 'pending_approval', $5::jsonb, NOW())
           RETURNING *;`,
          [
            aiMsgId,
            conversation.id,
            tenantId,
            ackBodyText,
            JSON.stringify({
              draft_revision: 1,
              issue_id: targetIssue.id,
              issue_type: issueDetection.issueType,
              requires_approval_reason: issueDispatchGuard.reason,
              target_gmail_thread_id: msg.threadId,
              target_rfc_message_id: msg.rfcMessageId,
            }),
          ]
        );
        aiDraftMsg = aiDraftRows[0] || null;

        await query(
          `UPDATE iao.conversations
           SET last_message_at = NOW(), unread = true, status = 'pending_approval', updated_at = NOW()
           WHERE tenant_id = $1 AND id = $2;`,
          [tenantId, conversation.id]
        );

        await insertAudit(tenantId, 'ai_draft_reply_generated', {
          conversation_id: conversation.id,
          message_id: aiMsgId,
          issue_id: targetIssue.id,
          recipient: msg.senderEmail,
          issue_type: issueDetection.issueType,
          reason: issueDispatchGuard.reason,
        });
      } else if (issueDispatchGuard.action === 'block') {
        // Blocked fail-closed (off-whitelist or automation paused)
        await insertAudit(tenantId, 'outbound_dispatch_blocked', {
          conversation_id: conversation.id,
          issue_id: targetIssue.id,
          recipient: msg.senderEmail,
          sender: freshConn?.google_email || 'none',
          reason: issueDispatchGuard.reason,
          action: 'issue_acknowledgment',
        });
      } else {
        // Simulated mode
        const autoMsgId = `msg-auto-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
        const autoMetadata = {
          auto_dispatched: true,
          is_simulated: true,
          issue_id: targetIssue.id,
          issue_type: issueDetection.issueType,
          target_gmail_thread_id: msg.threadId,
          target_rfc_message_id: msg.rfcMessageId,
        };

        const autoMsgRows = await query<MessageRecord>(
          `INSERT INTO iao.messages
            (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
           VALUES ($1, $2, $3, 'agent', $4, NULL, $5, 'simulated_demo', 'none', $6::jsonb, NOW())
           RETURNING *;`,
          [
            autoMsgId,
            conversation.id,
            tenantId,
            `${autoSenderName} (AI Operator)`,
            ackBodyText,
            JSON.stringify(autoMetadata),
          ]
        );
        autoDispatchedMsg = autoMsgRows[0];

        await createMessageDispatch({
          message_id: autoMsgId,
          conversation_id: conversation.id,
          tenant_id: tenantId,
          idempotency_key: `auto-${newMsgId}-${Date.now().toString(36)}`,
          provider: 'gmail',
          status: 'simulated_demo',
          recipient_email: msg.senderEmail,
          sender_email: 'demo-operator@demo-store.com',
          sender_name: autoSenderName,
          subject: replySubject,
          body_text: ackBodyText,
          metadata: autoMetadata,
        });

        await query(
          `UPDATE iao.conversations
           SET last_message_at = NOW(), unread = false, status = 'open', updated_at = NOW()
           WHERE tenant_id = $1 AND id = $2;`,
          [tenantId, conversation.id]
        );

        await insertAudit(tenantId, 'order_issue_acknowledgment_simulated', {
          conversation_id: conversation.id,
          issue_id: targetIssue.id,
          message_id: autoMsgId,
          recipient: msg.senderEmail,
          issue_type: issueDetection.issueType,
        });
      }
    }

    if (aiDraftMsg) {
      await syncPendingConversationCases(tenantId);
    }

    return {
      isNew: true,
      conversation,
      message: insertedMsg,
      aiDraft: aiDraftMsg,
      autoDispatchedReply: autoDispatchedMsg,
    };
  }

  // 8. Routine Inquiry Evaluation (For general FAQs, hours, policies, standard product lookups, etc.)
  const evaluation = evaluateRoutineInquiry({
    subject: msg.subject,
    bodyText: msg.bodyText,
    senderName: msg.senderName,
    senderEmail: msg.senderEmail,
    connectedEmail,
    isAutomated: msg.isAutomated,
    settings,
    conversationMessages,
    orders,
    channel: 'gmail',
    isLiveChannel: true,
  });

  if (evaluation.intent === 'ignored_automated') {
    await query(
      `UPDATE iao.conversations
       SET last_message_at = NOW(), unread = false, status = 'ignored', updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2;`,
      [tenantId, conversation.id]
    );

    await insertAudit(tenantId, 'gmail_automated_message_ignored', {
      conversation_id: conversation.id,
      message_id: newMsgId,
      sender_email: msg.senderEmail,
      reason: evaluation.reason,
    });
    return { isNew: false, conversation, message: insertedMsg, evaluation };
  } else if (evaluation.intent === 'paused') {
    await query(
      `UPDATE iao.conversations
       SET last_message_at = NOW(), unread = true, status = 'open', updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2;`,
      [tenantId, conversation.id]
    );

    await insertAudit(tenantId, 'automation_paused_inquiry_ingested', {
      conversation_id: conversation.id,
      message_id: newMsgId,
      sender_email: msg.senderEmail,
      reason: evaluation.reason,
    });
  } else if (evaluation.canAutoReply && evaluation.replyText) {
    const finalFilter = classifyEmailMessage({
      senderEmail: msg.senderEmail,
      senderName: msg.senderName,
      subject: msg.subject,
      bodyText: msg.bodyText,
      isAutomatedHeader: msg.isAutomated,
    });

    if (finalFilter.isNonCustomer) {
      await query(
        `UPDATE iao.conversations
         SET last_message_at = NOW(), unread = false, status = 'ignored', updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2;`,
        [tenantId, conversation.id]
      );
      return { isNew: false, conversation, message: insertedMsg, evaluation };
    }

    const { connection: freshConn, decryptedAccessToken, needsReconnect } = await getGmailConnection(tenantId);
    const freshBiz = await getBusiness(tenantId);
    const isStillAutoMode = (freshBiz?.settings?.automation_mode || 'auto_routine') === 'auto_routine';

    const routineDispatchGuard = validateOutboundDispatch({
      tenantId,
      senderEmail: freshConn?.google_email || '',
      recipientEmail: msg.senderEmail,
      isAutomated: true,
      approvalStatus: 'none',
      pilotWhitelist: (freshBiz?.settings?.pilot_whitelist || settings?.pilot_whitelist) as any,
      automationMode: (freshBiz?.settings?.automation_mode || settings?.automation_mode),
    });

    if (routineDispatchGuard.allowed && isStillAutoMode && !needsReconnect && decryptedAccessToken && freshConn) {
      const effectiveBizName = freshBiz?.settings?.display_name_override || freshBiz?.settings?.business_name || settings.business_name || 'Customer Support';
      const autoSenderName = effectiveBizName;
      const fromAddress = `${autoSenderName} <${freshConn.google_email}>`;
      const replySubject = msg.subject.toLowerCase().startsWith('re:') ? msg.subject : `Re: ${msg.subject}`;

      const sendResult = await sendGmailReply({
        accessToken: decryptedAccessToken,
        to: msg.senderEmail,
        from: fromAddress,
        subject: replySubject,
        text: evaluation.replyText,
        threadId: msg.threadId,
        inReplyToMessageId: msg.rfcMessageId,
        referencesMessageId: msg.references || msg.rfcMessageId,
      });

      if (sendResult.success) {
        const autoMsgId = `msg-auto-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
        const autoMetadata = {
          auto_dispatched: true,
          routine_intent: evaluation.intent,
          grounded_sources: evaluation.groundedSources,
          reason: evaluation.reason,
          provider_message_id: sendResult.providerMessageId,
          target_gmail_thread_id: msg.threadId,
          target_rfc_message_id: msg.rfcMessageId,
        };

        const autoMsgRows = await query<MessageRecord>(
          `INSERT INTO iao.messages
            (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
           VALUES ($1, $2, $3, 'agent', $4, $5, $6, 'provider_accepted', 'none', $7::jsonb, NOW())
           RETURNING *;`,
          [
            autoMsgId,
            conversation.id,
            tenantId,
            `${autoSenderName} (AI Operator)`,
            freshConn.google_email,
            evaluation.replyText,
            JSON.stringify(autoMetadata),
          ]
        );
        autoDispatchedMsg = autoMsgRows[0];

        const idempotencyKey = `auto-${newMsgId}-${Date.now().toString(36)}`;
        await createMessageDispatch({
          message_id: autoMsgId,
          conversation_id: conversation.id,
          tenant_id: tenantId,
          idempotency_key: idempotencyKey,
          provider: 'gmail',
          status: 'provider_accepted',
          recipient_email: msg.senderEmail,
          sender_email: freshConn.google_email,
          sender_name: autoSenderName,
          subject: replySubject,
          body_text: evaluation.replyText,
          metadata: {
            auto_dispatched: true,
            routine_intent: evaluation.intent,
            grounded_sources: evaluation.groundedSources,
            provider_message_id: sendResult.providerMessageId,
          },
        });

        await query(
          `UPDATE iao.conversations
           SET last_message_at = NOW(), unread = false, status = 'open', updated_at = NOW()
           WHERE tenant_id = $1 AND id = $2;`,
          [tenantId, conversation.id]
        );

        await insertAudit(tenantId, 'automatic_routine_reply_dispatched', {
          conversation_id: conversation.id,
          message_id: autoMsgId,
          recipient: msg.senderEmail,
          intent: evaluation.intent,
          grounded_sources: evaluation.groundedSources,
          reason: evaluation.reason,
          provider_message_id: sendResult.providerMessageId,
        });
      } else {
        const aiMsgId = `msg-ai-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
        const fallbackDraft = evaluation.replyText;
        const aiDraftRows = await query<MessageRecord>(
          `INSERT INTO iao.messages
            (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
           VALUES ($1, $2, $3, 'ai_draft', 'AI Operator', NULL, $4, 'draft', 'pending_approval', $5::jsonb, NOW())
           RETURNING *;`,
          [
            aiMsgId,
            conversation.id,
            tenantId,
            fallbackDraft,
            JSON.stringify({
              draft_revision: 1,
              routine_intent: evaluation.intent,
              requires_approval_reason: `Auto-send encountered provider error: ${sendResult.error}. Switched to draft for owner review.`,
              grounded_sources: evaluation.groundedSources,
              target_gmail_thread_id: msg.threadId,
              target_rfc_message_id: msg.rfcMessageId,
            }),
          ]
        );
        aiDraftMsg = aiDraftRows[0];

        await query(
          `UPDATE iao.conversations
           SET last_message_at = NOW(), unread = true, status = 'pending_approval', updated_at = NOW()
           WHERE tenant_id = $1 AND id = $2;`,
          [tenantId, conversation.id]
        );
      }
    } else if (routineDispatchGuard.action === 'draft_required') {
      const aiMsgId = `msg-ai-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
      const fallbackDraft = evaluation.replyText;
      const aiDraftRows = await query<MessageRecord>(
        `INSERT INTO iao.messages
          (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
         VALUES ($1, $2, $3, 'ai_draft', 'AI Operator', NULL, $4, 'draft', 'pending_approval', $5::jsonb, NOW())
         RETURNING *;`,
        [
          aiMsgId,
          conversation.id,
          tenantId,
          fallbackDraft,
          JSON.stringify({
            draft_revision: 1,
            routine_intent: evaluation.intent,
            requires_approval_reason: routineDispatchGuard.reason,
            grounded_sources: evaluation.groundedSources,
            target_gmail_thread_id: msg.threadId,
            target_rfc_message_id: msg.rfcMessageId,
          }),
        ]
      );
      aiDraftMsg = aiDraftRows[0];

      await query(
        `UPDATE iao.conversations
         SET last_message_at = NOW(), unread = true, status = 'pending_approval', updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2;`,
        [tenantId, conversation.id]
      );

      await insertAudit(tenantId, 'ai_draft_reply_generated', {
        conversation_id: conversation.id,
        message_id: aiMsgId,
        recipient: msg.senderEmail,
        intent: evaluation.intent,
        reason: routineDispatchGuard.reason,
      });
    } else if (routineDispatchGuard.action === 'block') {
      // Live dispatch blocked fail-closed (off-whitelist or automation paused)
      await insertAudit(tenantId, 'outbound_dispatch_blocked', {
        conversation_id: conversation.id,
        recipient: msg.senderEmail,
        sender: freshConn?.google_email || 'none',
        reason: routineDispatchGuard.reason,
        intent: evaluation.intent,
        action: 'routine_reply',
      });
    } else if (isStillAutoMode) {
      const autoSenderName = settings.business_name || 'Customer Support';
      const autoMsgId = `msg-auto-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
      const replySubject = msg.subject.toLowerCase().startsWith('re:') ? msg.subject : `Re: ${msg.subject}`;
      const autoMetadata = {
        auto_dispatched: true,
        is_simulated: true,
        routine_intent: evaluation.intent,
        grounded_sources: evaluation.groundedSources,
        reason: evaluation.reason,
        target_gmail_thread_id: msg.threadId,
        target_rfc_message_id: msg.rfcMessageId,
      };

      const autoMsgRows = await query<MessageRecord>(
        `INSERT INTO iao.messages
          (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
         VALUES ($1, $2, $3, 'agent', $4, NULL, $5, 'simulated_demo', 'none', $6::jsonb, NOW())
         RETURNING *;`,
        [
          autoMsgId,
          conversation.id,
          tenantId,
          `${autoSenderName} (AI Operator)`,
          evaluation.replyText,
          JSON.stringify(autoMetadata),
        ]
      );
      autoDispatchedMsg = autoMsgRows[0];

      const idempotencyKey = `auto-${newMsgId}-${Date.now().toString(36)}`;
      await createMessageDispatch({
        message_id: autoMsgId,
        conversation_id: conversation.id,
        tenant_id: tenantId,
        idempotency_key: idempotencyKey,
        provider: 'gmail',
        status: 'simulated_demo',
        recipient_email: msg.senderEmail,
        sender_email: 'demo-operator@demo-store.com',
        sender_name: autoSenderName,
        subject: replySubject,
        body_text: evaluation.replyText,
        metadata: {
          auto_dispatched: true,
          is_simulated: true,
          routine_intent: evaluation.intent,
          grounded_sources: evaluation.groundedSources,
        },
      });

      await query(
        `UPDATE iao.conversations
         SET last_message_at = NOW(), unread = false, status = 'open', updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2;`,
        [tenantId, conversation.id]
      );

      await insertAudit(tenantId, 'automatic_routine_reply_simulated', {
        conversation_id: conversation.id,
        message_id: autoMsgId,
        recipient: msg.senderEmail,
        intent: evaluation.intent,
        grounded_sources: evaluation.groundedSources,
        reason: evaluation.reason,
      });
    } else {
      const aiMsgId = `msg-ai-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
      const fallbackDraft = evaluation.replyText;
      const aiDraftRows = await query<MessageRecord>(
        `INSERT INTO iao.messages
          (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
         VALUES ($1, $2, $3, 'ai_draft', 'AI Operator', NULL, $4, 'draft', 'pending_approval', $5::jsonb, NOW())
         RETURNING *;`,
        [
          aiMsgId,
          conversation.id,
          tenantId,
          fallbackDraft,
          JSON.stringify({
            draft_revision: 1,
            routine_intent: evaluation.intent,
            requires_approval_reason: 'Draft-only mode configured in business settings.',
            grounded_sources: evaluation.groundedSources,
            target_gmail_thread_id: msg.threadId,
            target_rfc_message_id: msg.rfcMessageId,
          }),
        ]
      );
      aiDraftMsg = aiDraftRows[0];

      await query(
        `UPDATE iao.conversations
         SET last_message_at = NOW(), unread = true, status = 'pending_approval', updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2;`,
        [tenantId, conversation.id]
      );
    }
  } else {
    // 9. Financial Action, Ambiguous Inquiry, Loop Prevented, or Draft-Only Mode -> Create Draft Requiring Approval
    const draftText =
      evaluation.acknowledgmentDraftText ||
      evaluation.replyText ||
      `Hello ${msg.senderName.split(' ')[0] || 'there'},\n\nThank you for contacting ${settings.business_name || 'Customer Support'}. We have received your email regarding "${msg.subject}".\n\nOur team is reviewing your request and will follow up shortly.\n\nBest regards,\n${settings.business_name || 'Customer Support'} Team`;

    const aiMsgId = `msg-ai-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const aiDraftRows = await query<MessageRecord>(
      `INSERT INTO iao.messages
        (id, conversation_id, tenant_id, sender_type, sender_name, sender_email, body, status, approval_status, metadata, created_at)
       VALUES ($1, $2, $3, 'ai_draft', 'AI Operator', NULL, $4, 'draft', 'pending_approval', $5::jsonb, NOW())
       RETURNING *;`,
      [
        aiMsgId,
        conversation.id,
        tenantId,
        draftText,
        JSON.stringify({
          draft_revision: 1,
          routine_intent: evaluation.intent,
          requires_approval_reason: evaluation.reason,
          grounded_sources: evaluation.groundedSources,
          financial_action: evaluation.financialOrMajorAction,
          target_gmail_thread_id: msg.threadId,
          target_rfc_message_id: msg.rfcMessageId,
        }),
      ]
    );
    aiDraftMsg = aiDraftRows[0] || null;

    await query(
      `UPDATE iao.conversations
       SET last_message_at = NOW(), unread = true, status = 'pending_approval', updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2;`,
      [tenantId, conversation.id]
    );

    await insertAudit(tenantId, 'ai_draft_reply_generated', {
      conversation_id: conversation.id,
      message_id: aiMsgId,
      recipient: msg.senderEmail,
      intent: evaluation.intent,
      requires_approval_reason: evaluation.reason,
      financial_action: evaluation.financialOrMajorAction,
    });
  }

  await insertAudit(tenantId, 'gmail_message_ingested', {
    conversation_id: conversation.id,
    message_id: newMsgId,
    gmail_message_id: msg.id,
    sender_email: msg.senderEmail,
    is_automated: msg.isAutomated,
    intent: evaluation.intent,
    can_auto_reply: evaluation.canAutoReply,
  });

  if (aiDraftMsg) {
    await syncPendingConversationCases(tenantId);
  }

  return {
    isNew: true,
    conversation,
    message: insertedMsg,
    aiDraft: aiDraftMsg,
    autoDispatchedReply: autoDispatchedMsg,
    evaluation,

  };
}

// ==========================================
// 12. Shopify Integration Database Methods
// ==========================================

export async function saveShopifyConnection(
  tenantId: string,
  params: {
    shop_domain: string;
    access_token: string;
    scope?: string;
    store_info?: Record<string, unknown>;
  }
): Promise<ShopifyConnectionRecord> {
  const encToken = encryptSecret(params.access_token);
  const scope = params.scope || 'read_products,read_orders,read_inventory,read_locations';
  const storeInfoJson = JSON.stringify(params.store_info || {});

  const rows = await query<ShopifyConnectionRecord>(
    `INSERT INTO iao.shopify_connections
      (tenant_id, shop_domain, encrypted_access_token, scope, is_connected, sync_status, last_error, store_info, created_at, updated_at)
     VALUES ($1, $2, $3, $4, true, 'idle', NULL, $5::jsonb, NOW(), NOW())
     ON CONFLICT (tenant_id)
     DO UPDATE SET
       shop_domain = EXCLUDED.shop_domain,
       encrypted_access_token = EXCLUDED.encrypted_access_token,
       scope = EXCLUDED.scope,
       is_connected = true,
       sync_status = 'idle',
       last_error = NULL,
       store_info = EXCLUDED.store_info,
       updated_at = NOW()
     RETURNING *;`,
    [tenantId, params.shop_domain, encToken, scope, storeInfoJson]
  );

  // Sync business settings connections.website and profile attributes
  const business = await getBusiness(tenantId);
  if (business) {
    const storeInfo = (params.store_info || {}) as Record<string, unknown>;
    const storeName = String(storeInfo.name || '').trim();
    const storeCurrency = String(storeInfo.currency || '').trim();
    const storeTimezone = String(storeInfo.iana_timezone || storeInfo.timezone || '').trim();
    const storeCountry = String(storeInfo.country_name || storeInfo.country || '').trim();

    const currentName = business.settings.business_name;
    const hasCustomNameOverride = Boolean(business.settings.display_name_override);

    const updatedSettings: BusinessSettings = {
      ...business.settings,
      business_name: !hasCustomNameOverride && storeName && (currentName === 'Demo Clothing Store' || !currentName)
        ? storeName
        : business.settings.business_name,
      currency: storeCurrency || business.settings.currency,
      timezone: storeTimezone || business.settings.timezone,
      country: storeCountry || business.settings.country,
      connections: {
        ...business.settings.connections,
        website: {
          type: 'shopify',
          status: 'connected',
          store_url: `https://${params.shop_domain}`,
          hosted_inquiry_enabled: business.settings.connections?.website?.hosted_inquiry_enabled ?? true,
          last_tested: new Date().toISOString(),
          is_verified: true,
        },
      },
    };
    await updateBusinessSettings(tenantId, updatedSettings);
  }

  await insertAudit(tenantId, 'shopify_connected', {
    shop_domain: params.shop_domain,
    store_name: params.store_info?.name,
  });

  return rows[0];
}

export async function getShopifyConnection(tenantId: string): Promise<(ShopifyConnectionRecord & { access_token: string }) | null> {
  try {
    const rows = await query<ShopifyConnectionRecord>(
      `SELECT tenant_id, shop_domain, encrypted_access_token, scope, is_connected, sync_status, last_synced_at, last_error, store_info, created_at, updated_at
       FROM iao.shopify_connections
       WHERE tenant_id = $1
       LIMIT 1;`,
      [tenantId]
    );

    if (!rows[0] || !rows[0].is_connected) {
      return null;
    }

    const decryptedToken = decryptSecret(rows[0].encrypted_access_token);
    return {
      ...rows[0],
      access_token: decryptedToken,
    };
  } catch (err) {
    console.error('[getShopifyConnection Error]', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function listActiveShopifyTenants(): Promise<Array<{ tenant_id: string; shop_domain: string }>> {
  try {
    const rows = await query<{ tenant_id: string; shop_domain: string }>(
      `SELECT tenant_id, shop_domain
       FROM iao.shopify_connections
       WHERE is_connected = true AND sync_status != 'disconnected';`
    );
    return rows;
  } catch (err) {
    console.error('[listActiveShopifyTenants Error]', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function getPublicShopifyConfig(tenantId: string): Promise<ShopifyPublicConfig> {
  const isConfigured = Boolean(getShopifyOAuthConfig());
  try {
    const connRows = await query<ShopifyConnectionRecord>(
      `SELECT tenant_id, shop_domain, scope, is_connected, sync_status, last_synced_at, last_error, store_info
       FROM iao.shopify_connections
       WHERE tenant_id = $1
       LIMIT 1;`,
      [tenantId]
    );

    const productCountRows = await query<{ count: string }>(
      `SELECT count(*) as count FROM iao.shopify_products WHERE tenant_id = $1;`,
      [tenantId]
    );

    const orderCountRows = await query<{ count: string }>(
      `SELECT count(*) as count FROM iao.orders WHERE tenant_id = $1 AND data->>'source' = 'shopify';`,
      [tenantId]
    );

    const productCount = parseInt(productCountRows[0]?.count || '0', 10);
    const orderCount = parseInt(orderCountRows[0]?.count || '0', 10);

    if (!connRows[0] || !connRows[0].is_connected) {
      return {
        is_connected: false,
        sync_status: 'not_connected',
        is_configured_on_platform: isConfigured,
        product_count: productCount,
        order_count: orderCount,
      };
    }

    const conn = connRows[0];
    const storeInfo = (conn.store_info || {}) as Record<string, unknown>;

    return {
      is_connected: true,
      shop_domain: conn.shop_domain,
      shop_name: String(storeInfo.name || conn.shop_domain),
      currency: String(storeInfo.currency || 'PKR'),
      plan_name: String(storeInfo.plan_name || 'Standard'),
      sync_status: conn.sync_status || 'idle',
      last_synced_at: conn.last_synced_at ? new Date(conn.last_synced_at).toISOString() : null,
      last_error: conn.last_error || null,
      product_count: productCount,
      order_count: orderCount,
      is_configured_on_platform: isConfigured,
    };
  } catch {
    return {
      is_connected: false,
      sync_status: 'not_connected',
      is_configured_on_platform: isConfigured,
      product_count: 0,
      order_count: 0,
    };
  }
}

export async function disconnectShopify(tenantId: string): Promise<void> {
  try {
    await query(
      `UPDATE iao.shopify_connections
       SET is_connected = false, sync_status = 'disconnected', updated_at = NOW()
       WHERE tenant_id = $1;`,
      [tenantId]
    );

    const business = await getBusiness(tenantId);
    if (business) {
      const updatedSettings: BusinessSettings = {
        ...business.settings,
        connections: {
          ...business.settings.connections,
          website: {
            ...business.settings.connections.website,
            status: 'disconnected',
            is_verified: false,
          },
        },
      };
      await updateBusinessSettings(tenantId, updatedSettings);
    }

    await insertAudit(tenantId, 'shopify_disconnected', {
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[disconnectShopify Error]', err instanceof Error ? err.message : err);
  }
}

export async function createShopifySyncJob(params: {
  tenantId: string;
  shopDomain: string;
  syncTypes?: Array<'products' | 'inventory' | 'policies' | 'orders'>;
}): Promise<ShopifySyncJob> {
  const syncTypes = params.syncTypes && params.syncTypes.length > 0
    ? params.syncTypes
    : ['products', 'inventory', 'policies', 'orders'];
  const jobId = `sync_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;

  const initialProgress = {
    products: { processed: 0, failed: 0, has_next_page: true, next_cursor: null },
    orders: { processed: 0, failed: 0, has_next_page: true, next_cursor: null },
    policies: { processed: 0, failed: 0, status: 'pending' },
    inventory: { processed: 0, failed: 0, status: 'pending' },
  };

  const initialSummary = {
    products_synced: 0,
    variants_synced: 0,
    orders_synced: 0,
    policies_synced: 0,
    inventory_items_synced: 0,
    errors_count: 0,
  };

  const rows = await query<ShopifySyncJob>(
    `INSERT INTO iao.shopify_sync_jobs
      (id, tenant_id, shop_domain, status, sync_types, progress, summary, error_details, created_at, updated_at)
     VALUES ($1, $2, $3, 'running', $4, $5::jsonb, $6::jsonb, '[]'::jsonb, NOW(), NOW())
     RETURNING *;`,
    [
      jobId,
      params.tenantId,
      params.shopDomain,
      syncTypes,
      JSON.stringify(initialProgress),
      JSON.stringify(initialSummary),
    ]
  );

  await query(
    `UPDATE iao.shopify_connections
     SET sync_status = 'syncing', updated_at = NOW()
     WHERE tenant_id = $1;`,
    [params.tenantId]
  );

  await insertAudit(params.tenantId, 'shopify_sync_started', {
    job_id: jobId,
    sync_types: syncTypes,
    shop_domain: params.shopDomain,
  });

  return rows[0];
}

export async function getShopifySyncJob(jobId: string, tenantId?: string): Promise<ShopifySyncJob | null> {
  try {
    const queryText = tenantId
      ? `SELECT id, tenant_id, shop_domain, status, sync_types, progress, summary, error_details, created_at, updated_at
         FROM iao.shopify_sync_jobs
         WHERE id = $1 AND tenant_id = $2
         LIMIT 1;`
      : `SELECT id, tenant_id, shop_domain, status, sync_types, progress, summary, error_details, created_at, updated_at
         FROM iao.shopify_sync_jobs
         WHERE id = $1
         LIMIT 1;`;
    const params = tenantId ? [jobId, tenantId] : [jobId];
    const rows = await query<ShopifySyncJob>(queryText, params);
    return rows[0] || null;
  } catch (err) {
    console.error('[getShopifySyncJob Error]', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function updateShopifySyncJob(
  jobId: string,
  update: {
    status?: 'pending' | 'running' | 'completed' | 'partial_failed' | 'failed';
    progress?: Record<string, unknown>;
    summary?: Record<string, unknown>;
    error_details?: Array<Record<string, unknown>>;
  }
): Promise<ShopifySyncJob | null> {
  try {
    const existing = await getShopifySyncJob(jobId);
    if (!existing) return null;

    const newStatus = update.status || existing.status;
    const newProgress = { ...existing.progress, ...(update.progress || {}) };
    const newSummary = { ...existing.summary, ...(update.summary || {}) };
    const newErrors = update.error_details || existing.error_details || [];

    const rows = await query<ShopifySyncJob>(
      `UPDATE iao.shopify_sync_jobs
       SET status = $1, progress = $2::jsonb, summary = $3::jsonb, error_details = $4::jsonb, updated_at = NOW()
       WHERE id = $5
       RETURNING *;`,
      [
        newStatus,
        JSON.stringify(newProgress),
        JSON.stringify(newSummary),
        JSON.stringify(newErrors),
        jobId,
      ]
    );

    // Update connection status
    if (newStatus === 'completed') {
      await query(
        `UPDATE iao.shopify_connections
         SET sync_status = 'success', last_synced_at = NOW(), last_error = NULL, updated_at = NOW()
         WHERE tenant_id = $1;`,
        [existing.tenant_id]
      );
      await insertAudit(existing.tenant_id, 'shopify_sync_completed', {
        job_id: jobId,
        summary: newSummary,
      });
    } else if (newStatus === 'partial_failed') {
      const orderErr = newErrors.find((e: any) => e.type === 'orders' || e.type === 'orders_fetch');
      const lastErr = orderErr
        ? (orderErr as any).message
        : (newErrors.length > 0 ? (newErrors[newErrors.length - 1] as any).message : 'Products synced; order access blocked');
      await query(
        `UPDATE iao.shopify_connections
         SET sync_status = 'partial_failed', last_synced_at = NOW(), last_error = $2, updated_at = NOW()
         WHERE tenant_id = $1;`,
        [existing.tenant_id, lastErr]
      );
      await insertAudit(existing.tenant_id, 'shopify_sync_partial_failure', {
        job_id: jobId,
        error_details: newErrors,
        summary: newSummary,
      });
    } else if (newStatus === 'failed') {
      const lastErr = newErrors.length > 0 ? (newErrors[newErrors.length - 1] as any).message : 'Sync job encountered a fatal error';
      await query(
        `UPDATE iao.shopify_connections
         SET sync_status = 'failed', last_error = $2, updated_at = NOW()
         WHERE tenant_id = $1;`,
        [existing.tenant_id, lastErr]
      );
      await insertAudit(existing.tenant_id, 'shopify_sync_failed', {
        job_id: jobId,
        error_details: newErrors,
      });
    }

    return rows[0] || null;
  } catch (err) {
    console.error('[updateShopifySyncJob Error]', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function listShopifySyncJobs(tenantId: string, limit: number = 10): Promise<ShopifySyncJob[]> {
  try {
    const rows = await query<ShopifySyncJob>(
      `SELECT id, tenant_id, shop_domain, status, sync_types, progress, summary, error_details, created_at, updated_at
       FROM iao.shopify_sync_jobs
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2;`,
      [tenantId, limit]
    );
    return rows;
  } catch (err) {
    console.error('[listShopifySyncJobs Error]', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function upsertShopifyProductsBatch(
  tenantId: string,
  rawProducts: any[]
): Promise<{ count: number; variantsCount: number }> {
  let count = 0;
  let variantsCount = 0;

  for (const p of rawProducts) {
    const shopifyId = String(p.id || p.shopify_product_id);
    const title = String(p.title || 'Untitled Product');
    const handle = p.handle || null;
    const productType = p.product_type || p.productType || '';
    const vendor = p.vendor || '';
    const status = p.status || 'active';
    const rawVariants = Array.isArray(p.variants) ? p.variants : [];
    const options = Array.isArray(p.options) ? p.options : [];

    const normalizedVariants: ShopifyProductVariant[] = rawVariants.map((v: any) => ({
      id: String(v.id || `${shopifyId}-v1`),
      product_id: shopifyId,
      title: String(v.title || 'Default Title'),
      price: v.price || 0,
      sku: v.sku || '',
      inventory_quantity: typeof v.inventory_quantity === 'number' ? v.inventory_quantity : (typeof v.stock_quantity === 'number' ? v.stock_quantity : 10),
      available: v.available ?? ((v.inventory_quantity || 0) > 0),
      barcode: v.barcode || '',
    }));

    variantsCount += normalizedVariants.length;

    await query(
      `INSERT INTO iao.shopify_products
        (tenant_id, shopify_product_id, title, handle, product_type, vendor, status, variants, options, raw_data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, NOW(), NOW())
       ON CONFLICT (tenant_id, shopify_product_id)
       DO UPDATE SET
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
        shopifyId,
        title,
        handle,
        productType,
        vendor,
        status,
        JSON.stringify(normalizedVariants),
        JSON.stringify(options),
        JSON.stringify(p),
      ]
    );
    count++;
  }

  // Materialize synced products into business settings knowledge so manual entry is not needed
  await syncShopifyProductsToKnowledge(tenantId);

  return { count, variantsCount };
}

export async function getShopifyProducts(tenantId: string): Promise<ShopifyProductRecord[]> {
  try {
    const rows = await query<ShopifyProductRecord>(
      `SELECT tenant_id, shopify_product_id, title, handle, product_type, vendor, status, variants, options, raw_data, created_at, updated_at
       FROM iao.shopify_products
       WHERE tenant_id = $1
       ORDER BY updated_at DESC;`,
      [tenantId]
    );
    return rows;
  } catch (err) {
    console.error('[getShopifyProducts Error]', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function syncShopifyProductsToKnowledge(tenantId: string): Promise<void> {
  try {
    const products = await query<ShopifyProductRecord>(
      `SELECT tenant_id, shopify_product_id, title, handle, product_type, vendor, status, variants, options
       FROM iao.shopify_products
       WHERE tenant_id = $1 AND status != 'archived'
       ORDER BY updated_at DESC
       LIMIT 100;`,
      [tenantId]
    );

    const connRows = await query<ShopifyConnectionRecord>(
      `SELECT store_info FROM iao.shopify_connections WHERE tenant_id = $1 AND is_connected = true LIMIT 1;`,
      [tenantId]
    );
    const storeInfo = (connRows[0]?.store_info || {}) as Record<string, unknown>;
    const storeCurrency = String(storeInfo.currency || '').trim();

    const mappedItems: ProductServiceItem[] = [];
    for (const p of products) {
      const variants = Array.isArray(p.variants) ? p.variants : [];
      if (variants.length > 0) {
        for (const v of variants) {
          const variantSuffix = v.title && v.title !== 'Default Title' ? ` (${v.title})` : '';
          const resolvedCurrency = (typeof v.currency === 'string' && v.currency.trim()) ? v.currency.trim() : (storeCurrency || undefined);
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
        const resolvedCurrency = storeCurrency || undefined;
        mappedItems.push({
          id: `sp-${p.shopify_product_id}`,
          name: p.title,
          sku: `SKU-${p.shopify_product_id}`,
          price: 0,
          currency: resolvedCurrency,
          description: p.title,
          in_stock: true,
          stock_quantity: 1,
          is_active: true,
        });
      }
    }

    const business = await getBusiness(tenantId);
    if (business && mappedItems.length > 0) {
      const existingFaqs = business.settings.knowledge?.faqs || [];
      const existingPolicies = business.settings.knowledge?.policies;
      const existingStorePolicies = business.settings.knowledge?.store_policies;
      const existingNonShopifyItems = (business.settings.knowledge?.products_services || []).filter(
        (p) => !p.id.startsWith('sp-')
      );
      const combinedItems = [...mappedItems, ...existingNonShopifyItems];

      const updatedSettings: BusinessSettings = {
        ...business.settings,
        knowledge: {
          ...business.settings.knowledge,
          faqs: existingFaqs,
          products_services: combinedItems,
          policies: existingPolicies,
          store_policies: existingStorePolicies,
        },
      };

      await updateBusinessSettings(tenantId, updatedSettings);
    }
  } catch (err) {
    console.error('[syncShopifyProductsToKnowledge Error]', err instanceof Error ? err.message : err);
  }
}

export async function syncShopifyPoliciesToKnowledge(
  tenantId: string,
  policies: {
    refundPolicy?: string;
    shippingPolicy?: string;
    termsOfService?: string;
    privacyPolicy?: string;
    returnWindowDays?: number;
  }
): Promise<void> {
  try {
    const business = await getBusiness(tenantId);
    if (!business) return;

    const returnWindow = policies.returnWindowDays || business.settings.return_window_days || 14;
    const currentPolicies = business.settings.knowledge?.policies || {};

    const updatedPolicies = {
      ...currentPolicies,
      return_window_days: returnWindow,
      shipping_timeframe: policies.shippingPolicy || currentPolicies.shipping_timeframe || 'Standard delivery takes 2-4 business days.',
      general_rules: policies.refundPolicy || currentPolicies.general_rules || 'Standard return policy applies.',
    };

    const updatedSettings: BusinessSettings = {
      ...business.settings,
      return_window_days: returnWindow,
      knowledge: {
        ...business.settings.knowledge,
        policies: updatedPolicies,
      },
    };

    await updateBusinessSettings(tenantId, updatedSettings);
  } catch (err) {
    console.error('[syncShopifyPoliciesToKnowledge Error]', err instanceof Error ? err.message : err);
  }
}

export async function upsertShopifyOrdersBatch(
  tenantId: string,
  rawOrders: any[]
): Promise<number> {
  let count = 0;
  for (const o of rawOrders) {
    const shopifyOrderId = String(o.id || o.order_id || o.name || '');
    const orderName = o.name || (shopifyOrderId.startsWith('#') ? shopifyOrderId : `ORD-${shopifyOrderId}`);
    const customerEmail = o.email || o.customer?.email || o.contact_email || null;
    const customerName = o.customer
      ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() || o.customer.name
      : o.shipping_address?.name || null;

    const lineItems = Array.isArray(o.line_items) ? o.line_items : (Array.isArray(o.items) ? o.items : []);
    const items = lineItems.map((li: any) => ({
      name: li.title || li.name || 'Product',
      title: li.title || li.name || 'Product',
      sku: li.sku || '',
      qty: li.quantity || li.qty || 1,
      quantity: li.quantity || li.qty || 1,
      price: parseFloat(li.price || 0),
      currency: o.currency || 'PKR',
      variant: li.variant_title || '',
    }));

    const total = parseFloat(o.total_price || o.total || 0);
    const currency = o.currency || 'PKR';
    const status = o.fulfillment_status || o.financial_status || o.status || 'processing';

    const fulfillments = Array.isArray(o.fulfillments) ? o.fulfillments : [];
    const trackingNumber = fulfillments[0]?.tracking_number || o.tracking_number || null;
    const carrier = fulfillments[0]?.tracking_company || o.carrier || null;

    await upsertOrder(tenantId, {
      order_id: orderName,
      customer_name: customerName,
      customer_email: customerEmail,
      items,
      total,
      currency,
      status,
      data: {
        source: 'shopify',
        shopify_order_id: shopifyOrderId,
        shopify_name: o.name,
        customer_email: customerEmail,
        customer_name: customerName,
        tracking_number: trackingNumber,
        carrier,
        financial_status: o.financial_status,
        fulfillment_status: o.fulfillment_status,
        created_at_shopify: o.created_at,
        raw_shopify_order: o,
      },
    });
    count++;

    // Automatically trigger Order Issue reconciliation for this persisted Shopify order
    try {
      await reconcileShopifyOrderUpdate(tenantId, o, { source: 'shopify_batch_sync' });
    } catch (recErr) {
      console.error('[Reconciliation Error on upsertShopifyOrdersBatch]', recErr instanceof Error ? recErr.message : recErr);
    }
  }

  return count;
}

export {
  createOrderIssue,
  getOrderIssue,
  getOrderIssueByConversation,
  listOrderIssues,
  updateOrderIssue,
  addOrderIssueEvent,
  listOrderIssueEvents,
  scheduleOrderIssueFollowup,
  cancelPendingFollowupsForIssue,
  claimDueFollowupJobs,
  processClaimedFollowupJob,
  detectOrderIssue,
  investigateOrderData,
  reconcileShopifyOrderUpdate,
  reconcileShopifyOrdersBatch,
  cancelFollowupsForTask,
} from './order-issues.ts';

export {
  generatePublicFormId,
  createBusinessWorkspace,
  getBusinessByPublicFormId,
  addBusinessMember,
  listBusinessMembers,
  updateServicesKnowledge,
  addServiceItem,
  decideExtractedFact,
  createOrUpdateServicesLead,
  getServicesLead,
  listServicesLeads,
  updateServicesLead,
  addServicesLeadEvent,
  getServicesLeadEvents,
  scheduleServicesLeadFollowup,
  claimEligibleServicesFollowupJobs,
  inspectServicesLeadFollowupEligibility,
  dispatchServicesLeadFollowup,
  escalateServicesLeadToOwner,
  cancelServicesLeadFollowup,
  completeServicesLeadFollowupJob,
} from './services-pack.ts';

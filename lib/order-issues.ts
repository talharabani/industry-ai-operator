import { Pool } from 'pg';
import { getServerConfig, parseDbConfig } from './config.ts';
import { cleanQuotedReplyText } from './routine-evaluator.ts';
export const stripQuotedThreadHistory = cleanQuotedReplyText;

declare global {
  var __pgPool: Pool | undefined;
  var __pgPoolUrl: string | undefined;
}

function getSharedPool(): Pool | null {
  const config = getServerConfig();
  if (!config.isDatabaseConfigured) return null;

  if (global.__pgPool && global.__pgPoolUrl !== config.databaseUrl) {
    global.__pgPool.end().catch(() => {});
    global.__pgPool = undefined;
    global.__pgPoolUrl = undefined;
  }

  if (!global.__pgPool) {
    global.__pgPool = new Pool({
      ...parseDbConfig(config.databaseUrl),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    global.__pgPoolUrl = config.databaseUrl;
  }

  return global.__pgPool;
}

export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const pool = getSharedPool();
  if (!pool) return [];
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

export async function withTransaction<T>(
  callback: (client: any) => Promise<T>
): Promise<T> {
  const pool = getSharedPool();
  if (!pool) {
    throw new Error('Database is not configured');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
import { classifyEmailMessage } from './email-filter.ts';
import type {
  OrderRecord,
  OrderIssueRecord,
  OrderIssueType,
  OrderIssueStatus,
  OrderIssueResponsibleParty,
  OrderIssueEvidence,
  OrderIssueEventRecord,
  OrderIssueEventType,
  OrderIssueFollowupJobRecord,
  FollowupJobType,
  BusinessSettings,
} from './types.ts';

// 1. Issue Detection Patterns
const DELIVERY_DELAY_PATTERNS = [
  /\b(where\s*is\s*(my\s*)?(order|package|shipment|delivery)|delayed|delay|running\s*late|hasn'?t\s*arrived|not\s*(yet\s*)?received|still\s*waiting|package\s*lost|haven'?t\s*gotten|where\s*is\s*it|delivery\s*issue|courier\s*delay)\b/i,
  /\b(late\s*delivery|taking\s*too\s*long|when\s*will\s*(it|my\s*order)\s*arrive|overdue\s*package)\b/i,
];

const NOT_RECEIVED_PATTERNS = [
  /\b(never\s*received|did\s*not\s*receive|package\s*not\s*delivered|shows\s*delivered\s*but\s*not|missing\s*package|parcel\s*not\s*received|not\s*at\s*my\s*door)\b/i,
];

const DAMAGED_ITEM_PATTERNS = [
  /\b(damaged|broken|torn|crushed|defective|faulty|poor\s*condition|arrived\s*damaged|scratched|ruined|smashed)\b/i,
];

const WRONG_ITEM_PATTERNS = [
  /\b(wrong\s*(item|product|size|color|order|shoes|shirt|jacket)|incorrect\s*(item|product|size)|received\s*the\s*wrong|different\s*item\s*received)\b/i,
];

const REFUND_REQUEST_PATTERNS = [
  /\b(i\s*want\s*a\s*refund|please\s*refund|refund\s*(me|my|this|the\s*order)|refund\s*my\s*money|issue\s*a\s*refund|need\s*a\s*refund|return\s*for\s*(a\s*)?refund|money\s*back|reimburse|reimbursement)\b/i,
  /(i\s*(want|need|would\s*like|demand|request)|please|kindly|can\s*(i|you)\s*(process|give|issue|send|provide))\s*.*(refund|money\s*back|reimburse)/i,
];

const EXCHANGE_REQUEST_PATTERNS = [
  /\b(exchange\s*(my|these|this|the|shoes|shirt|jacket|item|product|size)|please\s*exchange|want\s*to\s*exchange|replace\s*(my|this|these|item)|replacement|swap\s*(size|color|item))\b/i,
  /(i\s*(want|need|would\s*like)|please|kindly|can\s*(i|you)\s*(process|do|swap))\s*.*(exchange|replacement|replace\s*item|swap\s*size)/i,
];

const CANCELLATION_REQUEST_PATTERNS = [
  /\b(cancel\s*(my|the|this)?\s*order|order\s*cancellation|cancel\s*(my\s*)?booking|stop\s*shipment|stop\s*delivery)\b/i,
];

// Helper: Extract order identifier (#1001, 1001, ORD-1001)
export function extractOrderIdentifier(text?: string | null): string | null {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim();

  // 1. Explicit ORD- prefix (demo store style)
  const ordMatch = clean.match(/\b(ORD-[a-zA-Z0-9_-]+)\b/i);
  if (ordMatch) return ordMatch[1].toUpperCase();

  // 2. Hash notation #1001 or # 1001
  const hashMatch = clean.match(/(?:^|\s)#\s*(\d{2,15})\b/);
  if (hashMatch) return hashMatch[1];

  // 3. Keyword followed by order number: "order 1001", "order: 1001", "order#1001"
  const keywordMatch = clean.match(/\b(?:order|ord)\s*[:?#-]?\s*#?\s*(\d{2,15})\b/i);
  if (keywordMatch) return keywordMatch[1];

  // 4. Standalone 4-8 digit number if text is short inquiry
  if (clean.length < 80) {
    const numMatch = clean.match(/\b(\d{4,8})\b/);
    if (numMatch) return numMatch[1];
  }

  return null;
}

// Helper: Match order from list verifying customer ownership
export function findMatchingOrder(
  arg1: OrderRecord[] | string | null,
  arg2: string | null,
  arg3?: string | OrderRecord[]
): {
  order: OrderRecord | null;
  ownershipMatch: boolean;
  orderFoundWithoutOwnership: boolean;
  matched: boolean;
  privacyBlocked: boolean;
} {
  let orders: OrderRecord[] = [];
  let orderRef: string | null = null;
  let customerEmail: string = '';

  if (Array.isArray(arg1)) {
    orders = arg1;
    orderRef = arg2;
    customerEmail = typeof arg3 === 'string' ? arg3 : '';
  } else {
    orderRef = arg1;
    customerEmail = typeof arg2 === 'string' ? arg2 : '';
    orders = Array.isArray(arg3) ? arg3 : [];
  }

  if (!orderRef) {
    // If no orderRef provided, see if customer has an order matching their email
    const cleanEmail = customerEmail.trim().toLowerCase();
    const customerOrders = orders.filter((o) => {
      const oEmail = (o.customer_email || o.data?.customer_email || o.data?.customer?.email || '').toLowerCase().trim();
      return Boolean(cleanEmail && oEmail === cleanEmail);
    });

    if (customerOrders.length === 1) {
      return {
        order: customerOrders[0],
        ownershipMatch: true,
        orderFoundWithoutOwnership: false,
        matched: true,
        privacyBlocked: false,
      };
    }
    return {
      order: null,
      ownershipMatch: false,
      orderFoundWithoutOwnership: false,
      matched: false,
      privacyBlocked: false,
    };
  }

  const cleanRef = orderRef.trim().toLowerCase().replace(/^#/, '');
  const cleanEmail = customerEmail.trim().toLowerCase();

  let matchedOrder: OrderRecord | null = null;

  for (const o of orders) {
    const rawId = (o.order_id || '').toLowerCase();
    const rawDataId = String(o.data?.id || o.data?.order_number || o.data?.name || '').toLowerCase().replace(/^#/, '');
    const cleanRawId = rawId.replace(/^#/, '');

    const idMatches =
      cleanRawId === cleanRef ||
      rawId === cleanRef ||
      rawDataId === cleanRef ||
      (cleanRef.startsWith('ord-') && rawId === cleanRef);

    if (idMatches) {
      matchedOrder = o;
      break;
    }
  }

  if (!matchedOrder) {
    return {
      order: null,
      ownershipMatch: false,
      orderFoundWithoutOwnership: false,
      matched: false,
      privacyBlocked: false,
    };
  }

  const oEmail = (
    matchedOrder.customer_email ||
    matchedOrder.data?.customer_email ||
    matchedOrder.data?.customer?.email ||
    ''
  )
    .toLowerCase()
    .trim();

  const ownershipMatch = Boolean(oEmail && cleanEmail && oEmail === cleanEmail);

  return {
    order: ownershipMatch ? matchedOrder : null,
    ownershipMatch,
    orderFoundWithoutOwnership: !ownershipMatch,
    matched: ownershipMatch,
    privacyBlocked: !ownershipMatch,
  };
}

export interface IssueDetectionResult {
  isIssue: boolean;
  issueType?: OrderIssueType;
  orderId?: string | null;
  verifiedOrder?: OrderRecord | null;
  needsClarification: boolean;
  clarificationReason?: string;
  privacyBlocked: boolean;
  customerClaimText: string;
  extractedOrderRef?: string | null;
}

/**
 * Detects whether incoming customer text constitutes an order issue,
 * excluding quoted history and non-customer notifications.
 */
export function detectOrderIssue(
  textOrParams:
    | string
    | {
        subject?: string;
        bodyText?: string;
        senderEmail?: string;
        senderName?: string;
        orders?: OrderRecord[];
        isAutomated?: boolean;
      }
): IssueDetectionResult {
  let subject = '';
  let bodyText = '';
  let senderEmail = 'customer@example.com';
  let orders: OrderRecord[] = [];
  let isAutomated = false;

  if (typeof textOrParams === 'string') {
    bodyText = textOrParams;
  } else {
    subject = textOrParams.subject || '';
    bodyText = textOrParams.bodyText || '';
    senderEmail = textOrParams.senderEmail || 'customer@example.com';
    orders = textOrParams.orders || [];
    isAutomated = Boolean(textOrParams.isAutomated);
  }

  // 1. Filter out automated and non-customer notifications
  if (isAutomated) {
    return { isIssue: false, needsClarification: false, privacyBlocked: false, customerClaimText: '' };
  }

  const emailFilter = classifyEmailMessage({
    senderEmail,
    subject,
    bodyText,
    isAutomatedHeader: isAutomated,
  });

  if (emailFilter.isNonCustomer) {
    return { isIssue: false, needsClarification: false, privacyBlocked: false, customerClaimText: '' };
  }

  // 2. Clean customer-written text: strictly strip thread history
  const cleanBody = stripQuotedThreadHistory(bodyText);
  const combinedText = `${subject}\n${cleanBody}`.trim();

  // 3. Classify issue type by priority
  let detectedType: OrderIssueType | null = null;

  if (REFUND_REQUEST_PATTERNS.some((p) => p.test(combinedText))) {
    detectedType = 'refund_request';
  } else if (EXCHANGE_REQUEST_PATTERNS.some((p) => p.test(combinedText))) {
    detectedType = 'exchange_request';
  } else if (CANCELLATION_REQUEST_PATTERNS.some((p) => p.test(combinedText))) {
    detectedType = 'cancellation_request';
  } else if (DAMAGED_ITEM_PATTERNS.some((p) => p.test(combinedText))) {
    detectedType = 'damaged_item';
  } else if (WRONG_ITEM_PATTERNS.some((p) => p.test(combinedText))) {
    detectedType = 'wrong_item';
  } else if (NOT_RECEIVED_PATTERNS.some((p) => p.test(combinedText))) {
    detectedType = 'not_received';
  } else if (DELIVERY_DELAY_PATTERNS.some((p) => p.test(combinedText))) {
    detectedType = 'delivery_delay';
  }

  const extractedRef = extractOrderIdentifier(combinedText);

  if (!detectedType) {
    return {
      isIssue: false,
      needsClarification: false,
      privacyBlocked: false,
      customerClaimText: cleanBody,
      extractedOrderRef: extractedRef,
    };
  }

  // 4. Extract and match order details
  const { order, ownershipMatch, orderFoundWithoutOwnership } = findMatchingOrder(orders, extractedRef, senderEmail);

  if (orderFoundWithoutOwnership) {
    // Cross-customer privacy gate: customer provided an order ID that belongs to another email address
    return {
      isIssue: true,
      issueType: detectedType,
      orderId: null,
      verifiedOrder: null,
      needsClarification: true,
      clarificationReason: 'Order reference does not match the registered customer email address.',
      privacyBlocked: true,
      customerClaimText: cleanBody,
      extractedOrderRef: extractedRef,
    };
  }

  if (!order && orders.length > 0) {
    // Missing order details -> trigger clarification under existing rules
    return {
      isIssue: true,
      issueType: detectedType,
      orderId: null,
      verifiedOrder: null,
      needsClarification: true,
      clarificationReason: 'Please provide your order number (#1001 or ORD-1001) so we can look up your shipment and assist you.',
      privacyBlocked: false,
      customerClaimText: cleanBody,
      extractedOrderRef: extractedRef,
    };
  }

  return {
    isIssue: true,
    issueType: detectedType,
    orderId: order?.order_id || null,
    verifiedOrder: order || null,
    needsClarification: false,
    privacyBlocked: false,
    customerClaimText: cleanBody,
    extractedOrderRef: extractedRef,
  };
}

/**
 * Conducts verified investigation on order, fulfillment, and carrier tracking data.
 * Adheres strictly to facts:
 * - Does NOT infer shipment delay merely from "unfulfilled"
 * - Does NOT promise delivery dates without carrier backing
 * - States limitations clearly when carrier data is missing and creates owner task
 */
export function investigateOrderData(
  order: OrderRecord | null,
  issueType: OrderIssueType,
  customerClaimText: string
): {
  evidence: OrderIssueEvidence;
  initialStatus: OrderIssueStatus;
  nextAction: string;
  responsibleParty: OrderIssueResponsibleParty;
} {
  const evidence: OrderIssueEvidence = {
    customer_claim: customerClaimText,
  };

  if (!order) {
    evidence.investigation_notes = 'No verified order linked. Awaiting customer order details.';
    return {
      evidence,
      initialStatus: 'awaiting_customer',
      nextAction: 'Awaiting customer order reference / receipt clarification.',
      responsibleParty: 'customer',
    };
  }

  evidence.order_id = order.order_id;
  const orderData = order.data || {};

  // Extract fulfillment details
  const rawStatus = String(order.status || orderData.status || '').toLowerCase();
  const fulfillmentStatus = String(orderData.fulfillment_status || '').toLowerCase();
  const trackingNumber = (orderData.tracking_number || orderData.tracking_url || '').toString().trim();
  const carrier = (orderData.carrier || orderData.tracking_company || '').toString().trim();
  const deliveryStatus = String(orderData.delivery_status || '').toLowerCase();
  const estimatedDelivery = (orderData.estimated_delivery || '').toString().trim();

  evidence.order_status = rawStatus || 'open';
  evidence.fulfillment_status = fulfillmentStatus || (trackingNumber ? 'fulfilled' : 'unfulfilled');
  evidence.tracking_number = trackingNumber || undefined;
  evidence.carrier = carrier || undefined;
  evidence.delivery_status = deliveryStatus || undefined;
  evidence.estimated_delivery = estimatedDelivery || undefined;

  const ownerTasks: Array<{ id: string; title: string; status: 'pending' | 'completed'; created_at: string }> = [];

  // Check state categories
  const isUnfulfilled =
    !trackingNumber &&
    (evidence.fulfillment_status === 'unfulfilled' ||
      rawStatus === 'unfulfilled' ||
      rawStatus === 'paid' ||
      rawStatus === 'open');

  const isFulfilledWithTracking = Boolean(trackingNumber || carrier);
  const isCarrierDelayed =
    deliveryStatus === 'delayed' ||
    deliveryStatus === 'failed' ||
    deliveryStatus === 'exception' ||
    deliveryStatus === 'delivery_delay';

  if (issueType === 'delivery_delay' || issueType === 'not_received') {
    if (isUnfulfilled) {
      evidence.investigation_notes =
        'Order is currently unfulfilled in store / warehouse. No carrier shipment has departed. Do not promise delivery dates or infer transit delay without dispatch.';
      ownerTasks.push({
        id: `task-${Date.now()}-fulfill`,
        title: `Warehouse fulfillment required for order ${order.order_id}`,
        status: 'pending',
        created_at: new Date().toISOString(),
      });
      evidence.owner_tasks = ownerTasks;

      return {
        evidence,
        initialStatus: 'awaiting_owner',
        nextAction: `Warehouse team to expedite and dispatch unfulfilled order ${order.order_id}.`,
        responsibleParty: 'owner',
      };
    }

    if (isFulfilledWithTracking) {
      if (isCarrierDelayed) {
        evidence.carrier_delay_reported = true;
        evidence.investigation_notes = `Carrier (${carrier || 'courier'}) reported transit exception / delay. Tracking: ${trackingNumber}.`;
        ownerTasks.push({
          id: `task-${Date.now()}-carrier`,
          title: `Carrier exception reported on tracking ${trackingNumber}`,
          status: 'pending',
          created_at: new Date().toISOString(),
        });
        evidence.owner_tasks = ownerTasks;

        return {
          evidence,
          initialStatus: 'awaiting_owner',
          nextAction: `Follow up with carrier (${carrier || 'courier'}) tracking #${trackingNumber} regarding delay exception.`,
          responsibleParty: 'owner',
        };
      }

      evidence.investigation_notes = `Order fulfilled with active carrier tracking (${carrier || 'Courier'}: ${trackingNumber}).`;
      return {
        evidence,
        initialStatus: 'investigating',
        nextAction: `Provide active tracking #${trackingNumber} to customer and monitor delivery confirmation.`,
        responsibleParty: 'ai_operator',
      };
    }

    // Fulfilled without tracking data
    evidence.carrier_data_unavailable = true;
    evidence.investigation_notes =
      'Order marked fulfilled, but carrier tracking details are unavailable in synced store data. Stating limitation to customer.';
    ownerTasks.push({
      id: `task-${Date.now()}-find-tracking`,
      title: `Locate courier tracking information for order ${order.order_id}`,
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    evidence.owner_tasks = ownerTasks;

    return {
      evidence,
      initialStatus: 'awaiting_owner',
      nextAction: `Owner to locate courier tracking information for order ${order.order_id}.`,
      responsibleParty: 'owner',
    };
  }

  if (issueType === 'damaged_item' || issueType === 'wrong_item') {
    evidence.investigation_notes =
      'Customer reported damaged/wrong item. Awaiting clear photos/description of the item condition for return assessment.';
    return {
      evidence,
      initialStatus: 'awaiting_customer',
      nextAction: 'Awaiting item photos / condition details from customer for replacement or return verification.',
      responsibleParty: 'customer',
    };
  }

  if (issueType === 'refund_request' || issueType === 'exchange_request' || issueType === 'cancellation_request') {
    evidence.investigation_notes =
      'Formal financial / item exchange request received. Strictly requires store owner authorization in Approvals queue.';
    return {
      evidence,
      initialStatus: 'action_pending',
      nextAction: 'Awaiting store owner review and approval in the Approvals queue.',
      responsibleParty: 'owner',
    };
  }

  return {
    evidence,
    initialStatus: 'open',
    nextAction: 'Review customer inquiry and investigate order history.',
    responsibleParty: 'ai_operator',
  };
}

/**
 * Generates a unified, fact-grounded customer acknowledgment for order issues.
 * Adheres strictly to verified evidence:
 * - Acknowledges the specific customer complaint (not received, delay, damage, etc.)
 * - For unfulfilled orders: explains fulfillment is not yet recorded and tracking is unavailable
 * - States request was flagged for store team only when an owner task was persisted
 * - Never claims active preparation ("is being prepared"), courier contact, or delivery dates without evidence
 */
export function buildOrderIssueAcknowledgment(params: {
  issueType: OrderIssueType;
  order: OrderRecord | null;
  evidence: OrderIssueEvidence;
  customerName?: string;
  businessName?: string;
  hasPersistedTask?: boolean;
}): string {
  const { issueType, order, evidence, customerName = 'there', businessName = 'Customer Support', hasPersistedTask = false } = params;
  const firstName = customerName.split(' ')[0] || 'there';
  const rawId = order?.order_id || evidence.order_id;
  const orderIdDisplay = rawId ? (rawId.startsWith('#') ? `Order ${rawId}` : `Order #${rawId}`) : 'your order';

  if (issueType === 'not_received' || issueType === 'delivery_delay') {
    const isUnfulfilled =
      !evidence.tracking_number &&
      (evidence.fulfillment_status === 'unfulfilled' ||
        evidence.order_status === 'unfulfilled' ||
        evidence.order_status === 'paid' ||
        evidence.order_status === 'open');

    const isCarrierDelayed = Boolean(evidence.carrier_delay_reported);
    const trackingNumber = evidence.tracking_number;
    const carrier = evidence.carrier;

    if (isUnfulfilled) {
      const taskFlaggedNotice =
        hasPersistedTask || (evidence.owner_tasks && evidence.owner_tasks.length > 0)
          ? '\n\nWe have flagged this request for our store team to review the fulfillment status of your order.'
          : '';

      const complaintAck = issueType === 'not_received'
        ? `We have received your inquiry regarding your order not having arrived.`
        : `We have received your inquiry regarding the delivery status of your order.`;

      return `Hello ${firstName},\n\nThank you for contacting ${businessName} regarding ${orderIdDisplay}. ${complaintAck}\n\nAccording to our store records, fulfillment has not yet been recorded for this order, and courier tracking details are currently unavailable.${taskFlaggedNotice}\n\nWe will update you as soon as more information becomes available.\n\nBest regards,\n${businessName} Support Team`;
    }

    if (trackingNumber) {
      const carrierName = carrier || 'our courier partner';
      if (isCarrierDelayed) {
        const taskFlaggedNotice =
          hasPersistedTask || (evidence.owner_tasks && evidence.owner_tasks.length > 0)
            ? '\n\nWe have flagged this with our store team to monitor the carrier update.'
            : '';

        return `Hello ${firstName},\n\nThank you for contacting ${businessName} regarding ${orderIdDisplay}. We have received your inquiry regarding the delivery delay.\n\nYour order was dispatched via ${carrierName} under tracking number ${trackingNumber}. The carrier has reported a transit exception/delay for this shipment.${taskFlaggedNotice}\n\nBest regards,\n${businessName} Support Team`;
      }

      return `Hello ${firstName},\n\nThank you for contacting ${businessName} regarding ${orderIdDisplay}.\n\nYour order has been dispatched via ${carrierName} with tracking number ${trackingNumber}.\n\nYou can track your shipment using the tracking number above.\n\nBest regards,\n${businessName} Support Team`;
    }

    // Fulfilled without tracking
    const taskFlaggedNotice =
      hasPersistedTask || (evidence.owner_tasks && evidence.owner_tasks.length > 0)
        ? '\n\nWe have flagged this request for our store team to locate your courier tracking information.'
        : '';

    return `Hello ${firstName},\n\nThank you for contacting ${businessName} regarding ${orderIdDisplay}.\n\nWhile your order is marked as fulfilled in our store system, courier tracking details are currently unavailable in our records.${taskFlaggedNotice}\n\nBest regards,\n${businessName} Support Team`;
  }

  if (issueType === 'damaged_item' || issueType === 'wrong_item') {
    const itemIssueLabel = issueType === 'damaged_item' ? 'damaged item' : 'incorrect item';
    return `Hello ${firstName},\n\nThank you for contacting ${businessName} regarding ${orderIdDisplay}. We are sorry to hear that you received a ${itemIssueLabel}.\n\nCould you please provide a brief description and photos showing the condition of the item and package? Our team will review the details to arrange an exchange or replacement for you.\n\nBest regards,\n${businessName} Support Team`;
  }

  if (issueType === 'refund_request' || issueType === 'exchange_request' || issueType === 'cancellation_request') {
    const actionLabel = issueType === 'refund_request' ? 'refund' : issueType === 'exchange_request' ? 'exchange' : 'cancellation';
    return `Hello ${firstName},\n\nThank you for contacting ${businessName} regarding ${orderIdDisplay}. We have received your request for a ${actionLabel}.\n\nOur store management team is reviewing your request in accordance with our store policy and will follow up shortly.\n\nBest regards,\n${businessName} Support Team`;
  }

  return `Hello ${firstName},\n\nThank you for contacting ${businessName} regarding ${orderIdDisplay}. We have logged your request and our team will follow up with you shortly.\n\nBest regards,\n${businessName} Support Team`;
}

// ==========================================
// 2. Database CRUD Operations for Order Issues
// ==========================================

export async function createOrderIssue(params: {
  tenantId?: string;
  tenant_id?: string;
  issueType?: OrderIssueType;
  issue_type?: OrderIssueType;
  status?: OrderIssueStatus;
  orderId?: string | null;
  order_id?: string | null;
  shopDomain?: string | null;
  shop_domain?: string | null;
  conversationId?: string | null;
  conversation_id?: string | null;
  customerName?: string;
  customer_name?: string;
  customerEmail?: string;
  customer_email?: string;
  evidence?: OrderIssueEvidence;
  nextAction?: string | null;
  next_action?: string | null;
  responsibleParty?: OrderIssueResponsibleParty;
  responsible_party?: OrderIssueResponsibleParty;
  dueDate?: string | null;
  due_date?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<OrderIssueRecord> {
  const tenantId = params.tenantId || params.tenant_id || 'demo-store';
  const issueType = params.issueType || params.issue_type || 'delivery_delay';
  const issueId = `issue_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  const status = params.status || 'open';
  const responsibleParty = params.responsibleParty || params.responsible_party || 'ai_operator';
  const orderId = params.orderId !== undefined ? params.orderId : params.order_id || null;
  const shopDomain = params.shopDomain !== undefined ? params.shopDomain : params.shop_domain || null;
  const conversationId = params.conversationId !== undefined ? params.conversationId : params.conversation_id || null;
  const customerName = params.customerName || params.customer_name || 'Customer';
  const customerEmail = params.customerEmail || params.customer_email || '';
  const nextAction = params.nextAction !== undefined ? params.nextAction : params.next_action || null;
  const dueDate = params.dueDate !== undefined ? params.dueDate : params.due_date || null;
  const evidenceJson = JSON.stringify(params.evidence || {});
  const metadataJson = JSON.stringify(params.metadata || {});

  const rows = await query<OrderIssueRecord>(
    `INSERT INTO iao.order_issues (
      id, tenant_id, issue_type, status, order_id, shop_domain, conversation_id,
      customer_name, customer_email, evidence, next_action, responsible_party,
      due_date, metadata, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14::jsonb, NOW(), NOW())
    RETURNING *;`,
    [
      issueId,
      tenantId,
      issueType,
      status,
      orderId,
      shopDomain,
      conversationId,
      customerName,
      customerEmail,
      evidenceJson,
      nextAction,
      responsibleParty,
      dueDate,
      metadataJson,
    ]
  );

  const created = rows[0];

  // Record creation timeline event
  await addOrderIssueEvent({
    tenantId,
    issueId: created.id,
    eventType: 'created',
    actorType: 'system',
    summary: `Order issue created: ${issueType.replace(/_/g, ' ')} (${status})`,
    details: {
      issue_type: issueType,
      order_id: orderId,
      status,
      next_action: nextAction,
    },
  });

  return created;
}

export async function populateFollowupMetadata(
  tenantId: string,
  issues: OrderIssueRecord[]
): Promise<OrderIssueRecord[]> {
  if (!issues.length) return issues;
  const issueIds = issues.map((i) => i.id);

  const jobs = await query<OrderIssueFollowupJobRecord>(
    `SELECT DISTINCT ON (issue_id) *
     FROM iao.order_issue_followup_jobs
     WHERE tenant_id = $1 AND issue_id = ANY($2) AND status IN ('pending', 'claimed')
     ORDER BY issue_id, scheduled_for ASC;`,
    [tenantId, issueIds]
  );
  const jobMap = new Map<string, OrderIssueFollowupJobRecord>();
  for (const j of jobs) {
    jobMap.set(j.issue_id, j);
  }

  const escalationEvents = await query<{ issue_id: string; summary: string }>(
    `SELECT DISTINCT ON (issue_id) issue_id, summary
     FROM iao.order_issue_events
     WHERE tenant_id = $1 AND issue_id = ANY($2) AND event_type = 'escalated_to_owner'
     ORDER BY issue_id, created_at DESC;`,
    [tenantId, issueIds]
  );
  const escalationMap = new Map<string, string>();
  for (const ev of escalationEvents) {
    escalationMap.set(ev.issue_id, ev.summary);
  }

  for (const issue of issues) {
    issue.active_followup_job = jobMap.get(issue.id) || null;
    if (escalationMap.has(issue.id)) {
      issue.is_escalated = true;
      issue.escalation_summary = escalationMap.get(issue.id) || null;
    }
  }

  return issues;
}

export async function getOrderIssue(tenantId: string, issueId: string): Promise<OrderIssueRecord | null> {
  const rows = await query<OrderIssueRecord>(
    `SELECT * FROM iao.order_issues WHERE tenant_id = $1 AND id = $2 LIMIT 1;`,
    [tenantId, issueId]
  );
  if (!rows[0]) return null;
  const enriched = await populateFollowupMetadata(tenantId, [rows[0]]);
  return enriched[0] || null;
}

export async function getOrderIssueByConversation(tenantId: string, conversationId: string): Promise<OrderIssueRecord | null> {
  const rows = await query<OrderIssueRecord>(
    `SELECT * FROM iao.order_issues 
     WHERE tenant_id = $1 AND conversation_id = $2 
     ORDER BY created_at DESC 
     LIMIT 1;`,
    [tenantId, conversationId]
  );
  if (!rows[0]) return null;
  const enriched = await populateFollowupMetadata(tenantId, [rows[0]]);
  return enriched[0] || null;
}

export async function listOrderIssues(
  tenantId: string,
  filters: {
    status?: OrderIssueStatus;
    issueType?: OrderIssueType;
    orderId?: string;
    conversationId?: string;
    responsibleParty?: OrderIssueResponsibleParty;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ issues: OrderIssueRecord[]; total: number }> {
  const conditions: string[] = ['tenant_id = $1'];
  const values: any[] = [tenantId];
  let paramIdx = 2;

  if (filters.status) {
    conditions.push(`status = $${paramIdx++}`);
    values.push(filters.status);
  }

  if (filters.issueType) {
    conditions.push(`issue_type = $${paramIdx++}`);
    values.push(filters.issueType);
  }

  if (filters.orderId) {
    conditions.push(`order_id = $${paramIdx++}`);
    values.push(filters.orderId);
  }

  if (filters.conversationId) {
    conditions.push(`conversation_id = $${paramIdx++}`);
    values.push(filters.conversationId);
  }

  if (filters.responsibleParty) {
    conditions.push(`responsible_party = $${paramIdx++}`);
    values.push(filters.responsibleParty);
  }

  if (filters.search) {
    conditions.push(`(
      customer_name ILIKE $${paramIdx} OR
      customer_email ILIKE $${paramIdx} OR
      order_id ILIKE $${paramIdx} OR
      id ILIKE $${paramIdx}
    )`);
    values.push(`%${filters.search}%`);
    paramIdx++;
  }

  const whereClause = conditions.join(' AND ');

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM iao.order_issues WHERE ${whereClause};`,
    values
  );
  const total = parseInt(countRows[0]?.count || '0', 10);

  const limit = Math.min(Math.max(filters.limit || 20, 1), 500);
  const offset = Math.max(filters.offset || 0, 0);

  const issueRows = await query<OrderIssueRecord>(
    `SELECT * FROM iao.order_issues 
     WHERE ${whereClause} 
     ORDER BY updated_at DESC 
     LIMIT $${paramIdx++} OFFSET $${paramIdx++};`,
    [...values, limit, offset]
  );

  await populateFollowupMetadata(tenantId, issueRows);

  return { issues: issueRows, total };
}

export async function updateOrderIssue(
  tenantId: string,
  issueId: string,
  updates: Partial<{
    status: OrderIssueStatus;
    order_id: string | null;
    shop_domain: string | null;
    evidence: OrderIssueEvidence;
    next_action: string | null;
    responsible_party: OrderIssueResponsibleParty;
    due_date: string | null;
    resolution_summary: string | null;
    is_escalated: boolean;
    escalation_summary: string | null;
    metadata: Record<string, unknown>;
  }>,
  actor: { actorType: 'system' | 'ai_operator' | 'owner' | 'customer'; actorId?: string; summary?: string } = {
    actorType: 'system',
  }
): Promise<OrderIssueRecord | null> {
  const current = await getOrderIssue(tenantId, issueId);
  if (!current) return null;

  const setClauses: string[] = ['updated_at = NOW()'];
  const values: any[] = [tenantId, issueId];
  let paramIdx = 3;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIdx++}`);
    values.push(updates.status);

    if (updates.status === 'resolved' && !current.resolved_at) {
      setClauses.push(`resolved_at = NOW()`);
    } else if (updates.status === 'closed' && !current.closed_at) {
      setClauses.push(`closed_at = NOW()`);
    }
  }

  if (updates.order_id !== undefined) {
    setClauses.push(`order_id = $${paramIdx++}`);
    values.push(updates.order_id);
  }

  if (updates.shop_domain !== undefined) {
    setClauses.push(`shop_domain = $${paramIdx++}`);
    values.push(updates.shop_domain);
  }

  if (updates.evidence !== undefined) {
    const mergedEvidence = { ...current.evidence, ...updates.evidence };
    setClauses.push(`evidence = $${paramIdx++}::jsonb`);
    values.push(JSON.stringify(mergedEvidence));
  }

  if (updates.next_action !== undefined) {
    setClauses.push(`next_action = $${paramIdx++}`);
    values.push(updates.next_action);
  }

  if (updates.responsible_party !== undefined) {
    setClauses.push(`responsible_party = $${paramIdx++}`);
    values.push(updates.responsible_party);
  }

  if (updates.due_date !== undefined) {
    setClauses.push(`due_date = $${paramIdx++}`);
    values.push(updates.due_date);
  }

  if (updates.resolution_summary !== undefined) {
    setClauses.push(`resolution_summary = $${paramIdx++}`);
    values.push(updates.resolution_summary);
  }

  if (updates.is_escalated !== undefined) {
    setClauses.push(`is_escalated = $${paramIdx++}`);
    values.push(updates.is_escalated);
  }

  if (updates.escalation_summary !== undefined) {
    setClauses.push(`escalation_summary = $${paramIdx++}`);
    values.push(updates.escalation_summary);
  }

  if (updates.metadata !== undefined) {
    const mergedMeta = { ...(current.metadata || {}), ...updates.metadata };
    setClauses.push(`metadata = $${paramIdx++}::jsonb`);
    values.push(JSON.stringify(mergedMeta));
  }

  const rows = await query<OrderIssueRecord>(
    `UPDATE iao.order_issues 
     SET ${setClauses.join(', ')} 
     WHERE tenant_id = $1 AND id = $2 
     RETURNING *;`,
    values
  );

  const updated = rows[0] || null;

  if (updated && updates.status && updates.status !== current.status) {
    await addOrderIssueEvent({
      tenantId,
      issueId,
      eventType: 'status_changed',
      actorType: actor.actorType,
      actorId: actor.actorId,
      summary: actor.summary || `Issue status changed from ${current.status} to ${updates.status}`,
      details: {
        from_status: current.status,
        to_status: updates.status,
        previous_status: current.status,
        new_status: updates.status,
        next_action: updates.next_action || updated.next_action,
      },
    });

    // If resolved or closed, cancel any outstanding follow-up jobs
    if (updates.status === 'resolved' || updates.status === 'closed') {
      await cancelPendingFollowupsForIssue(tenantId, issueId, `Issue marked as ${updates.status}`);
    }
  }

  return updated;
}

export async function addOrderIssueEvent(params: {
  tenantId: string;
  issueId: string;
  eventType: OrderIssueEventType;
  actorType: 'system' | 'ai_operator' | 'owner' | 'customer';
  actorId?: string | null;
  summary: string;
  details?: Record<string, unknown>;
}): Promise<OrderIssueEventRecord> {
  const detailsJson = JSON.stringify(params.details || {});
  const rows = await query<OrderIssueEventRecord>(
    `INSERT INTO iao.order_issue_events (
      tenant_id, issue_id, event_type, actor_type, actor_id, summary, details, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
    RETURNING *;`,
    [
      params.tenantId,
      params.issueId,
      params.eventType,
      params.actorType,
      params.actorId || null,
      params.summary,
      detailsJson,
    ]
  );
  return rows[0];
}

export async function listOrderIssueEvents(
  tenantId: string,
  issueId: string
): Promise<Array<OrderIssueEventRecord & { from_status?: string; to_status?: string }>> {
  const rows = await query<OrderIssueEventRecord>(
    `SELECT * FROM iao.order_issue_events 
     WHERE tenant_id = $1 AND issue_id = $2 
     ORDER BY created_at ASC;`,
    [tenantId, issueId]
  );

  return rows.map((r) => {
    const d = (r.details || {}) as Record<string, unknown>;
    return {
      ...r,
      from_status: (d.from_status as string) || (d.previous_status as string) || undefined,
      to_status: (d.to_status as string) || (d.new_status as string) || undefined,
    };
  });
}

// ==========================================
// 3. Follow-up Job Scheduling & Processing
// ==========================================

/**
 * Computes the cumulative completed reminder count across the reminder chain for a task or followup_type.
 * Inspects both completed followup jobs and followup_sent audit events for absolute accuracy.
 */
export async function getCumulativeReminderCount(
  tenantId: string,
  issueId: string,
  followupType: string,
  associatedTaskId?: string | null
): Promise<number> {
  // 1. Query completed jobs
  let jobSql = `
    SELECT COUNT(DISTINCT id) as count
    FROM iao.order_issue_followup_jobs
    WHERE tenant_id = $1
      AND issue_id = $2
      AND status = 'completed'
  `;
  const jobParams: any[] = [tenantId, issueId];

  if (associatedTaskId) {
    jobSql += ` AND (
      associated_task_id = $3
      OR metadata->>'associated_task_id' = $3
      OR metadata->>'task_id' = $3
      OR (followup_type = 'awaiting_owner_review' AND (associated_task_id IS NULL AND metadata->>'associated_task_id' IS NULL))
    )`;
    jobParams.push(associatedTaskId);
  } else {
    jobSql += ` AND followup_type = $3`;
    jobParams.push(followupType);
  }

  const jobRows = await query<{ count: string }>(jobSql, jobParams);
  const completedJobsCount = parseInt(jobRows[0]?.count || '0', 10);

  // 2. Query followup_sent audit events
  let eventSql = `
    SELECT COUNT(DISTINCT id) as count
    FROM iao.order_issue_events
    WHERE tenant_id = $1
      AND issue_id = $2
      AND event_type = 'followup_sent'
  `;
  const eventParams: any[] = [tenantId, issueId];

  if (associatedTaskId) {
    eventSql += ` AND (
      details->>'associated_task_id' = $3
      OR details->>'task_id' = $3
      OR (details->>'followup_type' = 'awaiting_owner_review' AND details->>'associated_task_id' IS NULL)
    )`;
    eventParams.push(associatedTaskId);
  } else {
    eventSql += ` AND (details->>'followup_type' = $3 OR details->>'job_type' = $3)`;
    eventParams.push(followupType);
  }

  const eventRows = await query<{ count: string }>(eventSql, eventParams);
  const eventsCount = parseInt(eventRows[0]?.count || '0', 10);

  return Math.max(completedJobsCount, eventsCount);
}

export async function scheduleOrderIssueFollowup(params: {
  tenantId?: string;
  tenant_id?: string;
  issueId?: string;
  issue_id?: string;
  conversationId?: string | null;
  conversation_id?: string | null;
  followupType?: FollowupJobType | string;
  followup_type?: FollowupJobType | string;
  job_type?: FollowupJobType | string;
  maxAttempts?: number;
  max_attempts?: number;
  attemptCount?: number;
  attempt_count?: number;
  delayHours?: number;
  delay_hours?: number;
  run_at?: Date | string;
  associatedTaskId?: string | null;
  associated_task_id?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<OrderIssueFollowupJobRecord | null> {
  const tenantId = params.tenantId || params.tenant_id || 'demo-store';
  const issueId = params.issueId || params.issue_id || '';
  const conversationId = params.conversationId !== undefined ? params.conversationId : params.conversation_id || null;
  const followupType = (params.followupType || params.followup_type || params.job_type || 'awaiting_customer_clarification') as FollowupJobType;
  const maxAttempts = params.maxAttempts ?? params.max_attempts ?? 2;
  const associatedTaskId = params.associatedTaskId || params.associated_task_id || null;

  // 1. Concurrency / Deduplication check:
  // If an active (pending or claimed) reminder already exists for this task/chain, return it without creating duplicate
  let activeSql = `
    SELECT * FROM iao.order_issue_followup_jobs
    WHERE tenant_id = $1
      AND issue_id = $2
      AND status IN ('pending', 'claimed')
  `;
  const activeParams: any[] = [tenantId, issueId];
  if (associatedTaskId) {
    activeSql += ` AND (
      associated_task_id = $3
      OR metadata->>'associated_task_id' = $3
      OR metadata->>'task_id' = $3
      OR (followup_type = 'awaiting_owner_review' AND associated_task_id IS NULL)
    )`;
    activeParams.push(associatedTaskId);
  } else {
    activeSql += ` AND followup_type = $3`;
    activeParams.push(followupType);
  }
  activeSql += ` ORDER BY scheduled_for ASC LIMIT 1;`;

  const existingActive = await query<OrderIssueFollowupJobRecord>(activeSql, activeParams);
  if (existingActive[0]) {
    return existingActive[0];
  }

  // 2. Cumulative chain limit enforcement:
  const isOwnerJob = followupType === 'awaiting_owner_review' || Boolean(associatedTaskId);
  let cumulativeCount = params.attemptCount ?? params.attempt_count ?? 0;

  if (isOwnerJob) {
    const taskCumulative = await getCumulativeReminderCount(tenantId, issueId, followupType, associatedTaskId);
    cumulativeCount = Math.max(cumulativeCount, taskCumulative);

    if (cumulativeCount >= maxAttempts) {
      // Chain limit already reached for this unresolved task! Do not schedule another reminder.
      const existingEsc = await query(
        `SELECT id FROM iao.order_issue_events
         WHERE tenant_id = $1 AND issue_id = $2 AND event_type = 'escalated_to_owner' LIMIT 1;`,
        [tenantId, issueId]
      );
      if (!existingEsc[0]) {
        await addOrderIssueEvent({
          tenantId,
          issueId,
          eventType: 'escalated_to_owner',
          actorType: 'system',
          summary: `Owner reminder limit (${maxAttempts}) reached for open task. No further reminders scheduled.`,
          details: {
            cumulative_attempts: cumulativeCount,
            max_attempts: maxAttempts,
            associated_task_id: associatedTaskId,
            followup_type: followupType,
          },
        });
        await updateOrderIssue(tenantId, issueId, {
          is_escalated: true,
          escalation_summary: `Owner reminder limit (${maxAttempts}) reached for open task. Escalated for manual store team action.`,
        });
      }

      return null;
    }
  }

  // 3. Insert job in chain with cumulative attempt count preserved
  const jobId = `fjob_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  const metaObj: Record<string, unknown> = {
    ...(params.metadata || {}),
    cumulative_completed: cumulativeCount,
    chain_attempt: cumulativeCount + 1,
  };
  if (associatedTaskId && !metaObj.associated_task_id) {
    metaObj.associated_task_id = associatedTaskId;
  }
  const metadataJson = JSON.stringify(metaObj);

  let scheduledForSql = 'NOW() + ($8 || \' hours\')::INTERVAL';
  let delayParam: string = (params.delayHours ?? params.delay_hours ?? 24).toString();

  if (params.run_at) {
    scheduledForSql = '$8::TIMESTAMPTZ';
    delayParam = params.run_at instanceof Date ? params.run_at.toISOString() : params.run_at;
  }

  let job: OrderIssueFollowupJobRecord;
  try {
    const rows = await query<OrderIssueFollowupJobRecord>(
      `INSERT INTO iao.order_issue_followup_jobs (
        id, tenant_id, issue_id, conversation_id, status, followup_type,
        attempt_count, max_attempts, scheduled_for, associated_task_id, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, ${scheduledForSql}, $9, $10::jsonb, NOW(), NOW())
      RETURNING *;`,
      [
        jobId,
        tenantId,
        issueId,
        conversationId,
        followupType,
        cumulativeCount,
        maxAttempts,
        delayParam,
        associatedTaskId,
        metadataJson,
      ]
    );
    job = rows[0];
  } catch (err: any) {
    if (err && (err.code === '23505' || err.message?.includes('duplicate key') || err.message?.includes('uq_active'))) {
      const racedRows = await query<OrderIssueFollowupJobRecord>(activeSql, activeParams);
      if (racedRows[0]) {
        return racedRows[0];
      }
    }
    throw err;
  }

  await addOrderIssueEvent({
    tenantId,
    issueId,
    eventType: 'followup_scheduled',
    actorType: 'system',
    summary: `Follow-up job scheduled: ${followupType.replace(/_/g, ' ')} (Chain Attempt ${cumulativeCount + 1}/${maxAttempts})`,
    details: {
      job_id: job.id,
      scheduled_for: job.scheduled_for,
      max_attempts: maxAttempts,
      cumulative_attempts: cumulativeCount,
      associated_task_id: associatedTaskId,
    },
  });

  return job;
}

export async function cancelPendingFollowupsForIssue(
  tenantId: string,
  issueId: string,
  reason?: string,
  followupTypes?: FollowupJobType[]
): Promise<number> {
  let whereClause = 'tenant_id = $1 AND issue_id = $2 AND status IN (\'pending\', \'claimed\')';
  const params: any[] = [tenantId, issueId];

  if (followupTypes && followupTypes.length > 0) {
    whereClause += ' AND followup_type = ANY($3)';
    params.push(followupTypes);
  }

  const rows = await query<{ count: string }>(
    `WITH cancelled AS (
      UPDATE iao.order_issue_followup_jobs
      SET status = 'cancelled', updated_at = NOW()
      WHERE ${whereClause}
      RETURNING id
    ) SELECT COUNT(*) as count FROM cancelled;`,
    params
  );

  const count = parseInt(rows[0]?.count || '0', 10);
  if (count > 0 && reason) {
    await addOrderIssueEvent({
      tenantId,
      issueId,
      eventType: 'status_changed',
      actorType: 'system',
      summary: `Cancelled ${count} pending follow-up job(s): ${reason}`,
      details: { cancelled_count: count, reason, followup_types: followupTypes },
    });
  }

  return count;
}

/**
 * Atomically claims due pending follow-up jobs with SELECT ... FOR UPDATE SKIP LOCKED
 */
export async function claimDueFollowupJobs(
  arg1?: number | string,
  arg2?: string | number
): Promise<OrderIssueFollowupJobRecord[]> {
  let tenantId: string | null = null;
  let limit = 10;
  let claimedBy = 'worker';

  if (typeof arg1 === 'string') {
    tenantId = arg1;
    limit = typeof arg2 === 'number' ? arg2 : 10;
  } else if (typeof arg1 === 'number') {
    limit = arg1;
    claimedBy = typeof arg2 === 'string' ? arg2 : 'worker';
  }

  if (tenantId) {
    return query<OrderIssueFollowupJobRecord>(
      `WITH target_jobs AS (
        SELECT id, status FROM iao.order_issue_followup_jobs
        WHERE tenant_id = $1
          AND (status = 'pending' OR (status = 'claimed' AND claimed_at < NOW() - INTERVAL '15 minutes'))
          AND scheduled_for <= NOW()
        ORDER BY scheduled_for ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE iao.order_issue_followup_jobs j
      SET status = 'claimed',
          claimed_at = NOW(),
          claimed_by = $3,
          updated_at = NOW(),
          metadata = jsonb_set(
            COALESCE(j.metadata, '{}'::jsonb),
            '{execution_retries}',
            to_jsonb(COALESCE((j.metadata->>'execution_retries')::int, 0) + CASE WHEN t.status = 'claimed' THEN 1 ELSE 0 END)
          )
      FROM target_jobs t
      WHERE j.id = t.id
      RETURNING j.*;`,
      [tenantId, limit, claimedBy]
    );
  }

  return query<OrderIssueFollowupJobRecord>(
    `WITH target_jobs AS (
      SELECT id, status FROM iao.order_issue_followup_jobs
      WHERE (status = 'pending' OR (status = 'claimed' AND claimed_at < NOW() - INTERVAL '15 minutes'))
        AND scheduled_for <= NOW()
      ORDER BY scheduled_for ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE iao.order_issue_followup_jobs j
    SET status = 'claimed',
        claimed_at = NOW(),
        claimed_by = $2,
        updated_at = NOW(),
        metadata = jsonb_set(
          COALESCE(j.metadata, '{}'::jsonb),
          '{execution_retries}',
          to_jsonb(COALESCE((j.metadata->>'execution_retries')::int, 0) + CASE WHEN t.status = 'claimed' THEN 1 ELSE 0 END)
        )
    FROM target_jobs t
    WHERE j.id = t.id
    RETURNING j.*;`,
    [limit, claimedBy]
  );
}

/**
 * Processes a claimed follow-up job:
 * - Checks whether issue is still awaiting response/review.
 * - Enforces retry bounds: escalates to owner if max attempts reached.
 * - Respects automation modes (auto_routine vs draft_only vs paused).
 */
export async function processClaimedFollowupJob(
  job: OrderIssueFollowupJobRecord,
  businessSettings?: BusinessSettings
): Promise<{
  jobId: string;
  outcome: 'completed' | 'escalated_to_owner' | 'cancelled_obsolete' | 'paused_delayed' | 'failed';
  actionTaken: string;
  message?: string;
}> {
  const tenantId = job.tenant_id;
  const issue = await getOrderIssue(tenantId, job.issue_id);

  // Auto-resolve businessSettings from database if not passed or passed in options wrapper
  if (!businessSettings || (!businessSettings.order_issues_config && (businessSettings as any).businessSettings)) {
    businessSettings = (businessSettings as any)?.businessSettings || businessSettings;
    if (!businessSettings || !businessSettings.order_issues_config) {
      const bizRows = await query<{ settings: BusinessSettings }>(
        'SELECT settings FROM iao.businesses WHERE tenant_id = $1 LIMIT 1;',
        [tenantId]
      );
      if (bizRows[0]?.settings) {
        businessSettings = bizRows[0].settings;
      }
    }
  }

  if (!issue) {
    await query(`UPDATE iao.order_issue_followup_jobs SET status = 'cancelled', updated_at = NOW() WHERE id = $1;`, [job.id]);
    return {
      jobId: job.id,
      outcome: 'cancelled_obsolete',
      actionTaken: 'cancelled obsolete job',
      message: 'Issue not found.',
    };
  }

  const isCustomerJob =
    job.followup_type === 'awaiting_customer_clarification' ||
    job.followup_type === 'awaiting_customer_photos';
  const isOwnerJob = job.followup_type === 'awaiting_owner_review';
  const isCarrierJob = job.followup_type === 'awaiting_carrier_update';

  const isObsolete =
    issue.status === 'resolved' ||
    issue.status === 'closed' ||
    (isCustomerJob && issue.status !== 'awaiting_customer') ||
    (isOwnerJob && issue.status !== 'awaiting_owner' && issue.status !== 'action_pending') ||
    (isCarrierJob && issue.status !== 'investigating');

  if (isObsolete) {
    await query(`UPDATE iao.order_issue_followup_jobs SET status = 'cancelled', updated_at = NOW() WHERE id = $1;`, [job.id]);
    return {
      jobId: job.id,
      outcome: 'cancelled_obsolete',
      actionTaken: 'cancelled obsolete job',
      message: `Issue is currently in status "${issue.status}".`,
    };
  }

  let currentAttempt = job.attempt_count + 1;
  if (isOwnerJob) {
    const cumulativeCompleted = await getCumulativeReminderCount(
      tenantId,
      issue.id,
      job.followup_type,
      job.associated_task_id
    );
    currentAttempt = Math.max(job.attempt_count + 1, cumulativeCompleted + 1);
  }
  const maxAttempts = job.max_attempts || 2;

  // 1. Check if max retry attempts reached -> Escalate to owner
  if (currentAttempt >= maxAttempts) {
    if (isCustomerJob) {
      await updateOrderIssue(
        tenantId,
        issue.id,
        {
          status: 'awaiting_owner',
          responsible_party: 'owner',
          next_action: `Escalated to owner: Customer has not responded after ${maxAttempts} automated follow-ups.`,
          due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          is_escalated: true,
          escalation_summary: `Customer follow-up retry limit (${maxAttempts}) reached. Assigned to owner.`,
        },
        {
          actorType: 'ai_operator',
          summary: `Escalated to owner task: follow-up retry limit (${maxAttempts}) reached without customer reply.`,
        }
      );

      await addOrderIssueEvent({
        tenantId,
        issueId: issue.id,
        eventType: 'escalated_to_owner',
        actorType: 'ai_operator',
        summary: `Automated follow-up stopped after ${maxAttempts} attempts. Owner task assigned.`,
        details: {
          job_id: job.id,
          attempts: currentAttempt,
          max_attempts: maxAttempts,
        },
      });
    } else if (isOwnerJob) {
      await addOrderIssueEvent({
        tenantId,
        issueId: issue.id,
        eventType: 'escalated_to_owner',
        actorType: 'system',
        summary: `Owner reminder limit (${maxAttempts}) reached for open task. Awaiting manual store team action.`,
        details: {
          job_id: job.id,
          attempts: currentAttempt,
          max_attempts: maxAttempts,
          associated_task_id: job.associated_task_id,
        },
      });

      await updateOrderIssue(
        tenantId,
        issue.id,
        {
          is_escalated: true,
          escalation_summary: `Owner reminder limit (${maxAttempts}) reached for open task. Awaiting manual store team action.`,
        },
        {
          actorType: 'system',
          summary: `Task escalated: ${maxAttempts} owner reminders sent without resolution.`,
        }
      );
    }

    await query(
      `UPDATE iao.order_issue_followup_jobs
       SET status = 'completed', attempt_count = $1, updated_at = NOW()
       WHERE id = $2;`,
      [currentAttempt, job.id]
    );

    // CRITICAL: DO NOT SCHEDULE NEXT ATTEMPT! The chain is complete.
    return {
      jobId: job.id,
      outcome: 'escalated_to_owner',
      actionTaken: isOwnerJob
        ? 'owner reminder retry limit reached'
        : 'escalated to owner task: follow-up retry limit reached',
      message: `Follow-up limit reached (${currentAttempt}/${maxAttempts}). Assigned to store owner.`,
    };
  }

  // 2. Automation mode check
  const autoMode = businessSettings?.automation_mode || 'auto_routine';

  if (autoMode === 'paused') {
    // Postpone without advancing attempt counter
    await query(
      `UPDATE iao.order_issue_followup_jobs
       SET status = 'pending', scheduled_for = NOW() + INTERVAL '4 hours', claimed_at = NULL, claimed_by = NULL, updated_at = NOW()
       WHERE id = $1;`,
      [job.id]
    );
    return {
      jobId: job.id,
      outcome: 'paused_delayed',
      actionTaken: 'paused automation: follow-up reminder delayed',
      message: 'Automation is currently paused. Postponed follow-up by 4 hours.',
    };
  }

  // 3. Mark job as completed with currentAttempt and schedule next attempt
  await query(
    `UPDATE iao.order_issue_followup_jobs
     SET status = 'completed', attempt_count = $1, updated_at = NOW()
     WHERE id = $2;`,
    [currentAttempt, job.id]
  );

  const intervalHours = businessSettings?.order_issues_config?.followup_interval_hours || 24;

  // Schedule next attempt with associatedTaskId and metadata strictly preserved
  await scheduleOrderIssueFollowup({
    tenantId,
    issueId: issue.id,
    conversationId: job.conversation_id,
    followupType: job.followup_type,
    maxAttempts: job.max_attempts,
    delayHours: intervalHours,
    associatedTaskId: job.associated_task_id,
    metadata: {
      ...(job.metadata || {}),
      associated_task_id: job.associated_task_id,
      parent_job_id: job.id,
      previous_attempt: currentAttempt,
    },
  });

  const eventSummary = isOwnerJob
    ? `Owner reminder sent for order issue (Attempt ${currentAttempt}/${maxAttempts})`
    : `Follow-up reminder sent (Attempt ${currentAttempt}/${maxAttempts})`;

  await addOrderIssueEvent({
    tenantId,
    issueId: issue.id,
    eventType: 'followup_sent',
    actorType: 'ai_operator',
    summary: eventSummary,
    details: {
      job_id: job.id,
      followup_type: job.followup_type,
      attempt_count: currentAttempt,
      max_attempts: maxAttempts,
      next_in_hours: intervalHours,
      associated_task_id: job.associated_task_id,
    },
  });

  return {
    jobId: job.id,
    outcome: 'completed',
    actionTaken: isOwnerJob
      ? `notified owner review and scheduled next reminder (attempt ${currentAttempt}/${maxAttempts})`
      : `verified tracking and scheduled next reminder (attempt ${currentAttempt}/${maxAttempts})`,
    message: `Follow-up attempt ${currentAttempt}/${maxAttempts} processed successfully. Next attempt in ${intervalHours}h.`,
  };
}

// ==========================================
// 6. Shopify Order Update Reconciliation Engine
// ==========================================

export interface OrderReconciliationResult {
  issueId: string;
  orderId: string;
  reconciled: boolean;
  action:
    | 'fulfillment_updated'
    | 'tracking_updated'
    | 'task_completed'
    | 'no_change'
    | 'out_of_order_skipped'
    | 'no_matching_issue';
  details?: Record<string, unknown>;
  error?: string;
}

/**
 * Reconciles an order change (from Shopify webhooks, manual/scheduled syncs, or batch syncs)
 * against active Order Issues in PostgreSQL.
 *
 * Safety & Governance Guarantees:
 * - Scoped strictly by tenantId and optional shopDomain.
 * - Out-of-order event protection: will not regress newer evidence.
 * - Preserves customer claims, owner notes, and closed/resolved history.
 * - Completes only the applicable warehouse fulfillment task when fully fulfilled with tracking.
 * - Partial fulfillment retains tasks for outstanding items.
 * - Fulfilled without tracking creates/retains a task to locate tracking.
 * - Fulfillment or tracking NEVER automatically resolves an "order not received" complaint.
 * - Selectively cancels only reminders for completed/obsolete tasks.
 * - Zero customer emails are dispatched.
 */
export async function reconcileShopifyOrderUpdate(
  tenantId: string,
  rawOrder: any,
  options: {
    shopDomain?: string | null;
    source?: string;
    provider?: string | null;
    connectionId?: string | null;
  } = {}
): Promise<OrderReconciliationResult[]> {
  if (!tenantId || !rawOrder) return [];

  // 1. Extract Normalized Order Information
  const shopifyOrderId = String(rawOrder.id || rawOrder.order_id || rawOrder.data?.shopify_order_id || '').trim();
  const rawOrderName = String(rawOrder.name || rawOrder.order_id || rawOrder.data?.shopify_name || '').trim();
  const cleanOrderNumber = rawOrderName.replace(/^[#\s]+/, '').replace(/^ORD-/i, '');
  const explicitOrderId = String(rawOrder.order_id || rawOrder.data?.order_id || '').trim();
  const externalOrderId = String(rawOrder.external_order_id || rawOrder.id || '').trim();
  const orderIdVariants = Array.from(
    new Set(
      [
        rawOrderName,
        `#${cleanOrderNumber}`,
        cleanOrderNumber,
        `ORD-${cleanOrderNumber}`,
        shopifyOrderId,
        explicitOrderId,
        externalOrderId,
      ].filter(Boolean)
    )
  );

  const shopDomain = (options.shopDomain || rawOrder.shop_domain || rawOrder.data?.shop_domain || '').trim().toLowerCase();
  const sourceUpdatedAt =
    rawOrder.updated_at ||
    rawOrder.created_at ||
    rawOrder.data?.created_at_shopify ||
    rawOrder.data?.updated_at ||
    new Date().toISOString();

  // Extract fulfillment details
  const rawFulfillments = Array.isArray(rawOrder.fulfillments)
    ? rawOrder.fulfillments
    : Array.isArray(rawOrder.data?.raw_shopify_order?.fulfillments)
    ? rawOrder.data.raw_shopify_order.fulfillments
    : [];

  const rawTrackingNumber =
    rawFulfillments[0]?.tracking_number ||
    rawOrder.tracking_number ||
    rawOrder.data?.tracking_number ||
    null;

  const rawCarrier =
    rawFulfillments[0]?.tracking_company ||
    rawOrder.carrier ||
    rawOrder.data?.carrier ||
    null;

  const trackingNumber = rawTrackingNumber ? String(rawTrackingNumber).trim() : null;
  const carrier = rawCarrier ? String(rawCarrier).trim() : null;
  const hasTracking = Boolean(trackingNumber);

  // Normalize fulfillment status
  const rawStatus = String(
    rawOrder.fulfillment_status ||
    rawOrder.data?.fulfillment_status ||
    rawOrder.status ||
    rawOrder.delivery_status ||
    ''
  ).toLowerCase();

  let fulfillmentStatus: 'fulfilled' | 'partial' | 'unfulfilled' = 'unfulfilled';
  if (
    rawStatus === 'fulfilled' ||
    rawStatus === 'complete' ||
    rawStatus === 'shipped' ||
    rawFulfillments.some((f: any) => f.status === 'success' || f.status === 'shipped')
  ) {
    fulfillmentStatus = 'fulfilled';
  } else if (rawStatus === 'partial' || rawStatus === 'partially_fulfilled') {
    fulfillmentStatus = 'partial';
  } else {
    fulfillmentStatus = 'unfulfilled';
  }

  // 2. Query Candidate Active Issues for this Tenant
  // Strict multi-tenant isolation: Never match cross-tenant
  let querySql = `
    SELECT * FROM iao.order_issues
    WHERE tenant_id = $1
      AND status NOT IN ('resolved', 'closed')
      AND (
        order_id = ANY($2::text[])
        OR evidence->>'shopify_order_id' = $3
        OR metadata->>'shopify_order_id' = $3
        OR (external_order_id IS NOT NULL AND external_order_id = ANY($2::text[]))
        OR (order_number IS NOT NULL AND order_number = ANY($2::text[]))
      )
  `;
  const queryParams: any[] = [tenantId, orderIdVariants, shopifyOrderId || '__no_shopify_id__'];

  if (shopDomain) {
    querySql += ` AND (shop_domain IS NULL OR LOWER(shop_domain) = $${queryParams.length + 1})`;
    queryParams.push(shopDomain);
  }

  if (options.provider === 'custom_store') {
    querySql += ` AND (shop_domain IS NULL OR shop_domain = '')`;
    querySql += ` AND (evidence->>'shopify_order_id' IS NULL OR evidence->>'shopify_order_id' = '')`;
    if (options.connectionId) {
      querySql += ` AND (connection_id IS NULL OR connection_id = $${queryParams.length + 1})`;
      queryParams.push(options.connectionId);
    }
  } else if (options.provider === 'shopify') {
    querySql += ` AND (provider = 'shopify' OR provider IS NULL)`;
  }

  const matchingIssues = await query<OrderIssueRecord>(querySql, queryParams);
  if (!matchingIssues || matchingIssues.length === 0) {
    return [];
  }

  const results: OrderReconciliationResult[] = [];

  for (const issue of matchingIssues) {
    try {
      const existingEvidence = { ...(issue.evidence || {}) };

      // 3. Out-of-Order Event Protection
      const incomingTimestamp = new Date(sourceUpdatedAt).getTime();
      const existingTimestamp = existingEvidence.source_updated_at
        ? new Date(String(existingEvidence.source_updated_at)).getTime()
        : 0;

      if (existingTimestamp > 0 && incomingTimestamp < existingTimestamp) {
        results.push({
          issueId: issue.id,
          orderId: issue.order_id || rawOrderName,
          reconciled: false,
          action: 'out_of_order_skipped',
          details: {
            incoming_timestamp: sourceUpdatedAt,
            existing_timestamp: existingEvidence.source_updated_at,
          },
        });
        continue;
      }

      // 4. Update Evidence while Preserving Customer Claims and Owner Notes
      const updatedEvidence = {
        ...existingEvidence,
        fulfillment_status: fulfillmentStatus,
        source_updated_at: sourceUpdatedAt,
      };

      if (shopifyOrderId) {
        updatedEvidence.shopify_order_id = shopifyOrderId;
      }

      // Owner tasks reconciliation
      let ownerTasks = Array.isArray(existingEvidence.owner_tasks)
        ? existingEvidence.owner_tasks.map((t) => ({ ...t }))
        : [];

      let completedWarehouseTaskId: string | null = null;
      let actionType: OrderReconciliationResult['action'] = 'no_change';
      let hasMeaningfulChange = false;

      let newStatus: OrderIssueStatus = issue.status;
      let newNextAction = issue.next_action;
      let newResponsibleParty = issue.responsible_party;

      // Handle Fulfillment Scenarios
      if (fulfillmentStatus === 'fulfilled') {
        if (hasTracking) {
          // Case C: Fully fulfilled WITH tracking
          updatedEvidence.tracking_number = trackingNumber;
          updatedEvidence.carrier = carrier || 'Courier';
          updatedEvidence.carrier_data_unavailable = false;
          updatedEvidence.investigation_notes = `Order fulfilled in Shopify with active carrier tracking (${carrier || 'Courier'}: ${trackingNumber}).`;

          // Complete only the warehouse fulfillment task and any "locate tracking" task
          ownerTasks = ownerTasks.map((task) => {
            const isFulfillTask =
              task.id.includes('fulfill') ||
              task.title.toLowerCase().includes('fulfillment') ||
              task.title.toLowerCase().includes('warehouse');
            const isLocateTrackingTask =
              task.id.includes('find-tracking') ||
              task.title.toLowerCase().includes('locate courier tracking');

            if ((isFulfillTask || isLocateTrackingTask) && task.status === 'pending') {
              completedWarehouseTaskId = task.id;
              hasMeaningfulChange = true;
              return {
                ...task,
                status: 'completed',
                completed_at: new Date().toISOString(),
                resolution: `Fulfilled in Shopify with carrier tracking (${carrier || 'Courier'}: ${trackingNumber})`,
              };
            }
            return task;
          });

          // Check if any other pending owner tasks remain (e.g. carrier exception, refund review)
          const remainingPendingOwnerTasks = ownerTasks.filter((t) => t.status === 'pending');

          if (remainingPendingOwnerTasks.length === 0) {
            newNextAction = `Order fulfilled with carrier tracking (${carrier || 'Courier'}: ${trackingNumber}). Monitor delivery progress.`;
            newResponsibleParty = 'ai_operator';
            // If the issue was awaiting owner solely because of warehouse fulfillment, transition to investigating
            if (issue.status === 'awaiting_owner') {
              newStatus = 'investigating';
              hasMeaningfulChange = true;
            }
          }

          if (
            existingEvidence.tracking_number !== trackingNumber ||
            existingEvidence.fulfillment_status !== 'fulfilled'
          ) {
            hasMeaningfulChange = true;
            actionType = existingEvidence.tracking_number !== trackingNumber && existingEvidence.fulfillment_status === 'fulfilled'
              ? 'tracking_updated'
              : 'fulfillment_updated';
          }
        } else {
          // Case D: Fully fulfilled WITHOUT tracking
          updatedEvidence.tracking_number = null;
          updatedEvidence.carrier_data_unavailable = true;
          updatedEvidence.investigation_notes =
            'Order marked fulfilled in store records, but courier tracking details are unavailable. Created owner investigation task.';

          // Complete warehouse fulfillment task
          ownerTasks = ownerTasks.map((task) => {
            const isFulfillTask =
              task.id.includes('fulfill') ||
              task.title.toLowerCase().includes('fulfillment');
            if (isFulfillTask && task.status === 'pending') {
              completedWarehouseTaskId = task.id;
              hasMeaningfulChange = true;
              return {
                ...task,
                status: 'completed',
                completed_at: new Date().toISOString(),
                resolution: 'Fulfilled in Shopify; tracking details unavailable',
              };
            }
            return task;
          });

          // Create or retain owner task to locate tracking
          const hasTrackingTask = ownerTasks.some(
            (t) => (t.id.includes('find-tracking') || t.title.toLowerCase().includes('locate courier tracking')) && t.status === 'pending'
          );

          if (!hasTrackingTask) {
            const trackingTaskId = `task-${Date.now()}-find-tracking`;
            ownerTasks.push({
              id: trackingTaskId,
              title: `Locate courier tracking information for order ${issue.order_id || rawOrderName}`,
              status: 'pending',
              created_at: new Date().toISOString(),
            });
            hasMeaningfulChange = true;
          }

          newNextAction = `Owner to locate courier tracking information for order ${issue.order_id || rawOrderName}.`;
          newResponsibleParty = 'owner';
          newStatus = 'awaiting_owner';
          actionType = 'fulfillment_updated';
        }
      } else if (fulfillmentStatus === 'partial') {
        // Case B: Partially fulfilled
        updatedEvidence.fulfillment_status = 'partial';
        if (hasTracking) {
          updatedEvidence.tracking_number = trackingNumber;
          updatedEvidence.carrier = carrier || 'Courier';
        }

        // Mark full fulfillment task as completed with note
        ownerTasks = ownerTasks.map((task) => {
          if (task.id.includes('fulfill') && !task.id.includes('partial') && task.status === 'pending') {
            return {
              ...task,
              status: 'completed',
              completed_at: new Date().toISOString(),
              resolution: 'Partially fulfilled in Shopify; remaining items pending',
            };
          }
          return task;
        });

        // Ensure partial fulfillment task is active
        const hasPartialTask = ownerTasks.some(
          (t) => t.id.includes('partial-fulfill') && t.status === 'pending'
        );
        if (!hasPartialTask) {
          ownerTasks.push({
            id: `task-${Date.now()}-partial-fulfill`,
            title: `Dispatch outstanding unfulfilled items for partially fulfilled order ${issue.order_id || rawOrderName}`,
            status: 'pending',
            created_at: new Date().toISOString(),
          });
          hasMeaningfulChange = true;
        }

        newNextAction = `Warehouse team to dispatch remaining outstanding items for partially fulfilled order ${issue.order_id || rawOrderName}.`;
        newResponsibleParty = 'owner';
        newStatus = 'awaiting_owner';
        hasMeaningfulChange = true;
        actionType = 'fulfillment_updated';
      } else {
        // Case A: Unfulfilled
        updatedEvidence.fulfillment_status = 'unfulfilled';
        updatedEvidence.tracking_number = null;

        // Ensure warehouse task is present and pending
        const hasFulfillTask = ownerTasks.some(
          (t) => (t.id.includes('fulfill') || t.title.toLowerCase().includes('fulfillment')) && t.status === 'pending'
        );
        if (!hasFulfillTask) {
          ownerTasks.push({
            id: `task-${Date.now()}-fulfill`,
            title: `Warehouse fulfillment required for order ${issue.order_id || rawOrderName}`,
            status: 'pending',
            created_at: new Date().toISOString(),
          });
          hasMeaningfulChange = true;
        }

        newNextAction = `Warehouse team to expedite and dispatch unfulfilled order ${issue.order_id || rawOrderName}.`;
        newResponsibleParty = 'owner';
        newStatus = 'awaiting_owner';
      }

      updatedEvidence.owner_tasks = ownerTasks;

      // Check if evidence or status differs from previous
      if (
        existingEvidence.fulfillment_status !== updatedEvidence.fulfillment_status ||
        existingEvidence.tracking_number !== updatedEvidence.tracking_number ||
        issue.status !== newStatus ||
        issue.next_action !== newNextAction ||
        completedWarehouseTaskId !== null
      ) {
        hasMeaningfulChange = true;
      }

      if (!hasMeaningfulChange) {
        results.push({
          issueId: issue.id,
          orderId: issue.order_id || rawOrderName,
          reconciled: true,
          action: 'no_change',
        });
        continue;
      }

      // 5. Update Database Record Atomically
      await query(
        `UPDATE iao.order_issues
         SET evidence = $1::jsonb,
             status = $2,
             next_action = $3,
             responsible_party = $4,
             updated_at = NOW()
         WHERE id = $5 AND tenant_id = $6;`,
        [
          JSON.stringify(updatedEvidence),
          newStatus,
          newNextAction,
          newResponsibleParty,
          issue.id,
          tenantId,
        ]
      );

      // 6. Selectively Cancel Obsolete Task Reminders
      if (completedWarehouseTaskId) {
        await cancelFollowupsForTask(tenantId, issue.id, completedWarehouseTaskId);
      }

      // 7. Record Chronological Audit Event
      let auditSummary = `Shopify order ${issue.order_id || rawOrderName} reconciled: fulfillment status is ${fulfillmentStatus}`;
      if (fulfillmentStatus === 'fulfilled' && hasTracking) {
        auditSummary = `Shopify order ${issue.order_id || rawOrderName} fulfilled with tracking ${trackingNumber} (${carrier || 'Courier'}). Warehouse task completed.`;
      } else if (fulfillmentStatus === 'fulfilled' && !hasTracking) {
        auditSummary = `Shopify order ${issue.order_id || rawOrderName} marked fulfilled without tracking. Created task to locate tracking.`;
      } else if (fulfillmentStatus === 'partial') {
        auditSummary = `Shopify order ${issue.order_id || rawOrderName} partially fulfilled. Task retained for outstanding items.`;
      }

      await addOrderIssueEvent({
        tenantId,
        issueId: issue.id,
        eventType: actionType === 'tracking_updated' ? 'tracking_updated' : 'order_reconciled',
        actorType: 'system',
        summary: auditSummary,
        details: {
          shopify_order_id: shopifyOrderId,
          fulfillment_status: fulfillmentStatus,
          tracking_number: trackingNumber,
          carrier,
          previous_status: issue.status,
          new_status: newStatus,
          completed_task_id: completedWarehouseTaskId,
          source: options.source || 'shopify_sync',
        },
      });

      results.push({
        issueId: issue.id,
        orderId: issue.order_id || rawOrderName,
        reconciled: true,
        action: actionType !== 'no_change' ? actionType : 'task_completed',
        details: {
          fulfillment_status: fulfillmentStatus,
          tracking_number: trackingNumber,
          status: newStatus,
          completed_task_id: completedWarehouseTaskId,
        },
      });
    } catch (issueErr) {
      console.error(`[Reconcile Issue Error ${issue.id}]`, issueErr);
      results.push({
        issueId: issue.id,
        orderId: issue.order_id || rawOrderName,
        reconciled: false,
        action: 'no_change',
        error: issueErr instanceof Error ? issueErr.message : String(issueErr),
      });
    }
  }

  return results;
}

/**
 * Reconciles an array of orders in batch.
 */
export async function reconcileShopifyOrdersBatch(
  tenantId: string,
  rawOrders: any[],
  options: {
    shopDomain?: string | null;
    source?: string;
  } = {}
): Promise<OrderReconciliationResult[]> {
  const allResults: OrderReconciliationResult[] = [];
  for (const order of rawOrders) {
    const res = await reconcileShopifyOrderUpdate(tenantId, order, options);
    allResults.push(...res);
  }
  return allResults;
}

/**
 * Selectively cancels only follow-up jobs associated with a completed task
 * using persisted, unambiguous task associations without guessing from ID patterns.
 * Where association cannot be established, preserves the job and reports the ambiguity.
 */
export async function cancelFollowupsForTask(
  tenantId: string,
  issueId: string,
  taskId: string
): Promise<{
  cancelledCount: number;
  cancelledJobIds: string[];
  preservedAmbiguousJobIds: string[];
}> {
  // Query all active jobs for this issue
  const activeJobs = await query<OrderIssueFollowupJobRecord>(
    `SELECT * FROM iao.order_issue_followup_jobs
     WHERE tenant_id = $1 AND issue_id = $2 AND status IN ('pending', 'claimed');`,
    [tenantId, issueId]
  );

  const matchingJobIds: string[] = [];
  const preservedAmbiguousJobIds: string[] = [];

  for (const job of activeJobs) {
    const jobTaskId = job.associated_task_id || job.metadata?.associated_task_id || job.metadata?.task_id;
    if (jobTaskId) {
      if (String(jobTaskId).trim() === String(taskId).trim()) {
        matchingJobIds.push(job.id);
      }
      // If associated with a different task, leave untouched
    } else {
      // Legacy or unassociated job: do NOT guess by ID pattern!
      // Preserve the job and track the ambiguity
      preservedAmbiguousJobIds.push(job.id);
    }
  }

  // Cancel only unambiguously matching jobs
  if (matchingJobIds.length > 0) {
    await query(
      `UPDATE iao.order_issue_followup_jobs
       SET status = 'cancelled', updated_at = NOW(),
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{cancellation_reason}', '"task_completed_by_reconciliation"')
       WHERE tenant_id = $1 AND id = ANY($2::text[]);`,
      [tenantId, matchingJobIds]
    );
  }

  // If there are ambiguous jobs, report the ambiguity via audit event
  if (preservedAmbiguousJobIds.length > 0) {
    await addOrderIssueEvent({
      tenantId,
      issueId,
      eventType: 'status_changed',
      actorType: 'system',
      summary: `Preserved ${preservedAmbiguousJobIds.length} unassociated legacy reminder(s) during task completion due to ambiguous task association.`,
      details: {
        task_id: taskId,
        preserved_job_ids: preservedAmbiguousJobIds,
        reason: 'unassociated_legacy_reminder_preserved_without_guessing',
      },
    });
  }

  return {
    cancelledCount: matchingJobIds.length,
    cancelledJobIds: matchingJobIds,
    preservedAmbiguousJobIds,
  };
}

/**
 * Authorizes a manual execution action (refund, exchange, cancellation)
 * creating a single owner execution task and transitioning the issue to action_pending.
 * Idempotent: repeated calls with the same proposal ID return the existing task.
 */
export async function authorizeOrderIssueAction(params: {
  tenantId: string;
  issueId: string;
  approverId: string;
  actionType: 'refund' | 'exchange' | 'cancellation' | string;
  actionDetails: {
    amount?: number;
    currency?: string;
    reason?: string;
    items?: unknown[];
    replacement_size?: string;
    proposal_id?: string;
    proposal_revision?: number;
    [key: string]: unknown;
  };
  proposalId?: string;
  proposalRevision?: number;
  dbClient?: any;
}): Promise<{ issue: OrderIssueRecord; task: any; alreadyExisted: boolean }> {
  const { tenantId, issueId, approverId, actionType, actionDetails, proposalId, proposalRevision, dbClient } = params;

  const executeWithClient = async (client: any) => {
    // 1. Lock and fetch current order issue atomically
    const issueRes = await client.query(
      `SELECT * FROM iao.order_issues WHERE tenant_id = $1 AND id = $2 FOR UPDATE;`,
      [tenantId, issueId]
    );
    if (issueRes.rows.length === 0) {
      throw new Error(`Order issue ${issueId} not found`);
    }
    const current: OrderIssueRecord = issueRes.rows[0];

    const existingTasks = (current.evidence?.owner_tasks || []) as any[];

    // 2. Gap 2: Validate refund amount against verified refundable balance and approved proposal currency
    if (actionType === 'refund') {
      if (typeof actionDetails.amount !== 'number' || actionDetails.amount <= 0 || !actionDetails.currency?.trim()) {
        throw new Error('Missing or invalid refund amount or currency; requires review.');
      }

      const requestedCurrency = actionDetails.currency.trim().toUpperCase();

      // Lookup verified order financials
      let verifiedTotal: number | null = null;
      let verifiedRefunded: number = 0;
      let verifiedCurrency: string | null = null;

      if (current.order_id) {
        const cleanId = current.order_id.trim().toUpperCase();
        const orderRows = await client.query(
          `SELECT total, currency, data FROM iao.orders 
           WHERE tenant_id = $1 AND (
             order_id = $2 OR order_id = $3
             OR external_order_id = $2 OR external_order_id = $3
             OR order_number = $2 OR order_number = $3
           ) LIMIT 1;`,
          [tenantId, cleanId, current.order_id]
        );
        if (orderRows.rows.length > 0) {
          const ord = orderRows.rows[0];
          verifiedCurrency = (ord.currency || ord.data?.currency || '').trim().toUpperCase();
          verifiedRefunded = Number(ord.data?.total_refunded || 0);
          if (ord.data?.refundable_balance !== undefined && ord.data?.refundable_balance !== null) {
            verifiedTotal = Number(ord.data.refundable_balance) + verifiedRefunded;
          } else {
            verifiedTotal = Number(ord.total ?? ord.data?.total_amount ?? ord.data?.total_price ?? ord.data?.current_total_price);
          }
        }
      }

      // Fallback to evidence financials
      if (verifiedTotal === null && current.evidence) {
        const ev = current.evidence as any;
        if (ev.refundable_balance !== undefined) {
          verifiedTotal = Number(ev.refundable_balance);
          verifiedCurrency = String(ev.currency || ev.verified_order?.currency || '').trim().toUpperCase();
        } else if (ev.verified_order?.total !== undefined) {
          verifiedTotal = Number(ev.verified_order.total);
          verifiedCurrency = String(ev.verified_order.currency || '').trim().toUpperCase();
          verifiedRefunded = Number(ev.verified_order.total_refunded || 0);
        } else if (ev.order_total !== undefined) {
          verifiedTotal = Number(ev.order_total);
          verifiedCurrency = String(ev.currency || '').trim().toUpperCase();
        }
      }

      // Currency integrity check: must match verified order currency
      if (verifiedCurrency && verifiedCurrency !== requestedCurrency) {
        throw new Error(
          `Currency mismatch: Requested refund currency ${requestedCurrency} does not match verified order currency ${verifiedCurrency}; requires review.`
        );
      }

      // Balance integrity check: verified refundable balance required and amount must not exceed it
      if (verifiedTotal === null || isNaN(verifiedTotal)) {
        throw new Error('Missing verified order refundable balance; requires review before authorization.');
      }

      const refundableBalance = Math.max(0, verifiedTotal - verifiedRefunded);
      if (actionDetails.amount > refundableBalance + 0.001) {
        throw new Error(
          `Refund amount (${actionDetails.amount} ${requestedCurrency}) exceeds verified refundable balance (${refundableBalance.toFixed(2)} ${verifiedCurrency || requestedCurrency}); requires review.`
        );
      }
    }

    // 3. Idempotency check: see if execution task already exists for this proposal
    const existingExecTask = existingTasks.find(
      (t: any) =>
        t.task_type === 'manual_action_execution' &&
        proposalId &&
        (t.action_details?.proposal_id === proposalId || t.id.includes(proposalId))
    );

    if (existingExecTask) {
      return { issue: current, task: existingExecTask, alreadyExisted: true };
    }

    const taskId = `task-${Date.now()}-exec-${actionType}`;
    const orderRef = current.order_id ? `#${current.order_id.replace(/^#/, '')}` : 'order';
    let taskTitle = `Execute approved ${actionType} for order ${orderRef}`;
    if (actionType === 'refund' && actionDetails.amount && actionDetails.currency) {
      taskTitle = `Execute approved refund (${actionDetails.amount} ${actionDetails.currency}) for order ${orderRef}`;
    } else if (actionType === 'exchange') {
      taskTitle = `Execute approved exchange for order ${orderRef}`;
    } else if (actionType === 'cancellation') {
      taskTitle = `Execute approved cancellation for order ${orderRef}`;
    }

    const newTask = {
      id: taskId,
      title: taskTitle,
      status: 'pending' as const,
      task_type: 'manual_action_execution',
      action_type: actionType,
      action_details: {
        ...actionDetails,
        proposal_id: proposalId,
        proposal_revision: proposalRevision,
      },
      approved_by: approverId,
      approved_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    const updatedTasks = [...existingTasks, newTask];
    const nextAction = `Approved — awaiting execution: Execute ${actionType} in store admin or payment provider.`;

    // Gap 5: Clarify that read-only Shopify refund verification does not require write scopes
    const updatedEvidence = {
      ...current.evidence,
      owner_tasks: updatedTasks,
      proposal_id: proposalId,
      proposal_action: actionType,
      execution_pending_reason: 'Manual execution phase: Refunds are executed manually in store admin or payment provider. Read-only Shopify order verification is used without requesting write access.',
      last_approved_action: {
        action_type: actionType,
        action_details: actionDetails,
        approved_by: approverId,
        approved_at: newTask.approved_at,
      },
    };

    // 4. Update order issue atomically
    const updateRes = await client.query(
      `UPDATE iao.order_issues
       SET status = 'action_pending',
           responsible_party = 'owner',
           next_action = $3,
           evidence = $4::jsonb,
           updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *;`,
      [tenantId, issueId, nextAction, JSON.stringify(updatedEvidence)]
    );
    const updatedIssue: OrderIssueRecord = updateRes.rows[0];

    // 5. Append audit event atomically
    await client.query(
      `INSERT INTO iao.order_issue_events (
        tenant_id, issue_id, event_type, actor_type, actor_id, summary, details, created_at
      ) VALUES ($1, $2, 'action_approved', 'owner', $3, $4, $5::jsonb, NOW());`,
      [
        tenantId,
        issueId,
        approverId,
        `Owner approved ${actionType} proposal for ${orderRef}. Manual execution task created.`,
        JSON.stringify({
          task_id: taskId,
          action_type: actionType,
          action_details: actionDetails,
          proposal_id: proposalId,
          proposal_revision: proposalRevision,
          from_status: current.status,
          to_status: 'action_pending',
        }),
      ]
    );

    return { issue: updatedIssue, task: newTask, alreadyExisted: false };
  };

  if (dbClient) {
    return await executeWithClient(dbClient);
  } else {
    return await withTransaction(executeWithClient);
  }
}

/**
 * Records manual execution of an owner task (e.g. refund/exchange/cancellation completed in Shopify admin).
 * Labels the completion as "Owner-reported completion" and preserves who and when.
 * Completing this task does NOT automatically resolve other outstanding tasks or not-received complaints.
 */
export async function recordManualActionExecution(params: {
  tenantId: string;
  issueId: string;
  taskId: string;
  ownerId: string;
  executionReference: string;
  evidenceNotes?: string;
  completedAt?: string;
}): Promise<{ issue: OrderIssueRecord; task: any; remainingPendingTasksCount: number; alreadyCompleted: boolean }> {
  const { tenantId, issueId, taskId, ownerId, executionReference, evidenceNotes, completedAt } = params;

  if (!executionReference || !executionReference.trim()) {
    throw new Error('Execution reference is required to record manual execution.');
  }

  return await withTransaction(async (client) => {
    // 1. Lock and fetch current order issue
    const issueRes = await client.query(
      `SELECT * FROM iao.order_issues WHERE tenant_id = $1 AND id = $2 FOR UPDATE;`,
      [tenantId, issueId]
    );
    if (issueRes.rows.length === 0) {
      throw new Error(`Order issue ${issueId} not found`);
    }
    const current: OrderIssueRecord = issueRes.rows[0];

    const existingTasks = (current.evidence?.owner_tasks || []) as any[];
    const targetTask = existingTasks.find((t: any) => t.id === taskId);
    if (!targetTask) {
      throw new Error(`Task ${taskId} not found on issue ${issueId}`);
    }

    const remainingPendingTasks = existingTasks.filter((t: any) => t.id !== taskId && t.status === 'pending');

    if (targetTask.status === 'completed') {
      return {
        issue: current,
        task: targetTask,
        remainingPendingTasksCount: remainingPendingTasks.length,
        alreadyCompleted: true,
      };
    }

    const completionTimestamp = completedAt || new Date().toISOString();
    const completedTask = {
      ...targetTask,
      status: 'completed' as const,
      completed_at: completionTimestamp,
      completed_by: ownerId,
      execution_reference: executionReference.trim(),
      completion_label: 'Owner-reported completion',
      notes: evidenceNotes ? evidenceNotes.trim() : targetTask.notes,
    };

    const updatedTasks = existingTasks.map((t: any) => (t.id === taskId ? completedTask : t));

    // Determine issue status and next action after task completion
    // Requirement 10: Completing an execution task must not automatically resolve other outstanding tasks or a not-received complaint.
    let newStatus: OrderIssueRecord['status'] = current.status;
    let newNextAction: string = current.next_action || '';
    let resolutionSummary: string | undefined = undefined;

    if (remainingPendingTasks.length > 0) {
      newStatus = 'awaiting_owner';
      const nextPendingTitle = remainingPendingTasks[0]?.title || 'outstanding task';
      newNextAction = `Manual action executed (Owner-reported). Next pending: ${nextPendingTitle}`;
    } else {
      // No other owner tasks pending. But check if it's a delivery or not-received complaint:
      if (current.issue_type === 'not_received' || current.issue_type === 'delivery_delay') {
        newStatus = 'awaiting_owner';
        newNextAction = 'Manual action executed (Owner-reported). Customer delivery inquiry remains open for carrier/customer confirmation.';
      } else {
        // Return or cancellation issue where all tasks are complete
        newStatus = 'resolved';
        newNextAction = 'All actions completed. Case resolved.';
        resolutionSummary = `Manual action executed (Ref: ${executionReference.trim()}, Owner-reported completion).`;
      }
    }

    const updatedEvidence = {
      ...current.evidence,
      owner_tasks: updatedTasks,
      last_completed_action: {
        task_id: taskId,
        execution_reference: executionReference.trim(),
        completion_label: 'Owner-reported completion',
        completed_by: ownerId,
        completed_at: completionTimestamp,
      },
    };

    // 2. Update issue atomically
    const updateRes = await client.query(
      `UPDATE iao.order_issues
       SET status = $3,
           responsible_party = $4,
           next_action = $5,
           resolution_summary = $6,
           evidence = $7::jsonb,
           updated_at = NOW(),
           resolved_at = CASE WHEN $3 = 'resolved' THEN NOW() ELSE resolved_at END
       WHERE tenant_id = $1 AND id = $2
       RETURNING *;`,
      [
        tenantId,
        issueId,
        newStatus,
        newStatus === 'resolved' ? 'system' : 'owner',
        newNextAction,
        resolutionSummary || null,
        JSON.stringify(updatedEvidence),
      ]
    );
    const updated = updateRes.rows[0];

    // 3. Append execution event atomically
    await client.query(
      `INSERT INTO iao.order_issue_events (
        tenant_id, issue_id, event_type, actor_type, actor_id, summary, details, created_at
      ) VALUES ($1, $2, 'manual_action_executed', 'owner', $3, $4, $5::jsonb, NOW());`,
      [
        tenantId,
        issueId,
        ownerId,
        `Manual action executed (Owner-reported completion): ${executionReference.trim()}`,
        JSON.stringify({
          task_id: taskId,
          execution_reference: executionReference.trim(),
          completion_label: 'Owner-reported completion',
          completed_by: ownerId,
          completed_at: completionTimestamp,
          evidence_notes: evidenceNotes,
          remaining_pending_tasks: remainingPendingTasks.length,
        }),
      ]
    );

    return {
      issue: updated,
      task: completedTask,
      remainingPendingTasksCount: remainingPendingTasks.length,
      alreadyCompleted: false,
    };
  });
}

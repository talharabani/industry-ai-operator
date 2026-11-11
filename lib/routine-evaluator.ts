import type { BusinessSettings, FaqItem, ProductServiceItem, OrderRecord } from './types.ts';
import { classifyEmailMessage } from './email-filter.ts';

export type AutomationMode = 'draft_only' | 'auto_routine' | 'paused';

export interface RoutineEvaluationResult {
  canAutoReply: boolean;
  intent:
    | 'routine_greeting'
    | 'routine_faq'
    | 'routine_hours'
    | 'routine_service_info'
    | 'routine_service_area_info'
    | 'routine_policy_info'
    | 'routine_product_info'
    | 'routine_order_status'
    | 'routine_clarification'
    | 'routine_general_info'
    | 'financial_action'
    | 'ambiguous'
    | 'paused'
    | 'loop_prevented'
    | 'ignored_automated';
  reason: string;
  groundedSources: string[];
  replyText?: string;
  acknowledgmentDraftText?: string;
  requiresApproval: boolean;
  financialOrMajorAction: boolean;
}

// 1. Strict Action Triggers: Actual requests for refunds, exchanges, cancellations, payment changes
const ACTION_REQUEST_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  {
    regex: /(i\s*(want|need|would\s*like|demand|request|am\s*asking\s*for)|please|kindly|can\s*(i|you)\s*(process|give|issue|send|provide)|give\s*me|send\s*me|want\s*my)\s*.*(refund|money\s*back|reimburse|reimbursement|credit\s*back)/i,
    label: 'Refund / Reimbursement Request',
  },
  {
    regex: /\b(i\s*want\s*a\s*refund|please\s*refund|refund\s*(me|my|this|the\s*order)|refund\s*my\s*money|issue\s*a\s*refund|need\s*a\s*refund|get\s*a\s*refund|return\s*for\s*(a\s*)?refund|terugbetaling|geld\s*terug|aankoopbedrag\s*terug|restitutie)\b/i,
    label: 'Refund / Reimbursement Request',
  },
  {
    regex: /(i\s*(want|need|would\s*like)|please|kindly|can\s*(i|you)\s*(process|do|swap))\s*.*(exchange|replacement|replace\s*item|swap\s*size|ruilen|omruilen)/i,
    label: 'Exchange / Replacement Request',
  },
  {
    regex: /\b(exchange\s*(my|these|this|the|shoes|shirt|jacket|item|product|size)|please\s*exchange|want\s*to\s*exchange|replace\s*(my|this|these)|damaged\s*item\s*return|artikel\s*ruilen|product\s*ruilen)\b/i,
    label: 'Exchange / Replacement Request',
  },
  {
    regex: /\b(cancel\s*(my|the|this)?\s*order|order\s*cancellation|cancel\s*(my\s*)?booking|stop\s*shipment|stop\s*delivery|bestelling\s*annuleren|annulering)\b/i,
    label: 'Order / Booking Cancellation Request',
  },
  {
    regex: /\b(chargeback|payment\s*dispute|bank\s*transfer|wire\s*transfer|credit\s*card\s*charge|payment\s*reversal)\b/i,
    label: 'Payment / Chargeback Request',
  },
  {
    regex: /\b(supplier\s*purchase|purchase\s*order|wholesale|custom\s*quote|binding\s*agreement|contract\s*commitment|give\s*(?:me\s*)?(?:a\s*)?(?:\w+\s*)?quote|send\s*(?:me\s*)?(?:a\s*)?(?:\w+\s*)?quote|request\s*(?:a\s*)?quote|\bquote\b|\bdiscount\b|\bestimate\b|\bprice\s*match\b|\bguarantee\b)/i,
    label: 'Quote / Discount / Commercial Commitment',
  },
];

// 1b. Services & Service Area Inquiry Patterns (Services Pack)
const SERVICE_INQUIRY_PATTERNS = [
  /\b(what\s*services\s*(do\s*you\s*(offer|provide)|are\s*available)|tell\s*me\s*about\s*your\s*services|list\s*of\s*services|our\s*services|what\s*do\s*you\s*(do|offer)|service\s*offerings|available\s*services)\b/i,
  /\b(book\s*(a\s*)?(service|consultation|appointment)|schedule\s*(a\s*)?(service|consultation|appointment)|hire\s*you|need\s*(your\s*)?service)\b/i,
];

const SERVICE_AREA_PATTERNS = [
  /\b(service\s*area|service\s*areas|what\s*areas?\s*(do\s*you\s*cover|do\s*you\s*serve)|do\s*you\s*(come\s*to|service|cover|travel\s*to)|locations?\s*(served|covered)|coverage\s*area|areas?\s*of\s*operation)\b/i,
];

// 2. Order & Delivery Tracking Patterns
const ORDER_STATUS_PATTERNS = [
  /\b(where\s*is\s*(my\s*)?order|order\s*status|track\s*(my\s*)?(order|package|shipment|delivery)|delivery\s*status|when\s*will\s*(my\s*)?order\s*arrive|has\s*(my\s*)?order\s*shipped|shipping\s*status|tracking\s*number|package\s*status)\b/i,
  /\b(check\s*(my\s*)?order|status\s*(and|of|for|on|van)?\s*(my|mijn)?\s*(order|package|shipment|delivery|bestelling|pakket)|where\s*is\s*(my\s*)?package|where\s*is\s*(my\s*)?shipment|order\s*update)\b/i,
  /\b(waar\s*is\s*(mijn\s*)?bestelling|status\s*(van\s*)?(mijn\s*)?bestelling|bestelling\s*volgen|track\s*&\s*trace|verzendstatus)\b/i,
  /\b(tracking\s*(for|info|information|details|number)?\s*(order|package|shipment)?)\b/i,
  /\b((?:ORD|TBS)-[a-zA-Z0-9_-]+)\b/i,
  /(?:^|\s)#\d{2,15}\b/,
  /\b(?:order|ord|bestelling)\s*[:?#-]?\s*#?[a-zA-Z0-9_-]{2,20}\b/i,
];

// 3. Published Policy Question Patterns (Routine Explanations)
const POLICY_INQUIRY_PATTERNS = [
  /\b(what\s*(is|are)\s*(your|the)?\s*(return|refund|exchange|cancellation|shipping|delivery)\s*policy)\b/i,
  /\b(how\s*does\s*(your|the)?\s*(return|refund|exchange|shipping|delivery)\s*policy\s*work)\b/i,
  /\b(explain\s*(your|the)?\s*(return|refund|exchange|cancellation|shipping|delivery)\s*policy)\b/i,
  /\b(policy\s*on\s*(returns|refunds|exchanges|cancellations|shipping|delivery))\b/i,
  /\b(how\s*many\s*days\s*(do\s*I\s*have\s*to\s*)?(return|exchange|cancel)|return\s*window|exchange\s*window)\b/i,
  /\b(shipping\s*policy|delivery\s*timeframe|how\s*long\s*does\s*shipping\s*take|delivery\s*policy|cancellation\s*policy)\b/i,
  /\b(tell\s*me\s*about\s*(your\s*)?(return|refund|exchange|shipping)\s*policy)\b/i,
  /\b(wat\s*(is|zijn)\s*(het|jullie|uw)?\s*(retourbeleid|verzendbeleid|terugbetalingsbeleid|annuleringsbeleid|garantiebeleid))\b/i,
  /\b(hoe\s*(kan\s*ik|werkt\s*het)\s*(retourneren|ruilen|terugsturen)|binnen\s*hoeveel\s*dagen\s*(retourneren|terugsturen)|retourtermijn|bedenktijd|retourbeleid)\b/i,
  /\b(wat\s*zijn\s*de\s*(verzendkosten|levertijden)|hoe\s*lang\s*duurt\s*de\s*verzending|levertijd|verzendbeleid)\b/i,
];

// 4. Greeting Patterns
const GREETING_PATTERNS = [
  /^(hi|hello|hey|good\s*morning|good\s*afternoon|good\s*evening|hi\s*there|hey\s*there|greetings|hallo|hoi|goedemorgen|goedemiddag|goedenavond|beste)[\s!.,?]*$/i,
  /^(hi|hello|hey|good\s*morning|good\s*afternoon|good\s*evening|hi\s*there|hey\s*there|greetings|hallo|hoi|goedemorgen|goedemiddag|goedenavond|beste)[\s!.,?]+(team|support|there|admin|everyone|all|klantenservice)?[\s!.,?]*$/i,
];

// 5. Working Hours Patterns
const WORKING_HOURS_PATTERNS = [
  /\b(working\s*hours|business\s*hours|opening\s*hours|what\s*time\s*do\s*you\s*open|what\s*time\s*do\s*you\s*close|when\s*are\s*you\s*open|open\s*on\s*(saturdays?|sundays?|weekends?))\b/i,
  /\b(hours\s*of\s*operation|store\s*timing|operating\s*schedule|open\s*today|are\s*you\s*open|openingstijden|bereikbaarheid|wanneer\s*open)\b/i,
];

// 6. Product Availability & Pricing Patterns
const PRODUCT_INQUIRY_PATTERNS = [
  /\b(available|availability|in\s*stock|out\s*of\s*stock|do\s*you\s*have|is\s+.*\s+available|is\s+it\s+in\s+stock|beschikbaar|op\s*voorraad|hebben\s*jullie)\b/i,
  /\b(how\s*much\s*is|what\s*is\s*the\s*price|price\s*of|price|pricing|cost\s*of|product\s*price|catalog\s*price|wat\s*kost|prijs\s*van|prijs)\b/i,
  /\b(what\s*products\s*do\s*you\s*(have|sell|offer)|product\s*catalog|product\s*list|available\s*items|do\s*you\s*sell)\b/i,
  /\b(can\s*i\s*(purchase|buy|order|get)|want\s*to\s*(purchase|buy|order)|kan\s*ik\s*(kopen|aanschaffen|bestellen)|interesse\s*in)\b/i,
];

// 7. Store Location Patterns
const STORE_LOCATION_PATTERNS = [
  /\b(where\s*are\s*you\s*located|store\s*location|physical\s*store|headquarters|what\s*country|where\s*is\s*your\s*shop|waar\s*gevestigd|waar\s*zijn\s*jullie\s*gevestigd)\b/i,
];

/**
 * Strips quoted history and headers from an email body to isolate new customer text
 */
export function cleanQuotedReplyText(text: string): string {
  if (!text) return '';

  // 1. Strip multi-line "On ... wrote:" patterns before line splitting.
  // In Gmail, the attribution "On <date> at <time>, <name> <\n email> wrote:" spans 2-4 lines.
  let cleaned = text.replace(/(?:\r?\n|^)\s*On\s+[\s\S]{1,400}?\bwrote:\s*(?:\r?\n|$)/i, '\n');

  // Strip common email client dividers
  cleaned = cleaned.replace(/(?:\r?\n|^)\s*-{3,}\s*(?:Original Message|Forwarded Message)[\s\S]*$/i, '');
  cleaned = cleaned.replace(/(?:\r?\n|^)\s*_{5,}[\s\S]*$/, '');
  cleaned = cleaned.replace(/(?:\r?\n|^)\s*From:\s+[\s\S]+?\nSent:\s+[\s\S]*$/i, '');

  const lines = cleaned.split(/\r?\n/);
  const clean: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>')) {
      continue;
    }
    if (/^On\s+.+wrote:$/i.test(trimmed) || /^On\s+.+at\s+.+,\s*.+wrote:$/i.test(trimmed)) {
      break;
    }
    if (/^---+\s*(Original Message|Forwarded Message)\s*---+/i.test(trimmed)) {
      break;
    }
    if (/^_{5,}/.test(trimmed)) {
      break;
    }
    if (/^From:\s+/i.test(trimmed) && clean.length > 0) {
      break;
    }
    clean.push(line);
  }
  const result = clean.join('\n').trim();
  return result || text.trim();
}

export interface ExtractedOrderRef {
  raw: string;
  normalized: string;
  isExplicitOrdPrefix: boolean;
  isNumericOnly: boolean;
}

/**
 * Extracts and normalizes order references (#1001, 1001, ORD-1001, Shopify GID)
 */
export function extractOrderReference(text: string): ExtractedOrderRef | null {
  if (!text) return null;

  // 1. Explicit ORD or TBS prefix (e.g. ORD-1001, TBS-1001, ord_tbs_1001, ORD-DEMO-889)
  const ordMatch = text.match(/\b((?:ORD|TBS)[-_][a-zA-Z0-9_-]+|ord_tbs_[a-zA-Z0-9_-]+)\b/i);
  if (ordMatch) {
    const raw = ordMatch[1].trim();
    return {
      raw,
      normalized: raw.toUpperCase(),
      isExplicitOrdPrefix: /^ORD-/i.test(raw),
      isNumericOnly: false,
    };
  }

  // 2. Hash prefixed order number (e.g. #1001, # 1001, order? #1001)
  const hashMatch = text.match(/(?:^|\s|[,.?!;:(])#\s*([a-zA-Z0-9_-]{2,30})\b/);
  if (hashMatch) {
    const core = hashMatch[1].trim();
    const raw = `#${core}`;
    return {
      raw,
      normalized: core.toUpperCase(),
      isExplicitOrdPrefix: false,
      isNumericOnly: /^\d+$/.test(core),
    };
  }

  // 3. Keyword-prefixed order number with digits or symbols (e.g. "order: 1001", "order 1001", "bestelling ord_tbs_1001")
  const stopWords = new Set([
    'inquiry', 'status', 'update', 'details', 'number', 'num', 'id', 'confirmation', 
    'cancellation', 'tracking', 'placed', 'shipped', 'delivered', 'received', 
    'item', 'items', 'package', 'help', 'please', 'today', 'yesterday', 'my', 
    'the', 'this', 'our', 'a', 'an', 'is', 'was', 'for', 'with', 'and', 'or', 'to', 'from',
    'van', 'mijn', 'bij', 'voor', 'in', 'op', 'over', 'geplaatst', 'verzonden', 'geleverd'
  ]);

  const kwMatches = text.matchAll(/\b(?:order|ord|ref|reference|tracking|track|bestelling|bestelnummer|ordernummer)\s*(?:id|num|number)?\s*[:?#-]?\s*#?\s*([a-zA-Z0-9_-]{2,30})\b/gi);
  for (const match of kwMatches) {
    const token = match[1].trim();
    const cleanToken = token.replace(/^#+/, '');
    if (stopWords.has(cleanToken.toLowerCase())) {
      continue;
    }
    // Reject 4-digit years (1900-2099) unless explicitly hash-prefixed
    if (/^(19\d\d|20\d\d)$/.test(cleanToken) && !token.startsWith('#')) {
      continue;
    }
    if (/\d/.test(cleanToken)) {
      const isOrd = /^ORD-/i.test(cleanToken);
      return {
        raw: token,
        normalized: cleanToken.toUpperCase(),
        isExplicitOrdPrefix: isOrd,
        isNumericOnly: /^\d+$/.test(cleanToken),
      };
    }
  }

  // Note: Standalone 4-digit numbers (like 2026) are intentionally NOT matched as orders.
  // Numbers must have explicit '#' prefix, 'ORD-' prefix, or keyword context ('order', 'ref', etc.)
  // to prevent email timestamps, dates, years, and signatures from being parsed as order references.

  return null;
}

/**
 * Deterministically matches an extracted order reference against an OrderRecord
 * while strictly isolating demo ORD- prefixes from Shopify / numeric orders.
 */
export function matchOrderRecord(order: OrderRecord, ref: ExtractedOrderRef): boolean {
  if (!order || !order.order_id) return false;

  const rawOrderId = (order.order_id || '').trim();
  const upperOrderId = rawOrderId.toUpperCase();
  const orderData = (order.data || {}) as Record<string, any>;
  const shopifyOrderId = String(orderData.shopify_order_id || orderData.raw_shopify_order?.id || '').trim();
  const shopifyName = String(orderData.shopify_name || '').trim(); // e.g. "#1001"

  // Case A: Query had explicit "ORD-xxx" prefix
  if (ref.isExplicitOrdPrefix) {
    return upperOrderId === ref.normalized;
  }

  // Case B: Query was a plain number or "#" prefixed (e.g. "#1001", "1001")
  // Demo orders with "ORD-..." prefix MUST NOT match plain numbers or "#..." queries
  if (upperOrderId.startsWith('ORD-')) {
    return false;
  }

  // Check against order_id (with or without # prefix)
  const cleanDbOrderId = upperOrderId.replace(/^#+/, '');
  if (cleanDbOrderId === ref.normalized) {
    return true;
  }
  if (upperOrderId === ref.raw.toUpperCase()) {
    return true;
  }

  // Check against Shopify GID (e.g. 7275667423522)
  if (shopifyOrderId && (shopifyOrderId === ref.raw || shopifyOrderId === ref.normalized)) {
    return true;
  }

  // Check against shopify_name (e.g. "#1001")
  if (shopifyName) {
    const cleanShopifyName = shopifyName.replace(/^#+/, '').toUpperCase();
    if (cleanShopifyName === ref.normalized) {
      return true;
    }
  }

  // Check against Custom Store external_order_id and order_number
  const customOrderNumber = String((order as any).order_number || orderData.order_number || '').trim();
  if (customOrderNumber) {
    const cleanCustomNum = customOrderNumber.replace(/^#+/, '').toUpperCase();
    if (cleanCustomNum === ref.normalized) {
      return true;
    }
  }
  const customExtId = String((order as any).external_order_id || orderData.external_order_id || '').trim().toUpperCase();
  if (customExtId && (customExtId === ref.raw.toUpperCase() || customExtId === ref.normalized)) {
    return true;
  }

  return false;
}

/**
 * Normalizes text for keyword and similarity matching
 */
function normalizeText(text: string): string {
  return (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Calculates keyword overlap score between query and FAQ question
 */
function calculateFaqMatch(queryText: string, faq: FaqItem): number {
  const normQuery = normalizeText(queryText);
  const normFaqQ = normalizeText(faq.question);

  if (normQuery.includes(normFaqQ) || normFaqQ.includes(normQuery)) {
    return 1.0;
  }

  const queryWords = normQuery.split(' ').filter((w) => w.length > 3);
  const faqWords = normFaqQ.split(' ').filter((w) => w.length > 3);

  if (queryWords.length === 0 || faqWords.length === 0) return 0;

  let matches = 0;
  for (const qWord of queryWords) {
    if (faqWords.includes(qWord)) matches++;
  }

  return matches / Math.min(queryWords.length, faqWords.length);
}

export interface ResolvedStoreInfo {
  storeName: string;
  currency: string;
  provider?: 'shopify' | 'custom';
  connectionId?: string;
  isAmbiguous: boolean;
  ambiguousStores?: string[];
  isDemoFixture: boolean;
  returnPolicyText?: string;
  shippingPolicyText?: string;
  supportEmail?: string;
}

export function resolveStoreContext(params: {
  text: string;
  senderEmail: string;
  settings: BusinessSettings;
  orders: OrderRecord[];
  matchedOrder?: OrderRecord | null;
  matchedProduct?: ProductServiceItem | null;
}): ResolvedStoreInfo {
  const { text, senderEmail, settings, orders, matchedOrder, matchedProduct } = params;
  const lower = text.toLowerCase();
  const storePolicies = settings.knowledge?.store_policies || {};
  const knownStoreKeys = Object.keys(storePolicies);
  const hasMultipleStorePolicies = knownStoreKeys.length > 1;

  // 1. Direct match from a resolved order
  if (matchedOrder) {
    const isCustom = (matchedOrder as any).provider === 'custom' || 
                     (matchedOrder.order_id && matchedOrder.order_id.startsWith('custom:')) ||
                     (matchedOrder.order_id && matchedOrder.order_id.startsWith('TBS-'));
    const isDemo = Boolean(
      (matchedOrder as any).is_demo_fixture ||
      (matchedOrder.data as any)?.is_demo_fixture ||
      isCustom
    );

    if (isCustom) {
      const tbsPolicy = storePolicies['conn_custom_demo-store'] || storePolicies['custom'] || Object.values(storePolicies).find(p => p.provider === 'custom');
      return {
        storeName: 'The Baby Supply',
        currency: matchedOrder.currency || tbsPolicy?.currency || 'EUR',
        provider: 'custom',
        connectionId: (matchedOrder as any).connection_id || 'conn_custom_demo-store',
        isAmbiguous: false,
        isDemoFixture: isDemo,
        returnPolicyText: tbsPolicy?.return_policy,
        shippingPolicyText: tbsPolicy?.shipping_policy,
        supportEmail: tbsPolicy?.support_email || 'info@thebabysupply.nl',
      };
    } else {
      const shPolicy = storePolicies['shopify_primary'] || Object.values(storePolicies).find(p => p.provider === 'shopify');
      const defaultName = settings.display_name_override || (settings as any).profile?.business_name || settings.business_name || 'rabani';
      return {
        storeName: shPolicy?.store_name || defaultName,
        currency: matchedOrder.currency || shPolicy?.currency || 'USD',
        provider: 'shopify',
        connectionId: 'shopify_primary',
        isAmbiguous: false,
        isDemoFixture: false,
        returnPolicyText: shPolicy?.return_policy,
        shippingPolicyText: shPolicy?.shipping_policy,
        supportEmail: (shPolicy?.support_email || (settings as any).support_email || 'talhaishaqrabani9490@gmail.com') as string,
      };
    }
  }

  // 2. Direct match from a resolved product
  if (matchedProduct) {
    const isCustom = matchedProduct.provider === 'custom' || 
                     matchedProduct.id.startsWith('cs-') || 
                     (matchedProduct.store_name && matchedProduct.store_name.toLowerCase().includes('baby supply'));
    const isDemo = Boolean(matchedProduct.is_demo_fixture || isCustom);

    if (isCustom) {
      const tbsPolicy = storePolicies['conn_custom_demo-store'] || storePolicies['custom'] || Object.values(storePolicies).find(p => p.provider === 'custom');
      return {
        storeName: 'The Baby Supply',
        currency: matchedProduct.currency || 'EUR',
        provider: 'custom',
        connectionId: matchedProduct.connection_id || 'conn_custom_demo-store',
        isAmbiguous: false,
        isDemoFixture: isDemo,
        returnPolicyText: tbsPolicy?.return_policy,
        shippingPolicyText: tbsPolicy?.shipping_policy,
        supportEmail: tbsPolicy?.support_email || 'info@thebabysupply.nl',
      };
    } else {
      const shPolicy = storePolicies['shopify_primary'] || Object.values(storePolicies).find(p => p.provider === 'shopify');
      const defaultName = settings.display_name_override || (settings as any).profile?.business_name || settings.business_name || 'rabani';
      return {
        storeName: matchedProduct.store_name || shPolicy?.store_name || defaultName,
        currency: matchedProduct.currency || 'USD',
        provider: 'shopify',
        connectionId: 'shopify_primary',
        isAmbiguous: false,
        isDemoFixture: false,
        returnPolicyText: shPolicy?.return_policy,
        shippingPolicyText: shPolicy?.shipping_policy,
        supportEmail: (shPolicy?.support_email || (settings as any).support_email || 'talhaishaqrabani9490@gmail.com') as string,
      };
    }
  }

  // 3. Explicit keywords in inquiry text
  const mentionsBabySupply = /\b(the\s*baby\s*supply|baby\s*supply|babysupply|tbs|thebabysupply)\b/i.test(lower) ||
    /\b(brievenbuspakket|babyfoon|borstkolf|montessori|bijtring|hydrofiele|saliegroen|postnl)\b/i.test(lower);
  const mentionsRabani = /\b(rabani|snowboard|ski\s*wax|rabani-ysnivj04)\b/i.test(lower);

  if (mentionsBabySupply && !mentionsRabani) {
    const tbsPolicy = storePolicies['conn_custom_demo-store'] || storePolicies['custom'] || Object.values(storePolicies).find(p => p.provider === 'custom');
    return {
      storeName: 'The Baby Supply',
      currency: tbsPolicy?.currency || 'EUR',
      provider: 'custom',
      connectionId: 'conn_custom_demo-store',
      isAmbiguous: false,
      isDemoFixture: true,
      returnPolicyText: tbsPolicy?.return_policy,
      shippingPolicyText: tbsPolicy?.shipping_policy,
      supportEmail: tbsPolicy?.support_email || 'info@thebabysupply.nl',
    };
  }

  if (mentionsRabani && !mentionsBabySupply) {
    const shPolicy = storePolicies['shopify_primary'] || Object.values(storePolicies).find(p => p.provider === 'shopify');
    const defaultName = settings.display_name_override || (settings as any).profile?.business_name || settings.business_name || 'rabani';
    return {
      storeName: shPolicy?.store_name || defaultName,
      currency: shPolicy?.currency || 'USD',
      provider: 'shopify',
      connectionId: 'shopify_primary',
      isAmbiguous: false,
      isDemoFixture: false,
      returnPolicyText: shPolicy?.return_policy,
      shippingPolicyText: shPolicy?.shipping_policy,
      supportEmail: (shPolicy?.support_email || (settings as any).support_email || 'talhaishaqrabani9490@gmail.com') as string,
    };
  }

  if (mentionsBabySupply && mentionsRabani) {
    return {
      storeName: 'Multi-Store',
      currency: 'USD',
      isAmbiguous: true,
      ambiguousStores: ['The Baby Supply', 'rabani'],
      isDemoFixture: false,
    };
  }

  // 4. Default if only one store policy exists, or general tenant fallback
  const defaultName = settings.display_name_override || (settings as any).profile?.business_name || settings.business_name || 'Customer Support';
  const defaultCurrency = settings.currency || 'USD';
  return {
    storeName: defaultName,
    currency: defaultCurrency,
    isAmbiguous: hasMultipleStorePolicies,
    ambiguousStores: hasMultipleStorePolicies ? ['rabani', 'The Baby Supply'] : undefined,
    isDemoFixture: false,
    returnPolicyText: settings.knowledge?.policies?.general_rules,
    shippingPolicyText: settings.knowledge?.policies?.shipping_timeframe,
    supportEmail: ((settings as any).support_email || undefined) as string | undefined,
  };
}

/**
 * Evaluates an incoming customer email against business settings and deterministic safety gates.
 */
export function evaluateRoutineInquiry(params: {
  subject: string;
  bodyText: string;
  senderName: string;
  senderEmail: string;
  connectedEmail?: string;
  isAutomated?: boolean;
  settings: BusinessSettings;
  conversationMessages?: Array<{ sender_type: string; body: string; created_at: string; metadata?: any }>;
  orders?: OrderRecord[];
  isLiveChannel?: boolean;
  channel?: 'gmail' | 'simulator' | 'inquiry_form' | 'api' | string;
}): RoutineEvaluationResult {
  const {
    subject,
    bodyText,
    senderName,
    senderEmail,
    connectedEmail,
    isAutomated,
    settings,
    conversationMessages = [],
    orders = [],
    isLiveChannel = false,
    channel,
  } = params;

  const safeSettings = settings || ({} as BusinessSettings);
  const mode: AutomationMode = (safeSettings.automation_mode as AutomationMode) || 'auto_routine';
  const customerFirstName = (senderName || '').split(' ')[0] || 'there';
  const isLive = Boolean(isLiveChannel || channel === 'gmail');
  const allowDemo = safeSettings.allow_demo_grounding === true || !isLive;

  // Filter orders and catalog for live channels so demo fixtures never ground real customers
  const effectiveOrders = allowDemo
    ? orders
    : orders.filter((o) => !(o as any).is_demo_fixture && !(o.data as any)?.is_demo_fixture);

  const effectiveCatalog = allowDemo
    ? (safeSettings.knowledge?.products_services || [])
    : (safeSettings.knowledge?.products_services || []).filter((p) => !p.is_demo_fixture);

  // Clean quoted history to isolate the fresh customer query
  const cleanBody = cleanQuotedReplyText(bodyText);
  const combinedText = `${subject} ${cleanBody}`.trim();
  const lowerText = combinedText.toLowerCase();

  // Resolve store context for greeting/default fallback
  const initialStoreCtx = resolveStoreContext({
    text: combinedText,
    senderEmail,
    settings: safeSettings,
    orders: effectiveOrders,
  });
  const businessName = initialStoreCtx.storeName;

  // 1. Check if sender is self or automated/bounce/loop/OTP/system notification
  if (connectedEmail && senderEmail.toLowerCase() === connectedEmail.toLowerCase()) {
    return {
      canAutoReply: false,
      intent: 'ignored_automated',
      reason: 'Self-sent message ignored to prevent recursive loops.',
      groundedSources: [],
      requiresApproval: false,
      financialOrMajorAction: false,
    };
  }

  const emailClassification = classifyEmailMessage({
    senderEmail,
    senderName,
    subject,
    bodyText: cleanBody,
    isAutomatedHeader: isAutomated,
  });

  if (emailClassification.isNonCustomer) {
    return {
      canAutoReply: false,
      intent: 'ignored_automated',
      reason: emailClassification.reason || 'Non-customer automated notification, OTP, security alert, or bounce ignored.',
      groundedSources: [],
      requiresApproval: false,
      financialOrMajorAction: false,
    };
  }

  // 2. Check for Auto-Reply Loop Prevention in conversation history
  if (conversationMessages.length > 0) {
    const consecutiveAiMsgs = conversationMessages.slice(-2).filter((m) => m.sender_type === 'agent' || m.sender_type === 'ai_draft');
    if (consecutiveAiMsgs.length >= 2) {
      return {
        canAutoReply: false,
        intent: 'loop_prevented',
        reason: 'Loop prevention: Multiple consecutive AI responses detected in thread. Routing to owner review.',
        groundedSources: [],
        acknowledgmentDraftText: `Hello ${customerFirstName},\n\nThank you for following up with ${businessName}. A team member has been notified and will respond to your thread directly.\n\nBest regards,\n${businessName} Support Team`,
        requiresApproval: true,
        financialOrMajorAction: false,
      };
    }
  }

  // 3. Paused Mode Check
  if (mode === 'paused') {
    return {
      canAutoReply: false,
      intent: 'paused',
      reason: 'Automation is paused by business owner settings.',
      groundedSources: [],
      requiresApproval: false,
      financialOrMajorAction: false,
    };
  }

  // 4. Strict Financial & Major Operational Action Gate (Refunds, Exchanges, Cancellations, Payments)
  for (const pattern of ACTION_REQUEST_PATTERNS) {
    if (pattern.regex.test(combinedText)) {
      const acknowledgmentDraftText = `Hello ${customerFirstName},\n\nThank you for contacting ${businessName}. We have received your request regarding your ${pattern.label.toLowerCase()}.\n\nOur store management team is reviewing your request and will follow up with you shortly.\n\nBest regards,\n${businessName} Support Team`;

      return {
        canAutoReply: false,
        intent: 'financial_action',
        reason: `${pattern.label} requested. Strict multi-business governance locks financial and major operational actions to owner review.`,
        groundedSources: ['Automation Governance Policy: Financial & Major Operational Actions Require Owner Approval'],
        acknowledgmentDraftText,
        requiresApproval: true,
        financialOrMajorAction: true,
      };
    }
  }

  // 5. Order & Delivery Tracking (Prioritized over general policy explanations for e-commerce/retail)
  const currentIndustry = (safeSettings.industry || (safeSettings as any).business_type || 'ecommerce').toLowerCase();
  const isEcommerceTenant = currentIndustry === 'ecommerce' || currentIndustry === 'retail';

  // For non-ecommerce services businesses, order tracking is not applicable
  if (!isEcommerceTenant && ORDER_STATUS_PATTERNS.some((p) => p.test(combinedText))) {
    const reply = `Hello ${customerFirstName},\n\nThank you for reaching out to ${businessName}. As a service provider, we do not operate an online shopping cart or order fulfillment system. If you are inquiring about a service appointment, quote, or invoice, please let us know your service details or account address.\n\nBest regards,\n${businessName} Support Team`;
    return {
      canAutoReply: false,
      intent: 'routine_clarification',
      reason: `Order inquiry received for non-ecommerce business (${businessName}, industry: ${currentIndustry}). Routing to owner review.`,
      groundedSources: ['Services Governance Policy: Non-ecommerce Service Inquiry Routing'],
      replyText: reply,
      acknowledgmentDraftText: reply,
      requiresApproval: true,
      financialOrMajorAction: false,
    };
  }

  const isOrderQuery = isEcommerceTenant && ORDER_STATUS_PATTERNS.some((p) => p.test(combinedText));
  const extractedRef = isEcommerceTenant ? extractOrderReference(combinedText) : null;

  if (isOrderQuery || extractedRef) {
    if (extractedRef) {
      // Live channel demo fixture guard: reject demo order references on production channels
      if (isLive && !allowDemo) {
        const demoMatch = orders.find(
          (o) => matchOrderRecord(o, extractedRef) && ((o as any).is_demo_fixture || (o.data as any)?.is_demo_fixture)
        );
        if (demoMatch) {
          return {
            canAutoReply: false,
            intent: 'routine_order_status',
            reason: 'Demo fixture order cannot ground live customer replies on production channels.',
            groundedSources: ['Security Policy: Demo Fixture Grounding Gate'],
            requiresApproval: true,
            financialOrMajorAction: false,
          };
        }
      }

      // Look up in verified orders using isolated matching
      const matchingOrders = effectiveOrders.filter((o) => matchOrderRecord(o, extractedRef));

      let matchedOrder: OrderRecord | null = null;

      if (matchingOrders.length === 1) {
        matchedOrder = matchingOrders[0];
      } else if (matchingOrders.length > 1) {
        // Disambiguation: Multiple orders matched across connected stores (e.g. Shopify #1001 vs Custom #1001)
        const normalizedSenderEmail = (senderEmail || '').trim().toLowerCase();
        const emailMatches = matchingOrders.filter((o) => {
          const custEmail = String(
            o.customer_email ||
            o.data?.customer_email ||
            o.data?.customer?.email ||
            o.data?.email ||
            ''
          ).trim().toLowerCase();
          return custEmail && custEmail === normalizedSenderEmail;
        });

        // If email matches multiple orders across different stores, check for explicit store keywords in inquiry
        const candidates = emailMatches.length > 0 ? emailMatches : matchingOrders;
        const storeMatches = candidates.filter((o) => {
          const provider = String((o as any).provider || o.data?.provider || o.data?.source || '').toLowerCase();
          const storeName = String(o.data?.store_name || o.data?.shop_name || '').toLowerCase();
          const isTbsOrder = (o.order_id && (o.order_id.includes('tbs') || o.order_id.startsWith('custom:'))) || provider === 'custom';
          const isRabaniOrder = provider === 'shopify' || (!o.order_id.includes('tbs') && !o.order_id.startsWith('custom:'));
          
          if (isTbsOrder && /\b(the\s*baby\s*supply|baby\s*supply|babysupply|tbs)\b/i.test(lowerText)) return true;
          if (isRabaniOrder && /\b(rabani|snowboard)\b/i.test(lowerText)) return true;
          return (provider && lowerText.includes(provider)) || (storeName && lowerText.includes(storeName));
        });

        if (storeMatches.length === 1) {
          matchedOrder = storeMatches[0];
        } else if (emailMatches.length === 1) {
          matchedOrder = emailMatches[0];
        } else {
          // Ambiguity cannot be determined without guessing -> Ask customer for clarification!
          const storeNames = Array.from(
            new Set(
              candidates.map((o) => {
                const prov = (o as any).provider || o.data?.provider || o.data?.source || 'store';
                const isTbs = (o.order_id && (o.order_id.includes('tbs') || o.order_id.startsWith('custom:'))) || prov === 'custom';
                return isTbs ? 'The Baby Supply' : (prov === 'shopify' ? 'rabani' : 'Custom store');
              })
            )
          ).join(' and ');

          const reply = `Hello ${customerFirstName},\n\nThank you for reaching out to us.\n\nWe found multiple active orders matching reference "${extractedRef.raw}" across your connected stores (${storeNames}).\n\nTo ensure we verify the correct purchase and tracking details, could you please specify which store this order was placed with, or share your order confirmation email address?\n\nBest regards,\nCustomer Support Team`;

          const canAuto = mode === 'auto_routine';
          return {
            canAutoReply: canAuto,
            intent: 'routine_order_status',
            reason: `Ambiguous order match: Found ${candidates.length} orders matching reference "${extractedRef.raw}" across multiple stores. Requesting store clarification.`,
            groundedSources: ['Order Verification Policy: Multi-Store Disambiguation Clarification Required'],
            replyText: reply,
            acknowledgmentDraftText: reply,
            requiresApproval: !canAuto,
            financialOrMajorAction: false,
          };
        }
      }

      if (matchedOrder) {
        // Live channel demo fixture guard
        if (isLive && !allowDemo && ((matchedOrder as any).is_demo_fixture || (matchedOrder.data as any)?.is_demo_fixture)) {
          return {
            canAutoReply: false,
            intent: 'routine_order_status',
            reason: 'Demo fixture order cannot ground live customer replies on production channels.',
            groundedSources: ['Security Policy: Demo Fixture Grounding Gate'],
            requiresApproval: true,
            financialOrMajorAction: false,
          };
        }

        const orderStore = resolveStoreContext({
          text: combinedText,
          senderEmail,
          settings: safeSettings,
          orders: effectiveOrders,
          matchedOrder,
        });
        const effectiveStoreName = orderStore.storeName;

        // Customer matching privacy gate: Ensure sender matches order customer before disclosing private details
        const normalizedSenderEmail = (senderEmail || '').trim().toLowerCase();
        const orderCustomerEmail = String(
          matchedOrder.customer_email ||
          matchedOrder.data?.customer_email ||
          matchedOrder.data?.customer?.email ||
          matchedOrder.data?.email ||
          ''
        ).trim().toLowerCase();

        if (orderCustomerEmail && normalizedSenderEmail && orderCustomerEmail !== normalizedSenderEmail) {
          // Sender does not match the order's customer - refuse disclosure to protect privacy
          const reply = `Hello ${customerFirstName},\n\nThank you for reaching out to ${effectiveStoreName}.\n\nFor security and customer privacy protection, order details can only be shared with the verified email address associated with the purchase. The email address you are writing from (${senderEmail}) does not match the registered customer record for Order ${matchedOrder.order_id}.\n\nIf you placed this order under a different email address, please write to us directly from that account or provide valid proof of purchase.\n\nBest regards,\n${effectiveStoreName} Support Team`;

          const canAuto = mode === 'auto_routine';
          return {
            canAutoReply: canAuto,
            intent: 'routine_order_status',
            reason: `Order ${matchedOrder.order_id} exists but sender (${senderEmail}) does not match order customer (${orderCustomerEmail}). Privacy gate engaged.`,
            groundedSources: ['Order Security Policy: Customer Email Verification Mismatch'],
            replyText: reply,
            acknowledgmentDraftText: reply,
            requiresApproval: !canAuto,
            financialOrMajorAction: false,
          };
        }

        const orderData = matchedOrder.data || {};
        let items = 'Standard items';
        const rawItems = matchedOrder.items || orderData.items;
        if (Array.isArray(rawItems) && rawItems.length > 0) {
          items = rawItems.map((i: any) => {
            const name = i.name || i.title || 'Item';
            const variant = i.variant || i.size ? ` [${i.variant || i.size}]` : '';
            const qty = i.qty || i.quantity || 1;
            return `${name}${variant} (Qty: ${qty})`;
          }).join(', ');
        }
        const total = matchedOrder.total || orderData.total || '0.00';
        const curr = matchedOrder.currency || orderData.currency || orderStore.currency || '';
        const totalStr = curr ? `${curr} ${total}` : `${total}`;
        const status = (matchedOrder.status || orderData.status || 'processing').toUpperCase();
        const trackingNum = orderData.tracking_number || orderData.tracking || (matchedOrder.data as any)?.tracking_number;
        const carrier = orderData.carrier || (matchedOrder as any).carrier;
        const carrierInfo = carrier ? ` via ${carrier}` : '';
        const trackingInfo = trackingNum 
          ? `\n- Tracking Number: ${trackingNum}${carrierInfo}`
          : `\n- Tracking: Not yet assigned (Fulfillment is not yet recorded in store records)`;

        const reply = `Hello ${customerFirstName},\n\nThank you for checking in on your order with ${effectiveStoreName}.\n\n- Order ID: ${matchedOrder.order_id}\n- Status: ${status}\n- Items: ${items}\n- Total: ${totalStr}${trackingInfo}\n\nPlease let us know if you need any additional tracking details!\n\nBest regards,\n${effectiveStoreName} Support Team`;

        const canAuto = mode === 'auto_routine';
        return {
          canAutoReply: canAuto,
          intent: 'routine_order_status',
          reason: `Verified order status retrieved from database for ${matchedOrder.order_id} (Customer: ${orderCustomerEmail || 'verified'}).`,
          groundedSources: [`Verified Order: ${matchedOrder.order_id} (Status: ${status})`],
          replyText: reply,
          acknowledgmentDraftText: reply,
          requiresApproval: !canAuto,
          financialOrMajorAction: false,
        };
      } else {
        // Order ID given but not found in verified database -> Ask for clarification (Never invent!)
        const displayRef = extractedRef.raw.startsWith('#') ? extractedRef.raw : `#${extractedRef.normalized}`;
        const reply = `Hello ${customerFirstName},\n\nThank you for reaching out to ${businessName}.\n\nWe could not find an active order with reference "${displayRef}" in our system. Could you please double-check your order number or provide the email address used at checkout so we can locate your order details for you?\n\nBest regards,\n${businessName} Support Team`;

        const canAuto = mode === 'auto_routine';
        return {
          canAutoReply: canAuto,
          intent: 'routine_order_status',
          reason: `Order reference "${displayRef}" not found in database. Asking clarification question without inventing data.`,
          groundedSources: ['Order Verification: Order ID Not Found in Database'],
          replyText: reply,
          acknowledgmentDraftText: reply,
          requiresApproval: !canAuto,
          financialOrMajorAction: false,
        };
      }
    } else {
      // Order query without order number -> Ask clarification for order number (Never invent!)
      const reply = `Hello ${customerFirstName},\n\nThank you for contacting ${businessName}.\n\nCould you please provide your Order ID or reference number? Once you share your order number, we will look up the verified status and tracking details for you right away.\n\nBest regards,\n${businessName} Support Team`;

      const canAuto = mode === 'auto_routine';
      return {
        canAutoReply: canAuto,
        intent: 'routine_order_status',
        reason: 'Order status inquiry missing order reference. Asking clarification question automatically.',
        groundedSources: ['Order Verification Policy: Order ID Required'],
        replyText: reply,
        acknowledgmentDraftText: reply,
        requiresApproval: !canAuto,
        financialOrMajorAction: false,
      };
    }
  }

  // 6. Check for Policy Inquiries (Routine Explanations)
  const isPolicyInquiry = POLICY_INQUIRY_PATTERNS.some((p) => p.test(combinedText));
  if (isPolicyInquiry) {
    const policyStore = resolveStoreContext({
      text: combinedText,
      senderEmail,
      settings: safeSettings,
      orders: effectiveOrders,
    });

    if (policyStore.isAmbiguous) {
      const reply = `Hello ${customerFirstName},\n\nThank you for reaching out to us.\n\nWe operate multiple connected stores (${policyStore.ambiguousStores?.join(' and ')}). To ensure we share the correct policy and terms for your purchase, could you please clarify which store you are inquiring about? Each store maintains its own return and fulfillment policies.\n\nBest regards,\nCustomer Support Team`;
      const canAuto = mode === 'auto_routine';
      return {
        canAutoReply: canAuto,
        intent: 'routine_clarification',
        reason: 'Ambiguous policy inquiry across multiple connected stores. Requesting store clarification without mixing policies.',
        groundedSources: ['Multi-Store Policy: Store Disambiguation Required'],
        replyText: reply,
        acknowledgmentDraftText: reply,
        requiresApproval: !canAuto,
        financialOrMajorAction: false,
      };
    }

    if (isLive && !allowDemo && policyStore.isDemoFixture) {
      return {
        canAutoReply: false,
        intent: 'routine_policy_info',
        reason: 'Demo fixture store policy cannot ground live customer replies on production channels.',
        groundedSources: ['Security Policy: Demo Fixture Grounding Gate'],
        requiresApproval: true,
        financialOrMajorAction: false,
      };
    }

    const effectiveStoreName = policyStore.storeName;
    const policies = safeSettings.knowledge?.policies || {};
    const returnDays = policies.return_window_days || safeSettings.return_window_days || 14;
    const generalRules = policyStore.returnPolicyText || policies.general_rules || 'Items in original condition with tags attached qualify for return or exchange within our standard window.';
    const shippingInfo = policyStore.shippingPolicyText || policies.shipping_timeframe || 'Standard delivery typically takes 2-4 business days nationwide.';

    let reply = `Hello ${customerFirstName},\n\nThank you for reaching out to ${effectiveStoreName}.\n\n`;
    if (/shipping|delivery/i.test(combinedText)) {
      reply += `Our shipping policy: ${shippingInfo}\n`;
    }
    reply += `Our standard return policy allows returns and exchanges within ${returnDays} days of delivery. ${generalRules}\n\nPlease let us know if you need specific details regarding an item or order.\n\nBest regards,\n${effectiveStoreName} Support Team`;

    const canAuto = mode === 'auto_routine';
    return {
      canAutoReply: canAuto,
      intent: 'routine_policy_info',
      reason: `Grounded in verified store return, exchange, and delivery policy parameters for ${effectiveStoreName}.`,
      groundedSources: [`Policy: Return Window (${returnDays} days), Rules: ${generalRules}`],
      replyText: reply,
      acknowledgmentDraftText: reply,
      requiresApproval: !canAuto,
      financialOrMajorAction: false,
    };
  }

  // 7. Greetings (Routine, No Approval Required)
  const isGreeting = GREETING_PATTERNS.some((p) => p.test(combinedText.trim())) || (/^(hi|hello|hey|good\s*(morning|afternoon|evening))\b/i.test(combinedText.trim()) && combinedText.trim().split(/\s+/).length <= 4);
  if (isGreeting) {
    const isServicesGreeting = currentIndustry === 'services';
    const assistanceTopics = isServicesGreeting
      ? 'our services, scheduling an appointment, operating hours, or service areas'
      : 'our product availability, pricing, order tracking, business hours, or store policies';
    const reply = `Hello ${customerFirstName},\n\nThank you for reaching out to ${businessName}! How can we assist you today? Feel free to ask about ${assistanceTopics}.\n\nBest regards,\n${businessName} Support Team`;

    const canAuto = mode === 'auto_routine';
    return {
      canAutoReply: canAuto,
      intent: 'routine_greeting',
      reason: 'Standard customer greeting inquiry.',
      groundedSources: ['Standard Friendly Store Greeting'],
      replyText: reply,
      acknowledgmentDraftText: reply,
      requiresApproval: !canAuto,
      financialOrMajorAction: false,
    };
  }

  // 8. Working Hours & Operating Schedule Match (Routine, No Approval Required)
  const isHoursQuery = WORKING_HOURS_PATTERNS.some((p) => p.test(combinedText));
  if (isHoursQuery) {
    const wh = settings.working_hours || {
      start_time: '09:00',
      end_time: '18:00',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    };
    const daysFormatted = wh.days.map((d) => d.toUpperCase()).join(', ');
    const reply = `Hello ${customerFirstName},\n\nThank you for contacting ${businessName}.\n\nOur business operating hours are from ${wh.start_time} to ${wh.end_time} (${settings.timezone || 'Asia/Karachi'}), active on ${daysFormatted}.\n\nPlease let us know if you have any further questions.\n\nBest regards,\n${businessName} Support Team`;

    const canAuto = mode === 'auto_routine';
    return {
      canAutoReply: canAuto,
      intent: 'routine_hours',
      reason: 'Inquiry matched verified business operating hours schedule.',
      groundedSources: [`Working Hours: ${wh.start_time}-${wh.end_time}, Days: ${daysFormatted}`],
      replyText: reply,
      acknowledgmentDraftText: reply,
      requiresApproval: !canAuto,
      financialOrMajorAction: false,
    };
  }

  // 8b. Service Areas Match (Services Pack)
  const isAreaQuery = SERVICE_AREA_PATTERNS.some((p) => p.test(combinedText));
  const serviceAreas = (settings.knowledge?.service_areas || []).filter((a) => a.is_active !== false);
  if (isAreaQuery && serviceAreas.length > 0) {
    const areaNames = serviceAreas.map((a) => a.name).join(', ');
    const coverageDetails = serviceAreas
      .filter((a) => a.coverage_details)
      .map((a) => `${a.name}: ${a.coverage_details}`)
      .join('\n- ');

    let reply = `Hello ${customerFirstName},\n\nThank you for reaching out to ${businessName}!\n\nOur verified service coverage areas include:\n- ${areaNames}`;
    if (coverageDetails) {
      reply += `\n\nSpecific coverage notes:\n- ${coverageDetails}`;
    }
    reply += `\n\nIf your project is located outside these primary areas, please let us know your location and our management team will review feasibility.\n\nBest regards,\n${businessName} Support Team`;

    const canAuto = mode === 'auto_routine';
    return {
      canAutoReply: canAuto,
      intent: 'routine_service_area_info',
      reason: `Grounded in verified business service areas: ${areaNames}`,
      groundedSources: [`Service Areas: ${areaNames}`],
      replyText: reply,
      acknowledgmentDraftText: reply,
      requiresApproval: !canAuto,
      financialOrMajorAction: false,
    };
  }

  // 8c. Services Offerings, Inquiries & Consultations (Services Pack)
  const approvedServices = (settings.knowledge?.services || []).filter(
    (s) => s.approval_status === 'approved' && s.is_active !== false
  );
  const isGeneralServiceQuery = SERVICE_INQUIRY_PATTERNS.some((p) => p.test(combinedText));
  const matchedService = approvedServices.find((s) => lowerText.includes(s.name.toLowerCase()));

  if ((isGeneralServiceQuery || matchedService) && approvedServices.length > 0) {
    if (matchedService) {
      // Inquiry matches a specific verified service name
      let priceStr = 'Custom quote upon assessment';
      if (matchedService.price_type === 'fixed' && matchedService.price) {
        priceStr = `${matchedService.currency || settings.currency || 'USD'} ${matchedService.price}`;
      } else if (matchedService.price_type === 'starting_at' && matchedService.price) {
        priceStr = `Starting at ${matchedService.currency || settings.currency || 'USD'} ${matchedService.price}`;
      } else if (matchedService.price_type === 'hourly' && matchedService.price) {
        priceStr = `${matchedService.currency || settings.currency || 'USD'} ${matchedService.price}/hr`;
      }

      const durStr = matchedService.duration_minutes ? `\n- Typical duration: ${matchedService.duration_minutes} minutes` : '';
      const descStr = matchedService.description ? `\n- Description: ${matchedService.description}` : '';
      const areaStr = matchedService.service_area ? `\n- Coverage: ${matchedService.service_area}` : '';

      const reply = `Hello ${customerFirstName},\n\nThank you for your interest in ${businessName}!\n\nHere are the details for our ${matchedService.name} service:\n- Service: ${matchedService.name}\n- Pricing: ${priceStr}${durStr}${areaStr}${descStr}\n\nWould you like to schedule an appointment or consultation? Please let us know your preferred date or timeframe.\n\nBest regards,\n${businessName} Support Team`;

      const canAuto = mode === 'auto_routine';
      return {
        canAutoReply: canAuto,
        intent: 'routine_service_info',
        reason: `Grounded in merchant-approved service details for "${matchedService.name}".`,
        groundedSources: [`Service: "${matchedService.name}" (${priceStr})`],
        replyText: reply,
        acknowledgmentDraftText: reply,
        requiresApproval: !canAuto,
        financialOrMajorAction: false,
      };
    } else if (/\b(book|schedule|hire|appointment)\b/i.test(combinedText) && !matchedService) {
      // Missing details clarification: user wants to book but didn't specify which service or date
      const serviceList = approvedServices.map((s) => s.name).join(', ');
      const reply = `Hello ${customerFirstName},\n\nThank you for contacting ${businessName}! We would love to assist you with scheduling.\n\nCould you please let us know which service you are interested in (${serviceList}) and your preferred date or timeframe?\n\nBest regards,\n${businessName} Support Team`;

      const canAuto = mode === 'auto_routine';
      return {
        canAutoReply: canAuto,
        intent: 'routine_clarification',
        reason: 'Service booking inquiry missing specific service or date. Generated routine clarification question.',
        groundedSources: [`Available Services: ${serviceList}`],
        replyText: reply,
        acknowledgmentDraftText: reply,
        requiresApproval: !canAuto,
        financialOrMajorAction: false,
      };
    } else {
      // General inquiry: list all approved services
      const formattedServices = approvedServices
        .map((s) => {
          let priceInfo = '';
          if (s.price_type === 'fixed' && s.price) {
            priceInfo = ` (${s.currency || settings.currency || 'USD'} ${s.price})`;
          } else if (s.price_type === 'starting_at' && s.price) {
            priceInfo = ` (Starting at ${s.currency || settings.currency || 'USD'} ${s.price})`;
          } else if (s.price_type === 'hourly' && s.price) {
            priceInfo = ` (${s.currency || settings.currency || 'USD'} ${s.price}/hr)`;
          }
          const desc = s.description ? `: ${s.description}` : '';
          return `- **${s.name}**${priceInfo}${desc}`;
        })
        .join('\n');

      const reply = `Hello ${customerFirstName},\n\nThank you for contacting ${businessName}! We offer the following professional services:\n\n${formattedServices}\n\nPlease let us know which service you are interested in, and we will be delighted to assist you with details or scheduling.\n\nBest regards,\n${businessName} Support Team`;

      const canAuto = mode === 'auto_routine';
      return {
        canAutoReply: canAuto,
        intent: 'routine_service_info',
        reason: 'Inquiry matched merchant-approved services catalog list.',
        groundedSources: approvedServices.map((s) => `Service: ${s.name}`),
        replyText: reply,
        acknowledgmentDraftText: reply,
        requiresApproval: !canAuto,
        financialOrMajorAction: false,
      };
    }
  }

  // 9. FAQs Knowledge Base Match (Routine, No Approval Required)
  const faqs = settings.knowledge?.faqs || [];
  let bestFaq: FaqItem | null = null;
  let bestFaqScore = 0;

  for (const faq of faqs) {
    const score = calculateFaqMatch(combinedText, faq);
    if (score > bestFaqScore && score >= 0.45) {
      bestFaqScore = score;
      bestFaq = faq;
    }
  }

  if (bestFaq) {
    const reply = `Hello ${customerFirstName},\n\nThank you for reaching out to ${businessName}.\n\nRegarding your question "${bestFaq.question}":\n${bestFaq.answer}\n\nIf you have any further questions or need additional assistance, please feel free to reply.\n\nBest regards,\n${businessName} Support Team`;

    const canAuto = mode === 'auto_routine';
    return {
      canAutoReply: canAuto,
      intent: 'routine_faq',
      reason: `Grounded in Store FAQs: "${bestFaq.question}" (Confidence score: ${(bestFaqScore * 100).toFixed(0)}%).`,
      groundedSources: [`FAQ: "${bestFaq.question}" -> "${bestFaq.answer}"`],
      replyText: reply,
      acknowledgmentDraftText: reply,
      requiresApproval: !canAuto,
      financialOrMajorAction: false,
    };
  }

  // 10. Product Availability, Pricing & General Product Inquiries (Routine with verified catalog, OR automatic clarification)
  const hasCatalogNameMatch = effectiveCatalog.some((p) => p.name && lowerText.includes(p.name.toLowerCase()));
  const isProductQuery = PRODUCT_INQUIRY_PATTERNS.some((p) => p.test(combinedText)) || hasCatalogNameMatch;
  if (isProductQuery) {
    // Live channel demo fixture guard: reject demo product inquiries on production channels
    if (isLive && !allowDemo) {
      const demoProd = (safeSettings.knowledge?.products_services || []).find(
        (p) => p.is_demo_fixture && (
          (p.name && lowerText.includes(p.name.toLowerCase())) ||
          (p.sku && lowerText.includes(p.sku.toLowerCase()))
        )
      );
      if (demoProd) {
        return {
          canAutoReply: false,
          intent: 'routine_product_info',
          reason: 'Demo fixture product cannot ground live customer replies on production channels.',
          groundedSources: ['Security Policy: Demo Fixture Grounding Gate'],
          requiresApproval: true,
          financialOrMajorAction: false,
        };
      }
    }

    const catalog = effectiveCatalog;
    // Find all products matching the query
    const matchingProducts = catalog.filter((prod) => {
      if (prod.name && lowerText.includes(prod.name.toLowerCase())) return true;
      if (prod.sku && lowerText.includes(prod.sku.toLowerCase())) return true;
      return false;
    });

    let matchedProduct: ProductServiceItem | null = null;
    if (matchingProducts.length === 1) {
      matchedProduct = matchingProducts[0];
    } else if (matchingProducts.length > 1) {
      // Disambiguate if multiple products match across stores (e.g. Gift Card in rabani vs Gift Card in The Baby Supply)
      const storeMatches = matchingProducts.filter((p) => {
        const pStore = String(p.store_name || '').toLowerCase();
        const pProvider = String(p.provider || '').toLowerCase();
        const isTbs = p.provider === 'custom' || p.id.startsWith('cs-') || pStore.includes('baby supply');
        const isRabani = p.provider === 'shopify' || p.id.startsWith('sp-') || pStore.includes('rabani');

        if (isTbs && /\b(the\s*baby\s*supply|baby\s*supply|babysupply|tbs)\b/i.test(lowerText)) return true;
        if (isRabani && /\b(rabani|snowboard)\b/i.test(lowerText)) return true;
        return (pStore && lowerText.includes(pStore)) || (pProvider && lowerText.includes(pProvider));
      });

      if (storeMatches.length === 1) {
        matchedProduct = storeMatches[0];
      } else {
        // Check if matching products come from different stores
        const distinctStores = Array.from(new Set(matchingProducts.map((p) => {
          const isTbs = p.provider === 'custom' || p.id.startsWith('cs-') || (p.store_name && p.store_name.includes('Baby Supply'));
          return isTbs ? 'The Baby Supply' : 'rabani';
        })));

        if (distinctStores.length > 1) {
          // Cross-store product ambiguity -> Ask clarification!
          const reply = `Hello ${customerFirstName},\n\nThank you for reaching out!\n\nWe found items matching "${matchingProducts[0].name}" across our connected stores (${distinctStores.join(' and ')}).\n\nCould you please specify which store's product you are inquiring about so we can provide accurate pricing and availability details?\n\nBest regards,\nCustomer Support Team`;
          const canAuto = mode === 'auto_routine';
          return {
            canAutoReply: canAuto,
            intent: 'routine_clarification',
            reason: `Cross-store product match across ${distinctStores.join(' and ')}. Asking clarification question.`,
            groundedSources: ['Catalog Verification: Multi-Store Product Clarification Required'],
            replyText: reply,
            acknowledgmentDraftText: reply,
            requiresApproval: !canAuto,
            financialOrMajorAction: false,
          };
        } else {
          matchedProduct = matchingProducts[0];
        }
      }
    }

    if (matchedProduct) {
      if (isLive && !allowDemo && matchedProduct.is_demo_fixture) {
        return {
          canAutoReply: false,
          intent: 'routine_product_info',
          reason: 'Demo fixture product cannot ground live customer replies on production channels.',
          groundedSources: ['Security Policy: Demo Fixture Grounding Gate'],
          requiresApproval: true,
          financialOrMajorAction: false,
        };
      }

      const prodStoreCtx = resolveStoreContext({
        text: combinedText,
        senderEmail,
        settings: safeSettings,
        orders: effectiveOrders,
        matchedProduct,
      });
      const effectiveStoreName = prodStoreCtx.storeName;

      let priceStr: string;
      if (matchedProduct.price !== undefined && matchedProduct.price !== null) {
        const prodCurrency = matchedProduct.currency || prodStoreCtx.currency || safeSettings.currency;
        priceStr = prodCurrency ? `${prodCurrency} ${matchedProduct.price}` : `${matchedProduct.price}`;
      } else {
        priceStr = 'Price upon request';
      }
      
      let availability: string;
      if (matchedProduct.is_active === false) {
        availability = 'Currently Inactive / Unavailable';
      } else if (matchedProduct.stock_quantity !== undefined && matchedProduct.stock_quantity !== null) {
        if (matchedProduct.stock_quantity <= 0) {
          availability = 'Out of Stock (0 units available)';
        } else {
          availability = `In Stock (${matchedProduct.stock_quantity} units available)`;
        }
      } else {
        availability = matchedProduct.in_stock !== false ? 'In Stock and available to order' : 'Currently Out of Stock';
      }

      let variantsStr = '';
      if (matchedProduct.variants) {
        if (Array.isArray(matchedProduct.variants) && matchedProduct.variants.length > 0) {
          variantsStr = `\n- Sizes/Variants: ${matchedProduct.variants.join(', ')}`;
        } else if (typeof matchedProduct.variants === 'string' && matchedProduct.variants.trim()) {
          variantsStr = `\n- Sizes/Variants: ${matchedProduct.variants.trim()}`;
        }
      }

      const skuStr = matchedProduct.sku ? ` (SKU: ${matchedProduct.sku})` : '';
      const desc = matchedProduct.description ? `\n- Details: ${matchedProduct.description}` : '';

      const reply = `Hello ${customerFirstName},\n\nThank you for your interest in ${effectiveStoreName}!\n\nHere are the details for ${matchedProduct.name}:\n- Product: ${matchedProduct.name}${skuStr}\n- Price: ${priceStr}\n- Availability: ${availability}${variantsStr}${desc}\n\nPlease let us know if you would like assistance with placing an order!\n\nBest regards,\n${effectiveStoreName} Support Team`;

      const canAuto = mode === 'auto_routine';
      return {
        canAutoReply: canAuto,
        intent: 'routine_product_info',
        reason: `Verified product catalog data found for "${matchedProduct.name}".`,
        groundedSources: [`Catalog: ${matchedProduct.name} (${priceStr}, ${availability})`],
        replyText: reply,
        acknowledgmentDraftText: reply,
        requiresApproval: !canAuto,
        financialOrMajorAction: false,
      };
    } else {
      // General product inquiry without specific product name -> Clarification question (Never invent prices/stock!)
      const reply = `Hello ${customerFirstName},\n\nThank you for contacting ${businessName}.\n\nCould you please specify which product or item name you are inquiring about? Once you let us know the item name or SKU, we will check its stock availability and verified pricing for you.\n\nBest regards,\n${businessName} Support Team`;

      const canAuto = mode === 'auto_routine';
      return {
        canAutoReply: canAuto,
        intent: 'routine_product_info',
        reason: 'Product inquiry missing specific item name. Asking clarification question automatically without inventing data.',
        groundedSources: ['Catalog Verification: Clarification Required'],
        replyText: reply,
        acknowledgmentDraftText: reply,
        requiresApproval: !canAuto,
        financialOrMajorAction: false,
      };
    }
  }

  // 11. Location & Profile Match
  const isLocationQuery = STORE_LOCATION_PATTERNS.some((p) => p.test(combinedText));
  if (isLocationQuery) {
    const country = settings.country || 'Pakistan';
    const tz = settings.timezone || 'Asia/Karachi';
    const reply = `Hello ${customerFirstName},\n\nThank you for contacting ${businessName}.\n\nWe are based in ${country} (Operating Timezone: ${tz}).\n\nPlease let us know if you have any further questions.\n\nBest regards,\n${businessName} Support Team`;

    const canAuto = mode === 'auto_routine';
    return {
      canAutoReply: canAuto,
      intent: 'routine_general_info',
      reason: 'Grounded in business profile location and country data.',
      groundedSources: [`Profile: Country (${country}), Timezone (${tz})`],
      replyText: reply,
      acknowledgmentDraftText: reply,
      requiresApproval: !canAuto,
      financialOrMajorAction: false,
    };
  }

  // 12. General Clarification for Incomplete or Vague Queries (Automatic Clarification Question)
  if (combinedText.length <= 150) {
    const clarificationReply = `Hello ${customerFirstName},\n\nThank you for contacting ${businessName}.\n\nCould you please provide a few more details regarding your inquiry? Once you share your order number, product name, or question details, we will gladly assist you.\n\nBest regards,\n${businessName} Support Team`;

    const canAuto = mode === 'auto_routine';
    return {
      canAutoReply: canAuto,
      intent: 'routine_clarification',
      reason: 'General inquiry with missing details. Generated automatic clarification question.',
      groundedSources: ['Customer Support Clarification Policy'],
      replyText: clarificationReply,
      acknowledgmentDraftText: clarificationReply,
      requiresApproval: !canAuto,
      financialOrMajorAction: false,
    };
  }

  // 13. Ambiguous or Complex Inquiry (Requires Human Review / Draft)
  const defaultDraft = `Hello ${customerFirstName},\n\nThank you for reaching out to ${businessName}. We have received your message regarding "${subject}".\n\nOur team is reviewing your inquiry and will follow up with you shortly.\n\nBest regards,\n${businessName} Support Team`;

  return {
    canAutoReply: false,
    intent: 'ambiguous',
    reason: 'Inquiry requires human review or complex assessment (no exact verified knowledge match).',
    groundedSources: [],
    acknowledgmentDraftText: defaultDraft,
    requiresApproval: true,
    financialOrMajorAction: false,
  };
}

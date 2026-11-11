export type CaseKind = 'order' | 'return' | 'stock' | 'delivery';

export type CaseStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'demo_completed'
  | 'completed'
  | 'failed';

export type IndustryType =
  | 'ecommerce'
  | 'retail'
  | 'services'
  | 'blog'
  | 'realestate'
  | 'healthcare_clinic';

export type BusinessType = 'services' | 'ecommerce' | 'blog';

export type ActionPermissionLevel = 'automatic' | 'approval_required' | 'disabled';

export interface WorkingHoursConfig {
  start_time: string; // e.g. "09:00"
  end_time: string;   // e.g. "18:00"
  days: string[];     // e.g. ["mon", "tue", "wed", "thu", "fri"]
  auto_reply_outside_hours: boolean;
}

export interface AutomationPermissionsConfig {
  order_confirmation: ActionPermissionLevel;
  delay_notification: ActionPermissionLevel;
  return_refund: 'approval_required' | 'disabled'; // Strictly locked (no automatic)
  exchange_replacement: 'approval_required' | 'disabled'; // Strictly locked
  supplier_purchase: 'approval_required' | 'disabled'; // Strictly locked
  payment_reversal: 'approval_required' | 'disabled'; // Strictly locked
  policy_modification: 'approval_required' | 'disabled'; // Strictly locked
}

export type TeamRole = 'owner' | 'admin' | 'member';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  can_approve: boolean;
  title?: string;
  created_at: string;
}

export type ConnectionStatus =
  | 'demo_simulated'
  | 'not_connected'
  | 'connected'
  | 'error'
  | 'not_implemented'
  | 'disconnected';

export interface StoreConnectionConfig {
  type: 'shopify' | 'woocommerce' | 'custom' | 'no_website';
  status: ConnectionStatus;
  store_url?: string;
  hosted_inquiry_enabled: boolean;
  last_tested?: string;
  is_verified?: boolean;
}

export interface ResendDomainItem {
  id: string;
  name: string;
  status: string;
  region?: string;
}

export interface EmailConnectionConfig {
  mode: 'demo' | 'live';
  provider: 'resend' | 'smtp' | 'none';
  status: ConnectionStatus;
  sender_name?: string;
  sender_email?: string;
  reply_to?: string;
  key_fingerprint?: string;
  has_api_key?: boolean;
  last_tested?: string;
  is_verified?: boolean;
  last_error?: string;
  domains?: ResendDomainItem[];
}

export interface WhatsAppConnectionConfig {
  provider: 'meta_cloud' | 'twilio' | 'none';
  status: 'not_implemented' | 'connected' | 'not_connected' | 'error';
  phone_number?: string;
  last_tested?: string;
  is_verified?: boolean;
}

export interface ConnectionsConfig {
  website: StoreConnectionConfig;
  email: EmailConnectionConfig;
  whatsapp: WhatsAppConnectionConfig;
}

export type ConversationChannel = 'hosted_inquiry' | 'email' | 'gmail' | 'website_chat' | 'whatsapp';
export type ConversationStatus = 'open' | 'pending_approval' | 'resolved' | 'archived' | 'ignored';

export interface ConversationRecord {
  id: string;
  tenant_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone?: string | null;
  channel: ConversationChannel;
  external_thread_id?: string | null;
  status: ConversationStatus;
  subject?: string | null;
  unread: boolean;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  last_message_body?: string;
}

export type MessageSenderType = 'customer' | 'ai_draft' | 'agent' | 'system';
export type MessageStatus =
  | 'received'
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'queued'
  | 'sending'
  | 'simulated_demo'
  | 'provider_accepted'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'uncertain';

export type MessageApprovalStatus = 'none' | 'pending_approval' | 'approved' | 'rejected';

export interface MessageRecord {
  id: string;
  conversation_id: string;
  tenant_id: string;
  sender_type: MessageSenderType;
  sender_name: string;
  sender_email?: string | null;
  body: string;
  status: MessageStatus;
  approval_status: MessageApprovalStatus;
  approved_by?: string | null;
  approved_at?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface EmailCredentialRecord {
  tenant_id: string;
  provider: 'resend' | 'smtp' | 'none';
  mode: 'demo' | 'live';
  encrypted_api_key?: string | null;
  key_fingerprint?: string | null;
  sender_name?: string | null;
  sender_email?: string | null;
  reply_to?: string | null;
  is_verified: boolean;
  last_tested?: string | null;
  last_error?: string | null;
  webhook_signing_secret?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GmailConnectionRecord {
  tenant_id: string;
  google_email: string;
  google_sub?: string | null;
  google_name?: string | null;
  google_avatar?: string | null;
  encrypted_access_token: string;
  encrypted_refresh_token?: string | null;
  token_expiry: string;
  scopes: string[];
  history_id?: string | null;
  initial_sync_completed: boolean;
  sync_status: 'idle' | 'syncing' | 'error' | 'needs_reconnect';
  last_synced_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GmailPublicConfig {
  is_connected: boolean;
  google_email?: string;
  google_name?: string;
  google_avatar?: string;
  sync_status: 'idle' | 'syncing' | 'error' | 'needs_reconnect' | 'not_connected';
  last_synced_at?: string;
  last_error?: string;
  initial_sync_completed: boolean;
  history_id?: string;
  is_configured_on_platform: boolean;
}

export interface OAuthStateRecord {
  state: string;
  tenant_id: string;
  user_id: string;
  code_verifier: string;
  redirect_uri: string;
  expires_at: string;
  used: boolean;
  created_at: string;
}

export interface MessageDispatchRecord {
  id: string;
  message_id: string;
  conversation_id: string;
  tenant_id: string;
  idempotency_key: string;
  provider: 'resend' | 'gmail' | 'simulated_demo';
  provider_message_id?: string | null;
  status: MessageStatus;
  recipient_email: string;
  sender_email: string;
  sender_name?: string | null;
  reply_to?: string | null;
  subject: string;
  body_hash: string;
  attempts: number;
  last_attempt_at?: string | null;
  last_error?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WebhookEventRecord {
  id: string;
  provider: 'resend';
  event_id: string;
  event_type: string;
  provider_message_id?: string | null;
  payload: Record<string, unknown>;
  status: 'processed' | 'ignored' | 'error';
  created_at: string;
}


export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category?: string;
}

export interface ProductServiceItem {
  id: string;
  name: string;
  sku?: string;
  price?: number;
  currency?: string;
  description?: string;
  in_stock?: boolean;
  stock_quantity?: number;
  variants?: string[] | string;
  is_active?: boolean;
  // Store Scoping & Source Identity
  connection_id?: string;
  provider?: 'shopify' | 'custom' | 'manual';
  store_name?: string;
  is_demo_fixture?: boolean;
}

export interface StorePolicyProfile {
  connection_id: string;
  store_name: string;
  provider: 'shopify' | 'custom';
  currency: string;
  timezone?: string;
  return_policy?: string;
  shipping_policy?: string;
  return_window_days?: number;
  shipping_timeframe?: string;
  general_rules?: string;
  support_email?: string;
  is_demo_fixture?: boolean;
}

export interface BusinessPoliciesConfig {
  general_rules?: string;
  operating_disclaimer?: string;
  shipping_timeframe?: string;
  return_policy?: string;
  // E-commerce specific
  return_window_days?: number;
  restocking_fee_pct?: number;
  free_return_threshold?: number;
  // Services specific
  cancellation_notice_hours?: number;
  deposit_required_pct?: number;
}

export interface ServiceItem {
  id: string;
  name: string;
  category?: string;
  description?: string;
  price_type?: 'fixed' | 'starting_at' | 'quote_required' | 'hourly';
  price?: number;
  currency?: string;
  duration_minutes?: number;
  service_area?: string;
  is_active: boolean;
  approval_status: 'approved' | 'pending_review' | 'rejected';
  source?: 'manual' | 'website_import';
  created_at: string;
}

export interface ServiceAreaItem {
  id: string;
  name: string;
  type?: 'city' | 'region' | 'radius' | 'postal_codes';
  coverage_details?: string;
  is_active: boolean;
}

export interface ExtractedFactItem {
  id: string;
  source_url: string;
  fact_type: 'service' | 'hours' | 'service_area' | 'faq' | 'policy' | 'general';
  raw_text: string;
  extracted_data: Record<string, unknown>;
  approval_status: 'pending_review' | 'approved' | 'rejected';
  created_at: string;
}

export interface OnboardingConfig {
  step: number;
  completed: boolean;
  completed_at?: string;
  business_type?: BusinessType;
  website_url?: string;
  contact_email?: string;
  contact_phone?: string;
}

export interface ServicesConfig {
  enable_customer_followup: boolean;
  followup_interval_hours: number;
  max_followup_attempts: number;
  auto_escalate_to_owner: boolean;
  require_quote_approval?: boolean;
}

export interface BusinessKnowledgeConfig {
  faqs: FaqItem[];
  products_services: ProductServiceItem[];
  services?: ServiceItem[];
  service_areas?: ServiceAreaItem[];
  extracted_facts?: ExtractedFactItem[];
  policies: BusinessPoliciesConfig;
  store_policies?: Record<string, StorePolicyProfile>;
}

export interface BusinessSettings {
  // 1. Profile
  industry: IndustryType;
  business_type?: BusinessType;
  business_name: string;
  display_name_override?: string;
  country: string;
  timezone: string;
  currency: string;
  language: string;
  tone: string;
  working_hours: WorkingHoursConfig;
  website_url?: string;
  contact_email?: string;
  contact_phone?: string;
  public_form_id?: string;

  // 2. Automation Permissions
  automation_mode?: 'draft_only' | 'auto_routine' | 'paused';
  permissions: AutomationPermissionsConfig;

  // 3. Team & Approvers
  team_members: TeamMember[];
  approver_ids: string[];

  // 4. Connections
  connections: ConnectionsConfig;

  // 5. Knowledge & Policies
  knowledge: BusinessKnowledgeConfig;

  // 6. Order Issues & Follow-up Configuration (E-commerce)
  order_issues_config?: {
    followup_interval_hours?: number;
    max_followup_attempts?: number;
    escalate_after_attempts?: boolean;
    auto_close_resolved_days?: number;
    clarification_delay_minutes?: number;
    carrier_check_interval_minutes?: number;
    auto_escalate_to_owner?: boolean;
    owner_reminder_interval_minutes?: number;
    [key: string]: unknown;
  };

  // 7. Services Configuration (Services Pack)
  services_config?: ServicesConfig;

  // 8. Onboarding State
  onboarding?: OnboardingConfig;

  // Backward compatibility legacy fields
  return_window_days?: number;
  refund_requires_approval?: boolean;
  mode?: 'demo' | 'live';
  [key: string]: unknown;
}


export interface BusinessSummary {
  tenant_id: string;
  business_name: string;
  industry: IndustryType;
  role: TeamRole;
  is_active?: boolean;
}

export interface AuthSession {
  user_id: string;
  user_name: string;
  email: string;
  role: TeamRole;
  active_tenant_id: string;
  businesses: BusinessSummary[];
}

export interface BusinessRecord {
  tenant_id: string;
  public_form_id?: string;
  settings: BusinessSettings;
  gmail_connection?: GmailConnectionRecord | null;
  email_credentials?: EmailCredentialRecord | null;
  created_at?: string;
  updated_at: string;
}

export interface BusinessMemberRecord {
  tenant_id: string;
  user_id: string;
  email: string;
  name?: string;
  role: TeamRole;
  can_approve: boolean;
  created_at: string;
}

export type ServicesLeadStage = 'new' | 'contacted' | 'qualified' | 'won' | 'lost';

export interface ServicesLeadRecord {
  id: string;
  tenant_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone?: string | null;
  service_interest?: string | null;
  stage: ServicesLeadStage;
  status: 'open' | 'closed';
  assigned_member_id?: string | null;
  assigned_member_name?: string | null;
  next_action?: string | null;
  due_date?: string | null;
  estimated_value?: number;
  currency?: string;
  source: string;
  conversation_id?: string | null;
  budget_range?: string | null;
  location?: string | null;
  reminder_count?: number;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
}

export interface ServicesLeadEventRecord {
  id: number;
  tenant_id: string;
  lead_id: string;
  event_type: string;
  actor_type: string;
  actor_id?: string | null;
  summary: string;
  details?: Record<string, unknown>;
  created_at: string;
}

export interface ServicesLeadFollowupJobRecord {
  id: string;
  tenant_id: string;
  lead_id: string;
  conversation_id?: string | null;
  status: 'pending' | 'claimed' | 'completed' | 'cancelled' | 'failed';
  followup_type: string;
  attempt_count: number;
  max_attempts: number;
  scheduled_for: string;
  claimed_at?: string | null;
  claimed_by?: string | null;
  execution_retry_count: number;
  last_error?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrderRecord {
  tenant_id: string;
  order_id: string;
  customer_name?: string;
  customer_email?: string;
  items?: Array<{
    name?: string;
    title?: string;
    sku?: string;
    qty?: number;
    quantity?: number;
    price?: number;
    currency?: string;
    variant?: string;
    size?: string;
  }>;
  total?: number | string;
  currency?: string;
  status?: string;
  data?: {
    customer?: {
      name?: string;
      email?: string;
      phone?: string;
      address?: string;
    };
    customer_name?: string;
    customer_email?: string;
    items?: Array<{
      sku?: string;
      name?: string;
      title?: string;
      qty?: number;
      quantity?: number;
      price?: number;
      currency?: string;
      variant?: string;
      size?: string;
    }>;
    total_amount?: number;
    total?: number | string;
    currency?: string;
    status?: string;
    order_date?: string;
    tracking_number?: string;
    carrier?: string;
    delivery_status?: string;
    estimated_delivery?: string;
    is_demo?: boolean;
    demo_badge?: string;
    [key: string]: unknown;
  };
  created_at?: string;
  updated_at?: string;
}

export interface CaseProposal {
  action?: string;
  type?: string;
  summary?: string;
  amount?: number;
  currency?: string;
  items?: Array<{
    sku?: string;
    name?: string;
    qty?: number;
    shortfall?: number;
    supplier?: string;
  }>;
  customer_message?: string;
  reason?: string;
  sku?: string;
  shortfall?: number;
  supplier_order?: unknown;
  escalation_level?: string;
  delivery_update?: unknown;
  refund_details?: unknown;
  [key: string]: unknown;
}

export interface CaseRecord {
  tenant_id: string;
  case_id: string;
  request_id: string;
  kind: CaseKind;
  status: CaseStatus;
  payload: Record<string, unknown>;
  proposal: CaseProposal;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface AuditRecord {
  id: number | string;
  tenant_id: string;
  case_id?: string | null;
  event: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface DailySummarySnapshot {
  id: number | string;
  tenant_id: string;
  event: 'daily_summary';
  details: {
    period_hours?: number;
    completed_last_24h?: number;
    cases_created_last_24h?: number;
    pending_approvals_all_time?: number;
    open_cases?: Array<{
      kind: CaseKind;
      status: CaseStatus;
      case_id: string;
      revision: number;
    }>;
    [key: string]: unknown;
  };
  created_at: string;
}

export interface SummaryStats {
  mode: 'demo';
  tenant_id: string;
  period_hours: number;
  completed_last_24h: number;
  cases_created_last_24h: number;
  pending_approvals_all_time: number;
  cases_resolved_automatically?: number;
  total_cases?: number;
  open_cases: Array<{
    kind: CaseKind;
    status: CaseStatus;
    case_id: string;
    revision: number;
  }>;
  http_status?: number;
  is_live_db?: boolean;
}

export interface CreateCaseResponse {
  case?: CaseRecord;
  mode: 'demo';
  duplicate: boolean;
  http_status: number;
  message?: string;
}

export interface ApprovalResponse {
  mode: 'demo';
  status: 'demo_completed' | string;
  case_id: string;
  revision: number;
  http_status: number;
  external_action_executed: boolean;
  message?: string;
}

export interface DraftResponse {
  http_status: number;
  mode: 'demo';
  draft: string;
  requires_review: boolean;
  sent: boolean;
}

export interface HealthStatus {
  database: {
    connected: boolean;
    configured: boolean;
    error?: string;
    tablesFound?: string[];
  };
  n8n: {
    reachable: boolean;
    configured: boolean;
    url: string;
    error?: string;
  };
  tenant_id: string;
  approver_id: string;
  mode: 'demo';
}

export interface ShopifyConnectionRecord {
  tenant_id: string;
  shop_domain: string;
  encrypted_access_token: string;
  scope: string;
  is_connected: boolean;
  sync_status: 'idle' | 'syncing' | 'success' | 'partial_failed' | 'failed' | 'disconnected';
  last_synced_at?: string | null;
  last_error?: string | null;
  store_info: {
    name?: string;
    email?: string;
    currency?: string;
    domain?: string;
    myshopify_domain?: string;
    plan_name?: string;
    country_name?: string;
    iana_timezone?: string;
    [key: string]: unknown;
  };
  created_at: string;
  updated_at: string;
}

export interface ShopifyPublicConfig {
  is_connected: boolean;
  shop_domain?: string;
  shop_name?: string;
  currency?: string;
  plan_name?: string;
  sync_status: 'idle' | 'syncing' | 'success' | 'partial_failed' | 'failed' | 'disconnected' | 'not_connected';
  last_synced_at?: string | null;
  last_error?: string | null;
  product_count?: number;
  order_count?: number;
  is_configured_on_platform: boolean;
}

export interface ShopifyProductVariant {
  id: string | number;
  product_id: string | number;
  title: string;
  price: string | number;
  sku?: string;
  inventory_quantity?: number;
  available?: boolean;
  barcode?: string;
  [key: string]: unknown;
}

export interface ShopifyProductRecord {
  tenant_id: string;
  shopify_product_id: string;
  title: string;
  handle?: string;
  product_type?: string;
  vendor?: string;
  status?: string;
  variants: ShopifyProductVariant[];
  options?: Array<{ name: string; values: string[] }>;
  raw_data?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface ShopifySyncJob {
  id: string;
  tenant_id: string;
  shop_domain: string;
  status: 'pending' | 'running' | 'completed' | 'partial_failed' | 'failed';
  sync_types: Array<'products' | 'inventory' | 'policies' | 'orders'>;
  progress: {
    products?: { total?: number; processed: number; failed: number; has_next_page: boolean; next_cursor?: string | null };
    orders?: { total?: number; processed: number; failed: number; has_next_page: boolean; next_cursor?: string | null };
    policies?: { processed: number; failed: number; status: string };
    inventory?: { processed: number; failed: number; status: string };
    [key: string]: unknown;
  };
  summary: {
    products_synced?: number;
    variants_synced?: number;
    orders_synced?: number;
    policies_synced?: number;
    inventory_items_synced?: number;
    errors_count?: number;
    [key: string]: unknown;
  };
  error_details: Array<{
    type?: string;
    item_id?: string;
    message: string;
    timestamp: string;
  }>;
  created_at: string;
  updated_at: string;
}

// ==========================================
// 15. Order Issue Resolution Types
// ==========================================

export type OrderIssueType =
  | 'delivery_delay'
  | 'not_received'
  | 'damaged_item'
  | 'wrong_item'
  | 'refund_request'
  | 'exchange_request'
  | 'cancellation_request';

export type OrderIssueStatus =
  | 'open'
  | 'investigating'
  | 'awaiting_customer'
  | 'awaiting_owner'
  | 'action_pending'
  | 'resolved'
  | 'closed';

export type OrderIssueResponsibleParty = 'customer' | 'owner' | 'system' | 'ai_operator';

export interface OrderIssueEvidence {
  order_id?: string;
  shopify_order_id?: string;
  order_status?: string;
  fulfillment_status?: string;
  tracking_number?: string | null;
  carrier?: string;
  delivery_status?: string;
  estimated_delivery?: string;
  carrier_delay_reported?: boolean;
  carrier_data_unavailable?: boolean;
  customer_claim?: string;
  item_condition?: string;
  photos_provided?: boolean;
  investigation_notes?: string;
  source_updated_at?: string;
  owner_tasks?: Array<{
    id: string;
    title: string;
    status: 'pending' | 'completed';
    created_at: string;
    completed_at?: string;
    completed_by?: string;
    notes?: string;
    task_type?: 'manual_action_execution' | 'warehouse_fulfillment' | 'locate_tracking' | 'owner_review' | string;
    action_type?: 'refund' | 'exchange' | 'cancellation' | string;
    action_details?: {
      amount?: number;
      currency?: string;
      reason?: string;
      items?: unknown[];
      replacement_size?: string;
      proposal_id?: string;
      proposal_revision?: number;
      [key: string]: unknown;
    };
    approved_by?: string;
    approved_at?: string;
    execution_reference?: string;
    completion_label?: string; // 'Owner-reported completion'
  }>;
  proposal_id?: string;
  proposal_action?: string;
  execution_pending_reason?: string;
  [key: string]: unknown;
}

export interface OrderIssueRecord {
  id: string;
  tenant_id: string;
  issue_type: OrderIssueType;
  status: OrderIssueStatus;
  order_id?: string | null;
  shop_domain?: string | null;
  conversation_id?: string | null;
  customer_name: string;
  customer_email: string;
  evidence: OrderIssueEvidence;
  next_action?: string | null;
  responsible_party: OrderIssueResponsibleParty;
  due_date?: string | null;
  resolution_summary?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
  closed_at?: string | null;
  active_followup_job?: OrderIssueFollowupJobRecord | null;
  is_escalated?: boolean;
  escalation_summary?: string | null;
}

export type OrderIssueEventType =
  | 'created'
  | 'investigated'
  | 'status_changed'
  | 'clarification_requested'
  | 'customer_replied'
  | 'proposal_created'
  | 'action_approved'
  | 'action_rejected'
  | 'execution_pending'
  | 'manual_action_executed'
  | 'followup_scheduled'
  | 'followup_sent'
  | 'escalated_to_owner'
  | 'order_reconciled'
  | 'tracking_updated'
  | 'resolved'
  | 'closed';

export interface OrderIssueEventRecord {
  id: number | string;
  tenant_id: string;
  issue_id: string;
  event_type: OrderIssueEventType;
  actor_type: 'system' | 'ai_operator' | 'owner' | 'customer';
  actor_id?: string | null;
  summary: string;
  details: Record<string, unknown>;
  from_status?: string;
  to_status?: string;
  created_at: string;
}

export type FollowupJobStatus = 'pending' | 'claimed' | 'completed' | 'cancelled' | 'failed';

export type FollowupJobType =
  | 'awaiting_customer_clarification'
  | 'awaiting_customer_photos'
  | 'awaiting_carrier_update'
  | 'awaiting_owner_review';

export interface OrderIssueFollowupJobRecord {
  id: string;
  tenant_id: string;
  issue_id: string;
  conversation_id?: string | null;
  status: FollowupJobStatus;
  followup_type: FollowupJobType;
  attempt_count: number;
  max_attempts: number;
  scheduled_for: string;
  claimed_at?: string | null;
  claimed_by?: string | null;
  last_error?: string | null;
  associated_task_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

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

export interface CustomStoreConnectionRecord {
  id: string;
  tenant_id: string;
  store_name: string;
  website_url: string;
  api_base_url: string;
  auth_type: 'bearer' | 'api_key' | 'basic';
  encrypted_credentials: {
    encrypted_api_key?: string;
    encrypted_username?: string;
    encrypted_password?: string;
    masked_key?: string;
    [key: string]: unknown;
  };
  webhook_secret?: string | null;
  is_connected: boolean;
  sync_status: 'idle' | 'syncing' | 'success' | 'partial_failed' | 'failed' | 'disconnected';
  last_synced_at?: string | null;
  last_error?: string | null;
  sync_checkpoint: {
    last_product_updated_at?: string;
    last_order_updated_at?: string;
    last_page?: number;
    [key: string]: unknown;
  };
  store_info: {
    name?: string;
    currency?: string;
    timezone?: string;
    country?: string;
    policies?: {
      return_policy?: string;
      shipping_policy?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  product_count: number;
  order_count: number;
  created_at: string;
  updated_at: string;
}

export interface CustomStorePublicConfig {
  id: string;
  store_name: string;
  website_url: string;
  api_base_url: string;
  auth_type: 'bearer' | 'api_key' | 'basic';
  masked_key: string;
  masked_api_key?: string;
  has_webhook_secret: boolean;
  is_connected: boolean;
  sync_status: 'idle' | 'syncing' | 'success' | 'partial_failed' | 'failed' | 'disconnected';
  last_synced_at?: string | null;
  last_error?: string | null;
  product_count: number;
  order_count: number;
  currency?: string;
  created_at: string;
}

export interface CustomStoreProductRecord {
  tenant_id: string;
  connection_id: string;
  external_product_id: string;
  title: string;
  handle?: string;
  product_type?: string;
  vendor?: string;
  status?: string;
  variants: Array<{
    id: string;
    title: string;
    sku?: string;
    price: string;
    compare_at_price?: string | null;
    currency: string;
    inventory_quantity?: number;
    available?: boolean;
    [key: string]: unknown;
  }>;
  options?: Array<{ name: string; values: string[] }>;
  raw_data?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface CustomStoreSyncJob {
  id: string;
  tenant_id: string;
  connection_id: string;
  status: 'pending' | 'running' | 'completed' | 'partial_failed' | 'failed';
  sync_types: string[];
  progress: {
    products_fetched?: number;
    orders_fetched?: number;
    current_page?: number;
    total_pages?: number;
    [key: string]: unknown;
  };
  summary: {
    products_synced?: number;
    orders_synced?: number;
    reconciled_issues_count?: number;
    [key: string]: unknown;
  };
  error_details: Array<{
    item_id?: string;
    stage?: string;
    message: string;
    timestamp: string;
  }>;
  created_at: string;
  updated_at: string;
}

export interface CustomStoreWebhookPayload {
  event_id: string;
  topic: 'order.created' | 'order.updated' | 'order.fulfilled' | 'product.updated' | 'inventory.updated' | string;
  timestamp: string;
  data: Record<string, unknown>;
}

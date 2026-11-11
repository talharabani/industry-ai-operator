import crypto from 'crypto';
import { query } from './db.ts';
import type {
  BusinessRecord,
  BusinessSettings,
  BusinessMemberRecord,
  BusinessSummary,
  IndustryType,
  BusinessType,
  TeamRole,
  ServiceItem,
  ServiceAreaItem,
  ExtractedFactItem,
  ServicesLeadRecord,
  ServicesLeadEventRecord,
  ServicesLeadFollowupJobRecord,
  ServicesLeadStage,
  FaqItem,
  BusinessPoliciesConfig,
} from './types.ts';
import { getDefaultBusinessSettings, recordAuditLog } from './db.ts';
import { validateOutboundDispatch } from './outbound-guard.ts';

/**
 * Creates an opaque public form identifier for a business workspace
 */
export function generatePublicFormId(tenantId: string): string {
  const hash = crypto.createHash('sha256').update(tenantId + '_public_form_salt').digest('hex').slice(0, 12);
  return `pf_${hash}`;
}

// ============================================================================
// 1. MULTI-BUSINESS WORKSPACES & MEMBERSHIP
// ============================================================================

export async function createBusinessWorkspace(params: {
  tenantId: string;
  businessName: string;
  industry?: IndustryType;
  businessType?: BusinessType;
  ownerUserId: string;
  ownerEmail: string;
  ownerName?: string;
  websiteUrl?: string;
  timezone?: string;
  language?: string;
  country?: string;
  currency?: string;
  contactEmail?: string;
  contactPhone?: string;
}): Promise<BusinessRecord> {
  const {
    tenantId,
    businessName,
    industry = 'services',
    businessType = 'services',
    ownerUserId,
    ownerEmail,
    ownerName = 'Business Owner',
    websiteUrl,
    timezone = 'UTC',
    language = 'English',
    country = 'United States',
    currency = 'USD',
    contactEmail,
    contactPhone,
  } = params;

  const publicFormId = generatePublicFormId(tenantId);
  const now = new Date().toISOString();

  // Get base defaults
  const defaults = getDefaultBusinessSettings(tenantId, businessName, industry);

  // Customize settings for the chosen business type
  const settings: BusinessSettings = {
    ...defaults,
    industry,
    business_type: businessType,
    business_name: businessName,
    timezone,
    language,
    country,
    currency,
    website_url: websiteUrl,
    contact_email: contactEmail || ownerEmail,
    contact_phone: contactPhone,
    public_form_id: publicFormId,
    automation_mode: 'draft_only', // Safe default for new businesses
    working_hours: {
      start_time: '09:00',
      end_time: '18:00',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      auto_reply_outside_hours: true,
    },
    team_members: [
      {
        id: ownerUserId,
        name: ownerName,
        email: ownerEmail,
        role: 'owner',
        can_approve: true,
        title: 'Primary Business Owner',
        created_at: now,
      },
    ],
    approver_ids: [ownerUserId],
    connections: {
      website: {
        type: businessType === 'ecommerce' ? 'shopify' : 'no_website',
        status: websiteUrl ? 'not_connected' : 'not_connected',
        store_url: websiteUrl,
        hosted_inquiry_enabled: true,
        is_verified: false,
      },
      email: {
        mode: 'demo',
        provider: 'none',
        status: 'not_connected',
        sender_email: contactEmail || ownerEmail,
        is_verified: false,
      },
      whatsapp: {
        provider: 'none',
        status: 'not_implemented',
        is_verified: false,
      },
    },
    knowledge: {
      faqs: [
        {
          id: `faq-${Date.now()}-1`,
          question: `What are your standard business hours?`,
          answer: `Our standard business hours are Monday through Friday, 9:00 AM to 6:00 PM.`,
          category: 'General',
        },
        {
          id: `faq-${Date.now()}-2`,
          question: `How do I request a quote or schedule a consultation?`,
          answer: `You can reach out through our online inquiry form or email us at ${contactEmail || ownerEmail}. Our team reviews all quote requests and responds promptly.`,
          category: 'Services',
        },
      ],
      products_services: [],
      services: [],
      service_areas: [],
      extracted_facts: [],
      policies: {
        general_rules: `All customer inquiries are handled under merchant supervision. Quotes and binding commitments require owner approval.`,
        cancellation_notice_hours: 24,
        deposit_required_pct: 0,
      },
    },
    services_config: {
      enable_customer_followup: false, // Strictly disabled by default
      followup_interval_hours: 24,
      max_followup_attempts: 2,
      auto_escalate_to_owner: true,
      require_quote_approval: true,
    },
    onboarding: {
      step: 1,
      completed: false,
      business_type: businessType,
      website_url: websiteUrl,
      contact_email: contactEmail || ownerEmail,
      contact_phone: contactPhone,
    },
  };

  // Insert business record with public_form_id
  await query(
    `INSERT INTO iao.businesses (tenant_id, public_form_id, settings, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id)
     DO UPDATE SET 
       public_form_id = COALESCE(iao.businesses.public_form_id, EXCLUDED.public_form_id),
       settings = EXCLUDED.settings,
       updated_at = EXCLUDED.updated_at;`,
    [tenantId, publicFormId, JSON.stringify(settings), now]
  );

  // Register owner in iao.business_members
  await query(
    `INSERT INTO iao.business_members (tenant_id, user_id, email, name, role, can_approve, created_at)
     VALUES ($1, $2, $3, $4, 'owner', true, $5)
     ON CONFLICT (tenant_id, user_id)
     DO UPDATE SET role = 'owner', can_approve = true;`,
    [tenantId, ownerUserId, ownerEmail, ownerName, now]
  );

  // Audit log
  await recordAuditLog(tenantId, 'business_workspace_created', {
    tenant_id: tenantId,
    business_name: businessName,
    business_type: businessType,
    owner_id: ownerUserId,
    owner_email: ownerEmail,
  });

  return {
    tenant_id: tenantId,
    public_form_id: publicFormId,
    settings,
    updated_at: now,
  };
}

export async function getBusinessByPublicFormId(identifier: string): Promise<BusinessRecord | null> {
  const cleanId = identifier.trim();
  const rows = await query<{
    tenant_id: string;
    public_form_id: string | null;
    settings: any;
    updated_at: string;
  }>(
    `SELECT tenant_id, public_form_id, settings, updated_at 
     FROM iao.businesses 
     WHERE public_form_id = $1 OR tenant_id = $1 
     LIMIT 1;`,
    [cleanId]
  );

  if (rows.length === 0) return null;
  return {
    tenant_id: rows[0].tenant_id,
    public_form_id: rows[0].public_form_id || undefined,
    settings: rows[0].settings,
    updated_at: rows[0].updated_at,
  };
}

export async function addBusinessMember(
  tenantIdOrPayload:
    | string
    | {
        tenantId: string;
        userId: string;
        email: string;
        name?: string;
        role: TeamRole;
        can_approve?: boolean;
      },
  maybeMember?: {
    userId: string;
    email: string;
    name?: string;
    role: TeamRole;
    can_approve?: boolean;
  }
): Promise<BusinessMemberRecord> {
  const tenantId =
    typeof tenantIdOrPayload === 'string'
      ? tenantIdOrPayload
      : tenantIdOrPayload.tenantId;

  const member =
    typeof tenantIdOrPayload === 'string'
      ? maybeMember!
      : tenantIdOrPayload;

  const now = new Date().toISOString();
  const canApprove = member.can_approve ?? (member.role === 'owner' || member.role === 'admin');

  await query(
    `INSERT INTO iao.business_members (tenant_id, user_id, email, name, role, can_approve, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, user_id)
     DO UPDATE SET 
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       can_approve = EXCLUDED.can_approve;`,
    [tenantId, member.userId, member.email, member.name || member.userId, member.role, canApprove, now]
  );

  return {
    tenant_id: tenantId,
    user_id: member.userId,
    email: member.email,
    name: member.name,
    role: member.role,
    can_approve: canApprove,
    created_at: now,
  };
}

export async function listBusinessMembers(tenantId: string): Promise<BusinessMemberRecord[]> {
  const rows = await query<BusinessMemberRecord>(
    `SELECT tenant_id, user_id, email, name, role, can_approve, created_at 
     FROM iao.business_members 
     WHERE tenant_id = $1 
     ORDER BY created_at ASC;`,
    [tenantId]
  );
  return rows;
}

// ============================================================================
// 2. SERVICES KNOWLEDGE MANAGEMENT
// ============================================================================

export async function updateServicesKnowledge(
  tenantId: string,
  updates: {
    services?: ServiceItem[];
    service_areas?: ServiceAreaItem[];
    extracted_facts?: ExtractedFactItem[];
    faqs?: FaqItem[];
    policies?: Partial<BusinessPoliciesConfig>;
  }
): Promise<BusinessSettings> {
  const bizRows = await query<{ settings: any }>(
    `SELECT settings FROM iao.businesses WHERE tenant_id = $1 LIMIT 1;`,
    [tenantId]
  );

  if (bizRows.length === 0) {
    throw new Error(`Business workspace '${tenantId}' not found.`);
  }

  const currentSettings: BusinessSettings = bizRows[0].settings;
  const currentKnowledge = currentSettings.knowledge || {
    faqs: [],
    products_services: [],
    policies: {},
  };

  const newKnowledge = {
    ...currentKnowledge,
    ...(updates.services ? { services: updates.services } : {}),
    ...(updates.service_areas ? { service_areas: updates.service_areas } : {}),
    ...(updates.extracted_facts ? { extracted_facts: updates.extracted_facts } : {}),
    ...(updates.faqs ? { faqs: updates.faqs } : {}),
    policies: {
      ...currentKnowledge.policies,
      ...(updates.policies || {}),
    },
  };

  const newSettings: BusinessSettings = {
    ...currentSettings,
    knowledge: newKnowledge,
  };

  const now = new Date().toISOString();
  await query(
    `UPDATE iao.businesses SET settings = $1, updated_at = $2 WHERE tenant_id = $3;`,
    [JSON.stringify(newSettings), now, tenantId]
  );

  await recordAuditLog(tenantId, 'services_knowledge_updated', {
    services_count: newKnowledge.services?.length || 0,
    areas_count: newKnowledge.service_areas?.length || 0,
    faqs_count: newKnowledge.faqs?.length || 0,
  });

  return newSettings;
}

export async function addServiceItem(
  tenantId: string,
  service: Omit<ServiceItem, 'id' | 'created_at'>
): Promise<ServiceItem> {
  const newItem: ServiceItem = {
    ...service,
    id: `srv_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
    created_at: new Date().toISOString(),
  };

  const bizRows = await query<{ settings: any }>(
    `SELECT settings FROM iao.businesses WHERE tenant_id = $1 LIMIT 1;`,
    [tenantId]
  );
  if (bizRows.length === 0) throw new Error(`Workspace '${tenantId}' not found.`);

  const settings: BusinessSettings = bizRows[0].settings;
  const existingServices: ServiceItem[] = settings.knowledge?.services || [];
  const updatedServices = [...existingServices, newItem];

  await updateServicesKnowledge(tenantId, { services: updatedServices });
  return newItem;
}

export async function decideExtractedFact(
  tenantId: string,
  factId: string,
  decision: 'approved' | 'rejected'
): Promise<ExtractedFactItem | null> {
  const bizRows = await query<{ settings: any }>(
    `SELECT settings FROM iao.businesses WHERE tenant_id = $1 LIMIT 1;`,
    [tenantId]
  );
  if (bizRows.length === 0) return null;

  const settings: BusinessSettings = bizRows[0].settings;
  const facts: ExtractedFactItem[] = settings.knowledge?.extracted_facts || [];
  const targetIndex = facts.findIndex((f) => f.id === factId);

  if (targetIndex === -1) return null;

  const targetFact = facts[targetIndex];
  targetFact.approval_status = decision;

  // If approved and it is a service, promote to approved services list
  let updatedServices = settings.knowledge?.services || [];
  if (decision === 'approved' && targetFact.fact_type === 'service') {
    const extData = targetFact.extracted_data || {};
    const serviceName = String(extData.name || targetFact.raw_text).slice(0, 100);
    const existingIdx = updatedServices.findIndex((s) => s.name.toLowerCase() === serviceName.toLowerCase());
    
    if (existingIdx >= 0) {
      updatedServices[existingIdx].approval_status = 'approved';
    } else {
      updatedServices.push({
        id: `srv_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
        name: serviceName,
        category: (extData.category as string) || 'General',
        description: (extData.description as string) || targetFact.raw_text,
        price_type: (extData.price_type as any) || 'quote_required',
        price: typeof extData.price === 'number' ? extData.price : undefined,
        is_active: true,
        approval_status: 'approved',
        source: 'website_import',
        created_at: new Date().toISOString(),
      });
    }
  }

  // If approved and it is an FAQ, promote to approved FAQs
  let updatedFaqs = settings.knowledge?.faqs || [];
  if (decision === 'approved' && targetFact.fact_type === 'faq') {
    const extData = targetFact.extracted_data || {};
    const q = String(extData.question || '').trim();
    const a = String(extData.answer || '').trim();
    if (q && a) {
      updatedFaqs.push({
        id: `faq-${Date.now()}`,
        question: q,
        answer: a,
        category: (extData.category as string) || 'Services',
      });
    }
  }

  facts[targetIndex] = targetFact;

  await updateServicesKnowledge(tenantId, {
    extracted_facts: facts,
    services: updatedServices,
    faqs: updatedFaqs,
  });

  return targetFact;
}

// ============================================================================
// 3. SERVICES LEAD MANAGEMENT
// ============================================================================

export async function createOrUpdateServicesLead(
  tenantId: string,
  params: {
    customer_name: string;
    customer_email: string;
    customer_phone?: string | null;
    service_interest?: string | null;
    budget_range?: string | null;
    location?: string | null;
    source?: string;
    conversation_id?: string | null;
    inquiry_text?: string;
  }
): Promise<{ lead: ServicesLeadRecord; isNew: boolean }> {
  const cleanEmail = params.customer_email.trim().toLowerCase();
  const cleanName = params.customer_name.trim();

  // 1. Search for existing open lead with same tenant and email (prevent duplicate leads for repeat inquiries)
  const existingRows = await query<ServicesLeadRecord>(
    `SELECT * FROM iao.services_leads 
     WHERE tenant_id = $1 AND LOWER(customer_email) = $2 AND status = 'open'
     ORDER BY created_at DESC 
     LIMIT 1;`,
    [tenantId, cleanEmail]
  );

  if (existingRows.length > 0) {
    const existing = existingRows[0];
    const updates: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [existing.id, tenantId];
    let valIdx = 3;

    if (params.customer_phone && !existing.customer_phone) {
      updates.push(`customer_phone = $${valIdx++}`);
      values.push(params.customer_phone.trim());
    }

    if (params.service_interest && !existing.service_interest) {
      updates.push(`service_interest = $${valIdx++}`);
      values.push(params.service_interest.trim());
    }

    if (params.budget_range && !existing.budget_range) {
      updates.push(`budget_range = $${valIdx++}`);
      values.push(params.budget_range.trim());
    }

    if (params.location && !existing.location) {
      updates.push(`location = $${valIdx++}`);
      values.push(params.location.trim());
    }

    if (params.conversation_id && existing.conversation_id !== params.conversation_id) {
      updates.push(`conversation_id = $${valIdx++}`);
      values.push(params.conversation_id);
    }

    const updatedRows = await query<ServicesLeadRecord>(
      `UPDATE iao.services_leads 
       SET ${updates.join(', ')} 
       WHERE id = $1 AND tenant_id = $2 
       RETURNING *;`,
      values
    );

    // Record timeline event
    await addServicesLeadEvent(tenantId, existing.id, {
      event_type: 'customer_inquiry_added',
      actor_type: 'system',
      summary: `Follow-up inquiry received from ${cleanName}: "${(params.inquiry_text || '').slice(0, 80)}"`,
      details: {
        service_interest: params.service_interest,
        conversation_id: params.conversation_id,
      },
    });

    return { lead: updatedRows[0] || existing, isNew: false };
  }

  // 2. Create brand new persistent Lead
  const leadId = `lead_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();

  const newRows = await query<ServicesLeadRecord>(
    `INSERT INTO iao.services_leads (
      id, tenant_id, customer_name, customer_email, customer_phone,
      service_interest, stage, status, source, conversation_id,
      budget_range, location, metadata, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, 'new', 'open', $7, $8, $9, $10, $11::jsonb, $12, $12)
    RETURNING *;`,
    [
      leadId,
      tenantId,
      cleanName,
      cleanEmail,
      params.customer_phone?.trim() || null,
      params.service_interest?.trim() || null,
      params.source || 'hosted_inquiry',
      params.conversation_id || null,
      params.budget_range?.trim() || null,
      params.location?.trim() || null,
      JSON.stringify({ initial_inquiry: (params.inquiry_text || '').slice(0, 300) }),
      now,
    ]
  );

  const createdLead = newRows[0];

  // Record initial creation event
  await addServicesLeadEvent(tenantId, leadId, {
    event_type: 'lead_created',
    actor_type: 'system',
    summary: `New Lead captured for ${cleanName} (${cleanEmail}) via ${params.source || 'hosted_inquiry'}`,
    details: {
      service_interest: params.service_interest,
      budget_range: params.budget_range,
      location: params.location,
    },
  });

  return { lead: createdLead, isNew: true };
}

export async function getServicesLead(tenantId: string, leadId: string): Promise<ServicesLeadRecord | null> {
  const rows = await query<ServicesLeadRecord>(
    `SELECT * FROM iao.services_leads WHERE tenant_id = $1 AND id = $2 LIMIT 1;`,
    [tenantId, leadId]
  );
  return rows[0] || null;
}

export async function listServicesLeads(
  tenantId: string,
  filter?: {
    stage?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ leads: ServicesLeadRecord[]; total: number }> {
  const conditions: string[] = ['tenant_id = $1'];
  const values: unknown[] = [tenantId];
  let valIdx = 2;

  if (filter?.stage && filter.stage !== 'all') {
    conditions.push(`stage = $${valIdx++}`);
    values.push(filter.stage);
  }

  if (filter?.status && filter.status !== 'all') {
    conditions.push(`status = $${valIdx++}`);
    values.push(filter.status);
  }

  if (filter?.search && filter.search.trim()) {
    conditions.push(`(
      customer_name ILIKE $${valIdx} OR 
      customer_email ILIKE $${valIdx} OR 
      service_interest ILIKE $${valIdx} OR 
      next_action ILIKE $${valIdx}
    )`);
    values.push(`%${filter.search.trim()}%`);
    valIdx++;
  }

  const whereClause = conditions.join(' AND ');

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM iao.services_leads WHERE ${whereClause};`,
    values
  );
  const total = parseInt(countRes[0]?.count || '0', 10);

  const limit = Math.min(100, Math.max(1, filter?.limit || 50));
  const offset = Math.max(0, filter?.offset || 0);

  const dataRows = await query<ServicesLeadRecord>(
    `SELECT * FROM iao.services_leads 
     WHERE ${whereClause} 
     ORDER BY updated_at DESC 
     LIMIT $${valIdx++} OFFSET $${valIdx++};`,
    [...values, limit, offset]
  );

  return { leads: dataRows, total };
}

export async function updateServicesLead(
  tenantId: string,
  leadId: string,
  updates: {
    stage?: ServicesLeadStage;
    status?: 'open' | 'closed';
    assigned_member_id?: string | null;
    assigned_member_name?: string | null;
    next_action?: string | null;
    due_date?: string | null;
    estimated_value?: number;
    notes?: string;
    manual_takeover?: boolean;
  },
  actor?: { id?: string; name?: string; type?: string }
): Promise<ServicesLeadRecord | null> {
  const existing = await getServicesLead(tenantId, leadId);
  if (!existing) return null;

  const setClauses: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [leadId, tenantId];
  let valIdx = 3;

  const eventsToLog: Array<{ event_type: string; summary: string; details?: any }> = [];

  if (updates.stage && updates.stage !== existing.stage) {
    setClauses.push(`stage = $${valIdx++}`);
    values.push(updates.stage);
    eventsToLog.push({
      event_type: 'stage_changed',
      summary: `Lead stage changed from ${existing.stage.toUpperCase()} to ${updates.stage.toUpperCase()}`,
      details: { previous_stage: existing.stage, new_stage: updates.stage },
    });

    if (updates.stage === 'won' || updates.stage === 'lost') {
      setClauses.push(`status = 'closed'`);
      setClauses.push(`closed_at = NOW()`);
      // Cancel active follow-ups since lead reached a terminal stage
      await cancelServicesLeadFollowup({
        tenantId,
        leadId,
        reason: `Lead marked as ${updates.stage}`,
      });
    }
  }

  if (updates.status && updates.status !== existing.status && updates.stage !== 'won' && updates.stage !== 'lost') {
    setClauses.push(`status = $${valIdx++}`);
    values.push(updates.status);
    if (updates.status === 'closed') {
      setClauses.push(`closed_at = NOW()`);
      await cancelServicesLeadFollowup({
        tenantId,
        leadId,
        reason: 'Lead closed by merchant',
      });
    }
  }

  if (updates.assigned_member_id !== undefined) {
    setClauses.push(`assigned_member_id = $${valIdx++}`);
    values.push(updates.assigned_member_id);
    setClauses.push(`assigned_member_name = $${valIdx++}`);
    values.push(updates.assigned_member_name || null);
    eventsToLog.push({
      event_type: 'lead_assigned',
      summary: updates.assigned_member_name 
        ? `Lead assigned to ${updates.assigned_member_name}`
        : `Lead assignment cleared`,
      details: { member_id: updates.assigned_member_id },
    });
  }

  if (updates.next_action !== undefined) {
    setClauses.push(`next_action = $${valIdx++}`);
    values.push(updates.next_action);
    eventsToLog.push({
      event_type: 'next_action_updated',
      summary: `Next action: ${updates.next_action || 'None'}`,
    });
  }

  if (updates.due_date !== undefined) {
    setClauses.push(`due_date = $${valIdx++}`);
    values.push(updates.due_date);
  }

  if (updates.estimated_value !== undefined) {
    setClauses.push(`estimated_value = $${valIdx++}`);
    values.push(updates.estimated_value);
  }

  if (updates.manual_takeover) {
    // Record manual takeover and cancel automated customer follow-ups
    const meta = existing.metadata || {};
    meta.manual_takeover = true;
    meta.manual_takeover_at = new Date().toISOString();
    meta.manual_takeover_by = actor?.name || actor?.id || 'Merchant';
    setClauses.push(`metadata = $${valIdx++}`);
    values.push(JSON.stringify(meta));

    eventsToLog.push({
      event_type: 'manual_takeover',
      summary: `Manual takeover initiated by ${actor?.name || 'Owner'}. Automated follow-up suspended.`,
    });

    await cancelServicesLeadFollowup({
      tenantId,
      leadId,
      reason: 'Manual takeover by merchant',
    });
  }

  const updatedRows = await query<ServicesLeadRecord>(
    `UPDATE iao.services_leads 
     SET ${setClauses.join(', ')} 
     WHERE id = $1 AND tenant_id = $2 
     RETURNING *;`,
    values
  );

  const updatedLead = updatedRows[0];

  // Log events
  for (const evt of eventsToLog) {
    await addServicesLeadEvent(tenantId, leadId, {
      event_type: evt.event_type,
      actor_type: actor?.type || 'owner',
      actor_id: actor?.id,
      summary: evt.summary,
      details: evt.details,
    });
  }

  return updatedLead;
}

export async function addServicesLeadEvent(
  tenantId: string,
  leadId: string,
  event: {
    event_type: string;
    actor_type?: string;
    actor_id?: string | null;
    summary: string;
    details?: Record<string, unknown>;
  }
): Promise<ServicesLeadEventRecord> {
  const rows = await query<ServicesLeadEventRecord>(
    `INSERT INTO iao.services_lead_events (
      tenant_id, lead_id, event_type, actor_type, actor_id, summary, details, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
    RETURNING *;`,
    [
      tenantId,
      leadId,
      event.event_type,
      event.actor_type || 'system',
      event.actor_id || null,
      event.summary,
      JSON.stringify(event.details || {}),
    ]
  );
  return rows[0];
}

export async function getServicesLeadEvents(tenantId: string, leadId: string): Promise<ServicesLeadEventRecord[]> {
  const rows = await query<ServicesLeadEventRecord>(
    `SELECT * FROM iao.services_lead_events 
     WHERE tenant_id = $1 AND lead_id = $2 
     ORDER BY created_at ASC;`,
    [tenantId, leadId]
  );
  return rows;
}

// ============================================================================
// 4. SERVICES FOLLOW-UP QUEUE & N8N ORCHESTRATION
// ============================================================================

export async function scheduleServicesLeadFollowup(params: {
  tenantId: string;
  leadId: string;
  conversationId?: string | null;
  followupType?: string;
  delayHours?: number;
  delayMinutes?: number;
  maxAttempts?: number;
  scheduledFor?: string;
  metadata?: Record<string, unknown>;
}): Promise<ServicesLeadFollowupJobRecord | null> {
  const { tenantId, leadId, conversationId, followupType = 'initial_inquiry_followup', delayHours, delayMinutes, maxAttempts = 2, metadata = {} } = params;

  // 1. Check if business has explicitly enabled automated follow-ups
  const bizRows = await query<{ settings: any }>(
    `SELECT settings FROM iao.businesses WHERE tenant_id = $1 LIMIT 1;`,
    [tenantId]
  );
  if (bizRows.length === 0) return null;

  const settings: BusinessSettings = bizRows[0].settings;
  const isFollowupEnabled = settings.services_config?.enable_customer_followup === true;
  if (!isFollowupEnabled) {
    // Follow-ups disabled by default: do not schedule automated dispatch
    return null;
  }

  const scheduledFor = params.scheduledFor || (
    delayMinutes !== undefined
      ? new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()
      : new Date(Date.now() + (delayHours || 24) * 60 * 60 * 1000).toISOString()
  );

  // 2. Check if active job already pending or claimed
  const existingJob = await query<ServicesLeadFollowupJobRecord>(
    `SELECT * FROM iao.services_lead_followup_jobs 
     WHERE tenant_id = $1 AND lead_id = $2 AND followup_type = $3 AND status IN ('pending', 'claimed')
     LIMIT 1;`,
    [tenantId, leadId, followupType]
  );

  if (existingJob.length > 0) {
    await query(
      `UPDATE iao.services_lead_followup_jobs 
       SET scheduled_for = $1, metadata = metadata || $2::jsonb, updated_at = NOW() 
       WHERE id = $3;`,
      [scheduledFor, JSON.stringify(metadata), existingJob[0].id]
    );
    existingJob[0].scheduled_for = scheduledFor;
    existingJob[0].metadata = { ...(existingJob[0].metadata || {}), ...metadata };
    return existingJob[0];
  }

  const jobId = `sfj_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

  const rows = await query<ServicesLeadFollowupJobRecord>(
    `INSERT INTO iao.services_lead_followup_jobs (
      id, tenant_id, lead_id, conversation_id, status, followup_type,
      attempt_count, max_attempts, scheduled_for, metadata, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'pending', $5, 0, $6, $7, $8::jsonb, NOW(), NOW())
    ON CONFLICT (tenant_id, lead_id, followup_type) WHERE status IN ('pending', 'claimed')
    DO UPDATE SET metadata = EXCLUDED.metadata, scheduled_for = EXCLUDED.scheduled_for, updated_at = NOW()
    RETURNING *;`,
    [jobId, tenantId, leadId, conversationId || null, followupType, maxAttempts, scheduledFor, JSON.stringify(metadata)]
  );

  return rows[0] || null;
}

/**
 * Atomically claims due follow-up jobs using FOR UPDATE SKIP LOCKED
 */
export async function claimEligibleServicesFollowupJobs(
  limitOrParams?: number | { limit?: number; workerId?: string; tenantId?: string },
  maybeWorkerId?: string,
  maybeTenantId?: string
): Promise<ServicesLeadFollowupJobRecord[]> {
  let limit = 5;
  let workerId = `n8n_worker_${Date.now().toString(36)}`;
  let tenantId: string | undefined;

  if (typeof limitOrParams === 'object' && limitOrParams !== null) {
    limit = limitOrParams.limit || 5;
    workerId = limitOrParams.workerId || workerId;
    tenantId = limitOrParams.tenantId;
  } else if (typeof limitOrParams === 'number') {
    limit = limitOrParams;
    if (maybeWorkerId) workerId = maybeWorkerId;
    if (maybeTenantId) tenantId = maybeTenantId;
  }

  limit = Math.min(20, Math.max(1, limit));
  const tenantFilter = tenantId ? 'AND tenant_id = $3' : '';
  const queryParams: unknown[] = [limit, workerId];
  if (tenantId) queryParams.push(tenantId);

  const claimedRows = await query<ServicesLeadFollowupJobRecord>(
    `WITH eligible AS (
      SELECT id FROM iao.services_lead_followup_jobs
      WHERE (
        (status = 'pending' AND scheduled_for <= NOW())
        OR (status = 'claimed' AND claimed_at < NOW() - INTERVAL '5 minutes')
      )
        ${tenantFilter}
      ORDER BY scheduled_for ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE iao.services_lead_followup_jobs j
    SET status = 'claimed',
        claimed_at = NOW(),
        claimed_by = $2,
        execution_retry_count = j.execution_retry_count + 1,
        updated_at = NOW()
    FROM eligible
    WHERE j.id = eligible.id
    RETURNING j.*;`,
    queryParams
  );

  return claimedRows;
}

/**
 * Inspects lead state to determine permitted orchestration path
 */
export async function inspectServicesLeadFollowupEligibility(
  tenantId: string,
  leadId: string,
  jobId: string
): Promise<{
  eligible: boolean;
  reason?: string;
  permitted_path: 'customer_followup' | 'owner_task_escalation' | 'cancel_obsolete';
  action: 'customer_followup' | 'owner_task_escalation' | 'cancel_obsolete';
  lead: ServicesLeadRecord | null;
  job: ServicesLeadFollowupJobRecord | null;
  customer?: { name: string; email: string; phone?: string | null } | null;
}> {
  const [lead, jobRows, bizRows] = await Promise.all([
    getServicesLead(tenantId, leadId),
    query<ServicesLeadFollowupJobRecord>(
      `SELECT * FROM iao.services_lead_followup_jobs WHERE id = $1 AND tenant_id = $2;`,
      [jobId, tenantId]
    ),
    query<{ settings: any }>(
      `SELECT settings FROM iao.businesses WHERE tenant_id = $1;`,
      [tenantId]
    ),
  ]);

  const job = jobRows[0] || null;
  const settings: BusinessSettings = bizRows[0]?.settings || {};
  const customer = lead ? { name: lead.customer_name, email: lead.customer_email, phone: lead.customer_phone } : null;

  if (!lead) {
    return { eligible: false, reason: 'Lead record not found', permitted_path: 'cancel_obsolete', action: 'cancel_obsolete', lead: null, job, customer: null };
  }

  if (!job) {
    return { eligible: false, reason: 'Job record not found', permitted_path: 'cancel_obsolete', action: 'cancel_obsolete', lead, job: null, customer };
  }

  // Check 0: Job already cancelled or completed
  if (job.status === 'cancelled' || job.status === 'completed') {
    return {
      eligible: false,
      reason: job.last_error || `Job is already ${job.status}`,
      permitted_path: 'cancel_obsolete',
      action: 'cancel_obsolete',
      lead,
      job,
      customer,
    };
  }

  // Check 1: Lead Closed or Terminal Stage
  if (lead.status === 'closed' || lead.stage === 'won' || lead.stage === 'lost') {
    return {
      eligible: false,
      reason: `Lead is already ${lead.status === 'closed' ? 'closed' : lead.stage}`,
      permitted_path: 'cancel_obsolete',
      action: 'cancel_obsolete',
      lead,
      job,
      customer,
    };
  }

  // Check 2: Manual Takeover or Customer Opt-out
  if (lead.metadata?.manual_takeover === true || (lead as any).manual_takeover === true || lead.metadata?.opt_out === true) {
    return {
      eligible: false,
      reason: lead.metadata?.opt_out ? 'Customer opted out' : 'Manual takeover by merchant is active',
      permitted_path: 'cancel_obsolete',
      action: 'cancel_obsolete',
      lead,
      job,
      customer,
    };
  }

  // Check 3: Check if customer replied after job was scheduled
  if (lead.conversation_id) {
    const recentCustomerMsgRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM iao.messages 
       WHERE conversation_id = $1 AND tenant_id = $2 AND sender_type = 'customer' AND created_at > $3;`,
      [lead.conversation_id, tenantId, job.created_at]
    );
    const recentCustomerReplies = parseInt(recentCustomerMsgRes[0]?.count || '0', 10);
    if (recentCustomerReplies > 0) {
      return {
        eligible: false,
        reason: 'Customer has replied since follow-up was scheduled',
        permitted_path: 'cancel_obsolete',
        action: 'cancel_obsolete',
        lead,
        job,
        customer,
      };
    }
  }

  // Check 4: Max attempts reached -> Escalate to Owner
  const maxAllowed = job.max_attempts || settings.services_config?.max_followup_attempts || 2;
  const currentAttempts = Math.max(job.attempt_count, (lead as any).reminder_count || 0);
  if (currentAttempts >= maxAllowed) {
    return {
      eligible: false,
      reason: `Max follow-up attempts (${maxAllowed}) reached without customer reply. Escalation required.`,
      permitted_path: 'owner_task_escalation',
      action: 'owner_task_escalation',
      lead,
      job,
      customer,
    };
  }

  // Check 5: Automation Settings
  if (settings.automation_mode === 'paused') {
    return {
      eligible: false,
      reason: 'Business automation is paused',
      permitted_path: 'cancel_obsolete',
      action: 'cancel_obsolete',
      lead,
      job,
      customer,
    };
  }

  if (settings.services_config?.enable_customer_followup === false) {
    return {
      eligible: false,
      reason: 'Customer follow-up automation is disabled by merchant configuration',
      permitted_path: 'cancel_obsolete',
      action: 'cancel_obsolete',
      lead,
      job,
      customer,
    };
  }

  // Check 6: Outbound Guard (Tenant config, pilot whitelist, automation mode)
  const outboundGuard = validateOutboundDispatch({
    tenantId,
    senderEmail: ((settings as any).support_email || 'talhaishaqrabani9490@gmail.com') as string,
    recipientEmail: lead.customer_email,
    isAutomated: true,
    approvalStatus: 'none',
    pilotWhitelist: settings.pilot_whitelist as any,
    automationMode: settings.automation_mode,
  });

  if (outboundGuard.action === 'block') {
    return {
      eligible: false,
      reason: outboundGuard.reason,
      permitted_path: 'cancel_obsolete',
      action: 'cancel_obsolete',
      lead,
      job,
      customer,
    };
  }

  return {
    eligible: true,
    permitted_path: 'customer_followup',
    action: 'customer_followup',
    lead,
    job,
    customer,
  };
}

/**
 * Dispatches an automated or draft follow-up to the customer
 */
export async function dispatchServicesLeadFollowup(
  paramsOrTenantId:
    | {
        tenantId: string;
        leadId: string;
        jobId: string;
        customMessage?: string;
        message_body?: string;
        mock?: boolean;
        channel?: string;
      }
    | string,
  maybeLeadId?: string,
  maybeJobId?: string,
  maybeOptions?: {
    channel?: string;
    message_body?: string;
    customMessage?: string;
    mock?: boolean;
  }
): Promise<{
  success: boolean;
  dispatched: boolean;
  duplicate_prevented?: boolean;
  reminder_count?: number;
  messageId?: string;
  reason?: string;
}> {
  let tenantId: string;
  let leadId: string;
  let jobId: string;
  let customMessage: string | undefined;
  let isMock = false;

  if (typeof paramsOrTenantId === 'object') {
    tenantId = paramsOrTenantId.tenantId;
    leadId = paramsOrTenantId.leadId;
    jobId = paramsOrTenantId.jobId;
    customMessage = paramsOrTenantId.customMessage || paramsOrTenantId.message_body;
    isMock = Boolean(paramsOrTenantId.mock);
  } else {
    tenantId = paramsOrTenantId;
    leadId = maybeLeadId!;
    jobId = maybeJobId!;
    customMessage = maybeOptions?.customMessage || maybeOptions?.message_body;
    isMock = Boolean(maybeOptions?.mock);
  }

  // Immediate pre-dispatch safety verification
  const check = await inspectServicesLeadFollowupEligibility(tenantId, leadId, jobId);
  if (!check.eligible || check.permitted_path !== 'customer_followup') {
    return {
      success: false,
      dispatched: false,
      reason: check.reason || 'Lead not eligible for dispatch',
    };
  }

  const lead = check.lead!;
  const job = check.job!;

  // Must be in claimed status for dispatch. If already pending or completed, duplicate dispatch is blocked!
  if (job.status !== 'claimed') {
    return {
      success: true,
      dispatched: false,
      duplicate_prevented: true,
      reason: `Job is currently in '${job.status}' status (must be claimed for dispatch). Duplicate dispatch prevented.`,
      reminder_count: lead.reminder_count || job.attempt_count,
    };
  }
  const bizRows = await query<{ settings: any }>(
    `SELECT settings FROM iao.businesses WHERE tenant_id = $1;`,
    [tenantId]
  );
  const settings: BusinessSettings = bizRows[0]?.settings || {};
  const effectiveBizName = settings.display_name_override || settings.business_name || 'Our Team';

  // Format follow-up body text
  const bodyText = customMessage || (
    job.attempt_count === 0
      ? `Hi ${lead.customer_name},\n\nJust following up on your recent inquiry regarding ${lead.service_interest || 'our services'}. Please let us know if you have any questions or if you'd like to schedule a consultation with our team.\n\nBest regards,\n${effectiveBizName}`
      : `Hi ${lead.customer_name},\n\nWe wanted to check in one last time regarding your request for ${lead.service_interest || 'our services'}. If you still need assistance, feel free to reply directly to this message.\n\nBest regards,\n${effectiveBizName}`
  );

  const isAutoRoutine = settings.automation_mode === 'auto_routine';
  const newAttemptCount = job.attempt_count + 1;
  const msgId = `msg-fu-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;

  // Outbound Guard: Enforce pilot whitelist, recipient restriction, and approval mode
  const outboundGuard = validateOutboundDispatch({
    tenantId,
    senderEmail: ((settings as any).support_email || 'talhaishaqrabani9490@gmail.com') as string,
    recipientEmail: lead.customer_email,
    isAutomated: true,
    approvalStatus: 'none',
    pilotWhitelist: settings.pilot_whitelist as any,
    automationMode: settings.automation_mode,
  });

  if (outboundGuard.action === 'block') {
    return {
      success: false,
      dispatched: false,
      reason: outboundGuard.reason,
    };
  }

  const isDraftRequired = outboundGuard.action === 'draft_required' || !isAutoRoutine;
  const isDispatched = !isDraftRequired && (isAutoRoutine || isMock);

  let convId = lead.conversation_id;
  if (!convId) {
    // Create conversation if not attached
    convId = `conv-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
    await query(
      `INSERT INTO iao.conversations (id, tenant_id, customer_name, customer_email, customer_phone, channel, status, subject, unread, last_message_at)
       VALUES ($1, $2, $3, $4, $5, 'hosted_inquiry', 'open', $6, false, NOW());`,
      [convId, tenantId, lead.customer_name, lead.customer_email, lead.customer_phone || null, `Follow-up: ${lead.service_interest || 'Your Inquiry'}`]
    );
    await query(`UPDATE iao.services_leads SET conversation_id = $1 WHERE id = $2;`, [convId, leadId]);
  }

  // Idempotency: Protect against duplicate message dispatch for the same attempt of this job
  const existingMsg = await query<{ id: string }>(
    `SELECT id FROM iao.messages 
     WHERE tenant_id = $1 AND conversation_id = $2 
       AND (metadata->>'job_id' = $3) 
       AND (metadata->>'followup_attempt')::int = $4 
     LIMIT 1;`,
    [tenantId, convId, jobId, newAttemptCount]
  );
  if (existingMsg.length > 0) {
    return {
      success: true,
      dispatched: false,
      duplicate_prevented: true,
      messageId: existingMsg[0].id,
      reminder_count: lead.reminder_count || newAttemptCount,
    };
  }

  // Insert message (either live simulation or pending approval draft)
  await query(
    `INSERT INTO iao.messages (
      id, conversation_id, tenant_id, sender_type, sender_name, body, status, approval_status, metadata, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW());`,
    [
      msgId,
      convId,
      tenantId,
      isDispatched ? 'agent' : 'ai_draft',
      `${effectiveBizName} (AI Operator)`,
      bodyText,
      isDispatched ? 'simulated_demo' : 'draft',
      isDispatched ? 'none' : 'pending_approval',
      JSON.stringify({
        lead_id: leadId,
        job_id: jobId,
        followup_attempt: newAttemptCount,
        max_attempts: job.max_attempts,
        requires_approval_reason: isDraftRequired ? outboundGuard.reason : undefined,
      }),
    ]
  );

  // Update lead stage to 'contacted' if it was 'new' and increment reminder_count
  const leadUpdateRes = await query<{ reminder_count: number }>(
    `UPDATE iao.services_leads 
     SET stage = CASE WHEN stage = 'new' THEN 'contacted' ELSE stage END,
         reminder_count = COALESCE(reminder_count, 0) + 1,
         updated_at = NOW()
     WHERE id = $1
     RETURNING reminder_count;`,
    [leadId]
  );
  const currentReminderCount = leadUpdateRes[0]?.reminder_count || newAttemptCount;

  // Log timeline event
  await addServicesLeadEvent(tenantId, leadId, {
    event_type: isAutoRoutine || isMock ? 'followup_sent' : 'followup_drafted',
    actor_type: 'ai_operator',
    summary: isAutoRoutine || isMock
      ? `Automated follow-up #${newAttemptCount} dispatched to ${lead.customer_name}`
      : `Follow-up #${newAttemptCount} draft generated (pending owner review)`,
    details: { attempt: newAttemptCount, message_id: msgId, is_mock: isMock },
  });

  // Schedule next attempt if under max, otherwise automatically schedule escalation check after reply-wait period
  if (newAttemptCount < job.max_attempts) {
    const intervalHours = settings.services_config?.followup_interval_hours || 48;
    const nextScheduled = new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString();
    await query(
      `UPDATE iao.services_lead_followup_jobs 
       SET status = 'pending', attempt_count = $1, scheduled_for = $2, claimed_at = NULL, claimed_by = NULL, updated_at = NOW()
       WHERE id = $3;`,
      [newAttemptCount, nextScheduled, jobId]
    );
  } else {
    // Automatically schedule escalation check after the configured reply-wait period
    const replyWaitHours = (settings.services_config as any)?.reply_wait_hours
      ?? (settings.services_config as any)?.final_reply_wait_hours
      ?? settings.services_config?.followup_interval_hours
      ?? 48;
    const replyWaitMinutes = (settings.services_config as any)?.reply_wait_minutes ?? (replyWaitHours * 60);
    const escalationScheduled = new Date(Date.now() + replyWaitMinutes * 60 * 1000).toISOString();

    const escalationMetadata = JSON.stringify({
      phase: 'awaiting_reply_before_escalation',
      final_reminder_attempt: newAttemptCount,
    });

    await query(
      `UPDATE iao.services_lead_followup_jobs 
       SET status = 'pending', attempt_count = $1, scheduled_for = $2, claimed_at = NULL, claimed_by = NULL,
           metadata = metadata || $4::jsonb,
           updated_at = NOW()
       WHERE id = $3;`,
      [newAttemptCount, escalationScheduled, jobId, escalationMetadata]
    );

    await addServicesLeadEvent(tenantId, leadId, {
      event_type: 'final_followup_scheduled_for_escalation',
      actor_type: 'system',
      summary: `Final follow-up attempt #${newAttemptCount} completed. Escalation check automatically scheduled for ${escalationScheduled} (${replyWaitMinutes >= 60 ? (replyWaitMinutes / 60) + 'h' : replyWaitMinutes + 'm'} reply-wait period).`,
      details: { attempt: newAttemptCount, scheduled_for: escalationScheduled, phase: 'awaiting_reply_before_escalation' },
    });
  }

  return {
    success: true,
    dispatched: isAutoRoutine || isMock,
    reminder_count: currentReminderCount,
    messageId: msgId,
  };
}

/**
 * Escalates lead to business owner task when follow-ups are exhausted
 */
export async function escalateServicesLeadToOwner(
  paramsOrTenantId:
    | {
        tenantId: string;
        leadId: string;
        jobId?: string;
        reason: string;
      }
    | string,
  maybeLeadId?: string,
  maybeJobId?: string,
  maybeReason?: string
): Promise<{
  success: boolean;
  escalated: boolean;
  taskId: string;
  task_id: string;
  summary: string;
}> {
  let tenantId: string;
  let leadId: string;
  let jobId: string | undefined;
  let reason: string;

  if (typeof paramsOrTenantId === 'object') {
    tenantId = paramsOrTenantId.tenantId;
    leadId = paramsOrTenantId.leadId;
    jobId = paramsOrTenantId.jobId;
    reason = paramsOrTenantId.reason;
  } else {
    tenantId = paramsOrTenantId;
    leadId = maybeLeadId!;
    jobId = maybeJobId;
    reason = maybeReason || 'Owner review required';
  }

  const lead = await getServicesLead(tenantId, leadId);
  if (!lead) throw new Error(`Lead '${leadId}' not found.`);

  const taskId = `task_lead_${leadId}`;
  const summary = `Follow-up exhausted for ${lead.customer_name} (${lead.service_interest || 'Inquiry'}). Review and manual contact required.`;

  // Idempotency: Check if an active owner task already exists for this lead
  const existingCases = await query<{ case_id: string }>(
    `SELECT case_id FROM iao.cases 
     WHERE tenant_id = $1 AND kind = 'lead_escalation' AND (case_id = $2 OR payload->>'lead_id' = $3) AND status != 'rejected'
     LIMIT 1;`,
    [tenantId, taskId, leadId]
  );
  if (existingCases.length > 0) {
    const existingTaskId = existingCases[0].case_id;
    if (jobId) {
      await completeServicesLeadFollowupJob(jobId, 'escalated_to_owner', { task_id: existingTaskId, reason, duplicate_prevented: true });
    }
    return {
      success: true,
      escalated: true,
      taskId: existingTaskId,
      task_id: existingTaskId,
      summary: `Owner task already active for lead: ${existingTaskId}`,
    };
  }

  // Create owner task record in iao.cases
  await query(
    `INSERT INTO iao.cases (
      tenant_id, case_id, kind, status, payload, proposal, revision, created_at, updated_at
    ) VALUES ($1, $2, 'lead_escalation', 'pending_approval', $3::jsonb, $4::jsonb, 1, NOW(), NOW())
    ON CONFLICT (case_id) DO NOTHING;`,
    [
      tenantId,
      taskId,
      JSON.stringify({
        lead_id: leadId,
        customer_name: lead.customer_name,
        customer_email: lead.customer_email,
        service_interest: lead.service_interest,
        conversation_id: lead.conversation_id,
        reason,
      }),
      JSON.stringify({
        action: 'owner_manual_review',
        headline: `Manual outreach required for ${lead.customer_name}`,
        summary,
        responsible_party: 'owner',
      }),
    ]
  );

  // Update lead next action
  await updateServicesLead(tenantId, leadId, {
    next_action: `Owner review: ${reason}`,
  }, { type: 'system', name: 'Escalation Engine' });

  // Log timeline event
  await addServicesLeadEvent(tenantId, leadId, {
    event_type: 'escalated_to_owner',
    actor_type: 'system',
    summary: `Lead escalated to Owner task. Reason: ${reason}`,
    details: { task_id: taskId },
  });

  if (jobId) {
    await completeServicesLeadFollowupJob(jobId, 'escalated_to_owner', { task_id: taskId, reason });
  }

  return {
    success: true,
    escalated: true,
    taskId,
    task_id: taskId,
    summary,
  };
}

export async function cancelServicesLeadFollowup(
  paramsOrTenantId:
    | {
        tenantId: string;
        leadId: string;
        jobId?: string;
        reason: string;
      }
    | string,
  maybeLeadId?: string,
  maybeReason?: string
): Promise<{ cancelled: boolean }> {
  let tenantId: string;
  let leadId: string;
  let jobId: string | undefined;
  let reason: string;

  if (typeof paramsOrTenantId === 'object') {
    tenantId = paramsOrTenantId.tenantId;
    leadId = paramsOrTenantId.leadId;
    jobId = paramsOrTenantId.jobId;
    reason = paramsOrTenantId.reason;
  } else {
    tenantId = paramsOrTenantId;
    leadId = maybeLeadId!;
    reason = maybeReason || 'Manual cancellation';
  }

  if (jobId) {
    await query(
      `UPDATE iao.services_lead_followup_jobs 
       SET status = 'cancelled', last_error = $1, updated_at = NOW() 
       WHERE id = $2 AND tenant_id = $3 AND status IN ('pending', 'claimed');`,
      [reason, jobId, tenantId]
    );
  } else {
    await query(
      `UPDATE iao.services_lead_followup_jobs 
       SET status = 'cancelled', last_error = $1, updated_at = NOW() 
       WHERE lead_id = $2 AND tenant_id = $3 AND status IN ('pending', 'claimed');`,
      [reason, leadId, tenantId]
    );
  }

  return { cancelled: true };
}

export async function completeServicesLeadFollowupJob(
  jobId: string,
  outcomeOrDetails: string | { status?: string; outcome?: string; details?: Record<string, unknown> },
  maybeDetails?: Record<string, unknown>,
  tenantId?: string
): Promise<void> {
  let outcome = typeof outcomeOrDetails === 'string' ? outcomeOrDetails : (outcomeOrDetails.outcome || 'completed');
  let details = typeof outcomeOrDetails === 'string' ? maybeDetails || {} : outcomeOrDetails;

  const queryStr = tenantId
    ? `UPDATE iao.services_lead_followup_jobs 
       SET status = CASE WHEN status = 'pending' THEN 'pending' ELSE 'completed' END,
           metadata = metadata || $1::jsonb,
           updated_at = NOW() 
       WHERE id = $2 AND tenant_id = $3
       RETURNING id;`
    : `UPDATE iao.services_lead_followup_jobs 
       SET status = CASE WHEN status = 'pending' THEN 'pending' ELSE 'completed' END,
           metadata = metadata || $1::jsonb,
           updated_at = NOW() 
       WHERE id = $2
       RETURNING id;`;
  const params = tenantId
    ? [JSON.stringify({ outcome, completed_at: new Date().toISOString(), ...details }), jobId, tenantId]
    : [JSON.stringify({ outcome, completed_at: new Date().toISOString(), ...details }), jobId];

  const res = await query(queryStr, params);
  if (tenantId && res.length === 0) {
    throw new Error(`Followup job '${jobId}' not found for tenant '${tenantId}'.`);
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getBusiness, updateBusinessSettings, getDefaultBusinessSettings, recordAuditLog } from '@/lib/db';
import { sanitizeAutomationPermissions } from '@/lib/permissions';
import { submitOnboarding, N8nApiError } from '@/lib/n8n';
import { BusinessSettings, IndustryType, BusinessType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const url = new URL(request.url);
    const requestedTenant = url.searchParams.get('tenant') || url.searchParams.get('tenant_id');

    // Strict server-side authorization: never allow unauthorized access to another tenant
    const authCheck = await requireWorkspaceAccess(session, requestedTenant || undefined);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden: Workspace access denied.' }, { status: 403 });
    }

    const tenantId = authCheck.tenantId;

    let businessRecord = await getBusiness(tenantId);
    if (!businessRecord) {
      const defaults = getDefaultBusinessSettings(tenantId);
      businessRecord = await updateBusinessSettings(tenantId, defaults);
    }

    return NextResponse.json({
      business: businessRecord,
      tenant_id: tenantId,
      public_form_id: businessRecord.public_form_id,
      approver_id: session.user_id,
      session: {
        ...session,
        active_tenant_id: tenantId,
        role: authCheck.role,
      },
      exists_in_db: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve business settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const body = await request.json().catch(() => ({}));

    // If client supplied tenant_id in body, verify authorization
    const requestedTenant = typeof body.tenant_id === 'string' ? body.tenant_id.trim() : undefined;
    const authCheck = await requireWorkspaceAccess(session, requestedTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden: Workspace access denied.' }, { status: 403 });
    }

    const tenantId = authCheck.tenantId;

    if (authCheck.role === 'member') {
      return NextResponse.json(
        { error: 'Forbidden: Only owners and admins can modify business configuration.' },
        { status: 403 }
      );
    }

    const existing = await getBusiness(tenantId);
    const currentSettings = existing?.settings || getDefaultBusinessSettings(tenantId);

    // 1. Business Profile
    const business_name = typeof body.business_name === 'string' && body.business_name.trim()
      ? body.business_name.trim()
      : currentSettings.business_name;

    const industry = (body.industry as IndustryType) || currentSettings.industry || 'services';
    const business_type = (body.business_type as BusinessType) || currentSettings.business_type || (industry === 'ecommerce' ? 'ecommerce' : industry === 'blog' ? 'blog' : 'services');
    const country = body.country || currentSettings.country || 'United States';
    const timezone = body.timezone || currentSettings.timezone || 'UTC';
    const currency = body.currency || currentSettings.currency || 'USD';
    const language = body.language || currentSettings.language || 'English';
    const website_url = typeof body.website_url === 'string' ? body.website_url.trim() : currentSettings.website_url;
    const contact_email = typeof body.contact_email === 'string' ? body.contact_email.trim() : currentSettings.contact_email;
    const contact_phone = typeof body.contact_phone === 'string' ? body.contact_phone.trim() : currentSettings.contact_phone;

    const tone = (typeof body.tone === 'string' && body.tone.trim())
      ? body.tone.trim()
      : currentSettings.tone;

    const working_hours = {
      start_time: body.working_hours?.start_time || currentSettings.working_hours?.start_time || '09:00',
      end_time: body.working_hours?.end_time || currentSettings.working_hours?.end_time || '18:00',
      days: Array.isArray(body.working_hours?.days) ? body.working_hours.days : currentSettings.working_hours?.days || ['mon', 'tue', 'wed', 'thu', 'fri'],
      auto_reply_outside_hours: body.working_hours?.auto_reply_outside_hours ?? currentSettings.working_hours?.auto_reply_outside_hours ?? true,
    };

    // 2. Automation Permissions (strictly sanitized to enforce safety locks)
    const permissions = sanitizeAutomationPermissions(body.permissions || currentSettings.permissions);

    // 3. Team & Approvers
    const team_members = Array.isArray(body.team_members)
      ? body.team_members
      : currentSettings.team_members;

    const approver_ids = Array.isArray(body.approver_ids)
      ? body.approver_ids
      : currentSettings.approver_ids;

    // 4. Connections
    const incomingWebsite = body.connections?.website || {};
    const websiteChanged =
      incomingWebsite.store_url !== undefined &&
      incomingWebsite.store_url !== currentSettings.connections?.website?.store_url;
    const websiteTypeChanged =
      incomingWebsite.type !== undefined &&
      incomingWebsite.type !== currentSettings.connections?.website?.type;

    const incomingEmail = body.connections?.email || {};
    const emailChanged =
      (incomingEmail.sender_email !== undefined && incomingEmail.sender_email !== currentSettings.connections?.email?.sender_email) ||
      (incomingEmail.provider !== undefined && incomingEmail.provider !== currentSettings.connections?.email?.provider);

    const connections = {
      website: {
        ...(currentSettings.connections?.website || {}),
        ...incomingWebsite,
        hosted_inquiry_enabled: incomingWebsite.hosted_inquiry_enabled ?? currentSettings.connections?.website?.hosted_inquiry_enabled ?? true,
        ...(websiteChanged || websiteTypeChanged ? { is_verified: incomingWebsite.type === 'no_website', status: incomingWebsite.type === 'no_website' ? 'connected' : 'not_connected' } : {}),
      },
      email: {
        ...(currentSettings.connections?.email || {}),
        ...incomingEmail,
        ...(emailChanged ? { is_verified: false, status: 'not_connected' } : {}),
      },
      whatsapp: {
        provider: 'none' as const,
        status: 'not_implemented' as const,
        is_verified: false,
      },
    };

    // 5. Knowledge & Policies
    const returnWindowDays = Number(body.knowledge?.policies?.return_window_days ?? body.return_window_days ?? currentSettings.return_window_days ?? 14);

    const knowledge = {
      faqs: Array.isArray(body.knowledge?.faqs) ? body.knowledge.faqs : (currentSettings.knowledge?.faqs || []),
      products_services: Array.isArray(body.knowledge?.products_services)
        ? body.knowledge.products_services
        : (currentSettings.knowledge?.products_services || []),
      services: Array.isArray(body.knowledge?.services)
        ? body.knowledge.services
        : (currentSettings.knowledge?.services || []),
      service_areas: Array.isArray(body.knowledge?.service_areas)
        ? body.knowledge.service_areas
        : (currentSettings.knowledge?.service_areas || []),
      extracted_facts: Array.isArray(body.knowledge?.extracted_facts)
        ? body.knowledge.extracted_facts
        : (currentSettings.knowledge?.extracted_facts || []),
      policies: {
        ...(currentSettings.knowledge?.policies || {}),
        ...(body.knowledge?.policies || {}),
        return_window_days: returnWindowDays,
      },
    };

    // 6. Automation Mode
    const automation_mode = (['draft_only', 'auto_routine', 'paused'].includes(body.automation_mode))
      ? body.automation_mode
      : (currentSettings.automation_mode || 'auto_routine');

    // 7. Order Issues Configuration (E-commerce)
    const incomingOrderIssuesConfig = body.order_issues_config || {};
    const defaultOrderIssues = currentSettings.order_issues_config || {
      followup_interval_hours: 24,
      clarification_delay_minutes: 1440,
      carrier_check_interval_minutes: 360,
      max_followup_attempts: 2,
      auto_escalate_to_owner: true,
      owner_reminder_interval_minutes: 1440,
      auto_close_resolved_days: 7,
    };

    const order_issues_config = {
      followup_interval_hours: Math.max(
        1,
        Number(incomingOrderIssuesConfig.followup_interval_hours ?? defaultOrderIssues.followup_interval_hours ?? 24)
      ),
      clarification_delay_minutes: Math.max(
        1,
        Number(incomingOrderIssuesConfig.clarification_delay_minutes ?? defaultOrderIssues.clarification_delay_minutes ?? 1440)
      ),
      carrier_check_interval_minutes: Math.max(
        1,
        Number(incomingOrderIssuesConfig.carrier_check_interval_minutes ?? defaultOrderIssues.carrier_check_interval_minutes ?? 360)
      ),
      max_followup_attempts: Math.max(
        1,
        Math.min(10, Number(incomingOrderIssuesConfig.max_followup_attempts ?? defaultOrderIssues.max_followup_attempts ?? 2))
      ),
      auto_escalate_to_owner: incomingOrderIssuesConfig.auto_escalate_to_owner !== undefined
        ? Boolean(incomingOrderIssuesConfig.auto_escalate_to_owner)
        : (defaultOrderIssues.auto_escalate_to_owner ?? true),
      owner_reminder_interval_minutes: Math.max(
        1,
        Number(incomingOrderIssuesConfig.owner_reminder_interval_minutes ?? defaultOrderIssues.owner_reminder_interval_minutes ?? 1440)
      ),
      auto_close_resolved_days: Math.max(
        1,
        Number(incomingOrderIssuesConfig.auto_close_resolved_days ?? defaultOrderIssues.auto_close_resolved_days ?? 7)
      ),
    };

    // 8. Services Configuration (Services Pack)
    const incomingServicesConfig = body.services_config || {};
    const defaultServicesConfig = currentSettings.services_config || {
      enable_customer_followup: false,
      followup_interval_hours: 24,
      max_followup_attempts: 2,
      auto_escalate_to_owner: true,
      require_quote_approval: true,
    };

    const services_config = {
      enable_customer_followup: Boolean(incomingServicesConfig.enable_customer_followup ?? defaultServicesConfig.enable_customer_followup ?? false),
      followup_interval_hours: Math.max(1, Number(incomingServicesConfig.followup_interval_hours ?? defaultServicesConfig.followup_interval_hours ?? 24)),
      max_followup_attempts: Math.max(1, Math.min(10, Number(incomingServicesConfig.max_followup_attempts ?? defaultServicesConfig.max_followup_attempts ?? 2))),
      auto_escalate_to_owner: incomingServicesConfig.auto_escalate_to_owner !== undefined
        ? Boolean(incomingServicesConfig.auto_escalate_to_owner)
        : (defaultServicesConfig.auto_escalate_to_owner ?? true),
      require_quote_approval: true, // Permanent safety lock: quotes always require owner approval
    };

    // 9. Onboarding State
    const onboarding = body.onboarding ? {
      ...currentSettings.onboarding,
      ...body.onboarding,
      business_type,
    } : currentSettings.onboarding;

    const newSettings: BusinessSettings = {
      industry,
      business_type,
      business_name,
      country,
      timezone,
      currency,
      language,
      tone,
      working_hours,
      website_url,
      contact_email,
      contact_phone,
      public_form_id: existing?.public_form_id || currentSettings.public_form_id,
      automation_mode,
      permissions,
      team_members,
      approver_ids,
      connections,
      knowledge,
      order_issues_config,
      services_config,
      onboarding,
      return_window_days: returnWindowDays,
      refund_requires_approval: true, // Permanent hard safety lock
      mode: 'demo',
    };

    // Save directly to PostgreSQL
    const savedRecord = await updateBusinessSettings(tenantId, newSettings);

    // Record audit event
    await recordAuditLog(tenantId, 'settings_updated', {
      user_id: session.user_id,
      user_name: session.user_name,
      updated_fields: Object.keys(body),
      business_name,
      industry,
      business_type,
    });

    // Notify n8n onboarding webhook if available
    try {
      await submitOnboarding(newSettings);
    } catch (n8nErr) {
      console.warn('[n8n onboarding sync notice]', n8nErr instanceof Error ? n8nErr.message : n8nErr);
    }

    return NextResponse.json({
      success: true,
      business: savedRecord,
      tenant_id: tenantId,
      public_form_id: savedRecord.public_form_id,
      message: 'Business configuration persisted successfully.',
    });
  } catch (error: unknown) {
    if (error instanceof N8nApiError) {
      return NextResponse.json(
        { error: error.message, details: error.data },
        { status: error.status }
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to save business settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

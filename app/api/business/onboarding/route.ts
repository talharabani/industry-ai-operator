import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, requireWorkspaceAccess } from '@/lib/auth';
import { getBusiness, updateBusinessSettings } from '@/lib/db';
import { BusinessSettings, BusinessType, IndustryType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const url = new URL(request.url);
    const targetTenant = url.searchParams.get('tenant') || session.active_tenant_id;

    const authCheck = await requireWorkspaceAccess(session, targetTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden' }, { status: 403 });
    }

    const business = await getBusiness(authCheck.tenantId);
    if (!business) {
      return NextResponse.json({ error: 'Business workspace not found' }, { status: 404 });
    }

    const settings: BusinessSettings = business.settings;
    const onboarding = settings.onboarding || {
      step: 1,
      completed: false,
      business_type: settings.business_type || (settings.industry as any) || 'services',
    };

    // Calculate onboarding checklist items
    const hasProfile = Boolean(settings.business_name && settings.timezone && (settings.contact_email || settings.support_email));
    const hasServices = (settings.knowledge?.services || []).filter((s) => s.approval_status === 'approved').length > 0 || (settings.knowledge?.products_services || []).length > 0;
    const hasHours = Boolean(settings.working_hours?.start_time && settings.working_hours?.end_time);
    const hasConnection = settings.connections?.website?.status === 'connected' || Boolean(business.gmail_connection?.google_email) || settings.connections?.website?.hosted_inquiry_enabled !== false;
    const isCompleted = Boolean(onboarding.completed);

    const checklist = [
      { id: 'profile', title: 'Business Profile', done: hasProfile },
      { id: 'type', title: 'Business Type & Pack', done: Boolean(settings.business_type) },
      { id: 'services', title: 'Knowledge & Services', done: hasServices || hasHours },
      { id: 'connections', title: 'Channels & Inquiries', done: hasConnection },
      { id: 'automation', title: 'Automation Preferences', done: Boolean(settings.automation_mode) },
    ];

    return NextResponse.json({
      tenant_id: authCheck.tenantId,
      business_name: settings.business_name,
      business_type: settings.business_type || 'services',
      industry: settings.industry,
      public_form_id: business.public_form_id,
      onboarding: {
        ...onboarding,
        checklist,
        all_done: checklist.every((c) => c.done),
        is_completed: isCompleted,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve onboarding state';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const body = await request.json().catch(() => ({}));
    const targetTenant = body.tenant_id ? String(body.tenant_id).trim() : session.active_tenant_id;

    const authCheck = await requireWorkspaceAccess(session, targetTenant);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error || 'Forbidden' }, { status: 403 });
    }

    if (authCheck.role === 'member') {
      return NextResponse.json({ error: 'Only owners and admins can complete onboarding.' }, { status: 403 });
    }

    const business = await getBusiness(authCheck.tenantId);
    if (!business) {
      return NextResponse.json({ error: 'Business workspace not found' }, { status: 404 });
    }

    const currentSettings = business.settings;
    const step = typeof body.step === 'number' ? body.step : (currentSettings.onboarding?.step || 1);
    const completed = Boolean(body.completed ?? currentSettings.onboarding?.completed ?? false);

    const updatedOnboarding = {
      ...currentSettings.onboarding,
      step,
      completed,
      completed_at: completed ? new Date().toISOString() : currentSettings.onboarding?.completed_at,
      business_type: body.business_type || currentSettings.business_type,
      website_url: body.website_url || currentSettings.website_url,
      contact_email: body.contact_email || currentSettings.contact_email,
      contact_phone: body.contact_phone || currentSettings.contact_phone,
    };

    const updatedSettings: BusinessSettings = {
      ...currentSettings,
      business_name: body.business_name || currentSettings.business_name,
      business_type: (body.business_type as BusinessType) || currentSettings.business_type,
      industry: (body.industry as IndustryType) || currentSettings.industry,
      website_url: body.website_url !== undefined ? body.website_url : currentSettings.website_url,
      timezone: body.timezone || currentSettings.timezone,
      language: body.language || currentSettings.language,
      contact_email: body.contact_email || currentSettings.contact_email,
      contact_phone: body.contact_phone !== undefined ? body.contact_phone : currentSettings.contact_phone,
      automation_mode: body.automation_mode || currentSettings.automation_mode || 'auto_routine',
      onboarding: updatedOnboarding,
    };

    if (body.services_config) {
      updatedSettings.services_config = {
        ...currentSettings.services_config,
        ...body.services_config,
        require_quote_approval: true,
      };
    }

    if (body.working_hours) {
      updatedSettings.working_hours = {
        ...currentSettings.working_hours,
        ...body.working_hours,
      };
    }

    if (body.policies || body.knowledge?.policies) {
      const incomingPolicies = body.policies || body.knowledge?.policies;
      updatedSettings.knowledge = {
        ...currentSettings.knowledge,
        policies: {
          ...(currentSettings.knowledge?.policies || {}),
          ...incomingPolicies,
        },
      };
    }

    const saved = await updateBusinessSettings(authCheck.tenantId, updatedSettings);

    return NextResponse.json({
      success: true,
      tenant_id: authCheck.tenantId,
      onboarding: updatedOnboarding,
      business: saved,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update onboarding';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

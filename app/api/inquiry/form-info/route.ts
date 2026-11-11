import { NextRequest, NextResponse } from 'next/server';
import { getBusiness, getBusinessByPublicFormId } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const identifier =
      url.searchParams.get('id') ||
      url.searchParams.get('form_id') ||
      url.searchParams.get('tenant') ||
      url.searchParams.get('tenant_id');

    if (!identifier || !identifier.trim()) {
      return NextResponse.json({ error: 'Form identifier is required.' }, { status: 400 });
    }

    const cleanId = identifier.trim();
    let business = await getBusinessByPublicFormId(cleanId);
    if (!business) {
      business = await getBusiness(cleanId);
    }

    if (!business) {
      return NextResponse.json({ error: 'Business portal not found.' }, { status: 404 });
    }

    const settings = business.settings;
    const isHostedEnabled = settings.connections?.website?.hosted_inquiry_enabled !== false;

    // Filter only merchant-approved services
    const approvedServices = (settings.knowledge?.services || [])
      .filter((s) => s.approval_status === 'approved' && s.is_active !== false)
      .map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        price_type: s.price_type,
        price: s.price,
        currency: s.currency || settings.currency || 'USD',
      }));

    const serviceAreas = (settings.knowledge?.service_areas || [])
      .filter((a) => a.is_active !== false)
      .map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
      }));

    // Safe public representation - zero secrets exposed
    return NextResponse.json({
      tenant_id: business.tenant_id,
      public_form_id: business.public_form_id,
      business_name: settings.business_name,
      industry: settings.industry,
      business_type: settings.business_type || 'services',
      hosted_inquiry_enabled: isHostedEnabled,
      services: approvedServices,
      service_areas: serviceAreas,
      working_hours: settings.working_hours,
      timezone: settings.timezone,
      currency: settings.currency || 'USD',
      collect_location: serviceAreas.length > 0,
      collect_budget: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve form details';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

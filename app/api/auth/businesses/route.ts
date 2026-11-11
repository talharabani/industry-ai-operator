import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthSession, encodeSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth';
import { createBusinessWorkspace } from '@/lib/services-pack';
import { query } from '@/lib/db';
import { IndustryType, BusinessType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getAuthSession();

    return NextResponse.json({
      active_tenant_id: session.active_tenant_id,
      businesses: session.businesses,
      user_id: session.user_id,
      user_name: session.user_name,
      role: session.role,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to list businesses';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session.user_id) {
      return NextResponse.json({ error: 'Unauthorized: Please sign in before creating a workspace.' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      business_name,
      industry = 'services',
      business_type,
      website_url,
      timezone = 'UTC',
      language = 'English',
      country = 'United States',
      currency = 'USD',
      contact_email,
      contact_phone,
    } = body;

    if (!business_name || typeof business_name !== 'string' || !business_name.trim()) {
      return NextResponse.json({ error: 'Business name is required.' }, { status: 400 });
    }

    const cleanName = business_name.trim();
    const resolvedType: BusinessType = business_type || (industry === 'ecommerce' ? 'ecommerce' : industry === 'blog' ? 'blog' : 'services');
    const resolvedIndustry: IndustryType = (industry as IndustryType) || (resolvedType === 'ecommerce' ? 'ecommerce' : resolvedType === 'blog' ? 'blog' : 'services');

    const baseSlug = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `biz-${Date.now().toString(36)}`;

    let slug = baseSlug;
    try {
      const existing = await query<{ tenant_id: string }>(
        `SELECT tenant_id FROM iao.businesses WHERE tenant_id = $1 LIMIT 1;`,
        [baseSlug]
      );
      if (existing.length > 0) {
        slug = `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`;
      }
    } catch {
      // If DB check fails, proceed with unique suffix safety if needed
    }

    // Create the business workspace and register authenticated user as owner
    const businessRecord = await createBusinessWorkspace({
      tenantId: slug,
      businessName: cleanName,
      industry: resolvedIndustry,
      businessType: resolvedType,
      ownerUserId: session.user_id,
      ownerEmail: session.email,
      ownerName: session.user_name,
      websiteUrl: typeof website_url === 'string' ? website_url.trim() : undefined,
      timezone,
      language,
      country,
      currency,
      contactEmail: typeof contact_email === 'string' ? contact_email.trim() : session.email,
      contactPhone: typeof contact_phone === 'string' ? contact_phone.trim() : undefined,
    });

    // Update session to switch to the newly created business workspace
    const updatedSession = {
      ...session,
      active_tenant_id: slug,
      role: 'owner' as const,
    };

    const cookieValue = encodeSessionCookie(updatedSession);
    const response = NextResponse.json({
      success: true,
      tenant_id: slug,
      public_form_id: businessRecord.public_form_id,
      business_name: cleanName,
      industry: resolvedIndustry,
      business_type: resolvedType,
      business: businessRecord,
    }, { status: 201 });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: cookieValue,
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create business';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

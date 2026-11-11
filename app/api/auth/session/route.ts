import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, encodeSessionCookie, SESSION_COOKIE_NAME, verifyUserWorkspaceMembership } from '@/lib/auth';
import { getBusiness } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getAuthSession();
    return NextResponse.json({
      authenticated: true,
      session,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to retrieve session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { tenant_id } = body;

    if (!tenant_id || typeof tenant_id !== 'string' || !tenant_id.trim()) {
      return NextResponse.json({ error: 'Field "tenant_id" is required.' }, { status: 400 });
    }

    const cleanTenantId = tenant_id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const currentSession = await getAuthSession();

    // 1. Verify existence of business workspace
    const business = await getBusiness(cleanTenantId);
    if (!business) {
      return NextResponse.json(
        { error: `Business workspace '${cleanTenantId}' not found.` },
        { status: 404 }
      );
    }

    // 2. Strict Server-Side Workspace Membership Authorization Gate
    // Never trust a browser-supplied tenant_id without verifying membership
    const membership = await verifyUserWorkspaceMembership(
      currentSession.user_id,
      currentSession.email,
      cleanTenantId
    );

    if (!membership.authorized) {
      return NextResponse.json(
        {
          error: `Forbidden: User '${currentSession.email}' does not have membership in workspace '${cleanTenantId}'. Cross-workspace access is denied.`,
        },
        { status: 403 }
      );
    }

    // 3. Authorized switch: update session cookie with verified role for this workspace
    const updatedSession = {
      ...currentSession,
      active_tenant_id: cleanTenantId,
      role: membership.role || 'member',
    };

    const cookieValue = encodeSessionCookie(updatedSession);
    const response = NextResponse.json({
      success: true,
      active_tenant_id: cleanTenantId,
      role: updatedSession.role,
      business_name: business.settings.business_name,
      session: updatedSession,
    });

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
    const message = error instanceof Error ? error.message : 'Failed to switch business';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

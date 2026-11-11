import { NextRequest, NextResponse } from 'next/server';
import { verifyUserCredential } from '@/lib/auth-credentials';
import { encodeSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { email, password } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email address is required.' }, { status: 400 });
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required.' }, { status: 400 });
    }

    // Authoritative credential verification (Checks scrypt hash in PostgreSQL)
    const verification = await verifyUserCredential(email, password);

    if (!verification.success || !verification.user) {
      return NextResponse.json(
        { error: verification.error || 'Invalid email or password.' },
        { status: 401 }
      );
    }

    const { user_id: userId, email: cleanEmail } = verification.user;

    // Fetch user profile / membership details
    const memberRows = await query<{
      tenant_id: string;
      name: string | null;
      role: string;
    }>(
      `SELECT tenant_id, name, role 
       FROM iao.business_members 
       WHERE LOWER(email) = LOWER($1) 
       ORDER BY created_at ASC 
       LIMIT 1;`,
      [cleanEmail]
    );

    const userName = memberRows[0]?.name || cleanEmail.split('@')[0];
    const userRole = (memberRows[0]?.role as 'owner' | 'admin' | 'member') || 'owner';
    const activeTenantId = memberRows[0]?.tenant_id || '';

    const sessionPayload = {
      active_tenant_id: activeTenantId,
      user_id: userId,
      user_name: userName,
      email: cleanEmail,
      role: userRole,
    };

    const cookieValue = encodeSessionCookie(sessionPayload);

    const response = NextResponse.json({
      success: true,
      user: {
        user_id: userId,
        user_name: userName,
        email: cleanEmail,
        role: userRole,
      },
      active_tenant_id: activeTenantId,
      message: `Successfully authenticated as ${userName}`,
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
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

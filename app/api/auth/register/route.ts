import { NextRequest, NextResponse } from 'next/server';
import { encodeSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth';
import { registerUserCredential, userCredentialExists } from '@/lib/auth-credentials';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { user_name, email, password } = body;

    if (!user_name || typeof user_name !== 'string' || !user_name.trim()) {
      return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email address is required.' }, { status: 400 });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'A secure password of at least 8 characters is required to establish owner identity.' },
        { status: 400 }
      );
    }

    const cleanName = user_name.trim();
    const cleanEmail = email.trim().toLowerCase();

    // Check if account already exists: Prevents getting an existing owner's session via register endpoint
    const exists = await userCredentialExists(cleanEmail);
    if (exists) {
      return NextResponse.json(
        { error: 'An account with this email address already exists. Please sign in with your password.' },
        { status: 409 }
      );
    }

    const isStaging = process.env.STAGING === 'true' || process.env.DISABLE_DEMO_AUTH === 'true';
    if (isStaging) {
      const inviteKey = request.headers.get('x-staging-auth-key') || body.staging_key;
      const expectedKey = process.env.STAGING_AUTH_KEY || process.env.CRON_SECRET;
      if (expectedKey && (!inviteKey || inviteKey !== expectedKey)) {
        return NextResponse.json(
          { error: 'Forbidden: Staging registration requires an authorized invite key.' },
          { status: 403 }
        );
      }
    }

    const userSlug = cleanEmail.split('@')[0].replace(/[^a-z0-9_-]/g, '-');
    const userId = `owner-${userSlug}`;

    // Securely hash password with scrypt and persist in PostgreSQL credentials store
    const regResult = await registerUserCredential(userId, cleanEmail, password);
    if (!regResult.success) {
      return NextResponse.json({ error: regResult.error || 'Failed to register credentials.' }, { status: 400 });
    }

    const newSession = {
      active_tenant_id: '',
      user_id: userId,
      user_name: cleanName,
      email: cleanEmail,
      role: 'owner' as const,
    };

    const cookieValue = encodeSessionCookie(newSession);

    const response = NextResponse.json({
      success: true,
      user: {
        user_id: userId,
        user_name: cleanName,
        email: cleanEmail,
        role: 'owner',
      },
      message: `Signed in as business owner: ${cleanName}`,
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
    const message = error instanceof Error ? error.message : 'Registration failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE_NAME = 'iao_session';

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/inquiry',
  '/api',
  '/_next',
  '/favicon.ico',
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip public routes and static assets
  if (
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const isSecureMode =
    process.env.NODE_ENV === 'production' ||
    process.env.STAGING === 'true' ||
    process.env.DISABLE_DEMO_AUTH === 'true';

  if (isSecureMode) {
    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!sessionCookie) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

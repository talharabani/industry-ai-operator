import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getShopifyOAuthConfig, sanitizeShopDomain, buildShopifyAuthUrl } from '@/lib/shopify-service';
import { saveOAuthState } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    const tenantId = session.active_tenant_id;

    if (session.role === 'member') {
      return NextResponse.json(
        { error: 'Forbidden: Only business owners and administrators can connect Shopify stores.' },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const rawShop = searchParams.get('shop') || '';
    const cleanShop = sanitizeShopDomain(rawShop);

    if (!cleanShop) {
      return NextResponse.json(
        {
          error: 'Invalid Shopify domain. Please provide a valid store domain (e.g. your-store.myshopify.com).',
        },
        { status: 400 }
      );
    }

    const origin = request.nextUrl.origin;
    const config = getShopifyOAuthConfig(origin);

    if (!config) {
      return NextResponse.json(
        {
          error:
            'Shopify App credentials are not configured on this server. Please set SHOPIFY_API_KEY and SHOPIFY_API_SECRET in .env.local.',
          configured: false,
        },
        { status: 503 }
      );
    }

    // Generate single-use expiring state nonce
    const state = `sh_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await saveOAuthState({
      state,
      tenant_id: tenantId,
      user_id: session.user_id,
      code_verifier: cleanShop, // Store the target clean shop in code_verifier field for verification on callback
      redirect_uri: config.redirectUri,
      expires_at: expiresAt,
    });

    const authUrl = buildShopifyAuthUrl({
      shop: cleanShop,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      state,
    });

    // If request asks for json or via fetch
    const wantsJson = request.headers.get('accept')?.includes('application/json');
    if (wantsJson) {
      return NextResponse.json({
        success: true,
        shop: cleanShop,
        url: authUrl,
      });
    }

    return NextResponse.redirect(authUrl);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to initialize Shopify OAuth';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

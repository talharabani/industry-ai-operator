import { NextRequest, NextResponse } from 'next/server';
import { getAndConsumeOAuthState, saveShopifyConnection, createShopifySyncJob } from '@/lib/db';
import {
  getShopifyOAuthConfig,
  verifyShopifyHmac,
  exchangeShopifyCodeForAccessToken,
  fetchShopifyShopInfo,
  sanitizeShopDomain,
} from '@/lib/shopify-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const baseUrl = request.nextUrl.origin;

  const code = searchParams.get('code');
  const rawShop = searchParams.get('shop') || '';
  const state = searchParams.get('state');
  const hmac = searchParams.get('hmac');

  const cleanShop = sanitizeShopDomain(rawShop);

  if (!code || !cleanShop || !state || !hmac) {
    return NextResponse.redirect(
      new URL('/settings?tab=integrations&error=Missing+required+Shopify+OAuth+parameters', baseUrl)
    );
  }

  const config = getShopifyOAuthConfig(baseUrl);
  if (!config) {
    return NextResponse.redirect(
      new URL('/settings?tab=integrations&error=Shopify+App+credentials+not+configured+on+platform', baseUrl)
    );
  }

  // 1. Verify Shopify HMAC signature
  const queryObj: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    queryObj[key] = value;
  });

  const isHmacValid = verifyShopifyHmac(queryObj, config.clientSecret);
  if (!isHmacValid) {
    console.error('[Shopify OAuth Error] Invalid HMAC signature for shop:', cleanShop);
    return NextResponse.redirect(
      new URL('/settings?tab=integrations&error=Shopify+HMAC+verification+failed.+Possible+tampering+detected.', baseUrl)
    );
  }

  // 2. Consume and validate expiring single-use state
  const oauthState = await getAndConsumeOAuthState(state);
  if (!oauthState) {
    return NextResponse.redirect(
      new URL('/settings?tab=integrations&error=Invalid+or+expired+OAuth+session.+Please+try+connecting+again.', baseUrl)
    );
  }

  const tenantId = oauthState.tenant_id;

  try {
    // 3. Exchange authorization code for access token
    const tokenResult = await exchangeShopifyCodeForAccessToken({
      shop: cleanShop,
      code,
      config,
    });

    // 4. Fetch store details from Shopify
    const shopInfo = await fetchShopifyShopInfo({
      shop: cleanShop,
      accessToken: tokenResult.accessToken,
      apiVersion: config.apiVersion,
    });

    // 5. Store connection with AES-256-GCM encrypted access token
    await saveShopifyConnection(tenantId, {
      shop_domain: cleanShop,
      access_token: tokenResult.accessToken,
      scope: tokenResult.scope,
      store_info: shopInfo,
    });

    // 6. Create initial sync job
    try {
      await createShopifySyncJob({
        tenantId,
        shopDomain: cleanShop,
        syncTypes: ['products', 'inventory', 'policies', 'orders'],
      });
    } catch (syncErr) {
      console.warn('[Initial Shopify sync job creation notice]', syncErr);
    }

    return NextResponse.redirect(
      new URL(`/settings?tab=integrations&shopify_connected=${encodeURIComponent(cleanShop)}`, baseUrl)
    );
  } catch (error: unknown) {
    console.error('[Shopify OAuth Callback Error]', error);
    const message = error instanceof Error ? error.message : 'Failed to complete Shopify connection';
    return NextResponse.redirect(
      new URL(`/settings?tab=integrations&error=${encodeURIComponent(message)}`, baseUrl)
    );
  }
}

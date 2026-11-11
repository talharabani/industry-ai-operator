import type { SocialAdapter, ProviderPublishResult, ProviderConfigValidation } from './types.ts';
import type { SocialDestination, SocialPostRecord } from '../social-types.ts';

export class FacebookAdapter implements SocialAdapter {
  platform = 'facebook' as const;

  private getAppCredentials() {
    const clientId = process.env.FACEBOOK_CLIENT_ID || process.env.META_APP_ID;
    const clientSecret = process.env.FACEBOOK_CLIENT_SECRET || process.env.META_APP_SECRET;
    return { clientId, clientSecret };
  }

  validateConfiguration(): ProviderConfigValidation {
    const { clientId, clientSecret } = this.getAppCredentials();
    const missingKeys: string[] = [];
    if (!clientId) missingKeys.push('FACEBOOK_CLIENT_ID (or META_APP_ID)');
    if (!clientSecret) missingKeys.push('FACEBOOK_CLIENT_SECRET (or META_APP_SECRET)');

    return {
      is_configured: missingKeys.length === 0,
      missing_keys: missingKeys,
      setup_guide: {
        title: 'Meta App Setup for Facebook Pages',
        description:
          'To connect Facebook Pages and publish posts automatically, register an app on developers.facebook.com with Facebook Login for Business and Pages API permissions.',
        doc_url: 'https://developers.facebook.com/docs/pages-api/getting-started',
        required_scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'public_profile'],
        steps: [
          'Create a Meta App of type "Business" on developers.facebook.com.',
          'Add Facebook Login for Business and configure your OAuth Redirect URI: /api/social/connections/oauth/facebook/callback.',
          'Request Advanced Access or add test users for permissions: pages_show_list, pages_read_engagement, pages_manage_posts.',
          'Copy your App ID and App Secret into .env.local as FACEBOOK_CLIENT_ID and FACEBOOK_CLIENT_SECRET.',
        ],
      },
    };
  }

  async getAuthorizationUrl(tenantId: string, redirectUri: string, stateToken: string): Promise<string> {
    const { clientId } = this.getAppCredentials();
    if (!clientId) {
      throw new Error('FACEBOOK_CLIENT_ID is not configured on the server. Please complete setup in .env.local.');
    }

    const scopes = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'public_profile'].join(',');
    const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', stateToken);
    url.searchParams.set('scope', scopes);
    url.searchParams.set('response_type', 'code');
    return url.toString();
  }

  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    account_id: string;
    account_name: string;
    account_handle?: string;
    available_destinations: SocialDestination[];
    scopes: string[];
    metadata?: Record<string, any>;
  }> {
    const { clientId, clientSecret } = this.getAppCredentials();
    if (!clientId || !clientSecret) {
      throw new Error('Meta App credentials missing. Setup required.');
    }

    const tokenUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id', clientId);
    tokenUrl.searchParams.set('client_secret', clientSecret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenRes = await fetch(tokenUrl.toString(), { method: 'GET' });
    if (!tokenRes.ok) {
      const errData = await tokenRes.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `Facebook OAuth token exchange failed with HTTP ${tokenRes.status}`);
    }

    const tokenData = await tokenRes.json();
    const userAccessToken = tokenData.access_token;
    const expiresIn = tokenData.expires_in;

    // Fetch user profile
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${userAccessToken}`);
    const meData = await meRes.json();

    // Fetch Facebook Pages managed by user
    const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,category,access_token&access_token=${userAccessToken}`);
    const pagesData = await pagesRes.json();

    const destinations: SocialDestination[] = (pagesData.data || []).map((page: any, idx: number) => ({
      id: page.id,
      name: page.name,
      platform: 'facebook' as const,
      is_default: idx === 0,
    }));

    return {
      access_token: userAccessToken,
      expires_in: expiresIn,
      account_id: meData.id || 'fb_unknown',
      account_name: meData.name || 'Facebook User',
      account_handle: `@${meData.id || 'fb'}`,
      available_destinations: destinations,
      scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
      metadata: { pages: pagesData.data || [] },
    };
  }

  async publishPost(
    post: SocialPostRecord,
    destination: SocialDestination,
    accessToken: string,
    options?: { is_simulated?: boolean }
  ): Promise<ProviderPublishResult> {
    // Media validation before dispatch
    const { validateMediaForPlatform } = await import('./media-validator.ts');
    const mediaCheck = validateMediaForPlatform('facebook', post.media_urls);
    if (!mediaCheck.valid) {
      return {
        success: false,
        is_simulated: Boolean(options?.is_simulated),
        error_message: mediaCheck.error_message,
        error_code: mediaCheck.error_code,
        raw_response: {
          simulated: Boolean(options?.is_simulated),
          destination_id: destination.id,
          media_validation: mediaCheck,
        },
      };
    }

    // Check if simulation mode is active
    if (options?.is_simulated) {
      return {
        success: true,
        is_simulated: true,
        provider_post_id: `sim_fb_${destination.id}_${Date.now()}`,
        provider_post_url: undefined, // Never fabricate fake working links in simulation
        raw_response: {
          simulated: true,
          destination_id: destination.id,
          media_validation: { valid: true, media_type: mediaCheck.media_type },
          message_preview: post.caption.slice(0, 60),
          hashtags: post.hashtags,
        },
      };
    }

    try {
      const captionText = post.hashtags && post.hashtags.length > 0
        ? `${post.caption}\n\n${post.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}`
        : post.caption;

      const pageId = destination.id;
      let url = `https://graph.facebook.com/v19.0/${pageId}/feed`;
      let body: any = {
        message: captionText,
        access_token: accessToken,
      };

      // If media is attached
      if (post.media_urls && post.media_urls.length > 0) {
        url = `https://graph.facebook.com/v19.0/${pageId}/photos`;
        body = {
          caption: captionText,
          url: post.media_urls[0],
          access_token: accessToken,
        };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          success: false,
          is_simulated: false,
          error_message: data?.error?.message || `Facebook Graph API error ${res.status}`,
          error_code: data?.error?.code?.toString() || `HTTP_${res.status}`,
          raw_response: data,
        };
      }

      const postId = data.id || data.post_id;
      return {
        success: true,
        is_simulated: false,
        provider_post_id: postId,
        provider_post_url: `https://facebook.com/${postId}`,
        raw_response: data,
      };
    } catch (err: any) {
      return {
        success: false,
        is_simulated: false,
        error_message: err.message || 'Network error communicating with Facebook Graph API',
        error_code: 'NETWORK_ERROR',
      };
    }
  }
}

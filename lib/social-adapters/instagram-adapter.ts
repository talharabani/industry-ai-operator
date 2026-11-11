import type { SocialAdapter, ProviderPublishResult, ProviderConfigValidation } from './types.ts';
import type { SocialDestination, SocialPostRecord } from '../social-types.ts';

export class InstagramAdapter implements SocialAdapter {
  platform = 'instagram' as const;

  private getAppCredentials() {
    const clientId = process.env.INSTAGRAM_CLIENT_ID || process.env.META_APP_ID;
    const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET || process.env.META_APP_SECRET;
    return { clientId, clientSecret };
  }

  validateConfiguration(): ProviderConfigValidation {
    const { clientId, clientSecret } = this.getAppCredentials();
    const missingKeys: string[] = [];
    if (!clientId) missingKeys.push('INSTAGRAM_CLIENT_ID (or META_APP_ID)');
    if (!clientSecret) missingKeys.push('INSTAGRAM_CLIENT_SECRET (or META_APP_SECRET)');

    return {
      is_configured: missingKeys.length === 0,
      missing_keys: missingKeys,
      setup_guide: {
        title: 'Meta App Setup for Instagram Business API',
        description:
          'Publishing to Instagram requires an Instagram Professional (Business or Creator) account connected to a Facebook Page, and a Meta App with instagram_basic and instagram_content_publish permissions.',
        doc_url: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing',
        required_scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
        steps: [
          'Convert your Instagram account to a Professional (Business or Creator) account in Instagram Settings.',
          'Connect your Instagram Business account to a Facebook Page you manage.',
          'Add Instagram Graph API to your Meta App on developers.facebook.com.',
          'Request Advanced Access for instagram_basic and instagram_content_publish.',
          'Configure redirect URI: /api/social/connections/oauth/instagram/callback.',
        ],
      },
    };
  }

  async getAuthorizationUrl(tenantId: string, redirectUri: string, stateToken: string): Promise<string> {
    const { clientId } = this.getAppCredentials();
    if (!clientId) {
      throw new Error('INSTAGRAM_CLIENT_ID / META_APP_ID is not configured on the server. Please complete setup in .env.local.');
    }

    const scopes = ['instagram_basic', 'instagram_content_publish', 'pages_show_list'].join(',');
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
      throw new Error(errData?.error?.message || `Instagram OAuth token exchange failed with HTTP ${tokenRes.status}`);
    }

    const tokenData = await tokenRes.json();
    const userAccessToken = tokenData.access_token;

    // Fetch Facebook pages to find linked Instagram Business Accounts
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,instagram_business_account{id,username,profile_picture_url}&access_token=${userAccessToken}`
    );
    const pagesData = await pagesRes.json();

    const destinations: SocialDestination[] = [];
    let primaryAccountId = '';
    let primaryAccountName = '';
    let primaryHandle = '';

    for (const page of pagesData.data || []) {
      if (page.instagram_business_account) {
        const ig = page.instagram_business_account;
        if (!primaryAccountId) {
          primaryAccountId = ig.id;
          primaryAccountName = ig.username ? `@${ig.username}` : page.name;
          primaryHandle = ig.username ? `@${ig.username}` : '';
        }
        destinations.push({
          id: ig.id,
          name: ig.username ? `@${ig.username} (${page.name})` : page.name,
          platform: 'instagram',
          handle: ig.username ? `@${ig.username}` : undefined,
          avatar_url: ig.profile_picture_url,
          is_default: destinations.length === 0,
        });
      }
    }

    if (destinations.length === 0) {
      throw new Error(
        'No Instagram Business accounts found linked to your Facebook Pages. Please convert your account to a Professional account and link it to a Page.'
      );
    }

    return {
      access_token: userAccessToken,
      expires_in: tokenData.expires_in,
      account_id: primaryAccountId,
      account_name: primaryAccountName,
      account_handle: primaryHandle,
      available_destinations: destinations,
      scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
      metadata: { instagram_accounts: destinations },
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
    const mediaCheck = validateMediaForPlatform('instagram', post.media_urls);
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

    if (options?.is_simulated) {
      return {
        success: true,
        is_simulated: true,
        provider_post_id: `sim_ig_${destination.id}_${Date.now()}`,
        provider_post_url: undefined, // Never fabricate fake working links in simulation
        raw_response: {
          simulated: true,
          destination_id: destination.id,
          media_validation: { valid: true, media_type: mediaCheck.media_type },
          caption_preview: post.caption.slice(0, 60),
          hashtags: post.hashtags,
        },
      };
    }

    try {
      const igUserId = destination.id;
      const captionText = post.hashtags && post.hashtags.length > 0
        ? `${post.caption}\n\n${post.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}`
        : post.caption;

      const imageUrl = post.media_urls && post.media_urls.length > 0
        ? post.media_urls[0]
        : null;

      if (!imageUrl) {
        return {
          success: false,
          is_simulated: false,
          error_message: 'Instagram Graph API requires an image or video URL to publish a post. Please attach media.',
          error_code: 'MEDIA_REQUIRED',
        };
      }

      // Step 1: Create media container
      const containerRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          caption: captionText,
          access_token: accessToken,
        }),
      });

      const containerData = await containerRes.json();
      if (!containerRes.ok || !containerData.id) {
        return {
          success: false,
          is_simulated: false,
          error_message: containerData?.error?.message || 'Failed to create Instagram media container',
          error_code: containerData?.error?.code?.toString() || 'CONTAINER_CREATION_FAILED',
          raw_response: containerData,
        };
      }

      const creationId = containerData.id;

      // Step 2: Publish the media container
      const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: accessToken,
        }),
      });

      const publishData = await publishRes.json();
      if (!publishRes.ok || !publishData.id) {
        return {
          success: false,
          is_simulated: false,
          error_message: publishData?.error?.message || 'Failed to publish Instagram media container',
          error_code: publishData?.error?.code?.toString() || 'PUBLISH_FAILED',
          raw_response: publishData,
        };
      }

      return {
        success: true,
        is_simulated: false,
        provider_post_id: publishData.id,
        provider_post_url: `https://instagram.com/p/${publishData.id}`,
        raw_response: publishData,
      };
    } catch (err: any) {
      return {
        success: false,
        is_simulated: false,
        error_message: err.message || 'Network error communicating with Instagram Graph API',
        error_code: 'NETWORK_ERROR',
      };
    }
  }
}

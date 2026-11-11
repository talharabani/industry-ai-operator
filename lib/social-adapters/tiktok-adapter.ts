import type { SocialAdapter, ProviderPublishResult, ProviderConfigValidation } from './types.ts';
import type { SocialDestination, SocialPostRecord } from '../social-types.ts';

export class TikTokAdapter implements SocialAdapter {
  platform = 'tiktok' as const;

  private getAppCredentials() {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    return { clientKey, clientSecret };
  }

  validateConfiguration(): ProviderConfigValidation {
    const { clientKey, clientSecret } = this.getAppCredentials();
    const missingKeys: string[] = [];
    if (!clientKey) missingKeys.push('TIKTOK_CLIENT_KEY');
    if (!clientSecret) missingKeys.push('TIKTOK_CLIENT_SECRET');

    return {
      is_configured: missingKeys.length === 0,
      missing_keys: missingKeys,
      setup_guide: {
        title: 'TikTok for Developers Setup',
        description:
          'Publishing videos and posts to TikTok requires a registered Developer App with the Content Posting API and Login Kit enabled.',
        doc_url: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
        required_scopes: ['user.info.basic', 'video.publish', 'video.upload'],
        steps: [
          'Create a developer account and register an app on developers.tiktok.com.',
          'Add Login Kit and Content Posting API products to your TikTok app.',
          'Configure Redirect URI: /api/social/connections/oauth/tiktok/callback.',
          'Submit your app for review or add sandbox test accounts.',
          'Configure TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in your .env.local.',
        ],
      },
    };
  }

  async getAuthorizationUrl(tenantId: string, redirectUri: string, stateToken: string): Promise<string> {
    const { clientKey } = this.getAppCredentials();
    if (!clientKey) {
      throw new Error('TIKTOK_CLIENT_KEY is not configured on the server. Please complete setup in .env.local.');
    }

    const scopes = ['user.info.basic', 'video.publish', 'video.upload'].join(',');
    const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
    url.searchParams.set('client_key', clientKey);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', stateToken);
    url.searchParams.set('scope', scopes);
    url.searchParams.set('response_type', 'code');
    return url.toString();
  }

  async exchangeCodeForTokens(code: string, redirectUri: string, codeVerifier?: string): Promise<{
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
    const { clientKey, clientSecret } = this.getAppCredentials();
    if (!clientKey || !clientSecret) {
      throw new Error('TikTok App credentials missing. Setup required.');
    }

    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error_description || data.message || `TikTok token exchange failed with HTTP ${res.status}`);
    }

    const accessToken = data.access_token;
    const openId = data.open_id;

    // Fetch user profile info
    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData = await userRes.json();
    const user = userData?.data?.user || {};

    const destinations: SocialDestination[] = [
      {
        id: openId,
        name: user.display_name || 'TikTok Profile',
        platform: 'tiktok',
        avatar_url: user.avatar_url,
        is_default: true,
      },
    ];

    return {
      access_token: accessToken,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      account_id: openId,
      account_name: user.display_name || 'TikTok User',
      account_handle: user.display_name ? `@${user.display_name}` : `@${openId.slice(0, 8)}`,
      available_destinations: destinations,
      scopes: ['user.info.basic', 'video.publish', 'video.upload'],
      metadata: { open_id: openId },
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
    const mediaCheck = validateMediaForPlatform('tiktok', post.media_urls);
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
        provider_post_id: `sim_tt_${destination.id}_${Date.now()}`,
        provider_post_url: undefined, // Never fabricate fake working links in simulation
        raw_response: {
          simulated: true,
          destination_id: destination.id,
          media_validation: { valid: true, media_type: mediaCheck.media_type },
          caption: post.caption.slice(0, 60),
          hashtags: post.hashtags,
        },
      };
    }

    try {
      const videoUrl = post.media_urls && post.media_urls.length > 0
        ? post.media_urls[0]
        : null;

      if (!videoUrl) {
        return {
          success: false,
          is_simulated: false,
          error_message: 'TikTok Content Posting API requires a hosted video file URL.',
          error_code: 'VIDEO_REQUIRED',
        };
      }

      const captionText = post.hashtags && post.hashtags.length > 0
        ? `${post.caption} ${post.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}`
        : post.caption;

      const res = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          post_info: {
            title: captionText.slice(0, 150),
            privacy_level: 'PUBLIC_TO_EVERYONE',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
            video_cover_timestamp_ms: 1000,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: videoUrl,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error?.code !== 'ok') {
        return {
          success: false,
          is_simulated: false,
          error_message: data?.error?.message || 'Failed to initialize TikTok video upload',
          error_code: data?.error?.code || `HTTP_${res.status}`,
          raw_response: data,
        };
      }

      const publishId = data?.data?.publish_id;
      return {
        success: true,
        is_simulated: false,
        provider_post_id: publishId,
        provider_post_url: `https://www.tiktok.com`,
        raw_response: data,
      };
    } catch (err: any) {
      return {
        success: false,
        is_simulated: false,
        error_message: err.message || 'Network error communicating with TikTok API',
        error_code: 'NETWORK_ERROR',
      };
    }
  }
}

import type { SocialPlatform, SocialDestination, SocialPostRecord } from '../social-types.ts';

export interface ProviderPublishResult {
  success: boolean;
  is_simulated: boolean;
  provider_post_id?: string;
  provider_post_url?: string;
  error_message?: string;
  error_code?: string;
  raw_response?: Record<string, any>;
}

export interface ProviderConfigValidation {
  is_configured: boolean;
  missing_keys: string[];
  setup_guide: {
    title: string;
    description: string;
    doc_url: string;
    required_scopes: string[];
    steps: string[];
  };
}

export interface SocialAdapter {
  platform: SocialPlatform;
  getAuthorizationUrl(tenantId: string, redirectUri: string, stateToken: string): Promise<string>;
  validateConfiguration(): ProviderConfigValidation;
  exchangeCodeForTokens(code: string, redirectUri: string, codeVerifier?: string): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    account_id: string;
    account_name: string;
    account_handle?: string;
    available_destinations: SocialDestination[];
    scopes: string[];
    metadata?: Record<string, any>;
  }>;
  publishPost(
    post: SocialPostRecord,
    destination: SocialDestination,
    accessToken: string,
    options?: { is_simulated?: boolean }
  ): Promise<ProviderPublishResult>;
}

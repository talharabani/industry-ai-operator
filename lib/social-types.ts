export type SocialPlatform = 'facebook' | 'instagram' | 'tiktok';

export type SocialAutomationMode = 'review_required' | 'autopilot';

export type SocialPostStatus = 
  | 'generating'
  | 'draft'
  | 'pending_approval'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'partially_published'
  | 'failed'
  | 'cancelled'
  | 'simulated';

export type SocialJobStatus =
  | 'pending'
  | 'claimed'
  | 'publishing'
  | 'published'
  | 'simulated'
  | 'failed'
  | 'cancelled';

export interface SocialDestination {
  id: string; // e.g. "page_12345" or "ig_98765"
  name: string; // e.g. "Apex Plumbing Facebook Page"
  platform: SocialPlatform;
  handle?: string;
  avatar_url?: string;
  is_default?: boolean;
}

export interface SocialConnectionRecord {
  id: string;
  tenant_id: string;
  platform: SocialPlatform;
  account_id: string;
  account_name: string;
  account_handle?: string;
  status: 'connected' | 'setup_required' | 'permission_required' | 'expired' | 'disconnected';
  scopes: string[];
  selected_destinations: SocialDestination[];
  encrypted_access_token?: string;
  encrypted_refresh_token?: string;
  token_expires_at?: string;
  setup_instructions?: string;
  metadata?: Record<string, any>;
  connected_by?: string;
  created_at: string;
  updated_at: string;
}

export interface SocialPostingScheduleSlot {
  day_of_week: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  time_utc: string; // "HH:MM" e.g. "14:00"
  time_local: string; // "HH:MM" in tenant timezone
}

export interface SocialBrandSettings {
  id?: string;
  tenant_id: string;
  automation_mode: SocialAutomationMode; // 'review_required' | 'autopilot'
  publishing_mode: 'simulation' | 'live'; // 'simulation' (pilot) | 'live'
  is_automation_paused: boolean;
  language: string; // e.g. 'English', 'Urdu', etc.
  tone: string; // e.g. 'Authoritative, friendly, solution-oriented'
  target_audience: string;
  content_themes: string[]; // e.g. ['Seasonal maintenance tips', 'Emergency plumbing advice', 'Behind the scenes']
  prohibited_topics: string[]; // e.g. ['Competitor bashing', 'Unverified price discounts']
  selected_platforms: SocialPlatform[];
  timezone: string; // e.g. 'America/New_York', 'UTC'
  posting_days: number[]; // [1, 3, 5] (Mon, Wed, Fri)
  posting_times: string[]; // ["09:00", "15:00"]
  weekly_post_limit: number; // Max posts per week
  monthly_generation_limit: number; // AI generation quota
  monthly_generations_used: number;
  generation_cycle_reset_at: string;
  schedule_anchor_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SocialMediaAssetRecord {
  id: string;
  tenant_id: string;
  media_type: 'image' | 'video';
  mime_type?: string;
  storage_url: string;
  filename: string;
  filesize_bytes?: number;
  source: 'owner_upload' | 'stock_asset' | 'branded_card_template' | 'ai_generated' | 'template';
  provider?: string;
  prompt?: string;
  dimensions?: { width: number; height: number };
  duration_seconds?: number;
  created_at: string;
}

export interface SocialPostRecord {
  id: string;
  tenant_id: string;
  brand_settings_id?: string;
  campaign_name?: string;
  topic_theme?: string;
  caption: string;
  hashtags: string[];
  video_script?: string;
  target_platforms: SocialPlatform[];
  status: SocialPostStatus;
  media_asset_ids: string[];
  media_urls: string[];
  scheduled_at?: string; // UTC ISO string
  published_at?: string;
  slot_key?: string;
  is_approved: boolean;
  approved_by?: string;
  approved_at?: string;
  approval_snapshot_hash?: string; // Hash of caption + hashtags + target_platforms + media_urls
  rejection_reason?: string;
  cancellation_reason?: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface SocialPublishingJobRecord {
  id: string;
  tenant_id: string;
  post_id: string;
  platform: SocialPlatform;
  destination_id: string;
  destination_name?: string;
  status: SocialJobStatus;
  scheduled_at: string;
  claimed_at?: string;
  claimed_by_worker?: string;
  attempt_count: number;
  max_attempts: number;
  last_attempt_at?: string;
  idempotency_key: string;
  provider_post_id?: string;
  provider_post_url?: string;
  error_message?: string;
  error_code?: string;
  raw_response?: Record<string, any>;
  is_simulated: boolean;
  created_at: string;
  updated_at: string;
}

export interface SocialOAuthStateRecord {
  state_token: string;
  tenant_id: string;
  user_id: string;
  platform: SocialPlatform;
  redirect_uri: string;
  code_verifier?: string;
  expires_at: string;
}

export interface MediaProviderStatus {
  id: string;
  name: string;
  type: 'image' | 'video';
  is_configured: boolean;
  is_ready: boolean;
  missing_keys: string[];
  setup_guide: {
    title: string;
    description: string;
    doc_url?: string;
    required_env: string[];
    steps: string[];
  };
}

export interface SocialDashboardSummary {
  connected_accounts_count: number;
  scheduled_posts_count: number;
  pending_approval_count: number;
  published_count: number;
  simulated_count: number;
  failed_count: number;
  automation_mode: SocialAutomationMode;
  publishing_mode: 'simulation' | 'live';
  effective_publishing_mode: 'simulation' | 'live';
  live_publishing_gate_enabled: boolean;
  live_publishing_block_reason?: string;
  is_automation_paused: boolean;
  generations_used: number;
  generations_limit: number;
  platforms: {
    platform: SocialPlatform;
    connected: boolean;
    account_name?: string;
    destinations_count: number;
    status: string;
  }[];
  media_providers?: MediaProviderStatus[];
}

export type SocialGenerationJobStage =
  | 'queued'
  | 'choosing_idea'
  | 'writing_caption'
  | 'generating_image'
  | 'ready'
  | 'failed';

export type SocialContentAngle =
  | 'product_service_spotlight'
  | 'educational_tip'
  | 'customer_faq'
  | 'behind_the_scenes_process'
  | 'brand_heritage_values';

export interface SocialGenerationJobRecord {
  id: string;
  tenant_id: string;
  status: SocialGenerationJobStage;
  stage_label: string;
  stage_progress: number;
  error_message?: string | null;
  idempotency_key?: string | null;
  options?: {
    theme?: string;
    custom_instruction?: string;
    target_platforms?: SocialPlatform[];
    language?: string;
    save_as_post?: boolean;
    scheduled_at?: string;
  };
  selected_concept?: {
    content_angle: SocialContentAngle;
    angle_title: string;
    topic: string;
    catalog_item_id?: string;
    catalog_item_name?: string;
    hook_type: string;
    visual_concept: string;
  } | null;
  generated_draft?: {
    caption: string;
    hashtags: string[];
    video_script?: string;
    image_prompt: string;
    alt_text?: string;
    suggested_media_type?: 'image' | 'video';
    platform_variations?: Record<string, string>;
    generation_source?: string;
    generator_model?: string;
  } | null;
  media_result?: {
    asset_id?: string;
    storage_url?: string;
    format?: string;
    width?: number;
    height?: number;
    status: 'generated' | 'blocked_unconfigured' | 'owner_reference' | 'failed';
    provider?: string;
    model?: string;
    error?: string;
  } | null;
  post_id?: string | null;
  n8n_execution_id?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

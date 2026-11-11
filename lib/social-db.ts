import { query } from './db.ts';
import { encryptSecret, decryptSecret, computeSha256 } from './crypto.ts';
import type {
  SocialPlatform,
  SocialBrandSettings,
  SocialConnectionRecord,
  SocialMediaAssetRecord,
  SocialPostRecord,
  SocialPublishingJobRecord,
  SocialDashboardSummary,
  SocialJobStatus,
  SocialPostStatus,
  SocialDestination,
  SocialGenerationJobRecord,
  SocialGenerationJobStage
} from './social-types.ts';

/**
 * Calculates a content integrity hash to ensure owner-approved content
 * is not materially modified without re-approval.
 */
export function computeSocialApprovalSnapshotHash(content: {
  caption: string;
  hashtags?: string[];
  target_platforms?: SocialPlatform[];
  media_urls?: string[];
}): string {
  const normalized = {
    caption: (content.caption || '').trim(),
    hashtags: (content.hashtags || []).map((h) => h.toLowerCase().trim()).sort(),
    target_platforms: (content.target_platforms || []).slice().sort(),
    media_urls: (content.media_urls || []).slice().sort(),
  };
  return computeSha256(JSON.stringify(normalized));
}

// ==========================================
// BRAND & CONTENT SETTINGS
// ==========================================

export async function getSocialBrandSettings(tenantId: string): Promise<SocialBrandSettings> {
  const rows = await query<any>(
    `SELECT * FROM iao.social_brand_settings WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );

  if (rows.length > 0) {
    const row = rows[0];
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      automation_mode: row.automation_mode || 'review_required',
      publishing_mode: row.publishing_mode || 'simulation',
      is_automation_paused: Boolean(row.is_automation_paused),
      language: row.language || 'English',
      tone: row.tone || 'Professional, friendly, and authentic',
      target_audience: row.target_audience || 'Local homeowners and business clients',
      content_themes: Array.isArray(row.content_themes) ? row.content_themes : [],
      prohibited_topics: Array.isArray(row.prohibited_topics) ? row.prohibited_topics : [],
      selected_platforms: Array.isArray(row.selected_platforms) ? row.selected_platforms : ['facebook', 'instagram'],
      timezone: row.timezone || 'UTC',
      posting_days: Array.isArray(row.posting_days) ? row.posting_days : [1, 3, 5],
      posting_times: Array.isArray(row.posting_times) ? row.posting_times : ['10:00', '16:00'],
      weekly_post_limit: Number(row.weekly_post_limit) || 5,
      monthly_generation_limit: Number(row.monthly_generation_limit) || 30,
      monthly_generations_used: Number(row.monthly_generations_used) || 0,
      generation_cycle_reset_at: row.generation_cycle_reset_at?.toISOString() || new Date().toISOString(),
      schedule_anchor_at: row.schedule_anchor_at?.toISOString(),
      created_at: row.created_at?.toISOString(),
      updated_at: row.updated_at?.toISOString(),
    };
  }

  // Return tenant-isolated default configuration
  return {
    tenant_id: tenantId,
    automation_mode: 'review_required',
    publishing_mode: 'simulation',
    is_automation_paused: false,
    language: 'English',
    tone: 'Professional, friendly, and authentic',
    target_audience: 'Local homeowners and business clients',
    content_themes: ['Service highlights', 'Customer tips & maintenance', 'Behind-the-scenes'],
    prohibited_topics: ['Unverified discounts', 'Competitor bashing', 'Guaranteed completion times without inspection'],
    selected_platforms: ['facebook', 'instagram'],
    timezone: 'UTC',
    posting_days: [1, 3, 5],
    posting_times: ['10:00', '16:00'],
    weekly_post_limit: 5,
    monthly_generation_limit: 30,
    monthly_generations_used: 0,
    generation_cycle_reset_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  };
}

export async function saveSocialBrandSettings(
  tenantId: string,
  settings: Partial<SocialBrandSettings>
): Promise<SocialBrandSettings> {
  const current = await getSocialBrandSettings(tenantId);

  const updated: SocialBrandSettings = {
    ...current,
    ...settings,
    tenant_id: tenantId,
  };

  const rows = await query<any>(
    `INSERT INTO iao.social_brand_settings (
      tenant_id, automation_mode, publishing_mode, is_automation_paused, language, tone,
      target_audience, content_themes, prohibited_topics, selected_platforms,
      timezone, posting_days, posting_times, weekly_post_limit,
      monthly_generation_limit, monthly_generations_used, generation_cycle_reset_at,
      schedule_anchor_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
    ON CONFLICT (tenant_id) DO UPDATE SET
      automation_mode = EXCLUDED.automation_mode,
      publishing_mode = EXCLUDED.publishing_mode,
      is_automation_paused = EXCLUDED.is_automation_paused,
      language = EXCLUDED.language,
      tone = EXCLUDED.tone,
      target_audience = EXCLUDED.target_audience,
      content_themes = EXCLUDED.content_themes,
      prohibited_topics = EXCLUDED.prohibited_topics,
      selected_platforms = EXCLUDED.selected_platforms,
      timezone = EXCLUDED.timezone,
      posting_days = EXCLUDED.posting_days,
      posting_times = EXCLUDED.posting_times,
      weekly_post_limit = EXCLUDED.weekly_post_limit,
      monthly_generation_limit = EXCLUDED.monthly_generation_limit,
      monthly_generations_used = EXCLUDED.monthly_generations_used,
      generation_cycle_reset_at = EXCLUDED.generation_cycle_reset_at,
      schedule_anchor_at = COALESCE(EXCLUDED.schedule_anchor_at, iao.social_brand_settings.schedule_anchor_at),
      updated_at = NOW()
    RETURNING *`,
    [
      tenantId,
      updated.automation_mode,
      updated.publishing_mode || 'simulation',
      updated.is_automation_paused,
      updated.language,
      updated.tone,
      updated.target_audience,
      JSON.stringify(updated.content_themes),
      JSON.stringify(updated.prohibited_topics),
      JSON.stringify(updated.selected_platforms),
      updated.timezone,
      JSON.stringify(updated.posting_days),
      JSON.stringify(updated.posting_times),
      updated.weekly_post_limit,
      updated.monthly_generation_limit,
      updated.monthly_generations_used,
      updated.generation_cycle_reset_at,
      updated.schedule_anchor_at ? new Date(updated.schedule_anchor_at) : null,
    ]
  );

  return getSocialBrandSettings(tenantId);
}

export async function incrementGenerationUsage(tenantId: string): Promise<boolean> {
  const res = await query<any>(
    `UPDATE iao.social_brand_settings
     SET monthly_generations_used = monthly_generations_used + 1,
         updated_at = NOW()
     WHERE tenant_id = $1 AND monthly_generations_used < monthly_generation_limit
     RETURNING monthly_generations_used`,
    [tenantId]
  );
  return res.length > 0;
}

// ==========================================
// SOCIAL CONNECTIONS
// ==========================================

export async function getSocialConnections(tenantId: string): Promise<SocialConnectionRecord[]> {
  const rows = await query<any>(
    `SELECT id, tenant_id, platform, account_id, account_name, account_handle,
            status, scopes, selected_destinations, token_expires_at, setup_instructions,
            metadata, connected_by, created_at, updated_at
     FROM iao.social_connections
     WHERE tenant_id = $1
     ORDER BY platform ASC`,
    [tenantId]
  );

  return rows.map((r) => ({
    id: r.id,
    tenant_id: r.tenant_id,
    platform: r.platform,
    account_id: r.account_id,
    account_name: r.account_name,
    account_handle: r.account_handle,
    status: r.status,
    scopes: Array.isArray(r.scopes) ? r.scopes : [],
    selected_destinations: Array.isArray(r.selected_destinations) ? r.selected_destinations : [],
    token_expires_at: r.token_expires_at?.toISOString(),
    setup_instructions: r.setup_instructions,
    metadata: r.metadata,
    connected_by: r.connected_by,
    created_at: r.created_at?.toISOString(),
    updated_at: r.updated_at?.toISOString(),
  }));
}

export async function getSocialConnection(
  tenantId: string,
  platform: SocialPlatform,
  includeTokens: boolean = false
): Promise<(SocialConnectionRecord & { access_token?: string; refresh_token?: string }) | null> {
  const rows = await query<any>(
    `SELECT * FROM iao.social_connections
     WHERE tenant_id = $1 AND platform = $2
     LIMIT 1`,
    [tenantId, platform]
  );

  if (rows.length === 0) return null;
  const r = rows[0];

  const record: SocialConnectionRecord & { access_token?: string; refresh_token?: string } = {
    id: r.id,
    tenant_id: r.tenant_id,
    platform: r.platform,
    account_id: r.account_id,
    account_name: r.account_name,
    account_handle: r.account_handle,
    status: r.status,
    scopes: Array.isArray(r.scopes) ? r.scopes : [],
    selected_destinations: Array.isArray(r.selected_destinations) ? r.selected_destinations : [],
    token_expires_at: r.token_expires_at?.toISOString(),
    setup_instructions: r.setup_instructions,
    metadata: r.metadata,
    connected_by: r.connected_by,
    created_at: r.created_at?.toISOString(),
    updated_at: r.updated_at?.toISOString(),
  };

  if (includeTokens) {
    record.access_token = r.encrypted_access_token ? decryptSecret(r.encrypted_access_token) : undefined;
    record.refresh_token = r.encrypted_refresh_token ? decryptSecret(r.encrypted_refresh_token) : undefined;
  }

  return record;
}

export async function upsertSocialConnection(
  tenantId: string,
  data: {
    platform: SocialPlatform;
    account_id: string;
    account_name: string;
    account_handle?: string;
    status: 'connected' | 'setup_required' | 'permission_required' | 'expired' | 'disconnected';
    scopes?: string[];
    selected_destinations?: SocialDestination[];
    access_token?: string;
    refresh_token?: string;
    token_expires_at?: Date | string;
    setup_instructions?: string;
    metadata?: Record<string, any>;
    connected_by?: string;
  }
): Promise<SocialConnectionRecord> {
  const encAccessToken = data.access_token ? encryptSecret(data.access_token) : null;
  const encRefreshToken = data.refresh_token ? encryptSecret(data.refresh_token) : null;

  const rows = await query<any>(
    `INSERT INTO iao.social_connections (
      tenant_id, platform, account_id, account_name, account_handle,
      status, scopes, selected_destinations, encrypted_access_token,
      encrypted_refresh_token, token_expires_at, setup_instructions,
      metadata, connected_by, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
    ON CONFLICT (tenant_id, platform) DO UPDATE SET
      account_id = EXCLUDED.account_id,
      account_name = EXCLUDED.account_name,
      account_handle = EXCLUDED.account_handle,
      status = EXCLUDED.status,
      scopes = EXCLUDED.scopes,
      selected_destinations = EXCLUDED.selected_destinations,
      encrypted_access_token = COALESCE(EXCLUDED.encrypted_access_token, iao.social_connections.encrypted_access_token),
      encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, iao.social_connections.encrypted_refresh_token),
      token_expires_at = EXCLUDED.token_expires_at,
      setup_instructions = EXCLUDED.setup_instructions,
      metadata = EXCLUDED.metadata,
      connected_by = EXCLUDED.connected_by,
      updated_at = NOW()
    RETURNING id, tenant_id, platform, account_id, account_name, account_handle,
              status, scopes, selected_destinations, token_expires_at, setup_instructions,
              metadata, connected_by, created_at, updated_at`,
    [
      tenantId,
      data.platform,
      data.account_id,
      data.account_name,
      data.account_handle || null,
      data.status,
      JSON.stringify(data.scopes || []),
      JSON.stringify(data.selected_destinations || []),
      encAccessToken,
      encRefreshToken,
      data.token_expires_at ? new Date(data.token_expires_at) : null,
      data.setup_instructions || null,
      JSON.stringify(data.metadata || {}),
      data.connected_by || null,
    ]
  );

  const r = rows[0];
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    platform: r.platform,
    account_id: r.account_id,
    account_name: r.account_name,
    account_handle: r.account_handle,
    status: r.status,
    scopes: Array.isArray(r.scopes) ? r.scopes : [],
    selected_destinations: Array.isArray(r.selected_destinations) ? r.selected_destinations : [],
    token_expires_at: r.token_expires_at?.toISOString(),
    setup_instructions: r.setup_instructions,
    metadata: r.metadata,
    connected_by: r.connected_by,
    created_at: r.created_at?.toISOString(),
    updated_at: r.updated_at?.toISOString(),
  };
}

export async function disconnectSocialConnection(
  tenantId: string,
  platform: SocialPlatform
): Promise<boolean> {
  const res = await query<any>(
    `UPDATE iao.social_connections
     SET status = 'disconnected',
         encrypted_access_token = NULL,
         encrypted_refresh_token = NULL,
         updated_at = NOW()
     WHERE tenant_id = $1 AND platform = $2
     RETURNING id`,
    [tenantId, platform]
  );
  return res.length > 0;
}

// ==========================================
// MEDIA ASSETS
// ==========================================

export async function getSocialMediaAssets(tenantId: string): Promise<SocialMediaAssetRecord[]> {
  const rows = await query<any>(
    `SELECT * FROM iao.social_media_assets
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId]
  );

  return rows.map((r) => ({
    id: r.id,
    tenant_id: r.tenant_id,
    media_type: r.media_type,
    storage_url: r.storage_url,
    filename: r.filename,
    filesize_bytes: r.filesize_bytes ? Number(r.filesize_bytes) : undefined,
    mime_type: r.mime_type,
    source: r.source,
    dimensions: r.dimensions,
    duration_seconds: r.duration_seconds ? Number(r.duration_seconds) : undefined,
    created_at: r.created_at?.toISOString(),
  }));
}

export async function createSocialMediaAsset(
  tenantId: string,
  asset: Omit<SocialMediaAssetRecord, 'id' | 'tenant_id' | 'created_at'>
): Promise<SocialMediaAssetRecord> {
  const rows = await query<any>(
    `INSERT INTO iao.social_media_assets (
      tenant_id, media_type, storage_url, filename, filesize_bytes,
      mime_type, source, dimensions, duration_seconds
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      tenantId,
      asset.media_type,
      asset.storage_url,
      asset.filename,
      asset.filesize_bytes || null,
      asset.mime_type || null,
      asset.source || 'owner_upload',
      JSON.stringify(asset.dimensions || {}),
      asset.duration_seconds || null,
    ]
  );

  const r = rows[0];
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    media_type: r.media_type,
    storage_url: r.storage_url,
    filename: r.filename,
    filesize_bytes: r.filesize_bytes ? Number(r.filesize_bytes) : undefined,
    mime_type: r.mime_type,
    source: r.source,
    dimensions: r.dimensions,
    duration_seconds: r.duration_seconds ? Number(r.duration_seconds) : undefined,
    created_at: r.created_at?.toISOString(),
  };
}

// ==========================================
// SOCIAL POSTS
// ==========================================

export async function getSocialPosts(
  tenantId: string,
  filters?: {
    status?: SocialPostStatus;
    limit?: number;
    offset?: number;
  }
): Promise<SocialPostRecord[]> {
  const params: any[] = [tenantId];
  let whereClause = `WHERE tenant_id = $1`;

  if (filters?.status) {
    params.push(filters.status);
    whereClause += ` AND status = $${params.length}`;
  }

  const limit = filters?.limit || 50;
  params.push(limit);
  const limitClause = `LIMIT $${params.length}`;

  const offset = filters?.offset || 0;
  params.push(offset);
  const offsetClause = `OFFSET $${params.length}`;

  const rows = await query<any>(
    `SELECT * FROM iao.social_posts
     ${whereClause}
     ORDER BY scheduled_at ASC NULLS LAST, created_at DESC
     ${limitClause} ${offsetClause}`,
    params
  );

  return rows.map((r) => ({
    id: r.id,
    tenant_id: r.tenant_id,
    brand_settings_id: r.brand_settings_id,
    campaign_name: r.campaign_name,
    topic_theme: r.topic_theme,
    caption: r.caption,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : [],
    video_script: r.video_script,
    target_platforms: Array.isArray(r.target_platforms) ? r.target_platforms : [],
    status: r.status,
    media_asset_ids: Array.isArray(r.media_asset_ids) ? r.media_asset_ids : [],
    media_urls: Array.isArray(r.media_urls) ? r.media_urls : [],
    scheduled_at: r.scheduled_at?.toISOString(),
    published_at: r.published_at?.toISOString(),
    is_approved: Boolean(r.is_approved),
    approved_by: r.approved_by,
    approved_at: r.approved_at?.toISOString(),
    approval_snapshot_hash: r.approval_snapshot_hash,
    rejection_reason: r.rejection_reason,
    cancellation_reason: r.cancellation_reason,
    metadata: r.metadata,
    created_at: r.created_at?.toISOString(),
    updated_at: r.updated_at?.toISOString(),
  }));
}

export async function getSocialPostById(
  tenantId: string,
  postId: string
): Promise<SocialPostRecord | null> {
  const rows = await query<any>(
    `SELECT * FROM iao.social_posts WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, postId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];

  return {
    id: r.id,
    tenant_id: r.tenant_id,
    brand_settings_id: r.brand_settings_id,
    campaign_name: r.campaign_name,
    topic_theme: r.topic_theme,
    caption: r.caption,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : [],
    video_script: r.video_script,
    target_platforms: Array.isArray(r.target_platforms) ? r.target_platforms : [],
    status: r.status,
    media_asset_ids: Array.isArray(r.media_asset_ids) ? r.media_asset_ids : [],
    media_urls: Array.isArray(r.media_urls) ? r.media_urls : [],
    scheduled_at: r.scheduled_at?.toISOString(),
    published_at: r.published_at?.toISOString(),
    is_approved: Boolean(r.is_approved),
    approved_by: r.approved_by,
    approved_at: r.approved_at?.toISOString(),
    approval_snapshot_hash: r.approval_snapshot_hash,
    rejection_reason: r.rejection_reason,
    cancellation_reason: r.cancellation_reason,
    metadata: r.metadata,
    created_at: r.created_at?.toISOString(),
    updated_at: r.updated_at?.toISOString(),
  };
}

export async function createSocialPost(
  tenantId: string,
  data: {
    caption: string;
    hashtags?: string[];
    video_script?: string;
    target_platforms: SocialPlatform[];
    topic_theme?: string;
    campaign_name?: string;
    media_asset_ids?: string[];
    media_urls?: string[];
    scheduled_at?: string | Date;
    slot_key?: string;
    status?: SocialPostStatus;
    is_approved?: boolean;
    approved_by?: string;
    metadata?: Record<string, any>;
  }
): Promise<SocialPostRecord> {
  // Deduplication check: if slot_key is provided, return existing post for this slot
  if (data.slot_key) {
    const existing = await query<any>(
      `SELECT id FROM iao.social_posts WHERE tenant_id = $1 AND slot_key = $2 LIMIT 1`,
      [tenantId, data.slot_key]
    );
    if (existing.length > 0) {
      const existingPost = await getSocialPostById(tenantId, existing[0].id);
      if (existingPost) return existingPost;
    }
  }

  const isApproved = Boolean(data.is_approved);
  const hash = isApproved
    ? computeSocialApprovalSnapshotHash({
        caption: data.caption,
        hashtags: data.hashtags,
        target_platforms: data.target_platforms,
        media_urls: data.media_urls,
      })
    : null;

  const rows = await query<any>(
    `INSERT INTO iao.social_posts (
      tenant_id, caption, hashtags, video_script, target_platforms,
      topic_theme, campaign_name, media_asset_ids, media_urls,
      scheduled_at, slot_key, status, is_approved, approved_by, approved_at,
      approval_snapshot_hash, metadata, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
    RETURNING *`,
    [
      tenantId,
      data.caption,
      JSON.stringify(data.hashtags || []),
      data.video_script || null,
      JSON.stringify(data.target_platforms || []),
      data.topic_theme || null,
      data.campaign_name || null,
      JSON.stringify(data.media_asset_ids || []),
      JSON.stringify(data.media_urls || []),
      data.scheduled_at ? new Date(data.scheduled_at) : null,
      data.slot_key || null,
      data.status || (isApproved ? 'scheduled' : 'pending_approval'),
      isApproved,
      data.approved_by || null,
      isApproved ? new Date() : null,
      hash,
      JSON.stringify(data.metadata || {}),
    ]
  );

  const r = rows[0];
  const post: SocialPostRecord = {
    id: r.id,
    tenant_id: r.tenant_id,
    brand_settings_id: r.brand_settings_id,
    campaign_name: r.campaign_name,
    topic_theme: r.topic_theme,
    caption: r.caption,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : [],
    video_script: r.video_script,
    target_platforms: Array.isArray(r.target_platforms) ? r.target_platforms : [],
    status: r.status,
    media_asset_ids: Array.isArray(r.media_asset_ids) ? r.media_asset_ids : [],
    media_urls: Array.isArray(r.media_urls) ? r.media_urls : [],
    scheduled_at: r.scheduled_at?.toISOString(),
    published_at: r.published_at?.toISOString(),
    slot_key: r.slot_key,
    is_approved: Boolean(r.is_approved),
    approved_by: r.approved_by,
    approved_at: r.approved_at?.toISOString(),
    approval_snapshot_hash: r.approval_snapshot_hash,
    metadata: r.metadata,
    created_at: r.created_at?.toISOString(),
    updated_at: r.updated_at?.toISOString(),
  };

  // If already approved/scheduled with target platforms and scheduled_at, create publishing jobs
  if (post.status === 'scheduled' && post.is_approved && post.scheduled_at) {
    await createSocialPublishingJobsForPost(tenantId, post);
  }

  return post;
}

export async function updateSocialPost(
  tenantId: string,
  postId: string,
  data: {
    caption?: string;
    hashtags?: string[];
    video_script?: string;
    target_platforms?: SocialPlatform[];
    media_urls?: string[];
    scheduled_at?: string | Date;
  }
): Promise<SocialPostRecord> {
  const existing = await getSocialPostById(tenantId, postId);
  if (!existing) {
    throw new Error(`Post not found or access denied: ${postId}`);
  }

  // Material edits: check if caption, hashtags, target_platforms, or media_urls changed
  const newCaption = data.caption !== undefined ? data.caption : existing.caption;
  const newHashtags = data.hashtags !== undefined ? data.hashtags : existing.hashtags;
  const newPlatforms = data.target_platforms !== undefined ? data.target_platforms : existing.target_platforms;
  const newMedia = data.media_urls !== undefined ? data.media_urls : existing.media_urls;

  const newHash = computeSocialApprovalSnapshotHash({
    caption: newCaption,
    hashtags: newHashtags,
    target_platforms: newPlatforms,
    media_urls: newMedia,
  });

  const isMaterialEdit = existing.is_approved && newHash !== existing.approval_snapshot_hash;

  // If edited materially, approval is invalidated! Status reverts to pending_approval or draft
  const newIsApproved = isMaterialEdit ? false : existing.is_approved;
  const newStatus = isMaterialEdit
    ? 'pending_approval'
    : (data.scheduled_at && existing.is_approved ? 'scheduled' : existing.status);

  // If approval was invalidated, cancel any existing pending publishing jobs
  if (isMaterialEdit) {
    await query(
      `UPDATE iao.social_publishing_jobs
       SET status = 'cancelled',
           error_message = 'Post was modified by owner after approval; re-approval required',
           updated_at = NOW()
       WHERE tenant_id = $1 AND post_id = $2 AND status IN ('pending', 'claimed')`,
      [tenantId, postId]
    );
  }

  const rows = await query<any>(
    `UPDATE iao.social_posts
     SET caption = $1,
         hashtags = $2,
         video_script = $3,
         target_platforms = $4,
         media_urls = $5,
         scheduled_at = $6,
         is_approved = $7,
         approval_snapshot_hash = $8,
         status = $9,
         approved_at = CASE WHEN $7 = false THEN NULL ELSE approved_at END,
         updated_at = NOW()
     WHERE tenant_id = $10 AND id = $11
     RETURNING *`,
    [
      newCaption,
      JSON.stringify(newHashtags),
      data.video_script !== undefined ? data.video_script : existing.video_script,
      JSON.stringify(newPlatforms),
      JSON.stringify(newMedia),
      data.scheduled_at !== undefined ? (data.scheduled_at ? new Date(data.scheduled_at) : null) : (existing.scheduled_at ? new Date(existing.scheduled_at) : null),
      newIsApproved,
      newIsApproved ? newHash : null,
      newStatus,
      tenantId,
      postId,
    ]
  );

  const updated = await getSocialPostById(tenantId, postId);
  return updated!;
}

export async function approveSocialPost(
  tenantId: string,
  postId: string,
  approvedBy: string,
  scheduledAt?: string | Date
): Promise<SocialPostRecord> {
  const existing = await getSocialPostById(tenantId, postId);
  if (!existing) {
    throw new Error(`Post not found: ${postId}`);
  }

  const finalScheduledAt = scheduledAt ? new Date(scheduledAt) : (existing.scheduled_at ? new Date(existing.scheduled_at) : new Date(Date.now() + 3600000));
  const hash = computeSocialApprovalSnapshotHash({
    caption: existing.caption,
    hashtags: existing.hashtags,
    target_platforms: existing.target_platforms,
    media_urls: existing.media_urls,
  });

  await query(
    `UPDATE iao.social_posts
     SET is_approved = true,
         approved_by = $1,
         approved_at = NOW(),
         approval_snapshot_hash = $2,
         status = 'scheduled',
         scheduled_at = $3,
         updated_at = NOW()
     WHERE tenant_id = $4 AND id = $5`,
    [approvedBy, hash, finalScheduledAt, tenantId, postId]
  );

  const updated = (await getSocialPostById(tenantId, postId))!;
  await createSocialPublishingJobsForPost(tenantId, updated);
  return updated;
}

export async function cancelSocialPost(
  tenantId: string,
  postId: string,
  cancellationReason: string
): Promise<SocialPostRecord> {
  await query(
    `UPDATE iao.social_posts
     SET status = 'cancelled',
         cancellation_reason = $1,
         updated_at = NOW()
     WHERE tenant_id = $2 AND id = $3`,
    [cancellationReason, tenantId, postId]
  );

  await query(
    `UPDATE iao.social_publishing_jobs
     SET status = 'cancelled',
         error_message = $1,
         updated_at = NOW()
     WHERE tenant_id = $2 AND post_id = $3 AND status IN ('pending', 'claimed')`,
    [`Post cancelled: ${cancellationReason}`, tenantId, postId]
  );

  const updated = await getSocialPostById(tenantId, postId);
  return updated!;
}

// ==========================================
// PUBLISHING JOBS & N8N ORCHESTRATION
// ==========================================

export async function createSocialPublishingJobsForPost(
  tenantId: string,
  post: SocialPostRecord
): Promise<SocialPublishingJobRecord[]> {
  if (!post.target_platforms || post.target_platforms.length === 0) {
    return [];
  }

  const createdJobs: SocialPublishingJobRecord[] = [];
  const scheduledTime = post.scheduled_at ? new Date(post.scheduled_at).toISOString() : new Date().toISOString();

  for (const platform of post.target_platforms) {
    // Check connection for destination
    const conn = await getSocialConnection(tenantId, platform);
    const dest = conn?.selected_destinations?.[0] || {
      id: `${platform}_default_${tenantId}`,
      name: `${platform.toUpperCase()} (${tenantId})`,
      platform,
    };

    // Stable per-destination idempotency key
    const idempotencyKey = computeSha256(
      `${tenantId}:${post.id}:${platform}:${dest.id}:${scheduledTime}`
    );

    const rows = await query<any>(
      `INSERT INTO iao.social_publishing_jobs (
        tenant_id, post_id, platform, destination_id, destination_name,
        status, scheduled_at, idempotency_key, is_simulated, updated_at
      ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, NOW())
      ON CONFLICT (idempotency_key) DO UPDATE SET
        scheduled_at = EXCLUDED.scheduled_at,
        updated_at = NOW()
      RETURNING *`,
      [
        tenantId,
        post.id,
        platform,
        dest.id,
        dest.name,
        new Date(scheduledTime),
        idempotencyKey,
        conn?.status !== 'connected', // If not fully live connected, flag as simulated
      ]
    );

    const r = rows[0];
    createdJobs.push({
      id: r.id,
      tenant_id: r.tenant_id,
      post_id: r.post_id,
      platform: r.platform,
      destination_id: r.destination_id,
      destination_name: r.destination_name,
      status: r.status,
      scheduled_at: r.scheduled_at.toISOString(),
      attempt_count: r.attempt_count,
      max_attempts: r.max_attempts,
      idempotency_key: r.idempotency_key,
      is_simulated: Boolean(r.is_simulated),
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    });
  }

  return createdJobs;
}

export async function claimDueSocialPublishingJobs(
  limit: number = 10,
  workerId: string = 'n8n_social_worker'
): Promise<(SocialPublishingJobRecord & { post: SocialPostRecord })[]> {
  // 1. Recover stale claims (> 5 minutes old in 'claimed' or 'publishing' status)
  await query(
    `UPDATE iao.social_publishing_jobs
     SET status = 'pending',
         claimed_at = NULL,
         claimed_by_worker = NULL,
         updated_at = NOW()
     WHERE status IN ('claimed', 'publishing')
       AND claimed_at < NOW() - INTERVAL '5 minutes'
       AND attempt_count < max_attempts`
  );

  // 2. Atomically claim due jobs using FOR UPDATE SKIP LOCKED
  const claimedRows = await query<any>(
    `WITH candidate_jobs AS (
      SELECT j.id
      FROM iao.social_publishing_jobs j
      JOIN iao.social_posts p ON p.id = j.post_id
      JOIN iao.social_brand_settings b ON b.tenant_id = j.tenant_id
      WHERE j.status = 'pending'
        AND j.scheduled_at <= NOW()
        AND j.attempt_count < j.max_attempts
        AND b.is_automation_paused = false
        AND p.status NOT IN ('cancelled', 'published')
        AND (b.automation_mode = 'autopilot' OR p.is_approved = true)
      ORDER BY j.scheduled_at ASC
      LIMIT $1
      FOR UPDATE OF j SKIP LOCKED
    )
    UPDATE iao.social_publishing_jobs j
    SET status = 'claimed',
        claimed_at = NOW(),
        claimed_by_worker = $2,
        attempt_count = attempt_count + 1,
        last_attempt_at = NOW(),
        updated_at = NOW()
    FROM candidate_jobs c
    WHERE j.id = c.id
    RETURNING j.*`,
    [limit, workerId]
  );

  if (claimedRows.length === 0) {
    return [];
  }

  // Load associated post data for claimed jobs
  const results: (SocialPublishingJobRecord & { post: SocialPostRecord })[] = [];
  for (const r of claimedRows) {
    const post = await getSocialPostById(r.tenant_id, r.post_id);
    if (!post) continue;

    results.push({
      id: r.id,
      tenant_id: r.tenant_id,
      post_id: r.post_id,
      platform: r.platform,
      destination_id: r.destination_id,
      destination_name: r.destination_name,
      status: r.status,
      scheduled_at: r.scheduled_at.toISOString(),
      claimed_at: r.claimed_at?.toISOString(),
      claimed_by_worker: r.claimed_by_worker,
      attempt_count: r.attempt_count,
      max_attempts: r.max_attempts,
      last_attempt_at: r.last_attempt_at?.toISOString(),
      idempotency_key: r.idempotency_key,
      is_simulated: Boolean(r.is_simulated),
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
      post,
    });
  }

  return results;
}

export async function updatePublishingJobOutcome(
  jobId: string,
  outcome: {
    status: 'published' | 'simulated' | 'failed' | 'cancelled';
    provider_post_id?: string;
    provider_post_url?: string;
    error_message?: string;
    error_code?: string;
    raw_response?: Record<string, any>;
  }
): Promise<SocialPublishingJobRecord> {
  const rows = await query<any>(
    `UPDATE iao.social_publishing_jobs
     SET status = $1,
         provider_post_id = $2,
         provider_post_url = $3,
         error_message = $4,
         error_code = $5,
         raw_response = $6,
         updated_at = NOW()
     WHERE id = $7
     RETURNING *`,
    [
      outcome.status,
      outcome.provider_post_id || null,
      outcome.provider_post_url || null,
      outcome.error_message || null,
      outcome.error_code || null,
      JSON.stringify(outcome.raw_response || {}),
      jobId,
    ]
  );

  const r = rows[0];
  const updatedJob: SocialPublishingJobRecord = {
    id: r.id,
    tenant_id: r.tenant_id,
    post_id: r.post_id,
    platform: r.platform,
    destination_id: r.destination_id,
    destination_name: r.destination_name,
    status: r.status,
    scheduled_at: r.scheduled_at.toISOString(),
    attempt_count: r.attempt_count,
    max_attempts: r.max_attempts,
    idempotency_key: r.idempotency_key,
    provider_post_id: r.provider_post_id,
    provider_post_url: r.provider_post_url,
    error_message: r.error_message,
    error_code: r.error_code,
    raw_response: r.raw_response,
    is_simulated: Boolean(r.is_simulated),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };

  // Record audit entry
  await query(
    `INSERT INTO iao.social_publishing_attempts (
      tenant_id, job_id, post_id, platform, destination_id,
      attempt_number, status, is_simulated, idempotency_key,
      provider_post_id, provider_post_url, error_message, error_code,
      response_payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      updatedJob.tenant_id,
      updatedJob.id,
      updatedJob.post_id,
      updatedJob.platform,
      updatedJob.destination_id,
      updatedJob.attempt_count,
      outcome.status,
      updatedJob.is_simulated,
      updatedJob.idempotency_key,
      outcome.provider_post_id || null,
      outcome.provider_post_url || null,
      outcome.error_message || null,
      outcome.error_code || null,
      JSON.stringify(outcome.raw_response || {}),
    ]
  );

  // Reconcile parent post status across all platform jobs
  await reconcileSocialPostStatus(updatedJob.tenant_id, updatedJob.post_id);

  return updatedJob;
}

export async function reconcileSocialPostStatus(tenantId: string, postId: string): Promise<void> {
  const jobs = await query<any>(
    `SELECT status, is_simulated FROM iao.social_publishing_jobs
     WHERE tenant_id = $1 AND post_id = $2`,
    [tenantId, postId]
  );

  if (jobs.length === 0) return;

  const allFinished = jobs.every((j) => ['published', 'simulated', 'failed', 'cancelled'].includes(j.status));
  const hasPublished = jobs.some((j) => j.status === 'published');
  const hasSimulated = jobs.some((j) => j.status === 'simulated');
  const hasFailed = jobs.some((j) => j.status === 'failed');

  let newStatus: SocialPostStatus = 'publishing';

  if (allFinished) {
    if (hasPublished && !hasFailed) {
      newStatus = 'published';
    } else if (hasSimulated && !hasPublished && !hasFailed) {
      newStatus = 'simulated';
    } else if ((hasPublished || hasSimulated) && hasFailed) {
      newStatus = 'partially_published';
    } else if (hasFailed) {
      newStatus = 'failed';
    }
  }

  await query(
    `UPDATE iao.social_posts
     SET status = $1,
         published_at = CASE WHEN $1 IN ('published', 'simulated', 'partially_published') THEN COALESCE(published_at, NOW()) ELSE published_at END,
         updated_at = NOW()
     WHERE tenant_id = $2 AND id = $3`,
    [newStatus, tenantId, postId]
  );
}

// ==========================================
// OAUTH STATE MANAGEMENT
// ==========================================

export async function saveSocialOAuthState(
  stateToken: string,
  tenantId: string,
  userId: string,
  platform: SocialPlatform,
  redirectUri: string,
  codeVerifier?: string
): Promise<void> {
  await query(
    `INSERT INTO iao.social_oauth_states (
      state_token, tenant_id, user_id, platform, redirect_uri, code_verifier, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '15 minutes')
    ON CONFLICT (state_token) DO NOTHING`,
    [stateToken, tenantId, userId, platform, redirectUri, codeVerifier || null]
  );
}

export async function verifyAndConsumeSocialOAuthState(
  stateToken: string
): Promise<{ tenant_id: string; user_id: string; platform: SocialPlatform; redirect_uri: string; code_verifier?: string } | null> {
  const rows = await query<any>(
    `DELETE FROM iao.social_oauth_states
     WHERE state_token = $1 AND expires_at > NOW()
     RETURNING tenant_id, user_id, platform, redirect_uri, code_verifier`,
    [stateToken]
  );

  if (rows.length === 0) return null;
  return rows[0];
}

// ==========================================
// PUBLISHING MODE & ENVIRONMENT GATE
// ==========================================

export function getEffectivePublishingMode(
  tenantPublishingMode: 'simulation' | 'live',
  connections: SocialConnectionRecord[]
): {
  effective_mode: 'simulation' | 'live';
  live_publishing_gate_enabled: boolean;
  block_reason?: string;
} {
  const gateEnabled = process.env.ENABLE_LIVE_SOCIAL_PUBLISHING === 'true';

  if (!gateEnabled) {
    return {
      effective_mode: 'simulation',
      live_publishing_gate_enabled: false,
      block_reason: 'Live publishing is locked by server environment gate (ENABLE_LIVE_SOCIAL_PUBLISHING is not true). Operating in Safe Simulation Mode.',
    };
  }

  if (tenantPublishingMode !== 'live') {
    return {
      effective_mode: 'simulation',
      live_publishing_gate_enabled: true,
      block_reason: 'Workspace is set to Simulation Mode (Owner setting).',
    };
  }

  const hasLiveConnected = connections.some((c) => c.status === 'connected' && c.encrypted_access_token);
  if (!hasLiveConnected) {
    return {
      effective_mode: 'simulation',
      live_publishing_gate_enabled: true,
      block_reason: 'No verified live social connection with active tokens. Operating in Safe Simulation Mode.',
    };
  }

  return {
    effective_mode: 'live',
    live_publishing_gate_enabled: true,
  };
}

// ==========================================
// DASHBOARD SUMMARY
// ==========================================

export async function getSocialDashboardSummary(tenantId: string): Promise<SocialDashboardSummary> {
  const settings = await getSocialBrandSettings(tenantId);
  const connections = await getSocialConnections(tenantId);
  const { getMediaProviderStatuses } = await import('./media-providers/index.ts');

  const statsRow = await query<any>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled_count,
       COUNT(*) FILTER (WHERE status = 'pending_approval') AS pending_approval_count,
       COUNT(*) FILTER (WHERE status = 'published') AS published_count,
       COUNT(*) FILTER (WHERE status = 'simulated') AS simulated_count,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed_count
     FROM iao.social_posts
     WHERE tenant_id = $1`,
    [tenantId]
  );

  const s = statsRow[0] || {};
  const allPlatforms: SocialPlatform[] = ['facebook', 'instagram', 'tiktok'];

  const platformStatuses = allPlatforms.map((p) => {
    const conn = connections.find((c) => c.platform === p);
    return {
      platform: p,
      connected: conn?.status === 'connected',
      account_name: conn?.account_name,
      destinations_count: conn?.selected_destinations?.length || 0,
      status: conn?.status || 'setup_required',
    };
  });

  const modeInfo = getEffectivePublishingMode(settings.publishing_mode, connections);

  return {
    connected_accounts_count: connections.filter((c) => c.status === 'connected').length,
    scheduled_posts_count: Number(s.scheduled_count) || 0,
    pending_approval_count: Number(s.pending_approval_count) || 0,
    published_count: Number(s.published_count) || 0,
    simulated_count: Number(s.simulated_count) || 0,
    failed_count: Number(s.failed_count) || 0,
    automation_mode: settings.automation_mode,
    publishing_mode: settings.publishing_mode,
    effective_publishing_mode: modeInfo.effective_mode,
    live_publishing_gate_enabled: modeInfo.live_publishing_gate_enabled,
    live_publishing_block_reason: modeInfo.block_reason,
    is_automation_paused: settings.is_automation_paused,
    generations_used: settings.monthly_generations_used,
    generations_limit: settings.monthly_generation_limit,
    platforms: platformStatuses,
    media_providers: getMediaProviderStatuses(),
  };
}

export async function getSocialPublishingJobs(
  tenantId: string,
  limit: number = 50
): Promise<SocialPublishingJobRecord[]> {
  const rows = await query<any>(
    `SELECT * FROM iao.social_publishing_jobs
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, limit]
  );

  return rows.map((r) => ({
    id: r.id,
    tenant_id: r.tenant_id,
    post_id: r.post_id,
    platform: r.platform,
    destination_id: r.destination_id,
    destination_name: r.destination_name,
    status: r.status,
    scheduled_at: r.scheduled_at.toISOString(),
    claimed_at: r.claimed_at?.toISOString(),
    claimed_by_worker: r.claimed_by_worker,
    attempt_count: r.attempt_count,
    max_attempts: r.max_attempts,
    last_attempt_at: r.last_attempt_at?.toISOString(),
    idempotency_key: r.idempotency_key,
    provider_post_id: r.provider_post_id,
    provider_post_url: r.provider_post_url,
    error_message: r.error_message,
    error_code: r.error_code,
    raw_response: r.raw_response,
    is_simulated: Boolean(r.is_simulated),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  }));
}

// ==========================================
// SOCIAL GENERATION JOBS
// ==========================================

export async function createSocialGenerationJob(
  tenantId: string,
  options: {
    theme?: string;
    custom_instruction?: string;
    target_platforms?: SocialPlatform[];
    language?: string;
    save_as_post?: boolean;
    scheduled_at?: string;
  },
  idempotencyKey?: string,
  createdBy?: string
): Promise<SocialGenerationJobRecord> {
  const jobId = `sgjob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const rows = await query<any>(
    `INSERT INTO iao.social_generation_jobs (
      id, tenant_id, status, stage_label, stage_progress, idempotency_key, options, created_by
    ) VALUES ($1, $2, 'queued', 'Queued in orchestrator', 5, $3, $4::jsonb, $5)
    RETURNING *`,
    [jobId, tenantId, idempotencyKey || null, JSON.stringify(options || {}), createdBy || null]
  );

  const r = rows[0];
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    status: r.status,
    stage_label: r.stage_label,
    stage_progress: r.stage_progress,
    error_message: r.error_message,
    idempotency_key: r.idempotency_key,
    options: r.options,
    selected_concept: r.selected_concept,
    generated_draft: r.generated_draft,
    media_result: r.media_result,
    post_id: r.post_id,
    n8n_execution_id: r.n8n_execution_id,
    created_by: r.created_by,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export async function findActiveSocialGenerationJobByIdempotency(
  tenantId: string,
  idempotencyKey: string
): Promise<SocialGenerationJobRecord | null> {
  if (!idempotencyKey) return null;

  const rows = await query<any>(
    `SELECT * FROM iao.social_generation_jobs
     WHERE tenant_id = $1 AND idempotency_key = $2 AND status NOT IN ('failed', 'ready')
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, idempotencyKey]
  );

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    status: r.status,
    stage_label: r.stage_label,
    stage_progress: r.stage_progress,
    error_message: r.error_message,
    idempotency_key: r.idempotency_key,
    options: r.options,
    selected_concept: r.selected_concept,
    generated_draft: r.generated_draft,
    media_result: r.media_result,
    post_id: r.post_id,
    n8n_execution_id: r.n8n_execution_id,
    created_by: r.created_by,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export async function getSocialGenerationJob(
  jobId: string,
  tenantId?: string
): Promise<SocialGenerationJobRecord | null> {
  const params: any[] = [jobId];
  let sql = `SELECT * FROM iao.social_generation_jobs WHERE id = $1`;
  if (tenantId) {
    params.push(tenantId);
    sql += ` AND tenant_id = $2`;
  }
  sql += ` LIMIT 1`;

  const rows = await query<any>(sql, params);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    status: r.status,
    stage_label: r.stage_label,
    stage_progress: r.stage_progress,
    error_message: r.error_message,
    idempotency_key: r.idempotency_key,
    options: r.options,
    selected_concept: r.selected_concept,
    generated_draft: r.generated_draft,
    media_result: r.media_result,
    post_id: r.post_id,
    n8n_execution_id: r.n8n_execution_id,
    created_by: r.created_by,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export async function updateSocialGenerationJob(
  jobId: string,
  updates: {
    status?: SocialGenerationJobStage;
    stage_label?: string;
    stage_progress?: number;
    error_message?: string | null;
    selected_concept?: any;
    generated_draft?: any;
    media_result?: any;
    post_id?: string | null;
    n8n_execution_id?: string | null;
  }
): Promise<SocialGenerationJobRecord | null> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: any[] = [jobId];
  let paramIdx = 2;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIdx++}`);
    params.push(updates.status);
  }
  if (updates.stage_label !== undefined) {
    setClauses.push(`stage_label = $${paramIdx++}`);
    params.push(updates.stage_label);
  }
  if (updates.stage_progress !== undefined) {
    setClauses.push(`stage_progress = $${paramIdx++}`);
    params.push(updates.stage_progress);
  }
  if (updates.error_message !== undefined) {
    setClauses.push(`error_message = $${paramIdx++}`);
    params.push(updates.error_message);
  }
  if (updates.selected_concept !== undefined) {
    setClauses.push(`selected_concept = $${paramIdx++}::jsonb`);
    params.push(JSON.stringify(updates.selected_concept));
  }
  if (updates.generated_draft !== undefined) {
    setClauses.push(`generated_draft = $${paramIdx++}::jsonb`);
    params.push(JSON.stringify(updates.generated_draft));
  }
  if (updates.media_result !== undefined) {
    setClauses.push(`media_result = $${paramIdx++}::jsonb`);
    params.push(JSON.stringify(updates.media_result));
  }
  if (updates.post_id !== undefined) {
    setClauses.push(`post_id = $${paramIdx++}`);
    params.push(updates.post_id);
  }
  if (updates.n8n_execution_id !== undefined) {
    setClauses.push(`n8n_execution_id = $${paramIdx++}`);
    params.push(updates.n8n_execution_id);
  }

  const rows = await query<any>(
    `UPDATE iao.social_generation_jobs
     SET ${setClauses.join(', ')}
     WHERE id = $1
     RETURNING *`,
    params
  );

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    status: r.status,
    stage_label: r.stage_label,
    stage_progress: r.stage_progress,
    error_message: r.error_message,
    idempotency_key: r.idempotency_key,
    options: r.options,
    selected_concept: r.selected_concept,
    generated_draft: r.generated_draft,
    media_result: r.media_result,
    post_id: r.post_id,
    n8n_execution_id: r.n8n_execution_id,
    created_by: r.created_by,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

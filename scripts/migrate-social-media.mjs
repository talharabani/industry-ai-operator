import { Pool } from 'pg';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let dbUrl = process.env.DATABASE_URL;
try {
  const envContent = fs.readFileSync(join(__dirname, '../.env.local'), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('DATABASE_URL=')) {
      dbUrl = trimmed.replace(/^DATABASE_URL=/, '').replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // ignore
}

if (!dbUrl) {
  dbUrl = 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo';
}

console.log('Running Social Media Autopilot Migration on:', dbUrl.replace(/:[^:@]+@/, ':****@'));
const pool = new Pool({ connectionString: dbUrl });

export async function runSocialMediaMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Social Connections Table
    await client.query(`
      DROP TABLE IF EXISTS iao.social_publishing_attempts CASCADE;
      DROP TABLE IF EXISTS iao.social_publishing_jobs CASCADE;
      DROP TABLE IF EXISTS iao.social_posts CASCADE;
      DROP TABLE IF EXISTS iao.social_media_assets CASCADE;
      DROP TABLE IF EXISTS iao.social_brand_settings CASCADE;
      DROP TABLE IF EXISTS iao.social_connections CASCADE;
      DROP TABLE IF EXISTS iao.social_oauth_states CASCADE;

      CREATE TABLE iao.social_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL REFERENCES iao.businesses(tenant_id) ON DELETE CASCADE,
        platform TEXT NOT NULL, -- 'facebook' | 'instagram' | 'tiktok'
        account_id TEXT NOT NULL,
        account_name TEXT NOT NULL,
        account_handle TEXT,
        status TEXT NOT NULL DEFAULT 'setup_required', -- 'connected' | 'setup_required' | 'permission_required' | 'expired' | 'disconnected'
        scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
        selected_destinations JSONB NOT NULL DEFAULT '[]'::jsonb,
        encrypted_access_token TEXT,
        encrypted_refresh_token TEXT,
        token_expires_at TIMESTAMPTZ,
        setup_instructions TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        connected_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_social_conn_tenant_platform UNIQUE(tenant_id, platform)
      );

      CREATE INDEX idx_social_conn_tenant ON iao.social_connections(tenant_id);
    `);

    // 2. Social Brand & Content Settings Table
    await client.query(`
      CREATE TABLE iao.social_brand_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL UNIQUE REFERENCES iao.businesses(tenant_id) ON DELETE CASCADE,
        automation_mode TEXT NOT NULL DEFAULT 'review_required', -- 'review_required' | 'autopilot'
        is_automation_paused BOOLEAN NOT NULL DEFAULT false,
        language TEXT NOT NULL DEFAULT 'English',
        tone TEXT NOT NULL DEFAULT 'Professional, friendly, and authentic',
        target_audience TEXT NOT NULL DEFAULT 'Local clients and customers',
        content_themes JSONB NOT NULL DEFAULT '[]'::jsonb,
        prohibited_topics JSONB NOT NULL DEFAULT '[]'::jsonb,
        selected_platforms JSONB NOT NULL DEFAULT '["facebook", "instagram"]'::jsonb,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        posting_days JSONB NOT NULL DEFAULT '[1, 3, 5]'::jsonb,
        posting_times JSONB NOT NULL DEFAULT '["10:00", "16:00"]'::jsonb,
        weekly_post_limit INT NOT NULL DEFAULT 5,
        monthly_generation_limit INT NOT NULL DEFAULT 30,
        monthly_generations_used INT NOT NULL DEFAULT 0,
        generation_cycle_reset_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_social_settings_tenant ON iao.social_brand_settings(tenant_id);
    `);

    // 3. Social Media Assets Table
    await client.query(`
      CREATE TABLE iao.social_media_assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL REFERENCES iao.businesses(tenant_id) ON DELETE CASCADE,
        media_type TEXT NOT NULL DEFAULT 'image', -- 'image' | 'video'
        storage_url TEXT NOT NULL,
        filename TEXT NOT NULL,
        filesize_bytes BIGINT,
        mime_type TEXT,
        source TEXT NOT NULL DEFAULT 'owner_upload', -- 'owner_upload' | 'ai_generated' | 'template'
        dimensions JSONB,
        duration_seconds NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_social_assets_tenant ON iao.social_media_assets(tenant_id);
    `);

    // 4. Social Posts Table
    await client.query(`
      CREATE TABLE iao.social_posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL REFERENCES iao.businesses(tenant_id) ON DELETE CASCADE,
        brand_settings_id UUID REFERENCES iao.social_brand_settings(id) ON DELETE SET NULL,
        campaign_name TEXT,
        topic_theme TEXT,
        caption TEXT NOT NULL,
        hashtags JSONB NOT NULL DEFAULT '[]'::jsonb,
        video_script TEXT,
        target_platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending_approval', -- 'generating' | 'draft' | 'pending_approval' | 'scheduled' | 'publishing' | 'published' | 'partially_published' | 'failed' | 'cancelled' | 'simulated'
        media_asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
        scheduled_at TIMESTAMPTZ,
        published_at TIMESTAMPTZ,
        is_approved BOOLEAN NOT NULL DEFAULT false,
        approved_by TEXT,
        approved_at TIMESTAMPTZ,
        approval_snapshot_hash TEXT,
        rejection_reason TEXT,
        cancellation_reason TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_social_posts_tenant ON iao.social_posts(tenant_id);
      CREATE INDEX idx_social_posts_status ON iao.social_posts(tenant_id, status);
      CREATE INDEX idx_social_posts_scheduled ON iao.social_posts(scheduled_at) WHERE status = 'scheduled';
    `);

    // 5. Social Publishing Jobs Table
    await client.query(`
      CREATE TABLE iao.social_publishing_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL REFERENCES iao.businesses(tenant_id) ON DELETE CASCADE,
        post_id UUID NOT NULL REFERENCES iao.social_posts(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        destination_id TEXT NOT NULL,
        destination_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'claimed' | 'publishing' | 'published' | 'simulated' | 'failed' | 'cancelled'
        scheduled_at TIMESTAMPTZ NOT NULL,
        claimed_at TIMESTAMPTZ,
        claimed_by_worker TEXT,
        attempt_count INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 3,
        last_attempt_at TIMESTAMPTZ,
        idempotency_key TEXT NOT NULL UNIQUE,
        provider_post_id TEXT,
        provider_post_url TEXT,
        error_message TEXT,
        error_code TEXT,
        raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_simulated BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_social_jobs_claim ON iao.social_publishing_jobs(status, scheduled_at);
      CREATE INDEX idx_social_jobs_tenant ON iao.social_publishing_jobs(tenant_id);
    `);

    // 6. Social Publishing Attempts / Audit Log Table
    await client.query(`
      CREATE TABLE iao.social_publishing_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL REFERENCES iao.businesses(tenant_id) ON DELETE CASCADE,
        job_id UUID NOT NULL REFERENCES iao.social_publishing_jobs(id) ON DELETE CASCADE,
        post_id UUID NOT NULL REFERENCES iao.social_posts(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        destination_id TEXT NOT NULL,
        attempt_number INT NOT NULL,
        status TEXT NOT NULL,
        is_simulated BOOLEAN NOT NULL,
        idempotency_key TEXT NOT NULL,
        provider_post_id TEXT,
        provider_post_url TEXT,
        error_message TEXT,
        error_code TEXT,
        response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_social_attempts_tenant ON iao.social_publishing_attempts(tenant_id);
      CREATE INDEX idx_social_attempts_job ON iao.social_publishing_attempts(job_id);
    `);

    // 7. Social OAuth States Table
    await client.query(`
      CREATE TABLE iao.social_oauth_states (
        state_token TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES iao.businesses(tenant_id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_verifier TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_social_oauth_states_lookup ON iao.social_oauth_states(state_token, expires_at);
    `);

    await client.query('COMMIT');
    console.log('Social Media Autopilot schema migration completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSocialMediaMigration()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

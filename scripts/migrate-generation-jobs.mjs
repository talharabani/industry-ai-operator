import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS iao.social_generation_jobs (
      id VARCHAR(64) PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL REFERENCES iao.businesses(tenant_id) ON DELETE CASCADE,
      status VARCHAR(32) NOT NULL DEFAULT 'queued',
      stage_label VARCHAR(128) NOT NULL DEFAULT 'Queued',
      stage_progress INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      idempotency_key VARCHAR(128),
      options JSONB DEFAULT '{}'::jsonb,
      selected_concept JSONB,
      generated_draft JSONB,
      media_result JSONB,
      post_id UUID REFERENCES iao.social_posts(id) ON DELETE SET NULL,
      n8n_execution_id VARCHAR(64),
      created_by VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_social_gen_jobs_tenant ON iao.social_generation_jobs(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_social_gen_jobs_status ON iao.social_generation_jobs(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_social_gen_jobs_idempotency ON iao.social_generation_jobs(tenant_id, idempotency_key) WHERE status NOT IN ('failed', 'ready');
  `);

  console.log('Successfully created iao.social_generation_jobs table and indexes!');
  await pool.end();
}

migrate().catch(console.error);

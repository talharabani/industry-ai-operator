import pg from 'pg';
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

console.log('Running Publishing Mode & Scheduling Migration on:', dbUrl.replace(/:[^:@]+@/, ':****@'));
const { Pool } = pg;
const pool = new Pool({ connectionString: dbUrl });

export async function runPublishingModeMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Add publishing_mode and schedule_anchor_at to social_brand_settings if not present
    await client.query(`
      ALTER TABLE iao.social_brand_settings 
      ADD COLUMN IF NOT EXISTS publishing_mode TEXT NOT NULL DEFAULT 'simulation',
      ADD COLUMN IF NOT EXISTS schedule_anchor_at TIMESTAMPTZ;
    `);

    // 2. Add slot_key to social_posts to guarantee single post per scheduled slot
    await client.query(`
      ALTER TABLE iao.social_posts 
      ADD COLUMN IF NOT EXISTS slot_key TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_social_posts_tenant_slot 
      ON iao.social_posts(tenant_id, slot_key) 
      WHERE slot_key IS NOT NULL;
    `);

    // 3. Add generated_media_details to social_media_assets
    await client.query(`
      ALTER TABLE iao.social_media_assets
      ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'owner_upload',
      ADD COLUMN IF NOT EXISTS prompt TEXT;
    `);

    await client.query('COMMIT');
    console.log('✓ Publishing Mode & Slot Deduplication schema updated successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPublishingModeMigration()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

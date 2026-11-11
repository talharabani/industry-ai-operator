import { Pool } from 'pg';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

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

console.log('Running Additive Multi-Business & Services Pack Migration on:', dbUrl.replace(/:[^:@]+@/, ':****@'));
const pool = new Pool({ connectionString: dbUrl });

export async function runServicesPackMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Business Members table for Workspace Auth & Multi-business memberships
    await client.query(`
      CREATE TABLE IF NOT EXISTS iao.business_members (
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        role TEXT NOT NULL DEFAULT 'member',
        can_approve BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_business_members_user ON iao.business_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_business_members_email ON iao.business_members(email);
      CREATE INDEX IF NOT EXISTS idx_business_members_tenant ON iao.business_members(tenant_id);
    `);

    // 2. Add public_form_id and business_type to businesses if not exists
    await client.query(`
      ALTER TABLE iao.businesses ADD COLUMN IF NOT EXISTS public_form_id TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_public_form_id ON iao.businesses(public_form_id) WHERE public_form_id IS NOT NULL;
    `);

    // 3. Services Leads table
    await client.query(`
      CREATE TABLE IF NOT EXISTS iao.services_leads (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        customer_phone TEXT,
        service_interest TEXT,
        stage TEXT NOT NULL DEFAULT 'new',
        status TEXT NOT NULL DEFAULT 'open',
        assigned_member_id TEXT,
        assigned_member_name TEXT,
        next_action TEXT,
        due_date TIMESTAMPTZ,
        estimated_value NUMERIC DEFAULT 0.00,
        currency TEXT DEFAULT 'USD',
        source TEXT NOT NULL DEFAULT 'hosted_inquiry',
        conversation_id TEXT,
        budget_range TEXT,
        location TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMPTZ
      );

      ALTER TABLE iao.services_leads ADD COLUMN IF NOT EXISTS reminder_count INT NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_services_leads_tenant_stage ON iao.services_leads(tenant_id, stage, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_services_leads_tenant_email ON iao.services_leads(tenant_id, LOWER(customer_email));
      CREATE INDEX IF NOT EXISTS idx_services_leads_conv ON iao.services_leads(tenant_id, conversation_id);
    `);

    // 4. Services Lead Events table (Chronological history & audit trail)
    await client.query(`
      CREATE TABLE IF NOT EXISTS iao.services_lead_events (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        lead_id TEXT NOT NULL REFERENCES iao.services_leads(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        actor_type TEXT NOT NULL DEFAULT 'system',
        actor_id TEXT,
        summary TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_services_lead_events_lead ON iao.services_lead_events(tenant_id, lead_id, created_at ASC);
    `);

    // 5. Services Lead Follow-Up Jobs table (Persistent n8n / backend queue)
    await client.query(`
      CREATE TABLE IF NOT EXISTS iao.services_lead_followup_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        lead_id TEXT NOT NULL REFERENCES iao.services_leads(id) ON DELETE CASCADE,
        conversation_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        followup_type TEXT NOT NULL DEFAULT 'initial_inquiry_followup',
        attempt_count INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 2,
        scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        claimed_at TIMESTAMPTZ,
        claimed_by TEXT,
        execution_retry_count INT NOT NULL DEFAULT 0,
        last_error TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_services_followup_jobs_claim ON iao.services_lead_followup_jobs(status, scheduled_for ASC);
      CREATE INDEX IF NOT EXISTS idx_services_followup_jobs_lead ON iao.services_lead_followup_jobs(tenant_id, lead_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_active_services_followup_job 
        ON iao.services_lead_followup_jobs(tenant_id, lead_id, followup_type) 
        WHERE status IN ('pending', 'claimed');
    `);

    // 6. Backfill business_members and public_form_id for all existing businesses
    const bizRes = await client.query('SELECT tenant_id, settings, public_form_id FROM iao.businesses');
    for (const row of bizRes.rows) {
      const tenantId = row.tenant_id;
      const settings = row.settings || {};

      // Ensure public_form_id
      if (!row.public_form_id) {
        const formId = `form_${crypto.createHash('sha256').update(tenantId + '_public_form').digest('hex').slice(0, 12)}`;
        await client.query('UPDATE iao.businesses SET public_form_id = $1 WHERE tenant_id = $2', [formId, tenantId]);
      }

      // Sync team members into business_members
      const members = Array.isArray(settings.team_members) ? settings.team_members : [];
      let hasOwner = false;
      for (const m of members) {
        if (!m.id || !m.email) continue;
        const role = m.role || 'member';
        if (role === 'owner') hasOwner = true;
        await client.query(`
          INSERT INTO iao.business_members (tenant_id, user_id, email, name, role, can_approve)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (tenant_id, user_id) DO UPDATE
            SET email = EXCLUDED.email,
                name = EXCLUDED.name,
                role = EXCLUDED.role,
                can_approve = EXCLUDED.can_approve;
        `, [tenantId, m.id, m.email, m.name || m.id, role, Boolean(m.can_approve || role === 'owner')]);
      }

      // If no owner found in team_members, ensure owner-demo is an owner for demo stores
      if (!hasOwner) {
        await client.query(`
          INSERT INTO iao.business_members (tenant_id, user_id, email, name, role, can_approve)
          VALUES ($1, 'owner-demo', 'owner@demo-store.com', 'Store Owner (Demo)', 'owner', true)
          ON CONFLICT (tenant_id, user_id) DO NOTHING;
        `, [tenantId]);
      }
    }

    await client.query('COMMIT');
    console.log('Services Pack & Multi-Business migration applied successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Auto-run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runServicesPackMigration()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

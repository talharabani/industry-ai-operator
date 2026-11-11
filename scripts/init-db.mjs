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

console.log('Using database URL:', dbUrl.replace(/:[^:@]+@/, ':****@'));
const pool = new Pool({ connectionString: dbUrl });

async function initAll() {
  const client = await pool.connect();
  try {
    console.log('Aligning schema iao and core tables...');

    await client.query(`
      CREATE SCHEMA IF NOT EXISTS iao;

      CREATE OR REPLACE FUNCTION iao.dispatch(action text, payload jsonb)
      RETURNS jsonb AS $$
      DECLARE
        v_tenant_id text := payload->>'tenant_id';
        v_pending integer;
        v_completed integer;
        v_created integer;
        v_result jsonb;
      BEGIN
        IF action = 'summary' THEN
          IF v_tenant_id IS NULL OR v_tenant_id = '' THEN
            RAISE EXCEPTION 'tenant_id is required for summary';
          END IF;

          SELECT COUNT(*) INTO v_pending FROM iao.cases WHERE tenant_id = v_tenant_id AND status = 'pending_approval';
          SELECT COUNT(*) INTO v_completed FROM iao.cases WHERE tenant_id = v_tenant_id AND status IN ('demo_completed', 'completed', 'approved') AND updated_at >= NOW() - INTERVAL '24 hours';
          SELECT COUNT(*) INTO v_created FROM iao.cases WHERE tenant_id = v_tenant_id AND created_at >= NOW() - INTERVAL '24 hours';

          v_result := jsonb_build_object(
            'tenant_id', v_tenant_id,
            'period_hours', 24,
            'pending_approvals_all_time', v_pending,
            'completed_last_24h', v_completed,
            'cases_created_last_24h', v_created,
            'timestamp', NOW()
          );
          RETURN v_result;
        END IF;

        RETURN jsonb_build_object('success', true, 'action', action, 'tenant_id', v_tenant_id);
      END;
      $$ LANGUAGE plpgsql;

      -- 1. Businesses
      CREATE TABLE IF NOT EXISTS iao.businesses (
        tenant_id TEXT PRIMARY KEY,
        settings JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- 2. Orders
      CREATE TABLE IF NOT EXISTS iao.orders (
        tenant_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        customer_name TEXT,
        customer_email TEXT,
        items JSONB DEFAULT '[]'::jsonb,
        total NUMERIC DEFAULT 0.00,
        currency TEXT DEFAULT 'PKR',
        status TEXT DEFAULT 'pending',
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, order_id)
      );

      ALTER TABLE iao.orders ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE iao.orders ALTER COLUMN customer_name DROP NOT NULL;
      ALTER TABLE iao.orders ALTER COLUMN customer_email DROP NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tenant_order_id ON iao.orders(tenant_id, order_id);

      -- 3. Cases
      CREATE TABLE IF NOT EXISTS iao.cases (
        tenant_id TEXT NOT NULL,
        case_id TEXT NOT NULL,
        request_id TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_approval',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        proposal JSONB NOT NULL DEFAULT '{}'::jsonb,
        revision INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, case_id)
      );

      -- Ensure case_id column exists if table previously had id
      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'iao' AND table_name = 'cases' AND column_name = 'id') 
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'iao' AND table_name = 'cases' AND column_name = 'case_id') THEN
          ALTER TABLE iao.cases RENAME COLUMN id TO case_id;
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_cases_tenant_status ON iao.cases(tenant_id, status, created_at DESC);

      -- 4. Audit Log (iao.audit)
      CREATE TABLE IF NOT EXISTS iao.audit (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        case_id TEXT,
        event TEXT NOT NULL,
        details JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_audit_tenant ON iao.audit(tenant_id, created_at DESC);

      -- 5. Conversations
      CREATE TABLE IF NOT EXISTS iao.conversations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        customer_phone TEXT,
        channel TEXT NOT NULL DEFAULT 'hosted_inquiry',
        external_thread_id TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        subject TEXT,
        unread BOOLEAN NOT NULL DEFAULT true,
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON iao.conversations (tenant_id, last_message_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_ext_thread ON iao.conversations(tenant_id, external_thread_id);

      -- 6. Messages
      CREATE TABLE IF NOT EXISTS iao.messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES iao.conversations(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        sender_email TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'received',
        approval_status TEXT NOT NULL DEFAULT 'none',
        approved_by TEXT,
        approved_at TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON iao.messages (conversation_id, created_at ASC);

      -- 7. Email Credentials
      CREATE TABLE IF NOT EXISTS iao.email_credentials (
        tenant_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'resend',
        mode TEXT NOT NULL DEFAULT 'demo',
        encrypted_api_key TEXT,
        key_fingerprint TEXT,
        sender_name TEXT,
        sender_email TEXT,
        reply_to TEXT,
        is_verified BOOLEAN NOT NULL DEFAULT false,
        last_tested TIMESTAMPTZ,
        last_error TEXT,
        webhook_signing_secret TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- 8. Message Dispatches
      CREATE TABLE IF NOT EXISTS iao.message_dispatches (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES iao.messages(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES iao.conversations(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        idempotency_key TEXT UNIQUE NOT NULL,
        provider TEXT NOT NULL DEFAULT 'resend',
        provider_message_id TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        recipient_email TEXT NOT NULL,
        sender_email TEXT NOT NULL,
        sender_name TEXT,
        reply_to TEXT,
        subject TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMPTZ,
        last_error TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_dispatches_tenant_status ON iao.message_dispatches(tenant_id, status);

      -- 9. Webhook Events
      CREATE TABLE IF NOT EXISTS iao.webhook_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'resend',
        event_id TEXT UNIQUE NOT NULL,
        event_type TEXT NOT NULL,
        provider_message_id TEXT,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'processed',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- 10. Gmail Connections
      CREATE TABLE IF NOT EXISTS iao.gmail_connections (
        tenant_id TEXT PRIMARY KEY,
        google_email TEXT NOT NULL,
        google_sub TEXT,
        google_name TEXT,
        google_avatar TEXT,
        encrypted_access_token TEXT NOT NULL,
        encrypted_refresh_token TEXT,
        token_expiry TIMESTAMPTZ NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        history_id TEXT,
        initial_sync_completed BOOLEAN NOT NULL DEFAULT false,
        sync_status TEXT NOT NULL DEFAULT 'idle',
        last_synced_at TIMESTAMPTZ,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_email_unique ON iao.gmail_connections(google_email);

      -- 11. OAuth States
      CREATE TABLE IF NOT EXISTS iao.oauth_states (
        state TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        code_verifier TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- 12. Shopify Connections
      CREATE TABLE IF NOT EXISTS iao.shopify_connections (
        tenant_id TEXT PRIMARY KEY,
        shop_domain TEXT NOT NULL,
        encrypted_access_token TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'read_products,read_orders,read_inventory,read_locations',
        is_connected BOOLEAN NOT NULL DEFAULT true,
        sync_status TEXT NOT NULL DEFAULT 'idle',
        last_synced_at TIMESTAMPTZ,
        last_error TEXT,
        store_info JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_shopify_shop_domain ON iao.shopify_connections(shop_domain);

      -- 13. Shopify Sync Jobs
      CREATE TABLE IF NOT EXISTS iao.shopify_sync_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        shop_domain TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        sync_types TEXT[] NOT NULL DEFAULT '{"products","inventory","policies","orders"}',
        progress JSONB NOT NULL DEFAULT '{}'::jsonb,
        summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_details JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_shopify_sync_jobs_tenant ON iao.shopify_sync_jobs(tenant_id, created_at DESC);

      -- 14. Shopify Products
      CREATE TABLE IF NOT EXISTS iao.shopify_products (
        tenant_id TEXT NOT NULL,
        shopify_product_id TEXT NOT NULL,
        title TEXT NOT NULL,
        handle TEXT,
        product_type TEXT,
        vendor TEXT,
        status TEXT DEFAULT 'active',
        variants JSONB NOT NULL DEFAULT '[]'::jsonb,
        options JSONB NOT NULL DEFAULT '[]'::jsonb,
        raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, shopify_product_id)
      );

      CREATE INDEX IF NOT EXISTS idx_shopify_products_tenant ON iao.shopify_products(tenant_id, updated_at DESC);

      -- 15. Order Issues
      CREATE TABLE IF NOT EXISTS iao.order_issues (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        order_id TEXT,
        shop_domain TEXT,
        conversation_id TEXT,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
        next_action TEXT,
        responsible_party TEXT NOT NULL DEFAULT 'system',
        due_date TIMESTAMPTZ,
        resolution_summary TEXT,
        is_escalated BOOLEAN NOT NULL DEFAULT false,
        escalation_summary TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        closed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_order_issues_tenant_status ON iao.order_issues(tenant_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_order_issues_order ON iao.order_issues(tenant_id, order_id);
      CREATE INDEX IF NOT EXISTS idx_order_issues_conversation ON iao.order_issues(tenant_id, conversation_id);

      -- 16. Order Issue Events (Audit Trail)
      CREATE TABLE IF NOT EXISTS iao.order_issue_events (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        issue_id TEXT NOT NULL REFERENCES iao.order_issues(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        actor_type TEXT NOT NULL DEFAULT 'system',
        actor_id TEXT,
        summary TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_order_issue_events_issue ON iao.order_issue_events(tenant_id, issue_id, created_at ASC);

      -- 17. Order Issue Followup Jobs
      CREATE TABLE IF NOT EXISTS iao.order_issue_followup_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        issue_id TEXT NOT NULL REFERENCES iao.order_issues(id) ON DELETE CASCADE,
        conversation_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        followup_type TEXT NOT NULL,
        attempt_count INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 2,
        scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        claimed_at TIMESTAMPTZ,
        claimed_by TEXT,
        last_error TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_order_issue_followups_claim ON iao.order_issue_followup_jobs(status, scheduled_for ASC);
      CREATE INDEX IF NOT EXISTS idx_order_issue_followups_issue ON iao.order_issue_followup_jobs(tenant_id, issue_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_active_task_followup_job ON iao.order_issue_followup_jobs(tenant_id, issue_id, associated_task_id) WHERE status IN ('pending', 'claimed') AND associated_task_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_active_unassociated_followup_job ON iao.order_issue_followup_jobs(tenant_id, issue_id, followup_type) WHERE status IN ('pending', 'claimed') AND associated_task_id IS NULL;
    `);


    // Seed default business settings
    const defaultSettings = {
      industry: 'ecommerce',
      business_name: 'Demo Clothing Store',
      country: 'Pakistan',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
      language: 'English',
      tone: 'friendly and concise',
      automation_mode: 'auto_routine',
      working_hours: {
        start_time: '09:00',
        end_time: '18:00',
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        auto_reply_outside_hours: true,
      },
      permissions: {
        order_confirmation: 'approval_required',
        delay_notification: 'automatic',
        return_refund: 'approval_required',
        exchange_replacement: 'approval_required',
        supplier_purchase: 'approval_required',
        payment_reversal: 'approval_required',
        policy_modification: 'approval_required',
      },
      knowledge: {
        faqs: [
          {
            question: 'What courier service do you use for nationwide deliveries?',
            answer: 'We partner with Trax and TCS Express for all reliable nationwide deliveries across Pakistan.',
          },
          {
            question: 'What is your standard return and exchange window?',
            answer: 'Items in original unworn condition with tags attached can be returned or exchanged within 14 days of confirmed delivery.',
          },
        ],
        policies: {
          return_window_days: 14,
          general_rules: 'Items in original unworn condition with tags attached can be returned or exchanged within 14 days.',
          shipping_timeframe: 'Standard nationwide shipping takes 2-4 business days.',
          restocking_fee_pct: 0,
        },
        products_services: [
          {
            name: 'Classic Leather Jacket',
            sku: 'JKT-CL-01',
            price: 14500,
            currency: 'PKR',
            in_stock: true,
            description: 'Premium genuine black leather jacket with quilted lining.',
          },
          {
            name: 'Oxford Leather Shoes',
            sku: 'SH-OX-02',
            price: 9500,
            currency: 'PKR',
            in_stock: true,
            description: 'Handcrafted formal leather shoes in brown and black.',
          },
          {
            name: 'Casual Denim Shirt',
            sku: 'SH-DN-03',
            price: 4200,
            currency: 'PKR',
            in_stock: true,
            description: '100% cotton washed denim shirt.',
          },
        ],
      },
      team_members: [
        {
          id: 'owner-demo',
          name: 'Store Owner (Demo)',
          email: 'owner@demo-store.com',
          role: 'owner',
          can_approve: true,
          title: 'Primary Business Owner',
          created_at: new Date('2026-09-01T00:00:00Z').toISOString(),
        },
        {
          id: 'admin-sarah',
          name: 'Sarah Jenkins',
          email: 'sarah.j@demo-store.com',
          role: 'admin',
          can_approve: true,
          title: 'Operations Manager',
          created_at: new Date('2026-09-15T00:00:00Z').toISOString(),
        },
      ],
      escalation: {
        unanswered_sla_hours: 4,
        escalate_to_email: 'owner@demo-store.com',
        notify_whatsapp: false,
      },
    };

    await client.query(`
      INSERT INTO iao.businesses (tenant_id, settings, updated_at)
      VALUES 
        ('demo-store', $1, NOW()),
        ('artisan-bakery', $2, NOW()),
        ('urban-tech', $3, NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW();
    `, [
      JSON.stringify(defaultSettings),
      JSON.stringify({ ...defaultSettings, business_name: 'Artisan Fresh Bakery', industry: 'retail' }),
      JSON.stringify({ ...defaultSettings, business_name: 'Urban Tech Gear', industry: 'ecommerce' }),
    ]);

    // Seed verified demo orders
    console.log('Seeding verified sample orders for demo-store...');
    await client.query(`
      INSERT INTO iao.orders (tenant_id, order_id, customer_name, customer_email, status, total, currency, data, created_at, updated_at)
      VALUES
        ('demo-store', 'ORD-1001', 'Ayesha Malik', 'ayesha.m@example.com', 'delivered', 14500, 'PKR', '{"order_id": "ORD-1001", "status": "delivered", "customer_name": "Ayesha Malik", "customer_email": "ayesha.m@example.com", "total": 14500, "currency": "PKR", "items": [{"name": "Classic Leather Jacket", "qty": 1}]}'::jsonb, NOW() - INTERVAL '3 days', NOW()),
        ('demo-store', 'ORD-1002', 'Hassan Raza', 'hassan.raza@example.com', 'shipped', 9500, 'PKR', '{"order_id": "ORD-1002", "status": "shipped", "customer_name": "Hassan Raza", "customer_email": "hassan.raza@example.com", "total": 9500, "currency": "PKR", "items": [{"name": "Oxford Leather Shoes", "qty": 1}]}'::jsonb, NOW() - INTERVAL '1 day', NOW())
      ON CONFLICT (tenant_id, order_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW();
    `);

    console.log('All tables verified and aligned.');
  } finally {
    client.release();
    await pool.end();
  }
}

initAll().catch((err) => {
  console.error('Init failed:', err);
  process.exit(1);
});

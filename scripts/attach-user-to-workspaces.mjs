import { Pool } from 'pg';
import fs from 'fs';

// Load .env.local
let dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo';
try {
  const envContent = fs.readFileSync('.env.local', 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('DATABASE_URL=')) {
      dbUrl = trimmed.replace(/^DATABASE_URL=/, '').replace(/^["']|["']$/g, '');
    }
  }
} catch {}

const TARGET_EMAIL = process.argv[2] || 'talhaishaqrabani@gmail.com';
const TARGET_USER_ID = 'owner-talha';

console.log(`Connecting to PostgreSQL to attach '${TARGET_EMAIL}' to workspaces...`);
const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });

async function attachUser() {
  try {
    const client = await pool.connect();
    console.log('✓ Connected to PostgreSQL database.');

    // Fetch existing tenants
    const bizRes = await client.query('SELECT tenant_id FROM iao.businesses;');
    let tenants = bizRes.rows.map(r => r.tenant_id);
    
    if (tenants.length === 0) {
      tenants = ['demo-store', 'test-retail-bakery', 'apex-plumbing-services'];
      for (const t of tenants) {
        await client.query(`
          INSERT INTO iao.businesses (tenant_id, settings)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (tenant_id) DO NOTHING;
        `, [t, JSON.stringify({ business_name: t.replace(/-/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase()), industry: 'ecommerce' })]);
      }
    }

    console.log(`Attaching '${TARGET_EMAIL}' to ${tenants.length} workspaces:`, tenants);

    for (const tenantId of tenants) {
      await client.query(`
        INSERT INTO iao.business_members (tenant_id, user_id, email, name, role, can_approve)
        VALUES ($1, $2, $3, $4, 'owner', true)
        ON CONFLICT (tenant_id, user_id) 
        DO UPDATE SET email = EXCLUDED.email, role = 'owner', can_approve = true;
      `, [tenantId, TARGET_USER_ID, TARGET_EMAIL, 'Talha Ishaq Rabani']);
      console.log(`  ✓ Linked to workspace: ${tenantId}`);
    }

    // Also ensure user credential exists in iao.user_credentials if table exists
    try {
      await client.query(`
        INSERT INTO iao.user_credentials (user_id, email, password_hash, salt)
        VALUES ($1, $2, 'scrypt_dev_bypass', 'dev_salt')
        ON CONFLICT (email) DO NOTHING;
      `, [TARGET_USER_ID, TARGET_EMAIL]);
    } catch {}

    client.release();
    console.log(`\n🎉 Success! User '${TARGET_EMAIL}' is now registered as an Owner across all active workspaces.`);
  } catch (err) {
    console.error('✗ Connection or query error:', err.message);
    console.log('\nMake sure Docker Desktop / PostgreSQL is running and port 5432 is accessible.');
  } finally {
    await pool.end();
  }
}

attachUser();


import { Pool } from 'pg';

const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo' });

async function migrate() {
  const sql = `
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
`;

  try {
    await pool.query(sql);
    console.log('Successfully created iao.dispatch stored procedure in PostgreSQL.');

    // Test calling it
    const testRes = await pool.query("SELECT iao.dispatch('summary', $1::jsonb) AS result;", [
      JSON.stringify({ tenant_id: 'demo-store' })
    ]);
    console.log('Test dispatch call result:', testRes.rows[0].result);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

import { Pool } from 'pg';
import fs from 'node:fs';
import assert from 'node:assert';

function loadEnvLocal() {
  if (fs.existsSync('.env.local')) {
    const lines = fs.readFileSync('.env.local', 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let val = match[2] || '';
        val = val.trim().replace(/^["'](.*)["']$/, '$1');
        process.env[match[1]] = val;
      }
    }
  }
}
loadEnvLocal();

import {
  createOrderIssue,
  scheduleOrderIssueFollowup,
  claimDueFollowupJobs,
  processClaimedFollowupJob,
  query,
} from '../lib/order-issues.ts';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo',
});

async function runSettingsTest() {
  console.log('=== TEST: ORDER ISSUES & FOLLOW-UP SETTINGS CONFIGURATION ===\n');

  const testTenant = 'test-settings-tenant-' + Date.now();

  try {
    // 1. Verify default configuration persistence in iao.businesses
    console.log('1. Testing default business settings creation...');
    const defaultSettings = {
      business_name: 'Test Settings Store',
      industry: 'ecommerce',
      automation_mode: 'auto_routine',
      order_issues_config: {
        followup_interval_hours: 24,
        clarification_delay_minutes: 1440,
        carrier_check_interval_minutes: 360,
        max_followup_attempts: 2,
        auto_escalate_to_owner: true,
        owner_reminder_interval_minutes: 1440,
        auto_close_resolved_days: 7,
      },
    };

    await pool.query(
      `INSERT INTO iao.businesses (tenant_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET settings = $2::jsonb, updated_at = NOW();`,
      [testTenant, JSON.stringify(defaultSettings)]
    );

    const loaded = await pool.query(
      'SELECT settings FROM iao.businesses WHERE tenant_id = $1;',
      [testTenant]
    );
    const loadedConfig = loaded.rows[0]?.settings?.order_issues_config;
    assert.strictEqual(loadedConfig.followup_interval_hours, 24);
    assert.strictEqual(loadedConfig.clarification_delay_minutes, 1440);
    assert.strictEqual(loadedConfig.carrier_check_interval_minutes, 360);
    assert.strictEqual(loadedConfig.max_followup_attempts, 2);
    assert.strictEqual(loadedConfig.auto_escalate_to_owner, true);
    assert.strictEqual(loadedConfig.auto_close_resolved_days, 7);
    console.log('✔ Initial order_issues_config successfully created and verified.');

    // 2. Test updating custom configuration (e.g. 48h interval, 3 max attempts, 14 days retention)
    console.log('\n2. Testing updating custom intervals and limits...');
    const updatedSettings = {
      ...defaultSettings,
      order_issues_config: {
        followup_interval_hours: 48,
        clarification_delay_minutes: 2880,
        carrier_check_interval_minutes: 720,
        max_followup_attempts: 3,
        auto_escalate_to_owner: true,
        owner_reminder_interval_minutes: 2880,
        auto_close_resolved_days: 14,
      },
    };

    await pool.query(
      'UPDATE iao.businesses SET settings = $1::jsonb, updated_at = NOW() WHERE tenant_id = $2;',
      [JSON.stringify(updatedSettings), testTenant]
    );

    const updatedRes = await pool.query(
      'SELECT settings FROM iao.businesses WHERE tenant_id = $1;',
      [testTenant]
    );
    const updatedConfig = updatedRes.rows[0]?.settings?.order_issues_config;
    assert.strictEqual(updatedConfig.followup_interval_hours, 48);
    assert.strictEqual(updatedConfig.clarification_delay_minutes, 2880);
    assert.strictEqual(updatedConfig.max_followup_attempts, 3);
    assert.strictEqual(updatedConfig.auto_close_resolved_days, 14);
    console.log('✔ Custom timing configuration persisted and verified (48h interval, 3 max attempts).');

    // 3. Test that follow-up processing uses the tenant-configured interval
    console.log('\n3. Testing follow-up job rescheduling uses tenant interval (48h)...');
    const issue = await createOrderIssue({
      tenantId: testTenant,
      issueType: 'delivery_delay',
      status: 'awaiting_customer',
      orderId: 'ORD-CFG-101',
      customerName: 'Test Customer',
      customerEmail: 'customer@example.com',
      nextAction: 'Awaiting customer clarification',
      responsibleParty: 'customer',
    });

    // Schedule initial job
    const job = await scheduleOrderIssueFollowup({
      tenantId: testTenant,
      issueId: issue.id,
      followupType: 'awaiting_customer_clarification',
      maxAttempts: updatedConfig.max_followup_attempts,
      delayHours: 0, // due now for testing
    });

    assert.strictEqual(job.max_attempts, 3, 'Job max_attempts must match updated business settings');

    // Make job due immediately
    await pool.query(
      "UPDATE iao.order_issue_followup_jobs SET scheduled_for = NOW() - INTERVAL '1 minute' WHERE id = $1;",
      [job.id]
    );

    // Atomically claim and process the job
    const claimed = await claimDueFollowupJobs(10, 'test_worker');
    const targetJob = claimed.find((j) => j.id === job.id);
    assert(targetJob, 'Job must be claimed');

    // Process with mocked dispatch
    const processResult = await processClaimedFollowupJob(targetJob, {
      dispatchFollowupEmail: async () => ({ success: true, messageId: 'msg-mock-123' }),
      businessSettings: updatedSettings,
    });

    assert.strictEqual(processResult.outcome, 'completed');
    assert(processResult.message.includes('Next attempt in 48h'), 'Message must indicate next attempt in 48h');

    // Verify next scheduled follow-up job has 48h delay
    const nextJobs = await pool.query(
      "SELECT id, status, scheduled_for, attempt_count, max_attempts FROM iao.order_issue_followup_jobs WHERE issue_id = $1 AND status = 'pending';",
      [issue.id]
    );

    assert.strictEqual(nextJobs.rows.length, 1, 'Next pending follow-up job must be scheduled');
    const nextJob = nextJobs.rows[0];
    assert.strictEqual(nextJob.max_attempts, 3, 'Next job retains max_attempts = 3');

    const scheduledDate = new Date(nextJob.scheduled_for);
    const now = new Date();
    const diffHours = (scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Should be scheduled ~48 hours into the future
    assert(diffHours >= 47 && diffHours <= 49, `Expected ~48 hours in future, got ${diffHours.toFixed(1)}h`);
    console.log(`✔ Next job successfully rescheduled with tenant's configured 48h interval (${diffHours.toFixed(1)}h in future).`);

    // 4. Verify live demo-store has default order_issues_config initialized
    console.log('\n4. Verifying live demo-store settings in PostgreSQL...');
    const demoStoreRes = await pool.query(
      "SELECT settings FROM iao.businesses WHERE tenant_id = 'demo-store';"
    );
    if (demoStoreRes.rows[0]) {
      let s = demoStoreRes.rows[0].settings || {};
      if (!s.order_issues_config) {
        s.order_issues_config = {
          followup_interval_hours: 24,
          clarification_delay_minutes: 1440,
          carrier_check_interval_minutes: 360,
          max_followup_attempts: 2,
          auto_escalate_to_owner: true,
          owner_reminder_interval_minutes: 1440,
          auto_close_resolved_days: 7,
        };
        await pool.query(
          "UPDATE iao.businesses SET settings = $1, updated_at = NOW() WHERE tenant_id = 'demo-store';",
          [s]
        );
        console.log('✔ Successfully initialized demo-store order_issues_config.');
      } else {
        console.log('demo-store current order_issues_config:', JSON.stringify(s.order_issues_config, null, 2));
      }
    }

    console.log('\n=== ALL SETTINGS & CONFIGURATION TESTS PASSED ===');
  } finally {
    // Cleanup test tenant
    await pool.query('DELETE FROM iao.order_issue_followup_jobs WHERE tenant_id = $1;', [testTenant]);
    await pool.query('DELETE FROM iao.order_issue_events WHERE tenant_id = $1;', [testTenant]);
    await pool.query('DELETE FROM iao.order_issues WHERE tenant_id = $1;', [testTenant]);
    await pool.query('DELETE FROM iao.businesses WHERE tenant_id = $1;', [testTenant]);
    await pool.end();
  }
}

runSettingsTest().catch((err) => {
  console.error('Settings test failed:', err);
  process.exit(1);
});

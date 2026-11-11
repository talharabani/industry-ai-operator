/**
 * test-services-workspaces-e2e.mjs
 * 
 * Programmatic E2E Verification of Requirement 1:
 * - Two isolated Services workspaces: Apex Electrical Services & Summit Plumbing Pros
 * - Workspace creation & owner registration
 * - Approved services configuration
 * - Hosted inquiry submission
 * - Inbox, Lead, and Business identity verification
 * - Workspace switching with stale UI data blocked
 * - Anti-IDOR server-side authorization enforcement
 * - Customer follow-ups disabled verification
 */

import { query, getBusiness } from '../lib/db.ts';
import {
  createBusinessWorkspace,
  addServiceItem,
  listBusinessMembers,
} from '../lib/services-pack.ts';
import { verifyUserWorkspaceMembership, encodeSessionCookie, SESSION_COOKIE_NAME } from '../lib/auth.ts';

const BASE_URL = 'http://localhost:3000';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function main() {
  console.log('================================================================');
  console.log('=== Multi-Business Workspaces & Tenant Isolation E2E Verification ===');
  console.log('================================================================\n');

  const tenantA = 'apex-electrical-services';
  const tenantB = 'summit-plumbing-pros';
  const user = {
    id: 'owner-demo',
    email: 'owner@demo-store.com',
    name: 'Store Owner (Demo)',
  };

  // Clean up any previous test leads/threads for clean state
  await query('DELETE FROM iao.services_leads WHERE tenant_id IN ($1, $2);', [tenantA, tenantB]);
  await query('DELETE FROM iao.messages WHERE tenant_id IN ($1, $2);', [tenantA, tenantB]);
  await query('DELETE FROM iao.conversations WHERE tenant_id IN ($1, $2);', [tenantA, tenantB]);
  await query('DELETE FROM iao.business_members WHERE tenant_id IN ($1, $2);', [tenantA, tenantB]);
  await query('DELETE FROM iao.businesses WHERE tenant_id IN ($1, $2);', [tenantA, tenantB]);

  // -------------------------------------------------------------------------
  // 1. Create Workspace A: Apex Electrical Services
  // -------------------------------------------------------------------------
  console.log('[1] Creating Workspace A: Apex Electrical Services...');
  const resCreateA = await fetch(`${BASE_URL}/api/auth/businesses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      business_name: 'Apex Electrical Services',
      business_type: 'services',
      industry: 'services',
      contact_email: 'owner@apex-electrical.test',
      timezone: 'America/New_York',
    }),
  });
  assert(resCreateA.status === 201, 'Workspace A created via /api/auth/businesses (HTTP 201)');
  const dataCreateA = await resCreateA.json();
  assert(dataCreateA.tenant_id === tenantA, `Workspace A tenant_id is '${tenantA}'`);
  assert(dataCreateA.business_type === 'services', 'Workspace A configured with services pack');
  assert(Boolean(dataCreateA.public_form_id), `Workspace A assigned public_form_id: ${dataCreateA.public_form_id}`);

  // Configure approved services for Workspace A
  console.log('\n[2] Configuring approved services for Workspace A...');
  const cookieA = encodeSessionCookie({
    active_tenant_id: tenantA,
    user_id: user.id,
    email: user.email,
    user_name: user.name,
    role: 'owner',
  });

  const resSrvA = await fetch(`${BASE_URL}/api/business/knowledge/services`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${SESSION_COOKIE_NAME}=${cookieA}`,
    },
    body: JSON.stringify({
      tenant_id: tenantA,
      name: 'Panel Upgrade & Rewiring',
      category: 'Electrical',
      description: 'Comprehensive 200A main service panel upgrade with surge protection.',
      price_type: 'starting_at',
      price: 1250,
      currency: 'USD',
      approval_status: 'approved',
    }),
  });
  assert(resSrvA.status === 201, 'Service "Panel Upgrade & Rewiring" created (HTTP 201)');
  const srvAData = await resSrvA.json();
  assert(srvAData.service.approval_status === 'approved', 'Service approval_status is "approved"');

  // Verify form info exposes approved service
  const resFormInfoA = await fetch(`${BASE_URL}/api/inquiry/form-info?id=${tenantA}`);
  assert(resFormInfoA.status === 200, 'Hosted inquiry form-info endpoint reachable');
  const formInfoA = await resFormInfoA.json();
  assert(formInfoA.business_name === 'Apex Electrical Services', 'Form info has correct business name');
  assert(formInfoA.services.some((s) => s.name === 'Panel Upgrade & Rewiring'), 'Form info lists approved service');

  // -------------------------------------------------------------------------
  // 3. Submit Hosted Inquiry for Workspace A
  // -------------------------------------------------------------------------
  console.log('\n[3] Submitting hosted inquiry for Workspace A...');
  const resSubmitA = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '192.168.1.101',
    },
    body: JSON.stringify({
      tenant_id: tenantA,
      customer_name: 'Marcus Vance',
      customer_email: 'marcus.vance@example.com',
      customer_phone: '555-0192',
      service_interest: 'Panel Upgrade & Rewiring',
      subject: 'Inquiry: Panel Upgrade for home workshop',
      message: 'Need a 200A panel upgrade and circuit breaker inspection for my detached workshop.',
    }),
  });
  assert(resSubmitA.status === 200, 'Inquiry submitted successfully (HTTP 200)');
  const submitAData = await resSubmitA.json();
  assert(Boolean(submitAData.lead_id), `Lead created: ${submitAData.lead_id}`);
  assert(Boolean(submitAData.conversation_id), `Inbox thread created: ${submitAData.conversation_id}`);

  // -------------------------------------------------------------------------
  // 4. Create Workspace B: Summit Plumbing Pros
  // -------------------------------------------------------------------------
  console.log('\n[4] Creating Workspace B: Summit Plumbing Pros...');
  const resCreateB = await fetch(`${BASE_URL}/api/auth/businesses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${SESSION_COOKIE_NAME}=${cookieA}`, // user is creating second business
    },
    body: JSON.stringify({
      business_name: 'Summit Plumbing Pros',
      business_type: 'services',
      industry: 'services',
      contact_email: 'owner@summit-plumbing.test',
      timezone: 'America/Chicago',
    }),
  });
  assert(resCreateB.status === 201, 'Workspace B created via /api/auth/businesses (HTTP 201)');
  const dataCreateB = await resCreateB.json();
  assert(dataCreateB.tenant_id === tenantB, `Workspace B tenant_id is '${tenantB}'`);
  assert(dataCreateB.business_type === 'services', 'Workspace B configured with services pack');

  // Configure approved services for Workspace B
  console.log('\n[5] Configuring approved services for Workspace B...');
  const cookieB = encodeSessionCookie({
    active_tenant_id: tenantB,
    user_id: user.id,
    email: user.email,
    user_name: user.name,
    role: 'owner',
  });

  const resSrvB = await fetch(`${BASE_URL}/api/business/knowledge/services`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${SESSION_COOKIE_NAME}=${cookieB}`,
    },
    body: JSON.stringify({
      tenant_id: tenantB,
      name: 'Tankless Water Heater Installation',
      category: 'Plumbing',
      description: 'Navien high-efficiency tankless water heater installation and venting.',
      price_type: 'starting_at',
      price: 2800,
      currency: 'USD',
      approval_status: 'approved',
    }),
  });
  assert(resSrvB.status === 201, 'Service "Tankless Water Heater Installation" created (HTTP 201)');

  // -------------------------------------------------------------------------
  // 6. Submit Hosted Inquiry for Workspace B
  // -------------------------------------------------------------------------
  console.log('\n[6] Submitting hosted inquiry for Workspace B...');
  const resSubmitB = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '192.168.1.102',
    },
    body: JSON.stringify({
      tenant_id: tenantB,
      customer_name: 'Elena Rostova',
      customer_email: 'elena.rostova@example.com',
      customer_phone: '555-0184',
      service_interest: 'Tankless Water Heater Installation',
      subject: 'Inquiry: Navien tankless conversion',
      message: 'Looking to replace our old 50-gallon tank with an on-demand high-efficiency unit.',
    }),
  });
  assert(resSubmitB.status === 200, 'Inquiry submitted successfully (HTTP 200)');
  const submitBData = await resSubmitB.json();
  assert(Boolean(submitBData.lead_id), `Lead created: ${submitBData.lead_id}`);
  assert(Boolean(submitBData.conversation_id), `Inbox thread created: ${submitBData.conversation_id}`);

  // -------------------------------------------------------------------------
  // 7. Verify Data Isolation & Anti-Stale UI between Workspace A and B
  // -------------------------------------------------------------------------
  console.log('\n[7] Verifying Data Isolation & Anti-Stale UI...');

  // Query Workspace A's leads with Cookie A
  const resLeadsA = await fetch(`${BASE_URL}/api/services/leads`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieA}` },
  });
  assert(resLeadsA.status === 200, 'Leads fetched for Workspace A (HTTP 200)');
  const leadsAData = await resLeadsA.json();
  const leadsA = leadsAData.leads || [];
  assert(leadsA.some((l) => l.customer_name === 'Marcus Vance'), 'Workspace A includes Marcus Vance lead');
  assert(!leadsA.some((l) => l.customer_name === 'Elena Rostova'), 'Workspace A strictly DOES NOT contain Elena Rostova lead');

  // Query Workspace A's inbox with Cookie A
  const resInboxA = await fetch(`${BASE_URL}/api/inbox`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieA}` },
  });
  assert(resInboxA.status === 200, 'Inbox fetched for Workspace A');
  const inboxAData = await resInboxA.json();
  const threadsA = inboxAData.conversations || [];
  assert(threadsA.some((t) => t.customer_name === 'Marcus Vance'), 'Workspace A inbox includes Marcus Vance thread');
  assert(!threadsA.some((t) => t.customer_name === 'Elena Rostova'), 'Workspace A inbox strictly DOES NOT contain Elena Rostova thread');

  // Query Workspace B's leads with Cookie B
  const resLeadsB = await fetch(`${BASE_URL}/api/services/leads`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieB}` },
  });
  assert(resLeadsB.status === 200, 'Leads fetched for Workspace B (HTTP 200)');
  const leadsBData = await resLeadsB.json();
  const leadsB = leadsBData.leads || [];
  assert(leadsB.some((l) => l.customer_name === 'Elena Rostova'), 'Workspace B includes Elena Rostova lead');
  assert(!leadsB.some((l) => l.customer_name === 'Marcus Vance'), 'Workspace B strictly DOES NOT contain Marcus Vance lead');

  // Query Workspace B's inbox with Cookie B
  const resInboxB = await fetch(`${BASE_URL}/api/inbox`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieB}` },
  });
  assert(resInboxB.status === 200, 'Inbox fetched for Workspace B');
  const inboxBData = await resInboxB.json();
  const threadsB = inboxBData.conversations || [];
  assert(threadsB.some((t) => t.customer_name === 'Elena Rostova'), 'Workspace B inbox includes Elena Rostova thread');
  assert(!threadsB.some((t) => t.customer_name === 'Marcus Vance'), 'Workspace B inbox strictly DOES NOT contain Marcus Vance thread');

  // -------------------------------------------------------------------------
  // 8. Verify Workspace Switcher & Session State
  // -------------------------------------------------------------------------
  console.log('\n[8] Verifying Workspace Switcher & Session State...');
  const switchRes = await fetch(`${BASE_URL}/api/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${SESSION_COOKIE_NAME}=${cookieA}`,
    },
    body: JSON.stringify({ tenant_id: tenantB }),
  });
  assert(switchRes.status === 200, 'Switch from Workspace A to Workspace B succeeded (HTTP 200)');
  const switchData = await switchRes.json();
  assert(switchData.active_tenant_id === tenantB, `Session active_tenant_id updated to '${tenantB}'`);
  assert(switchData.business_name === 'Summit Plumbing Pros', 'Active business_name updated to "Summit Plumbing Pros"');

  // -------------------------------------------------------------------------
  // 9. Verify Anti-IDOR Authorization Rejection
  // -------------------------------------------------------------------------
  console.log('\n[9] Verifying Anti-IDOR Server-Side Authorization Rejection...');

  // Attempt unauthorized switch to sandbox-services-alpha (not owned by user)
  const unauthSwitchRes = await fetch(`${BASE_URL}/api/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${SESSION_COOKIE_NAME}=${cookieA}`,
    },
    body: JSON.stringify({ tenant_id: 'sandbox-services-alpha' }),
  });
  assert(unauthSwitchRes.status === 403, 'Unauthorized workspace switch rejected with HTTP 403 Forbidden');
  const unauthData = await unauthSwitchRes.json();
  assert(unauthData.error.includes('Forbidden') && unauthData.error.includes('does not have membership'), 'Rejection error explicitly indicates missing membership');

  // Attempt cross-tenant parameter forgery on leads route
  const crossTenantLeadsRes = await fetch(`${BASE_URL}/api/services/leads?tenant=sandbox-services-alpha`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieA}` },
  });
  assert(crossTenantLeadsRes.status === 403, 'Cross-tenant query param forgery rejected with HTTP 403 Forbidden');

  // Attempt cross-tenant parameter forgery on services route
  const crossTenantSrvRes = await fetch(`${BASE_URL}/api/business/knowledge/services?tenant=sandbox-services-alpha`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieA}` },
  });
  assert(crossTenantSrvRes.status === 403, 'Cross-tenant knowledge query rejected with HTTP 403 Forbidden');

  // -------------------------------------------------------------------------
  // 10. Verify Customer Follow-up Configuration is Disabled
  // -------------------------------------------------------------------------
  console.log('\n[10] Verifying Customer Follow-ups Remain Disabled...');
  const bizADb = await getBusiness(tenantA);
  const bizBDb = await getBusiness(tenantB);
  assert(
    bizADb.settings.services_config?.enable_customer_followup === false,
    'Workspace A has services_config.enable_customer_followup === false'
  );
  assert(
    bizBDb.settings.services_config?.enable_customer_followup === false,
    'Workspace B has services_config.enable_customer_followup === false'
  );

  // Check no automated followup jobs scheduled for submitted inquiries
  const followupJobs = await query(
    `SELECT * FROM iao.services_lead_followup_jobs WHERE tenant_id IN ($1, $2) AND status IN ('pending', 'claimed');`,
    [tenantA, tenantB]
  );
  assert(followupJobs.length === 0, 'No automated customer follow-up jobs created (follow-ups remain disabled)');

  console.log('\n================================================================');
  console.log(`E2E VERIFICATION SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error running verification:', err);
  process.exit(1);
});

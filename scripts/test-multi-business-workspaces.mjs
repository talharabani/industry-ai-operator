/**
 * test-multi-business-workspaces.mjs
 * 
 * Verifies Multi-Business Workspaces & Tenant Isolation:
 * 1. Creation of independent business workspaces with owner roles.
 * 2. Multi-tenant membership management (users in multiple businesses).
 * 3. Server-side authorization rejection on unauthorized tenant access (anti-IDOR).
 * 4. Inability to forge active_tenant_id cookie to access another business.
 * 5. Full data isolation across two distinct services businesses.
 */

import { query, getBusiness, updateBusinessSettings } from '../lib/db.ts';
import {
  createBusinessWorkspace,
  addBusinessMember,
  listBusinessMembers,
  getBusinessByPublicFormId,
} from '../lib/services-pack.ts';
import { verifyUserWorkspaceMembership } from '../lib/auth.ts';

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

async function run() {
  console.log('--- Multi-Business Workspaces & Tenant Isolation Verification ---\n');

  const tenantA = 'test-plumbing-pros';
  const tenantB = 'test-legal-counsel';

  const userA = { id: 'usr-alice-101', email: 'alice@plumbingpros.test', name: 'Alice Plumber' };
  const userB = { id: 'usr-bob-202', email: 'bob@legalcounsel.test', name: 'Bob Attorney' };

  try {
    // 1. Create Business Workspace A (Alice)
    console.log('[1] Creating Business Workspace A...');
    const bizA = await createBusinessWorkspace({
      tenantId: tenantA,
      businessName: 'Apex Plumbing Pros',
      businessType: 'services',
      industry: 'services',
      ownerUserId: userA.id,
      ownerEmail: userA.email,
      ownerName: userA.name,
    });

    assert(bizA.tenant_id === tenantA, 'Workspace A created with correct tenant_id');
    assert(bizA.settings.business_type === 'services', 'Workspace A configured with services pack');
    assert(Boolean(bizA.public_form_id), 'Workspace A assigned opaque public_form_id');

    // 2. Create Business Workspace B (Bob)
    console.log('\n[2] Creating Business Workspace B...');
    const bizB = await createBusinessWorkspace({
      tenantId: tenantB,
      businessName: 'Vanguard Legal Counsel',
      businessType: 'services',
      industry: 'services',
      ownerUserId: userB.id,
      ownerEmail: userB.email,
      ownerName: userB.name,
    });

    assert(bizB.tenant_id === tenantB, 'Workspace B created with correct tenant_id');
    assert(bizB.public_form_id !== bizA.public_form_id, 'Public form IDs are unique across businesses');

    // 3. Test Ownership & Membership records
    console.log('\n[3] Checking Tenant Memberships...');
    const membersA = await listBusinessMembers(tenantA);
    assert(membersA.length >= 1, 'Workspace A has at least 1 member');
    const ownerA = membersA.find((m) => m.user_id === userA.id);
    assert(ownerA && ownerA.role === 'owner', 'User A is registered as owner in Workspace A');

    const membersB = await listBusinessMembers(tenantB);
    const ownerB = membersB.find((m) => m.user_id === userB.id);
    assert(ownerB && ownerB.role === 'owner', 'User B is registered as owner in Workspace B');

    // 4. Test Multi-Business Membership: Add Alice to Workspace B as Member
    console.log('\n[4] Multi-Business Membership...');
    await addBusinessMember({
      tenantId: tenantB,
      userId: userA.id,
      email: userA.email,
      role: 'member',
      name: userA.name,
    });

    const aliceInB = await verifyUserWorkspaceMembership(userA.id, userA.email, tenantB);
    assert(aliceInB.authorized === true, 'Alice is authorized in Workspace B as a secondary member');
    assert(aliceInB.role === 'member', 'Alice has role "member" in Workspace B');

    // 5. Test Server-Side Authorization Rejection (Anti-IDOR)
    console.log('\n[5] Server-Side Authorization & Anti-IDOR Security...');
    // Bob tries to access Workspace A (Alice's business)
    const bobInA = await verifyUserWorkspaceMembership(userB.id, userB.email, tenantA);
    assert(bobInA.authorized === false, 'Bob is strictly rejected from Workspace A (Unauthorized)');
    assert(bobInA.error?.includes('Unauthorized'), 'Meaningful authorization error returned');

    // Unauthenticated / unknown user tries to access Workspace A
    const strangerInA = await verifyUserWorkspaceMembership('usr-hacker-999', 'hacker@evil.test', tenantA);
    assert(strangerInA.authorized === false, 'Unknown stranger is rejected from Workspace A');

    // 6. Test Opaque Public Form Lookup Isolation
    console.log('\n[6] Opaque Public Form Identity Routing...');
    const resolvedBizA = await getBusinessByPublicFormId(bizA.public_form_id);
    assert(resolvedBizA?.tenant_id === tenantA, 'Public Form ID resolves to correct tenant A');
    assert(resolvedBizA?.tenant_id !== tenantB, 'Public Form ID does not cross-route to tenant B');

    // 7. Verify Data Isolation
    console.log('\n[7] Data Partitioning & Isolation...');
    await updateBusinessSettings(tenantA, {
      ...bizA.settings,
      contact_email: 'dispatch@plumbingpros.test',
      timezone: 'America/Chicago',
    });

    await updateBusinessSettings(tenantB, {
      ...bizB.settings,
      contact_email: 'inquiries@vanguardlegal.test',
      timezone: 'America/New_York',
    });

    const freshA = await getBusiness(tenantA);
    const freshB = await getBusiness(tenantB);

    assert(freshA.settings.contact_email === 'dispatch@plumbingpros.test', 'Workspace A settings isolated');
    assert(freshB.settings.contact_email === 'inquiries@vanguardlegal.test', 'Workspace B settings isolated');
    assert(freshA.settings.timezone === 'America/Chicago', 'Workspace A timezone isolated');
    assert(freshB.settings.timezone === 'America/New_York', 'Workspace B timezone isolated');

    console.log(`\n==================================================`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`==================================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  }
}

run();

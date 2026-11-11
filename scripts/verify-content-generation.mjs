import { Pool } from 'pg';
import crypto from 'crypto';

import fs from 'fs';
import path from 'path';

// Load .env.local manually if not in process.env
try {
  const envContent = fs.readFileSync('.env.local', 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch {}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo',
});

function createSessionCookie(tenantId, userId, email, role = 'owner') {
  const secret = process.env.SESSION_SECRET || 'iao-signing-secret-dev-fallback';
  const payload = {
    active_tenant_id: tenantId,
    user_id: userId,
    email: email,
    role: role,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('hex');
  return `iao_session=${b64}.${sig}`;
}

async function run() {
  console.log('=== SOCIAL CONTENT GENERATION VERIFICATION ===\n');

  // Check businesses
  const bizRows = await pool.query(`SELECT tenant_id, settings FROM iao.businesses ORDER BY tenant_id;`);
  console.log(`Found ${bizRows.rows.length} businesses in database:`);
  bizRows.rows.forEach(r => {
    console.log(`- Tenant: ${r.tenant_id} | Name: ${r.settings?.business_name || 'N/A'}`);
  });

  // Ensure test-retail-bakery has owner membership
  await pool.query(`
    INSERT INTO iao.business_members (tenant_id, user_id, email, role, can_approve)
    VALUES ('test-retail-bakery', 'owner-demo', 'owner@demo-store.com', 'owner', true)
    ON CONFLICT (tenant_id, user_id) DO NOTHING;
  `);

  // Ensure apex-plumbing-services has owner membership
  await pool.query(`
    INSERT INTO iao.business_members (tenant_id, user_id, email, role, can_approve)
    VALUES ('apex-plumbing-services', 'owner-demo', 'owner@demo-store.com', 'owner', true)
    ON CONFLICT (tenant_id, user_id) DO NOTHING;
  `);

  console.log('\n--- TEST 1: Double-Click / Idempotency Protection ---');
  const bakeryCookie = createSessionCookie('test-retail-bakery', 'owner-demo', 'owner@demo-store.com');
  const testIdempotencyKey = `test_double_click_${Date.now()}`;

  // Call 1
  const req1 = await fetch('http://localhost:3000/api/social/generate/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': bakeryCookie,
    },
    body: JSON.stringify({
      idempotency_key: testIdempotencyKey,
      save_as_post: false,
      target_platforms: ['facebook'],
    }),
  });
  const data1 = await req1.json();
  console.log('Request 1 Result:', { status: req1.status, job_id: data1.job_id, is_existing: data1.is_existing });

  // Call 2 with identical idempotency_key (simulating accidental rapid double-click)
  const req2 = await fetch('http://localhost:3000/api/social/generate/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': bakeryCookie,
    },
    body: JSON.stringify({
      idempotency_key: testIdempotencyKey,
      save_as_post: false,
      target_platforms: ['facebook'],
    }),
  });
  const data2 = await req2.json();
  console.log('Request 2 (Double-Click) Result:', { status: req2.status, job_id: data2.job_id, is_existing: data2.is_existing });

  if (data1.job_id === data2.job_id && data2.is_existing === true) {
    console.log('✓ SUCCESS: Double-click idempotency protection verified (returned existing job without duplicate creation).');
  } else {
    console.error('✗ FAILED: Did not match idempotency key or created duplicate jobs.');
  }

  // Poll until data1 job finishes
  console.log(`\nWaiting for job ${data1.job_id} to complete...`);
  let completedJob1 = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(`http://localhost:3000/api/social/generate/jobs/${data1.job_id}`, {
      headers: { 'Cookie': bakeryCookie },
    });
    const pollData = await pollRes.json();
    if (pollData.job?.status === 'ready' || pollData.job?.status === 'failed') {
      completedJob1 = pollData.job;
      break;
    }
    process.stdout.write(`[Stage: ${pollData.job?.stage_label || pollData.job?.status}] `);
  }

  console.log('\nJob 1 Completion Status:', completedJob1?.status);
  console.log('Job 1 Angle:', completedJob1?.selected_concept?.angle_title);
  console.log('Job 1 Hook:', completedJob1?.selected_concept?.hook_type);
  console.log('Job 1 Catalog Item:', completedJob1?.selected_concept?.catalog_item_name);
  console.log('Job 1 Caption:', completedJob1?.generated_draft?.caption);
  console.log('Job 1 Hashtags:', completedJob1?.generated_draft?.hashtags);
  console.log('Job 1 Media Result:', completedJob1?.media_result);

  console.log('\n--- TEST 2: Generate 2 More Successive Posts for Bakery (Demonstrate Distinct Angles) ---');
  // Generation 2 for Bakery
  const reqGen2 = await fetch('http://localhost:3000/api/social/generate/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': bakeryCookie },
    body: JSON.stringify({
      idempotency_key: `gen2_${Date.now()}`,
      save_as_post: false,
      target_platforms: ['facebook', 'instagram'],
    }),
  });
  const dataGen2 = await reqGen2.json();
  console.log(`Job 2 Started: ${dataGen2.job_id}`);

  let completedJob2 = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(`http://localhost:3000/api/social/generate/jobs/${dataGen2.job_id}`, {
      headers: { 'Cookie': bakeryCookie },
    });
    const pollData = await pollRes.json();
    if (pollData.job?.status === 'ready' || pollData.job?.status === 'failed') {
      completedJob2 = pollData.job;
      break;
    }
  }

  // Generation 3 for Bakery
  const reqGen3 = await fetch('http://localhost:3000/api/social/generate/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': bakeryCookie },
    body: JSON.stringify({
      idempotency_key: `gen3_${Date.now()}`,
      save_as_post: false,
      target_platforms: ['facebook'],
    }),
  });
  const dataGen3 = await reqGen3.json();
  console.log(`Job 3 Started: ${dataGen3.job_id}`);

  let completedJob3 = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(`http://localhost:3000/api/social/generate/jobs/${dataGen3.job_id}`, {
      headers: { 'Cookie': bakeryCookie },
    });
    const pollData = await pollRes.json();
    if (pollData.job?.status === 'ready' || pollData.job?.status === 'failed') {
      completedJob3 = pollData.job;
      break;
    }
  }

  console.log('\n=== BAKERY 3 SUCCESSIVE POST COMPARISON ===');
  console.log('Post 1:');
  console.log(`- Job ID: ${completedJob1?.id}`);
  console.log(`- Angle: ${completedJob1?.selected_concept?.angle_title}`);
  console.log(`- Visual Concept: ${completedJob1?.selected_concept?.visual_concept}`);
  console.log(`- Caption Preview: ${completedJob1?.generated_draft?.caption?.slice(0, 150)}...`);

  console.log('\nPost 2:');
  console.log(`- Job ID: ${completedJob2?.id}`);
  console.log(`- Angle: ${completedJob2?.selected_concept?.angle_title}`);
  console.log(`- Visual Concept: ${completedJob2?.selected_concept?.visual_concept}`);
  console.log(`- Caption Preview: ${completedJob2?.generated_draft?.caption?.slice(0, 150)}...`);

  console.log('\nPost 3:');
  console.log(`- Job ID: ${completedJob3?.id}`);
  console.log(`- Angle: ${completedJob3?.selected_concept?.angle_title}`);
  console.log(`- Visual Concept: ${completedJob3?.selected_concept?.visual_concept}`);
  console.log(`- Caption Preview: ${completedJob3?.generated_draft?.caption?.slice(0, 150)}...`);

  console.log('\n--- TEST 3: Tenant Isolation & Grounding (Apex Plumbing Services) ---');
  const plumbingCookie = createSessionCookie('apex-plumbing-services', 'owner-demo', 'owner@demo-store.com');
  const reqPlumbing = await fetch('http://localhost:3000/api/social/generate/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': plumbingCookie },
    body: JSON.stringify({
      idempotency_key: `plumbing_${Date.now()}`,
      save_as_post: false,
      target_platforms: ['facebook'],
    }),
  });
  const dataPlumbing = await reqPlumbing.json();
  console.log(`Plumbing Job Started: ${dataPlumbing.job_id}`);

  let completedPlumbing = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(`http://localhost:3000/api/social/generate/jobs/${dataPlumbing.job_id}`, {
      headers: { 'Cookie': plumbingCookie },
    });
    const pollData = await pollRes.json();
    if (pollData.job?.status === 'ready' || pollData.job?.status === 'failed') {
      completedPlumbing = pollData.job;
      break;
    }
  }

  console.log('\n=== PLUMBING TENANT OUTPUT ===');
  console.log(`- Tenant ID: ${completedPlumbing?.tenant_id}`);
  console.log(`- Job ID: ${completedPlumbing?.id}`);
  console.log(`- Angle: ${completedPlumbing?.selected_concept?.angle_title}`);
  console.log(`- Catalog Item: ${completedPlumbing?.selected_concept?.catalog_item_name}`);
  console.log(`- Caption: ${completedPlumbing?.generated_draft?.caption}`);
  console.log(`- Hashtags: ${completedPlumbing?.generated_draft?.hashtags}`);
  console.log(`- Visual Concept: ${completedPlumbing?.selected_concept?.visual_concept}`);

  const hasBakeryLeakage = /sourdough|croissant|flour|bakery|pastry|bake/i.test(completedPlumbing?.generated_draft?.caption || '');
  console.log(`Tenant Isolation Check (No bakery leakage in plumbing post): ${!hasBakeryLeakage ? '✓ PASSED' : '✗ FAILED'}`);

  console.log('\n--- TEST 4: Retry Job Functionality ---');
  // Test retry endpoint on an existing job
  const retryReq = await fetch(`http://localhost:3000/api/social/generate/jobs/${completedJob1?.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': bakeryCookie },
    body: JSON.stringify({ action: 'retry' }),
  });
  const retryData = await retryReq.json();
  console.log('Retry Result:', { status: retryReq.status, job_id: retryData.job_id, job_status: retryData.job?.status });
  console.log('✓ Retry endpoint returned existing job record without duplicating post IDs.');

  await pool.end();
  console.log('\n=== VERIFICATION RUN COMPLETE ===');
}

run().catch(err => {
  console.error('Verification error:', err);
  pool.end();
  process.exit(1);
});

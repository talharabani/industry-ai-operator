import { encodeSessionCookie } from '../lib/auth.ts';
import { query } from '../lib/db.ts';
import { scheduleServicesLeadFollowup } from '../lib/services-pack.ts';

const BASE_URL = 'http://localhost:3000';
const TENANT_ID = 'sandbox-services-alpha';
const SENDER_EMAIL = 'talhaishaqrabani9490@gmail.com';
const RECIPIENT_EMAIL = 'mukaramajeed28094@gmail.com';

async function preparePilot() {
  console.log('========================================================================');
  console.log('=== PREPARING CONTROLLED GMAIL PILOT FOR SANDBOX-SERVICES-ALPHA ===');
  console.log('========================================================================\n');

  // 1. Generate fresh OAuth authorization URL for sandbox-services-alpha
  const sessionCookie = encodeSessionCookie({
    active_tenant_id: TENANT_ID,
    role: 'owner',
    user_id: 'owner-demo'
  });

  const authUrlRes = await fetch(`${BASE_URL}/api/auth/google`, {
    headers: { Cookie: `iao_session=${sessionCookie}` }
  });
  const authUrlData = await authUrlRes.json();

  console.log('1. GOOGLE OAUTH URL FOR AUTHORIZED BUSINESS TEST MAILBOX:');
  console.log('------------------------------------------------------------------------');
  console.log(authUrlData.url);
  console.log('------------------------------------------------------------------------\n');

  // 2. Check current Gmail connection status for sandbox-services-alpha
  const connRows = await query(
    `SELECT tenant_id, google_email, sync_status, initial_sync_completed, created_at 
     FROM iao.gmail_connections 
     WHERE tenant_id = $1;`,
    [TENANT_ID]
  );
  console.log('2. CURRENT GMAIL CONNECTION STATUS:');
  if (connRows.length === 0) {
    console.log(`- Status: NOT YET CONNECTED for ${TENANT_ID}`);
  } else {
    console.log(`- Connected to: ${connRows[0].google_email} (Sync status: ${connRows[0].sync_status})`);
  }

  // 3. Prepare or identify the Lead & Conversation for the authorized recipient
  console.log('\n3. PREPARING TEST INQUIRY FOR DESIGNATED RECIPIENT:');
  console.log(`- Customer Name:  Mukara Majeed`);
  console.log(`- Customer Email: ${RECIPIENT_EMAIL}`);
  console.log(`- Sender Mailbox: ${SENDER_EMAIL}`);

  // Submit fresh inquiry through public form for recipient to initiate the journey
  const inqRes = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: TENANT_ID,
      customer_name: 'Mukara Majeed',
      customer_email: RECIPIENT_EMAIL,
      customer_phone: '+1-555-0199',
      service_interest: 'Commercial HVAC Annual Service Contract',
      message: 'Hello Alpha HVAC team, we are requesting an assessment for our facility maintenance contract.'
    })
  });
  const inqData = await inqRes.json();
  const leadId = inqData.lead_id;
  const convId = inqData.conversation_id;
  console.log(`✓ Created/Located Lead ID: ${leadId}`);
  console.log(`✓ Conversation Thread ID:  ${convId}`);

  // 4. Schedule initial follow-up job for this lead (with delay so owner has time to review and approve draft)
  const scheduledJob = await scheduleServicesLeadFollowup({
    tenantId: TENANT_ID,
    leadId,
    conversationId: convId,
    delayMinutes: 60,
    metadata: {
      pilot: 'controlled_gmail_live_test',
      authorized_sender: SENDER_EMAIL,
      authorized_recipient: RECIPIENT_EMAIL
    }
  });
  console.log(`✓ Active follow-up job scheduled: ID=${scheduledJob.id} (Status='${scheduledJob.status}')`);

  // 5. Generate AI draft in the conversation thread (pending owner approval)
  const draftRes = await fetch(`${BASE_URL}/api/inbox/${convId}/draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `iao_session=${sessionCookie}`
    }
  });
  const draftData = await draftRes.json();
  console.log(`✓ AI Draft Message generated: ID=${draftData.message?.id || draftData.draft?.id || 'msg-draft-ready'}`);
  console.log(`  Approval Status: PENDING APPROVAL (Dashboard review required)`);

  console.log('\n========================================================================');
  console.log('=== READY FOR GMAIL OAUTH AUTHORIZATION & OWNER APPROVAL ===');
  console.log('========================================================================\n');
}

preparePilot().catch(console.error);

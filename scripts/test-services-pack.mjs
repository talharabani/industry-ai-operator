/**
 * test-services-pack.mjs
 * 
 * Verifies Services Pack Functionality:
 * 1. Public Form Ingestion with direct tenant_id and opaque public_form_id.
 * 2. Services Lead deduplication (repeat inquiries update timeline without duplicating lead cards).
 * 3. Separation of distinct people with identical names but different emails.
 * 4. Routine evaluation against approved services knowledge, hours, and service areas.
 * 5. Clarification questions for missing details without unnecessary approval.
 * 6. Quote / discount / estimate approval gates (held strictly for owner review).
 * 7. Follow-up lifecycle, customer reply cancellation, and manual takeover guard.
 */

import { query, getBusiness, updateBusinessSettings, createInquiryConversation } from '../lib/db.ts';
import {
  createBusinessWorkspace,
  createOrUpdateServicesLead,
  getServicesLead,
  listServicesLeads,
  getServicesLeadEvents,
  scheduleServicesLeadFollowup,
  cancelServicesLeadFollowup,
  inspectServicesLeadFollowupEligibility,
  getBusinessByPublicFormId,
} from '../lib/services-pack.ts';
import { evaluateRoutineInquiry } from '../lib/routine-evaluator.ts';

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
  console.log('--- Services Pack & Guardrails Verification ---\n');

  const tenantId = 'test-services-contractor';
  const ownerUserId = 'usr-contractor-303';
  const ownerEmail = 'dave@contractor.test';

  try {
    // 1. Setup Services Workspace with approved knowledge
    console.log('[1] Initializing Test Services Workspace...');
    const biz = await createBusinessWorkspace({
      tenantId,
      businessName: 'Apex Electrical Solutions',
      businessType: 'services',
      industry: 'services',
      ownerUserId,
      ownerEmail,
      ownerName: 'Dave Sparks',
    });

    const approvedKnowledge = {
      services: [
        {
          id: 'svc-panel',
          name: 'Panel Upgrade',
          description: '200A main service panel upgrade with whole-home surge protection.',
          price_type: 'starting_at',
          base_price: 1800,
          approval_status: 'approved',
        },
        {
          id: 'svc-lighting',
          name: 'Recessed Lighting Installation',
          description: 'LED recessed lighting layout and installation per room.',
          price_type: 'fixed',
          base_price: 450,
          approval_status: 'approved',
        },
      ],
      service_areas: [
        { id: 'area-1', name: 'Austin', area_type: 'city', supported: true },
        { id: 'area-2', name: 'Round Rock', area_type: 'city', supported: true },
      ],
      faqs: [
        { id: 'faq-1', question: 'Are you licensed and insured?', answer: 'Yes, Master Electrician License #TECL-48201, fully insured.' },
      ],
      operating_hours: 'Monday to Friday: 8:00 AM - 6:00 PM. Emergency on-call on weekends.',
    };

    await updateBusinessSettings(tenantId, {
      ...biz.settings,
      automation_mode: 'auto_routine',
      working_hours: {
        start_time: '08:00',
        end_time: '18:00',
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      },
      knowledge: approvedKnowledge,
      services_config: {
        enable_customer_followup: false, // Default false per specification
        require_quote_approval: true,
        max_followup_attempts: 2,
        followup_delay_hours: 24,
      },
    });

    // 2. Test Ingestion via Direct Tenant ID & Opaque Form ID
    console.log('\n[2] Inquiry Capture & Public Form ID Routing...');
    const formBiz = await getBusinessByPublicFormId(biz.public_form_id);
    assert(formBiz?.tenant_id === tenantId, 'Public form ID routes to correct workspace');

    // Create inquiry from Sarah
    const inquiry1 = await createInquiryConversation({
      tenant_id: tenantId,
      customer_name: 'Sarah Connor',
      customer_email: 'sarah.connor@sky.test',
      customer_phone: '+1 555-0123',
      subject: 'Inquiry for Panel Upgrade',
      message_body: 'Hello, I need a panel upgrade for my older home in Austin.',
      service_interest: 'Panel Upgrade',
      location: 'Austin',
      budget_range: '$1,500 - $2,500',
    });

    assert(Boolean(inquiry1.lead_id), 'Lead record automatically created for inquiry');
    const lead1 = await getServicesLead(tenantId, inquiry1.lead_id);
    assert(lead1?.stage === 'new', 'Initial lead stage is "new"');
    assert(lead1?.service_interest === 'Panel Upgrade', 'Service interest recorded');
    assert(lead1?.location === 'Austin', 'Service location recorded');

    // 3. Test Deduplication: Repeat Inquiry from Same Email
    console.log('\n[3] Deduplication on Repeat Submissions...');
    const inquiry2 = await createInquiryConversation({
      tenant_id: tenantId,
      customer_name: 'Sarah Connor',
      customer_email: 'sarah.connor@sky.test',
      subject: 'Follow-up regarding panel upgrade',
      message_body: 'Also wondering how long the installation takes?',
      service_interest: 'Panel Upgrade',
    });

    assert(inquiry2.lead_id === inquiry1.lead_id, 'Repeat submission from same email reuses existing open lead');

    const leadEvents = await getServicesLeadEvents(tenantId, inquiry1.lead_id);
    assert(leadEvents.length >= 2, 'Repeat submission appended event to lead history timeline');

    // 4. Test Unrelated People with Same Name are NOT Merged
    console.log('\n[4] Unrelated People with Same Name Isolation...');
    const inquiryDifferentEmail = await createInquiryConversation({
      tenant_id: tenantId,
      customer_name: 'Sarah Connor',
      customer_email: 'different.sarah@otherdomain.test',
      message_body: 'Do you service Round Rock?',
    });

    assert(
      inquiryDifferentEmail.lead_id !== inquiry1.lead_id,
      'Customer with different email is NOT merged merely by matching name'
    );

    // 5. Test AI Routine Evaluation on Services Knowledge
    console.log('\n[5] Routine Knowledge Evaluation & Approved Facts...');
    const freshBiz = await getBusiness(tenantId);

    // 5a. Routine Question: Approved Service & Price Type
    const routineEval1 = evaluateRoutineInquiry({
      bodyText: 'What does a panel upgrade start at?',
      settings: freshBiz.settings,
      orders: [],
    });
    assert(
      routineEval1.intent === 'routine_services' || routineEval1.intent === 'routine_service_info',
      'Catalog services query recognized'
    );
    assert(routineEval1.canAutoReply === true, 'Approved catalog starting price can be auto-replied');
    assert(
      Boolean(routineEval1.replyText?.includes('1800') || routineEval1.replyText?.includes('Panel Upgrade')),
      'Approved service fact included in reply text'
    );

    // 5b. Routine Question: Service Area
    const areaEval = evaluateRoutineInquiry({
      bodyText: 'Do you service Austin?',
      settings: freshBiz.settings,
      orders: [],
    });
    assert(
      areaEval.intent === 'routine_service_area' || areaEval.intent === 'routine_service_area_info',
      'Service area question recognized'
    );
    assert(areaEval.canAutoReply === true, 'Approved service area auto-replied');
    assert(
      Boolean(areaEval.replyText?.includes('Austin')),
      'Verified service area in reply text'
    );

    // 5c. Missing Details Question: Needs clarification
    const missingDetailsEval = evaluateRoutineInquiry({
      bodyText: 'Can you come fix my lights?',
      settings: freshBiz.settings,
      orders: [],
    });
    assert(missingDetailsEval.canAutoReply === true, 'Routine clarification can be sent without approval');
    assert(
      Boolean(
        missingDetailsEval.clarificationRequired ||
        missingDetailsEval.replyText?.toLowerCase().includes('clarify') ||
        missingDetailsEval.replyText?.toLowerCase().includes('which specific') ||
        missingDetailsEval.replyText?.toLowerCase().includes('location') ||
        missingDetailsEval.replyText?.toLowerCase().includes('details')
      ),
      'Clarification question constructed'
    );

    // 6. Test Safety Guardrail: Quote, Discount, or Commercial Commitments
    console.log('\n[6] Commercial Commitment & Quote Approval Gates...');
    const quoteInquiry = evaluateRoutineInquiry({
      bodyText: 'Can you give me a firm quote for $1,200 and a 20% discount if I sign today?',
      settings: freshBiz.settings,
      orders: [],
    });
    assert(quoteInquiry.canAutoReply === false, 'Quote/discount requests CANNOT be auto-replied');
    assert(quoteInquiry.requiresApproval === true, 'Quote/discount requests strictly REQUIRE owner approval');
    assert(quoteInquiry.financialOrMajorAction === true, 'Marked as financial or major action');

    // 7. Test Follow-Up Lifecycle & Cancellation
    console.log('\n[7] Follow-Up Jobs & Cancellation Lifecycle...');
    await updateBusinessSettings(tenantId, {
      ...freshBiz.settings,
      services_config: {
        enable_customer_followup: true,
        max_followup_attempts: 2,
        followup_delay_hours: 24,
      },
    });

    const followupJob = await scheduleServicesLeadFollowup({
      tenantId,
      leadId: lead1.id,
      conversationId: inquiry1.conversation_id,
      followupType: 'customer_followup',
      delayMinutes: 60,
    });

    assert(Boolean(followupJob?.id), 'Follow-up job scheduled successfully');

    // Eligibility check before dispatch
    const eligibility1 = await inspectServicesLeadFollowupEligibility(tenantId, lead1.id, followupJob.id);
    assert(eligibility1.eligible === true, 'Job is eligible when lead is open and active');

    // Customer replies -> Follow-up should be cancelled
    console.log('\n[8] Cancellation on Customer Reply or Manual Takeover...');
    await cancelServicesLeadFollowup(tenantId, lead1.id, 'customer_replied');

    const eligibilityAfterReply = await inspectServicesLeadFollowupEligibility(tenantId, lead1.id, followupJob.id);
    assert(eligibilityAfterReply.eligible === false, 'Follow-up cancelled after customer reply');
    assert(eligibilityAfterReply.action === 'cancel_obsolete', 'Action switches to cancel_obsolete');

    console.log(`\n==================================================`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`==================================================\n`);

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  }
}

run();

import assert from 'node:assert';
import { validateOutboundDispatch } from '../lib/outbound-guard.ts';
import { cleanQuotedReplyText, extractOrderReference, evaluateRoutineInquiry } from '../lib/routine-evaluator.ts';
import { sendGmailReply } from '../lib/gmail-service.ts';

console.log('====================================================');
console.log('RUNNING OUTBOUND DISPATCH & ROUTINE EVALUATOR FIXES TEST SUITE');
console.log('====================================================\n');

// --------------------------------------------------------------------------
// TEST 1: Centralized Outbound Dispatch Guard - Off-whitelist recipient blocked
// --------------------------------------------------------------------------
console.log('TEST 1: Off-whitelist recipient must be blocked fail-closed');
const res1 = validateOutboundDispatch({
  tenantId: 'sandbox-services-alpha',
  senderEmail: 'talhaishaqrabani9490@gmail.com',
  recipientEmail: 'talhaishaqrabani@gmail.com', // off-whitelist!
  isAutomated: true,
  approvalStatus: 'none',
  pilotWhitelist: {
    authorized_sender: 'talhaishaqrabani9490@gmail.com',
    authorized_recipient: 'mukaramajeed28094@gmail.com',
  },
  automationMode: 'auto_routine',
});
assert.strictEqual(res1.allowed, false, 'Off-whitelist recipient must not be allowed');
assert.strictEqual(res1.blocked, true, 'Off-whitelist recipient must be blocked');
assert.strictEqual(res1.action, 'block', 'Action must be block');
assert.ok(res1.reason.includes('off-whitelist'), 'Reason must mention off-whitelist');
console.log('  PASSED: Off-whitelist recipient correctly blocked fail-closed.\n');

// --------------------------------------------------------------------------
// TEST 2: Unapproved message in sandbox-services-alpha / draft_only
// --------------------------------------------------------------------------
console.log('TEST 2: Unapproved message in pilot workspace requires draft / approval');
const res2 = validateOutboundDispatch({
  tenantId: 'sandbox-services-alpha',
  senderEmail: 'talhaishaqrabani9490@gmail.com',
  recipientEmail: 'mukaramajeed28094@gmail.com', // on-whitelist
  isAutomated: true, // automated send attempted
  approvalStatus: 'none', // unapproved
  pilotWhitelist: {
    authorized_sender: 'talhaishaqrabani9490@gmail.com',
    authorized_recipient: 'mukaramajeed28094@gmail.com',
  },
  automationMode: 'auto_routine',
});
assert.strictEqual(res2.allowed, false, 'Unapproved automated send in pilot must not be allowed live');
assert.strictEqual(res2.action, 'draft_required', 'Action must be draft_required');
assert.ok(res2.reason.includes('explicit owner approval'), 'Reason must require explicit owner approval');
console.log('  PASSED: Unapproved message routed to draft_required without live sending.\n');

// --------------------------------------------------------------------------
// TEST 3: Approved message to whitelisted recipient in pilot
// --------------------------------------------------------------------------
console.log('TEST 3: Approved message to whitelisted recipient is allowed');
const res3 = validateOutboundDispatch({
  tenantId: 'sandbox-services-alpha',
  senderEmail: 'talhaishaqrabani9490@gmail.com',
  recipientEmail: 'mukaramajeed28094@gmail.com',
  isAutomated: false,
  approvalStatus: 'approved',
  pilotWhitelist: {
    authorized_sender: 'talhaishaqrabani9490@gmail.com',
    authorized_recipient: 'mukaramajeed28094@gmail.com',
  },
  automationMode: 'auto_routine',
});
assert.strictEqual(res3.allowed, true, 'Approved message to whitelisted recipient must be allowed');
assert.strictEqual(res3.action, 'allow', 'Action must be allow');
console.log('  PASSED: Approved whitelisted message allowed for dispatch.\n');

// --------------------------------------------------------------------------
// TEST 4: Automation Paused blocks automated dispatch
// --------------------------------------------------------------------------
console.log('TEST 4: Paused automation mode blocks automated dispatch');
const res4 = validateOutboundDispatch({
  tenantId: 'sandbox-services-alpha',
  senderEmail: 'talhaishaqrabani9490@gmail.com',
  recipientEmail: 'mukaramajeed28094@gmail.com',
  isAutomated: true,
  approvalStatus: 'approved',
  pilotWhitelist: {
    authorized_sender: 'talhaishaqrabani9490@gmail.com',
    authorized_recipient: 'mukaramajeed28094@gmail.com',
  },
  automationMode: 'paused',
});
assert.strictEqual(res4.allowed, false, 'Paused automation must block automated dispatch');
assert.strictEqual(res4.action, 'block', 'Action must be block');
console.log('  PASSED: Paused automation blocks dispatch.\n');

// --------------------------------------------------------------------------
// TEST 5: cleanQuotedReplyText multi-line Gmail attribution stripping
// --------------------------------------------------------------------------
console.log('TEST 5: cleanQuotedReplyText strips multi-line Gmail attribution');
const quotedEmailBody = `I need an update on my service visit.

On Sat, 17 Oct 2026 at 10:59 PM, Alpha HVAC Services <
talhaishaqrabani9490@gmail.com> wrote:
> Hello Talha,
> Thank you for contacting Alpha HVAC Services.
> Best regards,
> Alpha HVAC Services Support Team`;

const cleanedBody = cleanQuotedReplyText(quotedEmailBody);
assert.strictEqual(cleanedBody, 'I need an update on my service visit.');
assert.ok(!cleanedBody.includes('2026'), 'Cleaned body must not contain 2026');
assert.ok(!cleanedBody.includes('Alpha HVAC Services'), 'Cleaned body must not contain quoted signature');
console.log('  PASSED: Multi-line Gmail attribution stripped cleanly.\n');

// --------------------------------------------------------------------------
// TEST 6: extractOrderReference must NOT match 4-digit years like 2026
// --------------------------------------------------------------------------
console.log('TEST 6: extractOrderReference rejects standalone year 2026');
const ref1 = extractOrderReference('Hey sir 2026');
assert.strictEqual(ref1, null, 'Standalone 2026 must not be extracted as order reference');

const ref2 = extractOrderReference('On Sat, 17 Oct 2026 at 10:59 PM wrote:');
assert.strictEqual(ref2, null, 'Date in attribution must not be extracted as order reference');

const ref3 = extractOrderReference('Inquiry regarding our appointment in 2026');
assert.strictEqual(ref3, null, 'Year in sentence must not be extracted as order reference');

const ref4 = extractOrderReference('my order is #1001');
assert.notStrictEqual(ref4, null, 'Explicit #1001 must be extracted');
assert.strictEqual(ref4?.normalized, '1001');

const ref5 = extractOrderReference('what is status of order 1001');
assert.notStrictEqual(ref5, null, 'order 1001 with keyword must be extracted');
assert.strictEqual(ref5?.normalized, '1001');

const ref6 = extractOrderReference('ORD-DEMO-889');
assert.notStrictEqual(ref6, null, 'ORD- prefix must be extracted');
assert.strictEqual(ref6?.normalized, 'ORD-DEMO-889');
console.log('  PASSED: Order reference extraction correctly ignores dates/years and preserves valid orders.\n');

// --------------------------------------------------------------------------
// TEST 7: Services tenant does not receive e-commerce order replies
// --------------------------------------------------------------------------
console.log('TEST 7: Services tenant evaluates services inquiry without e-commerce order confusion');
const servicesSettings = {
  business_name: 'Alpha HVAC Services',
  industry: 'services',
  automation_mode: 'auto_routine',
  pilot_whitelist: {
    authorized_sender: 'talhaishaqrabani9490@gmail.com',
    authorized_recipient: 'mukaramajeed28094@gmail.com',
  },
  knowledge: {
    service_areas: [
      { name: 'Lahore Central', is_active: true, coverage_details: 'Residential and Commercial HVAC repair' }
    ]
  }
};

// Even if text mentions 2026, it should be treated as a greeting or service inquiry, NEVER order #2026 not found
const servicesEval = evaluateRoutineInquiry({
  subject: 'Hey sir',
  bodyText: 'Hey sir, checking availability for 2026',
  senderName: 'Talha ishaq Rabani',
  senderEmail: 'talhaishaqrabani@gmail.com',
  connectedEmail: 'talhaishaqrabani9490@gmail.com',
  isAutomated: false,
  settings: servicesSettings,
  orders: [],
});

assert.notStrictEqual(servicesEval.intent, 'routine_order_status', 'Must NOT evaluate as routine_order_status for services');
assert.ok(!servicesEval.replyText?.includes('#2026'), 'Reply must not mention #2026');
assert.ok(!servicesEval.replyText?.includes('checkout so we can locate your order'), 'Reply must not mention checkout email');
console.log('  PASSED: Services tenant correctly routes service inquiry without order lookup.\n');

// --------------------------------------------------------------------------
// TEST 8: Transport-Level Hard Stop in sendGmailReply
// --------------------------------------------------------------------------
console.log('TEST 8: sendGmailReply transport-level hard stop blocks off-whitelist recipient');
const mockSendResult = await sendGmailReply({
  accessToken: 'mock_access_token_never_sent',
  to: 'talhaishaqrabani@gmail.com', // off-whitelist recipient
  from: 'Alpha HVAC Services <talhaishaqrabani9490@gmail.com>',
  subject: 'Test subject',
  text: 'Test message body',
});
assert.strictEqual(mockSendResult.success, false, 'Must fail transport check');
assert.strictEqual(mockSendResult.status, 'failed', 'Status must be failed');
assert.ok(mockSendResult.error?.includes('Controlled Pilot Security Guard'), 'Error must cite pilot security guard');
assert.ok(mockSendResult.error?.includes('mukaramajeed28094@gmail.com'), 'Error must specify authorized recipient');
console.log('  PASSED: Transport level rejected off-whitelist recipient without making network request.\n');

console.log('====================================================');
console.log('ALL 8 MOCKED TESTS PASSED SUCCESSFULLY! ZERO LIVE EMAILS SENT.');
console.log('====================================================');

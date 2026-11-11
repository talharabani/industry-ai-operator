import { evaluateRoutineInquiry, cleanQuotedReplyText, extractOrderReference, matchOrderRecord } from '../lib/routine-evaluator.ts';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo' });

async function runTests() {
  console.log('--- FETCHING REAL DB DATA ---');
  const bizRes = await pool.query("SELECT * FROM iao.businesses WHERE tenant_id = 'demo-store'");
  const business = bizRes.rows[0];
  const settings = business?.settings || {};
  
  const ordersRes = await pool.query("SELECT * FROM iao.orders WHERE tenant_id = 'demo-store'");
  const orders = ordersRes.rows;
  console.log(`Loaded ${orders.length} orders from database:`, orders.map(o => ({ id: o.order_id, email: o.customer_email })));

  console.log('\n======================================================');
  console.log('TEST 1: Customer mukaramajeed28094@gmail.com asking for #1001');
  console.log('======================================================');
  const res1 = evaluateRoutineInquiry({
    subject: 'Re: Order Confirmation',
    bodyText: 'hi what is the current status of my order? #1001',
    senderName: 'Mukaram Majeed',
    senderEmail: 'mukaramajeed28094@gmail.com',
    connectedEmail: 'talhaishaqrabani9490@gmail.com',
    isAutomated: false,
    settings,
    orders,
  });
  console.log('Intent:', res1.intent);
  console.log('Can Auto Reply:', res1.canAutoReply);
  console.log('Reason:', res1.reason);
  console.log('Reply:\n' + res1.replyText);

  if (res1.intent !== 'routine_order_status') throw new Error('Test 1 failed: Expected routine_order_status');
  if (!res1.replyText?.includes('#1001')) throw new Error('Test 1 failed: Missing order ID in reply');
  if (!res1.replyText?.includes('UNFULFILLED')) throw new Error('Test 1 failed: Missing UNFULFILLED status');
  if (!res1.replyText?.includes('USD 749.95')) throw new Error('Test 1 failed: Missing USD 749.95 total');
  if (!res1.replyText?.includes('The Collection Snowboard: Liquid')) throw new Error('Test 1 failed: Missing product item name');
  if (res1.replyText?.includes('TRK-PK-991122')) throw new Error('Test 1 failed: Hallucinated demo tracking number!');

  console.log('\n======================================================');
  console.log('TEST 2: Customer mukaramajeed28094@gmail.com asking without # (plain 1001)');
  console.log('======================================================');
  const res2 = evaluateRoutineInquiry({
    subject: 'Order inquiry',
    bodyText: 'what is the status of order 1001',
    senderName: 'Mukaram Majeed',
    senderEmail: 'mukaramajeed28094@gmail.com',
    connectedEmail: 'talhaishaqrabani9490@gmail.com',
    isAutomated: false,
    settings,
    orders,
  });
  console.log('Intent:', res2.intent);
  console.log('Reason:', res2.reason);
  console.log('Reply:\n' + res2.replyText);
  if (res2.intent !== 'routine_order_status' || !res2.replyText?.includes('UNFULFILLED')) {
    throw new Error('Test 2 failed: Expected matching #1001 for plain 1001 query');
  }

  console.log('\n======================================================');
  console.log('TEST 3: Different customer (stranger@example.com) asking for #1001');
  console.log('======================================================');
  const res3 = evaluateRoutineInquiry({
    subject: 'Order tracking',
    bodyText: 'hi where is my order #1001',
    senderName: 'Eve Hacker',
    senderEmail: 'stranger@example.com',
    connectedEmail: 'talhaishaqrabani9490@gmail.com',
    isAutomated: false,
    settings,
    orders,
  });
  console.log('Intent:', res3.intent);
  console.log('Reason:', res3.reason);
  console.log('Reply:\n' + res3.replyText);
  if (!res3.reason.includes('Privacy gate engaged')) {
    throw new Error('Test 3 failed: Privacy gate was not engaged for different customer!');
  }
  if (res3.replyText?.includes('Snowboard') || res3.replyText?.includes('749.95')) {
    throw new Error('Test 3 failed: Order details leaked to unauthorized email!');
  }

  console.log('\n======================================================');
  console.log('TEST 4: Non-existent order (#9999)');
  console.log('======================================================');
  const res4 = evaluateRoutineInquiry({
    subject: 'Where is my order',
    bodyText: 'hi check order #9999 please',
    senderName: 'Mukaram Majeed',
    senderEmail: 'mukaramajeed28094@gmail.com',
    connectedEmail: 'talhaishaqrabani9490@gmail.com',
    isAutomated: false,
    settings,
    orders,
  });
  console.log('Intent:', res4.intent);
  console.log('Reason:', res4.reason);
  console.log('Reply:\n' + res4.replyText);
  if (!res4.reason.includes('not found in database') || !res4.replyText?.includes('double-check your order number')) {
    throw new Error('Test 4 failed: Missing clarification for non-existent order');
  }

  console.log('\n======================================================');
  console.log('TEST 5: Explicit demo ORD-1001 inquiry by ayesha.m@example.com');
  console.log('======================================================');
  const res5 = evaluateRoutineInquiry({
    subject: 'Order update',
    bodyText: 'please check status of ORD-1001',
    senderName: 'Ayesha Malik',
    senderEmail: 'ayesha.m@example.com',
    connectedEmail: 'talhaishaqrabani9490@gmail.com',
    isAutomated: false,
    settings,
    orders,
  });
  console.log('Intent:', res5.intent);
  console.log('Reason:', res5.reason);
  console.log('Reply:\n' + res5.replyText);
  if (!res5.replyText?.includes('ORD-1001') || !res5.replyText?.includes('DELIVERED')) {
    throw new Error('Test 5 failed: Demo ORD-1001 failed to match for legitimate owner');
  }

  console.log('\n======================================================');
  console.log('TEST 6: Quoted text stripping for thread reply');
  console.log('======================================================');
  const quotedEmail = `who are you

On Wed, 7 Oct 2026 at 03:54, rabani <talhaishaqrabani9490@gmail.com> wrote:

> Hello Mukaram,
>
> Thank you for reaching out to rabani.
>
> Regarding your question "What is your standard return and exchange window?":
> Items in original unworn condition with tags attached can be returned
> or exchanged within 14 days of confirmed delivery.`;

  const stripped = cleanQuotedReplyText(quotedEmail);
  console.log('Cleaned body:\n"' + stripped + '"');
  if (stripped !== 'who are you') {
    throw new Error(`Test 6 failed: Quoted text was not properly stripped. Got: "${stripped}"`);
  }

  const res6 = evaluateRoutineInquiry({
    subject: 'Re: Order Inquiry',
    bodyText: quotedEmail,
    senderName: 'Mukaram Majeed',
    senderEmail: 'mukaramajeed28094@gmail.com',
    connectedEmail: 'talhaishaqrabani9490@gmail.com',
    isAutomated: false,
    settings,
    orders,
  });
  console.log('Intent for "who are you" with quotes stripped:', res6.intent);
  if (res6.intent === 'routine_policy_info') {
    throw new Error('Test 6 failed: False positive policy match triggered by quoted text!');
  }

  console.log('\n>>> ALL 6 TESTS PASSED PERFECTLY! <<<');
  await pool.end();
}

runTests().catch((err) => {
  console.error('Test run error:', err);
  process.exit(1);
});

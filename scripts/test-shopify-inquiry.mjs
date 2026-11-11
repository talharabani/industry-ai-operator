import pg from 'pg';
import { evaluateRoutineInquiry } from '../lib/routine-evaluator.ts';
import { classifyEmailMessage } from '../lib/email-filter.ts';

const pool = new pg.Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo' });

async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

async function main() {
  console.log('=== VERIFYING SHOPIFY INQUIRY & FILTER BEHAVIOR ===');

  const bizRows = await query(`SELECT settings FROM iao.businesses WHERE tenant_id = 'demo-store';`);
  const settings = bizRows[0].settings;

  console.log('Active Store Name:', settings.business_name);
  console.log('Active Store Currency:', settings.currency);

  // 1. Verify "The Collection Snowboard: Liquid" inquiry
  const customerInquiry = evaluateRoutineInquiry({
    subject: 'Question about The Collection Snowboard: Liquid',
    bodyText: 'Hi, do you have The Collection Snowboard: Liquid in stock and what is the price?',
    senderName: 'Sarah Connor',
    senderEmail: 'sarah.connor@example.com',
    settings,
  });

  console.log('\n--- Customer Product Inquiry Evaluation ---');
  console.log('Intent:', customerInquiry.intent);
  console.log('Can Auto Reply:', customerInquiry.canAutoReply);
  console.log('Reply Text:\n' + customerInquiry.replyText);

  // 2. Verify Non-Customer Sign-in Alert
  const signinAlert = evaluateRoutineInquiry({
    subject: 'New sign-in to your Shopify account',
    bodyText: 'We noticed a new sign-in to your account from a new device. If this was you, you are all set.',
    senderName: 'Shopify',
    senderEmail: 'mailer@shopify.com',
    settings,
  });

  console.log('\n--- Shopify Sign-in Alert Evaluation ---');
  console.log('Intent:', signinAlert.intent);
  console.log('Can Auto Reply:', signinAlert.canAutoReply);
  console.log('Reason:', signinAlert.reason);

  // 3. Verify Non-Customer OTP Verification Code
  const otpAlert = evaluateRoutineInquiry({
    subject: 'Your verification code',
    bodyText: 'We received a request to verify your account. Use this one time code to continue: 961262. This code expires in 10 minutes.',
    senderName: 'Shopify',
    senderEmail: 'mailer@shopify.com',
    settings,
  });

  console.log('\n--- Shopify OTP Alert Evaluation ---');
  console.log('Intent:', otpAlert.intent);
  console.log('Can Auto Reply:', otpAlert.canAutoReply);
  console.log('Reason:', otpAlert.reason);

  // 4. Verify Genuine Customer asking with "verification", "refund", "Shopify" in text
  const genuineCustomerInquiry = evaluateRoutineInquiry({
    subject: 'Verification for my Shopify refund',
    bodyText: 'Hi, what is your refund policy and how many days do I have to return an item bought on your store?',
    senderName: 'Alex Mercer',
    senderEmail: 'alex.mercer@gmail.com',
    settings,
  });

  console.log('\n--- Genuine Customer with keywords Evaluation ---');
  console.log('Intent:', genuineCustomerInquiry.intent);
  console.log('Can Auto Reply:', genuineCustomerInquiry.canAutoReply);
  console.log('Reply Text:\n' + genuineCustomerInquiry.replyText);

  await pool.end();
}

main().catch(console.error);

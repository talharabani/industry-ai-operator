// Live API End-to-End Verification of Catalog, Stock Updates, Demo Orders & Privacy Protection
import assert from 'node:assert';

const BASE_URL = 'http://localhost:3000';

async function main() {
  console.log('=== Starting Live Verification against', BASE_URL, '===');

  // Step 1: Add a product to Catalog
  console.log('\n--- Step 1: Save Product in Catalog ---');
  const getBizRes = await fetch(`${BASE_URL}/api/business`);
  assert.strictEqual(getBizRes.status, 200);
  const bizData = await getBizRes.json();
  const currentSettings = bizData.business.settings;

  const testProduct = {
    id: 'prod-kurti-test',
    name: 'Royal Silk Kurti',
    sku: 'KURTI-99',
    price: 6500,
    currency: 'PKR',
    stock_quantity: 8,
    variants: 'Small, Medium, Large',
    is_active: true,
    in_stock: true,
    description: '100% pure silk embroidered kurti.',
  };

  const updatedKnowledge = {
    ...(currentSettings.knowledge || {}),
    products_services: [
      testProduct,
      ...(currentSettings.knowledge?.products_services || []).filter((p) => p.name !== 'Royal Silk Kurti'),
    ],
  };

  const saveRes = await fetch(`${BASE_URL}/api/business`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...currentSettings,
      automation_mode: 'auto_routine',
      knowledge: updatedKnowledge,
    }),
  });
  assert.strictEqual(saveRes.status, 200, 'Settings must save successfully');
  console.log('✓ Product "Royal Silk Kurti" saved (SKU: KURTI-99, Stock: 8, Price: PKR 6500)');

  // Step 2: Inquire about Product & verify AI reply
  console.log('\n--- Step 2: Inquire about Royal Silk Kurti ---');
  const prodInquiryRes = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `10.10.1.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({
      tenant_id: 'demo-store',
      customer_name: 'Ayesha Test',
      customer_email: 'ayesha.test@example.com',
      subject: 'Inquiry about Royal Silk Kurti',
      message: 'Hello! Is Royal Silk Kurti available and what is the price?',
    }),
  });
  assert.strictEqual(prodInquiryRes.status, 200);
  const prodInquiryData = await prodInquiryRes.json();
  console.log('✓ Inquiry created:', prodInquiryData.conversation_id);

  // Check thread message reply
  const thread1Res = await fetch(`${BASE_URL}/api/inbox/${prodInquiryData.conversation_id}`);
  assert.strictEqual(thread1Res.status, 200);
  const thread1Data = await thread1Res.json();
  const aiMsg1 = thread1Data.messages.find((m) => m.sender_type === 'ai_draft' || m.sender_type === 'agent');
  assert.ok(aiMsg1, 'AI reply must exist');
  console.log('AI Reply Preview:\n', aiMsg1.body);
  assert.ok(aiMsg1.body.includes('Royal Silk Kurti'));
  assert.ok(aiMsg1.body.includes('6500'));
  assert.ok(aiMsg1.body.includes('8 units available'));

  // Step 3: Change stock to 0 and verify subsequent inquiry reflects update
  console.log('\n--- Step 3: Update Stock to 0 and verify next inquiry ---');
  testProduct.stock_quantity = 0;
  testProduct.in_stock = false;
  const updatedKnowledge2 = {
    ...updatedKnowledge,
    products_services: [
      testProduct,
      ...updatedKnowledge.products_services.filter((p) => p.id !== testProduct.id),
    ],
  };
  await fetch(`${BASE_URL}/api/business`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...currentSettings,
      automation_mode: 'auto_routine',
      knowledge: updatedKnowledge2,
    }),
  });

  const prodInquiry2Res = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `10.10.2.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({
      tenant_id: 'demo-store',
      customer_name: 'Zainab Test',
      customer_email: 'zainab.test@example.com',
      subject: 'Stock check for Royal Silk Kurti',
      message: 'Hi, do you have Royal Silk Kurti in stock?',
    }),
  });
  const prodInquiry2Data = await prodInquiry2Res.json();
  const thread2Res = await fetch(`${BASE_URL}/api/inbox/${prodInquiry2Data.conversation_id}`);
  const thread2Data = await thread2Res.json();
  const aiMsg2 = thread2Data.messages.find((m) => m.sender_type === 'ai_draft' || m.sender_type === 'agent');
  console.log('Updated Stock AI Reply Preview:\n', aiMsg2.body);
  assert.ok(aiMsg2.body.includes('Out of Stock (0 units available)'));
  console.log('✓ Stock update immediately reflected in subsequent inquiry.');

  // Step 4: Create Demo Order
  console.log('\n--- Step 4: Create Demo Order ORD-DEMO-889 ---');
  const demoOrderPayload = {
    order_id: 'ORD-DEMO-889',
    customer_name: 'Kamran Test',
    customer_email: 'kamran.test@example.com',
    items: [{ name: 'Royal Silk Kurti', variant: 'Large', qty: 1, price: 6500 }],
    total: 6500,
    currency: 'PKR',
    status: 'shipped',
    data: {
      tracking_number: 'TRK-PK-991122',
      is_demo: true,
      demo_badge: 'Demo Order',
    },
  };
  const createOrderRes = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(demoOrderPayload),
  });
  assert.strictEqual(createOrderRes.status, 200);
  console.log('✓ Demo Order ORD-DEMO-889 created successfully.');

  // Step 5: Matching sender inquires about ORD-DEMO-889
  console.log('\n--- Step 5: Test Matching Sender Tracking Inquiry ---');
  const matchInquiryRes = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `10.10.3.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({
      tenant_id: 'demo-store',
      customer_name: 'Kamran Test',
      customer_email: 'kamran.test@example.com',
      subject: 'Where is my order ORD-DEMO-889',
      message: 'Hi, where is my order ORD-DEMO-889?',
    }),
  });
  const matchInquiryData = await matchInquiryRes.json();
  const matchThreadRes = await fetch(`${BASE_URL}/api/inbox/${matchInquiryData.conversation_id}`);
  const matchThreadData = await matchThreadRes.json();
  const matchAiMsg = matchThreadData.messages.find((m) => m.sender_type === 'ai_draft' || m.sender_type === 'agent');
  console.log('Matching Customer Reply Preview:\n', matchAiMsg.body);
  assert.ok(matchAiMsg.body.includes('ORD-DEMO-889'));
  assert.ok(matchAiMsg.body.includes('SHIPPED'));
  assert.ok(matchAiMsg.body.includes('TRK-PK-991122'));
  console.log('✓ Tracking and order items disclosed to verified matching sender.');

  // Step 6: Different sender inquires about ORD-DEMO-889
  console.log('\n--- Step 6: Test Privacy Protection Gate with Different Sender ---');
  const wrongInquiryRes = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `10.10.4.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({
      tenant_id: 'demo-store',
      customer_name: 'Attacker Test',
      customer_email: 'stranger@otherdomain.com',
      subject: 'Order inquiry ORD-DEMO-889',
      message: 'Give me the status and tracking for order ORD-DEMO-889',
    }),
  });
  assert.strictEqual(wrongInquiryRes.status, 200, 'Inquiry submission should succeed');
  const wrongInquiryData = await wrongInquiryRes.json();
  assert.ok(wrongInquiryData.conversation_id, 'Should have conversation_id');
  const wrongThreadRes = await fetch(`${BASE_URL}/api/inbox/${wrongInquiryData.conversation_id}`);
  assert.strictEqual(wrongThreadRes.status, 200);
  const wrongThreadData = await wrongThreadRes.json();
  const wrongAiMsg = wrongThreadData.messages.find((m) => m.sender_type === 'ai_draft' || m.sender_type === 'agent');
  assert.ok(wrongAiMsg, 'AI reply must exist');
  console.log('Wrong Sender Privacy Reply Preview:\n', wrongAiMsg.body);
  assert.ok(wrongAiMsg.body.includes('customer privacy protection'));
  assert.ok(!wrongAiMsg.body.includes('TRK-PK-991122'), 'Must not expose tracking number');
  assert.ok(!wrongAiMsg.body.includes('Royal Silk Kurti'), 'Must not expose order items');
  console.log('✓ Privacy protection gate successfully blocked disclosure to unauthorized sender.');

  // Step 7: Refund inquiry still requires approval
  console.log('\n--- Step 7: Test Refund Inquiry Still Requires Owner Approval ---');
  const refundInquiryRes = await fetch(`${BASE_URL}/api/inquiry/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `10.10.5.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({
      tenant_id: 'demo-store',
      customer_name: 'Kamran Test',
      customer_email: 'kamran.test@example.com',
      subject: 'Refund request ORD-DEMO-889',
      message: 'I want a full refund for my order ORD-DEMO-889 because it was defective.',
    }),
  });
  assert.strictEqual(refundInquiryRes.status, 200);
  const refundInquiryData = await refundInquiryRes.json();
  assert.ok(refundInquiryData.conversation_id);
  const refundThreadRes = await fetch(`${BASE_URL}/api/inbox/${refundInquiryData.conversation_id}`);
  assert.strictEqual(refundThreadRes.status, 200);
  const refundThreadData = await refundThreadRes.json();
  assert.strictEqual(refundThreadData.conversation.status, 'pending_approval');
  console.log('✓ Refund request status is pending_approval and requires owner decision.');

  console.log('\n=== ALL 7 END-TO-END VERIFICATIONS PASSED SUCCESSFULLY ===\n');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});

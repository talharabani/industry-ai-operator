import assert from 'node:assert';
import { evaluateRoutineInquiry } from '../lib/routine-evaluator.ts';

console.log('====================================================================');
console.log('=== MULTI-STORE COEXISTENCE & ISOLATION REGRESSION TEST SUITE ===');
console.log('====================================================================\n');

// 1. Build test business settings with dual store policies (rabani Shopify + The Baby Supply Custom Store)
const testSettings = {
  business_name: 'rabani',
  industry: 'ecommerce',
  currency: 'USD',
  country: 'United States',
  timezone: 'America/New_York',
  support_email: 'talhaishaqrabani9490@gmail.com',
  language: 'English',
  automation_mode: 'auto_routine',
  allow_demo_grounding: false,
  return_window_days: 30,
  knowledge: {
    policies: {
      return_window_days: 30,
      general_rules: 'rabani items in original condition qualify for 30-day returns in the US.',
      shipping_timeframe: 'rabani orders ship within 2-3 business days across the US.',
    },
    store_policies: {
      shopify_primary: {
        store_name: 'rabani',
        currency: 'USD',
        provider: 'shopify',
        connection_id: 'shopify_primary',
        return_window_days: 30,
        return_policy: 'rabani accepts returns within 30 days of delivery for unworn items with tags.',
        shipping_policy: 'Orders ship within 1-2 business days via FedEx/USPS nationwide.',
        support_email: 'talhaishaqrabani9490@gmail.com',
      },
      'conn_custom_demo-store': {
        store_name: 'The Baby Supply',
        currency: 'EUR',
        provider: 'custom',
        connection_id: 'conn_custom_demo-store',
        return_window_days: 14,
        return_policy: 'The Baby Supply hanteert 14 dagen bedenktijd conform Nederlandse wetgeving.',
        shipping_policy: 'Bestellingen voor 23:59 worden dezelfde dag verzonden via PostNL in Nederland en België.',
        support_email: 'info@thebabysupply.nl',
      },
    },
    products_services: [
      // rabani products
      {
        id: 'sp-snowboard-liquid',
        name: 'The Collection Snowboard: Liquid',
        price: 749.95,
        currency: 'USD',
        store_name: 'rabani',
        provider: 'shopify',
        connection_id: 'shopify_primary',
        in_stock: true,
      },
      // Overlapping Product 1: Gift Card in rabani ($50 USD)
      {
        id: 'sp-gift-card-50',
        name: 'Gift Card',
        price: 50.00,
        currency: 'USD',
        store_name: 'rabani',
        provider: 'shopify',
        connection_id: 'shopify_primary',
        in_stock: true,
      },
      // The Baby Supply products (demo fixtures)
      {
        id: 'cs-tbs-babyfoon',
        name: 'Philips Avent Babyfoon DECT SCD713/26',
        price: 119.99,
        currency: 'EUR',
        store_name: 'The Baby Supply (Demo Fixture)',
        provider: 'custom',
        connection_id: 'conn_custom_demo-store',
        is_demo_fixture: true,
        in_stock: true,
      },
      // Overlapping Product 2: Gift Card in The Baby Supply (€50 EUR)
      {
        id: 'cs-tbs-gift-card',
        name: 'Gift Card',
        price: 50.00,
        currency: 'EUR',
        store_name: 'The Baby Supply (Demo Fixture)',
        provider: 'custom',
        connection_id: 'conn_custom_demo-store',
        is_demo_fixture: true,
        in_stock: true,
      },
    ],
  },
};

// 2. Shared customer with orders in BOTH stores with overlapping order reference "#1001"
const sharedCustomerEmail = 'shared.shopper@example.com';

const testOrders = [
  // rabani Shopify Order #1001
  {
    order_id: '#1001',
    customer_email: sharedCustomerEmail,
    total: '749.95',
    currency: 'USD',
    status: 'unfulfilled',
    connection_id: 'shopify_primary',
    provider: 'shopify',
    items: [
      { name: 'The Collection Snowboard: Liquid', qty: 1, price: 749.95, currency: 'USD' },
    ],
    data: {
      source: 'shopify',
      provider: 'shopify',
      shopify_name: '#1001',
      shopify_order_id: '7275667423522',
      customer_email: sharedCustomerEmail,
      carrier: 'USPS',
      tracking_number: '9400111899223190012345',
      store_name: 'rabani',
    },
  },
  // The Baby Supply Custom Order #1001 / TBS-1001
  {
    order_id: 'custom:conn_custom_demo-store:ord_tbs_1001',
    customer_email: sharedCustomerEmail,
    total: '119.99',
    currency: 'EUR',
    status: 'fulfilled',
    connection_id: 'conn_custom_demo-store',
    provider: 'custom',
    order_number: '#1001',
    external_order_id: 'ord_tbs_1001',
    is_demo_fixture: true,
    items: [
      { name: 'Philips Avent Babyfoon DECT SCD713/26', qty: 1, price: 119.99, currency: 'EUR' },
    ],
    data: {
      source: 'custom_store',
      provider: 'custom',
      order_number: '#1001',
      external_order_id: 'ord_tbs_1001',
      customer_email: sharedCustomerEmail,
      carrier: 'PostNL',
      tracking_number: '3STEST987654321',
      store_name: 'The Baby Supply',
      is_demo_fixture: true,
    },
  },
];

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

// =========================================================================
// TEST SUITE: Multi-Store Disambiguation, Currency, Policy & Privacy
// =========================================================================

console.log('--- Case 1: Unambiguous rabani Order Query ---');
runTest('Explicit rabani order lookup returns rabani identity and USD currency', () => {
  const result = evaluateRoutineInquiry({
    subject: 'Status of order 1001',
    bodyText: 'Hi, what is the status of my rabani order #1001?',
    senderName: 'Shared Shopper',
    senderEmail: sharedCustomerEmail,
    settings: testSettings,
    orders: testOrders,
  });

  assert.strictEqual(result.intent, 'routine_order_status');
  assert.ok(result.replyText?.includes('rabani'), 'Reply must identify as rabani');
  assert.ok(!result.replyText?.includes('The Baby Supply'), 'Reply must not mention The Baby Supply');
  assert.ok(result.replyText?.includes('USD 749.95'), 'Must format order total in USD');
  assert.ok(!result.replyText?.includes('EUR'), 'Must not include EUR currency');
  assert.ok(result.replyText?.includes('The Collection Snowboard: Liquid'), 'Must include correct rabani item');
});

console.log('\n--- Case 2: Unambiguous The Baby Supply Order Query ---');
runTest('Explicit The Baby Supply order lookup returns TBS identity and EUR currency', () => {
  const result = evaluateRoutineInquiry({
    subject: 'Status van bestelling',
    bodyText: 'Hallo, wat is de status van mijn bestelling ord_tbs_1001 bij The Baby Supply?',
    senderName: 'Shared Shopper',
    senderEmail: sharedCustomerEmail,
    settings: testSettings,
    orders: testOrders,
  });

  assert.strictEqual(result.intent, 'routine_order_status');
  assert.ok(result.replyText?.includes('The Baby Supply'), 'Reply must identify as The Baby Supply');
  assert.ok(!result.replyText?.includes('rabani'), 'Reply must not mention rabani');
  assert.ok(result.replyText?.includes('EUR 119.99'), 'Must format order total in EUR');
  assert.ok(!result.replyText?.includes('USD'), 'Must not include USD currency');
  assert.ok(result.replyText?.includes('Philips Avent Babyfoon'), 'Must include TBS item');
});

console.log('\n--- Case 3: Overlapping Order Reference Disambiguation ---');
runTest('Ambiguous order #1001 query with shared customer asks clarification without mixing', () => {
  const result = evaluateRoutineInquiry({
    subject: 'Where is my order?',
    bodyText: 'Hello, could you please give me an update on order #1001?',
    senderName: 'Shared Shopper',
    senderEmail: sharedCustomerEmail,
    settings: testSettings,
    orders: testOrders,
  });

  assert.strictEqual(result.intent, 'routine_order_status');
  assert.ok(
    result.reason?.includes('Ambiguous order match') || result.replyText?.includes('multiple active orders'),
    'Must detect ambiguity across multiple stores'
  );
  assert.ok(
    result.replyText?.includes('rabani') && result.replyText?.includes('The Baby Supply'),
    'Reply must list both candidate stores to the user'
  );
  assert.ok(
    result.replyText?.includes('specify which store') || result.replyText?.includes('confirmation email'),
    'Must ask customer for store clarification'
  );
  // Zero mixing: must not disclose items or tracking from either order
  assert.ok(!result.replyText?.includes('Snowboard'), 'Must not disclose rabani items before clarification');
  assert.ok(!result.replyText?.includes('Babyfoon'), 'Must not disclose TBS items before clarification');
});

console.log('\n--- Case 4: Customer Privacy Protection Gate ---');
runTest('Unauthorized sender cannot retrieve order details belonging to shared shopper', () => {
  const result = evaluateRoutineInquiry({
    subject: 'Where is order 1001',
    bodyText: 'Can you tell me where rabani order #1001 is going?',
    senderName: 'Nosy Stranger',
    senderEmail: 'nosy.stranger@otherdomain.com',
    settings: testSettings,
    orders: testOrders,
  });

  assert.strictEqual(result.intent, 'routine_order_status');
  assert.ok(
    result.reason?.includes('Privacy gate engaged') || result.reason?.includes('does not match'),
    'Reason must record customer privacy gate engagement'
  );
  assert.ok(
    result.replyText?.includes('privacy protection') || result.replyText?.includes('does not match'),
    'Reply must inform sender that email does not match registered order record'
  );
  // Zero leakage of private customer details
  assert.ok(!result.replyText?.includes('9400111899223190012345'), 'Must not disclose tracking number');
  assert.ok(!result.replyText?.includes('The Collection Snowboard'), 'Must not disclose line items');
});

console.log('\n--- Case 5: Policy Disambiguation Across Stores ---');
runTest('General policy inquiry without store asks clarification instead of mixing policies', () => {
  const result = evaluateRoutineInquiry({
    subject: 'Return question',
    bodyText: 'Hello, what is your return policy?',
    senderName: 'Customer',
    senderEmail: 'shopper@example.com',
    settings: testSettings,
    orders: testOrders,
  });

  assert.strictEqual(result.intent, 'routine_clarification');
  assert.ok(
    result.reason?.includes('Ambiguous policy inquiry'),
    'Must identify ambiguous policy inquiry across connected stores'
  );
  assert.ok(
    result.replyText?.includes('clarify which store') || result.replyText?.includes('multiple connected stores'),
    'Must ask customer which store they are inquiring about'
  );
  // Zero policy mixing: must not state contradictory 14-day or 30-day rules
  assert.ok(!result.replyText?.includes('30 days of delivery'), 'Must not assert rabani rules');
  assert.ok(!result.replyText?.includes('14 dagen bedenktijd'), 'Must not assert TBS rules');
});

console.log('\n--- Case 6: Store-Specific rabani Policy Query ---');
runTest('Explicit rabani policy inquiry returns 30-day window and US shipping policy', () => {
  const result = evaluateRoutineInquiry({
    subject: 'Returns at rabani',
    bodyText: 'Hi, what is the return window for rabani purchases?',
    senderName: 'Shopper',
    senderEmail: 'shopper@example.com',
    settings: testSettings,
    orders: testOrders,
  });

  assert.strictEqual(result.intent, 'routine_policy_info');
  assert.ok(result.replyText?.includes('rabani'), 'Must identify as rabani');
  assert.ok(!result.replyText?.includes('The Baby Supply'), 'Must not mention The Baby Supply');
  assert.ok(result.replyText?.includes('30 days'), 'Must return rabani 30-day return window');
  assert.ok(!result.replyText?.includes('14'), 'Must not return TBS 14-day policy');
});

console.log('\n--- Case 7: Store-Specific The Baby Supply Policy Query ---');
runTest('Explicit The Baby Supply policy inquiry returns 14-day window and Dutch policy', () => {
  const result = evaluateRoutineInquiry({
    subject: 'Retourneren The Baby Supply',
    bodyText: 'Hoe werkt het retourneren bij The Baby Supply?',
    senderName: 'Shopper',
    senderEmail: 'shopper@example.com',
    settings: testSettings,
    orders: testOrders,
  });

  assert.strictEqual(result.intent, 'routine_policy_info');
  assert.ok(result.replyText?.includes('The Baby Supply'), 'Must identify as The Baby Supply');
  assert.ok(!result.replyText?.includes('rabani'), 'Must not mention rabani');
  assert.ok(
    result.replyText?.includes('14 dagen bedenktijd') || result.replyText?.includes('14 days'),
    'Must return TBS 14-day return window'
  );
});

console.log('\n--- Case 8: Overlapping Product Clarification ---');
runTest('Inquiry for overlapping product "Gift Card" asks clarification across stores', () => {
  const result = evaluateRoutineInquiry({
    subject: 'Gift card question',
    bodyText: 'Do you sell a Gift Card and how much is it?',
    senderName: 'Shopper',
    senderEmail: 'shopper@example.com',
    settings: testSettings,
    orders: testOrders,
  });

  assert.strictEqual(result.intent, 'routine_clarification');
  assert.ok(
    result.reason?.includes('Cross-store product match'),
    'Must identify cross-store product match'
  );
  assert.ok(
    result.replyText?.includes('Gift Card') && result.replyText?.includes('rabani') && result.replyText?.includes('The Baby Supply'),
    'Must name both stores with matching products'
  );
  assert.ok(!result.replyText?.includes('USD 50') && !result.replyText?.includes('EUR 50'), 'Must not mix currencies in clarification');
});

console.log('\n--- Case 9: rabani-Specific Product Lookup ---');
runTest('Explicit inquiry for rabani Gift Card returns USD 50.00', () => {
  const result = evaluateRoutineInquiry({
    subject: 'rabani Gift Card',
    bodyText: 'Can I purchase a rabani Gift Card?',
    senderName: 'Shopper',
    senderEmail: 'shopper@example.com',
    settings: testSettings,
    orders: testOrders,
  });

  assert.strictEqual(result.intent, 'routine_product_info');
  assert.ok(result.replyText?.includes('rabani'), 'Must identify as rabani');
  assert.ok(!result.replyText?.includes('The Baby Supply'), 'Must not mention The Baby Supply');
  assert.ok(result.replyText?.includes('USD 50'), 'Must format price in USD');
  assert.ok(!result.replyText?.includes('EUR'), 'Must not format price in EUR');
});

console.log('\n--- Case 10: The Baby Supply Product Lookup ---');
runTest('Explicit inquiry for The Baby Supply Gift Card returns EUR 50.00', () => {
  const result = evaluateRoutineInquiry({
    subject: 'The Baby Supply Gift Card',
    bodyText: 'Kan ik een The Baby Supply Gift Card kopen?',
    senderName: 'Shopper',
    senderEmail: 'shopper@example.com',
    settings: testSettings,
    orders: testOrders,
  });

  assert.strictEqual(result.intent, 'routine_product_info');
  assert.ok(result.replyText?.includes('The Baby Supply'), 'Must identify as The Baby Supply');
  assert.ok(!result.replyText?.includes('rabani'), 'Must not mention rabani');
  assert.ok(result.replyText?.includes('EUR 50'), 'Must format price in EUR');
  assert.ok(!result.replyText?.includes('USD'), 'Must not format price in USD');
});

console.log('\n--- Case 11: Production Live Channel Guard ---');
runTest('Live channel inquiry on demo fixture order is gated from auto-replying', () => {
  const result = evaluateRoutineInquiry({
    subject: 'Live order tracking',
    bodyText: 'Where is my order ord_tbs_1001 for The Baby Supply?',
    senderName: 'Shared Shopper',
    senderEmail: sharedCustomerEmail,
    settings: testSettings,
    orders: testOrders,
    channel: 'gmail',
    isLiveChannel: true,
  });

  // On live channel, allow_demo_grounding is false, so demo fixture order is filtered out or gated
  assert.strictEqual(result.canAutoReply, false, 'Must not auto reply on live channel using demo fixture');
  assert.strictEqual(result.requiresApproval, true, 'Must route to owner review');
  assert.ok(
    result.reason?.includes('Demo fixture') || result.reason?.includes('not found'),
    'Reason must indicate demo fixture gate or order isolation'
  );
});

console.log('\n====================================================================');
console.log(`=== ALL ${passed}/${total} MULTI-STORE COEXISTENCE TESTS PASSED! ===`);
console.log('====================================================================\n');

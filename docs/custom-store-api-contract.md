# Industry-Adaptive AI Operator: Custom Store API Contract (v1)

This specification defines the authenticated API contract required for connecting custom e-commerce websites and bespoke storefronts to the Industry-Adaptive AI Operator.

> **Principle**: A website URL alone is not a connection. To enable grounded AI replies, automated customer verification, order issue tracking, and financial approval gates, the custom storefront must expose the authenticated `v1` REST endpoints detailed below.

---

## 1. Authentication & Security

The custom store API must authenticate all requests using one of the following methods:

### Supported Authentication Methods
1. **Bearer Token (Recommended)**:
   ```http
   Authorization: Bearer <API_TOKEN>
   ```
2. **API Key Header**:
   ```http
   X-API-Key: <API_KEY>
   ```
3. **HTTP Basic Auth**:
   ```http
   Authorization: Basic <base64(username:password)>
   ```

### Transport & SSRF Requirements
- **Protocol**: HTTPS is mandatory in production environments. HTTP is allowed exclusively for local development loopback addresses (`127.0.0.1`, `localhost`) when development allowlists are active.
- **SSRF Validation**: The AI Operator validates all outbound hostnames, disallowing private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`) and cloud metadata services (`169.254.169.254`).
- **Redirects**: Cross-origin redirects will automatically strip authentication credentials to prevent credential forwarding.

---

## 2. Store Profile & Policies Endpoint

Returns brand metadata, currency, operating timezone, and published customer service policies.

- **Method**: `GET`
- **Path**: `/api/v1/store`
- **Response Format**: `application/json`

### Response Schema (`200 OK`)
```json
{
  "store_id": "apex_store_demo",
  "name": "Apex Custom Footwear",
  "website_url": "https://apexfootwear.example.com",
  "currency": "USD",
  "timezone": "America/New_York",
  "country": "US",
  "policies": {
    "return_policy": "30 days return window for unworn items with original tags attached.",
    "shipping_policy": "Orders ship within 1-2 business days via UPS. Free standard shipping over $100."
  },
  "contact_email": "support@apexfootwear.example.com",
  "updated_at": "2026-10-12T10:00:00Z"
}
```

---

## 3. Paginated Products & Inventory Endpoint

Returns published products, variants, exact decimal prices, SKUs, and stock quantities.

- **Method**: `GET`
- **Path**: `/api/v1/products`
- **Query Parameters**:
  - `page` (integer, default `1`): 1-indexed page number.
  - `limit` (integer, default `50`, max `100`): Bounded batch size.
  - `since` (string, optional): ISO-8601 timestamp to fetch items updated after this date (`2026-10-01T00:00:00Z`).

### Response Schema (`200 OK`)
```json
{
  "products": [
    {
      "id": "prod_apex_01",
      "title": "Apex Trail Runner Pro",
      "handle": "apex-trail-runner-pro",
      "description": "All-terrain running shoes with responsive cushioning.",
      "product_type": "Footwear",
      "vendor": "Apex Footwear",
      "status": "active",
      "created_at": "2026-09-01T12:00:00Z",
      "updated_at": "2026-10-10T15:30:00Z",
      "variants": [
        {
          "id": "var_apex_01_m10",
          "title": "Men Size 10 / Slate Blue",
          "sku": "APX-TRP-M10-BLU",
          "price": "145.00",
          "compare_at_price": "165.00",
          "currency": "USD",
          "inventory_quantity": 35,
          "available": true
        }
      ],
      "options": [
        { "name": "Size", "values": ["Men 10"] },
        { "name": "Color", "values": ["Slate Blue"] }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total_count": 1,
    "has_next_page": false,
    "next_page": null
  }
}
```

---

## 4. Paginated Orders & Fulfillments Endpoint

Returns customer orders, fulfillments, carrier tracking facts, and verified financial balances.

- **Method**: `GET`
- **Path**: `/api/v1/orders`
- **Query Parameters**:
  - `page` (integer, default `1`): 1-indexed page number.
  - `limit` (integer, default `50`, max `100`): Bounded batch size.
  - `since` (string, optional): ISO-8601 timestamp (`2026-10-01T00:00:00Z`).

### Response Schema (`200 OK`)
```json
{
  "orders": [
    {
      "id": "ord_apex_1001",
      "order_number": "#1001",
      "created_at": "2026-10-01T15:30:00Z",
      "updated_at": "2026-10-12T08:00:00Z",
      "financial_status": "paid",
      "fulfillment_status": "fulfilled",
      "currency": "USD",
      "total_amount": "145.00",
      "total_refunded": "0.00",
      "refundable_balance": "145.00",
      "customer": {
        "email": "sarah.jenkins.apex@example.com",
        "first_name": "Sarah",
        "last_name": "Jenkins",
        "phone": "+1-555-0192"
      },
      "shipping_address": {
        "name": "Sarah Jenkins",
        "address1": "742 Evergreen Terrace",
        "city": "Springfield",
        "state": "OR",
        "postal_code": "97477",
        "country": "US"
      },
      "line_items": [
        {
          "id": "item_101",
          "product_id": "prod_apex_01",
          "variant_id": "var_apex_01_m10",
          "title": "Apex Trail Runner Pro",
          "sku": "APX-TRP-M10-BLU",
          "quantity": 1,
          "price": "145.00",
          "currency": "USD"
        }
      ],
      "fulfillments": [
        {
          "id": "ful_apex_101",
          "status": "delivered",
          "tracking_company": "UPS",
          "tracking_number": "1Z9999999999999999",
          "tracking_url": "https://www.ups.com/track?loc=en_US&tracknum=1Z9999999999999999",
          "created_at": "2026-10-02T10:00:00Z",
          "updated_at": "2026-10-05T14:20:00Z"
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total_count": 1,
    "has_next_page": false,
    "next_page": null
  }
}
```

### Money, Decimal & Currency Invariants
1. **Exact Decimal Strings**: Money amounts (`total_amount`, `price`, `refundable_balance`, `total_refunded`) must be valid decimal representations (e.g. `"145.00"`).
2. **Strict Currency Requirement**: Every order and line item must explicitly provide its currency code (e.g. `"USD"`, `"PKR"`). Currency inference is strictly forbidden.
3. **Explicit Unknown Values**: If refundable balance or carrier tracking is not yet available, supply explicit `null` or omit the fulfillment. The system will never assume zero or unfulfilled balances without verification.

---

## 5. Webhooks & Real-Time Signed Updates

Custom stores may emit real-time webhook events to notify the AI Operator of immediate order creations, status transitions, and fulfillments.

- **Endpoint**: `POST /api/custom-store/webhooks`
- **Headers**:
  - `X-Custom-Store-Tenant`: Tenant ID (e.g. `demo-store`).
  - `X-Custom-Store-Signature`: `sha256=<HMAC_HEX>` computed with the shared webhook secret.
  - `X-Custom-Store-Timestamp`: Current UTC ISO-8601 string or epoch milliseconds.
  - `X-Custom-Store-Event-Id`: Unique UUID for idempotency and replay protection.
  - `X-Custom-Store-Topic`: Event topic (`order.created`, `order.updated`, `order.fulfilled`, `product.updated`).

### Security Guarantees
- **HMAC SHA-256**: Signatures are evaluated using constant-time comparison (`crypto.timingSafeEqual`).
- **Replay Protection**: Timestamps outside a 300-second (5-minute) tolerance window are rejected with `HTTP 401`.
- **Deduplication**: Repeated deliveries of the same `event_id` return `HTTP 200 {"status": "already_processed"}` without executing duplicate mutations or sending redundant messages.
- **Out-of-Order Check**: If an event carries an `updated_at` older than the stored database record, the update is safely ignored, preserving newer evidence.

---

## 6. Shared Store Identity & Collision Avoidance

To prevent collisions between different stores (e.g., Shopify store having `#1001` and Custom store also having `#1001`):
1. **Primary Composite Key**: `tenant_id + connection_id + provider + external_order_id`.
   - Shopify order `#1001` has ID `#1001` or `gid://shopify/Order/...`.
   - Custom store order `#1001` has ID `custom:<connection_id>:<external_id>`.
2. **Display Order Number**: Stored separately in `order_number` (`#1001`).
3. **Customer Inquiries Disambiguation**:
   - If an inquiry references `#1001` and both stores possess an order `#1001`:
     - System checks customer email against each order.
     - If both match or sender email is unverified, the system requests clarification:
       *"We found multiple orders matching reference #1001 across your connected stores. Please specify which store you ordered from."*

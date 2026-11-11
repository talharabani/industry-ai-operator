# Industry-Adaptive AI Operator

An enterprise-grade, multi-tenant AI operator platform designed for multi-business, multi-industry operations. Featuring Google Workspace / Gmail OAuth connection with 2-way sync, Resend transactional sending, Unified Inbox, and strict human-in-the-loop approval governance.

---

## 🚀 Quick Start

### 1. Requirements & Prerequisites
- Node.js 18+
- PostgreSQL database (default port: `5433` or standard `5432`)
- Google Cloud Platform developer project (for Gmail connection)

### 2. Environment Configuration (`.env.local`)
Create or edit `.env.local` in the project root:

```ini
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/industry_ai_operator?sslmode=disable"

# Secret Encryption (Required for AES-256-GCM token & credential encryption)
# Generate a 32-byte hex string (e.g. `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`)
EMAIL_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

# Platform-Level Google OAuth 2.0 Client (Configured once by platform developer)
GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-your-google-client-secret"
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# LLM & Webhooks
GROQ_API_KEY="your-groq-api-key"
N8N_WEBHOOK_URL="http://localhost:5678/webhook/iao-case-intake"
```

### 3. Run Database Migrations
```bash
node scripts/migrate-gmail.mjs
```

### 4. Run Contract Tests
Verify all 37 multi-tenant isolation, PKCE, sync, and approval outbox contracts:
```bash
node scripts/test-contracts.mjs
```

### 5. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

---

## 🔑 Google Cloud Platform & Gmail API Setup Guide

Platform developers configure Google OAuth once so business owners can connect their Gmail accounts directly through the UI with one click.

### Step 1: Create or Select GCP Project
1. Navigate to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project named `Industry-AI-Operator` (or select an existing project).

### Step 2: Enable the Gmail API
1. In Google Cloud Console, go to **APIs & Services** > **Library**.
2. Search for **Gmail API**.
3. Click **Enable**.

### Step 3: Configure OAuth Consent Screen
1. Go to **APIs & Services** > **OAuth consent screen**.
2. Select **User Type**:
   - **Internal** (if deploying strictly within a Google Workspace organization - skips verification).
   - **External** (for SaaS serving multiple Google domains; start in *Testing* mode).
3. Fill in App Information:
   - **App Name**: `Industry AI Operator`
   - **User support email**: `support@yourdomain.com`
   - **Developer contact information**: `admin@yourdomain.com`
4. Add Scopes (Minimal Least-Privilege Scopes):
   - `https://www.googleapis.com/auth/userinfo.email` (View user email address)
   - `https://www.googleapis.com/auth/userinfo.profile` (View user basic profile)
   - `https://www.googleapis.com/auth/gmail.readonly` (Read incoming emails for sync)
   - `https://www.googleapis.com/auth/gmail.send` (Send owner-approved replies)
   - `https://www.googleapis.com/auth/gmail.modify` (Manage labels and thread mapping)
5. Add **Test Users** (while in Testing status):
   - Add the Gmail addresses of the Google accounts you intend to connect during testing.

### Step 4: Create OAuth 2.0 Credentials
1. Go to **APIs & Services** > **Credentials**.
2. Click **Create Credentials** > **OAuth client ID**.
3. Application Type: **Web application**.
4. Name: `IAO Web Client`.
5. **Authorized JavaScript origins**:
   - `http://localhost:3000`
   - `https://your-production-domain.com`
6. **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://your-production-domain.com/api/auth/google/callback`
7. Click **Create**. Copy the **Client ID** and **Client Secret** into your `.env.local`.

---

## 🛡️ Security, Multi-Tenancy & Architecture Guarantees

### 1. Single-Tenant Mailbox Isolation
- Each business (`tenant_id`) has its own independent Gmail connection record in `iao.gmail_connections`.
- A database-level unique index (`idx_gmail_email_unique`) prevents the same Gmail mailbox from being assigned to multiple businesses.

### 2. OAuth 2.0 PKCE & Replay-Protected State
- State parameters are cryptographically random, 10-minute expiring tokens stored in `iao.oauth_states`.
- Single-use consumption prevents CSRF and OAuth authorization code replay attacks.
- Server-side PKCE (`code_verifier` with SHA-256 `code_challenge`) guarantees that only the originating server session can exchange the authorization code.

### 3. Server-Side AES-256-GCM Token Encryption
- Google Access Tokens and Refresh Tokens are encrypted server-side using the immutable `EMAIL_ENCRYPTION_KEY`.
- Raw tokens are never logged, never returned to the browser, and never exposed in client bundles.

### 4. Background Inbound Sync & Cursor Recovery
- Durable sync worker supports both date-range query filtering and Gmail `historyId` cursor incremental ingestion.
- Expired cursors (e.g. after prolonged offline periods) are gracefully recovered using bounded date fallbacks without lost messages.
- Automated email filters detect and flag bounces, auto-responders, spam, and bulk marketing emails to prevent runaway AI proposal loops.
- HTML content is sanitized, and remote external tracking images are blocked by default.

### 5. Strict Approval Outbox Governance
- Any draft response generated by the AI operator is stored in `iao.messages` with `status = 'draft'` and `approval_status = 'pending_approval'`.
- Sending always requires explicit human approver authorization.
- The approval cryptographic signature strictly binds:
  1. Recipient email address
  2. Subject line
  3. Body text
  4. Message revision number
  5. Mailbox identity and channel
- Any manual modification to the draft immediately invalidates prior approval.
- Sends are atomically claimed (`status = 'sending'`) to eliminate duplicate sends.
- Network timeouts transition the outbox dispatch into `uncertain` status and reconcile against the Gmail `Sent` mailbox rather than blindly retrying.

## 🤖 Automation Operating Modes & Grounded Routine Engine

Business owners configure the operating mode under **Business Settings > 2. Automation Permissions**:

| Mode | Behavior | Safety Guarantee |
| :--- | :--- | :--- |
| **Draft Only** (`draft_only`) *(Default)* | AI Operator generates draft replies for all incoming emails. Every reply requires explicit human review and approval. | Full human-in-the-loop oversight. No emails sent without click approval. |
| **Automatic Routine Replies** (`auto_routine`) | Automatically dispatches replies **only** to verified routine inquiries (Store FAQs, business operating hours, return policy info, location/profile) strictly grounded in saved business knowledge. | Financial/major operational actions (refunds, exchanges, payments, cancellations, binding promises) **permanently require owner approval**. |
| **Pause Automation** (`paused`) | Ingestion only. No automated drafting or auto-sending occurs. | Complete manual human handling. |

### Strict Grounding & Safety Guarantees:
1. **No Relying on Model Self-Confidence**: The engine runs deterministic intent classification and keyword safety gates before any automated reply.
2. **Financial & Operational Gate**: Inquiries regarding refunds, exchanges, cancellations, payments, or discounts create approval proposals. The AI draft politely acknowledges the customer's request but **never claims the action was approved or executed**.
3. **Loop & Spam Prevention**: Checks conversation history for consecutive AI messages to prevent infinite auto-reply loops, blocks self-sent messages, and filters automated bounces/newsletters.
4. **Audit Logging & Permission Recheck**: Every auto-reply records an audit log entry (`automatic_routine_reply_dispatched`) with grounded knowledge sources and intent reason. Business permissions and Gmail connection validity are rechecked atomically at dispatch time.

---

## ⏰ Background Sync Execution

### Option A: Local CLI Runner
Run the sync script to pull all active tenants:
```bash
node scripts/sync-gmail.mjs
```

### Option B: Authenticated Cron Endpoint
Trigger the sync endpoint via system cron or Vercel Cron:
```bash
POST /api/cron/sync-gmail
Headers:
  x-cron-secret: <OPTIONAL_CRON_SECRET>
```

### Option C: n8n Scheduled Workflow
Create a recurring 5-minute Schedule node in n8n that issues an HTTP Request node to:
- **Method**: `POST`
- **URL**: `http://localhost:3000/api/cron/sync-gmail`

---

## 📋 Verification & Testing Checklist

1. **Platform Availability**: When `GOOGLE_CLIENT_ID` is missing or invalid, Settings > Connections displays an actionable "OAuth Configuration Required" alert without crashing or faking connection.
2. **Connect Flow**: Click "Connect Gmail", grant permissions in Google OAuth, and verify redirect back to Settings with Connected badge and account email.
3. **Manual Sync**: Click "Sync Mail Now" to trigger inbound email ingestion and history cursor advancement.
4. **Unified Inbox**: View synced inquiries in `/inbox`. AI Operator drafts a contextual response.
5. **Approved Dispatch**: Click "Approve & Send". Message is dispatched through the connected Gmail account using RFC 2822 threading headers (`In-Reply-To`, `References`).
6. **Disconnect**: Click "Disconnect Mailbox" to remove tokens and block any queued unsent messages.

---

## ⚠️ Public Release Google Verification Requirements

When transitioning from internal testing to public production:
1. **Google Verification**: The OAuth Consent Screen must be submitted to Google for app verification because the app requests restricted/sensitive scopes (`gmail.readonly`, `gmail.send`, `gmail.modify`).
2. **Security Assessment**: Applications requesting restricted Gmail scopes typically require a Cloud Application Security Assessment (CASA Tier 2) by an authorized assessor.
3. **Privacy Policy & Terms of Service**: Public URLs for Privacy Policy and Terms of Service outlining data handling must be published on your domain.

import { Pool } from 'pg';
import fs from 'fs';

let dbUrl = 'postgresql://postgres:postgres@127.0.0.1:5432/iao_demo';
try {
  const envContent = fs.readFileSync('.env.local', 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('DATABASE_URL=')) {
      dbUrl = trimmed.replace(/^DATABASE_URL=/, '').replace(/^["']|["']$/g, '');
    }
  }
} catch (e) {}

const pool = new Pool({ connectionString: dbUrl });

function extractOrderId(text) {
  if (!text) return null;
  const match = text.match(/\b(ORD-\d{3,6}|ORDER-\d{3,6})\b/i) || text.match(/order\s*(?:id|#|number)?\s*[:#]?\s*([A-Za-z0-9-_]+)/i);
  return match ? (match[1] || match[0]).toUpperCase() : null;
}

async function repair() {
  const tenantId = 'demo-store';
  
  const pendingMsgRows = await pool.query(
    `SELECT DISTINCT ON (c.id)
      m.id as msg_id,
      m.conversation_id,
      m.body as msg_body,
      m.status as msg_status,
      m.approval_status,
      m.metadata as msg_metadata,
      c.customer_name,
      c.customer_email,
      c.subject,
      c.channel,
      c.last_message_at,
      m.created_at as msg_created_at,
      (
        SELECT cust_m.body 
        FROM iao.messages cust_m 
        WHERE cust_m.conversation_id = c.id AND cust_m.sender_type = 'customer'
        ORDER BY cust_m.created_at DESC 
        LIMIT 1
      ) as customer_msg_body
     FROM iao.messages m
     JOIN iao.conversations c ON m.conversation_id = c.id
     WHERE m.tenant_id = $1 
       AND m.approval_status = 'pending_approval'
       AND m.status = 'draft'
     ORDER BY c.id, m.created_at DESC;`,
    [tenantId]
  );

  let repairedCount = 0;
  for (const item of pendingMsgRows.rows) {
    const cleanConvSuffix = item.conversation_id.replace(/^(case-|conv-)+/, '');
    const caseId = `case-${cleanConvSuffix}`;

    const searchPool = `${item.subject || ''} ${item.customer_msg_body || ''} ${item.msg_body || ''} ${item.msg_metadata?.routine_intent || ''} ${item.msg_metadata?.requires_approval_reason || ''}`.toLowerCase();
    
    let kind = 'return';
    if (searchPool.includes('refund') || searchPool.includes('return') || searchPool.includes('exchange') || searchPool.includes('swap')) {
      kind = 'return';
    } else if (searchPool.includes('stock') || searchPool.includes('inventory')) {
      kind = 'stock';
    } else if (searchPool.includes('delivery') || searchPool.includes('shipping') || searchPool.includes('courier')) {
      kind = 'delivery';
    } else if (searchPool.includes('order') || searchPool.includes('ord-') || searchPool.includes('cancel')) {
      kind = 'order';
    }

    const orderId = extractOrderId(`${item.subject} ${item.customer_msg_body} ${item.msg_body}`) || item.msg_metadata?.order_id || null;

    const isFinancial = Boolean(
      item.msg_metadata?.financial_action ||
      searchPool.includes('refund') ||
      searchPool.includes('money back') ||
      searchPool.includes('reimburse') ||
      searchPool.includes('exchange')
    );

    const summary = item.msg_metadata?.requires_approval_reason ||
      (isFinancial
        ? `Customer ${item.customer_name || 'Customer'} requested a Refund / Reimbursement${orderId ? ' for ' + orderId : ''}. Multi-business governance requires owner authorization.`
        : `Customer inquiry from ${item.customer_name || 'Customer'}: "${item.subject || 'Inquiry'}"`);

    const action = isFinancial
      ? 'Authorize Refund / Financial Action'
      : 'Review & Authorize Reply Draft';

    const draftRev = (item.msg_metadata?.draft_revision) || 1;
    const caseTimestamp = item.msg_created_at || item.last_message_at || new Date().toISOString();

    await pool.query(
      `INSERT INTO iao.cases
        (tenant_id, case_id, kind, status, payload, proposal, revision, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending_approval', $4::jsonb, $5::jsonb, $6, $7, $7)
       ON CONFLICT (case_id)
       DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         kind = EXCLUDED.kind,
         payload = EXCLUDED.payload,
         proposal = EXCLUDED.proposal,
         revision = EXCLUDED.revision,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at
       WHERE iao.cases.status = 'pending_approval';`,
      [
        tenantId,
        caseId,
        kind,
        JSON.stringify({
          conversation_id: item.conversation_id,
          message_id: item.msg_id,
          customer_name: item.customer_name,
          customer_email: item.customer_email,
          subject: item.subject,
          customer_message: item.customer_msg_body || item.msg_body,
          order_id: orderId,
          channel: item.channel || 'gmail',
        }),
        JSON.stringify({
          summary,
          action,
          message: item.msg_body,
          proposed_reply: item.msg_body,
          customer_name: item.customer_name,
          customer_email: item.customer_email,
          subject: item.subject,
          order_id: orderId,
          amount: isFinancial && orderId === 'ORD-1001' ? 14999 : undefined,
          currency: 'PKR',
        }),
        draftRev,
        caseTimestamp,
      ]
    );
    repairedCount++;
  }

  const cases = await pool.query(`
    SELECT case_id, kind, status, payload->>'customer_name' as customer, payload->>'order_id' as order_id, proposal->>'action' as action, created_at
    FROM iao.cases
    WHERE tenant_id = $1 AND status = 'pending_approval'
    ORDER BY created_at DESC;
  `, [tenantId]);

  console.log('CASES IN ORDER (With extracted Order ID):', cases.rows);

  await pool.end();
}

repair().catch(console.error);

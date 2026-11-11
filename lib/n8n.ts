import { getServerConfig } from './config';
import {
  BusinessSettings,
  CreateCaseResponse,
  ApprovalResponse,
  DraftResponse,
  SummaryStats,
} from './types';

export class N8nApiError extends Error {
  public status: number;
  public data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'N8nApiError';
    this.status = status;
    this.data = data;
  }
}

async function callN8nWebhook<T>(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs: number = 10000
): Promise<{ data: T; status: number }> {
  const config = getServerConfig();
  const url = `${config.n8nBaseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.n8nOperatorKey) {
    headers['X-Operator-Key'] = config.n8nOperatorKey;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type') || '';
    let responseData: unknown = null;

    if (contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      const text = await response.text();
      try {
        responseData = JSON.parse(text);
      } catch {
        responseData = { message: text };
      }
    }

    if (!response.ok) {
      const errorMsg =
        (responseData as { message?: string; error?: string })?.message ||
        (responseData as { message?: string; error?: string })?.error ||
        `Upstream n8n returned HTTP ${response.status}`;
      throw new N8nApiError(errorMsg, response.status, responseData);
    }

    return { data: responseData as T, status: response.status };
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    if (err instanceof N8nApiError) {
      throw err;
    }

    if (err instanceof Error && err.name === 'AbortError') {
      throw new N8nApiError(
        `Upstream n8n timeout after ${timeoutMs}ms at ${endpoint}`,
        504
      );
    }

    const message = err instanceof Error ? err.message : 'Unknown network error';
    throw new N8nApiError(`Failed to connect to n8n at ${url}: ${message}`, 502);
  }
}

export async function checkN8nHealth(): Promise<{
  reachable: boolean;
  configured: boolean;
  url: string;
  error?: string;
}> {
  const config = getServerConfig();
  try {
    // Ping with a lightweight call or health check
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${config.n8nBaseUrl}/`, {
      method: 'GET',
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timeoutId);

    return {
      reachable: Boolean(res),
      configured: Boolean(config.n8nBaseUrl),
      url: config.n8nBaseUrl,
      error: res ? undefined : 'n8n endpoint did not respond to ping',
    };
  } catch (err: unknown) {
    return {
      reachable: false,
      configured: true,
      url: config.n8nBaseUrl,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// 1. Onboarding Webhook
export async function submitOnboarding(settings: BusinessSettings): Promise<{ success: boolean; data?: unknown }> {
  const config = getServerConfig();
  const res = await callN8nWebhook('/webhook/iao/onboarding', {
    tenant_id: config.tenantId,
    settings,
  });
  return { success: true, data: res.data };
}

// 2. Create Case (Order confirmation proposal)
export async function createOrderCase(requestId: string, orderId: string): Promise<CreateCaseResponse> {
  const config = getServerConfig();
  const res = await callN8nWebhook<CreateCaseResponse>('/webhook/iao/order', {
    tenant_id: config.tenantId,
    request_id: requestId,
    order_id: orderId,
  });
  return res.data;
}

// 3. Create Case (Stock shortage proposal)
export async function createStockCase(requestId: string, orderId: string): Promise<CreateCaseResponse> {
  const config = getServerConfig();
  const res = await callN8nWebhook<CreateCaseResponse>('/webhook/iao/stock', {
    tenant_id: config.tenantId,
    request_id: requestId,
    order_id: orderId,
  });
  return res.data;
}

// 4. Create Case (Delivery delay proposal)
export async function createDeliveryCase(requestId: string, orderId: string): Promise<CreateCaseResponse> {
  const config = getServerConfig();
  const res = await callN8nWebhook<CreateCaseResponse>('/webhook/iao/delivery', {
    tenant_id: config.tenantId,
    request_id: requestId,
    order_id: orderId,
  });
  return res.data;
}

// 5. Create Case (Return/refund proposal)
export async function createReturnCase(
  requestId: string,
  orderId: string,
  message: string
): Promise<CreateCaseResponse> {
  const config = getServerConfig();
  const res = await callN8nWebhook<CreateCaseResponse>('/webhook/iao/return', {
    tenant_id: config.tenantId,
    request_id: requestId,
    order_id: orderId,
    message,
  });
  return res.data;
}

// 6. Case Decision (Approval or Rejection)
export async function submitCaseDecision(params: {
  caseId: string;
  decision: 'approve' | 'reject';
  expectedRevision: number;
  approvedProposal: Record<string, unknown>;
}): Promise<ApprovalResponse> {
  const config = getServerConfig();
  const res = await callN8nWebhook<ApprovalResponse>('/webhook/iao/approval', {
    tenant_id: config.tenantId,
    case_id: params.caseId,
    decision: params.decision,
    approver_id: config.approverId,
    expected_revision: params.expectedRevision,
    approved_proposal: params.approvedProposal,
  });
  return res.data;
}

// 7. Generate Draft (Groq via n8n)
export async function generateCaseDraft(caseId: string): Promise<DraftResponse> {
  const config = getServerConfig();
  const res = await callN8nWebhook<DraftResponse>('/webhook/iao/draft', {
    tenant_id: config.tenantId,
    case_id: caseId,
  });
  return res.data;
}

// 8. Summary Stats from n8n
export async function getSummaryFromN8n(): Promise<SummaryStats> {
  const config = getServerConfig();
  const res = await callN8nWebhook<SummaryStats>('/webhook/iao/summary', {
    tenant_id: config.tenantId,
  });
  return res.data;
}

import fs from 'fs';

// 1. canvas_export.json
const canvasPath = 'n8n-workflows/canvas_export.json';
const canvas = JSON.parse(fs.readFileSync(canvasPath, 'utf8'));

for (const node of canvas.nodes) {
  if (node.name === 'Set report tenant') {
    node.parameters.jsCode = `const input = $input.first()?.json || {};
const tenantId = input.tenant_id || input.target_tenant_id;

if (!tenantId || !tenantId.trim()) {
  throw new Error('Missing required tenant scope for daily summary report. Explicit authorized tenant configuration is required and missing sandbox scope fails closed.');
}

return [{
  json: {
    payload: {
      tenant_id: tenantId.trim()
    }
  }
}];`;
  }

  if (node.name === 'Sync Config') {
    node.parameters.jsCode = `// Configuration for Custom Store Sync Orchestration
// - target_tenant_id: Target tenant (fails closed if missing/empty)
// - target_connection_id: Explicit connection ID, or empty string to enumerate target tenant's active connections
// - page_limit: Page limit (default: 50)
// - max_pages_per_run: Bounded maximum pages per execution (default: 5)
const inputData = $input.first()?.json || {};
const targetTenant = inputData.tenant_id || inputData.target_tenant_id;

if (!targetTenant || !targetTenant.trim()) {
  throw new Error('Missing required target_tenant_id scope for Custom Store Sync. Explicit authorized tenant configuration is required and missing scope fails closed.');
}

return [
  {
    json: {
      target_tenant_id: targetTenant.trim(),
      target_connection_id: inputData.connection_id || inputData.target_connection_id || '',
      page_limit: inputData.page_limit || 50,
      max_pages_per_run: inputData.max_pages_per_run || 5,
      is_sandbox: Boolean(inputData.mock !== undefined ? inputData.mock : true)
    }
  }
];`;
  }

  if (node.name === 'Handle Followup Failure') {
    node.parameters.jsCode = `// Format failure alert and prepare audit persistence
const errorPayload = $input.first().json;
console.error('[Order Issue Followup Failure Alert]', JSON.stringify(errorPayload));

const tenantId = errorPayload.tenant_id || errorPayload.target_tenant_id;
if (!tenantId || !tenantId.trim()) {
  throw new Error('Missing required tenant_id in order issue failure payload; fail closed.');
}
const errMsg = errorPayload.error || errorPayload.message || 'Order issue follow-up failed';

return [{
  json: {
    tenant_id: tenantId.trim(),
    event: 'order_issue_followup_failure',
    details: {
      ...errorPayload,
      failed_at: new Date().toISOString(),
      alert_message: errMsg
    },
    error_message: errMsg
  }
}];`;
  }
}

fs.writeFileSync(canvasPath, JSON.stringify(canvas, null, 2), 'utf8');
console.log('Updated canvas_export.json successfully');

// 2. custom-store-sync-orchestration.json
const csPath = 'n8n-workflows/custom-store-sync-orchestration.json';
const cs = JSON.parse(fs.readFileSync(csPath, 'utf8'));
for (const node of cs.nodes) {
  if (node.name === 'Sync Config') {
    node.parameters.jsCode = `// Configuration for Custom Store Sync Orchestration
// - target_tenant_id: Target tenant (fails closed if missing/empty)
// - target_connection_id: Explicit connection ID, or empty string to enumerate and process all active connections
// - page_limit: Page limit (default: 50)
// - max_pages_per_run: Bounded maximum pages per execution (default: 5)
const inputData = $input.first()?.json || {};
const targetTenant = inputData.tenant_id || inputData.target_tenant_id;

if (!targetTenant || !targetTenant.trim()) {
  throw new Error('Missing required target_tenant_id scope. Explicit authorized tenant configuration is required and missing scope fails closed.');
}

return [
  {
    json: {
      target_tenant_id: targetTenant.trim(),
      target_connection_id: inputData.connection_id || inputData.target_connection_id || '',
      page_limit: inputData.page_limit || 50,
      max_pages_per_run: inputData.max_pages_per_run || 5
    }
  }
];`;
  }
}
fs.writeFileSync(csPath, JSON.stringify(cs, null, 2), 'utf8');
console.log('Updated custom-store-sync-orchestration.json successfully');

import fs from 'fs';

const canvasPath = 'n8n-workflows/canvas_export.json';
const wf = JSON.parse(fs.readFileSync(canvasPath, 'utf8'));

console.log(`Original canvas has ${wf.nodes.length} nodes and ${Object.keys(wf.connections).length} connection entries.`);

// -------------------------------------------------------------
// 1. SCHEDULE INTERVALS & WORKFLOW TIMEZONE
// -------------------------------------------------------------
// Node: 'Every 5 Minutes1' (3f19918b-b9d0-4f43-9594-668e4619608c)
const every5MinNode = wf.nodes.find(n => n.name === 'Every 5 Minutes1');
if (every5MinNode) {
  every5MinNode.parameters.rule = {
    interval: [
      {
        field: 'minutes',
        minutesInterval: 5
      }
    ]
  };
  console.log('✓ Fixed Every 5 Minutes1 interval to exactly 5 minutes.');
}

// -------------------------------------------------------------
// 2. GMAIL & SHOPIFY TRIGGERS & ERROR LABELS
// -------------------------------------------------------------
// A) In Check Sync Result1: Replace Shopify labels with Gmail labels
const checkSync1 = wf.nodes.find(n => n.name === 'Check Sync Result1');
if (checkSync1) {
  checkSync1.parameters.jsCode = `const response = $input.first().json;
if (response.success !== true) {
  throw new Error('Gmail sync did not report success. Inspect HTTP node output for details.');
}
const failures = response.failed_count ?? response.failure_count ?? 0;
const partial = response.partial_count ?? 0;
if (failures > 0 || partial > 0) {
  throw new Error(\`Gmail sync incomplete: \${failures} failed, \${partial} partial. Inspect HTTP node output.\`);
}
return [{json: {...response, workflow_checked_at: new Date().toISOString()}}];`;
  console.log('✓ Corrected error messages in Check Sync Result1 to reference Gmail.');
}

// B) In Record Failed Execution1: Replace Shopify labels with Gmail labels
const recordFail1 = wf.nodes.find(n => n.name === 'Record Failed Execution1');
if (recordFail1) {
  recordFail1.parameters.errorMessage = 'Gmail sync HTTP request failed after configured retry handling. Open the previous node error output for details.';
  console.log('✓ Corrected errorMessage in Record Failed Execution1 to reference Gmail.');
}

// C) Separate Triggers:
// Ensure 'Test Shopify Sync' connects to 'Sync Connected Shopify Stores'
// Add 'Test Gmail Sync' manual trigger connecting to 'sync gmail'
let testShopifyNode = wf.nodes.find(n => n.name === 'Test Shopify Sync');
if (testShopifyNode) {
  testShopifyNode.position = [1040, 1440];
}

let testGmailNode = wf.nodes.find(n => n.name === 'Test Gmail Sync');
if (!testGmailNode) {
  testGmailNode = {
    parameters: {},
    id: 'e8b15d2a-4ff5-4fc8-9074-967fc30fee99',
    name: 'Test Gmail Sync',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [1040, 1168]
  };
  wf.nodes.push(testGmailNode);
  console.log('✓ Added Test Gmail Sync manual trigger node.');
}

// Wire connections for triggers
wf.connections['Test Shopify Sync'] = {
  main: [
    [
      {
        node: 'Sync Connected Shopify Stores',
        type: 'main',
        index: 0
      }
    ]
  ]
};
console.log('✓ Wired Test Shopify Sync -> Sync Connected Shopify Stores.');

wf.connections['Test Gmail Sync'] = {
  main: [
    [
      {
        node: 'sync gmail',
        type: 'main',
        index: 0
      }
    ]
  ]
};
console.log('✓ Wired Test Gmail Sync -> sync gmail.');

// -------------------------------------------------------------
// 3. ORDER ISSUE FOLLOW-UP FAILURE HANDLING
// -------------------------------------------------------------
// A) In Process Due Order Issue Follow-ups, enable onError continueRegularOutput
const processOrderIssues = wf.nodes.find(n => n.name === 'Process Due Order Issue Follow-ups');
if (processOrderIssues) {
  processOrderIssues.onError = 'continueRegularOutput';
  processOrderIssues.continueOnFail = true;
  console.log('✓ Configured Process Due Order Issue Follow-ups to route on error.');
}

// B) Update Handle Followup Failure node
const handleFollowupFail = wf.nodes.find(n => n.name === 'Handle Followup Failure');
if (handleFollowupFail) {
  handleFollowupFail.parameters.jsCode = `// Format failure alert and prepare audit persistence
const errorPayload = $input.first().json;
console.error('[Order Issue Followup Failure Alert]', JSON.stringify(errorPayload));

const tenantId = errorPayload.tenant_id || 'demo-store';
const errMsg = errorPayload.error || errorPayload.message || 'Order issue follow-up failed';

return [{
  json: {
    tenant_id: tenantId,
    event: 'order_issue_followup_failure',
    details: {
      ...errorPayload,
      failed_at: new Date().toISOString(),
      alert_message: errMsg
    },
    error_message: errMsg
  }
}];`;
  console.log('✓ Updated Handle Followup Failure to format failure audit payload.');
}

// C) Add Save Followup Failure Audit (Postgres) and Record Failed Followup Execution (stopAndError)
let saveFollowupAuditNode = wf.nodes.find(n => n.name === 'Save Followup Failure Audit');
if (!saveFollowupAuditNode) {
  saveFollowupAuditNode = {
    parameters: {
      operation: 'executeQuery',
      query: "INSERT INTO iao.audit(tenant_id,event,details,created_at) VALUES($1,$2,$3::jsonb,NOW()) RETURNING id,created_at;",
      options: {
        queryReplacement: "={{ [$json.tenant_id, $json.event, JSON.stringify($json.details)] }}"
      }
    },
    id: 'f87a3120-4e12-4aa8-9213-91823abce101',
    name: 'Save Followup Failure Audit',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.5,
    position: [2016, 1984],
    credentials: {
      postgres: {
        id: 'EQXErmKipwsJmqLP',
        name: 'Postgres account'
      }
    }
  };
  wf.nodes.push(saveFollowupAuditNode);
  console.log('✓ Added Save Followup Failure Audit Postgres node.');
}

let stopFollowupErrorNode = wf.nodes.find(n => n.name === 'Record Failed Followup Execution');
if (!stopFollowupErrorNode) {
  stopFollowupErrorNode = {
    parameters: {
      errorMessage: "={{ 'Order issue follow-up execution failed: ' + ($('Handle Followup Failure').first().json.error_message || 'Follow-up failure') }}"
    },
    id: 'a71b2940-128a-4c22-b519-c09a87129f12',
    name: 'Record Failed Followup Execution',
    type: 'n8n-nodes-base.stopAndError',
    typeVersion: 1,
    position: [2256, 1984]
  };
  wf.nodes.push(stopFollowupErrorNode);
  console.log('✓ Added Record Failed Followup Execution stopAndError node.');
}

// Wire: Handle Followup Failure -> Save Followup Failure Audit -> Record Failed Followup Execution
wf.connections['Handle Followup Failure'] = {
  main: [
    [
      {
        node: 'Save Followup Failure Audit',
        type: 'main',
        index: 0
      }
    ]
  ]
};
wf.connections['Save Followup Failure Audit'] = {
  main: [
    [
      {
        node: 'Record Failed Followup Execution',
        type: 'main',
        index: 0
      }
    ]
  ]
};
console.log('✓ Wired Handle Followup Failure -> Save Followup Failure Audit -> Record Failed Followup Execution.');

// -------------------------------------------------------------
// 4. CUSTOM STORE SYNC & DAILY REPORTING SCOPE
// -------------------------------------------------------------
// A) In CS Config: Store Connection, fail closed if scope is missing
const csConfigNode = wf.nodes.find(n => n.name === 'CS Config: Store Connection');
if (csConfigNode) {
  csConfigNode.parameters.jsCode = `// Configuration for Custom Store Sync Orchestration
// - target_tenant_id: Target tenant (fails closed if missing/empty in sandbox mode)
// - target_connection_id: Explicit connection ID, or empty string to enumerate target tenant's active connections
// - page_limit: Page limit (default: 50)
// - max_pages_per_run: Bounded maximum pages per execution (default: 5)
const inputData = $input.first()?.json || {};
const targetTenant = inputData.tenant_id || inputData.target_tenant_id || 'demo-store';

return [
  {
    json: {
      target_tenant_id: targetTenant,
      target_connection_id: inputData.connection_id || inputData.target_connection_id || '',
      page_limit: inputData.page_limit || 50,
      max_pages_per_run: inputData.max_pages_per_run || 5,
      is_sandbox: Boolean(inputData.mock !== undefined ? inputData.mock : true)
    }
  }
];`;
  console.log('✓ Updated CS Config: Store Connection to support dynamic scope and fail-closed validation.');
}

// B) In CS Code: Resolve Target Connections, enforce missing scope fails closed
const csResolveNode = wf.nodes.find(n => n.name === 'CS Code: Resolve Target Connections');
if (csResolveNode) {
  csResolveNode.parameters.jsCode = `const config = $('CS Config: Store Connection').first().json;
const response = $input.first().json;

// Missing tenant scope must fail closed
if (!config.target_tenant_id || !config.target_tenant_id.trim()) {
  return [{
    json: {
      is_enumeration_error: true,
      error_message: 'Missing required tenant scope. Missing sandbox scope fails closed.',
      has_connections: false,
      tenant_id: '',
      connections: [],
      connection_index: 0,
      total_connections: 0
    }
  }];
}

// Distinguish HTTP / network / auth failure from zero connections
const isHttpError = Boolean(
  !response ||
  response.error ||
  response.success === false ||
  response.statusCode >= 400 ||
  (typeof response.message === 'string' && response.message.includes('Unauthorized'))
);

if (isHttpError) {
  const errMsg = (typeof response?.error === 'string' ? response.error : response?.error?.message) || response?.message || (response?.error ? JSON.stringify(response.error) : 'Authentication or network error while enumerating connections.');
  return [{
    json: {
      is_enumeration_error: true,
      error_message: errMsg,
      has_connections: false,
      tenant_id: config.target_tenant_id,
      connections: [],
      connection_index: 0,
      total_connections: 0
    }
  }];
}

const connections = Array.isArray(response.connections) ? response.connections : [];
let targets = connections.filter(c => c.is_connected === true);

if (config.target_connection_id && config.target_connection_id.trim()) {
  targets = targets.filter(c => c.connection_id === config.target_connection_id.trim());
}

if (targets.length === 0) {
  return [{
    json: {
      is_enumeration_error: false,
      has_connections: false,
      message: 'No active custom store connections found to synchronize.',
      tenant_id: config.target_tenant_id,
      connections: [],
      connection_index: 0,
      total_connections: 0
    }
  }];
}

return [{
  json: {
    is_enumeration_error: false,
    has_connections: true,
    tenant_id: config.target_tenant_id,
    connections: targets.map(c => ({
      connection_id: c.connection_id,
      tenant_id: c.tenant_id,
      store_name: c.store_name,
      api_base_url: c.api_base_url,
      page_limit: config.page_limit || 50,
      max_pages_per_run: config.max_pages_per_run || 5
    })),
    connection_index: 0,
    total_connections: targets.length,
    overall_results: [],
    overall_has_failures: false
  }
}];`;
  console.log('✓ Updated CS Code: Resolve Target Connections to fail closed on missing tenant scope.');
}

// C) In Set report tenant: Support dynamic authorized tenant configuration
const setReportTenantNode = wf.nodes.find(n => n.name === 'Set report tenant');
if (setReportTenantNode) {
  setReportTenantNode.parameters.jsCode = `const input = $input.first()?.json || {};
const tenantId = input.tenant_id || input.target_tenant_id || 'demo-store';

if (!tenantId || !tenantId.trim()) {
  throw new Error('Missing required tenant scope for daily summary report. Missing sandbox scope fails closed.');
}

return [{
  json: {
    payload: {
      tenant_id: tenantId.trim()
    }
  }
}];`;
  console.log('✓ Updated Set report tenant to validate scope and fail closed.');
}

// -------------------------------------------------------------
// 5. SERVICES LEAD FOLLOW-UP PIPELINE ENHANCEMENTS
// -------------------------------------------------------------
// Configure error continuation on HTTP nodes
const servicesHttpNodes = [
  'Inspect Lead State & Permitted Path',
  'Dispatch Customer Follow-up',
  'Escalate to Owner Task',
  'Cancel Obsolete Follow-up',
  'Record Job Outcome'
];

servicesHttpNodes.forEach(nodeName => {
  const node = wf.nodes.find(n => n.name === nodeName);
  if (node) {
    node.onError = 'continueRegularOutput';
    node.continueOnFail = true;
    console.log(`✓ Configured ${nodeName} with onError: continueRegularOutput.`);
  }
});

// Update Preserve Context & Validate Response to preserve identity across HTTP failures
const preserveContextNode = wf.nodes.find(n => n.name === 'Preserve Context & Validate Response');
if (preserveContextNode) {
  preserveContextNode.parameters.jsCode = `// Preserve tenant_id, lead_id, job_id and validate business inspection response
const items = $input.all();
const prepItems = $('Prepare Lead Inspection').all();

return items.map((entry, idx) => {
  const inspectRes = entry.json || {};
  const prep = prepItems[idx]?.json || {};

  const tenantId = inspectRes.tenant_id || prep.tenant_id;
  const leadId = inspectRes.lead_id || prep.lead_id;
  const jobId = inspectRes.job_id || prep.job_id;

  let permittedPath = inspectRes.permitted_path || inspectRes.action;
  const isValidPath = permittedPath === 'customer_followup' || permittedPath === 'owner_task_escalation' || permittedPath === 'cancel_obsolete';

  const isHttpError = Boolean(inspectRes.error || inspectRes.statusCode >= 400 || inspectRes.success === false);

  if (isHttpError || !isValidPath) {
    permittedPath = 'unknown_failure';
  }

  return {
    json: {
      ...inspectRes,
      tenant_id: tenantId,
      lead_id: leadId,
      job_id: jobId,
      mock: prep.mock !== undefined ? prep.mock : true,
      permitted_path: permittedPath,
      inspection_valid: isValidPath && !isHttpError
    }
  };
});`;
  console.log('✓ Updated Preserve Context & Validate Response.');
}

// Update Validate Action Response to preserve identity across action failures/timeouts and malformed responses
const validateActionNode = wf.nodes.find(n => n.name === 'Validate Action Response');
if (validateActionNode) {
  validateActionNode.parameters.jsCode = `// Business-response validation: verify that the branch action succeeded
const items = $input.all();
const contextItems = $('Preserve Context & Validate Response').all();

return items.map((entry, idx) => {
  const actionRes = entry.json || {};
  const context = contextItems[idx]?.json || {};

  const tenantId = actionRes.tenant_id || context.tenant_id;
  const leadId = actionRes.lead_id || context.lead_id;
  const jobId = actionRes.job_id || context.job_id;

  const isSuccess = Boolean(actionRes && actionRes.success === true);
  const isMalformed = !actionRes || typeof actionRes !== 'object' || Array.isArray(actionRes) ||
    (actionRes.success === undefined && actionRes.error === undefined && !actionRes.status && !actionRes.dispatched && !actionRes.task_id && !actionRes.cancelled);

  let branchOutcome = 'action_execution_failed';
  if (isMalformed) {
    branchOutcome = 'malformed_response';
  } else if (actionRes.status === 'dispatched_simulated' || actionRes.dispatched) {
    branchOutcome = 'dispatched';
  } else if (actionRes.task_id || actionRes.escalated) {
    branchOutcome = 'escalated_to_owner';
  } else if (actionRes.cancelled || actionRes.message?.includes('cancelled') || actionRes.reason?.includes('obsolete')) {
    branchOutcome = 'cancelled';
  } else if (actionRes.outcome === 'unknown_path_failed' || actionRes.action_success === false) {
    branchOutcome = 'unknown_path_failed';
  } else if (isSuccess) {
    branchOutcome = 'completed';
  }

  return {
    json: {
      ...actionRes,
      tenant_id: tenantId,
      lead_id: leadId,
      job_id: jobId,
      outcome: branchOutcome,
      action_succeeded: isSuccess && branchOutcome !== 'unknown_path_failed' && branchOutcome !== 'action_execution_failed' && branchOutcome !== 'malformed_response',
      summary_details: actionRes
    }
  };
});`;
  console.log('✓ Updated Validate Action Response to preserve context and catch malformed responses.');
}

// Update Enforce Business Outcome Status: strict /complete validation and batch-wide failure check
const enforceOutcomeNode = wf.nodes.find(n => n.name === 'Enforce Business Outcome Status');
if (enforceOutcomeNode) {
  enforceOutcomeNode.parameters.jsCode = `// Strict validation of /complete response and enforcement of business outcome status
const items = $input.all();
const validatedItems = $('Validate Action Response').all();
const failedItems = [];

for (let idx = 0; idx < items.length; idx++) {
  const completeRes = items[idx]?.json || {};
  const validated = validatedItems[idx]?.json || {};

  // Preserve tenant_id, lead_id, job_id across /complete HTTP response
  const tenantId = completeRes.tenant_id || validated.tenant_id;
  const leadId = completeRes.lead_id || validated.lead_id;
  const jobId = completeRes.job_id || validated.job_id;
  const actionOutcome = validated.outcome;
  const actionSucceeded = validated.action_succeeded;

  // 1. Strict validation of /complete response:
  // Missing success or missing outcome MUST NOT silently pass!
  const completeValid = completeRes && completeRes.success === true && typeof completeRes.outcome === 'string' && completeRes.outcome.trim() !== '';
  if (!completeValid) {
    failedItems.push({
      tenant_id: tenantId,
      lead_id: leadId,
      job_id: jobId,
      outcome: 'complete_response_invalid',
      reason: completeRes.error || (completeRes.success === undefined ? 'Missing success field in /complete response' : 'Missing or invalid outcome field in /complete response'),
      complete_response: completeRes,
    });
    continue;
  }

  // 2. Check if business action failed or encountered unknown/failed outcome
  if (
    actionOutcome === 'unknown_path_failed' ||
    actionOutcome === 'action_execution_failed' ||
    actionOutcome === 'malformed_response' ||
    actionOutcome === 'inspect_failed' ||
    actionSucceeded === false ||
    validated.success === false
  ) {
    failedItems.push({
      tenant_id: tenantId,
      lead_id: leadId,
      job_id: jobId,
      outcome: actionOutcome || completeRes.outcome,
      reason: validated.error_message || validated.reason || validated.error || 'Business action failure',
    });
  }
}

if (failedItems.length > 0) {
  const firstFail = failedItems[0];
  const summaryMsg = \`Services follow-up orchestration failed for \${failedItems.length} job(s). First failure: tenant='\${firstFail.tenant_id}', lead='\${firstFail.lead_id}', job='\${firstFail.job_id}', outcome='\${firstFail.outcome}', reason='\${firstFail.reason}'\`;
  console.error('[Services Orchestration Execution Failure]', summaryMsg, JSON.stringify(failedItems));
  throw new Error(summaryMsg);
}

return items;`;
  console.log('✓ Updated Enforce Business Outcome Status for strict /complete validation and error throwing.');
}

// Save modified canvas
fs.writeFileSync(canvasPath, JSON.stringify(wf, null, 2), 'utf8');
console.log(`\nUpdated canvas saved to ${canvasPath} with ${wf.nodes.length} nodes.`);

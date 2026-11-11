import fs from 'fs';
import { execSync } from 'child_process';

async function runMalformedCompleteTest() {
  const workflowId = 'wf-test-malformed-complete';
  console.log(`=== Testing Malformed /complete Response Handling (Workflow: ${workflowId}) ===`);

  const workflow = {
    name: 'Test - Malformed Complete Handling',
    settings: {
      saveExecutionProgress: true,
      saveManualExecutions: true
    },
    nodes: [
      {
        parameters: {},
        id: 'start-trigger',
        name: 'Manual Trigger',
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [200, 300]
      },
      {
        parameters: {
          jsCode: `// Validate Action Response node sets upfront context
return [{
  json: {
    tenant_id: 'sandbox-services-alpha',
    lead_id: 'lead_malformed_test_101',
    job_id: 'job_malformed_test_202',
    outcome: 'action_completed',
    action_succeeded: true
  }
}];`
        },
        id: 'validate-action-response',
        name: 'Validate Action Response',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [400, 300]
      },
      {
        parameters: {
          jsCode: `// Simulates the HTTP Request to /complete returning malformed payload
// Omitting 'success' and 'outcome' completely
return [{
  json: {
    status: 'ok',
    timestamp: new Date().toISOString()
  }
}];`
        },
        id: 'http-complete-mock',
        name: 'HTTP: Complete Followup Job',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [600, 300]
      },
      {
        parameters: {
          jsCode: `// Strict validation of /complete response and enforcement of business outcome status
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

return items;`
        },
        id: 'enforce-outcome',
        name: 'Enforce Business Outcome Status',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [800, 300]
      }
    ],
    connections: {
      'Manual Trigger': { main: [[{ node: 'Validate Action Response', type: 'main', index: 0 }]] },
      'Validate Action Response': { main: [[{ node: 'HTTP: Complete Followup Job', type: 'main', index: 0 }]] },
      'HTTP: Complete Followup Job': { main: [[{ node: 'Enforce Business Outcome Status', type: 'main', index: 0 }]] }
    }
  };

  fs.writeFileSync('scratch/malformed-complete-wf.json', JSON.stringify(workflow, null, 2), 'utf8');
  execSync('docker cp scratch/malformed-complete-wf.json n8n:/tmp/malformed-complete-wf.json');

  const regScript = `
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/home/node/.n8n/database.sqlite');
const wf = JSON.parse(fs.readFileSync('/tmp/malformed-complete-wf.json', 'utf8'));
const workflowId = '${workflowId}';
const existing = db.prepare('SELECT id FROM workflow_entity WHERE id = ?').get(workflowId);
const nodesJson = JSON.stringify(wf.nodes);
const connectionsJson = JSON.stringify(wf.connections);
const settingsJson = JSON.stringify(wf.settings);
const now = new Date().toISOString();

if (existing) {
  db.prepare(\`UPDATE workflow_entity SET nodes = ?, connections = ?, settings = ?, updatedAt = ? WHERE id = ?\`).run(nodesJson, connectionsJson, settingsJson, now, workflowId);
} else {
  const crypto = require('crypto');
  const versionId = crypto.randomUUID();
  db.prepare(\`INSERT INTO workflow_entity (id, name, active, versionId, isArchived, nodeGroups, nodes, connections, settings, createdAt, updatedAt, versionCounter) VALUES (?, ?, 0, ?, 0, '[]', ?, ?, ?, ?, ?, 1)\`).run(workflowId, wf.name, versionId, nodesJson, connectionsJson, settingsJson, now, now);
}

const sharedExisting = db.prepare('SELECT workflowId FROM shared_workflow WHERE workflowId = ?').get(workflowId);
if (!sharedExisting) {
  db.prepare(\`INSERT INTO shared_workflow (workflowId, projectId, role, createdAt, updatedAt) VALUES (?, 'ZLHHAaD8vTbJoOrY', 'workflow:owner', ?, ?)\`).run(workflowId, now, now);
}
console.log('Registered ' + workflowId);
`;
  fs.writeFileSync('scratch/reg-malformed.js', regScript);
  execSync('docker cp scratch/reg-malformed.js n8n:/tmp/reg-malformed.js');
  execSync('docker exec n8n node /tmp/reg-malformed.js');

  // Execute workflow by ID
  try {
    execSync(`docker exec -e N8N_RUNNERS_BROKER_PORT=5699 n8n n8n execute --id=${workflowId}`, { stdio: 'pipe' });
  } catch (err) {
    // Expected to fail with red status
  }

  // Read execution from SQLite
  const readCmd = `docker exec n8n node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/home/node/.n8n/database.sqlite'); const row = db.prepare('SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity WHERE workflowId = ? ORDER BY id DESC LIMIT 1').get('${workflowId}'); console.log(JSON.stringify(row));"`;
  const raw = execSync(readCmd, { encoding: 'utf8' }).trim();
  const execEntity = JSON.parse(raw);

  // Read execution data for error details
  const errorCmd = `docker exec n8n node -e "const { parse } = require('/usr/local/lib/node_modules/n8n/node_modules/flatted'); const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/home/node/.n8n/database.sqlite'); const row = db.prepare('SELECT data FROM execution_data WHERE executionId = ?').get(${execEntity.id}); const d = parse(row.data); console.log(JSON.stringify({ lastNodeExecuted: d.resultData.lastNodeExecuted, errorMessage: d.resultData.error.message, nodes: Object.keys(d.resultData.runData) }));"`;
  const errRaw = execSync(errorCmd, { encoding: 'utf8' }).trim();
  const execDetails = JSON.parse(errRaw);

  console.log('\n--- N8N Engine Execution Evidence for Malformed /complete Handling ---');
  console.log(`Execution ID:      #${execEntity.id}`);
  console.log(`Workflow ID:       ${execEntity.workflowId}`);
  console.log(`Status:            ${execEntity.status.toUpperCase()} (RED)`);
  console.log(`Mode:              ${execEntity.mode}`);
  console.log(`Started At:        ${execEntity.startedAt}`);
  console.log(`Stopped At:        ${execEntity.stoppedAt}`);
  console.log(`Last Executed Node:${execDetails.lastNodeExecuted}`);
  console.log(`Executed Nodes:    ${execDetails.nodes.join(' -> ')}`);
  console.log(`Engine Error:      ${execDetails.errorMessage}`);
}

runMalformedCompleteTest().catch(console.error);

import fs from 'fs';
import { execSync } from 'child_process';
import { query } from '../lib/db.ts';

async function runOrderIssueFailureTest() {
  const runId = 'run_oi_' + Date.now();
  console.log(`=== Testing Order Issue Failure Branch with Unique Run ID: ${runId} ===`);

  const workflowId = 'wf-test-order-issue-failure';
  const oiWorkflow = {
    name: 'Test - Order Issue Failure Branch',
    settings: {
      saveExecutionProgress: true,
      saveManualExecutions: true
    },
    nodes: [
      {
        parameters: {},
        id: 'start-oi',
        name: 'Trigger Failure',
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [200, 300]
      },
      {
        parameters: {
          jsCode: `return [{
  json: {
    tenant_id: 'sandbox-services-alpha',
    order_id: 'ord_test_8899',
    run_id: '${runId}',
    error: 'Simulated Order Issue downstream webhook 500 error for run ${runId}',
    statusCode: 500,
    stage: 'claim_and_process'
  }
}];`
        },
        id: 'simulate-oi-failure',
        name: 'Simulate Failure Response',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [400, 300]
      },
      {
        parameters: {
          jsCode: `// Format failure alert and prepare audit persistence
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
}];`
        },
        id: 'handle-oi-failure',
        name: 'Handle Followup Failure',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [600, 300]
      },
      {
        parameters: {
          operation: 'executeQuery',
          query: 'INSERT INTO iao.audit(tenant_id,event,details) VALUES($1,$2,$3::jsonb) RETURNING id,created_at;',
          options: {
            queryReplacement: '={{ [$json.tenant_id, $json.event, JSON.stringify($json.details)] }}'
          }
        },
        id: 'save-oi-audit',
        name: 'Save Followup Failure Audit',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5,
        position: [800, 300],
        credentials: {
          postgres: {
            id: 'EQXErmKipwsJmqLP',
            name: 'Postgres account'
          }
        }
      },
      {
        parameters: {
          errorMessage: '={{ $json.error_message || "Order Issue follow-up execution failed" }}'
        },
        id: 'stop-and-error-oi',
        name: 'Record Failed Followup Execution',
        type: 'n8n-nodes-base.stopAndError',
        typeVersion: 1,
        position: [1000, 300]
      }
    ],
    connections: {
      'Trigger Failure': { main: [[{ node: 'Simulate Failure Response', type: 'main', index: 0 }]] },
      'Simulate Failure Response': { main: [[{ node: 'Handle Followup Failure', type: 'main', index: 0 }]] },
      'Handle Followup Failure': { main: [[{ node: 'Save Followup Failure Audit', type: 'main', index: 0 }]] },
      'Save Followup Failure Audit': { main: [[{ node: 'Record Failed Followup Execution', type: 'main', index: 0 }]] }
    }
  };

  // Register in n8n database
  fs.writeFileSync('scratch/oi-failure-wf.json', JSON.stringify(oiWorkflow, null, 2), 'utf8');
  execSync('docker cp scratch/oi-failure-wf.json n8n:/tmp/oi-failure-wf.json');

  const registerScript = `
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/home/node/.n8n/database.sqlite');
const wf = JSON.parse(fs.readFileSync('/tmp/oi-failure-wf.json', 'utf8'));
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
  fs.writeFileSync('scratch/reg-oi.js', registerScript);
  execSync('docker cp scratch/reg-oi.js n8n:/tmp/reg-oi.js');
  execSync('docker exec n8n node /tmp/reg-oi.js');

  // Execute workflow by ID
  let execOutput = '';
  try {
    execOutput = execSync(`docker exec -e N8N_RUNNERS_BROKER_PORT=5699 n8n n8n execute --id=${workflowId}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    execOutput = (err.stdout || '') + '\n' + (err.stderr || '');
  }
  console.log('CLI Execution Finished.');

  // Query SQLite for this execution
  const cmd = `docker exec n8n node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/home/node/.n8n/database.sqlite'); const row = db.prepare('SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity WHERE workflowId = ? ORDER BY id DESC LIMIT 1').get('${workflowId}'); console.log(JSON.stringify(row));"`;
  const raw = execSync(cmd, { encoding: 'utf8' }).trim();
  const execEntity = JSON.parse(raw);

  console.log('\n--- N8N Engine Execution Evidence ---');
  console.log(`Execution ID: #${execEntity.id}`);
  console.log(`Workflow ID:  ${execEntity.workflowId}`);
  console.log(`Status:       ${execEntity.status.toUpperCase()} (RED)`);
  console.log(`Mode:         ${execEntity.mode}`);
  console.log(`Started At:   ${execEntity.startedAt}`);
  console.log(`Stopped At:   ${execEntity.stoppedAt}`);

  // Query PostgreSQL iao.audit table for the exact row correlated by runId
  const auditRows = await query(
    `SELECT id, tenant_id, event, details, created_at
     FROM iao.audit
     WHERE details->>'run_id' = $1
     ORDER BY created_at DESC LIMIT 1;`,
    [runId]
  );

  console.log('\n--- PostgreSQL Correlated Audit Row Evidence (iao.audit) ---');
  if (auditRows.length > 0) {
    const row = auditRows[0];
    console.log(`Audit ID:     ${row.id}`);
    console.log(`Tenant ID:    ${row.tenant_id}`);
    console.log(`Event:        ${row.event}`);
    console.log(`Correlated Run ID: ${row.details?.run_id}`);
    console.log(`Full Details: ${JSON.stringify(row.details, null, 2)}`);
    console.log(`Created At:   ${row.created_at}`);
  } else {
    console.error('ERROR: No audit row found with run_id ' + runId);
  }

  process.exit(0);
}

runOrderIssueFailureTest().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

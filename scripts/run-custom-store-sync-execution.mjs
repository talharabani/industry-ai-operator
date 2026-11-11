import fs from 'fs';
import { execSync } from 'child_process';
import { query } from '../lib/db.ts';

async function runCustomStoreSyncTest() {
  console.log('=== Running Actual Custom Store n8n Loop with Two Sandbox Connections in ONE Execution ===');

  const workflowId = 'wf-custom-store-sync';

  // Ensure sandbox scope is explicitly configured
  const scopeRes = await fetch('http://localhost:3000/api/custom-store/sync/sandbox-scope', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-iao-worker-key': process.env.N8N_OPERATOR_KEY
    },
    body: JSON.stringify({
      sandbox_tenant_id: 'sandbox-services-alpha',
      mock: true
    })
  }).then(r => r.json());
  console.log('Sandbox scope response:', scopeRes);

  // Sync latest custom-store-sync-orchestration.json into n8n
  execSync('docker cp n8n-workflows/custom-store-sync-orchestration.json n8n:/tmp/cs-sync.json');
  const syncSqliteScript = `
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/home/node/.n8n/database.sqlite');
const wf = JSON.parse(fs.readFileSync('/tmp/cs-sync.json', 'utf8'));
const workflowId = 'wf-custom-store-sync';
const existing = db.prepare('SELECT id FROM workflow_entity WHERE id = ?').get(workflowId);
const nodesJson = JSON.stringify(wf.nodes);
const connectionsJson = JSON.stringify(wf.connections);
const settingsJson = JSON.stringify({ saveExecutionProgress: true, saveManualExecutions: true });
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
console.log('Workflow synced in n8n SQLite.');
`;
  fs.writeFileSync('scratch/sync-cs.js', syncSqliteScript);
  execSync('docker cp scratch/sync-cs.js n8n:/tmp/sync-cs.js');
  execSync('docker exec n8n node /tmp/sync-cs.js');

  console.log('Executing wf-custom-store-sync via n8n CLI...');
  let cliOutput = '';
  try {
    cliOutput = execSync(`docker exec -e N8N_RUNNERS_BROKER_PORT=5699 n8n n8n execute --id=${workflowId}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(cliOutput);
  } catch (err) {
    console.log('CLI finished with status code:', err.status);
    console.log((err.stdout || '') + '\n' + (err.stderr || ''));
  }

  // Query SQLite for this execution
  const readCmd = `docker exec n8n node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/home/node/.n8n/database.sqlite'); const row = db.prepare('SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity WHERE workflowId = ? ORDER BY id DESC LIMIT 1').get('${workflowId}'); console.log(JSON.stringify(row));"`;
  const raw = execSync(readCmd, { encoding: 'utf8' }).trim();
  const execEntity = JSON.parse(raw);

  console.log('\n--- N8N Engine Execution Evidence for Custom Store Sync Loop ---');
  console.log(`Execution ID: #${execEntity.id}`);
  console.log(`Workflow ID:  ${execEntity.workflowId}`);
  console.log(`Status:       ${execEntity.status.toUpperCase()}`);
  console.log(`Mode:         ${execEntity.mode}`);
  console.log(`Started At:   ${execEntity.startedAt}`);
  console.log(`Stopped At:   ${execEntity.stoppedAt}`);

  // Query PostgreSQL for the resulting jobs created in this run
  const recentJobs = await query(
    `SELECT id, tenant_id, connection_id, status, error_details, summary, created_at, updated_at
     FROM iao.custom_store_sync_jobs
     WHERE tenant_id = 'sandbox-services-alpha'
     ORDER BY created_at DESC LIMIT 5;`
  );

  console.log('\n--- Resulting Sync Jobs in PostgreSQL (iao.custom_store_sync_jobs) ---');
  for (const job of recentJobs) {
    console.log(`- Connection ID: ${job.connection_id}`);
    console.log(`  Job ID:        ${job.id}`);
    console.log(`  Status:        ${job.status}`);
    console.log(`  Errors:        ${JSON.stringify(job.error_details || [])}`);
    console.log(`  Summary:       ${JSON.stringify(job.summary)}`);
    console.log(`  Created At:    ${job.created_at}`);
    console.log(`  Updated At:    ${job.updated_at}\n`);
  }

  process.exit(0);
}

runCustomStoreSyncTest().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

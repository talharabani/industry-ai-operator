import fs from 'fs';
import { execSync } from 'child_process';

const standalonePath = 'n8n-workflows/custom-store-sync-orchestration.json';
const workflowId = 'wf-custom-store-sync';

// Copy into n8n container
execSync(`docker cp ${standalonePath} n8n:/tmp/custom-store-sync.json`, { stdio: 'inherit' });

const runnerContent = `
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/home/node/.n8n/database.sqlite');

const wf = JSON.parse(fs.readFileSync('/tmp/custom-store-sync.json', 'utf8'));
const workflowId = '${workflowId}';

const existing = db.prepare('SELECT id, versionCounter FROM workflow_entity WHERE id = ?').get(workflowId);
const nodesJson = JSON.stringify(wf.nodes);
const connectionsJson = JSON.stringify(wf.connections);
const settingsJson = JSON.stringify({
  ...(wf.settings || {}),
  saveExecutionProgress: true,
  saveManualExecutions: true
});
const now = new Date().toISOString();

if (existing) {
  const newVersion = (existing.versionCounter || 0) + 1;
  db.prepare(\`
    UPDATE workflow_entity 
    SET nodes = ?, 
        connections = ?, 
        settings = ?, 
        active = 0, 
        versionCounter = ?, 
        updatedAt = ? 
    WHERE id = ?
  \`).run(nodesJson, connectionsJson, settingsJson, newVersion, now, workflowId);
  console.log('SUCCESS: Updated ' + workflowId + ' in SQLite, active=0, version=' + newVersion);
} else {
  db.prepare(\`
    INSERT INTO workflow_entity (id, name, active, nodes, connections, settings, createdAt, updatedAt, versionCounter)
    VALUES (?, ?, 0, ?, ?, ?, ?, ?, 1)
  \`).run(workflowId, 'Industry AI Operator - Custom Store Sync Orchestration', nodesJson, connectionsJson, settingsJson, now, now);
  console.log('SUCCESS: Created ' + workflowId + ' in SQLite, active=0');
}
`;

fs.writeFileSync('scratch/sync-cs-runner.js', runnerContent, 'utf8');
execSync(`docker cp scratch/sync-cs-runner.js n8n:/tmp/sync-cs-runner.js`, { stdio: 'inherit' });
const out = execSync(`docker exec n8n node /tmp/sync-cs-runner.js`, { encoding: 'utf8' });
console.log(out);

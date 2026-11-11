import fs from 'fs';
import { execSync } from 'child_process';

const canvasPath = 'n8n-workflows/canvas_export.json';
const canvas = JSON.parse(fs.readFileSync(canvasPath, 'utf8'));

const standalonePath = 'n8n-workflows/services-lead-followups.json';
const standalone = JSON.parse(fs.readFileSync(standalonePath, 'utf8'));

const nodesToSync = [
  'Inspect Lead State & Permitted Path',
  'Preserve Context & Validate Response',
  'Choose Permitted Path',
  'Dispatch Customer Follow-up',
  'Escalate to Owner Task',
  'Cancel Obsolete Follow-up',
  'Handle Unknown Path Failure',
  'Validate Action Response',
  'Record Job Outcome',
  'Enforce Business Outcome Status'
];

nodesToSync.forEach(name => {
  const sourceNode = canvas.nodes.find(n => n.name === name);
  const targetIndex = standalone.nodes.findIndex(n => n.name === name);
  if (sourceNode && targetIndex !== -1) {
    standalone.nodes[targetIndex].parameters = sourceNode.parameters;
    standalone.nodes[targetIndex].onError = sourceNode.onError;
    standalone.nodes[targetIndex].continueOnFail = sourceNode.continueOnFail;
    console.log(`✓ Synced parameters and error settings for node '${name}' into standalone workflow.`);
  }
});

fs.writeFileSync(standalonePath, JSON.stringify(standalone, null, 2), 'utf8');

// Copy into n8n container and update wf-services-lead-followups in SQLite
execSync(`docker cp ${standalonePath} n8n:/tmp/services-lead-followups.json`, { stdio: 'inherit' });

const runnerContent = `
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/home/node/.n8n/database.sqlite');

const wf = JSON.parse(fs.readFileSync('/tmp/services-lead-followups.json', 'utf8'));
const workflowId = 'wf-services-lead-followups';

const existing = db.prepare('SELECT id, versionCounter FROM workflow_entity WHERE id = ?').get(workflowId);
if (existing) {
  const nodesJson = JSON.stringify(wf.nodes);
  const connectionsJson = JSON.stringify(wf.connections);
  const settingsJson = JSON.stringify(wf.settings || {});
  const newVersion = (existing.versionCounter || 0) + 1;
  const now = new Date().toISOString();

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
  console.log('SUCCESS: Updated wf-services-lead-followups in SQLite.');
}
`;

fs.writeFileSync('scratch/sync-standalone.js', runnerContent, 'utf8');
execSync(`docker cp scratch/sync-standalone.js n8n:/tmp/sync-standalone.js`, { stdio: 'inherit' });
const out = execSync(`docker exec n8n node /tmp/sync-standalone.js`, { encoding: 'utf8' });
console.log(out);

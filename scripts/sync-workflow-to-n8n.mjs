import fs from 'fs';
import { execSync } from 'child_process';

const canvasPath = 'n8n-workflows/canvas_export.json';

// Copy canvas file into n8n container
execSync(`docker cp ${canvasPath} n8n:/tmp/canvas_updated.json`, { stdio: 'inherit' });

// Create runner script to run inside n8n
const runnerContent = `
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/home/node/.n8n/database.sqlite');

const wf = JSON.parse(fs.readFileSync('/tmp/canvas_updated.json', 'utf8'));
const workflowId = 'nv2htPlcYCMN2c9T';

const existing = db.prepare('SELECT id, versionCounter FROM workflow_entity WHERE id = ?').get(workflowId);
if (!existing) {
  console.error('Workflow not found!');
  process.exit(1);
}

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

console.log('SUCCESS: Updated ' + workflowId + ' to ' + wf.nodes.length + ' nodes, active=0, version=' + newVersion);
`;

fs.writeFileSync('scratch/n8n-update-runner.js', runnerContent, 'utf8');
execSync(`docker cp scratch/n8n-update-runner.js n8n:/tmp/n8n-update-runner.js`, { stdio: 'inherit' });
const out = execSync(`docker exec n8n node /tmp/n8n-update-runner.js`, { encoding: 'utf8' });
console.log(out);

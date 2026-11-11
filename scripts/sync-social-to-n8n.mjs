import fs from 'fs';
import { execSync } from 'child_process';

const standalonePath = 'n8n-workflows/social-media-autopilot.json';
const standalone = JSON.parse(fs.readFileSync(standalonePath, 'utf8'));

// 1. Copy into n8n container
execSync(`docker cp ${standalonePath} n8n:/tmp/social-media-autopilot.json`, { stdio: 'inherit' });

// 2. Also inject into canvas_export.json if not present
const canvasPath = 'n8n-workflows/canvas_export.json';
const canvas = JSON.parse(fs.readFileSync(canvasPath, 'utf8'));

const existingNames = new Set(canvas.nodes.map(n => n.name));
let addedCount = 0;
for (const node of standalone.nodes) {
  const isTrigger = node.type.toLowerCase().includes('trigger');
  if (!existingNames.has(node.name)) {
    // Offset position to avoid overlapping with existing canvas
    const offsetNode = {
      ...node,
      disabled: isTrigger ? true : Boolean(node.disabled),
      position: [node.position[0] + 1800, node.position[1] + 2000]
    };
    canvas.nodes.push(offsetNode);
    addedCount++;
  } else {
    // If it already exists, ensure triggers are disabled in shared canvas
    const idx = canvas.nodes.findIndex(n => n.name === node.name);
    if (idx !== -1 && isTrigger) {
      canvas.nodes[idx].disabled = true;
    }
  }
}

// Add connections to canvas
if (!canvas.connections) canvas.connections = {};
for (const [sourceNode, conns] of Object.entries(standalone.connections)) {
  canvas.connections[sourceNode] = conns;
}

fs.writeFileSync(canvasPath, JSON.stringify(canvas, null, 2), 'utf8');
console.log(`✓ Merged ${addedCount} Social Media nodes into canvas_export.json (triggers disabled in shared canvas)`);

// Copy canvas to n8n container
execSync(`docker cp ${canvasPath} n8n:/tmp/canvas_updated.json`, { stdio: 'inherit' });

// 3. Register wf-social-media-autopilot and update canvas in SQLite
const runnerScript = `
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/home/node/.n8n/database.sqlite');

// A. Register / Update wf-social-media-autopilot
const socialWf = JSON.parse(fs.readFileSync('/tmp/social-media-autopilot.json', 'utf8'));
const wfId = 'wf-social-media-autopilot';
const existing = db.prepare('SELECT id, versionCounter FROM workflow_entity WHERE id = ?').get(wfId);

const nodesJson = JSON.stringify(socialWf.nodes);
const connectionsJson = JSON.stringify(socialWf.connections);
const settingsJson = JSON.stringify(socialWf.settings || {});
const now = new Date().toISOString();

if (existing) {
  const newVersion = (existing.versionCounter || 0) + 1;
  db.prepare(\`
    UPDATE workflow_entity
    SET nodes = ?, connections = ?, settings = ?, active = 0, versionCounter = ?, updatedAt = ?
    WHERE id = ?
  \`).run(nodesJson, connectionsJson, settingsJson, newVersion, now, wfId);
  console.log('✓ Updated ' + wfId + ' in SQLite (version ' + newVersion + ')');
} else {
  const versionId = crypto.randomUUID();
  db.prepare(\`
    INSERT INTO workflow_entity (id, name, active, versionId, isArchived, nodeGroups, nodes, connections, settings, createdAt, updatedAt, versionCounter)
    VALUES (?, ?, 0, ?, 0, '[]', ?, ?, ?, ?, ?, 1)
  \`).run(wfId, socialWf.name, versionId, nodesJson, connectionsJson, settingsJson, now, now);

  const sharedExisting = db.prepare('SELECT workflowId FROM shared_workflow WHERE workflowId = ?').get(wfId);
  if (!sharedExisting) {
    db.prepare(\`INSERT INTO shared_workflow (workflowId, projectId, role, createdAt, updatedAt) VALUES (?, 'ZLHHAaD8vTbJoOrY', 'workflow:owner', ?, ?)\`).run(wfId, now, now);
  }
  console.log('✓ Inserted new workflow ' + wfId + ' into SQLite');
}

// B. Update shared canvas workflow nv2htPlcYCMN2c9T
const canvasWf = JSON.parse(fs.readFileSync('/tmp/canvas_updated.json', 'utf8'));
const canvasId = 'nv2htPlcYCMN2c9T';
const existingCanvas = db.prepare('SELECT id, versionCounter FROM workflow_entity WHERE id = ?').get(canvasId);

if (existingCanvas) {
  const newVer = (existingCanvas.versionCounter || 0) + 1;
  db.prepare(\`
    UPDATE workflow_entity
    SET nodes = ?, connections = ?, settings = ?, versionCounter = ?, updatedAt = ?
    WHERE id = ?
  \`).run(JSON.stringify(canvasWf.nodes), JSON.stringify(canvasWf.connections), JSON.stringify(canvasWf.settings || {}), newVer, now, canvasId);
  console.log('✓ Updated shared canvas workflow ' + canvasId + ' to ' + canvasWf.nodes.length + ' nodes');
}
`;

fs.writeFileSync('scratch/sync-social-runner.js', runnerScript, 'utf8');
execSync(`docker cp scratch/sync-social-runner.js n8n:/tmp/sync-social-runner.js`, { stdio: 'inherit' });
const res = execSync(`docker exec n8n node /tmp/sync-social-runner.js`, { encoding: 'utf8' });
console.log(res);

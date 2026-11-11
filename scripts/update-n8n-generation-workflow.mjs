import { execSync } from 'child_process';
import fs from 'fs';

const containerScript = `
const { DatabaseSync } = require('node:sqlite');

function getDbWithRetry() {
  const db = new DatabaseSync('/home/node/.n8n/database.sqlite');
  db.exec('PRAGMA busy_timeout = 10000;');
  return db;
}

function updateSocialAutopilot() {
  const db = getDbWithRetry();
  const wfId = 'wf-social-media-autopilot';
  const row = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(wfId);
  if (!row) {
    console.error('Workflow ' + wfId + ' not found in database!');
    return;
  }

  const nodes = JSON.parse(row.nodes);
  const connections = JSON.parse(row.connections);

  // Check if on-demand webhook already exists
  const hasWebhook = nodes.some(n => n.id === 'social-on-demand-webhook');
  if (!hasWebhook) {
    nodes.push({
      parameters: {
        httpMethod: 'POST',
        path: 'social-generate-post',
        responseMode: 'onReceived',
        options: {}
      },
      id: 'social-on-demand-webhook',
      name: '[Social Media] On-Demand Generation Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [200, 500],
      webhookId: 'social-generate-post'
    });

    nodes.push({
      parameters: {
        method: 'POST',
        url: 'http://host.docker.internal:3000/api/social/generate/pipeline',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'x-n8n-operator-key', value: '={{ $env.CRON_SECRET || "dev-secret" }}' },
            { name: 'Content-Type', value: 'application/json' }
          ]
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={\\n  "job_id": "{{ $json.body?.job_id || $json.job_id }}",\\n  "tenant_id": "{{ $json.body?.tenant_id || $json.tenant_id }}"\\n}',
        options: {
          timeout: 60000
        }
      },
      id: 'social-run-pipeline',
      name: '[Social Media] Run Content Generation Pipeline',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [460, 500]
    });

    nodes.push({
      parameters: {
        jsCode: 'const item = $input.first().json;\\nconst job = item.job || {};\\nreturn [{\\n  json: {\\n    success: item.success,\\n    job_id: job.id,\\n    tenant_id: job.tenant_id,\\n    status: job.status,\\n    stage_label: job.stage_label,\\n    content_angle: job.selected_concept?.content_angle,\\n    topic: job.selected_concept?.topic,\\n    post_id: job.post_id,\\n    media_status: job.media_result?.status,\\n    completed_at: new Date().toISOString()\\n  }\\n}];'
      },
      id: 'social-record-generation-outcome',
      name: '[Social Media] Record Generation Outcome',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [720, 500]
    });

    connections['[Social Media] On-Demand Generation Webhook'] = {
      main: [[{ node: '[Social Media] Run Content Generation Pipeline', type: 'main', index: 0 }]]
    };
    connections['[Social Media] Run Content Generation Pipeline'] = {
      main: [[{ node: '[Social Media] Record Generation Outcome', type: 'main', index: 0 }]]
    };

    const newVer = (row.versionCounter || 0) + 1;
    const now = new Date().toISOString();
    db.prepare('UPDATE workflow_entity SET nodes = ?, connections = ?, versionCounter = ?, updatedAt = ?, active = 1 WHERE id = ?')
      .run(JSON.stringify(nodes), JSON.stringify(connections), newVer, now, wfId);

    console.log('Successfully added On-Demand Generation branch to ' + wfId + ' (version ' + newVer + ')');
  } else {
    console.log('On-Demand Generation branch already present in ' + wfId);
  }

  // Also update shared canvas nv2htPlcYCMN2c9T
  const canvasId = 'nv2htPlcYCMN2c9T';
  const cRow = db.prepare('SELECT * FROM workflow_entity WHERE id = ?').get(canvasId);
  if (cRow) {
    const cNodes = JSON.parse(cRow.nodes);
    const cConns = JSON.parse(cRow.connections);

    if (!cNodes.some(n => n.id === 'canvas-social-on-demand-webhook')) {
      cNodes.push({
        parameters: {
          content: '## [Social Media] Generation Branch\\nOrchestrates AI content ideation, copywriting via Groq, media evaluation, and post preview creation.',
          height: 240,
          width: 780,
          color: 4
        },
        id: 'canvas-social-sticky',
        name: 'Sticky Note Social Generation',
        type: 'n8n-nodes-base.stickyNote',
        typeVersion: 1,
        position: [200, 1600]
      });

      cNodes.push({
        parameters: {
          httpMethod: 'POST',
          path: 'social-generate-post',
          responseMode: 'onReceived',
          options: {}
        },
        id: 'canvas-social-on-demand-webhook',
        name: '[Social Media] On-Demand Generation Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [240, 1680],
        webhookId: 'social-generate-post-canvas'
      });

      cNodes.push({
        parameters: {
          method: 'POST',
          url: 'http://host.docker.internal:3000/api/social/generate/pipeline',
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: 'x-n8n-operator-key', value: '={{ $env.CRON_SECRET || "dev-secret" }}' },
              { name: 'Content-Type', value: 'application/json' }
            ]
          },
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={\\n  "job_id": "{{ $json.body?.job_id || $json.job_id }}",\\n  "tenant_id": "{{ $json.body?.tenant_id || $json.tenant_id }}"\\n}',
          options: {
            timeout: 60000
          }
        },
        id: 'canvas-social-run-pipeline',
        name: '[Social Media] Run Content Generation Pipeline',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [500, 1680]
      });

      cNodes.push({
        parameters: {
          jsCode: 'const item = $input.first().json;\\nconst job = item.job || {};\\nreturn [{\\n  json: {\\n    success: item.success,\\n    job_id: job.id,\\n    tenant_id: job.tenant_id,\\n    status: job.status,\\n    stage_label: job.stage_label,\\n    content_angle: job.selected_concept?.content_angle,\\n    topic: job.selected_concept?.topic,\\n    post_id: job.post_id,\\n    media_status: job.media_result?.status,\\n    completed_at: new Date().toISOString()\\n  }\\n}];'
        },
        id: 'canvas-social-record-generation-outcome',
        name: '[Social Media] Record Generation Outcome',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [760, 1680]
      });

      cConns['[Social Media] On-Demand Generation Webhook'] = {
        main: [[{ node: '[Social Media] Run Content Generation Pipeline', type: 'main', index: 0 }]]
      };
      cConns['[Social Media] Run Content Generation Pipeline'] = {
        main: [[{ node: '[Social Media] Record Generation Outcome', type: 'main', index: 0 }]]
      };

      const cVer = (cRow.versionCounter || 0) + 1;
      const now = new Date().toISOString();
      db.prepare('UPDATE workflow_entity SET nodes = ?, connections = ?, versionCounter = ?, updatedAt = ? WHERE id = ?')
        .run(JSON.stringify(cNodes), JSON.stringify(cConns), cVer, now, canvasId);

      console.log('Successfully added labelled Social Media Generation branch to shared canvas ' + canvasId);
    } else {
      console.log('Shared canvas already contains Social Media Generation branch');
    }
  }
}

let retries = 5;
while (retries > 0) {
  try {
    updateSocialAutopilot();
    break;
  } catch (err) {
    if (err.message && err.message.includes('locked')) {
      retries--;
      console.log('Database locked, waiting 1s... (' + retries + ' retries remaining)');
      const start = Date.now();
      while (Date.now() - start < 1000) {}
    } else {
      throw err;
    }
  }
}
`;

fs.writeFileSync('scratch/update-n8n-script.js', containerScript, 'utf8');
execSync('docker cp scratch/update-n8n-script.js n8n:/tmp/update-n8n-script.js');
const output = execSync('docker exec n8n node /tmp/update-n8n-script.js').toString();
console.log('n8n update output:', output);

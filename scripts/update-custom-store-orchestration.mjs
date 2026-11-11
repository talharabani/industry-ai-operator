import fs from 'fs';

const csPath = 'n8n-workflows/custom-store-sync-orchestration.json';
const cs = JSON.parse(fs.readFileSync(csPath, 'utf8'));

// Check if node-cs-fetch-scope exists
let fetchScopeNode = cs.nodes.find(n => n.id === 'node-cs-fetch-scope');
if (!fetchScopeNode) {
  fetchScopeNode = {
    parameters: {
      method: 'GET',
      url: 'http://host.docker.internal:3000/api/custom-store/sync/sandbox-scope',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: {
        response: {
          response: {
            responseFormat: 'json'
          }
        }
      }
    },
    id: 'node-cs-fetch-scope',
    name: 'CS HTTP: Fetch Sandbox Scope Config',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [320, 340],
    credentials: {
      httpHeaderAuth: {
        id: 'h2AiwQQc0Q82QoEJ',
        name: 'IAO Working Key'
      }
    },
    onError: 'continueRegularOutput',
    continueOnFail: true
  };
  cs.nodes.push(fetchScopeNode);
}

// Update CS Config: Store Connection jsCode
const configNode = cs.nodes.find(n => n.name === 'CS Config: Store Connection');
if (configNode) {
  configNode.parameters.jsCode = `const scopeRes = $input.first()?.json || {};
let manualInput = {};
try {
  manualInput = $('CS Trigger: Manual Execution')?.first()?.json || {};
} catch (e) {
  manualInput = {};
}

const targetTenant = manualInput.tenant_id || manualInput.target_tenant_id || scopeRes.sandbox_tenant_id;
const targetConn = manualInput.connection_id || manualInput.target_connection_id || scopeRes.target_connection_id || '';

if (!targetTenant || !targetTenant.trim()) {
  throw new Error('Missing required target_tenant_id scope for Custom Store Sync. In sandbox mode, explicit authorized tenant configuration or active sandbox-scope is required. Refusing to process un-scoped stores.');
}

return [
  {
    json: {
      target_tenant_id: targetTenant.trim(),
      target_connection_id: targetConn.trim(),
      page_limit: manualInput.page_limit || 50,
      max_pages_per_run: manualInput.max_pages_per_run || 5,
      is_sandbox: Boolean(scopeRes.mock !== undefined ? scopeRes.mock : true)
    }
  }
];`;
}

// Rewire triggers -> Fetch Scope -> Config
cs.connections['CS Trigger: Schedule Hourly'] = {
  main: [[{ node: 'CS HTTP: Fetch Sandbox Scope Config', type: 'main', index: 0 }]]
};
cs.connections['CS Trigger: Manual Execution'] = {
  main: [[{ node: 'CS HTTP: Fetch Sandbox Scope Config', type: 'main', index: 0 }]]
};
cs.connections['CS HTTP: Fetch Sandbox Scope Config'] = {
  main: [[{ node: 'CS Config: Store Connection', type: 'main', index: 0 }]]
};

fs.writeFileSync(csPath, JSON.stringify(cs, null, 2), 'utf8');
console.log('Successfully updated custom-store-sync-orchestration.json with scope fetch node and wiring');

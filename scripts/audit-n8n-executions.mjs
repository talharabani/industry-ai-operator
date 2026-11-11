import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const envText = fs.readFileSync('.env.local', 'utf-8');
  let baseUrl = 'http://localhost:5678';
  let opKey = '';
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('N8N_BASE_URL=')) {
      baseUrl = trimmed.split('=')[1].trim().replace(/^['"]|['"]$/g, '');
    }
    if (trimmed.startsWith('N8N_OPERATOR_KEY=')) {
      opKey = trimmed.split('=')[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  console.log(`Checking n8n instance at ${baseUrl}...`);

  // Check n8n home directory / sqlite
  const homeDir = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\PC';
  const n8nDir = path.join(homeDir, '.n8n');
  console.log(`n8n home dir: ${n8nDir}, exists: ${fs.existsSync(n8nDir)}`);
  if (fs.existsSync(n8nDir)) {
    const files = fs.readdirSync(n8nDir);
    console.log(`Files in .n8n:`, files);
  }

  // 1. Try public/health endpoints
  try {
    const health = await fetch(`${baseUrl}/healthz`);
    console.log(`GET /healthz status: ${health.status}`);
  } catch (err) {
    console.log(`GET /healthz error: ${err.message}`);
  }

  // 2. Try API endpoints with opKey
  const headersList = [
    { name: 'X-N8N-API-KEY', val: opKey },
    { name: 'authorization', val: `Bearer ${opKey}` },
    { name: 'x-operator-key', val: opKey },
  ];

  for (const h of headersList) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/workflows`, {
        headers: { [h.name]: h.val },
      });
      console.log(`GET /api/v1/workflows with header ${h.name}: status ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        console.log(`Workflows count: ${data.data?.length}`);
        console.log(JSON.stringify(data.data?.map(w => ({ id: w.id, name: w.name, active: w.active })), null, 2));
      }
    } catch (e) {
      console.log(`Header ${h.name} failed: ${e.message}`);
    }
  }

  // 3. Try executions endpoint
  for (const h of headersList) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/executions?includeData=true&limit=20`, {
        headers: { [h.name]: h.val },
      });
      console.log(`GET /api/v1/executions with header ${h.name}: status ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        console.log(`Executions count: ${data.data?.length}`);
        console.log(JSON.stringify(data.data, null, 2));
        return;
      }
    } catch (e) {
      console.log(`Executions call with ${h.name} failed: ${e.message}`);
    }
  }
}

main().catch(console.error);

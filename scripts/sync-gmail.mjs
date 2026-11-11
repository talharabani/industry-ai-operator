import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read .env.local if available
let cronSecret = process.env.CRON_SECRET || process.env.N8N_OPERATOR_KEY || '';
let baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

try {
  const envContent = fs.readFileSync(join(__dirname, '../.env.local'), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('CRON_SECRET=')) {
      cronSecret = trimmed.replace(/^CRON_SECRET=/, '').replace(/^["']|["']$/g, '');
    } else if (trimmed.startsWith('N8N_OPERATOR_KEY=') && !cronSecret) {
      cronSecret = trimmed.replace(/^N8N_OPERATOR_KEY=/, '').replace(/^["']|["']$/g, '');
    } else if (trimmed.startsWith('NEXT_PUBLIC_APP_URL=')) {
      baseUrl = trimmed.replace(/^NEXT_PUBLIC_APP_URL=/, '').replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // ignore
}

async function runCronSync() {
  console.log(`[Gmail Sync Worker] Triggering authenticated sync against ${baseUrl}/api/cron/sync-gmail...`);

  const headers = {
    'Content-Type': 'application/json',
  };

  if (cronSecret && cronSecret !== '__n8n_BLANK_VALUE_e5362baf-c777-4d57-a609-6eaf1f9e87f6') {
    headers['Authorization'] = `Bearer ${cronSecret}`;
    headers['x-cron-key'] = cronSecret;
  }

  try {
    const res = await fetch(`${baseUrl}/api/cron/sync-gmail`, {
      method: 'POST',
      headers,
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[Gmail Sync Worker] HTTP Error:', res.status, data);
      process.exit(1);
    }
    console.log('[Gmail Sync Worker] Sync execution success:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[Gmail Sync Worker] Failed to run sync:', err);
    process.exit(1);
  }
}

runCronSync();

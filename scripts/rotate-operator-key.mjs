import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const envPath = path.join(process.cwd(), '.env.local');
const content = fs.readFileSync(envPath, 'utf8');

// Generate 32 bytes (64 hex chars)
const newKey = crypto.randomBytes(32).toString('hex');

const lines = content.split('\n');
const updatedLines = lines.map(line => {
  if (line.trim().startsWith('N8N_OPERATOR_KEY=')) {
    return `N8N_OPERATOR_KEY="${newKey}"`;
  }
  return line;
});

fs.writeFileSync(envPath, updatedLines.join('\n'), 'utf8');
console.log('N8N_OPERATOR_KEY updated with 32-byte random hex secret.');

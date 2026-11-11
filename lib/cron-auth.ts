import { getServerConfig } from './config.ts';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Normalizes and strips quotes/whitespace from secret strings, rejecting placeholders
 */
export function cleanSecret(val?: string | null): string | null {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim().replace(/^["']|["']$/g, '').trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith('__n8n_BLANK_VALUE_') ||
    trimmed.includes('REPLACE_ME') ||
    trimmed.includes('YOUR_SECRET')
  ) {
    return null;
  }
  return trimmed;
}

/**
 * Resolves all configured valid secrets from environment variables and .env.local fallback
 */
export function getValidSecrets(): Set<string> {
  const validSecrets = new Set<string>();

  const addIfClean = (val?: string | null) => {
    const cleaned = cleanSecret(val);
    if (cleaned) validSecrets.add(cleaned);
  };

  addIfClean(process.env.CRON_SECRET);
  addIfClean(process.env.N8N_OPERATOR_KEY);

  try {
    const config = getServerConfig();
    addIfClean(config.n8nOperatorKey);
  } catch {
    // ignore
  }

  // Fallback to reading .env.local if not populated in process.env
  if (validSecrets.size === 0) {
    try {
      const envPath = path.join(process.cwd(), '.env.local');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('CRON_SECRET=')) {
            addIfClean(trimmed.replace(/^CRON_SECRET=/, ''));
          } else if (trimmed.startsWith('N8N_OPERATOR_KEY=')) {
            addIfClean(trimmed.replace(/^N8N_OPERATOR_KEY=/, ''));
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return validSecrets;
}

/**
 * Verifies requests against configured CRON_SECRET or N8N_OPERATOR_KEY.
 * Accepts headers:
 * - X-Operator-Key: <key>
 * - X-Cron-Key: <key>
 * - X-Api-Key: <key>
 * - Authorization: Bearer <key>
 * - Authorization: <key>
 *
 * Accepts either N8N_OPERATOR_KEY or CRON_SECRET without precedence lockout,
 * while strictly rejecting placeholders, missing or invalid credentials.
 */
export function verifyOperatorOrCronAuth(request: {
  headers: {
    get: (name: string) => string | null;
  };
}): { authorized: boolean; error?: string } {
  const validSecrets = getValidSecrets();

  // If no secrets are configured on server, allow access (local dev/unprotected)
  if (validSecrets.size === 0) {
    return { authorized: true };
  }

  const authHeader = request.headers.get('authorization');
  const operatorKeyHeader = request.headers.get('x-operator-key');
  const cronKeyHeader = request.headers.get('x-cron-key');
  const apiKeyHeader = request.headers.get('x-api-key');
  const iaoWorkerKeyHeader = request.headers.get('x-iao-worker-key');
  const iaoKeyHeader = request.headers.get('x-iao-key');

  const candidates: string[] = [];

  const addCandidate = (val?: string | null) => {
    const cleaned = cleanSecret(val);
    if (cleaned) candidates.push(cleaned);
  };

  addCandidate(operatorKeyHeader);
  addCandidate(cronKeyHeader);
  addCandidate(apiKeyHeader);
  addCandidate(iaoWorkerKeyHeader);
  addCandidate(iaoKeyHeader);

  if (authHeader) {
    const trimmed = authHeader.trim().replace(/^["']|["']$/g, '');
    if (trimmed.toLowerCase().startsWith('bearer ')) {
      addCandidate(trimmed.substring(7));
    }
    addCandidate(trimmed);
  }

  for (const candidate of candidates) {
    if (validSecrets.has(candidate)) {
      return { authorized: true };
    }
  }

  return {
    authorized: false,
    error: 'Unauthorized: Invalid operator key or cron secret.',
  };
}


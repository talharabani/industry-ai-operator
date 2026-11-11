// Server-side configuration helper
// Resolves server-only secrets and IDs. Never import this into client components.
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFallback(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            env[key] = val;
          }
        }
      }
    }
  } catch {
    // Ignore error
  }
  return env;
}

let cachedEnvFallback: Record<string, string> | null = null;

export function getServerConfig() {
  if (!cachedEnvFallback) {
    cachedEnvFallback = loadEnvFallback();
  }

  const n8nBaseUrl = (process.env.N8N_BASE_URL || cachedEnvFallback['N8N_BASE_URL'] || 'http://localhost:5678').replace(/\/+$/, '');
  const n8nOperatorKey = process.env.N8N_OPERATOR_KEY || cachedEnvFallback['N8N_OPERATOR_KEY'] || '';
  const databaseUrl = process.env.DATABASE_URL || cachedEnvFallback['DATABASE_URL'] || '';
  const tenantId = process.env.DEMO_TENANT_ID || cachedEnvFallback['DEMO_TENANT_ID'] || 'demo-store';
  const approverId = process.env.DEMO_APPROVER_ID || cachedEnvFallback['DEMO_APPROVER_ID'] || 'owner-demo';
  const defaultTimezone = process.env.NEXT_PUBLIC_TIMEZONE || cachedEnvFallback['NEXT_PUBLIC_TIMEZONE'] || 'Asia/Karachi';

  return {
    n8nBaseUrl,
    n8nOperatorKey,
    databaseUrl,
    tenantId,
    approverId,
    defaultTimezone,
    isDatabaseConfigured: Boolean(databaseUrl && !databaseUrl.includes('REPLACE_ME')),
    isN8nConfigured: Boolean(n8nBaseUrl),
  };
}

export function parseDbConfig(connectionString: string) {
  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname || 'localhost';
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const sslMode = parsed.searchParams.get('sslmode');
    const requiresSsl =
      sslMode === 'require' ||
      sslMode === 'verify-full' ||
      sslMode === 'verify-ca' ||
      (!isLocal && sslMode !== 'disable');

    return {
      user: decodeURIComponent(parsed.username || 'iao_demo'),
      password: decodeURIComponent(parsed.password || ''),
      host,
      port: parseInt(parsed.port || '5432', 10),
      database: parsed.pathname.replace(/^\//, '') || 'iao_demo',
      ...(requiresSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    };
  } catch {
    return { connectionString };
  }
}

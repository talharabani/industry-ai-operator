import type { AuthSession, TeamMember, TeamRole, BusinessSummary, IndustryType } from './types.ts';
import { getServerConfig } from './config.ts';
import { query } from './db.ts';
import crypto from 'crypto';

export const SESSION_COOKIE_NAME = 'iao_session';

// Known default organizations for offline fallback or unseeded initial dev
export const SEED_BUSINESSES: BusinessSummary[] = [
  {
    tenant_id: 'demo-store',
    business_name: 'Demo Clothing Store',
    industry: 'ecommerce',
    role: 'owner',
    is_active: true,
  },
  {
    tenant_id: 'artisan-bakery',
    business_name: 'Artisan Fresh Bakery',
    industry: 'retail',
    role: 'owner',
    is_active: false,
  },
  {
    tenant_id: 'urban-tech',
    business_name: 'Urban Tech Gear',
    industry: 'ecommerce',
    role: 'owner',
    is_active: false,
  },
];

// Seed team members for the default demo store
export const DEFAULT_TEAM_MEMBERS: TeamMember[] = [
  {
    id: 'owner-demo',
    name: 'Store Owner (Demo)',
    email: 'owner@demo-store.com',
    role: 'owner',
    can_approve: true,
    title: 'Primary Business Owner',
    created_at: new Date('2026-09-01T00:00:00Z').toISOString(),
  },
  {
    id: 'admin-sarah',
    name: 'Sarah Jenkins',
    email: 'sarah.j@demo-store.com',
    role: 'admin',
    can_approve: true,
    title: 'Operations Manager',
    created_at: new Date('2026-09-15T00:00:00Z').toISOString(),
  },
  {
    id: 'agent-alex',
    name: 'Alex Rivera',
    email: 'alex.r@demo-store.com',
    role: 'member',
    can_approve: false,
    title: 'Support & Fulfillment Specialist',
    created_at: new Date('2026-10-01T00:00:00Z').toISOString(),
  },
];

async function fetchUserBusinessMemberships(userId: string, email: string) {
  try {
    const rows = await query<{
      tenant_id: string;
      business_name: string | null;
      industry: string | null;
      role: string;
      can_approve: boolean;
    }>(
      `SELECT bm.tenant_id, 
              COALESCE(b.settings->>'business_name', bm.tenant_id) as business_name,
              COALESCE(b.settings->>'industry', 'ecommerce') as industry,
              bm.role,
              bm.can_approve
       FROM iao.business_members bm
       LEFT JOIN iao.businesses b ON bm.tenant_id = b.tenant_id
       WHERE bm.user_id = $1 OR LOWER(bm.email) = LOWER($2)
       ORDER BY bm.created_at ASC;`,
      [userId, email]
    );
    return rows;
  } catch {
    return [];
  }
}

async function isTenantClaimedByOtherUser(tenantId: string, userId: string, email: string): Promise<boolean> {
  try {
    const rows = await query<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM iao.business_members 
       WHERE tenant_id = $1 AND user_id != $2 AND LOWER(email) != LOWER($3);`,
      [tenantId, userId, email]
    );
    const count = parseInt(rows[0]?.count || '0', 10);
    return count > 0;
  } catch {
    return false;
  }
}

/**
 * Checks if a specific user has authorized membership in a target workspace tenant.
 */
export async function verifyUserWorkspaceMembership(
  userId: string,
  email: string,
  tenantId: string
): Promise<{ authorized: boolean; role?: TeamRole; can_approve?: boolean; error?: string }> {
  try {
    const rows = await query<{ role: string; can_approve: boolean }>(
      `SELECT role, can_approve 
       FROM iao.business_members 
       WHERE tenant_id = $1 AND (user_id = $2 OR LOWER(email) = LOWER($3))
       LIMIT 1;`,
      [tenantId, userId, email]
    );

    if (rows.length > 0) {
      return {
        authorized: true,
        role: (rows[0].role as TeamRole) || 'member',
        can_approve: Boolean(rows[0].can_approve),
      };
    }

    // If no members are in DB for this tenant at all, check if tenant exists in iao.businesses
    const bizRows = await query<{ tenant_id: string; settings: any }>(
      `SELECT tenant_id, settings FROM iao.businesses WHERE tenant_id = $1 LIMIT 1;`,
      [tenantId]
    );

    if (bizRows.length === 0) {
      // Non-existent tenant, or ad-hoc test tenant without DB records
      return { authorized: false, error: `Workspace '${tenantId}' does not exist.` };
    }

    // If business has members registered in iao.business_members, then strict membership holds
    const memberCountRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM iao.business_members WHERE tenant_id = $1;`,
      [tenantId]
    );
    const memberCount = parseInt(memberCountRes[0]?.count || '0', 10);
    if (memberCount > 0) {
      // Tenant has registered members and this user is not one of them
      return {
        authorized: false,
        error: `Unauthorized: User '${email}' is not a registered member of workspace '${tenantId}'.`,
      };
    }

    return {
      authorized: false,
      error: `Unauthorized: User '${email}' is not a member of workspace '${tenantId}'.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Database membership verification error';
    return { authorized: false, error: msg };
  }
}

export function isSecureAuthMode(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.STAGING === 'true' ||
    process.env.DISABLE_DEMO_AUTH === 'true'
  );
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.CRON_SECRET;
  if (!secret) {
    if (isSecureAuthMode()) {
      throw new Error(
        'FATAL AUTH CONFIG ERROR: SESSION_SECRET is required in production/staging environment. Refusing to run in fail-open mode.'
      );
    }
    return 'iao-signing-secret-dev-fallback';
  }
  return secret;
}

function signSession(dataStr: string): string {
  const secret = getSessionSecret();
  return crypto.createHmac('sha256', secret).update(dataStr).digest('hex');
}

function verifySession(dataStr: string, signature?: string): boolean {
  if (!signature) return false;
  try {
    const expected = signSession(dataStr);
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Parses and verifies the authenticated session from cookies with server-side
 * tenant membership authorization. Never blindly trusts browser-supplied tenant_ids.
 */
export async function getAuthSession(): Promise<AuthSession> {
  const config = getServerConfig();
  const isSecureMode = isSecureAuthMode();

  let cookieStore: any = null;
  try {
    const nextHeaders = await import('next/headers');
    if (nextHeaders && typeof nextHeaders.cookies === 'function') {
      cookieStore = await nextHeaders.cookies();
    }
  } catch {
    // Outside Next.js runtime (e.g. test scripts or background workers)
    cookieStore = null;
  }

  const rawCookie = cookieStore?.get(SESSION_COOKIE_NAME)?.value;

  if (isSecureMode && !rawCookie) {
    return {
      user_id: '',
      user_name: 'Unauthenticated',
      email: '',
      role: 'member',
      active_tenant_id: '',
      businesses: [],
    };
  }

  let activeTenantId = isSecureMode ? '' : (config.tenantId || 'demo-store');
  let userId = isSecureMode ? '' : (config.approverId || 'owner-demo');
  let userName = isSecureMode ? 'Unauthenticated' : 'Store Owner (Demo)';
  let userEmail = isSecureMode ? '' : 'owner@demo-store.com';
  let userRole: TeamRole = isSecureMode ? 'member' : 'owner';

  if (rawCookie) {
    try {
      let dataB64 = rawCookie;
      let signature: string | undefined = undefined;

      if (rawCookie.includes('.')) {
        const parts = rawCookie.split('.');
        dataB64 = parts[0];
        signature = parts[1];
      }

      const isValidSignature = verifySession(dataB64, signature);

      if (isSecureMode && !isValidSignature) {
        // FORBIDDEN: Unsigned or forged session cookie rejected on staging/production
        return {
          user_id: '',
          user_name: 'Unauthenticated',
          email: '',
          role: 'member',
          active_tenant_id: '',
          businesses: [],
        };
      }

      const decoded = JSON.parse(Buffer.from(dataB64, 'base64').toString('utf-8'));
      if (decoded && typeof decoded.active_tenant_id === 'string' && decoded.active_tenant_id.trim()) {
        activeTenantId = decoded.active_tenant_id.trim();
      }
      if (decoded && typeof decoded.user_id === 'string') {
        userId = decoded.user_id;
        userName = decoded.user_name || userName;
        userEmail = decoded.email || userEmail;
        userRole = (decoded.role as TeamRole) || userRole;
      }
    } catch {
      // Invalid cookie or rejected signature
      if (isSecureMode) {
        return {
          user_id: '',
          user_name: 'Unauthenticated',
          email: '',
          role: 'member',
          active_tenant_id: '',
          businesses: [],
        };
      }
    }
  }

  // 1. Fetch user's registered business memberships from PostgreSQL
  const dbMemberships = await fetchUserBusinessMemberships(userId, userEmail);

  let businesses: BusinessSummary[] = [];

  if (dbMemberships.length > 0) {
    // Build authorized business list
    businesses = dbMemberships.map((m) => ({
      tenant_id: m.tenant_id,
      business_name: m.business_name || m.tenant_id,
      industry: (m.industry as IndustryType) || 'ecommerce',
      role: (m.role as TeamRole) || 'member',
      is_active: false,
    }));

    // Server-side tenant membership verification
    const activeMembership = dbMemberships.find((m) => m.tenant_id === activeTenantId);

    if (activeMembership) {
      // User is an authorized member of the requested tenant
      userRole = (activeMembership.role as TeamRole) || userRole;
    } else {
      // User is NOT a member of requested activeTenantId!
      // Check if this tenant belongs to someone else
      const claimedByOther = await isTenantClaimedByOtherUser(activeTenantId, userId, userEmail);
      if (claimedByOther) {
        // SECURITY GATE: Client-supplied tenant_id belongs to another organization!
        // Never trust the browser cookie; fallback to user's first authorized workspace
        activeTenantId = businesses.length > 0 ? businesses[0].tenant_id : '';
        userRole = businesses.length > 0 ? businesses[0].role : 'owner';
      } else if (activeTenantId && !isSecureMode) {
        // Ephemeral test tenant in dev only
        businesses.push({
          tenant_id: activeTenantId,
          business_name: activeTenantId.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
          industry: 'ecommerce',
          role: userRole,
          is_active: true,
        });
      }
    }
  } else {
    // No DB memberships found (new user, or DB is temporarily offline/unreachable)
    if (!isSecureMode) {
      // In development mode, provide SEED_BUSINESSES so the user is never locked out
      businesses = SEED_BUSINESSES.map((b) => ({
        ...b,
        is_active: b.tenant_id === activeTenantId,
      }));

      // Ensure activeTenantId defaults to a valid workspace
      if (!activeTenantId || !businesses.some((b) => b.tenant_id === activeTenantId)) {
        activeTenantId = businesses[0]?.tenant_id || 'demo-store';
      }
    } else {
      // Clean slate in strict secure/production mode
      businesses = [];
      activeTenantId = '';
    }
  }

  // Mark active business
  businesses = businesses.map((b) => ({
    ...b,
    is_active: b.tenant_id === activeTenantId,
  }));

  return {
    user_id: userId,
    user_name: userName,
    email: userEmail,
    role: userRole,
    active_tenant_id: activeTenantId,
    businesses,
  };
}

/**
 * Creates an encoded cookie value for persisting the active business and user session
 */
export function encodeSessionCookie(session: {
  active_tenant_id: string;
  user_id?: string;
  user_name?: string;
  email?: string;
  role?: TeamRole;
}): string {
  const payload = {
    active_tenant_id: session.active_tenant_id,
    user_id: session.user_id || 'owner-demo',
    user_name: session.user_name || 'Store Owner (Demo)',
    email: session.email || 'owner@demo-store.com',
    role: session.role || 'owner',
    timestamp: Date.now(),
  };

  const jsonStr = JSON.stringify(payload);
  const dataB64 = Buffer.from(jsonStr, 'utf-8').toString('base64');
  const signature = signSession(dataB64);
  return `${dataB64}.${signature}`;
}

/**
 * Server-side route helper enforcing workspace authorization.
 * Rejects requests if targetTenantId is not accessible by the authenticated user.
 */
export async function requireWorkspaceAccess(
  session: AuthSession,
  targetTenantId?: string
): Promise<{ authorized: boolean; tenantId: string; role: TeamRole; can_approve?: boolean; error?: string }> {
  let tenantId = targetTenantId ? targetTenantId.trim() : (session.active_tenant_id || '');

  // If tenantId is empty, try to resolve to the user's first available business
  if (!tenantId && session.businesses.length > 0) {
    tenantId = session.businesses[0].tenant_id;
  }

  // If in dev mode and still no tenantId, fall back to demo-store
  if (!tenantId && !isSecureAuthMode()) {
    tenantId = 'demo-store';
  }

  if (!tenantId) {
    return {
      authorized: false,
      tenantId: '',
      role: session.role,
      error: `No workspace selected. Please complete onboarding or switch to an active workspace.`,
    };
  }

  // If target matches active tenant, check session
  if (tenantId === session.active_tenant_id || (!isSecureAuthMode() && tenantId === 'demo-store')) {
    const isMember = session.businesses.some((b) => b.tenant_id === tenantId);
    if (!isMember && isSecureAuthMode()) {
      return {
        authorized: false,
        tenantId,
        role: session.role,
        error: `Forbidden: User '${session.email}' does not have membership in workspace '${tenantId}'.`,
      };
    }
    return {
      authorized: true,
      tenantId,
      role: session.role,
      can_approve: session.role === 'owner' || session.role === 'admin',
    };
  }

  // If different target tenant requested, verify membership explicitly
  const verification = await verifyUserWorkspaceMembership(session.user_id, session.email, tenantId);
  if (!verification.authorized) {
    return {
      authorized: false,
      tenantId,
      role: session.role,
      error: `Forbidden: User '${session.email}' does not have membership in workspace '${tenantId}'.`,
    };
  }

  return {
    authorized: true,
    tenantId,
    role: verification.role || 'member',
    can_approve: verification.can_approve ?? (verification.role === 'owner' || verification.role === 'admin'),
  };
}

export { verifyOperatorOrCronAuth } from './cron-auth.ts';

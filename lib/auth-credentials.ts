import crypto from 'crypto';
import { query } from './db.ts';

export interface UserCredentialRecord {
  user_id: string;
  email: string;
  password_hash: string;
  salt: string;
  created_at: string;
  updated_at: string;
}

let tableEnsured = false;

export async function ensureUserCredentialsTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS iao.user_credentials (
        user_id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_user_credentials_email ON iao.user_credentials(LOWER(email));
    `);
    tableEnsured = true;
  } catch (err) {
    console.error('Failed to ensure user_credentials table:', err);
    throw err;
  }
}

export function hashPassword(password: string, existingSalt?: string): { hash: string; salt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  // Use crypto.scryptSync for secure cryptographic key derivation
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, storedHash: string, salt: string): boolean {
  try {
    const computedHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

export async function userCredentialExists(email: string): Promise<boolean> {
  await ensureUserCredentialsTable();
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM iao.user_credentials WHERE LOWER(email) = LOWER($1);`,
    [email.trim()]
  );
  return parseInt(rows[0]?.count || '0', 10) > 0;
}

export async function registerUserCredential(
  userId: string,
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  await ensureUserCredentialsTable();

  const cleanEmail = email.trim().toLowerCase();
  if (await userCredentialExists(cleanEmail)) {
    return { success: false, error: 'An account with this email address already exists. Please log in.' };
  }

  if (!password || password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters long.' };
  }

  const { hash, salt } = hashPassword(password);

  await query(
    `INSERT INTO iao.user_credentials (user_id, email, password_hash, salt, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (email) DO UPDATE 
     SET password_hash = EXCLUDED.password_hash, salt = EXCLUDED.salt, updated_at = NOW();`,
    [userId, cleanEmail, hash, salt]
  );

  return { success: true };
}

export async function verifyUserCredential(
  email: string,
  password: string
): Promise<{
  success: boolean;
  user?: { user_id: string; email: string };
  error?: string;
}> {
  await ensureUserCredentialsTable();

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !password) {
    return { success: false, error: 'Email and password are required.' };
  }

  const rows = await query<UserCredentialRecord>(
    `SELECT user_id, email, password_hash, salt 
     FROM iao.user_credentials 
     WHERE LOWER(email) = LOWER($1) 
     LIMIT 1;`,
    [cleanEmail]
  );

  if (rows.length === 0) {
    return { success: false, error: 'Invalid email or password.' };
  }

  const record = rows[0];
  const isMatch = verifyPassword(password, record.password_hash, record.salt);

  if (!isMatch) {
    return { success: false, error: 'Invalid email or password.' };
  }

  return {
    success: true,
    user: {
      user_id: record.user_id,
      email: record.email,
    },
  };
}

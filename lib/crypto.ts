import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Resolves the 32-byte encryption key for tenant credential storage.
 * Requires EMAIL_ENCRYPTION_KEY from environment.
 * Automatic/random fallback has been strictly removed.
 */
export function isEncryptionKeyConfigured(): boolean {
  const envKey = process.env.EMAIL_ENCRYPTION_KEY;
  if (!envKey || typeof envKey !== 'string') return false;
  const trimmed = envKey.trim();
  return trimmed.length >= 32;
}

export function getMasterEncryptionKey(): Buffer {
  const envKey = process.env.EMAIL_ENCRYPTION_KEY;
  if (!envKey || typeof envKey !== 'string' || envKey.trim().length === 0) {
    throw new Error(
      'Server configuration error: EMAIL_ENCRYPTION_KEY is required for credential storage and live email operations. Please set EMAIL_ENCRYPTION_KEY in .env.local.'
    );
  }

  const trimmed = envKey.trim();
  if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  if (trimmed.length < 32) {
    throw new Error(
      'Server configuration error: EMAIL_ENCRYPTION_KEY must be at least 32 characters or a 64-character hex string (32 bytes).'
    );
  }

  return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
}

/**
 * Encrypts a plaintext string (e.g. Resend API Key) using AES-256-GCM.
 * Output format: "iv_hex:auth_tag_hex:ciphertext_hex"
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return '';
  const key = getMasterEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted ciphertext.
 * Expects format: "iv_hex:auth_tag_hex:ciphertext_hex"
 */
export function decryptSecret(encryptedPayload: string): string {
  if (!encryptedPayload) return '';
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getMasterEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Generates a safe masked fingerprint for UI display.
 * Example: "re_1234567890abcdef" -> "re_••••••••cdef"
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 8) return '••••••••';
  const prefix = apiKey.startsWith('re_') ? 're_' : apiKey.slice(0, 3);
  const lastFour = apiKey.slice(-4);
  return `${prefix}••••••••${lastFour}`;
}

/**
 * Generates SHA-256 hash of a string (used for body hash validation in outbox).
 */
export function computeSha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

import dns from 'dns';
import net from 'net';

/**
 * Checks if an IPv4 or IPv6 address belongs to a private, loopback, or link-local range.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (!net.isIP(ip)) {
    return false;
  }

  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    const [b0, b1] = parts;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;

    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;

    // 10.0.0.0/8 (Private network)
    if (b0 === 10) return true;

    // 172.16.0.0/12 (Private network: 172.16.0.0 - 172.31.255.255)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

    // 192.168.0.0/16 (Private network)
    if (b0 === 192 && b1 === 168) return true;

    // 169.254.0.0/16 (Link-local / Cloud metadata: 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;

    // 100.64.0.0/10 (Shared address space / CGNAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

    // 224.0.0.0/4 (Multicast)
    if (b0 >= 224 && b0 <= 239) return true;

    // 240.0.0.0/4 (Reserved)
    if (b0 >= 240) return true;

    return false;
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // ::1 (Loopback)
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    // :: (Unspecified)
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;
    // fe80::/10 (Link-local)
    if (normalized.startsWith('fe80:') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    // fc00::/7 (Unique local)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1, etc.)
    if (normalized.includes('::ffff:')) {
      const v4Part = normalized.split('::ffff:')[1];
      if (v4Part && net.isIPv4(v4Part)) {
        return isPrivateOrReservedIp(v4Part);
      }
    }
    return false;
  }

  return false;
}

export interface ValidateUrlResult {
  isValid: boolean;
  error?: string;
  resolvedIp?: string;
  sanitizedUrl?: string;
}

/**
 * Validates an outbound URL to prevent Server-Side Request Forgery (SSRF).
 * Allows localhost/127.0.0.1 ONLY if allowLocalDevelopment is true
 * (e.g. process.env.ALLOW_LOCAL_CONNECTOR === 'true' or NODE_ENV !== 'production').
 */
export async function validateOutboundUrl(
  urlString: string,
  options: { allowLocalDevelopment?: boolean } = {}
): Promise<ValidateUrlResult> {
  const allowDev =
    options.allowLocalDevelopment ??
    (process.env.ALLOW_LOCAL_CONNECTOR === 'true' || process.env.NODE_ENV === 'development');

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { isValid: false, error: 'Invalid URL format' };
  }

  // 1. Enforce HTTPS in production; allow HTTP only in explicit local dev
  if (parsed.protocol !== 'https:') {
    if (parsed.protocol !== 'http:') {
      return { isValid: false, error: `Unsupported protocol "${parsed.protocol}". Only HTTPS is permitted.` };
    }
    if (!allowDev) {
      return { isValid: false, error: 'Insecure HTTP protocol is not permitted for remote connections. HTTPS is required.' };
    }
  }

  // 2. Reject credentials embedded in URL
  if (parsed.username || parsed.password) {
    return { isValid: false, error: 'User credentials must not be embedded directly in the URL.' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 3. Check for obvious localhost / cloud metadata strings
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname === 'instance-data') {
    return { isValid: false, error: 'Access to cloud instance metadata services is strictly prohibited.' };
  }

  // 4. Handle development allowlist for local demo endpoints
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (isLocalHost) {
    if (allowDev) {
      return { isValid: true, resolvedIp: '127.0.0.1', sanitizedUrl: parsed.toString() };
    }
    return { isValid: false, error: 'Localhost and loopback addresses are blocked in production.' };
  }

  // 5. DNS Resolution & IP Range Verification
  try {
    const lookupResults = await dns.promises.lookup(hostname, { all: true });
    if (!lookupResults || lookupResults.length === 0) {
      return { isValid: false, error: `Could not resolve hostname "${hostname}".` };
    }

    for (const record of lookupResults) {
      if (isPrivateOrReservedIp(record.address)) {
        if (allowDev && (record.address === '127.0.0.1' || record.address === '::1')) {
          continue;
        }
        return {
          isValid: false,
          error: `Access to private or reserved IP address (${record.address}) is forbidden.`,
          resolvedIp: record.address,
        };
      }
    }

    return {
      isValid: true,
      resolvedIp: lookupResults[0].address,
      sanitizedUrl: parsed.toString(),
    };
  } catch (dnsErr) {
    const msg = dnsErr instanceof Error ? dnsErr.message : String(dnsErr);
    return { isValid: false, error: `DNS resolution failed for "${hostname}": ${msg}` };
  }
}

/**
 * Executes a network fetch with SSRF validation, safe redirect handling (max 3 hops),
 * and credential protection (strips Authorization/API-keys on cross-origin redirects).
 */
export async function safeFetch(
  initialUrl: string,
  init: RequestInit = {},
  options: { maxRedirects?: number; timeoutMs?: number; allowLocalDevelopment?: boolean } = {}
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 15000;
  let currentUrl = initialUrl;
  let redirectCount = 0;
  const originalOrigin = new URL(initialUrl).origin;

  let currentHeaders: Record<string, string> = {};
  if (init.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        currentHeaders[key] = value;
      });
    } else if (Array.isArray(init.headers)) {
      init.headers.forEach(([k, v]) => {
        currentHeaders[k] = v;
      });
    } else {
      currentHeaders = { ...init.headers } as Record<string, string>;
    }
  }

  while (redirectCount <= maxRedirects) {
    const validation = await validateOutboundUrl(currentUrl, options);
    if (!validation.isValid) {
      throw new Error(`SSRF Validation Failed for ${currentUrl}: ${validation.error}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(currentUrl, {
        ...init,
        headers: currentHeaders,
        redirect: 'manual',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle Redirects
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          throw new Error(`Too many redirects (exceeded limit of ${maxRedirects}).`);
        }

        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Received HTTP ${response.status} redirect without Location header.`);
        }

        const nextUrl = new URL(location, currentUrl).toString();
        const nextOrigin = new URL(nextUrl).origin;

        // Security requirement: Never forward credentials across origins
        if (nextOrigin !== originalOrigin) {
          delete currentHeaders['authorization'];
          delete currentHeaders['Authorization'];
          delete currentHeaders['x-api-key'];
          delete currentHeaders['X-API-Key'];
        }

        currentUrl = nextUrl;
        continue;
      }

      return response;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs}ms to ${currentUrl}`);
      }
      throw err;
    }
  }

  throw new Error(`Exceeded maximum redirect count of ${maxRedirects}.`);
}

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type GuardOptions = { allowPrivate: boolean };

/**
 * Schemes a rendered page may load. Anything else — `file:`, `ftp:`, `ws:`,
 * `javascript:` — is refused. A negative scheme test would let every
 * non-http scheme through, which is how `file://` local-disk reads reached
 * the rendered PDF.
 */
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'data:', 'about:']);

/** Schemes that carry no network capability and never resolve a hostname. */
const NETWORKLESS_SCHEMES = new Set(['data:', 'about:']);

function normalizeHost(value: string): string {
  return value.replace(/^\[|\]$/gu, '').toLowerCase();
}

export function isPrivateIp(value: string): boolean {
  const normalized = normalizeHost(value);
  const kind = isIP(normalized);
  if (kind === 4) {
    const parts = normalized.split('.').map(Number);
    const [first = -1, second = -1] = parts;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  if (kind === 6) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/u.test(normalized) ||
      normalized.startsWith('::ffff:')
    );
  }
  return false;
}

function refusesHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || isPrivateIp(hostname);
}

/**
 * Returns the URL when the capture target is permitted, or `undefined` when it
 * is refused. Every DNS answer for the hostname must be public.
 */
export async function allowedUrl(value: string, options: GuardOptions): Promise<URL | undefined> {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    if (options.allowPrivate) return url;
    if (refusesHost(normalizeHost(url.hostname))) return undefined;
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.some(({ address }) => isPrivateIp(address))) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

/**
 * Gate for a request the headless browser is about to make.
 *
 * This is deliberately re-resolving DNS rather than reusing the `allowedUrl`
 * result from the pre-flight check: a hostname can resolve to a public address
 * for that check and to a private one for the navigation. Playwright's
 * catch-all page.route glob intercepts the top-frame document request as well
 * as subresources, so running the check here closes that window for both.
 *
 * Residual risk: this narrows the window to a per-request DNS race rather than
 * eliminating it. A hostile resolver with a sub-second TTL can still return a
 * different answer to this lookup than to Chromium's own resolver moments
 * later. Eliminating that requires connecting Chromium to the exact address
 * validated here, which is a larger change — see the P7-06 note in PLAN.md.
 */
export async function isPermittedRequest(value: string, options: GuardOptions): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) return false;
  if (options.allowPrivate) return true;
  if (NETWORKLESS_SCHEMES.has(url.protocol)) return true;
  if (refusesHost(normalizeHost(url.hostname))) return false;
  try {
    const addresses = await lookup(url.hostname, { all: true });
    return !addresses.some(({ address }) => isPrivateIp(address));
  } catch {
    return false;
  }
}

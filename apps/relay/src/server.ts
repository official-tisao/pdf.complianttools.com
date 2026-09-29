import { createServer, type IncomingMessage, type Server } from 'node:http';
import { chromium } from 'playwright';
import { allowedUrl, isPermittedRequest, type GuardOptions } from './guard.js';

export type RelayOptions = GuardOptions & {
  /** Injectable so the HTTP surface can be tested without a browser installed. */
  readonly launch?: typeof chromium.launch;
  /** Origins permitted to call the Relay from a browser. Defaults to the app's own origins. */
  readonly allowedOrigins?: readonly string[];
};

/**
 * The main app is served from the production domain, and local development runs
 * the Vite dev/preview server on loopback. Those are the only origins that need
 * to reach a Relay, so they are the default allow-list.
 */
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://pdf.complianttools.com',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
] as const;

/** Parses RELAY_ALLOWED_ORIGINS; an empty or absent value keeps the defaults. */
export function parseAllowedOrigins(value: string | undefined): string[] {
  const parsed = (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_ALLOWED_ORIGINS];
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * The browser posts to the Relay cross-origin, and a JSON POST triggers a
 * preflight, so without these headers the browser blocks the request before the
 * Relay ever sees it and the user gets a generic network error instead of a
 * remedy. `Vary: Origin` keeps a shared cache from serving one origin's
 * allowance to another.
 */
function corsHeaders(request: IncomingMessage, options: RelayOptions): Record<string, string> {
  const headers: Record<string, string> = { vary: 'Origin' };
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !origin) return headers;
  const allowed = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  if (allowed.includes('*')) headers['access-control-allow-origin'] = '*';
  else if (allowed.includes(origin)) headers['access-control-allow-origin'] = origin;
  return headers;
}

/**
 * Builds the Relay without binding a port, so tests can import it, drive the
 * HTTP surface, and close it again. `index.ts` owns the `listen()` call.
 */
export function createRelayServer(options: RelayOptions): Server {
  // Call through the `chromium` module rather than detaching `launch`, which
  // would drop the receiver the Playwright client needs.
  const launch = options.launch ?? ((init) => chromium.launch(init));

  return createServer(async (request, response) => {
    const cors = corsHeaders(request, options);
    if (request.method === 'OPTIONS' && request.url === '/render') {
      response.writeHead(204, {
        ...cors,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      });
      response.end();
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { ...cors, 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          ok: true,
          mode: 'self-hosted-relay',
          privateNetwork: options.allowPrivate,
        }),
      );
      return;
    }
    if (request.method !== 'POST' || request.url !== '/render') {
      response.writeHead(404, { ...cors, 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: 'not-found',
          remedy: 'POST {"url":"https://example.com"} to /render.',
        }),
      );
      return;
    }
    try {
      const body = (await readJson(request)) as { url?: string };
      const url = body.url ? await allowedUrl(body.url, options) : undefined;
      if (!url) {
        response.writeHead(400, { ...cors, 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            error: 'invalid-url',
            remedy:
              'Use a public http or https URL. Set RELAY_ALLOW_PRIVATE_NETWORK=1 only when private capture is intentional.',
          }),
        );
        return;
      }
      const browser = await launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.route('**/*', async (route) => {
          const target = route.request().url();
          if (await isPermittedRequest(target, options)) {
            await route.continue();
          } else {
            console.warn(`Relay blocked a request the SSRF guard refused: ${target}`);
            await route.abort('blockedbyclient');
          }
        });
        await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 30_000 });
        const bytes = await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
        });
        response.writeHead(200, {
          ...cors,
          'content-type': 'application/pdf',
          'cache-control': 'no-store',
        });
        response.end(bytes);
      } finally {
        await browser.close();
      }
    } catch (error) {
      response.writeHead(503, { ...cors, 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: 'relay-failed',
          cause: error instanceof Error ? error.message : 'Headless browser unavailable',
          remedy: 'Install the pinned Playwright browser for this self-hosted Relay and retry.',
        }),
      );
    }
  });
}

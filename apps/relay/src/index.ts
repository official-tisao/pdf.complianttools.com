import { createServer, type IncomingMessage } from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { chromium } from 'playwright';

const port = Number(process.env.PORT ?? 8787);
const allowPrivate = process.env.RELAY_ALLOW_PRIVATE_NETWORK === '1';

function isPrivateIp(value: string): boolean {
  const normalized = value.replace(/^\[|\]$/gu, '').toLowerCase();
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

async function allowedUrl(value: string): Promise<URL | undefined> {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    if (allowPrivate) return url;
    const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || isPrivateIp(hostname))
      return undefined;
    const addresses = await lookup(hostname, { all: true });
    if (addresses.some(({ address }) => isPrivateIp(address))) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({ ok: true, mode: 'self-hosted-relay', privateNetwork: allowPrivate }),
    );
    return;
  }
  if (request.method !== 'POST' || request.url !== '/render') {
    response.writeHead(404, { 'content-type': 'application/json' });
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
    const url = body.url ? await allowedUrl(body.url) : undefined;
    if (!url) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: 'invalid-url',
          remedy:
            'Use a public http or https URL. Set RELAY_ALLOW_PRIVATE_NETWORK=1 only when private capture is intentional.',
        }),
      );
      return;
    }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route('**/*', async (route) => {
        const requestUrl = route.request().url();
        if (!/^https?:/u.test(requestUrl) || (await allowedUrl(requestUrl))) {
          await route.continue();
        } else {
          await route.abort('blockedbyclient');
        }
      });
      await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: 30_000 });
      const bytes = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
      });
      response.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' });
      response.end(bytes);
    } finally {
      await browser.close();
    }
  } catch (error) {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: 'relay-failed',
        cause: error instanceof Error ? error.message : 'Headless browser unavailable',
        remedy: 'Install the pinned Playwright browser for this self-hosted Relay and retry.',
      }),
    );
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Relay listening on http://127.0.0.1:${port}`));

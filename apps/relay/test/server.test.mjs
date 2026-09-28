import assert from 'node:assert/strict';
import test from 'node:test';
import { createRelayServer, DEFAULT_ALLOWED_ORIGINS, parseAllowedOrigins } from '../dist/server.js';

/** Stands in for chromium so the HTTP surface can be tested with no browser installed. */
const noBrowser = async () => {
  throw new Error('browser unavailable in this test');
};

async function withServer(options, run) {
  const server = createRelayServer({ launch: noBrowser, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** The preflight a browser sends before a cross-origin JSON POST. */
function preflight(base, origin) {
  return fetch(`${base}/render`, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
}

test('health reports the active private-network mode', async () => {
  await withServer({ allowPrivate: true }, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      mode: 'self-hosted-relay',
      privateNetwork: true,
    });
  });
});

test('health reports private capture as disabled by default', async () => {
  await withServer({ allowPrivate: false }, async (base) => {
    const body = await (await fetch(`${base}/health`)).json();
    assert.equal(body.privateNetwork, false);
  });
});

test('unknown routes return a typed not-found remedy', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/nope`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'not-found');
    assert.match(body.remedy, /POST .* to \/render/u);
  });
});

test('render refuses a private target when private capture is not enabled', async () => {
  await withServer({ allowPrivate: false }, async (base) => {
    const response = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:1/x' }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'invalid-url');
    assert.match(body.remedy, /public http or https URL/u);
  });
});

test('render refuses a non-http target even when private capture is enabled', async () => {
  await withServer({ allowPrivate: true }, async (base) => {
    const response = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'file:///etc/passwd' }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'invalid-url');
  });
});

test('render refuses a request with no url', async () => {
  await withServer({ allowPrivate: true }, async (base) => {
    const response = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'invalid-url');
  });
});

test('render surfaces a typed remedy when the headless browser is missing', async () => {
  await withServer({ allowPrivate: true }, async (base) => {
    const response = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://relay-guard-probe.invalid/' }),
    });
    // The stub browser throws, which is the same path a missing Playwright
    // browser binary takes. The client relies on this remedy to tell the user
    // what to do, so the exact text is asserted.
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'relay-failed');
    assert.match(body.remedy, /Install the pinned Playwright browser/u);
  });
});

test('a preflight from the app origin is allowed', async () => {
  // Without this the browser blocks the POST before the Relay runs, and the
  // user sees a generic network error instead of the Relay's remedy.
  await withServer({}, async (base) => {
    const response = await preflight(base, 'http://127.0.0.1:4173');
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4173');
    assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
    assert.equal(response.headers.get('access-control-allow-headers'), 'content-type');
    assert.equal(response.headers.get('vary'), 'Origin');
  });
});

test('a preflight from an unlisted origin is not granted access', async () => {
  // A Relay on loopback must not be drivable by any page the user happens to
  // visit, so an unlisted origin gets no allow-origin header at all.
  await withServer({}, async (base) => {
    const response = await preflight(base, 'https://evil.example');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});

test('render responses carry the allow-origin header for a permitted origin', async () => {
  await withServer({ allowPrivate: false }, async (base) => {
    const response = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://pdf.complianttools.com' },
      body: JSON.stringify({ url: 'http://127.0.0.1:1/x' }),
    });
    assert.equal(response.status, 400);
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      'https://pdf.complianttools.com',
    );
  });
});

test('render omits the allow-origin header for an unlisted origin', async () => {
  await withServer({ allowPrivate: false }, async (base) => {
    const response = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ url: 'http://127.0.0.1:1/x' }),
    });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});

test('an explicit wildcard allow-list grants any origin', async () => {
  await withServer({ allowedOrigins: ['*'] }, async (base) => {
    const response = await preflight(base, 'https://anywhere.example');
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  });
});

test('parseAllowedOrigins reads a comma-separated list and ignores blanks', () => {
  assert.deepEqual(parseAllowedOrigins('http://a.test, ,http://b.test'), [
    'http://a.test',
    'http://b.test',
  ]);
});

test('parseAllowedOrigins falls back to the app defaults when unset or blank', () => {
  assert.deepEqual(parseAllowedOrigins(undefined), [...DEFAULT_ALLOWED_ORIGINS]);
  assert.deepEqual(parseAllowedOrigins('  '), [...DEFAULT_ALLOWED_ORIGINS]);
});

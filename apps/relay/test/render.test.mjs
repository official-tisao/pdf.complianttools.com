import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RELAY_ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));

// Synthetic fixture, inline so no file enters fixtures/ and no PROVENANCE row
// is required. No external subresources, so `networkidle` settles immediately.
const FIXTURE_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Relay render fixture</title>
<style>@page { size: A4; margin: 18mm; } body { font-family: sans-serif; }</style></head>
<body><h1>Relay render fixture</h1><p>Synthetic page; contains no user data.</p>
<div style="page-break-after: always;">Page one body.</div>
<div>Page two body.</div></body></html>`;

function chromiumAvailable() {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

async function reservePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForHealth(base, child) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Relay exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Relay did not report healthy within 15s.');
}

/**
 * Spawns the Relay exactly as a user would run it, with the opt-in needed to
 * capture the loopback fixture. Returns the base URL and the child handle.
 */
async function startRelay() {
  const port = await reservePort();
  const child = spawn(process.execPath, [RELAY_ENTRY], {
    env: { ...process.env, PORT: String(port), RELAY_ALLOW_PRIVATE_NETWORK: '1' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base, child);
  return { base, child };
}

async function startFixture() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(FIXTURE_PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

test('Relay renders a real page to a valid multi-page PDF', async (t) => {
  if (!chromiumAvailable()) {
    t.skip('Playwright chromium is not installed for this run.');
    return;
  }

  const fixture = await startFixture();
  const { base, child } = await startRelay();
  try {
    const response = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: fixture.url }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('cache-control'), 'no-store');

    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(new TextDecoder('latin1').decode(bytes.slice(0, 5)), '%PDF-');
    const pages = new TextDecoder('latin1').decode(bytes).match(/\/Type\s*\/Page[^s]/gu) ?? [];
    assert.equal(pages.length, 2);
  } finally {
    child.kill();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});

test('Relay refuses a local-disk subresource instead of embedding it', async (t) => {
  if (!chromiumAvailable()) {
    t.skip('Playwright chromium is not installed for this run.');
    return;
  }

  // The page requests a file:// resource. The guard must abort it, and the
  // render must still succeed without the file's contents.
  const page = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      '<!doctype html><html><body><h1>Subresource probe</h1>' +
        '<img src="file:///C:/Windows/win.ini" alt="local"></body></html>',
    );
  });
  await new Promise((resolve) => page.listen(0, '127.0.0.1', resolve));
  const { base, child } = await startRelay();
  try {
    const response = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `http://127.0.0.1:${page.address().port}/` }),
    });
    assert.equal(response.status, 200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(new TextDecoder('latin1').decode(bytes.slice(0, 5)), '%PDF-');
    // The local file's contents must not appear anywhere in the output.
    assert.equal(new TextDecoder('latin1').decode(bytes).includes('extensions'), false);
  } finally {
    child.kill();
    await new Promise((resolve) => page.close(resolve));
  }
});

test('a real browser page can drive the Relay cross-origin', async (t) => {
  if (!chromiumAvailable()) {
    t.skip('Playwright chromium is not installed for this run.');
    return;
  }

  // The capture path only exists in a browser, where the app on one origin
  // posts JSON to a Relay on another. Without CORS the browser drops the
  // request and the user sees "Failed to fetch" instead of a remedy, so this
  // drives it from an actual page rather than from Node.
  const fixture = await startFixture();
  const { base, child } = await startRelay();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    const outcome = await page.evaluate(
      async ({ relay, target }) => {
        try {
          const response = await fetch(`${relay}/render`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: target }),
          });
          const bytes = new Uint8Array(await response.arrayBuffer());
          return {
            status: response.status,
            type: response.headers.get('content-type'),
            magic: new TextDecoder('latin1').decode(bytes.slice(0, 5)),
          };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
      { relay: base, target: fixture.url },
    );
    assert.equal(outcome.error, undefined, `cross-origin capture failed: ${outcome.error}`);
    assert.equal(outcome.status, 200);
    assert.equal(outcome.type, 'application/pdf');
    assert.equal(outcome.magic, '%PDF-');
  } finally {
    await browser.close();
    child.kill();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});

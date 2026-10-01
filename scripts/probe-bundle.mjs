/**
 * Temporary diagnostic: list every .js a route actually fetches, with gzipped sizes.
 * Not a gate. Used to attribute a budget regression to a specific chunk.
 * Usage: node scripts/probe-bundle.mjs /route [/route2 ...]
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const PORT = 4188;
const BASE = `http://127.0.0.1:${PORT}`;
const routes = process.argv.slice(2);

const serve = spawn(
  'pnpm',
  ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT)],
  { cwd: resolve('apps/web'), stdio: 'ignore', shell: true },
);
const stop = () => {
  if (!serve.killed) serve.kill();
};
process.on('exit', stop);

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('the preview server did not start');
}

await waitForServer();
const browser = await chromium.launch();
for (const route of routes) {
  const page = await browser.newPage();
  /** @type {Array<[string, number]>} */
  const files = [];
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (!url.pathname.endsWith('.js') || url.pathname.includes('/@')) return;
    if (response.status() !== 200) return;
    try {
      files.push([url.pathname.split('/').pop(), gzipSync(await response.body()).length]);
    } catch {
      /* unreadable response is not billed */
    }
  });
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.close();
  const total = files.reduce((sum, [, bytes]) => sum + bytes, 0);
  console.log(`\n${route}  ${Math.round(total / 1024)} KB gzip, ${files.length} files`);
  for (const [name, bytes] of files.sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`   ${String(Math.round(bytes / 1024)).padStart(5)} KB  ${name}`);
  }
}
await browser.close();
stop();

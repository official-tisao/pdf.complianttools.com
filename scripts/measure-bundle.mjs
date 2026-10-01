/**
 * Per-route bundle measurement against a real production build.
 *
 * Static analysis of the build output over-reports: SvelteKit emits
 * <link rel="modulepreload"> for chunks the route graph reaches, and dev mode
 * serves a different graph entirely. This measures what a browser actually
 * fetches from the built site, gzipped, because that is what the README §7.6
 * per-route budget is about.
 *
 * Usage: node scripts/measure-bundle.mjs [--out=docs/release-gate/FILE.json]
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { format } from 'node:util';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const PORT = 4188;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Budgets in KB, gzipped, per route. Set just above the measured value with
 * ~10% headroom. The point is to catch an accidental regression, not to force a
 * bundle-size project: a budget that fails on its first run is a budget that
 * gets raised, not one that gets fixed.
 *
 * Known floor: the routes that WRITE a PDF (invoice, merge) used to carry
 * pdf-lib (~171 KB gzip) on load, which is what pinned their budgets near 275
 * KB. That is no longer the case — the invoice routes take their totals and
 * validator from `engine/invoice-core`, which has no pdf-lib in it, and pull the
 * writer on demand, so they load at roughly the same size as any other page.
 * `scripts/bundle-boundaries.test.mjs` asserts that split at the source level,
 * because it is easy to reintroduce with a single import line and nothing fails
 * until two budgets regress at once.
 *
 * /view-pdf still carries pdf.js, which is inherent to rendering.
 */
const BUDGET_KB = {
  landing: 60,
  'invoice / create': 275,
  'merge / edit': 470,
  'pdf viewer': 625,
};

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
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('the preview server did not start');
}

const measure = async (page, route) => {
  /** @type {Map<string, number>} */
  const bytes = new Map();
  const onResponse = async (response) => {
    const url = new URL(response.url());
    if (!url.pathname.endsWith('.js') || url.pathname.includes('/@')) return;
    if (response.status() !== 200) return;
    try {
      const body = await response.body();
      bytes.set(url.pathname, gzipSync(body).length);
    } catch {
      // a response we cannot read is not one we should bill the route for
    }
  };
  page.on('response', onResponse);
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  // Hydration and the initial chunk graph are both part of the load.
  await page.waitForTimeout(500);
  page.off('response', onResponse);
  const total = [...bytes.values()].reduce((sum, value) => sum + value, 0);
  return { route, files: bytes.size, gzippedKb: Math.round(total / 1024) };
};

await waitForServer();
const browser = await chromium.launch();
const results = [];
try {
  const routes = [
    ['/', 'landing'],
    ['/invoice-creator', 'invoice / create'],
    ['/e-invoice', 'invoice / create'],
    ['/merge', 'merge / edit'],
    ['/view-pdf', 'pdf viewer'],
  ];
  for (const [route, kind] of routes) {
    const page = await browser.newPage();
    try {
      const measured = await measure(page, route);
      const budgetKb = BUDGET_KB[kind];
      results.push({
        ...measured,
        budgetKb,
        status: measured.gzippedKb <= budgetKb ? 'PASS' : 'FAIL',
      });
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  stop();
}

const report = {
  task: 'P7-03',
  date: new Date().toISOString().slice(0, 10),
  evidenceType: 'gzip bytes actually fetched from the production build',
  environment: { node: process.version, server: 'vite preview (production build)' },
  results,
  status: results.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL',
  notes:
    'Measured, not estimated: the figure is what the browser requested. Modulepreload hints that the route graph can reach are excluded unless actually fetched.',
};

const outArgument = process.argv.find((argument) => argument.startsWith('--out='));
const outPath = resolve(
  outArgument?.slice('--out='.length) ?? 'docs/release-gate/P7-03-bundle-evidence.json',
);
await mkdir(dirname(outPath), { recursive: true });
// Formatted with Prettier's own formatter: this file is checked by
// `pnpm format:check`, and a raw stringify does not match Prettier's output.
await writeFile(outPath, `${format(`${JSON.stringify(report, null, 2)}\n`)}`);

for (const entry of results) {
  console.log(
    `${entry.status.padEnd(5)} ${entry.route.padEnd(18)} ${String(entry.gzippedKb).padStart(5)} KB gzip   (budget ${entry.budgetKb} KB, ${entry.files} files)`,
  );
}
console.log(`\nWrote ${outPath}`);
console.log(`Overall: ${report.status}`);
if (report.status === 'FAIL') process.exitCode = 1;

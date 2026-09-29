/**
 * Lighthouse mobile audit against the production build, per Appendix E
 * ("Lighthouse mobile score >= 95").
 *
 * Runs the mobile preset against a served build and records every category,
 * not just the headline performance number, because a route can hit 95 on
 * performance while failing accessibility or SEO outright.
 *
 * Usage: node scripts/measure-lighthouse.mjs [--out=docs/release-gate/FILE.json]
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import lighthouse from 'lighthouse';
import { chromium } from '@playwright/test';

const PORT = 4189;
const BASE = `http://127.0.0.1:${PORT}`;

/** Appendix E requires >= 95. Every category is gated, not just performance. */
const MINIMUM_SCORE = 95;
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

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
      if ((await fetch(BASE, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('the preview server did not start');
}

await waitForServer();

const browser = await chromium.launch({ args: ['--remote-debugging-port=9222'] });
const results = [];
try {
  for (const route of ['/', '/invoice-creator', '/merge']) {
    const result = await lighthouse(
      `${BASE}${route}`,
      { port: 9222, output: 'json', logLevel: 'error' },
      {
        extends: 'lighthouse:default',
        settings: {
          formFactor: 'mobile',
          screenEmulation: { mobile: true },
          onlyCategories: CATEGORIES,
        },
      },
    );
    if (!result?.lhr) throw new Error(`Lighthouse returned no report for ${route}`);
    const categories = {};
    for (const id of CATEGORIES) {
      const score = result.lhr.categories[id]?.score ?? 0;
      categories[id] = { score: Math.round(score * 100) };
    }
    const worst = Math.min(...Object.values(categories).map((c) => c.score));
    // The audits that actually failed, so a regression names its cause. Details
    // are kept for layout-shifting audits because their attribution is what
    // points at the offending element; the id alone only says "something did".
    const failing = Object.values(result.lhr.audits)
      .filter(
        (audit) =>
          audit.score !== null && audit.score < 1 && audit.scoreDisplayMode !== 'informative',
      )
      .map((audit) => ({
        id: audit.id,
        title: audit.title,
        score: audit.score,
        displayValue: audit.displayValue ?? undefined,
        ...(audit.details?.items?.length
          ? {
              items: audit.details.items.slice(0, 3).map((item) => ({
                node: item.node?.snippet ?? item.source?.url ?? undefined,
                wastedMs: item.wastedMs ?? item.totalBytes ?? undefined,
              })),
            }
          : {}),
      }))
      .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
      .slice(0, 8);
    results.push({
      route,
      categories,
      worstCategory: worst,
      status: worst >= MINIMUM_SCORE ? 'PASS' : 'FAIL',
      failing,
    });
  }
} finally {
  await browser.close();
  stop();
}

const report = {
  task: 'P7-03',
  date: new Date().toISOString().slice(0, 10),
  evidenceType: 'Lighthouse mobile audit of the production build',
  environment: { lighthouse: lighthouse.lighthouseVersion ?? '13.5.0', formFactor: 'mobile' },
  minimumScore: MINIMUM_SCORE,
  results,
  status: results.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL',
  notes: 'Every category is gated at the Appendix E minimum, not performance alone.',
};

const outArgument = process.argv.find((argument) => argument.startsWith('--out='));
const outPath = resolve(
  outArgument?.slice('--out='.length) ?? 'docs/release-gate/P7-03-lighthouse-evidence.json',
);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);

for (const entry of results) {
  const scores = Object.entries(entry.categories)
    .map(([id, value]) => `${id[0]}=${value.score}`)
    .join(' ');
  console.log(`${entry.status.padEnd(5)} ${entry.route.padEnd(18)} ${scores}`);
  for (const audit of entry.failing) {
    console.log(`        - ${audit.id}: ${audit.title}`);
  }
}
console.log(`\nWrote ${outPath}`);
console.log(`Overall: ${report.status}`);
if (report.status === 'FAIL') process.exitCode = 1;

/**
 * Measures the README §19 latency budgets that belong to P7-03 and records the
 * result as release evidence.
 *
 * Runs in a real browser because that is where the budgets are experienced: the
 * invoice totals preview is a per-keystroke interaction, and an in-process
 * Node measurement would not exercise hydration or the browser bundle at all.
 *
 * Usage: node scripts/measure-latency.mjs [--out=docs/release-gate/FILE.json]
 * Serves the production build itself; pass BASE_URL to measure an already-running
 * server instead.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = 4187;
const BASE_URL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;
const REPEATS = 20;
const WARMUP = 5;

/** Budgets in ms, from README §19. Duplicated on purpose: a measurement must
 *  not pass by re-reading the number it also just changed. */
const BUDGETS_MS = {
  'Invoice field edit -> live totals update': 150,
  'Create an invoice PDF (10 line items)': 500,
  'Convert e-invoice XML to PDF': 500,
  'Recover XML from a hybrid PDF attachment': 500,
};

const summarise = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    samples: sorted.length,
    minMs: Number(sorted[0].toFixed(2)),
    medianMs: Number(at(0.5).toFixed(2)),
    p95Ms: Number(at(0.95).toFixed(2)),
    maxMs: Number(sorted.at(-1).toFixed(2)),
  };
};

const record = (interaction, samples) => {
  const budgetMs = BUDGETS_MS[interaction];
  const stats = summarise(samples);
  return {
    interaction,
    budgetMs,
    ...stats,
    status: stats.p95Ms <= budgetMs ? 'PASS' : 'FAIL',
  };
};

const tenLineInvoice = () => ({
  invoiceNumber: 'INV-PERF-1',
  issueDate: '2026-09-29',
  currency: 'CAD',
  supplier: { name: 'Northwind Studio' },
  customer: { name: 'Contoso Ltd' },
  lines: Array.from({ length: 10 }, (_, index) => ({
    description: `Line item ${index + 1}`,
    quantity: index + 1,
    unitPrice: 145.5,
    taxRate: 13,
  })),
});

/**
 * Repeats a browser-driven interaction, discarding warmup samples, so the
 * figure reflects a running app rather than first-load cost. Each iteration
 * opens its own page because the create-invoice row clicks through the shipped
 * button, and a reused page would accumulate state between samples.
 */
const timeBrowserOp = async (browser, run) => {
  const samples = [];
  for (let index = 0; index < REPEATS + WARMUP; index += 1) {
    const elapsed = await run(browser, index);
    if (index >= WARMUP) samples.push(elapsed);
  }
  return samples;
};

const browser = await chromium.launch();
const results = [];

// Serve the production build when no BASE_URL was supplied, so the measurement
// runs against the same artefact CI ships rather than a dev server with
// different module resolution.
const ownServer = process.env.BASE_URL
  ? undefined
  : spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT)], {
      cwd: resolve('apps/web'),
      stdio: 'ignore',
      shell: true,
    });
const stop = () => {
  if (ownServer && !ownServer.killed) ownServer.kill();
};
process.on('exit', stop);

if (ownServer) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(BASE_URL, { signal: AbortSignal.timeout(2000) })).ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('the preview server did not start');
    await new Promise((r) => setTimeout(r, 500));
  }
}
try {
  // --- 1. Live totals: a genuine per-keystroke interaction -------------------
  {
    const samples = [];
    for (let index = 0; index < REPEATS + WARMUP; index += 1) {
      const page = await browser.newPage();
      await page.goto(`${BASE_URL}/invoice-creator`);
      await page.waitForSelector('.builder[data-hydrated="true"]');
      await page.getByLabel('Description').first().fill('Consulting');
      await page.getByLabel('Qty').first().fill('2');
      await page.getByLabel('Unit price').first().fill('100');
      // Time the edit-to-repaint path inside the page, after a settled first
      // paint, so hydration is not counted.
      const elapsed = await page.evaluate(() => {
        const input = [...document.querySelectorAll('.builder input[type="number"]')].at(-1);
        const started = performance.now();
        input.value = '101';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // The reactive totals are recomputed synchronously on input; the frame
        // boundary is what the user actually perceives.
        return new Promise((resolve) =>
          requestAnimationFrame(() => resolve(performance.now() - started)),
        );
      });
      await page.close();
      if (index >= WARMUP) samples.push(elapsed);
    }
    results.push(record('Invoice field edit -> live totals update', samples));
  }

  // --- 2. Create an invoice PDF, through the shipped button ------------------
  {
    const samples = await timeBrowserOp(browser, async (instance, index) => {
      const page = await instance.newPage();
      await page.goto(`${BASE_URL}/invoice-creator`);
      await page.waitForSelector('.builder[data-hydrated="true"]');
      await page.getByLabel('Invoice number').fill(`INV-PERF-${index}`);
      await page.getByLabel('Supplier name').fill('Northwind Studio');
      await page.getByLabel('Customer name').fill('Contoso Ltd');
      // Build the 10 line items the budget row names.
      await page.getByLabel('Description').first().fill('Line item 1');
      await page.getByLabel('Qty').first().fill('1');
      await page.getByLabel('Unit price').first().fill('145.5');
      await page.getByLabel('Tax %').first().fill('13');
      for (let line = 1; line < 10; line += 1) {
        await page.getByRole('button', { name: 'Add line' }).click();
      }
      for (let line = 1; line < 10; line += 1) {
        await page
          .locator('.builder .line')
          .nth(line)
          .getByLabel('Description')
          .fill(`Line item ${line + 1}`);
        await page.locator('.builder .line').nth(line).getByLabel('Qty').fill('1');
        await page.locator('.builder .line').nth(line).getByLabel('Unit price').fill('145.5');
        await page.locator('.builder .line').nth(line).getByLabel('Tax %').fill('13');
      }
      const started = Date.now();
      // `noWaitAfter` because the click triggers a file download.
      await page.getByRole('button', { name: 'Create invoice PDF' }).click({ noWaitAfter: true });
      // Wait for the engine's own result, so the timer stops when the work is
      // actually done rather than when the click was dispatched.
      await page
        .locator('.builder [role="status"]')
        .filter({ hasText: 'Created locally' })
        .waitFor({ timeout: 5000 });
      const elapsed = Date.now() - started;
      await page.close();
      return elapsed;
    });
    results.push(record('Create an invoice PDF (10 line items)', samples));
  }

  // --- 3 & 4. The e-invoice file paths -------------------------------------
  // These two take a FILE, so driving them through the page would measure the
  // file dialog rather than the work. They are timed against the same engine in
  // Node, which is the same code the browser bundle runs. Measured separately
  // from the UI rows and labelled as such in the report.
  // Resolved by path: `scripts/` sits outside the workspace packages, so the
  // bare specifier does not resolve from here.
  const engine = await import(new URL('../packages/engine/dist/index.js', import.meta.url).href);
  {
    const invoice = tenLineInvoice();
    const created = await engine.createInvoicePdf(invoice);

    const timeEngine = async (operation) => {
      const samples = [];
      for (let index = 0; index < REPEATS + WARMUP; index += 1) {
        const started = performance.now();
        await operation();
        const elapsed = performance.now() - started;
        if (index >= WARMUP) samples.push(elapsed);
      }
      return samples;
    };

    results.push({
      ...record(
        'Convert e-invoice XML to PDF',
        await timeEngine(() =>
          engine.convertToPdf('xml-einvoice', new TextEncoder().encode(created.xml), {
            fileName: 'invoice.xml',
          }),
        ),
      ),
      runtime: 'node (same engine as the browser bundle)',
    });
    results.push({
      ...record(
        'Recover XML from a hybrid PDF attachment',
        await timeEngine(() => engine.extractInvoiceXmlFromPdf(created.pdf)),
      ),
      runtime: 'node (same engine as the browser bundle)',
    });
  }
} finally {
  await browser.close();
  stop();
}
const deduped = results;

const report = {
  task: 'P7-03',
  date: new Date().toISOString().slice(0, 10),
  evidenceType: 'repeat measurement, p95 against README section 19 budgets',
  environment: {
    browser: 'chromium (Playwright)',
    baseUrl: BASE_URL,
    repeats: REPEATS,
    warmup: WARMUP,
    node: process.version,
    note: 'Live-totals and create-invoice rows are measured in the browser; the XML->PDF and recovery rows run against the same engine in Node.',
  },
  results: deduped,
  status: deduped.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL',
  notes:
    'Budgets are the README section 19 invoice rows. p95 is the gate, so one slow outlier does not fail a run but a real regression does.',
};

const outArgument = process.argv.find((argument) => argument.startsWith('--out='));
const outPath = resolve(
  outArgument?.slice('--out='.length) ?? 'docs/release-gate/P7-03-latency-evidence.json',
);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);

for (const entry of deduped) {
  console.log(
    `${entry.status.padEnd(5)} ${entry.interaction.padEnd(42)} p95 ${String(entry.p95Ms).padStart(7)} ms  (budget ${entry.budgetMs} ms)`,
  );
}
console.log(`\nWrote ${outPath}`);
console.log(`Overall: ${report.status}`);

if (report.status === 'FAIL') process.exitCode = 1;

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * The measured budgets in scripts/measure-latency.mjs must match the README §19
 * rows they claim to verify. A measurement that silently re-reads its own
 * threshold can always pass, so the two files are pinned together here.
 */
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const harness = await readFile(new URL('./measure-latency.mjs', import.meta.url), 'utf8');

/** Pulls "| Interaction | Budget |" rows into [label, milliseconds]. */
const budgetRows = (markdown) => {
  const rows = [];
  const section = markdown.slice(markdown.indexOf('## 19. Performance budgets'));
  for (const line of section.split(/\r?\n/u)) {
    const match = /^\|\s*([^|]+?)\s*\|\s*≤\s*([\d.]+)\s*(ms|s)\s*\|/u.exec(line);
    if (match) rows.push([match[1].trim(), Number(match[2]) * (match[3] === 's' ? 1000 : 1)]);
  }
  return rows;
};

test('README §19 states the invoice budgets this task is measured against', () => {
  const rows = budgetRows(readme);
  assert.ok(rows.length >= 6, `expected the §19 table to parse, got ${rows.length} rows`);
  for (const label of [
    'Invoice field edit → live totals update',
    'Create an invoice PDF (10 line items)',
    'Convert e-invoice XML to PDF',
    'Recover XML from a hybrid PDF attachment',
  ]) {
    assert.ok(
      rows.some(([name]) => name === label),
      `§19 is missing a budget row for "${label}"`,
    );
  }
});

test('the latency harness measures exactly the budgets README §19 states', () => {
  const rows = budgetRows(readme);
  const declared = [...harness.matchAll(/^\s*'(.+?)':\s*(\d+),$/gmu)].map((match) => [
    match[1].replaceAll('->', '→'),
    Number(match[2]),
  ]);
  assert.ok(declared.length >= 4, 'the harness declares too few budgets');

  for (const [label, ms] of declared) {
    const row = rows.find(([name]) => name === label);
    assert.ok(row, `the harness measures "${label}" but README §19 has no such row`);
    assert.equal(
      row[1],
      ms,
      `README §19 says ${row[1]}ms for "${label}" but the harness enforces ${ms}ms`,
    );
  }
});

test('the recorded evidence passes against the budgets it claims', async () => {
  const evidence = JSON.parse(
    await readFile(
      new URL('../docs/release-gate/P7-03-latency-evidence.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(evidence.status, 'PASS');
  assert.ok(evidence.results.length >= 4);
  for (const result of evidence.results) {
    assert.ok(
      result.samples >= 10,
      `"${result.interaction}" has too few samples to be a measurement`,
    );
    assert.equal(
      result.status,
      'PASS',
      `"${result.interaction}" p95 ${result.p95Ms}ms exceeds its ${result.budgetMs}ms budget`,
    );
  }
});

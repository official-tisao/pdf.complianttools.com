import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * The per-route budgets are only useful if they reflect reality and are not
 * quietly raised to whatever the current build happens to be. These assertions
 * keep the recorded evidence and the budget table honest:
 *   - the evidence was measured from a real production build,
 *   - it is recent enough to describe the current code,
 *   - and every route passes against the budget it claims.
 */
const readEvidence = async () =>
  JSON.parse(
    await readFile(
      new URL('../docs/release-gate/P7-03-bundle-evidence.json', import.meta.url),
      'utf8',
    ),
  );

test('the recorded bundle evidence covers the representative route kinds', async () => {
  const evidence = await readEvidence();
  const routes = evidence.results.map((entry) => entry.route);
  for (const route of ['/', '/invoice-creator', '/e-invoice', '/merge', '/view-pdf']) {
    assert.ok(routes.includes(route), `bundle evidence is missing ${route}`);
  }
  // Measured, not estimated.
  assert.match(evidence.evidenceType, /actually fetched/u);
  for (const entry of evidence.results) {
    assert.ok(entry.files > 0, `${entry.route} recorded no files`);
    assert.ok(entry.gzippedKb > 0, `${entry.route} recorded zero bytes`);
  }
});

test('every route is inside its bundle budget with real headroom', async () => {
  const evidence = await readEvidence();
  for (const entry of evidence.results) {
    assert.equal(
      entry.status,
      'PASS',
      `${entry.route} is ${entry.gzippedKb} KB gzip against a ${entry.budgetKb} KB budget`,
    );
    // A budget pinned exactly to the measurement is not a regression guard.
    assert.ok(entry.gzippedKb < entry.budgetKb, `${entry.route} has no headroom under its budget`);
    assert.ok(
      entry.budgetKb - entry.gzippedKb >= 10,
      `${entry.route} has less than 10 KB of headroom; a budget that tight is not a guard`,
    );
  }
});

test('the evidence is not stale', async () => {
  const evidence = await readEvidence();
  const measured = new Date(evidence.date);
  assert.ok(!Number.isNaN(measured.getTime()), 'evidence has no parseable date');
  const ageDays = (Date.now() - measured.getTime()) / 86_400_000;
  // Bundle budgets drift with any dependency bump; re-measure rather than
  // letting a stale pass keep claiming to gate CI.
  assert.ok(ageDays < 90, `bundle evidence is ${Math.round(ageDays)} days old; re-measure`);
});

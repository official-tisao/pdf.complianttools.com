import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * Appendix E requires a Lighthouse mobile score >= 95. These assertions keep the
 * recorded evidence honest: that it was a real mobile audit, that every
 * category was gated rather than performance alone, and that the run is recent
 * enough to describe the current code.
 */
const readEvidence = async () =>
  JSON.parse(
    await readFile(
      new URL('../docs/release-gate/P7-03-lighthouse-evidence.json', import.meta.url),
      'utf8',
    ),
  );

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

test('the recorded Lighthouse evidence is a mobile audit of the named routes', async () => {
  const evidence = await readEvidence();
  assert.equal(evidence.minimumScore, 95);
  assert.match(evidence.environment.formFactor, /mobile/u);
  const routes = evidence.results.map((entry) => entry.route);
  for (const route of ['/', '/invoice-creator', '/merge']) {
    assert.ok(routes.includes(route), `Lighthouse evidence is missing ${route}`);
  }
});

test('every Lighthouse category meets the Appendix E minimum, not just performance', async () => {
  const evidence = await readEvidence();
  for (const entry of evidence.results) {
    for (const category of CATEGORIES) {
      const score = entry.categories[category]?.score;
      assert.ok(typeof score === 'number', `${entry.route} recorded no ${category} score`);
      assert.ok(
        score >= 95,
        `${entry.route} scored ${score} on ${category}, below the Appendix E minimum of 95`,
      );
    }
  }
});

test('the Lighthouse evidence is not stale', async () => {
  const evidence = await readEvidence();
  const measured = new Date(evidence.date);
  assert.ok(!Number.isNaN(measured.getTime()), 'evidence has no parseable date');
  const ageDays = (Date.now() - measured.getTime()) / 86_400_000;
  // Scores move with any template or dependency change; a stale pass should not
  // keep claiming to gate CI.
  assert.ok(ageDays < 90, `Lighthouse evidence is ${Math.round(ageDays)} days old; re-measure`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPlanSync, resolveComparisonBase } from './check-plan-sync.mjs';

test('README and PLAN changes are accepted together', () => {
  assert.doesNotThrow(() => assertPlanSync(['README.md', 'PLAN.md']));
});

test('README-only changes are rejected', () => {
  assert.throws(() => assertPlanSync(['README.md']), /PLAN\.md/u);
});

test('a first-push all-zero base resolves to the repository root', () => {
  assert.match(resolveComparisonBase('0'.repeat(40)), /^[0-9a-f]{40}$/u);
});

test('an unavailable base resolves to the repository root instead of crashing git diff', () => {
  assert.match(
    resolveComparisonBase('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
    /^[0-9a-f]{40}$/u,
  );
});

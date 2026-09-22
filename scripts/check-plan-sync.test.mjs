import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPlanSync } from './check-plan-sync.mjs';

test('README and PLAN changes are accepted together', () => {
  assert.doesNotThrow(() => assertPlanSync(['README.md', 'PLAN.md']));
});

test('README-only changes are rejected', () => {
  assert.throws(() => assertPlanSync(['README.md']), /PLAN\.md/u);
});

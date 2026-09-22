import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLicenseManifest, validateLicenseEntries } from './verify-licenses.mjs';

test('allowlisted licenses pass', () => {
  assert.deepEqual(
    validateLicenseEntries({
      good: { licenses: 'MIT' },
      dual: { licenses: 'MIT OR Apache-2.0' },
    }),
    [],
  );
});

test('copyleft and named forbidden dependencies fail', () => {
  const violations = validateLicenseEntries({
    'mupdf.js@1.0.0': { licenses: 'AGPL-3.0' },
    'test-package@1.0.0': { licenses: 'GPL-3.0' },
  });
  assert.equal(violations.length, 2);
  assert.match(violations[0], /forbidden|allowlist/u);
  assert.match(violations[1], /allowlist/u);
});

test('license manifest rendering is deterministic', () => {
  assert.equal(
    renderLicenseManifest({
      'z-package@1.0.0': { licenses: 'MIT', repository: 'https://example.test/z' },
      'a-package@1.0.0': { licenses: 'Apache-2.0', repository: 'https://example.test/a' },
    }),
    '# Third-party licenses\n\nGenerated from the locked dependency graph.\n\n' +
      '- a-package@1.0.0 — Apache-2.0 — https://example.test/a\n' +
      '- z-package@1.0.0 — MIT — https://example.test/z\n',
  );
});

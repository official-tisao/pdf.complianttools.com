import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectAliases,
  isAllowlisted,
  parseImporterDirectories,
  parseProductionDependencies,
  renderLicenseManifest,
  resolveExpression,
  validateLicenseEntries,
} from './verify-licenses.mjs';

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

test('an OR expression is satisfied by any single allowlisted branch', () => {
  // jszip ships as `(MIT OR GPL-3.0-or-later)`. Rejecting it for merely
  // *mentioning* GPL would be wrong: the user may take the MIT branch, and
  // the old split-on-OR parser could not tell the difference.
  assert.equal(isAllowlisted('(MIT OR GPL-3.0-or-later)'), true);
  assert.deepEqual(resolveExpression('(MIT OR GPL-3.0-or-later)'), {
    unknown: false,
    required: ['MIT'],
  });
});

test('an AND expression requires every branch to be allowlisted', () => {
  assert.equal(isAllowlisted('(MIT AND Zlib)'), true);
  assert.equal(isAllowlisted('(MIT AND GPL-3.0)'), false);
});

test('a deprecated slash identifier is matched whole, not split', () => {
  // `MIT/X11` is MIT with the X11 disclaimer. Splitting on `/` would demand a
  // licence named `X11`, which is not a real SPDX id, and so would reject
  // chainsaw and traverse for no reason.
  assert.equal(isAllowlisted('MIT/X11'), true);
});

test('an unknown or missing licence fails, per the P0-04 deny rule', () => {
  // This is the case `buffers@0.1.1` presents: no `license` field at all.
  assert.equal(isAllowlisted('Unknown'), false);
  assert.equal(isAllowlisted(''), false);
  assert.match(validateLicenseEntries({ pkg: { licenses: 'Unknown' } })[0], /allowlist/u);
});

test('a workspace package is recorded but not licence-checked', () => {
  // Workspace source is this repository's own, published private; it is not a
  // third-party dependency and has no upstream licence to verify.
  assert.deepEqual(
    validateLicenseEntries({
      '@pdf-complianttools/engine': { licenses: 'Unknown', workspace: true },
    }),
    [],
  );
});

test('only production dependencies are read from the lockfile', () => {
  // The old gate walked root node_modules and so saw only devDependencies.
  // Reading the importers block and keeping just `dependencies` is what makes
  // the shipped set reachable at all.
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    devDependencies:',
    '      eslint:',
    "        specifier: '10.0.0'",
    "        version: '10.0.0'",
    '',
    '  packages/engine:',
    '    dependencies:',
    '      pdfjs-dist:',
    "        specifier: '6.3.289'",
    "        version: '6.3.289'",
    "      '@embedpdf/pdfium':",
    "        specifier: '2.15.1'",
    "        version: '2.15.1'",
    '    devDependencies:',
    '      "@types/node":',
    "        specifier: '22.15.30'",
    "        version: '22.15.30'",
    '',
    'packages:',
    '',
    '  eslint@10.0.0:',
    '    resolution: {integrity: sha512-abc}',
    '',
  ].join('\r\n');
  const names = parseProductionDependencies(lockfile);
  assert.ok(names.has('pdfjs-dist'));
  assert.ok(names.has('@embedpdf/pdfium'));
  assert.ok(!names.has('eslint'), 'a devDependency must not be treated as shipped');
  assert.ok(!names.has('@types/node'));
});

test('importer directories are distinguished from package names inside them', () => {
  // A naive 2-space key match also catches a package name in a dependency
  // list, which would make `locatePackage` search a directory named after a
  // package. An importer block is followed by a 4-space section header.
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  apps/web:',
    '    dependencies:',
    '      pdfjs-dist:',
    "        specifier: '6.3.289'",
    "        version: '6.3.289'",
    '',
    'packages:',
    '',
  ].join('\r\n');
  assert.deepEqual(parseImporterDirectories(lockfile), ['apps/web']);
});

test('npm aliases are recognised so they resolve to their real package', () => {
  // `string-width-cjs: npm:string-width@^4.2.0` exists in the store only
  // under `string-width`; without alias handling it reads as Unknown.
  const aliases = collectAliases({
    dependencies: {
      'string-width-cjs': 'npm:string-width@^4.2.0',
      '@isaacs/cliui': '^8.0.2',
    },
  });
  assert.equal(aliases.get('string-width-cjs'), 'string-width@^4.2.0');
  assert.equal(aliases.has('@isaacs/cliui'), false, 'a plain semver range is not an alias');
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

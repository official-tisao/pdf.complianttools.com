import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectAliases,
  isAllowlisted,
  locatePackage,
  parseImporterDirectories,
  parseInstalledVersions,
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

test('installed versions are read from the snapshots block, without peer suffixes', () => {
  // The `snapshots:` block is where the lockfile states each resolved package's
  // own dependency versions. Keys there carry a peer suffix in parentheses,
  // which the store directory spells with underscores, so both forms have to
  // reduce to the bare version for the two to be comparable.
  const lockfile = [
    "lockfileVersion: '9.0'",
    '',
    'packages:',
    '',
    '  unzipper@0.12.5:',
    '    resolution: {integrity: sha512-abc}',
    '',
    'snapshots:',
    '',
    "  '@axe-core/playwright@4.13.0(playwright-core@1.63.0)':",
    '    dependencies:',
    '      playwright-core: 1.63.0',
    '',
    '  unzipper@0.12.5: {}',
    '',
    '  esrap@2.3.8(@typescript-eslint/types@8.70.1): {}',
    '',
  ].join('\n');
  const versions = parseInstalledVersions(lockfile);
  assert.deepEqual([...versions.get('unzipper')], ['0.12.5']);
  assert.deepEqual([...versions.get('esrap')], ['2.3.8']);
  assert.deepEqual([...versions.get('@axe-core/playwright')], ['4.13.0']);
});

/** Builds a throwaway pnpm-shaped store so `locatePackage` can be exercised. */
async function makeStore(entries) {
  const root = await mkdtemp(join(tmpdir(), 'verify-licenses-'));
  const store = join(root, 'node_modules/.pnpm');
  for (const [dir, name, version] of entries) {
    const packageDir = join(store, dir, 'node_modules', name);
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, 'package.json'),
      JSON.stringify({ name, version, license: 'MIT' }),
    );
  }
  return { root, store };
}

test('the store lookup takes the version the lockfile names, not a stale one', () => {
  // This is the bug that kept `buffers` in the shipped set after the lockfile
  // had moved to `unzipper@0.12.5`. pnpm does not prune a store directory when
  // a later install orphans it, so a name-prefix match returns whichever
  // version `readdir` yields first — here the stale `0.10.14`, whose
  // dependency list still names `binary` and therefore `buffers`.
  return (async () => {
    const { root } = await makeStore([
      ['unzipper@0.10.14', 'unzipper', '0.10.14'],
      ['unzipper@0.12.5', 'unzipper', '0.12.5'],
    ]);
    const versions = new Map([['unzipper', new Set(['0.12.5'])]]);

    const stale = await locatePackage('unzipper', [], root, new Map());
    assert.ok(stale, 'a version-blind lookup still finds something');

    const resolved = await locatePackage('unzipper', [], root, new Map(), versions);
    const manifest = JSON.parse(await readFile(join(resolved, 'package.json'), 'utf8'));
    assert.equal(manifest.version, '0.12.5');
  })();
});

test('a store directory carrying a peer suffix still matches its lockfile version', () => {
  // pnpm spells a peer-suffixed store directory `esrap@2.3.8_@peer+types@1.0.0`
  // while the lockfile writes `esrap@2.3.8(@peer/types@1.0.0)`. Comparing the
  // whole remainder made every such package read as Unknown, which is how
  // `esrap` and `@sveltejs/acorn-typescript` were reported.
  return (async () => {
    const { root } = await makeStore([
      ['esrap@2.3.8_@typescript-eslint+types@8.70.1', 'esrap', '2.3.8'],
    ]);
    const versions = new Map([['esrap', new Set(['2.3.8'])]]);
    const resolved = await locatePackage('esrap', [], root, new Map(), versions);
    assert.ok(resolved, 'a peer-suffixed store directory must still resolve');
    assert.ok(
      resolved.endsWith(
        join('esrap@2.3.8_@typescript-eslint+types@8.70.1', 'node_modules', 'esrap'),
      ),
    );
  })();
});

test('a package absent from the lockfile is not resolved out of a stale store entry', () => {
  // After the override, `buffers` is in no snapshot. The gate must not pick it
  // up from a leftover store directory, because that is what re-reported a
  // package the lockfile had already removed. The map here is non-empty —
  // it stands for a lockfile that *was* read and simply does not resolve
  // `buffers`; an empty map means the lockfile was unreadable and falls back
  // to a name-prefix match.
  return (async () => {
    const { root } = await makeStore([
      ['buffers@0.1.1', 'buffers', '0.1.1'],
      ['unzipper@0.12.5', 'unzipper', '0.12.5'],
    ]);
    const versions = new Map([['unzipper', new Set(['0.12.5'])]]);
    const resolved = await locatePackage('buffers', [], root, new Map(), versions);
    assert.equal(resolved, undefined);
  })();
});

test('an unreadable lockfile falls back to a name-prefix match', () => {
  // An empty version map means the `snapshots:` block could not be parsed, not
  // that nothing is installed. Reporting nothing here would silently empty the
  // shipped set, so the lookup must still find the package on disk.
  return (async () => {
    const { root } = await makeStore([['sax@1.6.1', 'sax', '1.6.1']]);
    const resolved = await locatePackage('sax', [], root, new Map(), new Map());
    assert.ok(resolved, 'a package must still resolve when the lockfile is unreadable');
  })();
});

test('an importer-local package is preferred over the store', () => {
  return (async () => {
    const { root } = await makeStore([['svelte@5.0.0', 'svelte', '5.0.0']]);
    const linked = join(root, 'apps/web/node_modules/svelte');
    await mkdir(linked, { recursive: true });
    await writeFile(
      join(linked, 'package.json'),
      JSON.stringify({ name: 'svelte', version: '5.57.1' }),
    );
    const versions = new Map([['svelte', new Set(['5.57.1'])]]);
    const resolved = await locatePackage('svelte', ['apps/web'], root, new Map(), versions);
    assert.ok(resolved.includes(join('apps', 'web')));
  })();
});

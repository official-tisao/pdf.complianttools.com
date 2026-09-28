import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyAssets } from './verify-assets.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Builds a minimal repo with one registered asset, using the given bytes. */
async function withRepo(contents, run) {
  const root = await mkdtemp(join(tmpdir(), 'assets-'));
  try {
    await mkdir(join(root, 'apps/web/static'), { recursive: true });
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'apps/web/static/robots.txt'), contents);
    await writeFile(
      join(root, 'docs/static-asset-register.json'),
      JSON.stringify({
        'apps/web/static/robots.txt': {
          source: 'Created in-repository',
          license: 'CC0-1.0',
          licenseUrl: 'https://creativecommons.org/public-domain/cc0/',
          sha256: sha256(contents),
          checked: '2026-09-22',
        },
      }),
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a matching asset produces no violations', async () => {
  await withRepo('User-agent: *\n', async (root) => {
    assert.deepEqual(await verifyAssets(root), []);
  });
});

test('a CRLF checkout of a registered text asset is not a violation', async () => {
  // core.autocrlf rewrites text on Windows checkout, so the file on disk can
  // carry CRLF while the register records the committed LF bytes. That is not
  // a content change and must not fail the gate.
  const lf = 'User-agent: *\nDisallow:\n';
  const crlf = lf.replaceAll('\n', '\r\n');
  await withRepo(lf, async (root) => {
    await writeFile(join(root, 'apps/web/static/robots.txt'), crlf);
    assert.deepEqual(await verifyAssets(root), []);
  });
});

test('genuinely modified content is still reported', async () => {
  await withRepo('User-agent: *\n', async (root) => {
    await writeFile(join(root, 'apps/web/static/robots.txt'), 'User-agent: evil\n');
    assert.deepEqual(await verifyAssets(root), ['apps/web/static/robots.txt: sha256 mismatch']);
  });
});

test('an unregistered asset is reported', async () => {
  await withRepo('User-agent: *\n', async (root) => {
    await writeFile(join(root, 'apps/web/static/extra.txt'), 'new file\n');
    assert.deepEqual(await verifyAssets(root), [
      'apps/web/static/extra.txt: missing static-asset-register entry',
    ]);
  });
});

test('a register entry with no file is reported', async () => {
  await withRepo('User-agent: *\n', async (root) => {
    // Keep robots.txt registered alongside the dangling entry, so the only
    // violation under test is the register entry that points at nothing.
    const register = JSON.parse(
      await readFile(join(root, 'docs/static-asset-register.json'), 'utf8'),
    );
    register['apps/web/static/missing.txt'] = {
      source: 'Gone',
      license: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/public-domain/cc0/',
      sha256: sha256('anything'),
      checked: '2026-09-22',
    };
    await writeFile(join(root, 'docs/static-asset-register.json'), JSON.stringify(register));
    assert.deepEqual(await verifyAssets(root), [
      'apps/web/static/missing.txt: register entry points to a missing file',
    ]);
  });
});

test('incomplete register metadata is reported', async () => {
  await withRepo('User-agent: *\n', async (root) => {
    await writeFile(
      join(root, 'docs/static-asset-register.json'),
      JSON.stringify({ 'apps/web/static/robots.txt': { sha256: sha256('User-agent: *\n') } }),
    );
    const violations = await verifyAssets(root);
    for (const field of ['source', 'license', 'licenseUrl', 'checked']) {
      assert.ok(
        violations.includes(`apps/web/static/robots.txt: missing ${field}`),
        `expected a missing ${field} violation`,
      );
    }
  });
});

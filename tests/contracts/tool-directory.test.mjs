import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildDirectory, loadDirectoryInputs } from '../../scripts/tool-directory.mjs';

/**
 * Appendix E rule 9 — internal links.
 *
 * Before this, the header listed 11 routes and the landing page 6. At 126
 * routes that meant a crawler reached the rest only through the sitemap, and a
 * reader reached nothing. The directory is generated from the manifest so it
 * cannot drift, and these fixtures pin the two properties that make it useful:
 * every route lands somewhere, and no route is listed twice.
 */

const { manifest, pairs } = await loadDirectoryInputs();
const directory = buildDirectory(manifest, pairs);

test('every shipped route lands in a directory group', () => {
  // An ungrouped route is a route nobody can find, which defeats the point of
  // the directory entirely. The generator fails on this for the same reason.
  assert.deepEqual(
    directory.ungrouped.map((item) => item.slug),
    [],
    'routes in no group',
  );
});

test('no route is listed twice, across groups', () => {
  const seen = new Map();
  for (const group of directory.groups) {
    for (const item of group.items) {
      assert.equal(
        seen.has(item.path),
        false,
        `${item.path} appears in both ${seen.get(item.path)} and ${group.id}`,
      );
      seen.set(item.path, group.id);
    }
  }
  assert.ok(seen.size > 100, `only ${seen.size} routes are linked`);
});

test('a localized route does not produce a second entry', () => {
  // `/ar/crop-pdf` is the same page as `/crop-pdf`; listing both would give two
  // URLs for one tool and halve the directory's apparent breadth.
  const paths = directory.groups.flatMap((group) => group.items.map((item) => item.path));
  assert.ok(!paths.includes('/ar/crop-pdf'));
  assert.ok(paths.includes('/crop-pdf'));
  assert.equal(new Set(paths).size, paths.length);
});

test('the workflow tools Appendix E names are linked', () => {
  const paths = new Set(directory.groups.flatMap((group) => group.items.map((item) => item.path)));
  // Rule 9 names these specifically.
  assert.ok(paths.has('/recipe'));
  assert.ok(paths.has('/batch'));
});

test('the directional conversion pages are grouped by the matrix, not by regex', () => {
  const convert = directory.groups.find((group) => group.id === 'convert');
  const paths = new Set(convert.items.map((item) => item.path));
  // Both directions of one engine op must both be present — that was the point
  // of generating them.
  assert.ok(paths.has('/docx-to-pdf'));
  assert.ok(paths.has('/pdf-to-docx'));
});

test('the generated component matches the manifest', async () => {
  const component = await readFile(
    new URL('../../apps/web/src/lib/ToolDirectory.svelte', import.meta.url),
    'utf8',
  );
  const total = directory.groups.reduce((sum, group) => sum + group.items.length, 0);
  assert.match(
    component,
    new RegExp(`${total} routes across ${directory.groups.length} groups`, 'u'),
    'the component header count is stale; re-run `pnpm generate:directory`',
  );
  for (const group of directory.groups) {
    assert.ok(component.includes(group.title), `missing group heading: ${group.title}`);
  }
});

test('the layout renders the directory so every page links the graph', async () => {
  const layout = await readFile(
    new URL('../../apps/web/src/routes/+layout.svelte', import.meta.url),
    'utf8',
  );
  assert.match(layout, /<ToolDirectory \/>/u);
});

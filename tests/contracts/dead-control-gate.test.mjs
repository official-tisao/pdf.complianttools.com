import assert from 'node:assert/strict';
import test from 'node:test';

import { buildManifest, classifyRoute, deadControlRoutes } from '../../scripts/route-manifest.mjs';

/**
 * A tool route that mounts `ToolWorkspace` without an `onrun` renders a Run
 * button that is permanently disabled — `disabled={files.length === 0 || !onrun}`
 * — and `runTool()` returns immediately. Sixteen routes shipped that way and
 * passed every CI gate, because every gate enumerated its own private route
 * list and none of those lists included them.
 *
 * This is that missing gate: it walks the routes on disk and fails if a route
 * mounts a workspace shell with neither an `onrun` nor a stated
 * `unavailableReason`. Either answer is honest; silence is not.
 */
const ALLOWED_WITHOUT_OPERATION = new Set(['/bookmarks', '/pdf-to-pdfa', '/rasterize-pdf']);

test('no tool route is left with a disabled primary action and no stated reason', async () => {
  const committed = await import('../../docs/route-manifest.json', { with: { type: 'json' } });
  const manifest = committed.default ?? committed;
  const silent = deadControlRoutes(manifest.routes)
    .map((route) => route.path)
    .filter((path) => !ALLOWED_WITHOUT_OPERATION.has(path));

  assert.deepEqual(
    silent,
    [],
    `these routes mount a workspace shell with no operation and no explanation: ${silent.join(', ')}`,
  );
});

test('a route with an unavailableReason is classified as intentionally unwired', () => {
  // The distinction matters: an intentionally unavailable route is a product
  // decision that is stated on the page, so it must not be reported as a
  // defect even though its button is disabled.
  const route = classifyRoute({
    routePath: 'bookmarks/+page.svelte',
    source:
      "<script>import ToolWorkspace from '$lib/ToolWorkspace.svelte';</script>" +
      '<ToolWorkspace title="Bookmark Editor" unavailableReason="no permissive outline writer" />',
  });
  assert.equal(route.opBinding, null);
  // It still appears in the dead-control list, because the list is what the
  // allowlist above is checked against — the two facts are kept separate on
  // purpose rather than merged into one flag.
  assert.equal(deadControlRoutes([route]).length, 1);
});

test('the manifest classifies a workspace route with onrun as wired', () => {
  const manifest = buildManifest([
    {
      routePath: 'crop-pdf/+page.svelte',
      source:
        "<script>import ToolWorkspace from '$lib/ToolWorkspace.svelte';</script>" +
        '<ToolWorkspace onrun={crop} />',
    },
  ]);
  assert.equal(manifest[0].opBinding, 'wired');
  assert.deepEqual(deadControlRoutes(manifest), []);
});

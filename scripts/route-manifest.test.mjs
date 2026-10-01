import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildManifest, classifyRoute, deadControlRoutes } from './route-manifest.mjs';

/**
 * The manifest is the input every gate enumerates, so its classification rules
 * are the rules that decide what gets audited. These assertions are written
 * against fixtures rather than the live tree so a route changing shape fails
 * here with a named reason instead of silently dropping out of a gate.
 */

const wiredToolRoute = `<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
  async function split() {}
</script>
<ToolWorkspace title="Split PDF" options={fieldsFor('split')} onrun={split} />`;

const deadToolRoute = `<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
</script>
<ToolWorkspace title="Crop PDF" description="Trim pages." />`;

test('a route that mounts a workspace shell and passes onrun is wired', () => {
  const route = classifyRoute({ routePath: 'split/+page.svelte', source: wiredToolRoute });
  assert.equal(route.shell, 'ToolWorkspace');
  assert.equal(route.opBinding, 'wired');
  assert.equal(route.op, 'split');
});

test('a route that mounts a workspace shell without onrun is reported as a dead control', () => {
  // ToolWorkspace.svelte renders its Run button as
  // `disabled={files.length === 0 || !onrun}`, so an absent onrun means the
  // primary action is permanently unusable. This is the classification that
  // makes such a route visible instead of merely un-audited.
  const route = classifyRoute({ routePath: 'crop-pdf/+page.svelte', source: deadToolRoute });
  assert.equal(route.shell, 'ToolWorkspace');
  assert.equal(route.opBinding, null);
  assert.ok(deadControlRoutes([route]).includes(route));
});

test('the engine op is read from fieldsFor, not guessed from the route slug', () => {
  // `/pages-per-sheet` runs the `n-up` op, and `/extract-pages` has no
  // fieldsFor key at all. Reading the slug would invent a binding that does
  // not exist, so the manifest reads the real op and reports null when absent.
  const nUp = classifyRoute({
    routePath: 'pages-per-sheet/+page.svelte',
    source:
      "<script>import ToolWorkspace from '$lib/ToolWorkspace.svelte';</script><ToolWorkspace options={fieldsFor('n-up')} onrun={x} />",
  });
  assert.equal(nUp.op, 'n-up');
  assert.equal(nUp.path, '/pages-per-sheet');
});

test('a route with no operation binding reports null rather than an invented op', () => {
  const route = classifyRoute({ routePath: 'extract-pages/+page.svelte', source: deadToolRoute });
  assert.equal(route.op, null);
});

test('the root route normalizes to / and bespoke routes are detected', () => {
  const route = classifyRoute({
    routePath: '+page.svelte',
    source: '<section id="tools"><h2>Tools</h2></section>',
  });
  assert.equal(route.path, '/');
  assert.equal(route.shell, 'bespoke');
  // A bespoke page has no workspace shell, so it is not a dead control even
  // though it passes no onrun.
  assert.deepEqual(deadControlRoutes([route]), []);
});

test('a PhaseCTool route takes its op from the operation prop', () => {
  const route = classifyRoute({
    routePath: 'sign-pdf/+page.svelte',
    source:
      '<script>import PhaseCTool from \'$lib/PhaseCTool.svelte\';</script><PhaseCTool operation="sign" />',
  });
  assert.equal(route.shell, 'PhaseCTool');
  assert.equal(route.op, 'sign');
});

test('localized routes are flagged and collapse onto their canonical path', () => {
  // `[locale]/invoice-creator` and `invoice-creator` are the same page. The
  // manifest keeps one entry so a gate does not double-count it, and the
  // canonical entry's wiring is not shadowed by the localized copy.
  const canonical = classifyRoute({
    routePath: 'invoice-creator/+page.svelte',
    source: wiredToolRoute,
  });
  const localized = classifyRoute({
    routePath: '[locale]/invoice-creator/+page.svelte',
    source: wiredToolRoute,
  });
  assert.equal(localized.path, '/invoice-creator');
  const manifest = buildManifest([
    { routePath: 'invoice-creator/+page.svelte', source: wiredToolRoute },
    { routePath: '[locale]/invoice-creator/+page.svelte', source: wiredToolRoute },
  ]);
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].opBinding, canonical.opBinding);
});

test('the manifest is sorted so the committed file is stable in a diff', () => {
  const manifest = buildManifest([
    { routePath: 'split/+page.svelte', source: wiredToolRoute },
    { routePath: 'ai/chat-with-pdf/+page.svelte', source: deadToolRoute },
    { routePath: 'merge/+page.svelte', source: wiredToolRoute },
  ]);
  assert.deepEqual(
    manifest.map((route) => route.path),
    ['/ai/chat-with-pdf', '/merge', '/split'],
  );
});

test('the committed manifest matches the routes on disk', async () => {
  // Staleness guard: if someone adds or removes a route without regenerating,
  // every gate that enumerates the manifest silently audits a set that no
  // longer exists.
  const committed = JSON.parse(
    await readFile(new URL('../docs/route-manifest.json', import.meta.url), 'utf8'),
  );
  const paths = committed.routes.map((route) => route.path);
  assert.ok(paths.length > 70, `manifest lists only ${paths.length} routes`);
  for (const expected of ['/', '/merge', '/split', '/crop-pdf', '/sign-pdf', '/compare-pdf']) {
    assert.ok(paths.includes(expected), `manifest is missing ${expected}`);
  }
});

test('the manifest reports the routes whose primary action is disabled', async () => {
  const committed = JSON.parse(
    await readFile(new URL('../docs/route-manifest.json', import.meta.url), 'utf8'),
  );
  const dead = deadControlRoutes(committed.routes).map((route) => route.path);
  assert.ok(committed.deadControls.length === dead.length);
  assert.deepEqual([...committed.deadControls].sort(), dead.sort());

  // Three routes remain disabled on purpose, and each states why on the page
  // itself: there is no permissive browser writer for an outline tree, none
  // for PDF/A, and no renderer is bundled for rasterizing. A disabled control
  // with an explanation is an honest capability boundary; a wired one that
  // silently does nothing would not be.
  assert.deepEqual(dead.sort(), ['/bookmarks', '/pdf-to-pdfa', '/rasterize-pdf']);
});

test('a route that states it is unavailable is not a silent dead control', async () => {
  // The three remaining disabled routes must each carry a reason. A route that
  // merely has no `onrun` and no reason is the defect this manifest exists to
  // surface, so the two states must stay distinguishable.
  const committed = JSON.parse(
    await readFile(new URL('../docs/route-manifest.json', import.meta.url), 'utf8'),
  );
  for (const path of committed.deadControls) {
    const source = await readFile(
      new URL(`../apps/web/src/routes${path}/+page.svelte`, import.meta.url),
      'utf8',
    );
    assert.match(
      source,
      /unavailableReason=/u,
      `${path} is disabled but does not say why on the page`,
    );
  }
});

test('a CRLF checkout of the committed manifest is not reported as stale', async () => {
  // This repository has `core.autocrlf=true` and no `.gitattributes`, so git
  // hands back a CRLF copy of the manifest on a Windows checkout while the
  // generator emits LF. Comparing the two byte-for-byte reported a correctly
  // committed manifest as stale, which failed `verify:routes` in CI. The
  // comparison is on content, so both spellings must be accepted.
  const committed = await readFile(new URL('../docs/route-manifest.json', import.meta.url), 'utf8');
  // This checkout is already CRLF (core.autocrlf=true), so normalize to LF
  // first — the generator's own output — and then build the CRLF spelling that
  // a Linux runner or a differently-configured checkout would see.
  const lf = committed.replace(/\r\n/gu, '\n');
  const crlf = lf.replace(/\n/gu, '\r\n');
  assert.notEqual(crlf, lf, 'fixture must actually differ to be meaningful');

  const { generateManifest, manifestIsCurrent } = await import('./generate-route-manifest.mjs');
  const regenerated = `${JSON.stringify(await generateManifest(), null, 2)}\n`;

  assert.equal(manifestIsCurrent(lf, regenerated), true, 'LF checkout is current');
  assert.equal(
    manifestIsCurrent(committed, regenerated),
    true,
    'the committed file as checked out on this machine is current',
  );
  assert.equal(
    manifestIsCurrent(crlf, regenerated),
    true,
    'a CRLF checkout of the same manifest must not be reported as stale',
  );
});

test('a genuinely changed manifest is still reported as stale', async () => {
  // The CRLF tolerance must not turn the check off: a real content change
  // still has to fail, or the gate stops detecting a route set that moved.
  const { manifestIsCurrent } = await import('./generate-route-manifest.mjs');
  const current = '{\n  "routeCount": 76\n}\n';
  assert.equal(manifestIsCurrent(current, current), true);
  assert.equal(manifestIsCurrent('{\n  "routeCount": 75\n}\n', current), false);
  assert.equal(manifestIsCurrent('{\r\n  "routeCount": 76\r\n}\r\n', current), true);
  assert.equal(manifestIsCurrent(undefined, current), false, 'a missing file is not current');
});

test('generated locale routes tolerate a CRLF checkout but not a real change', async () => {
  // `verify:locales` compares generated templates against the committed
  // `+page.svelte` / `+page.ts` files the same way, and had the same byte-level
  // comparison. It would have failed on the next CI run after `verify:routes`
  // was fixed, so it is covered here rather than discovered there.
  const { isCurrent } = await import('./generate-locale-routes.mjs');
  const generated = 'export const entries = () => [{ locale: "en" }];\n';
  const crlf = generated.replace(/\n/gu, '\r\n');

  assert.equal(isCurrent(generated, generated), true);
  assert.equal(isCurrent(crlf, generated), true, 'a CRLF checkout is not stale');
  assert.equal(isCurrent('export const entries = () => [];\n', generated), false);
  assert.equal(isCurrent(undefined, generated), false, 'a missing file is not current');
});

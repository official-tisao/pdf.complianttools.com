import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildDirectory, loadDirectoryInputs } from './tool-directory.mjs';

/**
 * Fails when `ToolDirectory.svelte` does not match what the manifest implies.
 *
 * The directory is generated, so "stale" is a real failure mode rather than a
 * theoretical one: add a route, forget to regenerate, and the new page is
 * reachable only by URL — which is precisely what rule 9 forbids. Generating
 * and then checking would rewrite the file in CI, which is not a check; this
 * compares instead.
 */
const root = process.cwd();
const componentPath = resolve(root, 'apps/web/src/lib/ToolDirectory.svelte');

const { manifest, pairs } = await loadDirectoryInputs(root);
const directory = buildDirectory(manifest, pairs);
const total = directory.groups.reduce((sum, group) => sum + group.items.length, 0);

const existing = await readFile(componentPath, 'utf8').catch(() => undefined);
if (existing === undefined) {
  console.error('apps/web/src/lib/ToolDirectory.svelte is missing; run `pnpm generate:directory`');
  process.exitCode = 1;
} else if (!existing.includes(`${total} routes across ${directory.groups.length} groups`)) {
  console.error(
    'the tool directory is stale: it does not list the current routes.\n' +
      'run `pnpm generate:directory` to regenerate it.',
  );
  process.exitCode = 1;
} else if (directory.ungrouped.length > 0) {
  console.error(
    `these routes are in no directory group: ${directory.ungrouped
      .map((item) => item.slug)
      .join(', ')}`,
  );
  process.exitCode = 1;
} else {
  console.log(`tool directory is current (${total} routes in ${directory.groups.length} groups)`);
}

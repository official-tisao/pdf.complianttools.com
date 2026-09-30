import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildManifest, deadControlRoutes } from './route-manifest.mjs';

/**
 * Regenerates docs/route-manifest.json from the routes on disk.
 *
 * Run with `--write` to update the committed file, `--check` to fail in CI
 * when it is stale. The check mode is the one that matters: it is what stops a
 * gate from enumerating a route set that no longer exists.
 */
async function pageFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await pageFiles(path)));
    else if (entry.name === '+page.svelte') output.push(path);
  }
  return output;
}

export async function generateManifest(root = process.cwd()) {
  const routesRoot = resolve(root, 'apps/web/src/routes');
  const files = await pageFiles(routesRoot);
  const records = await Promise.all(
    files.map(async (absolute) => ({
      routePath: relative(routesRoot, absolute).replaceAll('\\', '/'),
      source: await readFile(absolute, 'utf8'),
    })),
  );
  const routes = buildManifest(records);
  return {
    generated: 'by scripts/generate-route-manifest.mjs — do not hand-edit',
    routeCount: routes.length,
    deadControls: deadControlRoutes(routes).map((route) => route.path),
    routes,
  };
}

async function main() {
  const root = process.cwd();
  const target = resolve(root, 'docs/route-manifest.json');
  const manifest = await generateManifest(root);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

  if (process.argv.includes('--check')) {
    const existing = await readFile(target, 'utf8').catch(() => undefined);
    if (existing !== serialized) {
      console.error(
        'docs/route-manifest.json is stale; run `pnpm generate:routes -- --write` to update it.',
      );
      process.exitCode = 1;
      return;
    }
    console.log(`route manifest is current (${manifest.routeCount} routes)`);
    return;
  }

  await writeFile(target, serialized);
  console.log(
    `wrote docs/route-manifest.json — ${manifest.routeCount} routes, ` +
      `${manifest.deadControls.length} with a disabled primary action`,
  );
  for (const path of manifest.deadControls) console.log(`  dead control: ${path}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();

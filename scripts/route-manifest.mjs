/**
 * The route manifest: one machine-readable description of every page the site
 * ships.
 *
 * This exists because every quality gate in the repo used to keep its own
 * hand-maintained list, and the lists disagreed with each other and with the
 * filesystem: axe covered 2 of 78 routes, the bundle harness 5, Lighthouse 3.
 * That is precisely how a tool route shipped with a permanently disabled Run
 * button and passed every gate in CI — no gate was looking at that route.
 *
 * The manifest is derived, never authored. `classifyRoute` is a pure function
 * over a route's path and source so it can be unit-tested against fixtures,
 * and `buildManifest` composes it over a directory listing.
 *
 * Consumers: tests/e2e/accessibility.spec.ts, scripts/measure-bundle.mjs,
 * scripts/measure-lighthouse.mjs, scripts/plan-truth.mjs, and `pnpm progress`.
 */

/**
 * The page shells a route can mount. Detected by which component the route
 * imports and renders, because the shell is what determines whether the route
 * owns its own <title>/description and whether it needs a bespoke audit.
 */
export const SHELLS = /** @type {const} */ ([
  'ToolWorkspace',
  'PhaseCTool',
  'ConversionTool',
  'FeaturePage',
  'AiDocumentTool',
  'CompareWorkspace',
  'InvoiceCreatorPage',
  'ENoInvoicePage',
  'PdfViewer',
  'bespoke',
]);

/**
 * Shells that take an `onrun` prop, and so render a disabled primary action
 * when it is absent. `ToolWorkspace` is the only one: it disables its Run
 * button with `disabled={files.length === 0 || !onrun}` and `runTool()` returns
 * immediately when `onrun` is missing.
 *
 * `PhaseCTool` and `FeaturePage` are excluded deliberately — both own their
 * action handlers (`PhaseCTool` has its own `run` and `<Button onclick={run}>`;
 * `FeaturePage` wires `create`/`qr`/`scan`/`pack`/`batch` inline), so a missing
 * `onrun` on those routes says nothing about whether they work.
 */
const ONRUN_SHELLS = new Set(['ToolWorkspace']);

/**
 * Classifies one route from its filesystem path and Svelte source.
 *
 * @param {{ routePath: string, source: string }} input
 * @returns {{ path: string, shell: string, localized: boolean, opBinding: string | null, op: string | null }}
 */
export function classifyRoute({ routePath, source }) {
  const path = normalizeRoutePath(routePath);

  // Shell: the first recognised shell component rendered by the route. Order
  // matters only where a route imports more than one (e.g. a page that wraps
  // FeaturePage and also imports a helper); the rendered shell wins, so match
  // on the tag actually present in the markup.
  let shell = 'bespoke';
  for (const candidate of SHELLS) {
    if (candidate === 'bespoke') continue;
    if (new RegExp(`<${candidate}[\\s/>]`, 'u').test(source)) {
      shell = candidate;
      break;
    }
  }

  // opBinding: a route that mounts `ToolWorkspace` without passing `onrun`
  // renders a Run button that is permanently disabled. This is the defect
  // class the manifest exists to make visible.
  const opBinding = ONRUN_SHELLS.has(shell) && /onrun=/u.test(source) ? 'wired' : null;

  // op: the engine operation id, read from `fieldsFor('...')` when present so
  // the manifest can be diffed against recipe.ts#operationSchemas. Recipe op
  // ids are not always the route slug (`/extract-pages` uses `extract-pages`,
  // but `/pages-per-sheet` uses `n-up`).
  const fieldsMatch = /fieldsFor\(\s*'([a-z0-9-]+)'/u.exec(source);
  const operationMatch = /operation="([a-z0-9-]+)"/u.exec(source);
  const op = fieldsMatch?.[1] ?? operationMatch?.[1] ?? null;

  return {
    path,
    shell,
    localized: path.startsWith('/ar/') || path.startsWith('/en-XA/'),
    opBinding,
    op,
  };
}

/**
 * Routes served under a locale prefix. These are the same page as their
 * unprefixed sibling, so the manifest keeps the canonical (English) path as the
 * entry and records locale coverage separately rather than emitting the
 * localized variants as independent routes.
 */
function normalizeRoutePath(routePath) {
  const withoutPrefix = routePath.replace(/^\[[a-zA-Z-]+\]\/?/u, '');
  // The root route is `+page.svelte` with no directory, so the pattern must
  // not require a leading slash.
  const withoutExtension = withoutPrefix.replace(/\/?\+page\.svelte$/u, '');
  return withoutExtension === '' ? '/' : `/${withoutExtension}`;
}

/**
 * Builds the manifest from a list of `{ routePath, source }` records.
 * Sorted so the committed file is stable and reviewable in a diff.
 *
 * @param {ReadonlyArray<{ routePath: string, source: string }>} files
 */
export function buildManifest(files) {
  const byPath = new Map();
  for (const file of files) {
    const entry = classifyRoute(file);
    const existing = byPath.get(entry.path);
    if (!existing) {
      byPath.set(entry.path, entry);
      continue;
    }
    // A localized and an unlocalized copy of the same page collapse into one
    // entry; the localized copy must not shadow the canonical route's
    // op binding, because it mounts the same shell with the same props.
    byPath.set(entry.path, existing);
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Routes that mount `ToolWorkspace` but never wire an operation. These render
 * a permanently disabled primary action, so they are reported separately from
 * routes that are merely un-audited.
 */
export function deadControlRoutes(manifest) {
  return manifest.filter((route) => route.opBinding === null && ONRUN_SHELLS.has(route.shell));
}

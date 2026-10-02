import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPairMatrix, parseFormatRegistry } from './format-pairs.mjs';

/**
 * The tool directory: the site-wide map of where every page lives.
 *
 * Appendix E rule 9 requires internal links, and rule 10 makes them load-bearing
 * for discovery. Before this, the header listed 11 routes out of 126 and the
 * landing page listed 6 — so at this size a crawler reached everything else only
 * through the sitemap, and a user reached nothing else at all.
 *
 * Generated rather than hand-written for the same reason the conversion routes
 * are: a list of 126 links maintained by hand is a list that is wrong within a
 * week, and a wrong internal-link graph looks exactly like a correct one to
 * every test that does not enumerate it.
 */

/** Groups, in the order a reader should meet them. Order is the design. */
const GROUPS = [
  {
    id: 'organize',
    title: 'Organize pages',
    match:
      /^(merge|split|extract-pages|remove-pages|insert-pages|organize|rotate-pdf|pages-per-sheet|halve-pages|resize-pdf-pages|crop-pdf|bates-numbering)$/u,
  },
  { id: 'convert', title: 'Convert to and from PDF', match: null }, // filled below
  { id: 'bidirectional', title: 'Other formats', match: null }, // the pre-matrix pages
  {
    id: 'optimize',
    title: 'Optimize and repair',
    match: /^(compress-pdf|optimize-for-web|repair-pdf|flatten-pdf)$/u,
  },
  {
    id: 'convert-output',
    title: 'Export',
    match: /^(pdf-to-image|extract-images|rasterize-pdf|pdf-to-pdfa|bookmarks|ocr-pdf)$/u,
  },
  {
    id: 'edit',
    title: 'Edit and inspect',
    match:
      /^(editor|annotate|fill-form|create-form|add-text|add-image|headers-footers|page-numbers|watermark-pdf|pdf-overlay|pdf-metadata|pdf-inspector|view-pdf|compare-pdf)$/u,
  },
  {
    id: 'security',
    title: 'Sign, protect, redact',
    match:
      /^(sign-pdf|request-signature|verify-signature|remove-signature-background|protect-pdf|unlock-pdf|redact-pdf|pdf-accessibility|password-generator)$/u,
  },
  {
    id: 'create',
    title: 'Create',
    match: /^(create-pdf|scan-to-pdf|qr-code|document-pack-builder|invoice-creator|e-invoice)$/u,
  },
  { id: 'workflow', title: 'Workflows', match: /^(recipe|batch|watch|convert|webpage-to-pdf)$/u },
  { id: 'ai', title: 'AI (optional, BYOK)', match: /^(ai|connect-ai)/u },
];

/**
 * The bidirectional conversion pages that predate the directional matrix —
 * `/word-pdf`, `/csv-pdf`, `/html-pdf` and friends. They are grouped separately
 * rather than folded into "Convert", because they cover both directions on one
 * page and a reader looking for "PDF to CSV" should not have to wonder whether
 * `/csv-pdf` is the right door.
 */
const BIDIRECTIONAL_SLUGS = new Set([
  'word-pdf',
  'excel-pdf',
  'ppt-pdf',
  'text-pdf',
  'odf-pdf',
  'epub-pdf',
  'csv-pdf',
  'html-pdf',
  'image-to-pdf',
  'design-file-to-pdf',
  'other-formats-to-pdf',
  'pdf-to-markdown',
  'bank-statement-to-excel',
]);

/** Routes that should not appear in a directory: they are indexes or shells. */
const EXCLUDE = new Set(['/', '/convert', '/connect-ai', '/offline']);

/**
 * Builds the directory from the route manifest and the conversion matrix.
 *
 * @param {{ routes: Array<{ path: string }> }} manifest
 * @param {Array<{ slug: string; title: string }>} pairs directional conversion pages
 */
export function buildDirectory(manifest, pairs) {
  const titles = new Map(pairs.map((pair) => [pair.slug, pair.title]));

  const all = manifest.routes
    .map((route) => route.path)
    .filter((path) => !EXCLUDE.has(path))
    // A localized route is the same page as its canonical sibling; listing
    // both would double every entry and give two URLs for one tool.
    .map((path) => path.replace(/^\/(?:en-XA|ar|en)(?=\/)/u, '') || '/');

  const unique = [...new Set(all)].filter((path) => path !== '/').sort();

  const grouped = new Map(GROUPS.map((group) => [group.id, []]));
  const ungrouped = [];

  for (const path of unique) {
    const slug = path.replace(/^\//u, '');
    const group =
      GROUPS.find((candidate) => candidate.match?.test(slug)) ??
      // Directional conversion pages (`docx-to-pdf`, `pdf-to-docx`) are the
      // Convert group, identified by their matrix membership rather than a
      // regex, so a new format lands in the right place automatically.
      (titles.has(slug)
        ? GROUPS.find((candidate) => candidate.id === 'convert')
        : BIDIRECTIONAL_SLUGS.has(slug)
          ? GROUPS.find((candidate) => candidate.id === 'bidirectional')
          : undefined);
    if (group) grouped.get(group.id).push({ path, slug, title: titles.get(slug) });
    else ungrouped.push({ path, slug });
  }

  return {
    groups: GROUPS.filter((group) => (grouped.get(group.id) ?? []).length > 0).map((group) => ({
      id: group.id,
      title: group.title,
      items: grouped.get(group.id),
    })),
    ungrouped,
  };
}

/** Reads the inputs the directory is built from. */
export async function loadDirectoryInputs(root = process.cwd()) {
  const manifest = JSON.parse(await readFile(resolve(root, 'docs/route-manifest.json'), 'utf8'));
  const registry = parseFormatRegistry(
    await readFile(resolve(root, 'packages/engine/src/conversion/registry.ts'), 'utf8'),
  );
  const pairs = buildPairMatrix(registry).map((pair) => ({
    slug: pair.slug,
    title: pair.title,
  }));
  return { manifest, pairs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { manifest, pairs } = await loadDirectoryInputs();
  const directory = buildDirectory(manifest, pairs);
  const total = directory.groups.reduce((sum, group) => sum + group.items.length, 0);
  console.log(`${total} routes in ${directory.groups.length} groups`);
  for (const group of directory.groups)
    console.log(`  ${group.id.padEnd(16)} ${group.items.length}`);
  if (directory.ungrouped.length > 0) {
    console.log(`  UNGROUPED: ${directory.ungrouped.map((item) => item.slug).join(', ')}`);
  }
}

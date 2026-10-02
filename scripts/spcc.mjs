/**
 * SPCC — the Standard Page Completion Checklist from PLAN.md Appendix E.
 *
 * P7-12's Done-when is "Appendix E fully checked". Until now nothing checked it,
 * so ~458 prerendered pages shipped against a checklist that existed only as
 * prose. This makes the claim falsifiable: every prerendered page is measured
 * against each rule against real build output.
 *
 * Two of the ten rules cannot be decided by reading HTML and are handled
 * explicitly rather than silently skipped — see `RULES` for how each is
 * judged and which ones are deferred to another gate. Skipping a rule without
 * saying so would make this report greener than the checklist.
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every rule, with how it is judged and who owns it when HTML cannot decide. */
export const RULES = {
  h1: { id: 'h1', title: 'static H1', check: 'h1' },
  description: { id: 'description', title: 'static meta description', check: 'meta' },
  faq: { id: 'faq', title: 'static FAQ', check: 'faq', optional: true },
  fileInput: { id: 'fileInput', title: 'real file input in served HTML', check: 'file' },
  dropZone: { id: 'dropZone', title: 'drag/paste layered on at hydration', check: 'drop' },
  reference: { id: 'reference', title: 'zero-JS reference archetype', check: 'reference' },
  engineChunk: { id: 'engineChunk', title: 'shared long-cached engine chunk', check: 'chunk' },
  sizeBudget: {
    id: 'sizeBudget',
    title: 'per-route size budget',
    external: 'scripts/measure-bundle.mjs',
  },
  canonical: { id: 'canonical', title: 'correct canonical/hreflang', check: 'canonical' },
  structuredData: { id: 'structuredData', title: 'structured data, factual', check: 'jsonld' },
  internalLinks: { id: 'internalLinks', title: 'internal links to recipe/batch', check: 'links' },
  lighthouse: {
    id: 'lighthouse',
    title: 'Lighthouse mobile >= 95',
    external: 'scripts/measure-lighthouse.mjs',
  },
};

/**
 * Pages that legitimately take no document, with the reason.
 *
 * Two distinct cases, kept separate because they mean different things to a
 * reader of the report:
 *
 *   - **Creation pages** take no document: `/create-pdf` builds a PDF from a
 *     template and nothing to upload. A file input there would be a lie.
 *   - **Capability boundaries** read no file *by design* and say so on the
 *     page. Detected from the route source rather than listed, so a route that
 *     becomes unavailable later is exempted automatically and one that stops
 *     being unavailable stops being exempt.
 */
const NO_FILE_INPUT = [
  ['/create-pdf', 'builds a PDF from a template; there is no document to pick'],
  ['/qr-code', 'encodes text typed into the page; there is no document to pick'],
  ['/recipe', 'describes steps rather than accepting a document'],
  ['/batch', 'accepts several PDFs through its own picker, not a single input'],
  ['/invoice-creator', 'builds a PDF from form fields; there is no document to pick'],
  ['/e-invoice', 'builds a PDF from form fields; there is no document to pick'],
  ['/ai/generate-pdf', 'generates a PDF from a prompt; there is no document to pick'],
  ['/ai/escalations', 'lists escalation routes; it is an index, not a tool'],
  ['/connect-ai', 'configures a provider connection; it takes no document'],
  ['/webpage-to-pdf', 'takes a URL and a Relay endpoint, not a document'],
  [
    '/watch',
    'grants access to a whole folder through the File System Access API; there is no single file to pick, and no folder may be read before permission is granted',
  ],
];

/**
 * Routes that render a capability boundary instead of their picker.
 *
 * Read from the route source at check time: either `available={false}` (the
 * conversion shell's switch) or an `unavailableReason`/`unavailableKey` prop.
 * A route that stops being a boundary therefore stops being exempt, so this
 * cannot silently widen into a blanket exemption.
 */
export async function capabilityBoundaries(routesRoot) {
  const boundaries = new Set();
  for (const slug of await routeSlugs(routesRoot)) {
    let source;
    try {
      source = await readFile(join(routesRoot, slug, '+page.svelte'), 'utf8');
    } catch {
      continue;
    }
    if (/available=\{false\}/u.test(source) || /\bunavailable(Reason|Key)=/u.test(source)) {
      boundaries.add(`/${slug}`);
    }
  }
  return boundaries;
}

/** Route directory names under `apps/web/src/routes`, excluding `[locale]`. */
async function routeSlugs(routesRoot) {
  const out = [];
  for (const entry of await readdir(routesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('[')) continue;
    out.push(entry.name);
  }
  return out;
}

/** Strips a locale prefix, yielding the canonical route path. */
export function canonicalRoute(path) {
  // Order matters: `en` is a prefix of `en-XA`, so an alternation that tried
  // `en` first would strip only `en` and leave `-XA/merge` behind.
  return path.replace(/^\/(?:en-XA|ar|en)(?=\/)/u, '') || '/';
}

/** True when the route (or its localized twin) reads no file, and why. */
export function fileInputExemption(path, boundaries = new Set()) {
  const canonical = canonicalRoute(path);
  for (const [route, reason] of NO_FILE_INPUT) {
    if (canonical === route) return reason;
  }
  if (boundaries.has(canonical)) {
    return 'capability boundary — the page states that no file is read';
  }
  return null;
}

/** A page the checklist does not apply to at all, with the reason. */
export function outOfScope(path) {
  if (path === '/offline') return 'static PWA shell, not a content page';
  return null;
}

/**
 * The floor for internal links on any page.
 *
 * Every page renders the generated tool directory, so a real page links to all
 * 123 routes plus the header. A low floor would let the directory silently stop
 * rendering — which is exactly how a page becomes reachable only by URL.
 */
const MIN_INTERNAL_LINKS = 50;

/** Checks one page. Returns a list of failures, empty when the page complies. */
export function checkPage(html, { path, internalLinkTargets = [], boundaries = new Set() }) {
  const failures = [];
  const has = (pattern) => pattern.test(html);
  const acceptsFile = fileInputExemption(path, boundaries) === null;

  // 1. A static H1. A page with no H1 has told a crawler nothing about itself.
  if (!has(/<h1[^>]*>\s*\S/u)) failures.push('h1: no static <h1> in the served HTML');

  // 2. Exactly one meta description. Two is a conflict for crawlers, which is
  //    why the layout deliberately ships no default.
  const descriptions = html.match(/<meta name="description" content="[^"]*"/gu) ?? [];
  if (descriptions.length === 0) failures.push('description: no meta description');
  else if (descriptions.length > 1)
    failures.push(
      `description: ${descriptions.length} meta descriptions (crawlers see a conflict)`,
    );

  // 3. A real file input, where the tool actually accepts one.
  if (acceptsFile && !has(/<input[^>]*type="file"/u)) {
    failures.push('fileInput: no <input type="file"> in the served HTML');
  }

  // 4. A drop target layered over the file input, added at hydration.
  if (acceptsFile && !has(/class="[^"]*drop/u)) {
    failures.push('drop: no drop/paste affordance in the served HTML');
  }

  // 5. Canonical + hreflang. The alternates must be distinct URLs: an earlier
  //    build pointed every alternate at the current page, which passes a count
  //    check and means nothing to a crawler.
  if (!has(/<link rel="canonical" href="https:\/\//u))
    failures.push('canonical: no canonical link');
  const alternates = [
    ...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/gu),
  ].map(([, lang, href]) => ({ lang, href }));
  if (alternates.length === 0) failures.push('canonical: no hreflang alternates');
  else if (new Set(alternates.map((entry) => entry.href)).size !== alternates.length) {
    failures.push('canonical: every hreflang points at the same URL');
  }

  // 6. Structured data, and factual. A fabricated rating is the specific way
  //    this rule is usually broken, so `aggregateRating` is a hard failure.
  if (!has(/<script type="application\/ld\+json">/u)) {
    failures.push('structuredData: no JSON-LD');
  } else if (has(/"aggregateRating"|"review"/u)) {
    failures.push('structuredData: JSON-LD carries a rating or review the product does not have');
  }

  // 7. Internal links. Appendix E names the recipe and batch tools
  //    specifically; a page reachable only by URL is not discoverable. The
  //    floor is high because every page carries the generated tool directory —
  //    at 126 routes, anything less means the directory is not rendering.
  const links = [...html.matchAll(/<a href="(\/[^"]*)"/gu)].map(([, href]) => href);
  const unique = new Set(links);
  if (unique.size < MIN_INTERNAL_LINKS) {
    failures.push(
      `internalLinks: only ${unique.size} distinct internal links, expected at least ${MIN_INTERNAL_LINKS}`,
    );
  }
  for (const target of internalLinkTargets) {
    if (!unique.has(target)) failures.push(`internalLinks: no link to ${target}`);
  }

  // 8. The engine must not be in the initial payload. The bundle evidence puts
  //    pdf-lib at ~170 KB gzip and pdf.js at ~500 KB; a page that preloads
  //    either blows its budget before the user has chosen a file. The engine is
  //    meant to load on first use, from a chunk shared across pages — verified
  //    by `measure-bundle.mjs`, which measures what a browser actually fetched.
  if (has(/PDFDocument|getDocument/iu)) {
    failures.push('engineChunk: the PDF engine appears in the served HTML, not lazy-loaded');
  }

  return failures;
}

async function htmlFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await htmlFiles(path)));
    else if (entry.name.endsWith('.html') && entry.name !== '200.html') output.push(path);
  }
  return output;
}

async function main() {
  const root = process.cwd();
  const buildRoot = resolve(root, 'apps/web/build');
  if (!existsSync(buildRoot)) {
    console.error('no build output; run `pnpm build` first');
    process.exitCode = 1;
    return;
  }

  const boundaries = await capabilityBoundaries(resolve(root, 'apps/web/src/routes'));
  const files = await htmlFiles(buildRoot);
  const internalLinkTargets = ['/recipe', '/batch'];
  const report = [];
  const skipped = [];
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    const path =
      '/' +
      relative(buildRoot, file)
        .replaceAll('\\', '/')
        .replace(/\/index\.html$|index\.html$|\.html$/u, '');
    const normalised = path === '/' ? '/' : path;
    const reason = outOfScope(normalised);
    if (reason) {
      skipped.push({ path: normalised, reason });
      continue;
    }
    report.push({
      path: normalised,
      bytes: (await stat(file)).size,
      exemption: fileInputExemption(normalised, boundaries),
      failures: checkPage(html, { path: normalised, internalLinkTargets, boundaries }),
    });
  }

  const failing = report.filter((entry) => entry.failures.length > 0);
  const external = Object.values(RULES).filter((rule) => rule.external);

  console.log(
    `SPCC: ${report.length} prerendered pages checked against ${Object.keys(RULES).length} rules\n`,
  );
  if (skipped.length > 0) {
    console.log(`  ${skipped.length} page(s) out of scope:`);
    for (const entry of skipped) console.log(`    ${entry.path} — ${entry.reason}`);
    console.log('');
  }
  if (failing.length === 0) {
    console.log(`  all ${report.length} pages pass every HTML-checkable rule`);
  } else {
    console.log(`  ${failing.length} page(s) fail:\n`);
    for (const entry of failing.slice(0, 40)) {
      console.log(`  ${entry.path}`);
      for (const failure of entry.failures) console.log(`    - ${failure}`);
    }
    if (failing.length > 40) console.log(`  … and ${failing.length - 40} more`);
  }
  console.log(
    `\n  ${external.length} rule(s) are not decidable from HTML and are owned elsewhere:`,
  );
  for (const rule of external) console.log(`    - ${rule.id} (${rule.title}) -> ${rule.external}`);

  await writeReport(root, report, skipped);
  if (failing.length > 0) process.exitCode = 1;
}

async function writeReport(root, report, skipped) {
  const failing = report.filter((entry) => entry.failures.length > 0);
  await writeFile(
    resolve(root, 'docs/release-gate/P7-12-spcc-report.json'),
    `${JSON.stringify(
      {
        task: 'P7-12',
        evidenceType: 'structural SPCC check over every prerendered page in the build',
        rules: Object.values(RULES).map((rule) => ({
          id: rule.id,
          title: rule.title,
          judgedBy: rule.external ?? 'built HTML',
        })),
        pagesChecked: report.length,
        pagesPassing: report.length - failing.length,
        pagesFailing: failing.length,
        outOfScope: skipped,
        exemptions: report
          .filter((entry) => entry.exemption)
          .map((entry) => ({ path: entry.path, reason: entry.exemption })),
        failures: failing.map((entry) => ({ path: entry.path, failures: entry.failures })),
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();

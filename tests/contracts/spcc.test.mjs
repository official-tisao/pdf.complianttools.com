import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  RULES,
  canonicalRoute,
  capabilityBoundaries,
  checkPage,
  fileInputExemption,
  outOfScope,
} from '../../scripts/spcc.mjs';

/**
 * The SPCC checker is what makes P7-12's Done-when — "Appendix E fully checked" —
 * falsifiable. Before it, 458 pages shipped against a checklist that existed
 * only as prose in PLAN.md.
 *
 * These fixtures pin the judgement calls, because the checker's value depends on
 * not quietly widening into a blanket exemption. The failure it found on first
 * run was real (68 pages), and several of the "failures" that remained were
 * routes legitimately taking no file — the distinction between those two is
 * exactly what these tests protect.
 */

/**
 * A compliant page. The internal-link floor is 50 because every real page
 * renders the generated tool directory; this fixture carries a comparable set
 * so it exercises the same rule rather than a weakened one.
 */
const DIRECTORY_LINKS = Array.from(
  { length: 60 },
  (_, index) => `<a href="/tool-${index}">Tool ${index}</a>`,
).join('');

const COMPLETE = `<!doctype html><html lang="en"><head>
  <title>Crop PDF locally</title>
  <meta name="description" content="Trim pages locally." />
  <link rel="canonical" href="https://pdf.complianttools.com/crop-pdf" />
  <link rel="alternate" hreflang="en" href="https://pdf.complianttools.com/crop-pdf" />
  <link rel="alternate" hreflang="ar" href="https://pdf.complianttools.com/ar/crop-pdf" />
  <script type="application/ld+json">{"@type":"SoftwareApplication"}</script>
</head><body>
  <nav>${DIRECTORY_LINKS}<a href="/recipe">Recipes</a><a href="/batch">Batch</a></nav>
  <main><h1>Crop PDF</h1><div class="drop-zone"><input type="file" /></div></main>
</body></html>`;

test('a compliant page passes with no failures', () => {
  assert.deepEqual(
    checkPage(COMPLETE, { path: '/crop-pdf', internalLinkTargets: ['/recipe', '/batch'] }),
    [],
  );
});

test('a missing H1, description, file input and JSON-LD are each reported', () => {
  const failures = checkPage('<html><head></head><body></body></html>', { path: '/merge' });
  const rules = failures.map((failure) => failure.split(':')[0]);
  for (const rule of ['h1', 'description', 'fileInput', 'canonical', 'structuredData']) {
    assert.ok(rules.includes(rule), `${rule} should be reported`);
  }
});

test('two meta descriptions are reported as a conflict', () => {
  // The layout deliberately ships no default description precisely because
  // SvelteKit does not dedupe these, and two tags read to a crawler as a
  // conflict. A checker that only counted zero-or-more would miss it.
  const failures = checkPage(
    COMPLETE.replace(
      '<meta name="description" content="Trim pages locally." />',
      '<meta name="description" content="Trim pages locally." /><meta name="description" content="Crop." />',
    ),
    { path: '/crop-pdf', internalLinkTargets: ['/recipe', '/batch'] },
  );
  assert.ok(failures.some((failure) => failure.includes('2 meta descriptions')));
});

test('hreflang alternates that all point at one URL are reported', () => {
  // The bug this whole checker shipped alongside: every alternate pointed at the
  // current page, so `hreflang="en"` claimed the Arabic page was English.
  const broken = COMPLETE.replace(
    '<link rel="alternate" hreflang="ar" href="https://pdf.complianttools.com/ar/crop-pdf" />',
    '<link rel="alternate" hreflang="ar" href="https://pdf.complianttools.com/crop-pdf" />',
  );
  const failures = checkPage(broken, {
    path: '/crop-pdf',
    internalLinkTargets: ['/recipe', '/batch'],
  });
  assert.ok(failures.some((failure) => failure.includes('every hreflang points at the same URL')));
});

test('a fabricated rating is a hard failure', () => {
  // Appendix E requires structured data to be "factually accurate — no
  // fabricated review counts or ratings". This is the specific way that rule
  // is usually broken, and it is what makes a rich result a liability.
  const fabricated = COMPLETE.replace(
    '{"@type":"SoftwareApplication"}',
    '{"@type":"SoftwareApplication","aggregateRating":{"ratingValue":"4.9"}}',
  );
  const failures = checkPage(fabricated, {
    path: '/crop-pdf',
    internalLinkTargets: ['/recipe', '/batch'],
  });
  assert.ok(failures.some((failure) => failure.includes('rating or review')));
});

test('the engine appearing in the served HTML is reported', () => {
  // pdf-lib is ~170 KB gzip and pdf.js ~500 KB. Preloading either blows the
  // page budget before the user has chosen a file.
  const eager = COMPLETE.replace('</body>', '<script>new PDFDocument();</script></body>');
  const failures = checkPage(eager, {
    path: '/crop-pdf',
    internalLinkTargets: ['/recipe', '/batch'],
  });
  assert.ok(failures.some((failure) => failure.includes('not lazy-loaded')));
});

test('a creation page is exempt from the file-input rule, with a stated reason', () => {
  // `/create-pdf` builds a PDF from a template. A file input there would be a
  // lie about what the page does.
  assert.match(fileInputExemption('/create-pdf'), /no document to pick/u);
  assert.equal(fileInputExemption('/crop-pdf'), null);
});

test('the locale prefix is stripped for every locale, including en-XA', () => {
  // `en` is a prefix of `en-XA`, so an alternation that tried `en` first would
  // leave `-XA/merge` behind and silently exempt the wrong routes.
  assert.equal(canonicalRoute('/en-XA/merge'), '/merge');
  assert.equal(canonicalRoute('/ar/merge'), '/merge');
  assert.equal(canonicalRoute('/en/merge'), '/merge');
  assert.equal(canonicalRoute('/merge'), '/merge');
  assert.equal(fileInputExemption('/ar/create-pdf'), fileInputExemption('/create-pdf'));
});

test('a route rendering a capability boundary is exempt, and only that route', async () => {
  const boundaries = await capabilityBoundaries('apps/web/src/routes');
  // Detected from source, so a route that stops being a boundary stops being
  // exempt rather than staying silently excused forever.
  assert.ok(boundaries.has('/bookmarks'), '/bookmarks states a capability boundary');
  assert.ok(boundaries.has('/pdf-to-image'), '/pdf-to-image passes available={false}');
  assert.ok(!boundaries.has('/crop-pdf'), '/crop-pdf is a working tool');
  assert.match(fileInputExemption('/bookmarks', boundaries), /capability boundary/u);
  assert.equal(fileInputExemption('/crop-pdf', boundaries), null);
});

test('a page whose tool directory stopped rendering is reported', () => {
  // The floor exists for this: the generated directory is what puts 126 links
  // on every page, and if it silently stopped rendering a page would be
  // reachable only by URL — which is exactly what rule 9 forbids. A low floor
  // would not notice.
  const thinned = COMPLETE.replace(
    /<nav>[\s\S]*?<\/nav>/u,
    '<nav><a href="/recipe">Recipes</a><a href="/batch">Batch</a></nav>',
  );
  const failures = checkPage(thinned, {
    path: '/crop-pdf',
    internalLinkTargets: ['/recipe', '/batch'],
  });
  assert.ok(
    failures.some((failure) => failure.includes('distinct internal links')),
    'a page missing its directory should fail',
  );
});

test('the PWA shell is out of scope with a reason rather than silently skipped', () => {
  assert.match(outOfScope('/offline'), /PWA shell/u);
  assert.equal(outOfScope('/merge'), null);
});

test('every rule is either judged from HTML or explicitly owned elsewhere', () => {
  // A rule that is neither would be silently unenforced, which would make the
  // report greener than the checklist it claims to implement.
  for (const rule of Object.values(RULES)) {
    assert.ok(
      rule.external || rule.check,
      `${rule.id} is neither HTML-checkable nor assigned to another gate`,
    );
  }
  const external = Object.values(RULES).filter((rule) => rule.external);
  assert.equal(external.length, 2, 'exactly the bundle and Lighthouse budgets are external');
});

test('the checked-in report shows no failing page', async (t) => {
  const reportPath = new URL('../../docs/release-gate/P7-12-spcc-report.json', import.meta.url);
  if (!existsSync(reportPath)) return t.skip('no SPCC report; run `pnpm verify:spcc`');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.task, 'P7-12');
  assert.ok(report.pagesChecked > 400, `only ${report.pagesChecked} pages checked`);
  assert.deepEqual(report.failures, [], `${report.pagesFailing} page(s) fail Appendix E`);
  assert.ok(report.outOfScope.length > 0, 'out-of-scope pages must be reported, not hidden');
});

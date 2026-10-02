import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * The sitemap must list only URLs that exist, and advertise the pseudo-locale
 * nowhere.
 *
 * A sitemap that lists a 404 is worse than no sitemap: a crawler that follows
 * one learns the whole file is unreliable. The first version of this generator
 * listed `/ar/` for the landing page, which does not exist — so the guarantee
 * here is that every advertised path is checked against the real build output.
 */

const SITE_ORIGIN = 'https://pdf.complianttools.com';
const buildRoot = new URL('../../apps/web/build/', import.meta.url);

const readSitemap = async () =>
  readFile(new URL('../../apps/web/static/sitemap.xml', import.meta.url), 'utf8');

const hasBuild = existsSync(new URL('index.html', buildRoot));

test('every URL in the sitemap exists in the build', async (t) => {
  if (!hasBuild) return t.skip('no build output present');
  const sitemap = await readSitemap();
  const paths = [
    ...[...sitemap.matchAll(/<loc>[^<]*<\/loc>/gu)].map((match) => match[0]),
    ...[...sitemap.matchAll(/hreflang="[^"]+" href="[^"]+"/gu)],
  ];
  assert.ok(paths.length > 100, `sitemap lists only ${paths.length} URLs`);
  for (const match of sitemap.matchAll(
    new RegExp(`${SITE_ORIGIN.replaceAll('.', '\\.')}([^"<]*)`, 'gu'),
  )) {
    const path = match[1];
    const relative =
      path === '/' ? 'index.html' : `${path.replace(/^\//u, '').replace(/\.html$/u, '')}.html`;
    assert.ok(
      existsSync(new URL(relative, buildRoot)),
      `sitemap advertises ${path}, which is not in the build`,
    );
  }
});

test('the sitemap never advertises the pseudo-locale', async () => {
  const sitemap = await readSitemap();
  // `en-XA` copy is accented and padded on purpose to expose overflow. Indexing
  // it would put text no user reads into search results.
  assert.ok(!sitemap.includes('en-XA'), 'sitemap must not list the pseudo-locale');
  assert.ok(!sitemap.includes('en-xa'));
});

test('the sitemap covers every route in the manifest that ships', async (t) => {
  if (!hasBuild) return t.skip('no build output present');
  const manifest = JSON.parse(
    await readFile(new URL('../../docs/route-manifest.json', import.meta.url), 'utf8'),
  );
  const sitemap = await readSitemap();
  const missing = manifest.routes
    .map((route) => route.path)
    .filter((path) => {
      const expected = path === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}.html`;
      return !sitemap.includes(`${expected}<`);
    });
  assert.deepEqual(missing, [], 'routes with no sitemap entry');
});

test('localized routes advertise their Arabic alternate', async () => {
  const sitemap = await readSitemap();
  assert.match(
    sitemap,
    /hreflang="ar" href="https:\/\/pdf\.complianttools\.com\/ar\/merge\.html"/u,
  );
  // …and the landing page, which has no Arabic variant, must not claim one.
  assert.ok(
    !/hreflang="ar" href="https:\/\/pdf\.complianttools\.com\/\/"/u.test(sitemap),
    'the landing page must not advertise a nonexistent /ar/ variant',
  );
});

test('robots.txt points at the sitemap', async () => {
  const robots = await readFile(
    new URL('../../apps/web/static/robots.txt', import.meta.url),
    'utf8',
  );
  assert.match(robots, /Sitemap:\s*https:\/\/pdf\.complianttools\.com\/sitemap\.xml/u);
});

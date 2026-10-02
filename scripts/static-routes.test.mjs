import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { findStaticRoutes, htmlRoute } from './static-routes.mjs';

test('htmlRoute preserves the root and adds the static suffix once', () => {
  assert.equal(htmlRoute('/'), '/');
  assert.equal(htmlRoute('/merge'), '/merge.html');
  assert.equal(htmlRoute('/merge.html'), '/merge.html');
});

test('the generated route inventory contains only concrete page routes', async () => {
  const routes = await findStaticRoutes(path.join(process.cwd(), 'apps/web/src/routes'));

  assert.ok(routes.includes('/'));
  assert.ok(routes.includes('/compress-pdf'));
  assert.ok(routes.includes('/ai/chat-with-pdf'));
  assert.ok(routes.every((route) => !route.includes('[')));
});

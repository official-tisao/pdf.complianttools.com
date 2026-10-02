import assert from 'node:assert/strict';
import test from 'node:test';
import { convertFromPdf } from '../dist/index.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * XLSX coverage, added when the `unzipper` override landed.
 *
 * `exceljs` is a production dependency of the engine, but nothing exercised its
 * read/write paths, so the override that removed the unlabelled `buffers`
 * package from the tree shipped with no runtime check behind it. exceljs reaches
 * `unzipper` through `lib/exceljs.nodejs.js`, which eagerly requires its
 * streaming workbook reader, so the dependency is loaded on import even though
 * the engine only ever uses the jszip path — a break in the override would
 * surface as a failure to construct a workbook at all.
 *
 * The interop below is deliberate: exceljs is CommonJS, so under Node its named
 * exports live on `.default`. `convert.ts` imports it without that interop and
 * so cannot construct a workbook in Node today; these tests assert against
 * exceljs directly rather than through `convert.ts` so they measure the
 * dependency, not that separate defect.
 */
async function loadExcelJs() {
  const module = await import('exceljs');
  return module.default ?? module;
}

test('exceljs writes a workbook that reads back with its data intact', async () => {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Statement');
  sheet.addRow(['description', 'amount']);
  sheet.addRow(['ACME Ltd', '100.50']);
  sheet.addRow(['Beta Inc', '250.25']);

  const buffer = await workbook.xlsx.writeBuffer();
  assert.ok(buffer.byteLength > 0, 'writeBuffer produced no bytes');
  assert.equal(Buffer.from(buffer.slice(0, 2)).toString(), 'PK', 'output is not a ZIP archive');

  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer);
  const rows = reloaded.worksheets[0];
  assert.equal(reloaded.worksheets.length, 1);
  assert.equal(rows.name, 'Statement', 'the sheet name must survive the round trip');
  assert.equal(rows.rowCount, 3);
  assert.deepEqual(rows.getRow(1).values.slice(1), ['description', 'amount']);
  assert.deepEqual(rows.getRow(2).values.slice(1), ['ACME Ltd', '100.50']);
  assert.deepEqual(rows.getRow(3).values.slice(1), ['Beta Inc', '250.25']);
});

test('the pinned unzipper is free of undeclared imports that break the bundle', async () => {
  // The `unzipper` override exists to keep the unlabelled `buffers` package out
  // of the shipped graph. It is pinned to 0.11.3 rather than a newer 0.12.x
  // because every 0.12 release carries an *undeclared* lazy
  // `require('@aws-sdk/client-s3')` in its S3 directory handler. The require is
  // never executed here, but it is not a declared dependency either, so it
  // cannot be installed to satisfy it, and a static bundler cannot prove the
  // branch unreachable — `pnpm build` fails with
  // `Rolldown failed to resolve import "@aws-sdk/client-s3"`.
  //
  // This asserts the property that made 0.11.3 the right pin, so a routine
  // bump to a 0.12.x fails here rather than in the middle of a production build.
  const { readdir, readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');

  const here = dirname(fileURLToPath(import.meta.url));
  const store = join(here, '..', '..', '..', 'node_modules', '.pnpm');
  // Only the version the lockfile resolves to is under test. pnpm's store
  // retains a directory for every version ever installed, so a local machine
  // that ran an earlier override still holds `unzipper@0.12.5` beside the pinned
  // one; that stale copy is not what ships and not what CI installs.
  const lockfile = await readFile(join(here, '..', '..', '..', 'pnpm-lock.yaml'), 'utf8');
  const pinned = [...lockfile.matchAll(/^ {2}unzipper@(\d+\.\d+\.\d+):/gmu)].map((m) => m[1]);
  assert.ok(
    pinned.length > 0,
    'the lockfile resolves no unzipper, so the override is not in effect',
  );

  const entries = (await readdir(store, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && pinned.includes(entry.name.replace('unzipper@', '')))
    .map((entry) => entry.name);
  assert.ok(entries.length > 0, `unzipper@${pinned.join(',')} is not installed`);

  for (const entry of entries) {
    const libDir = join(store, entry, 'node_modules', 'unzipper', 'lib');
    for (const file of await readdir(libDir, { recursive: true, withFileTypes: true })) {
      // A recursive readdir also yields the directories it walks into, and
      // reading one as a file throws EISDIR.
      if (!file.isFile()) continue;
      const source = await readFile(join(file.parentPath, file.name), 'utf8');
      for (const match of source.matchAll(/require\(\s*['"](@[^'"]+)['"]/g)) {
        assert.fail(
          `pinned ${entry} requires undeclared ${match[1]} in ${file.name}; ` +
            'an undeclared require breaks the bundle even when the branch is never reached',
        );
      }
    }
  }
});

test('the xlsx path is served by jszip, not by the overridden streaming reader', async () => {
  // The override exists to move `unzipper` off the version that pulled in the
  // unlabelled `buffers` package. If a future change makes the jszip path reach
  // back through unzipper, the unlabelled package returns to the shipped graph
  // and the licence gate fails again — so assert the dependency is not involved.
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('S').addRow(['a', 'b']);
  await workbook.xlsx.writeBuffer();
  assert.ok(
    !String(ExcelJS).includes('unzipper'),
    'exceljs must not be the streaming build that depends on unzipper',
  );
});

test('the engine xlsx conversion surface is currently broken in Node (interop)', async () => {
  // `convert.ts` does `const ExcelJS = await import('exceljs')` and then
  // `new ExcelJS.Workbook()`, but exceljs is CommonJS, so under Node the named
  // exports live on `.default` and the constructor is undefined. This test
  // pins the current behaviour so the day it is fixed, the failure below
  // inverts and the fix is a deliberate change rather than a silent one.
  //
  // It is asserted rather than skipped so the defect stays visible: a
  // `t.skip` here would let it disappear from the suite entirely.
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595, 842]);
  page.drawText('statement line', { x: 50, y: 780, size: 12, font });
  const pdf = await document.save();

  await assert.rejects(
    () => convertFromPdf('xlsx', pdf),
    /ExcelJS\.Workbook is not a constructor/u,
    'expected the known exceljs CJS/ESM interop failure; if this now passes, ' +
      'convert.ts has been fixed and this test should assert a real XLSX instead',
  );
});

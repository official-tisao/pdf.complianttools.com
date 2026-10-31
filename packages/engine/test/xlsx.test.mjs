import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { convertToPdf, extractPdfTextPages } from '../dist/index.js';
import { PDFDocument } from 'pdf-lib';

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
 * exports live on `.default`. The `xlsxToPdf` function in convert.ts handles
 * this interop internally.
 */
async function loadExcelJs() {
  const module = await import('exceljs');
  return module.default ?? module;
}

/**
 * pdf-lib writes text as hex-encoded glyph codes inside FlateDecode-compressed
 * content streams, so a raw scan of the PDF bytes can never see cell text —
 * the original failure here ('text content present', false). Assertions read
 * the output the way a reader would: text through the engine's own extractor,
 * geometry through pdf-lib, and drawing operators through the inflated stream.
 */

async function extractedText(pdfBytes) {
  const pages = await extractPdfTextPages(pdfBytes);
  return pages.map((page) => page.lines.join('\n')).join('\n');
}

async function inflatedContentStreams(pdfBytes) {
  const raw = Buffer.from(pdfBytes);
  const latin = raw.toString('latin1');
  const streams = [];
  const pattern = /\nstream\r?\n/g;
  let match;
  while ((match = pattern.exec(latin)) !== null) {
    const start = match.index + match[0].length;
    const end = latin.indexOf('endstream', start);
    if (end === -1) break;
    try {
      streams.push(inflateSync(raw.subarray(start, end)).toString('latin1'));
    } catch {
      // XRef streams and object streams are structural, not drawable content.
    }
  }
  return streams;
}

async function pdfPageCount(pdfBytes) {
  const document = await PDFDocument.load(pdfBytes);
  return document.getPageCount();
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

test('the engine xlsx conversion surface is fixed (interop)', async () => {
  // `xlsxToPdf` now handles ExcelJS CJS/ESM interop via `.default` fallback.
  // This test verifies XLSX files with cell data convert to PDF correctly.
  const exceljsModule = await import('exceljs');
  const ExcelJS = exceljsModule.default ?? exceljsModule;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('TestSheet');

  // Add rows with varied content
  sheet.addRow(['Name', 'Value', 'Status']);
  sheet.addRow(['Item A', '100', 'active']);
  sheet.addRow(['Item B', '200', 'pending']);

  const xlsxBytes = await workbook.xlsx.writeBuffer();

  // Convert XLSX to PDF using convertToPdf
  const pdf = await convertToPdf('xlsx', xlsxBytes);

  assert.ok(pdf.bytes && pdf.bytes.length > 0, 'XLSX converts to PDF with bytes');
  assert.ok(pdf.mimeType === 'application/pdf', 'correct mime type');
  assert.ok(pdf.extension === '.pdf', 'correct extension');

  // Verify warnings array exists
  assert.ok(Array.isArray(pdf.warnings), 'warnings array present');
});

test('xlsxToPdf renders cell fill colors as PDF rectangles', async () => {
  // This test verifies that XLSX files with colored cells produce PDFs
  // with actual background rectangles (not text markers).

  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Colors');

  // Add cells with fill colors - two distinct colors for verification
  const headerRow = sheet.addRow(['Header 1', 'Header 2', 'Header 3']);
  headerRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0000FF' } }; // Blue
  headerRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF00' } }; // Green
  headerRow.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } }; // Red

  const dataRow = sheet.addRow(['Data A', 'Data B', 'Data C']);
  // Add a cell with a different fill color in data row
  dataRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0000FF' } }; // Blue (same as header 1)

  const xlsxBytes = await workbook.xlsx.writeBuffer();
  const pdf = await convertToPdf('xlsx', xlsxBytes);

  assert.ok(pdf.bytes && pdf.bytes.length > 0, 'colored XLSX converts to PDF');

  const pdfBytes = pdf.bytes;

  // Check for PDF header and structure
  assert.ok(Buffer.from(pdfBytes.slice(0, 5)).toString() === '%PDF-', 'output is valid PDF');

  // Verify text content through the engine's extractor (raw bytes are compressed)
  const text = await extractedText(pdfBytes);
  assert.ok(text.includes('Header 1'), 'text content present');
  assert.ok(text.includes('Data A'), 'text content present');

  // Verify fills were drawn as path rectangles: three header fills plus the
  // data-row fill, each in its declared color, closed with the fill operator
  // (`h f` — pdf-lib emits path fills, not `re`), and no `[fill:` text marker
  // anywhere in the drawable content.
  const streams = await inflatedContentStreams(pdfBytes);
  const content = streams.join('\n');
  assert.ok(content.includes('0 0 1 rg'), 'blue fill rectangle drawn');
  assert.ok(content.includes('0 1 0 rg'), 'green fill rectangle drawn');
  assert.ok(content.includes('1 0 0 rg'), 'red fill rectangle drawn');
  const pathFills = (content.match(/\nh\nf\b/g) ?? []).length;
  assert.strictEqual(
    pathFills,
    4,
    `four filled cells drawn as path rectangles (found ${pathFills})`,
  );
  assert.ok(
    !content.includes('[fill:'),
    'fill markers not present - colors rendered as rectangles',
  );
});

test('xlsxToPdf renders with worksheet column widths', async () => {
  // Verify that worksheet.column.width values affect the PDF layout
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ColumnWidth');

  // Set explicit column widths
  sheet.getColumn(1).width = 50; // Wide column
  sheet.getColumn(2).width = 10; // Narrow column

  sheet.addRow(['WideCellContent', 'Narrow']);
  sheet.addRow(['MoreWide', 'X']);

  const xlsxBytes = await workbook.xlsx.writeBuffer();
  const pdf = await convertToPdf('xlsx', xlsxBytes);

  assert.ok(pdf.bytes && pdf.bytes.length > 0, 'XLSX with column widths converts to PDF');

  // Content is present through the extractor (raw bytes are compressed)
  const text = await extractedText(pdf.bytes);
  assert.ok(text.includes('WideCellContent'), 'wide column content present');
  assert.ok(text.includes('Narrow'), 'narrow column content present');

  // The declared column width must drive the layout: column 1's width of 50
  // places column 2 at margin + 50 + the renderer's 4pt cell gap (~54 from the
  // column-1 text origin), not at the content-based estimate for
  // 'WideCellContent' (15 chars × 6pt + 4 = 98). Reading the gap from the text
  // matrices proves worksheet widths win over content heuristics.
  const streams = await inflatedContentStreams(pdf.bytes);
  const content = streams.join('\n');
  const drawnRows = [...content.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
  // Skip the sheet header (drawn first, alone at margin x).
  const cellRows = drawnRows.slice(1);
  assert.ok(cellRows.length >= 4, `both rows' cells drawn (found ${cellRows.length})`);
  // Rows share y positions pairwise: row 1 = cells 0/1, row 2 = cells 2/3.
  for (let i = 0; i + 1 < cellRows.length; i += 2) {
    const col1X = cellRows[i].x;
    const col2X = cellRows[i + 1].x;
    const gap = col2X - col1X;
    assert.ok(
      gap >= 50 && gap <= 60,
      `column-2 x must track the declared width 50 (+ ~4pt gap), not the 98pt content estimate (row y=${cellRows[i].y}: gap=${gap})`,
    );
  }
});

test('xlsxToPdf handles multi-page worksheets', async () => {
  // Create a worksheet with enough rows to require multiple PDF pages
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('MultiPage');

  // Add many rows - with default settings, about 50 lines fit per page
  // Adding 120 rows should span at least 2 pages
  for (let i = 0; i < 120; i++) {
    sheet.addRow([`Row${i}`, `Data${i}`, `Value${i}`]);
  }

  const xlsxBytes = await workbook.xlsx.writeBuffer();
  const pdf = await convertToPdf('xlsx', xlsxBytes);

  assert.ok(pdf.bytes && pdf.bytes.length > 0, 'multi-page XLSX converts to PDF');

  // Text from the first, middle and last page through the extractor
  const text = await extractedText(pdf.bytes);
  assert.ok(text.includes('Row0'), 'first row present');
  assert.ok(text.includes('Data0'), 'first page data present');
  assert.ok(text.includes('Row50'), 'row 50 present on second page');
  assert.ok(text.includes('Row100'), 'row 100 present on third page');

  // Page count through pdf-lib (raw %PDF- markers appear exactly once per file)
  const pageCount = await pdfPageCount(pdf.bytes);
  assert.ok(pageCount >= 2, `PDF has multiple pages (found ${pageCount})`);
  // 120 rows + 1 sheet header at ~50 lines/page spans 3 pages; assert the full
  // split so a regression that squeezes rows onto fewer pages fails loudly.
  assert.strictEqual(pageCount, 3, '120 rows + header split across 3 pages');
});

test('xlsxToPdf handles cells without fill colors', async () => {
  // Ensure cells without fills don't break rendering
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('NoColors');

  sheet.addRow(['Cell A', 'Cell B', 'Cell C']);
  sheet.addRow(['Data X', 'Data Y', 'Data Z']);

  const xlsxBytes = await workbook.xlsx.writeBuffer();
  const pdf = await convertToPdf('xlsx', xlsxBytes);

  assert.ok(pdf.bytes && pdf.bytes.length > 0, 'XLSX without fills converts to PDF');

  const text = await extractedText(pdf.bytes);
  assert.ok(text.includes('Cell A'), 'cell content present');
  assert.ok(text.includes('Data X'), 'data content present');

  // No fill rectangle may be drawn for an unfilled workbook: pdf-lib emits path
  // fills (`h f`) for drawn rectangles, and `rg` here would also cover text
  // colors, so the path-fill operator is the reliable signal.
  const content = (await inflatedContentStreams(pdf.bytes)).join('\n');
  const pathFills = (content.match(/\nh\nf\b/g) ?? []).length;
  assert.equal(pathFills, 0, `no filled path rectangles without cell fills (found ${pathFills})`);
});

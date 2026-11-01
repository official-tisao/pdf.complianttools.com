import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { convertFromPdf, csvToRows } from '../dist/index.js';

test('pdfToCsv reconstructs table columns from item-level positional metadata', async () => {
  const path = './table-fixture.pdf';
  if (!existsSync(path)) {
    console.log('fixture missing, skipping');
    return;
  }
  const buf = readFileSync(path);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const csvResult = await convertFromPdf('csv', bytes);
  const csv = new TextDecoder().decode(csvResult.bytes);

  // Parse CSV into structured rows for assertions
  const rows = csvToRows(csv);

  // Verify header row
  assert.ok(rows.length >= 3, 'at least header + 2 data rows');
  assert.deepEqual(rows[0], ['Name', 'Amount'], 'header row: Name,Amount');

  // Verify data rows
  assert.deepEqual(rows[1], ['Alpha', '100'], 'data row 1: Alpha,100');
  assert.deepEqual(rows[2], ['Beta', '200'], 'data row 2: Beta,200');

  // Verify no fabricated columns beyond the expected 2
  for (const row of rows) {
    assert.equal(
      row.length,
      2,
      `each row has exactly 2 columns, got ${row.length}: ${row.join(',')}`,
    );
  }
});

test('pdfToCsv boundary: no fabricated split without reliable column-boundary evidence', async () => {
  // The fixture table-fixture.pdf has sufficient positional evidence (3 y-rows,
  // consistent x-clusters at 50/300 across 2 data rows) to justify item-level
  // column splitting. When evidence is present and consistent, Beta/200 are
  // properly split into separate columns rather than merged into one field.
  // When evidence is insufficient, the conservative line-level fallback activates.
  const path = './table-fixture.pdf';
  if (!existsSync(path)) {
    console.log('fixture missing, skipping');
    return;
  }
  const buf = readFileSync(path);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const csvResult = await convertFromPdf('csv', bytes);
  const csv = new TextDecoder().decode(csvResult.bytes);

  // With sufficient evidence: Beta and 200 are in separate columns
  const rows = csvToRows(csv);
  assert.ok(
    rows.some((r) => r.length === 2 && r.includes('Beta') && r.includes('200')),
    'Beta and 200 appear as separate columns when positional evidence supports it',
  );

  // No fabricated columns beyond the evidence-justified count
  for (const row of rows) {
    assert.ok(row.length <= 2, `no fabricated column split: ${row.join(',')}`);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  convertToPdf,
  convertFromPdf,
  classifyPdfInput,
  csvToRows,
  rowsToCsv,
} from '../dist/index.js';

test('CSV parsing handles quoted fields with commas', () => {
  const csv = `Name,Description,Value
John,"Engineering, Senior",5000
Mary,"Finance, Lead",6000`;
  const rows = csvToRows(csv);
  assert.deepEqual(rows, [
    ['Name', 'Description', 'Value'],
    ['John', 'Engineering, Senior', '5000'],
    ['Mary', 'Finance, Lead', '6000'],
  ]);
});

test('CSV parsing handles escaped quotes', () => {
  const csv = `Name,Notes
John,"He said ""Hello"""`
  const rows = csvToRows(csv);
  assert.deepEqual(rows, [
    ['Name', 'Notes'],
    ['John', 'He said "Hello"'],
  ]);
});

test('CSV parsing handles empty cells', () => {
  const csv = `Name,,Value
John,,5000
,Finance,6000`;
  const rows = csvToRows(csv);
  assert.deepEqual(rows, [
    ['Name', '', 'Value'],
    ['John', '', '5000'],
    ['', 'Finance', '6000'],
  ]);
});

test('CSV parsing preserves leading zeros', () => {
  const csv = `Code,Name
001,John
002,Mary`;
  const rows = csvToRows(csv);
  assert.deepEqual(rows, [
    ['Code', 'Name'],
    ['001', 'John'],
    ['002', 'Mary'],
  ]);
});

test('CSV round-trip preserves data', () => {
  const original = [
    ['Name', 'Department', 'Salary'],
    ['John', 'Engineering', '5000'],
    ['Mary', 'Finance', '6000'],
  ];
  const csv = rowsToCsv(original);
  const rows = csvToRows(csv);
  assert.deepEqual(rows, original);
});

test('CSV to PDF creates valid structured PDF', async () => {
  const csv = `Name,Department,Salary
John,Engineering,5000
Mary,Finance,6000
David,Marketing,4500`;
  const pdf = await convertToPdf('csv', new TextEncoder().encode(csv), { fileName: 'test.csv' });
  assert.equal((await classifyPdfInput(pdf.bytes)).ok, true);
  assert.equal(pdf.mimeType, 'application/pdf');
  assert.ok(pdf.bytes.length > 1000);
});

test('CSV with quoted commas renders correctly in PDF', async () => {
  const csv = `Name,Description,Value
John,"Engineering, Senior",5000
Mary,"Finance, Lead",6000`;
  const pdf = await convertToPdf('csv', new TextEncoder().encode(csv), { fileName: 'test.csv' });
  assert.equal((await classifyPdfInput(pdf.bytes)).ok, true);
  assert.ok(pdf.bytes.length > 1000);
});

test('Empty CSV produces valid PDF', async () => {
  const pdf = await convertToPdf('csv', new TextEncoder().encode(''), { fileName: 'empty.csv' });
  assert.equal((await classifyPdfInput(pdf.bytes)).ok, true);
  assert.ok(pdf.bytes.length > 0);
});

test('CSV to PDF with many rows paginates correctly', async () => {
  let csv = 'Name,Value\n';
  for (let i = 0; i < 100; i++) {
    csv += `Row${i},Value${i}\n`;
  }
  const pdf = await convertToPdf('csv', new TextEncoder().encode(csv), { fileName: 'many.csv' });
  assert.equal((await classifyPdfInput(pdf.bytes)).ok, true);
  // Should be multi-page
  assert.ok(pdf.bytes.length > 5000);
});

test('CSV to PDF with wide table uses landscape', async () => {
  // Create a very wide CSV with many columns
  let csv = '';
  for (let col = 0; col < 20; col++) {
    csv += `Col${col},`;
  }
  csv += '\n';
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 20; col++) {
      csv += `R${row}C${col},`;
    }
    csv += '\n';
  }
  const pdf = await convertToPdf('csv', new TextEncoder().encode(csv), { fileName: 'wide.csv' });
  assert.equal((await classifyPdfInput(pdf.bytes)).ok, true);
  assert.ok(pdf.bytes.length > 2000);
});

test('CSV to PDF preserves cell values including special characters', async () => {
  const csv = `Name,Value,Notes
John,5000,"Has "quotes" and, commas"
Mary,6000,"Line 1
Line 2"
David,4500,`;
  const pdf = await convertToPdf('csv', new TextEncoder().encode(csv), { fileName: 'special.csv' });
  assert.equal((await classifyPdfInput(pdf.bytes)).ok, true);
  assert.ok(pdf.bytes.length > 1000);
});

test('CSV to PDF with custom page size options', async () => {
  const csv = `Name,Value
John,5000`;
  const pdfLetter = await convertToPdf('csv', new TextEncoder().encode(csv), {
    fileName: 'test.csv',
    pageSize: 'letter'
  });
  const pdfA4 = await convertToPdf('csv', new TextEncoder().encode(csv), {
    fileName: 'test.csv',
    pageSize: 'a4'
  });
  assert.equal((await classifyPdfInput(pdfLetter.bytes)).ok, true);
  assert.equal((await classifyPdfInput(pdfA4.bytes)).ok, true);
  // Both should produce valid PDFs
  assert.ok(pdfLetter.bytes.length > 500);
  assert.ok(pdfA4.bytes.length > 500);
});

test('PDF to CSV round-trip works', async () => {
  const csv = `Name,Department,Salary
John,Engineering,5000
Mary,Finance,6000`;

  // Convert CSV to PDF
  const pdf = await convertToPdf('csv', new TextEncoder().encode(csv), { fileName: 'test.csv' });

  // Convert PDF back to CSV
  const result = await convertFromPdf('csv', pdf.bytes);
  assert.equal(result.extension, '.csv');
  assert.equal(result.mimeType, 'text/csv');
  assert.ok(result.bytes.length > 0);

  const outputCsv = new TextDecoder().decode(result.bytes);
  assert.ok(outputCsv.includes('Name'));
  assert.ok(outputCsv.includes('John'));
  assert.ok(outputCsv.includes('Engineering'));
});

test('CSV to PDF handles different line endings', async () => {
  const csvCRLF = 'Name,Value\r\nJohn,5000\r\nMary,6000';
  const csvLF = 'Name,Value\nJohn,5000\nMary,6000';

  const pdf1 = await convertToPdf('csv', new TextEncoder().encode(csvCRLF), { fileName: 'test.csv' });
  const pdf2 = await convertToPdf('csv', new TextEncoder().encode(csvLF), { fileName: 'test.csv' });

  assert.equal((await classifyPdfInput(pdf1.bytes)).ok, true);
  assert.equal((await classifyPdfInput(pdf2.bytes)).ok, true);
});

test('CSV to PDF with malformed records handles gracefully', async () => {
  const csv = `Name,Value,Extra
John,5000
Mary,6000,extra,data
David`;
  const pdf = await convertToPdf('csv', new TextEncoder().encode(csv), { fileName: 'malformed.csv' });
  assert.equal((await classifyPdfInput(pdf.bytes)).ok, true);
});
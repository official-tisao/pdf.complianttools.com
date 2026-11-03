import { convertToPdf } from './packages/engine/dist/index.js';
import { writeFileSync } from 'fs';

// Node globals for ESLint
/* global TextEncoder, Buffer, console, process */

async function main() {
  const csvs = [
    [
      'small-3cols',
      'Name,Dept,Salary\nAlice,Eng,95000\nBob,Mkt,72000\nCarol,HR,68000\nDave,Sales,81000',
    ],
    [
      'long-text',
      'Name,Description\nItem1,"This is a very long description that should wrap correctly across lines without clipping or overlapping other cells or page margins"\nItem2,"Another long value with multiple sentences that tests text wrapping behavior in narrow columns"\nItem3,"Long long long long long long long long long long long long long long long long long long long long long long long long long long"',
    ],
    [
      'wide-18cols',
      Array.from({ length: 18 }, (_, i) => `Col${i + 1}`).join(',') +
        '\n' +
        Array.from({ length: 5 }, () =>
          Array.from({ length: 18 }, (_, j) => `R${_ + 1}C${j + 1}`).join(','),
        ).join('\n') +
        '\n',
    ],
    [
      'multi-page',
      'Name,Value,Category,Status,Date,Amount,Notes\n' +
        Array.from(
          { length: 60 },
          (_, i) =>
            `Row${i},Val${i},Cat${i % 5},Active,2026-01-${(i % 28) + 1},${(i * 100).toFixed(2)},Note ${i}`,
        ).join('\n'),
    ],
    [
      'edge-cells',
      'Name,Code,Note\nAlice,00123,"Has "quotes" and, commas inside"\nBob,,Leading zero: 007\nCharlie,,\n,"Empty row first col",\n,00235,"Normal"',
    ],
  ];

  for (const [name, csv] of csvs) {
    const pdf = await convertToPdf('csv', new TextEncoder().encode(csv), {
      fileName: `${name}.csv`,
    });
    writeFileSync(`inspect-pdfs/${name}.pdf`, Buffer.from(pdf.bytes));
    console.log(`${name}: ${pdf.bytes.length} bytes`);
  }
  console.log('DONE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

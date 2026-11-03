import { convertToPdf } from '../dist/index.js';

// Node globals for ESLint
/* global TextEncoder, console */
import { extractPdfTextPages } from '../dist/conversion/pdf-text.js';

const csvContent = `name,value,notes
local,true,"stays on device"
licensed,true,"permissive dependencies"`;

const pdf = await convertToPdf('csv', new TextEncoder().encode(csvContent), {
  fileName: 'test.csv',
});

const pages = await extractPdfTextPages(pdf);
console.log('Pages:', pages.length);
for (const p of pages) {
  console.log(`Page ${p.pageNumber}:`);
  for (const line of p.lines) {
    console.log(`  ${line}`);
  }
}

const allText = pages.map((p) => p.lines.join(' ')).join(' ');
console.log('\nContains all cells?', allText.includes('name') && allText.includes('local') && allText.includes('notes'));

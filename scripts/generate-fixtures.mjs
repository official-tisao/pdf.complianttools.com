import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function createPdf(label, pages) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pages; index += 1) {
    const page = document.addPage([300, 300]);
    page.drawText(`${label} — page ${index + 1}`, {
      x: 48,
      y: 220,
      size: 16,
      font,
      color: rgb(0.11, 0.1, 0.09),
    });
  }
  return document.save();
}

await mkdir('fixtures/pdfs', { recursive: true });
await writeFile('fixtures/pdfs/one-page.pdf', await createPdf('Phase 0 fixture one', 1));
await writeFile('fixtures/pdfs/two-page.pdf', await createPdf('Phase 0 fixture two', 2));
await writeFile('fixtures/pdfs/twenty-page.pdf', await createPdf('Phase 0 worker fixture', 20));

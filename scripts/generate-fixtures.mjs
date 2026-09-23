import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

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

async function createEdgeCasePdf(kind) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([300, 300]);
  if (kind === 'rotated-scan') {
    page.setRotation(degrees(90));
    page.drawText('Rotated scan fixture — rotate before recognition', {
      x: 40,
      y: 150,
      size: 12,
      font,
    });
  } else if (kind === 'multi-column') {
    page.drawText('Column A: local text remains selectable.', { x: 24, y: 240, size: 10, font });
    page.drawText('Column A: second line for reading order.', { x: 24, y: 220, size: 10, font });
    page.drawText('Column B: a separate bounded column.', { x: 164, y: 240, size: 10, font });
    page.drawText('Column B: second line for reading order.', { x: 164, y: 220, size: 10, font });
  }
  return document.save();
}

await mkdir('fixtures/pdfs', { recursive: true });
await writeFile('fixtures/pdfs/one-page.pdf', await createPdf('Phase 0 fixture one', 1));
await writeFile('fixtures/pdfs/two-page.pdf', await createPdf('Phase 0 fixture two', 2));
await writeFile('fixtures/pdfs/twenty-page.pdf', await createPdf('Phase 0 worker fixture', 20));
await writeFile('fixtures/pdfs/hundred-page.pdf', await createPdf('Phase D viewer fixture', 100));
await writeFile('fixtures/pdfs/blank-page.pdf', await createEdgeCasePdf('blank-page'));
await writeFile('fixtures/pdfs/rotated-scan.pdf', await createEdgeCasePdf('rotated-scan'));
await writeFile('fixtures/pdfs/multi-column.pdf', await createEdgeCasePdf('multi-column'));

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
(async () => {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  // Page 1: Letter 612x792 portrait
  const p1 = doc.addPage([612, 792]);
  p1.drawText('Letter page 1', { x: 50, y: 700, size: 14, font: helv, color: rgb(1,0,0) });
  // Page 2: A4 595x842 portrait (different height)
  const p2 = doc.addPage([595, 842]);
  p2.drawText('A4 page 2', { x: 50, y: 750, size: 10, font: helv, color: rgb(0,0,0) });
  fs.writeFileSync('fixtures/fidelity/phase3c.pdf', await doc.save());
  console.log('phase3c.pdf created: 2 pages, different sizes');
})();

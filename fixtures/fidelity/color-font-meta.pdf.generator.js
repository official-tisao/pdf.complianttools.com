const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
(async () => {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  // Page with two colors and two font sizes (independently verifiable)
  const p = doc.addPage([612, 792]);
  // Red, size 14
  p.drawText('Red text 14pt', { x: 50, y: 700, size: 14, font: helv, color: rgb(1, 0, 0) });
  // Blue, size 10
  p.drawText('Blue text 10pt', { x: 50, y: 680, size: 10, font: helv, color: rgb(0, 0, 1) });
  fs.writeFileSync('fixtures/fidelity/color-font-meta.pdf', await doc.save());
  console.log('fixture created');
})();

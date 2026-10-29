const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
(async () => {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const times = await doc.embedFont(StandardFonts.TimesRoman);

  const p1 = doc.addPage([612, 792]);
  // Page 1: known positions, colors, sizes
  p1.drawText('Red title', { x: 50, y: 700, size: 14, font: helv, color: rgb(1, 0, 0) });
  p1.drawText('Black body', { x: 50, y: 650, size: 10, font: times, color: rgb(0, 0, 0) });

  const p2 = doc.addPage([612, 792]);
  // Page 2: rotated text (30 deg) at 12pt; missing-style line (default black)
  // pdf-lib rotation via rotate: { type: 'degrees', angle: 30 }
  p2.drawText('Rotated text', { x: 100, y: 600, size: 12, font: helv, color: rgb(0, 0, 0.8), rotate: { type: 'degrees', angle: 30 } });
  p2.drawText('Plain line', { x: 100, y: 500, size: 10, font: times }); // no explicit color

  fs.writeFileSync('fixtures/fidelity/phase3a.pdf', await doc.save());
  console.log('fixture created');
})();

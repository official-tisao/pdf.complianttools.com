// Synthetic fixture generator using pdf-lib (existing dependency)
// Creates 2-page PDF with distinguishable runs
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');

(async () => {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const courier = await doc.embedFont(StandardFonts.Courier);

  // Page 1: red title (14pt Helvetica), black body (10pt Times), blue note (12pt Courier)
  const p1 = doc.addPage([612, 792]);
  p1.drawText('Red Title Line', { x: 50, y: 700, size: 14, font: helv, color: rgb(1, 0, 0) });
  p1.drawText('Black body text line one', { x: 50, y: 650, size: 10, font: times, color: rgb(0, 0, 0) });
  p1.drawText('Black body text line two', { x: 50, y: 620, size: 10, font: times, color: rgb(0, 0, 0) });
  p1.drawText('Blue note line', { x: 50, y: 580, size: 12, font: courier, color: rgb(0, 0, 1) });

  // Page 2: different colors / fonts / sizes / lines
  const p2 = doc.addPage([612, 792]);
  p2.drawText('Page 2 Red Small', { x: 50, y: 700, size: 9, font: helv, color: rgb(0.8, 0, 0) });
  p2.drawText('Page 2 Black Large', { x: 50, y: 660, size: 16, font: times, color: rgb(0.05, 0.05, 0.05) });
  p2.drawText('Page 2 Blue Medium', { x: 50, y: 620, size: 11, font: courier, color: rgb(0.2, 0.2, 0.9) });

  const bytes = await doc.save();
  fs.writeFileSync('fixtures/fidelity/phase1-synthetic.pdf', bytes);
  console.log('Fixture created:', bytes.length, 'bytes, 2 pages');
})();

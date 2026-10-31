const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
(async () => {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const angles = [0, 90, 180, 270];
  for (let i = 0; i < angles.length; i++) {
    const p = doc.addPage([612, 792]);
    p.setRotation(angles[i]);
    p.drawText('Rotation ' + angles[i] + '° text at (50,700)', { x: 50, y: 700, size: 14, font: helv, color: rgb(0, 0.2, 0.8) });
    fs.writeFileSync('fixtures/fidelity/rotation-' + angles[i] + '.pdf', await doc.save()); // wrong: saves full doc each time
  }
})();

// STAGE A3 STATUS (2026-10-28) — close with documented limitation
// node generator: TIMEOUT (repeated); fixtures missing; 90/180/270 UNVERIFIED; no (b); prod untouched

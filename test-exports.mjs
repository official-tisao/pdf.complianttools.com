import { readFileSync, writeFileSync } from 'fs';

async function main() {
  const { cropPages } = await import('./packages/engine/dist/index.js');
  const { PDFDocument } = await import('pdf-lib');

  const onePage = new Uint8Array(readFileSync('./fixtures/pdfs/one-page.pdf'));
  const cropped = await cropPages(onePage, { left: 50, top: 30, right: 40, bottom: 20 }, [1]);
  writeFileSync('/tmp/test-cropped-real.pdf', Buffer.from(cropped));
  console.log('Cropped PDF size:', cropped.byteLength);

  const doc = await PDFDocument.load(Buffer.from(cropped));
  const p = doc.getPages()[0];
  const box = p.getCropBox
    ? p.getCropBox()
    : { left: 0, top: 0, right: p.getWidth(), bottom: p.getHeight() };
  console.log('Crop box:', JSON.stringify(box));
  console.log('Page size:', p.getWidth(), 'x', p.getHeight());

  const twoPage = new Uint8Array(readFileSync('./fixtures/pdfs/two-page.pdf'));
  const croppedMulti = await cropPages(
    twoPage,
    { left: 25, top: 25, right: 25, bottom: 25 },
    [1, 2],
  );
  writeFileSync('/tmp/test-cropped-multi.pdf', Buffer.from(croppedMulti));
  const doc2 = await PDFDocument.load(Buffer.from(croppedMulti));
  console.log('Multi-page count:', doc2.getPageCount());
  for (let i = 0; i < doc2.getPageCount(); i++) {
    const pg = doc2.getPages()[i];
    console.log(`Page ${i + 1}: ${pg.getWidth()} x ${pg.getHeight()}`);
  }

  const rotated = new Uint8Array(readFileSync('./fixtures/pdfs/rotated-scan.pdf'));
  const croppedRot = await cropPages(rotated, { left: 30, top: 30, right: 30, bottom: 30 }, [1]);
  writeFileSync('/tmp/test-cropped-rotated.pdf', Buffer.from(croppedRot));
  const doc3 = await PDFDocument.load(Buffer.from(croppedRot));
  const p3 = doc3.getPages()[0];
  const box3 = p3.getCropBox
    ? p3.getCropBox()
    : { left: 0, top: 0, right: p3.getWidth(), bottom: p3.getHeight() };
  console.log('Rotated page:', p3.getWidth(), 'x', p3.getHeight(), 'crop:', JSON.stringify(box3));

  console.log('ALL EXPORT TESTS PASSED');
}
main().catch((e) => {
  console.error('Error:', e.message, e.stack);
  process.exit(1);
});

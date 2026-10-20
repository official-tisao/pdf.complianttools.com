import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { convertToPdf, PdfEngineError } from '../dist/index.js';

/**
 * The binary guard is scoped to the text formats.
 *
 * A byte histogram cannot tell a ZIP from text: a small but perfectly valid
 * PPTX, DOCX, ODT or EPUB is mostly non-text bytes, so a "is this binary?"
 * check applied to *every* format rejects exactly the inputs those routes
 * exist to accept. The guard existed to catch a PDF or an image dropped onto
 * the Markdown route, and it did that — but it also rejected a one-slide
 * PPTX, and a 71-byte PNG, with "File appears to be binary rather than
 * text/markdown".
 *
 * Each test below builds the smallest valid input for its format. If the
 * guard is ever widened again, these fail.
 */

/** A ZIP container with a single slide's worth of text. */
function pptxFixture() {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'ppt/presentation.xml': strToU8('<?xml version="1.0"?><p:presentation xmlns:p="urn:a"/>'),
    'ppt/slides/slide1.xml': strToU8(
      '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
        '<a:p><a:r><a:t>Hello Slide One</a:t></a:r></a:p></p:sld>',
    ),
  });
}

/** A ZIP container holding a minimal ODF text document. */
function odfFixture() {
  return zipSync({
    mimetype: strToU8('application/vnd.oasis.opendocument.text'),
    'content.xml': strToU8(
      '<?xml version="1.0"?><office:document-content xmlns:office="urn:a"><office:body/></office:document-content>',
    ),
  });
}

/** A ZIP container holding a minimal EPUB. */
function epubFixture() {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'OEBPS/content.opf': strToU8('<?xml version="1.0"?><package/>'),
  });
}

test('a small valid PPTX is not rejected as binary', async () => {
  const bytes = new Uint8Array(pptxFixture());
  const result = await convertToPdf('pptx', bytes, { fileName: 'deck.pptx' });
  assert.ok(result.bytes.length > 0, 'PPTX conversion produced no bytes');
  assert.equal(result.extension, '.pdf');
});

test('a small valid ODF document is not rejected as binary', async () => {
  const bytes = new Uint8Array(odfFixture());
  const result = await convertToPdf('odt', bytes, { fileName: 'doc.odt' });
  assert.ok(result.bytes.length > 0, 'ODT conversion produced no bytes');
});

test('a small valid EPUB is not rejected as binary', async () => {
  const bytes = new Uint8Array(epubFixture());
  const result = await convertToPdf('epub', bytes, { fileName: 'book.epub' });
  assert.ok(result.bytes.length > 0, 'EPUB conversion produced no bytes');
});

test('a PNG is not rejected as binary', async () => {
  // A 1x1 transparent PNG.
  const bytes = new Uint8Array(
    Buffer.from(
      '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
        '01f15c4890000000a49444154789c6360000002000100' +
        '05fe02fea7c2b1e40000000049454e44ae426082',
      'hex',
    ),
  );
  const result = await convertToPdf('png', bytes, { fileName: 'dot.png' });
  assert.ok(result.bytes.length > 0, 'PNG conversion produced no bytes');
});

test('the text formats still reject binary input', async () => {
  // A PDF is binary and is exactly what the guard exists to catch: dropped
  // onto the Markdown route it would otherwise be decoded as text.
  //
  // The filename carries a `.md` extension so the *extension* check passes and
  // the binary guard is what rejects it. A `.pdf` name would be refused by the
  // extension check instead, which is a different failure with a different
  // remedy, and would leave the guard untested.
  const pdf = new Uint8Array(
    Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'),
  );
  await assert.rejects(
    () => convertToPdf('markdown', pdf, { fileName: 'document.md' }),
    (error) => {
      assert.ok(error instanceof PdfEngineError);
      assert.equal(error.details.kind, 'corrupt-structure');
      assert.match(error.details.remedy, /binary/u);
      return true;
    },
  );
});

test('a text file is still converted, not rejected', async () => {
  const bytes = new Uint8Array(Buffer.from('# Title\n\nSome body text.\n', 'utf8'));
  const result = await convertToPdf('markdown', bytes, { fileName: 'note.md' });
  assert.ok(result.bytes.length > 0, 'Markdown conversion produced no bytes');
});

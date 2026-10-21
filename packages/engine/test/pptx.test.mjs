import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, decodePDFRawStream } from 'pdf-lib';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { convertToPdf, extractPdfTextPages, readPptxSlides } from '../dist/index.js';
import { child, children, descendant, parseXml } from '../dist/conversion/pptx-xml.js';
import { sanitizeForWinAnsi } from '../dist/conversion/pptx-fonts.js';

/**
 * PPTX conversion, after the renderer replaced the text dump.
 *
 * The previous implementation extracted `<a:t>` runs with a regex and wrote
 * them onto portrait Letter pages, so a slide's shapes, colours, background
 * and page size were all lost — and `textPagesToPdf` paginated, so one slide
 * could become several PDF pages.
 *
 * These tests assert the three properties that replaced it, and the two that
 * were already broken and are now fixed:
 *
 *   1. The PDF page is the slide, at the deck's own size.
 *   2. One slide is exactly one PDF page, even when the text overflows.
 *   3. The shapes and their text are actually drawn.
 *   4. A character the standard fonts cannot encode no longer aborts the
 *      conversion — it used to, with an uncaught error.
 *   5. A deck with no slide size, no relationships, and no shape tree still
 *      converts, and still keeps its text.
 *
 * The fixtures are built in the test rather than committed as binaries:
 * `pptxgenjs` is a production dependency, so a deck generated here is
 * regenerable and exercises the same OOXML PowerPoint reads, and `fflate`'s
 * `zipSync` builds the degenerate decks pptxgenjs cannot produce.
 */

/** pptxgenjs is CommonJS, so its named exports live on `.default` in Node. */
async function loadPptxGen() {
  const module = await import('pptxgenjs');
  return module.default ?? module;
}

/**
 * Build a deck with the given slides.
 *
 * `buildSlide` receives the pptxgenjs slide and the presentation, so a test
 * can add shapes, text, pictures or a background.
 */
async function buildDeck(slides) {
  const PptxGen = await loadPptxGen();
  const presentation = new PptxGen();
  presentation.layout = 'LAYOUT_WIDE';
  for (const build of slides) {
    const slide = presentation.addSlide();
    await build(slide, presentation);
  }
  const buffer = await presentation.write({ outputType: 'arraybuffer' });
  return new Uint8Array(buffer);
}

/** The content stream of a page, as text. */
function contentOf(document, pageIndex) {
  const page = document.getPage(pageIndex);
  const contents = document.context.lookup(page.node.Contents());
  const streams = [];
  for (let index = 0; index < contents.size(); index += 1) {
    const raw = document.context.lookup(contents.get(index));
    streams.push(Buffer.from(decodePDFRawStream(raw).decode()).toString('latin1'));
  }
  return streams.join('\n');
}

/**
 * The numbers in a PDF colour operator, e.g. `0.2 0.4 1 rg`.
 *
 * pdf-lib writes the channels with limited precision, so the values are
 * compared with a tolerance rather than exactly.
 */
function colorsIn(stream, operator) {
  const pattern = new RegExp(`([\\d.]+) ([\\d.]+) ([\\d.]+) ${operator}`, 'gu');
  return [...stream.matchAll(pattern)].map((match) => ({
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
  }));
}

const closeTo = (actual, expected, tolerance = 0.01) => Math.abs(actual - expected) <= tolerance;

test('a 16:9 deck produces one landscape page per slide, at the deck own size', async () => {
  const deck = await buildDeck([
    (slide) => slide.addText('First', { x: 1, y: 1, w: 6, h: 1, fontSize: 28 }),
    (slide) => slide.addText('Second', { x: 1, y: 1, w: 6, h: 1, fontSize: 28 }),
    (slide) => slide.addText('Third', { x: 1, y: 1, w: 6, h: 1, fontSize: 28 }),
  ]);

  const result = await convertToPdf('pptx', deck, { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);

  // One slide, one page. The old text-dump path could emit extra pages for a
  // slide whose text overflowed the page.
  assert.equal(document.getPageCount(), 3, 'each slide must be exactly one page');

  // 12192000 x 6858000 EMU is 13.333in x 7.5in, which is 960 x 540 pt.
  const size = document.getPage(0).getSize();
  assert.equal(Math.round(size.width), 960, 'the page width is the slide width');
  assert.equal(Math.round(size.height), 540, 'the page height is the slide height');

  // Landscape comes from the MediaBox being wider than tall, not from a
  // rotation flag: a /Rotate 90 page has a portrait MediaBox, which breaks
  // every consumer that reads the MediaBox alone.
  assert.ok(size.width > size.height, 'the page must be landscape');
  assert.equal(
    document.getPage(0).getRotation().angle,
    0,
    'orientation must not be a rotation flag',
  );
});

test('a portrait deck keeps its portrait page size', async () => {
  // The renderer must not impose landscape; it uses whatever the deck says.
  const PptxGen = await loadPptxGen();
  const presentation = new PptxGen();
  presentation.defineLayout({ name: 'PORTRAIT', width: 7.5, height: 10 });
  presentation.layout = 'PORTRAIT';
  presentation.addSlide().addText('Portrait', { x: 1, y: 1, w: 5, h: 1, fontSize: 24 });
  const buffer = await presentation.write({ outputType: 'arraybuffer' });

  const result = await convertToPdf('pptx', new Uint8Array(buffer), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const size = document.getPage(0).getSize();
  assert.equal(Math.round(size.width), 540);
  assert.equal(Math.round(size.height), 720);
  assert.ok(size.height > size.width, 'the page must be portrait');
});

test('a slide keeps its shape geometry, fill colour, and text', async () => {
  const deck = await buildDeck([
    (slide) => {
      slide.addShape(slide._parent?.ShapeType?.rect ?? 'rect', {
        x: 5,
        y: 2,
        w: 2,
        h: 1.5,
        fill: { color: '3366FF' },
      });
      slide.addText('Title Here', { x: 0.5, y: 0.6, w: 9, h: 1, fontSize: 32 });
    },
  ]);

  const result = await convertToPdf('pptx', deck, { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);

  // The rectangle sits 5in from the left and 2in from the top, and is 2in by
  // 1.5in. An inch is 72pt, so its left edge is at 360pt and its top edge at
  // 540 - 144 = 396pt.
  assert.match(stream, /1 0 0 1 360 396 cm/u, 'the shape must be placed where the deck put it');
  assert.match(stream, /144 0 l/u, 'the shape must be 2in wide');
  assert.match(stream, /0 108 l/u, 'the shape must be 1.5in tall');

  // #3366FF.
  const fills = colorsIn(stream, 'rg');
  assert.ok(
    fills.some(
      (fill) => closeTo(fill.r, 0x33 / 255) && closeTo(fill.g, 0x66 / 255) && closeTo(fill.b, 1),
    ),
    `the shape fill #3366FF must be drawn; saw ${JSON.stringify(fills)}`,
  );

  // The text is drawn at 32pt, which is the size the deck asked for.
  assert.match(stream, /32 Tf/u, 'the text must be drawn at the deck font size');
});

test('the text is readable by a reference reader, at the deck position', async () => {
  // The content stream proves something was drawn; pdf.js proves a real reader
  // can find the text. STCC asks for the second of those on a write path.
  const deck = await buildDeck([
    (slide) => slide.addText('Quarterly revenue', { x: 1, y: 1, w: 8, h: 1, fontSize: 24 }),
  ]);

  const result = await convertToPdf('pptx', deck, { fileName: 'deck.pptx' });
  const pages = await extractPdfTextPages(result.bytes);
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /Quarterly revenue/u);
});

test('a slide with far more text than fits still occupies exactly one page', async () => {
  // The old implementation wrote the extracted text onto a Letter page and
  // started a new page when the line count exceeded the page height, so one
  // slide could become two or three PDF pages.
  const deck = await buildDeck([
    (slide) =>
      slide.addText(Array.from({ length: 400 }, (_, index) => `Line number ${index}`).join('\n'), {
        x: 0.5,
        y: 0.5,
        w: 9,
        h: 7,
        fontSize: 12,
      }),
  ]);

  const result = await convertToPdf('pptx', deck, { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  assert.equal(document.getPageCount(), 1, 'an overflowing slide must not spill onto another page');
});

test('slides appear in the order the presentation lists them, not in file order', async () => {
  // The deck's `sldIdLst` is the authority for slide order; a deck whose
  // slides are numbered out of order must still render in presentation
  // order. The deck is rebuilt with a reversed list to prove the order comes
  // from the presentation and not from the file names.
  const deck = await buildDeck([
    (slide) => slide.addText('First', { x: 1, y: 1, w: 6, h: 1, fontSize: 28 }),
    (slide) => slide.addText('Second', { x: 1, y: 1, w: 6, h: 1, fontSize: 28 }),
    (slide) => slide.addText('Third', { x: 1, y: 1, w: 6, h: 1, fontSize: 28 }),
  ]);

  const files = unzipSync(deck);
  const presentation = new TextDecoder().decode(files['ppt/presentation.xml']);
  const reversed = presentation.replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/u,
    '<p:sldIdLst><p:sldId id="258" r:id="rId4"/><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst>',
  );
  const rebuilt = zipSync({ ...files, 'ppt/presentation.xml': strToU8(reversed) });

  const result = await convertToPdf('pptx', new Uint8Array(rebuilt), { fileName: 'deck.pptx' });
  const pages = await extractPdfTextPages(result.bytes);
  assert.equal(pages.length, 3);
  assert.deepEqual(
    pages.map((page) => page.text.trim()),
    ['Third', 'Second', 'First'],
    'the reversed slide list must be honoured',
  );
});

test('a character the standard fonts cannot encode does not abort the conversion', async () => {
  // "→" is not in WinAnsi. pdf-lib's `encodeText` throws on it, in
  // `widthOfTextAtSize` as well as in `drawText`, and the throw is not caught
  // by pdf-lib. Before this change a single arrow in a slide title lost the
  // entire conversion with an unhandled exception — not even a typed error.
  const deck = await buildDeck([
    (slide) => slide.addText('Revenue → growth', { x: 1, y: 1, w: 8, h: 1, fontSize: 28 }),
  ]);

  const result = await convertToPdf('pptx', deck, { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  assert.equal(document.getPageCount(), 1);

  const pages = await extractPdfTextPages(result.bytes);
  assert.match(pages[0].text, /Revenue/u, 'the text around the arrow must survive');
  assert.ok(
    result.warnings.some((warning) => /standard fonts/u.test(warning)),
    `the substitution must be reported, not silent; warnings were ${JSON.stringify(result.warnings)}`,
  );
});

test('a requested page size is refused in favour of the deck own size', async () => {
  const deck = await buildDeck([
    (slide) => slide.addText('Title', { x: 1, y: 1, w: 6, h: 1, fontSize: 28 }),
  ]);

  const result = await convertToPdf('pptx', deck, { fileName: 'deck.pptx', pageSize: 'a4' });
  const document = await PDFDocument.load(result.bytes);
  const size = document.getPage(0).getSize();
  assert.equal(Math.round(size.width), 960, 'the deck size wins over the requested one');
  assert.equal(Math.round(size.height), 540);
  assert.ok(
    result.warnings.some((warning) => /ignored/u.test(warning)),
    `the ignored option must be reported; warnings were ${JSON.stringify(result.warnings)}`,
  );
});

test('the slide background is the deck colour, not white', async () => {
  const deck = await buildDeck([
    (slide) => {
      slide.background = { color: 'EEF3FF' };
      slide.addText('Title', { x: 1, y: 1, w: 6, h: 1, fontSize: 28 });
    },
  ]);

  const result = await convertToPdf('pptx', deck, { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const fills = colorsIn(contentOf(document, 0), 'rg');
  assert.ok(
    fills.some(
      (fill) => closeTo(fill.r, 0xee / 255) && closeTo(fill.g, 0xf3 / 255) && closeTo(fill.b, 1),
    ),
    `the deck background must be drawn; saw ${JSON.stringify(fills)}`,
  );
});

test('a deck with no slide size, no relationships, and no shape tree still converts', async () => {
  // The smallest valid PPTX: a ZIP with a slide and nothing else. It has no
  // slide size and no relationship part, so both must fall back rather than
  // fail the conversion, and the slide's text must not be lost.
  const bytes = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'ppt/presentation.xml': strToU8('<?xml version="1.0"?><p:presentation xmlns:p="urn:a"/>'),
    'ppt/slides/slide1.xml': strToU8(
      '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
        '<a:p><a:r><a:t>Hello Slide One</a:t></a:r></a:p></p:sld>',
    ),
  });

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  assert.equal(document.getPageCount(), 1);

  // No declared slide size: the fallback is the 4:3 default.
  const size = document.getPage(0).getSize();
  assert.equal(Math.round(size.width), 720);
  assert.equal(Math.round(size.height), 540);

  const pages = await extractPdfTextPages(result.bytes);
  assert.match(pages[0].text, /Hello Slide One/u, "the deck's text must not be lost");
});

test('a deck that is not a ZIP fails with a typed error', async () => {
  await assert.rejects(
    () =>
      convertToPdf('pptx', new Uint8Array(Buffer.from('not a zip file at all')), {
        fileName: 'deck.pptx',
      }),
    (error) => {
      assert.equal(error.details.kind, 'conversion-failed');
      assert.equal(error.details.format, 'pptx');
      return true;
    },
  );
});

test('a deck with no slides fails with a typed error', async () => {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'ppt/presentation.xml': strToU8('<?xml version="1.0"?><p:presentation xmlns:p="urn:a"/>'),
  });
  await assert.rejects(
    () => convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' }),
    (error) => {
      assert.equal(error.details.kind, 'conversion-failed');
      return true;
    },
  );
});

test('the slide text reader reports the slides in presentation order', async () => {
  // `readPptxSlides` used to be a regex over the whole archive, so it missed
  // the presentation order and the entity references. It now reads through
  // the same scanner as the renderer.
  const deck = await buildDeck([
    (slide) => slide.addText('First', { x: 1, y: 1, w: 6, h: 1, fontSize: 28 }),
    (slide) => slide.addText('Second', { x: 1, y: 1, w: 6, h: 1, fontSize: 28 }),
  ]);

  const slides = await readPptxSlides(deck);
  assert.equal(slides.length, 2);
  assert.deepEqual(slides[0], ['First']);
  assert.deepEqual(slides[1], ['Second']);
});

test('an XML entity in a slide is decoded, not shown raw', async () => {
  // A bullet character is written as `&#x2022;` by some producers. The old
  // regex read the entity as literal text.
  const bytes = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'ppt/presentation.xml': strToU8(
      '<?xml version="1.0"?><p:presentation xmlns:p="urn:a"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
    ),
    'ppt/slides/slide1.xml': strToU8(
      '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
        '<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Tom &amp; Jerry &#x2022; caf&#233;</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    ),
  });

  const slides = await readPptxSlides(new Uint8Array(bytes));
  assert.deepEqual(slides[0], ['Tom & Jerry • café']);
});

test('the OOXML scanner reads nesting, attributes, and self-closing tags', async () => {
  // The scanner is hand-written, so it is tested directly: a bug here would
  // silently mis-render slides rather than fail loudly.
  const root = parseXml(
    '<?xml version="1.0"?><p:presentation xmlns:p="urn:p"><p:sldSz cx="12192000" cy="6858000"/>' +
      '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
  );

  assert.equal(root.name, 'p:presentation', 'the root element is returned, not a wrapper');
  assert.equal(child(root, 'p:sldSz')?.attrs.cx, '12192000');
  assert.equal(child(root, 'p:sldSz')?.attrs.cy, '6858000');
  assert.equal(children(child(root, 'p:sldIdLst'), 'p:sldId').length, 1);
  assert.equal(children(child(root, 'p:sldIdLst'), 'p:sldId')[0].attrs['r:id'], 'rId2');
});

test('a ">" inside a quoted attribute value does not split the tag', async () => {
  // A `>` inside an attribute value is legal XML and does occur in OOXML —
  // alt text and shape descriptions carry it. Scanning to the first `>`
  // would desynchronise the whole parse.
  const root = parseXml('<p:sp><p:cNvPr id="2" descr="a > b" name="Shape 1"/></p:sp>');
  const properties = child(root, 'p:cNvPr');
  assert.equal(properties?.attrs.descr, 'a > b');
  assert.equal(properties?.attrs.name, 'Shape 1');
});

test('the scanner decodes every kind of entity reference', async () => {
  const root = parseXml(
    '<a:t>Tom &amp; Jerry &lt;3 &#x2022; caf&#233; &quot;quoted&quot; &apos;single&apos;</a:t>',
  );
  assert.equal(root.text, 'Tom & Jerry <3 • café "quoted" \'single\'');
});

test('the scanner skips comments, processing instructions, and CDATA', async () => {
  const root = parseXml(
    '<?xml version="1.0"?><!-- a comment --><p:sld><a:t>kept<!-- hidden --></a:t>' +
      '<![CDATA[<raw>]]></p:sld>',
  );
  assert.equal(root.name, 'p:sld');
  assert.equal(child(root, 'a:t')?.text, 'kept');
});

test('the scanner keeps deep nesting intact', async () => {
  // A closing tag names the element being closed. Comparing it with the
  // parent instead only works for markup one level deep, and silently
  // derails the parse for anything nested.
  const root = parseXml(
    '<p:sld><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="1" y="2"/></a:xfrm></p:spPr>' +
      '</p:sp></p:spTree></p:cSld></p:sld>',
  );
  const tree = descendant(root, 'p:spTree');
  assert.ok(tree, 'the shape tree must be found at its depth');
  assert.equal(children(tree, 'p:sp').length, 1);
  assert.equal(descendant(tree, 'a:xfrm')?.name, 'a:xfrm');
});

test('a shape in an alternate-content block is drawn from its fallback', async () => {
  // PowerPoint wraps a shape in `mc:AlternateContent` when it uses a
  // 2010-era extension. The block holds a modern `mc:Choice` and a legacy
  // `mc:Fallback`; the fallback is the DrawingML form this renderer reads,
  // so the shape must still be drawn rather than silently dropped.
  const bytes = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'ppt/presentation.xml': strToU8(
      '<?xml version="1.0"?><p:presentation xmlns:p="urn:a"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
    ),
    'ppt/slides/slide1.xml': strToU8(
      '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a" xmlns:mc="urn:mc">' +
        '<p:cSld><p:spTree>' +
        '<mc:AlternateContent>' +
        '<mc:Choice Requires="p14"><p:sp><p:spPr><a:ext cx="10" cy="10"/></p:spPr></p:sp></mc:Choice>' +
        '<mc:Fallback><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="1828800"/></a:xfrm>' +
        '<a:solidFill><a:srgbClr val="3366FF"/></a:solidFill></p:spPr>' +
        '<p:txBody><a:p><a:r><a:t>Fallback shape</a:t></a:r></a:p></p:txBody></p:sp></mc:Fallback>' +
        '</mc:AlternateContent>' +
        '</p:spTree></p:cSld></p:sld>',
    ),
  });

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);

  // The fallback shape is 2in by 2in at 1in from the top-left, so it is
  // 144pt square at x=72. The slide's y axis points down and the page's up,
  // so the path is drawn through a y-flipping matrix.
  assert.match(stream, /144 0 l/u, 'the fallback shape must be 2in wide');
  assert.match(stream, /0 144 l/u, 'the fallback shape must be 2in tall');
  const fills = colorsIn(stream, 'rg');
  assert.ok(
    fills.some(
      (fill) => closeTo(fill.r, 0x33 / 255) && closeTo(fill.g, 0x66 / 255) && closeTo(fill.b, 1),
    ),
    `the fallback shape's fill must be drawn; saw ${JSON.stringify(fills)}`,
  );
  const pages = await extractPdfTextPages(result.bytes);
  assert.match(pages[0].text, /Fallback shape/u, "the fallback's text must be drawn too");
});

test('the sanitizer replaces only the characters the standard fonts cannot encode', async () => {
  // The 14 standard fonts are WinAnsi-encoded, and pdf-lib throws on an
  // unmappable code point in both `encodeText` and `widthOfTextAtSize`. The
  // table has to match the encoder exactly: a code point missing from it
  // would crash the conversion, and one wrongly included would mangle the
  // text.
  assert.equal(sanitizeForWinAnsi('plain ascii').text, 'plain ascii');
  assert.equal(
    sanitizeForWinAnsi('em—dash and “quotes” and • bullet').text,
    'em—dash and “quotes” and • bullet',
  );
  assert.equal(sanitizeForWinAnsi('café £ € ©').text, 'café £ € ©');

  // The arrows follow the mapping `sanitizeMarkdown` already uses, so the
  // product is consistent about how it renders an arrow.
  const arrow = sanitizeForWinAnsi('Revenue → growth');
  assert.equal(arrow.text, 'Revenue -> growth');
  assert.deepEqual(arrow.replaced, ['→']);

  const comparison = sanitizeForWinAnsi('a ≥ b ≠ c');
  assert.equal(comparison.text, 'a >= b != c');

  // A character with no sensible ASCII equivalent becomes a question mark,
  // the standard PDF unknown-glyph convention.
  const unknown = sanitizeForWinAnsi('日本');
  assert.equal(unknown.text, '??');
  assert.deepEqual(unknown.replaced, ['日', '本']);
});

/**
 * A deck built from raw OOXML, so a test can exercise the markup shapes a
 * generator would not produce.
 */
function rawDeck(slideXml, extra = {}) {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'ppt/presentation.xml': strToU8(
      '<?xml version="1.0"?><p:presentation xmlns:p="urn:a"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
    ),
    'ppt/slides/slide1.xml': strToU8('<?xml version="1.0"?>' + slideXml),
    ...extra,
  });
}

test('the lines of a paragraph are drawn top to bottom, not bottom to top', async () => {
  // The text block is placed from its top edge downwards. Drawing it upwards
  // put the last paragraph above the first, which is upside down.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/>' +
      '<a:ext cx="4572000" cy="1828800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/>' +
      '<a:p><a:r><a:rPr sz="1800"/><a:t>First</a:t></a:r></a:p>' +
      '<a:p><a:r><a:rPr sz="1800"/><a:t>Second</a:t></a:r></a:p>' +
      '<a:p><a:r><a:rPr sz="1800"/><a:t>Third</a:t></a:r></a:p>' +
      '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);

  // The three baselines, in the order they are drawn. The box runs from 1in
  // to 3in down the slide, which is 468pt to 324pt in page space, so "First"
  // must sit above "Second", which must sit above "Third".
  const baselines = [...stream.matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm/gu)].map((match) =>
    Number(match[1]),
  );
  assert.equal(baselines.length, 3, `expected three baselines, saw ${baselines.length}`);
  assert.ok(
    baselines[0] > baselines[1] && baselines[1] > baselines[2],
    `the lines must descend, but the baselines were ${JSON.stringify(baselines)}`,
  );
});

test('a table is drawn, not dropped', async () => {
  // A `p:graphicFrame` puts `a:off` and `a:ext` directly under its own
  // `p:xfrm`, with no inner `a:xfrm`. Reading the geometry the way a shape's
  // is read finds nothing, and the whole table disappears.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:graphicFrame><p:xfrm>' +
      '<a:off x="914400" y="914400"/><a:ext cx="4572000" cy="914400"/>' +
      '</p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' +
      '<a:tbl><a:tblGrid><a:gridCol w="4572000"/></a:tblGrid>' +
      '<a:tr h="457200"><a:tc><a:txBody><a:p><a:r><a:t>Cell text</a:t></a:r></a:p></a:txBody></a:tc></a:tr>' +
      '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>' +
      '</p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  assert.match(stream, /re/u, 'the table must draw a cell rectangle');
  const pages = await extractPdfTextPages(result.bytes);
  assert.match(pages[0].text, /Cell text/u, "the table's text must be drawn");
});

test("a table cell's text is drawn inside the cell", async () => {
  // The cells are laid out in page points, but the text inside them is laid
  // out from a box in slide EMU. Handing the text the page-point rectangle
  // put it at a fraction of its true position — the text landed near the
  // bottom of the page, nowhere near the cell it belonged to.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:graphicFrame><p:xfrm>' +
      '<a:off x="914400" y="914400"/><a:ext cx="4572000" cy="914400"/>' +
      '</p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' +
      '<a:tbl><a:tblGrid><a:gridCol w="4572000"/></a:tblGrid>' +
      '<a:tr h="457200"><a:tc><a:txBody><a:p><a:r><a:t>Cell text</a:t></a:r></a:p></a:txBody></a:tc></a:tr>' +
      '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>' +
      '</p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);

  // The cell is 1in from the left and 1in from the top, 5in by 0.5in, so it
  // spans page y 468 down to 432 — the rectangle is drawn at its bottom edge,
  // 432. Reading the cell's position as 72, the value the broken layout
  // produced, is the failure this test catches.
  const cell = /72 ([\d.]+) 360 36 re/u.exec(stream);
  assert.ok(cell, `the cell must be drawn; saw ${JSON.stringify(stream)}`);
  const cellBottom = Number(cell[1]);
  assert.ok(
    Math.abs(cellBottom - 432) < 1,
    `the cell must be drawn at page y 432, one inch below the top; got ${cellBottom}`,
  );

  const baseline = /1 0 0 1 [\d.]+ ([\d.]+) Tm/u.exec(stream);
  assert.ok(baseline, 'the cell text must be drawn');
  const textY = Number(baseline[1]);
  assert.ok(
    textY > cellBottom && textY < cellBottom + 36,
    `the text baseline ${textY} must sit inside the cell, which spans ${cellBottom} to ${cellBottom + 36}`,
  );
});

test("a deck's theme colours are read from the theme part", async () => {
  // The colour scheme lives in `ppt/theme/theme1.xml`, not in
  // `presentation.xml`. Reading it from the presentation leaves every scheme
  // colour resolving to the built-in Office default, so a deck with a red
  // `accent1` renders blue-grey.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/>' +
      '<a:ext cx="1828800" cy="914400"/></a:xfrm><a:solidFill><a:schemeClr val="accent1"/></a:solidFill>' +
      '</p:spPr></p:sp></p:spTree></p:cSld></p:sld>',
    {
      'ppt/theme/theme1.xml': strToU8(
        '<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
          '<a:themeElements><a:clrScheme name="Custom">' +
          '<a:accent1><a:srgbClr val="FF0000"/></a:accent1>' +
          '</a:clrScheme></a:themeElements></a:theme>',
      ),
    },
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const fills = colorsIn(contentOf(document, 0), 'rg');
  assert.ok(
    fills.some((fill) => closeTo(fill.r, 1) && closeTo(fill.g, 0) && closeTo(fill.b, 0)),
    `the theme's accent1 must be the fill; saw ${JSON.stringify(fills)}`,
  );
});

test('a gradient fill is drawn as its first colour, and reported', async () => {
  // A gradient stop names its colour directly — `<a:gs pos="0"><a:srgbClr
  // val="FF0000"/></a:gs>` — with no `a:solidFill` around it. Reading the
  // stops the way a fill is read finds nothing, and the shape renders with no
  // fill at all.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/>' +
      '<a:ext cx="1828800" cy="914400"/></a:xfrm>' +
      '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="00FF00"/></a:gs>' +
      '<a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst></a:gradFill>' +
      '</p:spPr></p:sp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const fills = colorsIn(contentOf(document, 0), 'rg');
  assert.ok(
    fills.some((fill) => closeTo(fill.r, 0) && closeTo(fill.g, 1) && closeTo(fill.b, 0)),
    `the gradient's first stop must be the fill; saw ${JSON.stringify(fills)}`,
  );
  assert.ok(
    result.warnings.some((warning) => /gradient/u.test(warning)),
    `the flattening must be reported; warnings were ${JSON.stringify(result.warnings)}`,
  );
});

test('a colour modifier applies to an explicit colour, not only a scheme one', async () => {
  // `srgbClr` carries the same modifiers `schemeClr` does. Ignoring them
  // draws the wrong shade — a "darkened" red that is still full red.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/>' +
      '<a:ext cx="1828800" cy="914400"/></a:xfrm>' +
      '<a:solidFill><a:srgbClr val="FF0000"><a:lumMod val="50000"/></a:srgbClr></a:solidFill>' +
      '</p:spPr></p:sp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const fills = colorsIn(contentOf(document, 0), 'rg');
  assert.ok(
    fills.some((fill) => closeTo(fill.r, 0.5) && closeTo(fill.g, 0) && closeTo(fill.b, 0)),
    `the lumMod must darken the colour; saw ${JSON.stringify(fills)}`,
  );
});

test('a bullet is drawn once per paragraph, not once per line', async () => {
  // The bullet belongs to the paragraph. Repeating it on every wrapped line
  // would draw one bullet per line of a bulleted paragraph.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/>' +
      '<a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/>' +
      '<a:p><a:pPr><a:buChar char="&#x2022;"/></a:pPr>' +
      '<a:r><a:rPr sz="1800"/><a:t>One two three four five six seven eight nine ten</a:t></a:r>' +
      '</a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  // The bullet is U+2022, encoded in WinAnsi as the byte 0x95.
  const bullets = (stream.match(/<95> Tj/gu) ?? []).length;
  assert.equal(bullets, 1, `exactly one bullet must be drawn, saw ${bullets}`);
});

test('an explicit line break starts a new line', async () => {
  // `<a:br/>` is a line break. Dropping it runs the two lines together.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/>' +
      '<a:ext cx="4572000" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/>' +
      '<a:p><a:r><a:rPr sz="1800"/><a:t>LineOne</a:t></a:r><a:br/>' +
      '<a:r><a:rPr sz="1800"/><a:t>LineTwo</a:t></a:r></a:p>' +
      '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const pages = await extractPdfTextPages(result.bytes);
  assert.deepEqual(
    pages[0].lines.map((line) => line.trim()),
    ['LineOne', 'LineTwo'],
    'the break must produce two lines',
  );
});

test('a rotated shape is drawn about its centre, not its corner', async () => {
  // OOXML rotates about the shape's centre. `drawSvgPath` rotates about the
  // path's origin, so the shape has to be drawn inside a graphics state that
  // moves the origin to the centre first.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr>' +
      '<a:xfrm rot="5400000"><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="914400"/></a:xfrm>' +
      '<a:solidFill><a:srgbClr val="3366FF"/></a:solidFill></p:spPr></p:sp>' +
      '</p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);

  // The rotation is applied about the shape's centre, so the graphics state
  // must translate to that centre before rotating. The shape is 4in by 1in at
  // 1in from the top-left, so its centre is 2in further across — 144pt — and
  // half an inch further down.
  const centreX = 72 + 288 / 2;
  const centreY = 540 - (72 + 72 / 2);
  assert.match(
    stream,
    new RegExp(`1 0 0 1 ${centreX} ${centreY} cm`, 'u'),
    `the rotation must pivot about the shape's centre at ${centreX},${centreY}`,
  );
});

test('a rotated ellipse is rotated about its centre', async () => {
  // The ellipse branch of the shape renderer has its own drawing call, and
  // that call has to carry the rotation too — otherwise a rotated ellipse
  // renders unrotated while a rotated rectangle turns.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr>' +
      '<a:xfrm rot="5400000"><a:off x="914400" y="914400"/><a:ext cx="914400" cy="914400"/></a:xfrm>' +
      '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>' +
      '<a:solidFill><a:srgbClr val="3366FF"/></a:solidFill></p:spPr></p:sp>' +
      '</p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);

  // The ellipse is 1in square at 1in from the top-left, so its centre is at
  // slide (1.5in, 1.5in) — page (108, 432). A quarter turn must be applied
  // about that point.
  assert.match(stream, /1 0 0 1 108 432 cm/u, 'the ellipse must be positioned at its centre');
  // A quarter turn is the matrix `[0 -1; 1 0]`, which pdf-lib writes with
  // floating-point noise, so only the sign pattern is asserted.
  const rotation = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) 0 0 cm/u.exec(stream);
  assert.ok(rotation, `the ellipse must be rotated; saw ${JSON.stringify(stream)}`);
  assert.ok(
    Math.abs(Number(rotation[2]) + 1) < 0.01 && Math.abs(Number(rotation[3]) - 1) < 0.01,
    `a quarter turn must be applied; the matrix was ${rotation[0]}`,
  );
});

test('a rotated shape is turned by the angle the deck asked for', async () => {
  // The turn's *pivot* was right, but its *angle* was not: pdf-lib's
  // `rotateRadians` wants radians and the renderer handed it degrees, so a
  // 45° turn came out as 45 radians — about 302°. Every rotated shape in
  // every deck was turned by the wrong amount, and the pivot test above
  // could not see it because it only checked where the turn happened.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm rot="2700000"><a:off x="914400" y="914400"/>' +
      '<a:ext cx="1828800" cy="914400"/></a:xfrm><a:solidFill><a:srgbClr val="3366FF"/></a:solidFill>' +
      '</p:spPr></p:sp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  const rotation = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) 0 0 cm/u.exec(stream);
  assert.ok(rotation, `the shape must be rotated; saw ${JSON.stringify(stream)}`);
  // The angle of the matrix is the angle of the turn. OOXML's rotation is
  // clockwise on the slide and PDF's is counter-clockwise, so the sign
  // flips.
  const angle = (Math.atan2(Number(rotation[2]), Number(rotation[1])) * 180) / Math.PI;
  assert.ok(
    Math.abs(angle + 45) < 0.5,
    `the shape must be turned 45° counter-clockwise; the matrix turns it by ${angle}°`,
  );
});

test('rotated text turns with its shape', async () => {
  // A shape's rotation is on the shape's own transform, and the text lives
  // inside the shape. The renderer turned the shape and left its text
  // level, so a rotated label came out sideways while the box around it was
  // turned.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm rot="900000"><a:off x="914400" y="914400"/>' +
      '<a:ext cx="3657600" cy="914400"/></a:xfrm></p:spPr>' +
      '<p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1800"/><a:t>Rotated</a:t></a:r></a:p></p:txBody>' +
      '</p:sp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  const rotation = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) 0 0 cm/u.exec(stream);
  assert.ok(rotation, `the text must be turned; saw ${JSON.stringify(stream)}`);
  const angle = (Math.atan2(Number(rotation[2]), Number(rotation[1])) * 180) / Math.PI;
  // `rot="900000"` is 15 degrees. OOXML's rotation is clockwise on the
  // slide and PDF's is counter-clockwise, so the sign flips. The angle
  // comes out of floating-point trigonometry, so the comparison is loose.
  assert.ok(
    Math.abs(angle + 15) < 0.5,
    `the text must be turned 15° counter-clockwise; the matrix turns it by ${angle}°`,
  );
});

test('a page range that matches no slide is a typed error', async () => {
  // A range that selects nothing used to produce a blank PDF with no
  // explanation, which reads as a broken conversion.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree/></p:cSld></p:sld>',
  );

  await assert.rejects(
    () => convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx', pageRange: [9] }),
    (error) => {
      assert.equal(error.details.kind, 'conversion-failed');
      assert.match(error.details.cause, /range/u);
      return true;
    },
  );
});

test('the slide text reader reports a bad container as a typed error', async () => {
  // The renderer reports a bad container as a typed error, and this reader
  // must not be the one place that answers with a bare `Error`.
  await assert.rejects(
    () => readPptxSlides(new Uint8Array(Buffer.from('not a zip file at all'))),
    (error) => {
      assert.equal(error.details.kind, 'conversion-failed');
      return true;
    },
  );
});

test('a shape with a scheme colour survives a colour-map override', async () => {
  // `<a:overrideClrMapping/>` is a flag, and the map it names is written as
  // its *children*. Reading the override's own attributes yields an empty
  // map, and every scheme colour on the slide then fails to resolve — so the
  // shape renders with no fill at all.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/>' +
      '<a:ext cx="1828800" cy="914400"/></a:xfrm><a:solidFill><a:schemeClr val="accent1"/></a:solidFill>' +
      '</p:spPr></p:sp></p:spTree></p:cSld>' +
      '<p:clrMapOvr><a:overrideClrMapping/></p:clrMapOvr></p:sld>',
    {
      'ppt/theme/theme1.xml': strToU8(
        '<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
          '<a:themeElements><a:clrScheme name="Custom">' +
          '<a:accent1><a:srgbClr val="FF0000"/></a:accent1>' +
          '</a:clrScheme></a:themeElements></a:theme>',
      ),
    },
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const fills = colorsIn(contentOf(document, 0), 'rg');
  assert.ok(
    fills.some((fill) => closeTo(fill.r, 1) && closeTo(fill.g, 0) && closeTo(fill.b, 0)),
    `the shape must still be filled under an override; saw ${JSON.stringify(fills)}`,
  );
});
/**
 * A deck with a master, a layout and a theme.
 *
 * The inheritance tests below need all three, and building the same three
 * parts four times would bury the thing each test is actually about.
 * `masterDeck` takes the slide XML and varies the theme's and master's
 * contents, so a test can change the one thing it is checking.
 */
function masterDeck(slideXml, { masterBodyPr = '', masterTextStyle = '' } = {}) {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'ppt/presentation.xml': strToU8(
      '<?xml version="1.0"?><p:presentation xmlns:p="urn:a"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
    ),
    'ppt/theme/theme1.xml': strToU8(
      '<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        '<a:themeElements><a:clrScheme name="Custom">' +
        '<a:dk1><a:srgbClr val="000000"/></a:dk1>' +
        '<a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
        '<a:dk2><a:srgbClr val="1F497D"/></a:dk2>' +
        '<a:lt2><a:srgbClr val="EEECE1"/></a:lt2>' +
        '<a:accent1><a:srgbClr val="4F81BD"/></a:accent1>' +
        '</a:clrScheme>' +
        '<a:fmtScheme name="Office"><a:fillStyleLst>' +
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
        '<a:solidFill><a:schemeClr val="phClr"><a:tint val="60000"/></a:schemeClr></a:solidFill>' +
        '<a:solidFill><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:solidFill>' +
        '</a:fillStyleLst><a:lnStyleLst>' +
        '<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
        '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
        '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
        '</a:lnStyleLst><a:bgFillStyleLst>' +
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
        '<a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill>' +
        '<a:solidFill><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:solidFill>' +
        '</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>',
    ),
    'ppt/slideMasters/slideMaster1.xml': strToU8(
      '<?xml version="1.0"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1"/>' +
        '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
        '<p:spPr><a:xfrm><a:off x="914400" y="1200000"/><a:ext cx="10000000" cy="3000000"/></a:xfrm></p:spPr>' +
        '<p:txBody><a:bodyPr ' +
        masterBodyPr +
        '/></p:txBody></p:sp></p:spTree>' +
        masterTextStyle +
        '</p:sldMaster>',
    ),
    'ppt/slideLayouts/slideLayout1.xml': strToU8(
      '<?xml version="1.0"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
        '<p:spPr/><p:txBody><a:bodyPr/></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>',
    ),
    'ppt/slides/slide1.xml': strToU8('<?xml version="1.0"?>' + slideXml),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>',
    ),
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>',
    ),
  });
}

/** The slide XML for a body placeholder whose text is `Body text`. */
const bodyPlaceholderSlide =
  '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
  '<p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="B"/><p:cNvSpPr/>' +
  '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
  '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Body text</a:t></a:r></a:p></p:txBody></p:sp>' +
  '</p:spTree></p:cSld></p:sld>';

test('a background that points at the theme is drawn, not left white', async () => {
  // The layout's background is a `p:bgRef` — a pointer at the theme's
  // background fill styles — and the colour it names is the theme's `bg1`.
  // Reading only `p:bgPr` finds no fill at all, so the slide renders with no
  // background: a themed deck comes out blank where the theme says it
  // should be coloured.
  const bytes = zipSync({
    ...unzipSync(
      masterDeck(
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a"><p:cSld><p:spTree/></p:cSld></p:sld>',
      ),
    ),
    'ppt/slideLayouts/slideLayout1.xml': strToU8(
      '<?xml version="1.0"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
        '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' +
        '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>',
    ),
  });

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const fills = colorsIn(contentOf(document, 0), 'rg');
  // The theme's `bg1` maps to `lt1`, which is white.
  assert.ok(
    fills.some((fill) => closeTo(fill.r, 1) && closeTo(fill.g, 1) && closeTo(fill.b, 1)),
    `the themed background must be drawn; saw ${JSON.stringify(fills)}`,
  );
});

test('a shape that points at the theme fill is drawn with that fill', async () => {
  // `<p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style>`
  // is how a shape asks for the theme's first fill, in the colour it names.
  // The theme's fill is a template whose colour is the placeholder `phClr`,
  // which the referring element's colour replaces — so the result is
  // accent1 itself.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="S"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
      '<p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style>' +
      '<p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm></p:spPr>' +
      '</p:sp></p:spTree></p:cSld></p:sld>',
    {
      'ppt/theme/theme1.xml': strToU8(
        '<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
          '<a:themeElements><a:clrScheme name="Custom">' +
          '<a:accent1><a:srgbClr val="4F81BD"/></a:accent1>' +
          '</a:clrScheme><a:fmtScheme name="Office"><a:fillStyleLst>' +
          '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
          '<a:solidFill><a:schemeClr val="phClr"><a:tint val="60000"/></a:schemeClr></a:solidFill>' +
          '<a:solidFill><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:solidFill>' +
          '</a:fillStyleLst></a:fmtScheme></a:themeElements></a:theme>',
      ),
    },
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const fills = colorsIn(contentOf(document, 0), 'rg');
  assert.ok(
    fills.some(
      (fill) =>
        closeTo(fill.r, 0x4f / 255) && closeTo(fill.g, 0x81 / 255) && closeTo(fill.b, 0xbd / 255),
    ),
    `the theme fill must be drawn in accent1; saw ${JSON.stringify(fills)}`,
  );
});

test('a paragraph keeps the line spacing the deck asked for', async () => {
  // `a:lnSpc` is the height of a line. Ignoring it collapses a deck's
  // double-spaced text into single-spaced text, which changes the slide
  // completely — and can push the last line out of its box.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/>' +
      '<a:ext cx="4572000" cy="1828800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/>' +
      '<a:p><a:pPr><a:lnSpc><a:spcPct val="200000"/></a:lnSpc></a:pPr>' +
      '<a:r><a:rPr sz="2000"/><a:t>Line one</a:t></a:r></a:p>' +
      '<a:p><a:r><a:rPr sz="2000"/><a:t>Line two</a:t></a:r></a:p>' +
      '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  const baselines = [...stream.matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm/gu)].map((match) =>
    Number(match[1]),
  );
  assert.equal(baselines.length, 2, 'both lines must be drawn');
  // 20pt text at 200% is a 48pt line: the single-line height is 20 x 1.2,
  // doubled. The default would be 24pt.
  const gap = baselines[0] - baselines[1];
  assert.ok(
    Math.abs(gap - 48) < 0.5,
    `the two baselines must be 48pt apart at 200% line spacing; got ${gap}`,
  );
});

test('a table cell keeps the padding the deck asked for', async () => {
  // A cell's margins are `a:tcPr/@marL` and friends. Reading the text body
  // instead puts the text in the wrong place — a cell with a one-inch left
  // margin has its text a full inch further right.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:graphicFrame><p:xfrm>' +
      '<a:off x="914400" y="914400"/><a:ext cx="4572000" cy="914400"/>' +
      '</p:xfrm><p:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' +
      '<a:tbl><a:tblGrid><a:gridCol w="4572000"/></a:tblGrid>' +
      '<a:tr h="457200"><a:tc><a:txBody><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody>' +
      '<a:tcPr marL="914400" marR="914400" marT="45720" marB="45720"/></a:tc></a:tr>' +
      '</a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  const baseline = /1 0 0 1 ([\d.]+) [\d.]+ Tm/u.exec(stream);
  assert.ok(baseline, 'the cell text must be drawn');
  // The cell starts an inch from the left of the slide, and its text is a
  // further inch in.
  assert.ok(
    Math.abs(Number(baseline[1]) - 144) < 0.5,
    `the cell text must sit at the cell's left margin, 144pt; got ${baseline[1]}`,
  );
});

test('a table cell that spans two columns is drawn across both', async () => {
  // `a:tc/@gridSpan` makes a cell cover several columns. Reading the cell
  // one column at a time draws it a third of its width, and the text inside
  // it wraps where it should not.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:graphicFrame><p:xfrm>' +
      '<a:off x="914400" y="914400"/><a:ext cx="4572000" cy="914400"/>' +
      '</p:xfrm><p:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' +
      '<a:tbl><a:tblGrid><a:gridCol w="2286000"/><a:gridCol w="2286000"/></a:tblGrid>' +
      '<a:tr h="457200"><a:tc gridSpan="2"><a:txBody><a:p><a:r><a:t>Span</a:t></a:r></a:p></a:txBody></a:tc>' +
      '</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  // The cell is the whole table's width: 5in, or 360pt.
  const cell = /72 ([\d.]+) 360 ([\d.]+) re/u.exec(stream);
  assert.ok(
    cell,
    `the spanning cell must be drawn across both columns; saw ${JSON.stringify(stream)}`,
  );
  assert.ok(
    Math.abs(Number(cell[2]) - 36) < 0.5,
    `the spanning cell must be 36pt tall, one row; got ${cell[2]}`,
  );
});

test('a table row grows to fit its text instead of losing it', async () => {
  // A row's declared height is a minimum. When the text needs more room
  // than that, the row has to grow — otherwise the last line is drawn below
  // the cell's floor and clipped away, and the table silently loses a row
  // of data.
  const words = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
  const paragraphs = words
    .map((word) => `<a:p><a:r><a:rPr sz="1200"/><a:t>${word}</a:t></a:r></a:p>`)
    .join('');
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:graphicFrame><p:xfrm>' +
      '<a:off x="914400" y="914400"/><a:ext cx="4572000" cy="457200"/>' +
      '</p:xfrm><p:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' +
      '<a:tbl><a:tblGrid><a:gridCol w="4572000"/></a:tblGrid>' +
      `<a:tr h="457200"><a:tc><a:txBody>${paragraphs}</a:txBody></a:tc></a:tr>` +
      '</a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  const drawn = [...stream.matchAll(/<([0-9a-fA-F]+)> Tj/gu)].map((match) =>
    Buffer.from(match[1], 'hex').toString('latin1'),
  );
  for (const word of words) {
    assert.ok(drawn.includes(word), `the row must keep "${word}"; drew ${JSON.stringify(drawn)}`);
  }
  // The last line must land inside the cell, whose floor is the bottom of
  // the grown row.
  const baselines = [...stream.matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm/gu)].map((match) =>
    Number(match[1]),
  );
  const cell = /72 ([\d.]+) ([\d.]+) ([\d.]+) re/u.exec(stream);
  assert.ok(cell, 'the cell must be drawn');
  const floor = Number(cell[1]);
  const last = baselines[baselines.length - 1];
  assert.ok(
    last > floor,
    `the last line's baseline ${last} must sit above the cell floor ${floor}`,
  );
});

test('a table cell that declares no borders gets no box', async () => {
  // A cell names its four borders separately, and each may say "no fill" or
  // have a width of zero. Drawing a default grid on such a cell puts a box
  // on a slide that asked for none.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:graphicFrame><p:xfrm>' +
      '<a:off x="914400" y="914400"/><a:ext cx="4572000" cy="914400"/>' +
      '</p:xfrm><p:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' +
      '<a:tbl><a:tblGrid><a:gridCol w="4572000"/></a:tblGrid>' +
      '<a:tr h="457200"><a:tc><a:txBody><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody>' +
      '<a:tcPr><a:lnL w="0"><a:noFill/></a:lnL><a:lnR w="0"><a:noFill/></a:lnR>' +
      '<a:lnT w="0"><a:noFill/></a:lnT><a:lnB w="0"><a:noFill/></a:lnB></a:tcPr></a:tc></a:tr>' +
      '</a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  // The cell's rectangle is drawn as a stroke; a cell with no borders has
  // none, so nothing is stroked.
  const strokes = [...stream.matchAll(/h\nS/gu)].length;
  assert.equal(
    strokes,
    0,
    `a cell that declares no borders must not be stroked; saw ${JSON.stringify(stream)}`,
  );
});

test('text inside a scaled group is scaled with it', async () => {
  // A group scales its children's text along with their geometry. Laying the
  // text out at the unscaled size puts it outside the group's box, and the
  // group's own clip then cuts it away.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:grpSp><p:grpSpPr><a:xfrm><a:off x="914400" y="914400"/>' +
      '<a:ext cx="4572000" cy="914400"/><a:chOff x="0" y="0"/><a:chExt cx="9144000" cy="914400"/>' +
      '</a:xfrm></p:grpSpPr>' +
      '<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="914400"/></a:xfrm></p:spPr>' +
      '<p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2000"/><a:t>Grouped</a:t></a:r></a:p></p:txBody>' +
      '</p:sp></p:grpSp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  const baseline = /1 0 0 1 ([\d.]+) [\d.]+ Tm/u.exec(stream);
  assert.ok(baseline, 'the grouped text must be drawn');
  // The group starts an inch from the left, and the text box's own
  // one-tenth inch inset is halved with the group: 72 + 3.6 = 75.6.
  assert.ok(
    Math.abs(Number(baseline[1]) - 75.6) < 0.5,
    `the grouped text must sit at the scaled inset, 75.6pt; got ${baseline[1]}`,
  );
});

test('a rotated group rotates its children', async () => {
  // A group's `a:xfrm/@rot` turns the whole group. Dropping it leaves the
  // children in place, so a rotated group renders as an unrotated one.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:grpSp><p:grpSpPr><a:xfrm rot="2700000">' +
      '<a:off x="4572000" y="4572000"/><a:ext cx="1828800" cy="914400"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="1828800" cy="914400"/></a:xfrm></p:grpSpPr>' +
      '<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>' +
      '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp>' +
      '</p:grpSp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  // A 45° turn is the matrix [[cos, -sin], [sin, cos]] with both about 0.707.
  const rotation = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) 0 0 cm/u.exec(stream);
  assert.ok(rotation, `the group must be rotated; saw ${JSON.stringify(stream)}`);
  assert.ok(
    Math.abs(Number(rotation[1]) - 0.7071) < 0.01 && Math.abs(Number(rotation[2]) + 0.7071) < 0.01,
    `a 45° turn must be applied; the matrix was ${rotation[0]}`,
  );
});

test('a placeholder takes its geometry from the master when the layout has none', async () => {
  // A layout's placeholder frequently declares no `a:xfrm` — it defers to
  // the master's. Looking only at the layout then finds no box, and the
  // slide's title is not drawn at all.
  const bytes = masterDeck(bodyPlaceholderSlide);

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  const pages = await extractPdfTextPages(result.bytes);
  assert.match(pages[0].text, /Body text/u, "the inherited placeholder's text must be drawn");
  // The master's box is an inch from the left, so the text is clipped to a
  // rectangle that starts at 72 on the x axis.
  assert.match(
    stream,
    /72 [\d.]+ 787\.4[\d.]* 236\.2[\d.]* re/u,
    `the text must be clipped to the master's geometry; saw ${JSON.stringify(stream)}`,
  );
});

test("a placeholder inherits the master's bullet, alignment and size", async () => {
  // The master's body style says how its body text looks: the bullet, the
  // alignment, the size and the colour. Reading only the master's run
  // properties throws all the paragraph properties away, so the slides come
  // out with no bullets and the wrong alignment.
  const bytes = masterDeck(bodyPlaceholderSlide, {
    masterTextStyle:
      '<p:txStyles><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900" algn="r">' +
      '<a:buChar char="&#x2022;"/><a:defRPr sz="2400" b="1">' +
      '<a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:defRPr>' +
      '</a:lvl1pPr></p:bodyStyle></p:txStyles>',
  });

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  // The size comes from the master's `a:defRPr`.
  assert.match(
    stream,
    /\/[A-Za-z-]+[\d.]* 24 Tf/u,
    `the master's size must be used; saw ${stream}`,
  );
  // The colour comes from it too.
  assert.ok(
    colorsIn(stream, 'rg').some((fill) => closeTo(fill.r, 0) && closeTo(fill.b, 1)),
    `the master's colour must be used; saw ${JSON.stringify(colorsIn(stream, 'rg'))}`,
  );
  // The bullet is the master's, and it is a separate text object from the
  // paragraph's own text.
  const drawn = [...stream.matchAll(/<([0-9a-fA-F]+)> Tj/gu)].map((match) =>
    Buffer.from(match[1], 'hex').toString('latin1'),
  );
  assert.ok(
    drawn.some((text) => text !== 'Body text'),
    `the master's bullet must be drawn; drew ${JSON.stringify(drawn)}`,
  );
  // The text is right-aligned, so it ends at the right edge of its box
  // rather than starting at its left. The bullet is a separate text object
  // and stays at the left margin, so the *last* one is the paragraph.
  const baselines = [...stream.matchAll(/1 0 0 1 ([\d.]+) [\d.]+ Tm/gu)].map((match) =>
    Number(match[1]),
  );
  assert.ok(baselines.length >= 2, 'the bullet and the text must both be drawn');
  const text = baselines[baselines.length - 1];
  assert.ok(text > 500, `the right-aligned text must sit at the right of its box; got ${text}`);
});

test('a placeholder inherits the master insets', async () => {
  // The master's placeholder sets a one-inch left inset. The slide writes
  // an empty `a:bodyPr`, which inherits the master's attributes rather than
  // resetting them — so the text sits a full inch in.
  const bytes = masterDeck(bodyPlaceholderSlide, { masterBodyPr: 'lIns="914400"' });

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentOf(document, 0);
  const baseline = /1 0 0 1 ([\d.]+) [\d.]+ Tm/u.exec(stream);
  assert.ok(baseline, 'the text must be drawn');
  // The master's box starts an inch from the left, and the inherited inset
  // adds another inch.
  assert.ok(
    Math.abs(Number(baseline[1]) - 144) < 0.5,
    `the text must sit at the inherited inset, 144pt; got ${baseline[1]}`,
  );
});

test('a placeholder inherits the layout fill', async () => {
  // A layout's placeholder may carry a fill — a coloured banner behind a
  // title, say. A slide that uses that placeholder without declaring a fill
  // of its own shows the banner; dropping the inheritance loses it.
  const bytes = zipSync({
    ...unzipSync(masterDeck(bodyPlaceholderSlide)),
    'ppt/slideLayouts/slideLayout1.xml': strToU8(
      '<?xml version="1.0"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
        '<p:spPr><a:xfrm><a:off x="914400" y="1200000"/><a:ext cx="10000000" cy="3000000"/></a:xfrm>' +
        '<a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></p:spPr>' +
        '<p:txBody><a:bodyPr/></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>',
    ),
  });

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const fills = colorsIn(contentOf(document, 0), 'rg');
  assert.ok(
    fills.some((fill) => closeTo(fill.r, 0) && closeTo(fill.g, 1) && closeTo(fill.b, 0)),
    `the layout's fill must reach the slide; saw ${JSON.stringify(fills)}`,
  );
});
/**
 * The geometry of a rendered slide, measured rather than assumed.
 *
 * A deck states each shape's box in EMU; the PDF must draw it at exactly
 * that place, at that size, in page points. These tests assert the drawn
 * geometry on the content stream, so a renderer that puts a shape in the
 * wrong place — or draws the wrong diagonal, or lets text spill out of its
 * box — fails here rather than in a reader.
 */

/** The text of a page's content stream. */
function contentStreamOf(document, pageIndex) {
  return contentOf(document, pageIndex);
}

/**
 * The baseline positions of every text object on a page.
 */
function baselinesIn(stream) {
  return [...stream.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/gu)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
}

/** The clip rectangles in a stream, as `x y width height`. */
function clipsIn(stream) {
  return [...stream.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re\nW/gu)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
    width: Number(match[3]),
    height: Number(match[4]),
  }));
}

test('the slide size becomes the page size exactly', async () => {
  // The page must be the slide, at the deck's own size and nothing else.
  // A 1000 x 700pt slide is not a round number of inches, so a renderer
  // that rounded or scaled would land on the wrong page size.
  const bytes = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'ppt/presentation.xml': strToU8(
      '<?xml version="1.0"?><p:presentation xmlns:p="urn:a"><p:sldSz cx="12700000" cy="8890000"/></p:presentation>',
    ),
    'ppt/slides/slide1.xml': strToU8(
      '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
        '<p:cSld><p:spTree/></p:cSld></p:sld>',
    ),
  });

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const page = document.getPage(0);
  const size = page.getSize();
  assert.equal(size.width, 1000, 'the page width is the slide width');
  assert.equal(size.height, 700, 'the page height is the slide height');
  // The MediaBox, not only the convenience accessor.
  const mediaBox = page.node.MediaBox().asArray().map(Number);
  assert.deepEqual(mediaBox, [0, 0, 1000, 700], 'the MediaBox is the slide');
});

test('a shape is drawn at the box the deck declared', async () => {
  // A shape 2in by 1in, an inch from the top-left, on a 16:9 slide. It
  // must land at 72, 468 and be 144 by 72 — the slide's y axis points down
  // and the page's points up, so the shape's top edge is its *bottom* edge
  // in page space.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/>' +
      '<a:ext cx="1828800" cy="914400"/></a:xfrm><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>' +
      '</p:spPr></p:sp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentStreamOf(document, 0);
  assert.match(stream, /1 0 0 1 72 468 cm/u, 'the shape must be placed at 72, 468');
  assert.match(stream, /144 0 l/u, 'the shape must be 2in wide');
  assert.match(stream, /0 72 l/u, 'the shape must be 1in tall');
});

test('a shape is clipped to the page, not painted past its edge', async () => {
  // A slide's shapes may hang off the slide's edge — a bleeding image, a
  // shape dragged past the margin. The page clips them, so nothing paints
  // outside it.
  //
  // The clip belongs to the graphics state, so a renderer that pushed the
  // state, set the clip, and popped it straight away discarded the clip and
  // the shape painted off the page.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="-914400" y="914400"/>' +
      '<a:ext cx="1828800" cy="914400"/></a:xfrm><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>' +
      '</p:spPr></p:sp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentStreamOf(document, 0);

  // The page clip is opened at the very start of the page's content and
  // stays in force: the graphics state it was pushed in is not popped until
  // the end of the slide.
  assert.match(
    stream,
    /^q\n0 0 960 540 re\nW\n/u,
    `the page clip must open the page's content; saw ${JSON.stringify(stream.slice(0, 120))}`,
  );
  const stateCloses = [...stream.matchAll(/^Q$/gmu)].length;
  const stateOpens = [...stream.matchAll(/^q$/gmu)].length;
  assert.equal(
    stateOpens,
    stateCloses,
    'every pushed graphics state must be popped, or the page ends inside one',
  );
  // The clip is the first thing, and the shape is drawn after it, so the
  // shape is inside the clipped region.
  const clipAt = stream.indexOf('0 0 960 540 re');
  const shapeAt = stream.indexOf('-72 468 cm');
  assert.ok(clipAt >= 0, 'the page must be clipped');
  assert.ok(shapeAt > clipAt, 'the shape must be drawn inside the clip');
});

test('a line shape runs from its top-left to its bottom-right', async () => {
  // A `prst="line"` is a diagonal: OOXML draws it from the box's top-left
  // to its bottom-right. The renderer drew the other diagonal, so every
  // connector in a deck came out mirrored.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/>' +
      '<a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>' +
      '<a:ln w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>' +
      '</p:spPr></p:sp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentStreamOf(document, 0);
  // The box spans x 72..216 and y 396..468 in page points. The line runs
  // from the top-left (72, 468) down to the bottom-right (216, 396).
  assert.match(
    stream,
    /72 468 m/u,
    `the line must start at the box's top-left, 72,468; saw ${JSON.stringify(stream)}`,
  );
  assert.match(stream, /216 396 l/u, "the line must end at the box's bottom-right, 216,396");
});

test('a mirrored shape is drawn mirrored', async () => {
  // `a:xfrm/@flipH` mirrors the shape about its own centre. A right
  // triangle has its right angle at the top-left; mirrored, it has it at the
  // top-right. Ignoring the flip drew the shape the wrong way round.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:sp><p:spPr><a:xfrm flipH="1"><a:off x="914400" y="914400"/>' +
      '<a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rtTriangle"><a:avLst/></a:prstGeom>' +
      '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentStreamOf(document, 0);
  // The reflection about the shape's centre is a scale of -1 on the x axis.
  assert.match(
    stream,
    /-1 0 0 1 0 0 cm/u,
    `the shape must be mirrored about its centre; saw ${JSON.stringify(stream)}`,
  );
});

test('a rotated picture is drawn rotated', async () => {
  // A picture may carry a rotation, and pdf-lib's `drawImage` has no option
  // for one. The renderer ignored it, so a rotated image came out square.
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DAwMDAxMDAwMAAAA4EAQGyDwUOAAAAAElFTkSuQmCC',
      'base64',
    ),
  );
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a" xmlns:r="urn:r">' +
      '<p:cSld><p:spTree><p:pic><p:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch>' +
      '</p:blipFill><p:spPr><a:xfrm rot="2700000"><a:off x="914400" y="914400"/>' +
      '<a:ext cx="1828800" cy="1828800"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>',
    {
      'ppt/slides/_rels/slide1.xml.rels': strToU8(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
      ),
      'ppt/media/image1.png': png,
    },
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentStreamOf(document, 0);
  // The turn is applied as a graphics state about the picture's centre. The
  // matrix is [[cos, -sin], [sin, cos]] scaled by the picture's own aspect
  // ratio, so the signs and the ratio between the entries are what identify
  // it, not the absolute values.
  const rotation = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) 0 0 cm/u.exec(stream);
  assert.ok(rotation, `the picture must be rotated; saw ${JSON.stringify(stream)}`);
  const [a, b, c, d] = rotation.slice(1).map(Number);
  assert.ok(
    Math.abs(a - d) < 0.01 && Math.abs(b + c) < 0.01,
    `a turn has equal diagonal entries and opposite off-diagonal ones; the matrix was ${rotation[0]}`,
  );
  // A 45° turn has |tan| = 1, so the off-diagonal entry is as large as the
  // diagonal one.
  assert.ok(
    Math.abs(Math.abs(c / a) - 1) < 0.01,
    `a 45° turn has equal diagonal and off-diagonal magnitudes; the matrix was ${rotation[0]}`,
  );
  // The turn is about the picture's centre, so the graphics state moves the
  // origin there and back.
  assert.match(
    stream,
    /1 0 0 1 144 396 cm/u,
    `the turn must pivot about the picture's centre; saw ${JSON.stringify(stream)}`,
  );
});

test('text in a scaled group stays inside the group', async () => {
  // A group scales its children. The child shape's own box is 8in wide, but
  // the group it sits in is only 4in wide, so the text has to wrap against
  // the 4in the group occupies.
  //
  // Laying the text out against the 8in box and then scaling it drew a line
  // twice as wide as the group, and the group's own clip cut it in half.
  const bytes = rawDeck(
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="urn:a">' +
      '<p:cSld><p:spTree><p:grpSp><p:grpSpPr><a:xfrm><a:off x="914400" y="914400"/>' +
      '<a:ext cx="3657600" cy="914400"/><a:chOff x="0" y="0"/><a:chExt cx="7315200" cy="914400"/>' +
      '</a:xfrm></p:grpSpPr>' +
      '<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7315200" cy="914400"/></a:xfrm></p:spPr>' +
      '<p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2000"/>' +
      '<a:t>Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet Kilo Lima</a:t>' +
      '</a:r></a:p></p:txBody></p:sp></p:grpSp></p:spTree></p:cSld></p:sld>',
  );

  const result = await convertToPdf('pptx', new Uint8Array(bytes), { fileName: 'deck.pptx' });
  const document = await PDFDocument.load(result.bytes);
  const stream = contentStreamOf(document, 0);

  // The group is 4in wide, so 288pt, starting at 72.
  const groupClip = clipsIn(stream).find(
    (clip) => Math.abs(clip.x - 72) < 0.5 && Math.abs(clip.width - 288) < 0.5,
  );
  assert.ok(
    groupClip,
    `the group must be clipped to its own box; saw ${JSON.stringify(clipsIn(stream))}`,
  );

  // Every line must start inside the group, and the text must have wrapped
  // into more than one line rather than running off the end.
  const baselines = baselinesIn(stream);
  assert.ok(
    baselines.length >= 2,
    `the text must wrap inside the group; drew ${baselines.length} line(s)`,
  );
  for (const baseline of baselines) {
    assert.ok(
      baseline.x >= groupClip.x - 0.5 && baseline.x < groupClip.x + groupClip.width,
      `every line must start inside the group, which spans ${groupClip.x}..${groupClip.x + groupClip.width}; got ${baseline.x}`,
    );
  }
});

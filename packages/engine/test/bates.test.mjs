import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import {
  addBatesNumbering,
  batesAnchorX,
  formatBatesLabel,
  resolveBatesAlignment,
  resolveBatesNumberingType,
} from '../dist/index.js';

/**
 * The Bates stamp's own text and position.
 *
 * The bates op had no test asserting what it draws: `addBatesNumbering` was
 * exercised only for page count, so a stamp that read "000001" when the user
 * asked for roman numerals, or that sat on the wrong edge, passed the whole
 * suite. These assertions are on the drawn text and the drawn x-coordinate,
 * because those are the two things a user sees.
 *
 * `formatBatesLabel` is the pure half and is tested directly; the PDF tests
 * confirm the pure half is what actually reaches the page.
 */

const fixture = (name) => new URL(`../../../fixtures/pdfs/${name}`, import.meta.url);
const bytes = async (name) => new Uint8Array(await readFile(fixture(name)));

/**
 * The drawn text operators of a page, decoded.
 *
 * The content stream is Flate-compressed and split across several objects, so
 * the text is only visible after every part is decoded and concatenated. The
 * `Tm` operator carries the x-coordinate the text was drawn at, which is how
 * the alignment assertions below read the anchor back out of the file rather
 * than trusting the function that produced it.
 */
const drawnText = async (document, pageIndex = 0) => {
  const page = document.getPage(pageIndex);
  const parts = document.context.lookup(page.node.Contents());
  let raw = '';
  for (const reference of parts.asArray()) {
    const stream = document.context.lookup(reference);
    if (stream instanceof PDFRawStream)
      raw += Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  }
  const texts = [];
  for (const match of raw.matchAll(/<([0-9a-fA-F]+)>\s*Tj/gmu)) {
    texts.push(Buffer.from(match[1], 'hex').toString('latin1'));
  }
  const positions = [...raw.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/gu)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
  return { texts, positions };
};

test('the numeric stamp keeps the zero-padded form the tool always produced', () => {
  // The default: six digits, zero-padded. This is the form every earlier
  // release emitted, and it is what the parity fixture was recorded against.
  assert.equal(formatBatesLabel(1, { padding: 6 }), '000001');
  assert.equal(formatBatesLabel(42, { padding: 6 }), '000042');
  assert.equal(formatBatesLabel(1, {}), '000001', 'the padding default is six');
  assert.equal(formatBatesLabel(123456, { padding: 6 }), '123456');
});

test('a number wider than the padding is not truncated', () => {
  // padStart never truncates, and a stamp that silently dropped digits would
  // break the one property a Bates number must have: it identifies a page.
  assert.equal(formatBatesLabel(1234567, { padding: 6 }), '1234567');
  assert.equal(formatBatesLabel(0, { padding: 4 }), '0000');
});

test('the prefix and the suffix bracket the number', () => {
  assert.equal(formatBatesLabel(7, { prefix: 'AB-', suffix: '-CD', padding: 3 }), 'AB-007-CD');
  assert.equal(formatBatesLabel(7, { prefix: 'AB-', padding: 3 }), 'AB-007');
  assert.equal(formatBatesLabel(7, { suffix: '-CD', padding: 3 }), '007-CD');
  assert.equal(formatBatesLabel(7, { padding: 3 }), '007');
});

test('roman numerals are written in upper or lower case', () => {
  const upper = { numberingType: 'roman-uppercase' };
  const lower = { numberingType: 'roman-lowercase' };
  assert.equal(formatBatesLabel(1, upper), 'I');
  assert.equal(formatBatesLabel(4, upper), 'IV');
  assert.equal(formatBatesLabel(9, upper), 'IX');
  assert.equal(formatBatesLabel(14, upper), 'XIV');
  assert.equal(formatBatesLabel(40, upper), 'XL');
  assert.equal(formatBatesLabel(90, upper), 'XC');
  assert.equal(formatBatesLabel(400, upper), 'CD');
  assert.equal(formatBatesLabel(900, upper), 'CM');
  assert.equal(formatBatesLabel(1984, upper), 'MCMLXXXIV');
  assert.equal(formatBatesLabel(2024, upper), 'MMXXIV');
  assert.equal(formatBatesLabel(3999, upper), 'MMMCMXCIX');
  // The two cases differ only in case, and the lowercase form is the exact
  // inverse of the uppercase one.
  assert.equal(formatBatesLabel(1984, lower), 'mcmlxxxiv');
  for (const value of [1, 4, 9, 14, 40, 90, 400, 900, 1984, 3999]) {
    assert.equal(
      formatBatesLabel(value, lower),
      formatBatesLabel(value, upper).toLowerCase(),
      `roman case must agree at ${value}`,
    );
  }
});

test('the subtractive pairs are used rather than the additive ones', () => {
  // 4 is IV, not IIII; 9 is IX, not VIIII. This is what distinguishes a roman
  // numeral from a string of letters.
  assert.equal(formatBatesLabel(4, { numberingType: 'roman-uppercase' }), 'IV');
  assert.equal(formatBatesLabel(9, { numberingType: 'roman-uppercase' }), 'IX');
  assert.equal(formatBatesLabel(40, { numberingType: 'roman-uppercase' }), 'XL');
  assert.equal(formatBatesLabel(49, { numberingType: 'roman-uppercase' }), 'XLIX');
  assert.equal(formatBatesLabel(99, { numberingType: 'roman-uppercase' }), 'XCIX');
});

test('a roman numeral is never zero-padded', () => {
  // "0000IV" is not a number in any format, and the padding exists to make
  // numeric stamps line up as a column. It must not apply to the others.
  assert.equal(formatBatesLabel(4, { numberingType: 'roman-uppercase', padding: 6 }), 'IV');
  assert.equal(formatBatesLabel(4, { numberingType: 'roman-lowercase', padding: 6 }), 'iv');
  assert.equal(formatBatesLabel(4, { numberingType: 'alphabetical-lowercase', padding: 6 }), 'd');
});

test('alphabetical numbering runs a to z, then aa', () => {
  const letters = { numberingType: 'alphabetical-lowercase' };
  assert.equal(formatBatesLabel(1, letters), 'a');
  assert.equal(formatBatesLabel(2, letters), 'b');
  assert.equal(formatBatesLabel(26, letters), 'z');
  // Bijective base-26: there is no "zero" column, so the 27th is "aa" and
  // not "ba".
  assert.equal(formatBatesLabel(27, letters), 'aa');
  assert.equal(formatBatesLabel(28, letters), 'ab');
  assert.equal(formatBatesLabel(52, letters), 'az');
  assert.equal(formatBatesLabel(53, letters), 'ba');
  assert.equal(formatBatesLabel(702, letters), 'zz');
  assert.equal(formatBatesLabel(703, letters), 'aaa');
});

test('the alphabetical sequence is contiguous across the 26 to 27 boundary', () => {
  // The boundary is where a naive implementation breaks: if the carry were
  // written as base-26, letter 27 would come out as "ba" and skip "aa".
  const letters = { numberingType: 'alphabetical-lowercase' };
  const expected = [];
  for (let value = 1; value <= 30; value += 1) expected.push(formatBatesLabel(value, letters));
  // `expected[0]` is the stamp for 1, so the stamp for a value is at
  // `expected[value - 1]`.
  assert.deepEqual(expected.slice(0, 3), ['a', 'b', 'c']);
  assert.deepEqual(expected.slice(22, 26), ['w', 'x', 'y', 'z']);
  assert.deepEqual(expected.slice(26, 30), ['aa', 'ab', 'ac', 'ad']);
});

test('an unrecognised numbering type falls back to numeric', () => {
  // A recipe link written against a newer build must still stamp a document
  // rather than fail outright.
  assert.equal(resolveBatesNumberingType('bogus'), 'numeric');
  assert.equal(resolveBatesNumberingType(undefined), 'numeric');
  assert.equal(resolveBatesNumberingType(''), 'numeric');
  assert.equal(formatBatesLabel(7, { numberingType: 'bogus', padding: 4 }), '0007');
  // A value from a future build is treated the same way.
  assert.equal(resolveBatesNumberingType('roman-uppercase-and-more'), 'numeric');
});

test('a recognised numbering type is returned unchanged', () => {
  for (const type of ['numeric', 'roman-lowercase', 'roman-uppercase', 'alphabetical-lowercase']) {
    assert.equal(resolveBatesNumberingType(type), type);
  }
});

test('alignment wins over the position it is set alongside', () => {
  // The alignment is the explicit choice, so it must beat the horizontal
  // half of the position — otherwise a user who picked "Left" on a
  // bottom-right stamp would still get it on the right.
  assert.equal(resolveBatesAlignment('left', 'bottom-right'), 'left');
  assert.equal(resolveBatesAlignment('center', 'bottom-right'), 'center');
  assert.equal(resolveBatesAlignment('right', 'bottom-left'), 'right');
});

test('an absent alignment falls back to the horizontal half of the position', () => {
  // A recipe written before alignment existed keeps stamping where it did.
  assert.equal(resolveBatesAlignment(undefined, 'bottom-left'), 'left');
  assert.equal(resolveBatesAlignment(undefined, 'top-left'), 'left');
  assert.equal(resolveBatesAlignment(undefined, 'bottom-center'), 'center');
  assert.equal(resolveBatesAlignment(undefined, 'top-center'), 'center');
  assert.equal(resolveBatesAlignment(undefined, 'bottom-right'), 'right');
  assert.equal(resolveBatesAlignment(undefined, 'top-right'), 'right');
  // An unrecognised alignment is ignored the same way.
  assert.equal(resolveBatesAlignment('diagonal', 'bottom-left'), 'left');
});

test('the three anchors sit where the option says they do', () => {
  // The same offsets the tool has always used, so the default stamp does not
  // move.
  assert.equal(batesAnchorX('left', 612), 24);
  assert.equal(batesAnchorX('center', 612), 612 / 2 - 20);
  assert.equal(batesAnchorX('right', 612), 612 - 80);
  // The right anchor follows the page width; the left one does not.
  assert.equal(batesAnchorX('right', 300), 220);
  assert.equal(batesAnchorX('left', 300), 24);
  assert.equal(batesAnchorX('center', 300), 130);
});

test('the stamped PDF carries the requested format', async () => {
  // The end of the chain: the label the pure function produced is the text
  // actually drawn on the page.
  const source = await bytes('two-page.pdf');
  for (const [type, expected] of [
    ['numeric', ['000001', '000002']],
    ['roman-uppercase', ['I', 'II']],
    ['roman-lowercase', ['i', 'ii']],
    ['alphabetical-lowercase', ['a', 'b']],
  ]) {
    const stamped = await addBatesNumbering(source, { numberingType: type, padding: 6 });
    const document = await PDFDocument.load(stamped);
    const first = await drawnText(document, 0);
    const second = await drawnText(document, 1);
    assert.deepEqual(first.texts.slice(-1), [expected[0]], `${type} on page 1`);
    assert.deepEqual(second.texts.slice(-1), [expected[1]], `${type} on page 2`);
  }
});

test('the stamped PDF draws the number at the requested anchor', async () => {
  // The x-coordinate is read back out of the content stream, so this asserts
  // where the text actually landed rather than what the helper returned.
  const source = await bytes('one-page.pdf');
  for (const [alignment, expected] of [
    ['left', 24],
    ['center', 130],
    ['right', 220],
  ]) {
    const stamped = await addBatesNumbering(source, { prefix: 'X-', padding: 3, alignment });
    const document = await PDFDocument.load(stamped);
    const { texts, positions } = await drawnText(document, 0);
    // The fixture page is 300 wide, and the last drawn text is the stamp.
    const stamp = positions.at(-1);
    assert.equal(stamp.x, expected, `${alignment} anchor`);
    assert.ok(texts.at(-1)?.endsWith('X-001'), `${alignment} drew the stamp`);
  }
});

test('the stamp sits on the vertical half the position names', async () => {
  const source = await bytes('one-page.pdf');
  const bottom = await addBatesNumbering(source, { position: 'bottom-right' });
  const top = await addBatesNumbering(source, { position: 'top-right' });
  const bottomY = (await drawnText(await PDFDocument.load(bottom), 0)).positions.at(-1)?.y;
  const topY = (await drawnText(await PDFDocument.load(top), 0)).positions.at(-1)?.y;
  assert.equal(bottomY, 18);
  assert.ok(topY > bottomY, 'a top stamp sits above a bottom one');
});

test('the default stamp is unchanged by the new options', async () => {
  // The property the parity fixture depends on: with no new option set, the
  // bytes are what they were before the numbering type and alignment existed.
  // If this regresses, `fixtures/parity/cli-output.sha256` is stale.
  const source = await bytes('one-page.pdf');
  const before = await addBatesNumbering(source, { prefix: 'PARITY-' });
  const after = await addBatesNumbering(source, {
    prefix: 'PARITY-',
    numberingType: 'numeric',
    alignment: 'right',
  });
  assert.deepEqual(Buffer.from(after), Buffer.from(before));
});

test('an unknown numbering type on the operation still stamps numerically', async () => {
  // The operation resolves the type rather than trusting it, so a bad value
  // reaches the page as a numeric stamp instead of an empty one.
  const source = await bytes('one-page.pdf');
  const stamped = await addBatesNumbering(source, { numberingType: 'bogus', padding: 4 });
  const { texts } = await drawnText(await PDFDocument.load(stamped), 0);
  assert.equal(texts.at(-1), '0001');
});

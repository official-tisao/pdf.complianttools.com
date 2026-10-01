import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { deskew, estimateSkew } from '../dist/index.js';

const FIXTURES = new URL('../../../fixtures/p7-04/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('skew-manifest.json', FIXTURES), 'utf8'));

/**
 * Decodes the fixture PNGs with a minimal, strict reader written here rather
 * than with the inverse of the encoder that wrote them.
 *
 * Using the writer's own inverse to validate the writer would prove only that
 * the two agree with each other: a bug that corrupted the pixels identically in
 * both directions would pass unnoticed. This reader parses the chunk structure
 * itself and refuses anything it does not understand, so a malformed fixture
 * fails loudly instead of decoding to plausible garbage.
 *
 * This is the same cross-check the PDF write paths get from pdf.js (SFCC); it
 * is a strict reader, not a second opinion from a general-purpose codec.
 */
function readGrayscalePng(bytes) {
  const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let index = 0; index < SIGNATURE.length; index += 1) {
    if (bytes[index] !== SIGNATURE[index]) throw new Error('not a PNG');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  let colourType = -1;
  let bitDepth = -1;
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      bitDepth = data[8];
      colourType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG is not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (bitDepth !== 8 || colourType !== 0)
    throw new Error(`expected 8-bit grayscale, got depth ${bitDepth} type ${colourType}`);
  return { width, height, idat: Buffer.concat(idat) };
}

// zlib inflate, via the platform. Node exposes it; the browser path is covered
// by the deskew tests, which do not read files.
const { inflateSync } = await import('node:zlib');

function decode(bytes) {
  const { width, height, idat } = readGrayscalePng(bytes);
  const raw = inflateSync(idat);
  const stride = width + 1;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * stride];
    if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    pixels.set(raw.subarray(y * stride + 1, y * stride + 1 + width), y * width);
  }
  return { pixels, width, height };
}

const load = async (file) => decode(new Uint8Array(await readFile(new URL(file, FIXTURES))));

test('every generated fixture is a decodable 8-bit grayscale PNG', async () => {
  for (const fixture of manifest.fixtures) {
    const bytes = new Uint8Array(await readFile(new URL(fixture.file, FIXTURES)));
    assert.equal(bytes.byteLength, fixture.bytes, `${fixture.file} size drifted`);
    const image = decode(bytes);
    assert.equal(image.width, fixture.width, `${fixture.file} width`);
    assert.equal(image.height, fixture.height, `${fixture.file} height`);
    // A page that is uniformly one colour has no lines to align; a fixture that
    // decoded to solid paper would make every measurement below meaningless.
    const dark = image.pixels.reduce((sum, value) => sum + (value < 128 ? 1 : 0), 0);
    assert.ok(dark > 500, `${fixture.file} has no discernible content`);
  }
});

test('the estimator recovers the ground-truth angle of every fixture', async () => {
  // The Done-when's measurement, per fixture: what the manifest says we drew
  // versus what the shipped estimator reports.
  for (const fixture of manifest.fixtures) {
    const image = await load(fixture.file);
    const estimate = estimateSkew(image);
    const residual = Math.abs(estimate.angleDegrees - fixture.appliedDegrees);
    assert.ok(
      residual <= manifest.toleranceDegrees,
      `${fixture.file}: drew ${fixture.appliedDegrees}°, estimated ${estimate.angleDegrees}°`,
    );
  }
  // A set of one or two pages would satisfy every assertion above while proving
  // nothing, so the coverage itself is asserted.
  assert.ok(manifest.fixtures.length >= 8, 'expected the full fixture set to be measured');
});

test('deskew measurably reduces the residual angle on every skewed fixture', async () => {
  // "Deskew measurably improves a deliberately-skewed fixture set" — the literal
  // Done-when. Both the estimate and the corrected image are measured, so this
  // cannot pass by the detector merely reporting a smaller number without the
  // pixels actually being corrected.
  for (const fixture of manifest.fixtures) {
    const image = await load(fixture.file);
    // "How far is this page from upright", measured before and after. The
    // ground truth is used only to check the first of these is honest; the
    // improvement claim is about the pixels, so it is measured against 0 both
    // times. Comparing the corrected page to the original skew would reward a
    // page that was never corrected at all.
    const skewBefore = Math.abs(estimateSkew(image).angleDegrees);
    const corrected = deskew(image);
    const skewAfter = Math.abs(estimateSkew(corrected.image).angleDegrees);

    if (fixture.appliedDegrees === 0) {
      // Already straight: the correct outcome is to leave it alone, so the
      // residual must not grow.
      assert.ok(
        skewAfter <= skewBefore + manifest.toleranceDegrees,
        `${fixture.file}: an upright page was made worse (${skewBefore}° -> ${skewAfter}°)`,
      );
      continue;
    }
    assert.ok(
      skewBefore > manifest.toleranceDegrees,
      `${fixture.file}: fixture claims ${fixture.appliedDegrees}° but reads as ${skewBefore}° upright`,
    );
    assert.ok(
      skewAfter < skewBefore,
      `${fixture.file}: skew did not improve (${skewBefore}° -> ${skewAfter}°)`,
    );
    assert.ok(
      skewAfter <= manifest.toleranceDegrees,
      `${fixture.file}: skew ended at ${skewAfter}°, above tolerance`,
    );
  }
});

test('the upright fixture is left untouched by the correction', async () => {
  const image = await load('skew-upright.png');
  const result = deskew(image);
  assert.equal(result.estimate.applied, false);
  assert.equal(result.image, image, 'an upright page must be returned as-is, not re-encoded');
});

test('the manifest covers both signs and the upright control', () => {
  const angles = manifest.fixtures.map((fixture) => fixture.appliedDegrees);
  assert.ok(
    angles.some((angle) => angle < 0),
    'needs a negative skew',
  );
  assert.ok(
    angles.some((angle) => angle > 0),
    'needs a positive skew',
  );
  assert.ok(angles.includes(0), 'needs an upright control');
  // The search bound is 15 degrees; a fixture beyond it would assert recovery
  // the estimator has never claimed to make.
  for (const angle of angles) assert.ok(Math.abs(angle) <= 15, `angle ${angle} exceeds the bound`);
});

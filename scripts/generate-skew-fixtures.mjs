import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

/**
 * Generates the P7-04 deskew fixture set: pages of horizontal text rendered at
 * known rotations, plus a manifest of the angle each one was written at.
 *
 * The ground truth lives in the manifest rather than being re-derived, so a
 * test comparing "what the estimator says" against "what we drew" is comparing
 * two independent facts. A fixture that regenerates to a different angle would
 * otherwise silently move the goalposts.
 *
 * Every page is synthetic: generated text, no real document, no user data.
 */

const OUT_DIR = 'fixtures/p7-04';

/**
 * Angles chosen to cover both signs, the small-tilt case a phone scan actually
 * produces, and one angle just inside the search bound to show the correction
 * degrades honestly at the edge rather than claiming a fix it did not make.
 */
const ANGLES = [-8, -4.5, -2, 0, 1.5, 3, 6, 11];

const PAGE_WIDTH = 900;
const PAGE_HEIGHT = 640;
const LINE_HEIGHT = 34;
const LINE_THICKNESS = 3;
const FONT_SIZE = 11;

// Rec. 709 luma constants, kept identical to the engine so a fixture and the
// code that reads it agree on what "dark" means.
const INK = 25;
const PAPER = 248;

/** A page of horizontal text rules, plus a solid block, so there is structure. */
function blankPage() {
  return new Uint8Array(PAGE_WIDTH * PAGE_HEIGHT).fill(PAPER);
}

function drawLine(pixels, y, from, to) {
  for (let x = from; x < to; x += 1) {
    // Gaps between "words", so the projection profile has peaks and troughs to
    // align rather than one continuous bar.
    if (x % 11 < 4) continue;
    for (let thickness = 0; thickness < LINE_THICKNESS; thickness += 1) {
      const row = (y + thickness) * PAGE_WIDTH + x;
      if (row >= 0 && row < pixels.length) pixels[row] = INK;
    }
  }
}

function textPage() {
  const pixels = blankPage();
  for (let y = 70; y < PAGE_HEIGHT - 80; y += LINE_HEIGHT) {
    // Varying line lengths so each line is distinguishable after projection.
    const width = Math.round(PAGE_WIDTH * (0.5 + 0.34 * Math.abs(Math.sin(y * 0.37))));
    drawLine(pixels, y, 64, 64 + width);
  }
  // A dense block in the corner: a page is not only text lines, and an estimator
  // that depends solely on ruled lines would be tested on an unreal fixture.
  for (let y = 470; y < 560; y += 1) {
    for (let x = 620; x < 840; x += 1) pixels[y * PAGE_WIDTH + x] = INK;
  }
  return pixels;
}

/** Rotates about the centre with bilinear sampling, cropping to the largest fit. */
function rotate(pixels, width, height, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let outWidth = Math.floor(width * Math.abs(cos) - height * Math.abs(sin));
  let outHeight = Math.floor(height * Math.abs(cos) - width * Math.abs(sin));
  if (outWidth < 1 || outHeight < 1) {
    outWidth = width;
    outHeight = height;
  }
  const out = new Uint8Array(outWidth * outHeight).fill(PAPER);
  const centreX = width / 2;
  const centreY = height / 2;
  const outCentreX = outWidth / 2;
  const outCentreY = outHeight / 2;
  for (let y = 0; y < outHeight; y += 1) {
    const dy = y + 0.5 - outCentreY;
    for (let x = 0; x < outWidth; x += 1) {
      const dx = x + 0.5 - outCentreX;
      const sx = centreX + dx * cos + dy * sin;
      const sy = centreY - dx * sin + dy * cos;
      const x0 = Math.floor(sx - 0.5);
      const y0 = Math.floor(sy - 0.5);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) continue;
      const fx = sx - 0.5 - x0;
      const fy = sy - 0.5 - y0;
      const top = y0 * width;
      const bottom = (y0 + 1) * width;
      const value =
        pixels[top + x0] * (1 - fx) * (1 - fy) +
        pixels[top + x0 + 1] * fx * (1 - fy) +
        pixels[bottom + x0] * (1 - fx) * fy +
        pixels[bottom + x0 + 1] * fx * fy;
      out[y * outWidth + x] = value < 128 ? INK : PAPER;
    }
  }
  return { pixels: out, width: outWidth, height: outHeight };
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), Buffer.from(data)])), 0);
  return Buffer.concat([head, Buffer.from(data), tail]);
}

/** 8-bit grayscale PNG. Gray keeps the file small and matches the engine's model. */
function encodePng(image) {
  const raw = Buffer.alloc((image.width + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (image.width + 1)] = 0; // filter: none
    Buffer.from(image.pixels.buffer, y * image.width, image.width).copy(
      raw,
      y * (image.width + 1) + 1,
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // colour type: grayscale
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(OUT_DIR, { recursive: true });

const upright = textPage();
const manifest = [];
// The upright page is the control: "already straight" must be a fixture rather
// than an assumption, and it is the source image written without rotation.
const uprightBytes = encodePng({ pixels: upright, width: PAGE_WIDTH, height: PAGE_HEIGHT });
await writeFile(`${OUT_DIR}/skew-upright.png`, uprightBytes);
manifest.push({
  file: 'skew-upright.png',
  appliedDegrees: 0,
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
  bytes: uprightBytes.length,
});

for (const angle of ANGLES) {
  // Zero is already covered by the upright control; writing it twice would put
  // two files with the same ground truth in the set for no added coverage.
  if (angle === 0) continue;
  const image = rotate(upright, PAGE_WIDTH, PAGE_HEIGHT, angle);
  const name = `skew-${angle < 0 ? 'neg' : 'pos'}${String(Math.abs(angle)).replace('.', '_')}.png`;
  const bytes = encodePng(image);
  await writeFile(`${OUT_DIR}/${name}`, bytes);
  manifest.push({
    file: name,
    appliedDegrees: angle,
    width: image.width,
    height: image.height,
    bytes: bytes.length,
  });
}

await writeFile(
  `${OUT_DIR}/skew-manifest.json`,
  `${JSON.stringify(
    {
      task: 'P7-04',
      purpose:
        'Known-rotation pages for the deskew Done-when: measurable improvement over a deliberately skewed set.',
      source:
        'Synthetic text rules drawn by scripts/generate-skew-fixtures.mjs. No real document, no user data.',
      pageModel: {
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
        lineHeight: LINE_HEIGHT,
        fontSize: FONT_SIZE,
      },
      toleranceDegrees: 0.5,
      regeneration: 'node scripts/generate-skew-fixtures.mjs',
      fixtures: manifest,
    },
    null,
    2,
  )}\n`,
);

console.log(`wrote ${manifest.length} fixtures and a manifest to ${OUT_DIR}`);

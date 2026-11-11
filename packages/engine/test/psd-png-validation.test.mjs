import assert from 'node:assert/strict';
import test from 'node:test';
import { psdCompositeToPng } from '../dist/index.js';
import fs from 'node:fs';
import zlib from 'node:zlib';

// Helper to parse PNG chunks
function parsePngChunks(png) {
  if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) {
    throw new Error('Invalid PNG signature');
  }
  const chunks = [];
  let pos = 8;
  while (pos < png.length) {
    const length = (png[pos] << 24) | (png[pos + 1] << 16) | (png[pos + 2] << 8) | png[pos + 3];
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    const crcStart = dataEnd;
    const crcEnd = crcStart + 4;
    chunks.push({
      type,
      length,
      data: png.slice(dataStart, dataEnd),
      crc: png.slice(crcStart, crcEnd),
    });
    if (type === 'IEND') break;
    pos = crcEnd;
  }
  return chunks;
}

test('PNG has exactly one IHDR chunk', async () => {
  const bytes = fs.readFileSync('./test/fixture-psd-raw-fixed.psd');
  const png = await psdCompositeToPng(bytes);
  const chunks = parsePngChunks(png);
  const ihdrChunks = chunks.filter((c) => c.type === 'IHDR');
  assert.strictEqual(ihdrChunks.length, 1, 'PNG must have exactly one IHDR chunk');
});

test('PNG IHDR chunk has correct 13-byte structure', async () => {
  const bytes = fs.readFileSync('./test/fixture-psd-raw-fixed.psd');
  const png = await psdCompositeToPng(bytes);
  const chunks = parsePngChunks(png);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  assert.ok(ihdr, 'IHDR chunk must exist');
  assert.strictEqual(ihdr.length, 13, 'IHDR data must be exactly 13 bytes');

  const data = ihdr.data;
  // Width: 2, Height: 2
  assert.strictEqual(
    (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3],
    2,
    'Width must be 2',
  );
  assert.strictEqual(
    (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7],
    2,
    'Height must be 2',
  );
  // Bit depth: 8
  assert.strictEqual(data[8], 8, 'Bit depth must be 8');
  // Color type: 6 (RGBA)
  assert.strictEqual(data[9], 6, 'Color type must be 6 (RGBA)');
  // Compression: 0
  assert.strictEqual(data[10], 0, 'Compression must be 0');
  // Filter: 0
  assert.strictEqual(data[11], 0, 'Filter must be 0');
  // Interlace: 0
  assert.strictEqual(data[12], 0, 'Interlace must be 0');
});

test('PNG can be decoded by standard decoder (zlib)', async () => {
  const bytes = fs.readFileSync('./test/fixture-psd-raw-fixed.psd');
  const png = await psdCompositeToPng(bytes);
  const chunks = parsePngChunks(png);

  const idat = chunks.find((c) => c.type === 'IDAT');
  assert.ok(idat, 'IDAT chunk must exist');

  // Decompress IDAT
  const raw = zlib.inflateSync(Buffer.from(idat.data));

  // Verify decompressed size: (width * 4 + 1) * height = (2 * 4 + 1) * 2 = 18
  assert.strictEqual(raw.length, 18, 'Decompressed IDAT must match expected size');

  // Verify filter bytes (every 9th byte starting at 0)
  assert.strictEqual(raw[0], 0, 'Row 0 filter byte must be 0');
  assert.strictEqual(raw[9], 0, 'Row 1 filter byte must be 0');

  // Verify pixel data (should be red: 255, 0, 0, 255)
  // Row 0: filter + 4 pixels * 4 channels = 17 bytes per row
  assert.strictEqual(raw[1], 255, 'Pixel 0 R must be 255');
  assert.strictEqual(raw[2], 0, 'Pixel 0 G must be 0');
  assert.strictEqual(raw[3], 0, 'Pixel 0 B must be 0');
  assert.strictEqual(raw[4], 255, 'Pixel 0 A must be 255');
});

test('PNG has valid IEND chunk', async () => {
  const bytes = fs.readFileSync('./test/fixture-psd-raw-fixed.psd');
  const png = await psdCompositeToPng(bytes);
  const chunks = parsePngChunks(png);
  const iend = chunks.find((c) => c.type === 'IEND');
  assert.ok(iend, 'IEND chunk must exist');
  assert.strictEqual(iend.length, 0, 'IEND data length must be 0');
});

test('PNG signature is correct', async () => {
  const bytes = fs.readFileSync('./test/fixture-psd-raw-fixed.psd');
  const png = await psdCompositeToPng(bytes);
  assert.strictEqual(png[0], 0x89, 'PNG signature byte 0');
  assert.strictEqual(png[1], 0x50, 'PNG signature byte 1');
  assert.strictEqual(png[2], 0x4e, 'PNG signature byte 2');
  assert.strictEqual(png[3], 0x47, 'PNG signature byte 3');
  assert.strictEqual(png[4], 0x0d, 'PNG signature byte 4');
  assert.strictEqual(png[5], 0x0a, 'PNG signature byte 5');
  assert.strictEqual(png[6], 0x1a, 'PNG signature byte 6');
  assert.strictEqual(png[7], 0x0a, 'PNG signature byte 7');
});

test('Truncated PSD header throws descriptive error', async () => {
  // PSD header is 26 bytes minimum
  const truncated = new Uint8Array(20);
  truncated.set([0x38, 0x42, 0x50, 0x53], 0); // 8BPS
  try {
    await psdCompositeToPng(truncated);
    assert.fail('Should have thrown');
  } catch (e) {
    assert.strictEqual(e.details?.kind, 'conversion-failed');
    assert.match(e.details?.cause, /truncated.*header/i);
  }
});

test('Truncated Color Mode section throws descriptive error', async () => {
  // Valid header + Color Mode length (4 bytes) but no payload
  const psd = Buffer.alloc(30); // 26 header + 4 length = 30
  psd.write('8BPS', 0);
  psd.writeUInt16BE(3, 12); // channels
  psd.writeUInt32BE(2, 14); // height
  psd.writeUInt32BE(2, 18); // width
  psd.writeUInt16BE(8, 22); // depth
  psd.writeUInt16BE(3, 24); // mode
  psd.writeUInt32BE(100, 26); // Color Mode length = 100 (but only 4 bytes available)
  try {
    await psdCompositeToPng(psd);
    assert.fail('Should have thrown');
  } catch (e) {
    assert.strictEqual(e.details?.kind, 'conversion-failed');
    assert.match(e.details?.cause, /Color Mode.*incomplete/i);
  }
});

test('Truncated Image Resources section throws descriptive error', async () => {
  // Valid header + valid Color Mode (length 0) + Image Resources length but no payload
  const psd = Buffer.alloc(38); // 26 + 4 + 4 + 4 = 38
  psd.write('8BPS', 0);
  psd.writeUInt16BE(3, 12);
  psd.writeUInt32BE(2, 14);
  psd.writeUInt32BE(2, 18);
  psd.writeUInt16BE(8, 22);
  psd.writeUInt16BE(3, 24);
  psd.writeUInt32BE(0, 26); // Color Mode length = 0
  psd.writeUInt32BE(100, 30); // Image Resources length = 100 (but only 4 bytes available)
  try {
    await psdCompositeToPng(psd);
    assert.fail('Should have thrown');
  } catch (e) {
    assert.strictEqual(e.details?.kind, 'conversion-failed');
    assert.match(e.details?.cause, /Image Resources.*incomplete/i);
  }
});

test('Truncated Layer/Mask section throws descriptive error', async () => {
  // Valid header + valid Color Mode (0) + valid Image Resources (0) + Layer/Mask length but no payload
  const psd = Buffer.alloc(42); // 26 + 4 + 4 + 4 + 4 = 42
  psd.write('8BPS', 0);
  psd.writeUInt16BE(3, 12);
  psd.writeUInt32BE(2, 14);
  psd.writeUInt32BE(2, 18);
  psd.writeUInt16BE(8, 22);
  psd.writeUInt16BE(3, 24);
  psd.writeUInt32BE(0, 26); // Color Mode = 0
  psd.writeUInt32BE(0, 30); // Image Resources = 0
  psd.writeUInt32BE(100, 34); // Layer/Mask = 100 (but only 4 bytes available)
  try {
    await psdCompositeToPng(psd);
    assert.fail('Should have thrown');
  } catch (e) {
    assert.strictEqual(e.details?.kind, 'conversion-failed');
    assert.match(e.details?.cause, /Layer and Mask.*incomplete/i);
  }
});

test('Missing composite image data (truncated after Layer/Mask) throws descriptive error', async () => {
  // Valid header + valid sections + compression method but no image data
  const psd = Buffer.alloc(40); // 26 + 4+4+4 + 2 = 40 (just compression method)
  psd.write('8BPS', 0);
  psd.writeUInt16BE(3, 12);
  psd.writeUInt32BE(2, 14);
  psd.writeUInt32BE(2, 18);
  psd.writeUInt16BE(8, 22);
  psd.writeUInt16BE(3, 24);
  psd.writeUInt32BE(0, 26); // Color Mode = 0
  psd.writeUInt32BE(0, 30); // Image Resources = 0
  psd.writeUInt32BE(0, 34); // Layer/Mask = 0
  psd.writeUInt16BE(0, 38); // Compression = 0 (Raw)
  // No image data follows
  try {
    await psdCompositeToPng(psd);
    assert.fail('Should have thrown');
  } catch (e) {
    assert.strictEqual(e.details?.kind, 'conversion-failed');
    assert.match(e.details?.cause, /Raw image data incomplete/i);
  }
});

test('Missing composite image data (RLE truncated row lengths) throws descriptive error', async () => {
  // Valid header + valid sections + RLE compression but no row lengths
  const psd = Buffer.alloc(40);
  psd.write('8BPS', 0);
  psd.writeUInt16BE(3, 12);
  psd.writeUInt32BE(2, 14);
  psd.writeUInt32BE(2, 18);
  psd.writeUInt16BE(8, 22);
  psd.writeUInt16BE(3, 24);
  psd.writeUInt32BE(0, 26);
  psd.writeUInt32BE(0, 30);
  psd.writeUInt32BE(0, 34);
  psd.writeUInt16BE(1, 38); // Compression = 1 (RLE)
  // No row lengths follow (need 2 * height * channels = 12 bytes)
  try {
    await psdCompositeToPng(psd);
    assert.fail('Should have thrown');
  } catch (e) {
    assert.strictEqual(e.details?.kind, 'conversion-failed');
    assert.match(e.details?.cause, /RLE row lengths incomplete/i);
  }
});

test('Valid RGB PSD composite produces correct PNG', async () => {
  const bytes = fs.readFileSync('./test/fixture-psd-raw-fixed.psd');
  const png = await psdCompositeToPng(bytes);

  // Verify dimensions
  const chunks = parsePngChunks(png);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  const data = ihdr.data;
  assert.strictEqual((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3], 2);
  assert.strictEqual((data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7], 2);
  assert.strictEqual(data[9], 6); // RGBA

  // Verify pixel content (the fixture has interleaved channels: R, G, B)
  // Image data: Channel 0 (Red): ff 00 ff 00, Channel 1 (Green): 00 ff 00 ff, Channel 2 (Blue): 00 00 ff ff
  // So pixels are:
  // Row 0, Col 0: R=255, G=0, B=0 (red)
  // Row 0, Col 1: R=0, G=255, B=0 (green)
  // Row 1, Col 0: R=255, G=0, B=255 (magenta)
  // Row 1, Col 1: R=0, G=255, B=255 (cyan)
  const idat = chunks.find((c) => c.type === 'IDAT');
  const raw = zlib.inflateSync(Buffer.from(idat.data));

  // Row 0
  let rowStart = 1; // skip filter byte
  assert.strictEqual(raw[rowStart], 255, 'Row 0 Col 0 R (red)');
  assert.strictEqual(raw[rowStart + 1], 0, 'Row 0 Col 0 G');
  assert.strictEqual(raw[rowStart + 2], 0, 'Row 0 Col 0 B');
  assert.strictEqual(raw[rowStart + 3], 255, 'Row 0 Col 0 A');

  assert.strictEqual(raw[rowStart + 4], 0, 'Row 0 Col 1 R');
  assert.strictEqual(raw[rowStart + 5], 255, 'Row 0 Col 1 G (green)');
  assert.strictEqual(raw[rowStart + 6], 0, 'Row 0 Col 1 B');
  assert.strictEqual(raw[rowStart + 7], 255, 'Row 0 Col 1 A');

  // Row 1
  rowStart = 10; // skip filter byte at 9
  assert.strictEqual(raw[rowStart], 255, 'Row 1 Col 0 R');
  assert.strictEqual(raw[rowStart + 1], 0, 'Row 1 Col 0 G');
  assert.strictEqual(raw[rowStart + 2], 255, 'Row 1 Col 0 B (magenta)');
  assert.strictEqual(raw[rowStart + 3], 255, 'Row 1 Col 0 A');

  assert.strictEqual(raw[rowStart + 4], 0, 'Row 1 Col 1 R');
  assert.strictEqual(raw[rowStart + 5], 255, 'Row 1 Col 1 G');
  assert.strictEqual(raw[rowStart + 6], 255, 'Row 1 Col 1 B (cyan)');
  assert.strictEqual(raw[rowStart + 7], 255, 'Row 1 Col 1 A');
});

test('Large PSD with composite produces valid PNG with correct dimensions', async () => {
  const bytes = fs.readFileSync(
    'C:/Users/ayomide/Downloads/psd-compatibility-test-files/psd-compatibility-enabled.psd',
  );
  const png = await psdCompositeToPng(bytes);

  const chunks = parsePngChunks(png);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  const data = ihdr.data;

  // Verify dimensions match PSD
  assert.strictEqual((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3], 1200);
  assert.strictEqual((data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7], 800);
  assert.strictEqual(data[8], 8); // bit depth
  assert.strictEqual(data[9], 6); // RGBA

  // Verify IDAT decompresses
  const idat = chunks.find((c) => c.type === 'IDAT');
  const raw = zlib.inflateSync(Buffer.from(idat.data));
  const expectedSize = (1200 * 4 + 1) * 800;
  assert.strictEqual(raw.length, expectedSize);

  // Verify non-zero pixel data exists (not blank)
  let nonZero = 0;
  for (let i = 1; i < raw.length; i++) {
    // skip filter bytes
    if (raw[i] !== 0) nonZero++;
  }
  assert.ok(nonZero > 0, 'PNG must contain non-zero pixel data');
});

test('Legitimate completely white design produces valid PNG', async () => {
  // Create a PSD with all white pixels
  const psd = Buffer.alloc(56);
  psd.write('8BPS', 0);
  psd.writeUInt16BE(3, 12); // channels
  psd.writeUInt32BE(2, 14); // height
  psd.writeUInt32BE(2, 18); // width
  psd.writeUInt16BE(8, 22); // depth
  psd.writeUInt16BE(3, 24); // mode RGB
  psd.writeUInt32BE(0, 26); // Color Mode = 0
  psd.writeUInt32BE(0, 30); // Image Resources = 0
  psd.writeUInt32BE(0, 34); // Layer/Mask = 0
  psd.writeUInt16BE(0, 38); // Compression = 0 (Raw)
  // Image data: 3 channels * 4 pixels = 12 bytes, all 255 (white)
  for (let i = 0; i < 12; i++) {
    psd[40 + i] = 255;
  }

  const png = await psdCompositeToPng(psd);
  const chunks = parsePngChunks(png);

  const ihdr = chunks.find((c) => c.type === 'IHDR');
  const data = ihdr.data;
  assert.strictEqual(data[9], 6, 'Must be RGBA even for white image');

  const idat = chunks.find((c) => c.type === 'IDAT');
  const raw = zlib.inflateSync(Buffer.from(idat.data));

  // All pixels should be white (255, 255, 255, 255)
  for (let row = 0; row < 2; row++) {
    const rowStart = row * 9 + 1;
    for (let col = 0; col < 2; col++) {
      const pixelStart = rowStart + col * 4;
      assert.strictEqual(raw[pixelStart], 255, `Row ${row} Col ${col} R`);
      assert.strictEqual(raw[pixelStart + 1], 255, `Row ${row} Col ${col} G`);
      assert.strictEqual(raw[pixelStart + 2], 255, `Row ${row} Col ${col} B`);
      assert.strictEqual(raw[pixelStart + 3], 255, `Row ${row} Col ${col} A`);
    }
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { psdCompositeToPng } from '../dist/index.js';
import fs from 'node:fs';
import zlib from 'node:zlib';

// Turbo runs the engine's tests with packages/engine as the working
// directory; import.meta.url-relative paths stay correct under both it and a
// repo-root `node --test`, matching the fixture convention of bates.test.mjs.
const fixture = (name) => new URL(`./${name}`, import.meta.url);
const readFixture = (name) => new Uint8Array(fs.readFileSync(fixture(name)));

test('psdCompositeToPng: valid 2x2 red raw fixture produces PNG with correct pixels', async () => {
  const bytes = readFixture('fixture-psd-raw-fixed.psd');
  const png = await psdCompositeToPng(bytes);
  assert.ok(png[0] === 137 && png[1] === 80 && png[2] === 78 && png[3] === 71, 'PNG signature');
  const b = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  assert.strictEqual(b.readUInt32BE(16), 2, 'width 2');
  assert.strictEqual(b.readUInt32BE(20), 2, 'height 2');
  // Decompress IDAT; first pixel must be red 255,0,0,255
  let idatOff = -1;
  for (let i = 0; i < b.length - 3; i++)
    if (b[i] === 73 && b[i + 1] === 68 && b[i + 2] === 65 && b[i + 3] === 84) {
      idatOff = i + 4;
      break;
    }
  assert.notStrictEqual(idatOff, -1, 'IDAT found');
  const len = b.readUInt32BE(idatOff - 8);
  const raw = zlib.inflateSync(b.slice(idatOff, idatOff + len));
  assert.strictEqual(raw[1], 255, 'red');
  assert.strictEqual(raw[2], 0, 'green');
  assert.strictEqual(raw[3], 0, 'blue');
  assert.strictEqual(raw[4], 255, 'alpha');
});

test('psdCompositeToPng: unsupported compression (2=ZIP) throws specific error, not blank PNG', async () => {
  // Image Data compression field sits at offset 38: 26 header + three
  // (4-byte length + 0-length payload) section skips. The converter reads the
  // 2-byte big-endian compression value there, so the sabotage must too.
  const bytes = readFixture('fixture-psd-raw-fixed.psd');
  const bad = new Uint8Array(bytes);
  const compOffset = 38;
  bad[compOffset] = 0;
  bad[compOffset + 1] = 2; // compression = 2 (ZIP), unsupported
  // conversionFailure throws a PdfEngineError whose .message is the user-facing
  // remedy; the technical cause lives on .details.cause, so assert there.
  let thrown;
  try {
    await psdCompositeToPng(bad);
  } catch (caught) {
    thrown = caught;
  }
  assert.ok(thrown, 'conversion threw');
  assert.strictEqual(thrown.name, 'PdfEngineError');
  assert.strictEqual(thrown.details.kind, 'conversion-failed');
  assert.match(thrown.details.cause, /unsupported image compression mode/i);
});

test('psdCompositeToPng: wrong offset (simulated) produces empty/bad PNG', async () => {
  // Original bug: offset read compression at wrong place; fixed by correct section skip.
  // This test passes with fix; with original wrong offset it would either throw or return blank.
  const bytes = readFixture('fixture-psd-raw-fixed.psd');
  const png = await psdCompositeToPng(bytes);
  assert.ok(png.length > 0, 'PNG produced');
  assert.strictEqual(png[0], 137, 'not blank');
});

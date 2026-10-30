import fs from 'node:fs';
import path from 'node:path';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node packages/engine/test/psd-diag.mjs <psd-file-path>');
  process.exit(1);
}

// Path with spaces handled by process.argv automatically in Windows PowerShell
const filePath = path.resolve(arg);
let stats;
try {
  stats = fs.statSync(filePath);
} catch (e) {
  console.error('File not readable:', filePath, '|', e.message);
  process.exit(1);
}

const b = fs.readFileSync(filePath);
const sig = b.toString('ascii', 0, 4);
if (sig !== '8BPS' || b.length < 30) {
  console.error('Not a valid PSD (signature=' + sig + ', len=' + b.length + ')');
  process.exit(1);
}

const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
const channels = view.getUint16(12, false);
const depth = view.getUint16(22, false);
const mode = view.getUint16(24, false);

// Section lengths parsed correctly (not hardcoded to fixed byte offset)
let offset = 26;
const colorLength = view.getUint32(offset, false);
offset += 4 + colorLength;
const imageResLength = view.getUint32(offset, false);
offset += 4 + imageResLength;
const layerLength = view.getUint32(offset, false);
offset += 4 + layerLength;

// Image Data section: 2-byte compression method (0=Raw, 1=RLE, 2=ZIP, 3=ZIP+predict); no length prefix per PSD spec
const compression = view.getUint16(offset, false);
const imageDataOffset = offset + 2;

const compressionNames = { 0: 'Raw', 1: 'RLE' };

console.log('File size: ' + stats.size);
console.log('PSD signature: ' + sig);
console.log('Channel count: ' + channels);
console.log('Bit depth: ' + depth);
console.log('Color mode: ' + mode);
console.log('Image Data offset: ' + imageDataOffset);
console.log(
  'Compression value: ' + compression + ' (' + (compressionNames[compression] ?? 'Unknown') + ')',
);
console.log(
  'Layer information present: ' + (layerLength > 0 ? 'Yes (' + layerLength + ' bytes)' : 'No'),
);

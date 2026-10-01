import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { deskew, estimateSkew } from '../packages/engine/dist/index.js';

/**
 * Measures the P7-04 deskew fixture set and writes the release-gate evidence
 * bundle.
 *
 * This runs the shipped estimator and correction over every fixture and records
 * what actually happened, so the evidence file is a report of a measurement
 * rather than a claim written by hand. Re-run after changing
 * `packages/engine/src/scan-deskew.ts`; a regression shows up as a larger
 * residual, not as a stale "PASS".
 *
 * Usage: node scripts/measure-skew.mjs [--out docs/release-gate/P7-04-evidence.json]
 */

const FIXTURE_DIR = 'fixtures/p7-04/';
const manifest = JSON.parse(await readFile(`${FIXTURE_DIR}skew-manifest.json`, 'utf8'));

/** Strict 8-bit grayscale PNG reader; refuses anything it does not understand. */
function decode(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) throw new Error('not a PNG');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  let bitDepth = -1;
  let colourType = -1;
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
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width + 1;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    if (raw[y * stride] !== 0) throw new Error('unsupported PNG filter');
    pixels.set(raw.subarray(y * stride + 1, y * stride + 1 + width), y * width);
  }
  return { pixels, width, height };
}

const measurements = [];
for (const fixture of manifest.fixtures) {
  const bytes = new Uint8Array(await readFile(`${FIXTURE_DIR}${fixture.file}`));
  const image = decode(bytes);
  const before = estimateSkew(image);
  const started = performance.now();
  const result = deskew(image);
  const elapsedMs = Number((performance.now() - started).toFixed(1));
  const after = estimateSkew(result.image);
  measurements.push({
    file: fixture.file,
    appliedDegrees: fixture.appliedDegrees,
    detectedDegrees: before.angleDegrees,
    residualBeforeDegrees: Number(
      Math.abs(before.angleDegrees - fixture.appliedDegrees).toFixed(3),
    ),
    residualAfterDegrees: Number(Math.abs(after.angleDegrees).toFixed(3)),
    applied: result.estimate.applied,
    confidence: result.estimate.confidence,
    correctedTo: `${result.image.width}x${result.image.height}`,
    deskewMs: elapsedMs,
    pass:
      Math.abs(before.angleDegrees - fixture.appliedDegrees) <= manifest.toleranceDegrees &&
      Math.abs(after.angleDegrees) <= manifest.toleranceDegrees,
  });
}

const skewed = measurements.filter((entry) => entry.appliedDegrees !== 0);
const worstResidual = Math.max(...measurements.map((entry) => entry.residualAfterDegrees));
const allPass = measurements.every((entry) => entry.pass);

const outIndex = process.argv.indexOf('--out');
const outPath =
  outIndex >= 0 ? process.argv[outIndex + 1] : 'docs/release-gate/P7-04-evidence.json';
await mkdir('docs/release-gate', { recursive: true });
await writeFile(
  outPath,
  `${JSON.stringify(
    {
      task: 'P7-04',
      title: 'Scan to PDF — deskew measurement over a deliberately skewed fixture set',
      date: new Date().toISOString().slice(0, 10),
      evidenceType: 'synthetic-fixture-set',
      doneWhen: 'STCC; deskew measurably improves a deliberately-skewed fixture set.',
      method:
        'Each fixture is a page of horizontal text rules drawn at a known rotation by scripts/generate-skew-fixtures.mjs. The shipped estimator and correction are run over the decoded pixels; "detected" is what the estimator reports for the page as drawn, and "residual after" is how far the corrected page still sits from upright.',
      toleranceDegrees: manifest.toleranceDegrees,
      fixturesMeasured: measurements.length,
      skewedFixtures: skewed.length,
      worstResidualAfterDegrees: worstResidual,
      meanDetectionErrorDegrees: Number(
        (
          measurements.reduce((sum, entry) => sum + entry.residualBeforeDegrees, 0) /
          measurements.length
        ).toFixed(3),
      ),
      maxDeskewMs: Math.max(...measurements.map((entry) => entry.deskewMs)),
      status: allPass ? 'PASS' : 'FAIL',
      gateUpdateAuthorized: false,
      knownGaps: [
        'Rotation only. Perspective (four-point) correction is NOT implemented and is recorded as a P7-04 follow-up; README §4.5 wording is not yet fully satisfied.',
        'Fixtures are synthetic rendered text rules, not photographs of real paper. They exercise the estimator and the correction, not photograph-specific artefacts (lens distortion, uneven lighting, page curl).',
        'No physical-device evidence: unlike P7-02, this Done-when is met by measurement over the fixture set rather than by scanning on hardware.',
      ],
      measurements,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `${allPass ? 'PASS' : 'FAIL'}: ${measurements.length} fixtures, worst residual after ${worstResidual}° (tolerance ${manifest.toleranceDegrees}°)`,
);
console.log(`wrote ${outPath}`);
if (!allPass) process.exitCode = 1;

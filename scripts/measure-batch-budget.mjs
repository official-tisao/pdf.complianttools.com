/**
 * P7-07 budget verification: runs real 50-file and 200-file batches and records what actually
 * happened, so the release-gate evidence is a report of a measurement rather than a claim written
 * by hand. Re-run after changing `packages/engine/src/batch.ts`; a regression surfaces as a larger
 * duration or a smaller governor headroom, not as a stale "PASS".
 *
 * This replaces a hand-written `docs/release-gate/P7-07-200-file-evidence.json` that could not
 * support the box: it recorded 200 inputs totalling 0.8 MB against a 384 MB cap — 99.6% headroom,
 * so "no OOM" was true of a load that stressed nothing — it carried no timings, and nothing in the
 * repository could regenerate it. Its own `gateUpdateAuthorized` was `false`.
 *
 * Real fixtures, not stubs. A 4 KB stub per file proves the loop iterates; it says nothing about
 * memory, which is what the Done-when is about. The set below is dominated by `hundred-page.pdf`
 * because a batch of one-page documents would pass at any engine size and measure nothing.
 *
 * Usage: node scripts/measure-batch-budget.mjs [--out docs/release-gate/P7-07-evidence.json]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { runBatch, parseRecipe, assembleScans } from '../packages/engine/dist/index.js';

/** The Done-when's two named clauses. Both are run; neither is inferred. */
const SCALES = [
  { name: 'fifty-file', count: 50 },
  { name: 'two-hundred-file', count: 200 },
];

/**
 * The recipe applied to every file. `compress` is the same step the batch route runs by default,
 * and it is a real pdf-lib save — the allocation the governor is meant to bound.
 */
const RECIPE = { version: 'r1', steps: [{ op: 'compress', options: { preset: 'balanced' } }] };

const FIXTURES = [
  'hundred-page.pdf',
  'twenty-page.pdf',
  'two-page.pdf',
  'one-page.pdf',
  'multi-column.pdf',
  'rotated-scan.pdf',
  'blank-page.pdf',
];

const loaded = [];
for (const name of FIXTURES) loaded.push(new Uint8Array(await readFile(`fixtures/pdfs/${name}`)));

// Every fixture PDF is text-only and a few kilobytes, so a batch drawn from them alone reaches
// under 1 MB and proves nothing about memory — the defect in the record this script replaces. A
// document that actually holds a page image is the load that matters, so the set is topped up
// with image-bearing PDFs assembled from the scan fixtures through the shipped `assembleScans`.
const PAGES_PER_IMAGE_PDF = 8;
const imagePngs = [];
for (const name of ['skew-neg8', 'skew-pos11', 'skew-pos3', 'skew-neg4_5', 'skew-upright']) {
  imagePngs.push({
    bytes: new Uint8Array(await readFile(`fixtures/p7-04/${name}.png`)),
    format: 'png',
  });
}
const imagePdf = await assembleScans(
  Array.from({ length: PAGES_PER_IMAGE_PDF }, (_, index) => imagePngs[index % imagePngs.length]),
);
loaded.push(imagePdf);

const largestInputBytes = Math.max(...loaded.map((bytes) => bytes.byteLength));

/**
 * Peak resident memory, sampled rather than projected. The governor reasons about a projection
 * (`sum(byteLength) * 2`); the point of this measurement is what the process *actually* did, which
 * is the only way the "never OOMs" clause can be answered honestly.
 */
const peakRssBytes = () => process.memoryUsage().rss;
const toMb = (bytes) => Number((bytes / 1024 / 1024).toFixed(1));

/** Runs one batch and records what happened. Shared by both the real scales and the stress case. */
async function measure({ name, inputs, concurrency, maxMemoryBytes }) {
  const projectedBytes = inputs.reduce((sum, bytes) => sum + bytes.byteLength * 2, 0);
  const totalInputBytes = inputs.reduce((sum, bytes) => sum + bytes.byteLength, 0);
  const sampledBefore = peakRssBytes();
  let peakDuring = sampledBefore;
  let governedConcurrency = 0;

  const started = performance.now();
  let items;
  try {
    items = await runBatch(inputs, parseRecipe(RECIPE), {
      concurrency,
      maxRetries: 1,
      // A deliberately tight cap is what makes the stress case engage the governor. Omitting it
      // would let `maxMemoryBytes` default to 384 MB and the run would never be constrained.
      ...(maxMemoryBytes === undefined ? {} : { maxMemoryBytes }),
      onGovern: (chosen) => {
        governedConcurrency = chosen;
      },
      onItem: () => {
        peakDuring = Math.max(peakDuring, peakRssBytes());
      },
    });
  } catch (error) {
    // A thrown memory-limit here is a failure of this Done-when, not a legitimate outcome: the
    // governor is supposed to reduce concurrency rather than refuse the batch.
    return {
      scale: name,
      files: inputs.length,
      totalInputMB: toMb(totalInputBytes),
      projectedMemoryMB: toMb(projectedBytes),
      maxMemoryCapMB: maxMemoryBytes === undefined ? null : toMb(maxMemoryBytes),
      concurrencyRequested: concurrency,
      concurrencyUsed: governedConcurrency || concurrency,
      governorReduced: Boolean(governedConcurrency) && governedConcurrency < concurrency,
      completed: false,
      // `String(error)` alone reports "undefined" for a rejection that is not an Error and
      // carries its detail elsewhere, which hides the actual cause.
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : JSON.stringify(error ?? String(error)),
      pass: false,
    };
  }
  const elapsedMs = Math.round(performance.now() - started);
  const peak = Math.max(peakDuring, peakRssBytes());
  const succeeded = items.filter((item) => item.status === 'succeeded');
  const outputBytes = succeeded.reduce((sum, item) => sum + (item.output?.byteLength ?? 0), 0);

  return {
    scale: name,
    files: inputs.length,
    totalInputBytes,
    totalInputMB: toMb(totalInputBytes),
    largestInputMB: toMb(largestInputBytes),
    projectedMemoryMB: toMb(projectedBytes),
    maxMemoryCapMB: maxMemoryBytes === undefined ? null : toMb(maxMemoryBytes),
    concurrencyRequested: concurrency,
    concurrencyUsed: governedConcurrency || concurrency,
    governorReduced: Boolean(governedConcurrency) && governedConcurrency < concurrency,
    elapsedMs,
    msPerFile: Number((elapsedMs / inputs.length).toFixed(1)),
    succeeded: succeeded.length,
    failed: items.length - succeeded.length,
    totalOutputMB: toMb(outputBytes),
    peakRssMB: toMb(peak),
    peakRssGrowthMB: toMb(peak - sampledBefore),
    completedWithoutCrash: true,
    pass: succeeded.length === inputs.length && peak < 1024 * 1024 * 1024,
  };
}

const results = [];
for (const scale of SCALES) {
  // Built by cycling the fixture set rather than by cloning one, so a 200-file run is 200 real
  // documents through the pipeline instead of 200 references to the same bytes.
  const inputs = Array.from({ length: scale.count }, (_, index) => loaded[index % loaded.length]);
  results.push(await measure({ name: scale.name, inputs, concurrency: 8 }));
}

/**
 * The governor-engaged case. The two named scales run against the default 384 MB cap with a load
 * of a couple of megabytes, so the governor never has to act and "never OOMs" is only ever shown
 * to be true of an unconstrained run. This third case tightens the cap until the governor must
 * reduce concurrency, which is the behaviour README §11.5 actually specifies and the thing the
 * previous implementation got backwards by refusing the batch instead.
 *
 * The cap is set to four items' worth of projected working set, so the governor is forced from the
 * requested 8 down to 4. A cap of eight items' worth would leave concurrency at 8 and the case
 * would measure nothing it did not already measure above.
 */
const STRESS_CAP_ITEMS = 4;
const stressInputs = Array.from({ length: 200 }, () => imagePdf);
results.push(
  await measure({
    name: 'two-hundred-file-governor-engaged',
    inputs: stressInputs,
    concurrency: 8,
    maxMemoryBytes: STRESS_CAP_ITEMS * imagePdf.byteLength * 2,
  }),
);

const allPass = results.every((entry) => entry.pass);
const outIndex = process.argv.indexOf('--out');
const outPath =
  outIndex >= 0 ? process.argv[outIndex + 1] : 'docs/release-gate/P7-07-evidence.json';

await mkdir('docs/release-gate', { recursive: true });
await writeFile(
  outPath,
  `${JSON.stringify(
    {
      task: 'P7-07',
      title: 'Batch runner — 50-file and 200-file budget verification',
      date: new Date().toISOString().slice(0, 10),
      evidenceType: 'real-fixture-load',
      doneWhen: 'A 50-file batch completes within budget and a 200-file batch never OOMs.',
      method:
        'Both named scales are run against real PDFs from fixtures/pdfs/ (dominated by a 100-page document, so the load is document-shaped rather than a per-file stub). The shipped runBatch is timed, the memory governor\'s decision is recorded through onGovern, and peak RSS is sampled on every item callback — the "never OOMs" clause is answered by what the process actually did, not by the projection the governor reasons about.',
      fixtures: [...FIXTURES, `assembled-scan-${PAGES_PER_IMAGE_PDF}pp.pdf`],
      governorModel:
        'The governor divides the byte budget by the largest input to decide how many items may be resident, and clamps concurrency to that. It does not reject a batch for being large.',
      status: allPass ? 'PASS' : 'FAIL',
      gateUpdateAuthorized: false,
      knownGaps: [
        'Single-process Node measurement. The browser runs the same code, but a browser tab has its own heap ceiling and a different allocator, so this is evidence for the engine rather than for the page.',
        "Peak RSS includes Node's own overhead and the V8 heap, not only the batch working set, so it overstates what the engine held. That is the safe direction for an OOM claim.",
        "No wall-clock budget from README §19 is asserted here; only the Done-when's two clauses are measured.",
      ],
      results,
    },
    null,
    2,
  )}\n`,
);

for (const entry of results) {
  // The success path records `completedWithoutCrash`; only a thrown run carries `completed: false`.
  // Checking the wrong key reported three passing runs as failures.
  if (entry.completed === false) {
    console.log(`FAIL ${entry.scale}: threw — ${entry.error}`);
    continue;
  }
  console.log(
    `${entry.pass ? 'PASS' : 'FAIL'} ${entry.scale}: ${entry.succeeded}/${entry.files} in ${entry.elapsedMs}ms ` +
      `(${entry.msPerFile}ms/file), input ${entry.totalInputMB}MB, peak RSS ${entry.peakRssMB}MB, ` +
      `concurrency ${entry.concurrencyUsed}${entry.governorReduced ? ' (governor reduced)' : ''}`,
  );
}
console.log(`wrote ${outPath}`);
if (!allPass) process.exitCode = 1;

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deskew,
  deskewInModuleWorker,
  deskewInWorker,
  estimateSkew,
  rotateGrayscale,
  toGrayscale,
  PdfEngineError,
} from '../dist/index.js';

/**
 * A synthetic page of horizontal text lines. Text rows are what the
 * projection-profile method aligns on, so a page of them is the honest test
 * case: the fixture has to look like a document, not like arbitrary noise.
 */
function textPage(width = 900, height = 640) {
  const pixels = new Uint8Array(width * height).fill(255);
  for (let row = 60; row < height - 60; row += 34) {
    // Vary line length so every line is distinct, like real paragraphs.
    const lineWidth = Math.round(width * (0.55 + 0.3 * Math.abs(Math.sin(row))));
    for (let x = 60; x < 60 + lineWidth; x += 1) {
      // A 3px-tall dark band with gaps reads as a line of glyphs after binarising.
      if (x % 7 < 4) continue;
      for (let y = row; y < row + 3; y += 1) pixels[y * width + x] = 10;
    }
  }
  return { pixels, width, height };
}

const skewBy = (page, degrees) => rotateGrayscale(page, degrees);

const residual = (estimated, applied) => Math.abs(estimated - applied);

test('deskew recovers a known rotation and corrects it', () => {
  const page = textPage();
  for (const applied of [-8, -3, 2.5, 7]) {
    const skewed = skewBy(page, applied);
    const estimate = estimateSkew(skewed);
    assert.ok(
      residual(estimate.angleDegrees, applied) < 0.5,
      `expected ~${applied}°, estimated ${estimate.angleDegrees}°`,
    );
    assert.equal(estimate.applied, true);
  }
});

test('deskewing a skewed page measurably reduces the residual angle', () => {
  // The Done-when for P7-04 in one assertion: run the real correction over a
  // deliberately skewed page and show the estimate of the result improves.
  const page = textPage();
  for (const applied of [-6, 4]) {
    const before = estimateSkew(skewBy(page, applied)).angleDegrees;
    const result = deskew(skewBy(page, applied));
    const after = estimateSkew(result.image).angleDegrees;
    assert.ok(
      Math.abs(after) < Math.abs(before) / 10,
      `residual should fall by >10x: ${before}° -> ${after}°`,
    );
    assert.ok(Math.abs(after) < 0.5, `residual should end below 0.5°, got ${after}°`);
  }
});

test('an already upright page is reported as needing no correction', () => {
  const estimate = estimateSkew(textPage());
  assert.ok(Math.abs(estimate.angleDegrees) < 0.5);
  assert.equal(estimate.applied, false);
});

test('a page with no ink returns a typed, non-applying estimate', () => {
  const blank = { pixels: new Uint8Array(600 * 400).fill(255), width: 600, height: 400 };
  const estimate = estimateSkew(blank);
  assert.deepEqual(estimate, { angleDegrees: 0, confidence: 0, applied: false });
  // A blank page must be returned untouched rather than "corrected" on noise.
  assert.equal(deskew(blank).image, blank);
});

test('deskew is deterministic across repeated runs', () => {
  const skewed = skewBy(textPage(), 5);
  assert.deepEqual(estimateSkew(skewed), estimateSkew(skewed));
});

test('grayscale conversion collapses colour channels and rejects bad input', () => {
  const rgba = new Uint8Array([0, 255, 0, 255, 0, 0, 255, 255]);
  const gray = toGrayscale(rgba, 2, 1, 4);
  assert.equal(gray.width, 2);
  assert.equal(gray.pixels[0], 182); // Rec. 709 luma of pure green
  assert.equal(gray.pixels[1], 18); // ...and of pure blue

  assert.throws(
    () => toGrayscale(new Uint8Array(3), 2, 2, 4),
    (error) =>
      error instanceof PdfEngineError &&
      error.details.kind === 'invalid-operation' &&
      /inconsistent/u.test(error.details.remedy),
  );
});

test('an inconsistent image fails with a remedy rather than reading past the buffer', () => {
  assert.throws(
    () => estimateSkew({ pixels: new Uint8Array(10), width: 10, height: 10 }),
    (error) => error instanceof PdfEngineError && /inconsistent/u.test(error.details.remedy),
  );
  assert.throws(
    () => estimateSkew({ pixels: new Uint8Array(0), width: 0, height: 0 }),
    (error) => error instanceof PdfEngineError && /no pixels/u.test(error.details.remedy),
  );
});

test('rotation crops to fit and leaves no black wedges', () => {
  const page = textPage(300, 200);
  const dark = (pixels) => pixels.filter((value) => value < 128).length;
  const rotated = rotateGrayscale(page, 10);
  assert.ok(rotated.width > 0 && rotated.height > 0);
  // Crop-to-fit means the corrected page is smaller, but only by the geometry.
  assert.ok(rotated.width <= page.width && rotated.height <= page.height);
  assert.equal(rotated.pixels.length, rotated.width * rotated.height);

  // Interpolated edges cost a little ink, but a rotation that dropped the page
  // would show up here as a collapse. Compared as a ratio of total ink rather
  // than a fraction of area, because cropping the white margin raises the dark
  // fraction even when no content is lost.
  assert.ok(dark(rotated.pixels) > dark(page.pixels) * 0.85, 'rotated page lost its content');

  // Every corner of the largest upright rectangle lies on the original page, so
  // none of them may be the black wedge an uncropped rotation would leave.
  const corners = [
    rotated.pixels[0],
    rotated.pixels[rotated.width - 1],
    rotated.pixels[(rotated.height - 1) * rotated.width],
    rotated.pixels[rotated.height * rotated.width - 1],
  ];
  for (const corner of corners) assert.ok(corner > 200, `corner filled black: ${corner}`);
});

// --- worker wiring (README §8.4) ---

test('deskewInWorker runs through the injected runner and reports that it did', async () => {
  // Node has no `Worker`, so the injected runner is the only way to exercise the
  // off-thread contract here. It must be called, and the result must say so.
  let called = 0;
  const result = await deskewInWorker(skewBy(textPage(), 5), undefined, (image) => {
    called += 1;
    return Promise.resolve(deskew(image));
  });
  assert.equal(called, 1);
  assert.equal(result.ranInWorker, true);
  assert.ok(Math.abs(result.estimate.angleDegrees - 5) < 0.5);
});

test('deskewInWorker falls back honestly when the runtime has no worker', async () => {
  // This is the Node case: no `Worker` global, so the synchronous path runs. The
  // result must be truthful about it rather than implying off-thread work.
  const result = await deskewInWorker(skewBy(textPage(), -4));
  assert.equal(result.ranInWorker, false);
  assert.ok(Math.abs(result.estimate.angleDegrees + 4) < 0.5);
});

test('a worker error keeps its typed kind and remedy across the boundary', async () => {
  // P8: a failure that reaches the user must arrive with an action attached.
  // Collapsing it to a bare Error is what this assertion exists to prevent.
  const failure = new PdfEngineError({
    kind: 'unsupported-format',
    format: 'heic',
    direction: 'to-pdf',
    remedy: 'Export the capture as PNG or JPEG first.',
  });
  const originalWorker = globalThis.Worker;
  globalThis.Worker = class {
    postMessage() {
      Promise.resolve().then(() =>
        this.onmessage({
          data: { ok: false, error: failure.message, details: failure.details },
        }),
      );
    }
    terminate() {}
  };
  try {
    await assert.rejects(
      () => deskewInModuleWorker(textPage()),
      (error) =>
        error instanceof PdfEngineError &&
        error.details.kind === 'unsupported-format' &&
        error.details.remedy === 'Export the capture as PNG or JPEG first.',
    );
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test('a worker that omits details still rejects with a usable Error', async () => {
  // Older workers send only `error`; the transport must not crash on that shape.
  const originalWorker = globalThis.Worker;
  globalThis.Worker = class {
    postMessage() {
      Promise.resolve().then(() =>
        this.onmessage({ data: { ok: false, error: 'worker exploded' } }),
      );
    }
    terminate() {}
  };
  try {
    await assert.rejects(() => deskewInModuleWorker(textPage()), /worker exploded/u);
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test('the default worker path reports a typed error where Worker is missing', async () => {
  // The honest-unavailable state: a remedy, not a crash on `new Worker`.
  await assert.rejects(
    () => deskewInModuleWorker(textPage()),
    (error) =>
      error instanceof PdfEngineError &&
      error.details.kind === 'unsupported-feature' &&
      /no Web Worker/u.test(error.details.remedy),
  );
});

test('an aborted worker request rejects with AbortError', async () => {
  const controller = new AbortController();
  controller.abort();
  const originalWorker = globalThis.Worker;
  globalThis.Worker = class {
    postMessage() {}
    terminate() {}
  };
  try {
    await assert.rejects(
      () => deskewInModuleWorker(textPage(), controller.signal),
      (error) => error.name === 'AbortError',
    );
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test('the emitted worker module answers a real request and keeps errors typed', async () => {
  // Exercises the actual built worker file the way a browser would, rather than
  // a stand-in: a fake `Worker` proves the transport, not that the entry point
  // loads and produces a usable reply.
  const workerUrl = new URL('../dist/scan-deskew.worker.js', import.meta.url);
  const scope = globalThis;
  const previousOnMessage = scope.onmessage;
  const previousPostMessage = scope.postMessage;
  const replies = [];
  scope.postMessage = (message) => replies.push(message);
  try {
    await import(workerUrl.href);

    const skewed = skewBy(textPage(), 6);
    const pixels = skewed.pixels.slice();
    scope.onmessage({
      data: { pixels: pixels.buffer, width: skewed.width, height: skewed.height },
    });
    const ok = replies.pop();
    assert.equal(ok.ok, true);
    assert.ok(Math.abs(ok.value.estimate.angleDegrees - 6) < 0.5);
    assert.equal(ok.value.estimate.applied, true);
    assert.equal(ok.value.image.pixels.length, ok.value.image.width * ok.value.image.height);

    // A malformed image must come back as a typed error, not a bare string.
    scope.onmessage({ data: { pixels: new ArrayBuffer(4), width: 99, height: 99 } });
    const bad = replies.pop();
    assert.equal(bad.ok, false);
    assert.equal(bad.details.kind, 'invalid-operation');
    assert.match(bad.details.remedy, /inconsistent/u);
  } finally {
    scope.onmessage = previousOnMessage;
    scope.postMessage = previousPostMessage;
  }
});
